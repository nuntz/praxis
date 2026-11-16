import {
  type Day,
  type End,
  failure,
  PAGE_SIZE,
  type Project,
  type ProjectEvent,
  success,
  type Task,
  type ToolResult,
  type Written,
  written,
} from "@praxis/domain";
import {
  insertProject,
  insertProjectEvent,
  type ProjectRow,
  projectEffect,
  projectsWithTasks,
  readProject,
} from "../project-rows.ts";
import type { Handlers, ToolCall } from "../registry.ts";
import { insertTaskEvent, readTask, setTaskProject, taskEffect } from "../task-rows.ts";

const NO_SUCH_PROJECT = "No such Project in this Context.";
const NO_SUCH_TASK = "No such Task in this Context.";

export const projectTools: Pick<
  Handlers,
  | "move_task"
  | "make_project_from_task"
  | "create_project"
  | "rename_project"
  | "set_project_due_date"
  | "finish_project"
  | "drop_project"
  | "reopen_project"
  | "get_project"
  | "list_projects"
> = {
  move_task({ input, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    const to = input.project_id;
    if (to !== null && !readProject(sql, to, today)) return failure("not_found", NO_SUCH_PROJECT);
    if (task.project === to) return success(written(task, []));
    // Membership is the Task's own, so only the Task changes: a Project reads its Tasks.
    setTaskProject(sql, task.id, to);
    const moved = readTask(sql, task.id, today) as Task;
    return success(written(moved, [taskEffect(moved, "changed")]));
  },

  make_project_from_task({ input, arrivedAt, today, sql }) {
    const task = readTask(sql, input.id, today);
    if (!task) return failure("not_found", NO_SUCH_TASK);
    // A Task has no parts, so the work it turned out to be becomes a Project and the Task its
    // first: still a Task, with its Origin Entry. A Project holds no Project, so a Task in one
    // leaves it for the new one.
    const id = insertProject(sql, { name: input.name ?? task.title, dueDate: null, at: arrivedAt });
    setTaskProject(sql, task.id, id);
    const project = readProject(sql, id, today) as Project;
    const moved = project.tasks[0] as Task;
    return success(
      written(project, [projectEffect(project, "made"), taskEffect(moved, "changed")]),
    );
  },

  create_project({ input, arrivedAt, today, sql }) {
    const id = insertProject(sql, {
      name: input.name,
      dueDate: input.due_date ?? null,
      at: arrivedAt,
    });
    const project = readProject(sql, id, today) as Project;
    return success(written(project, [projectEffect(project, "made")]));
  },

  rename_project({ input, today, sql }) {
    const project = readProject(sql, input.id, today);
    if (!project) return failure("not_found", NO_SUCH_PROJECT);
    if (project.name === input.name) return success(written(project, []));
    sql.exec(`UPDATE projects SET name = ? WHERE id = ?`, input.name, project.id);
    const renamed = readProject(sql, project.id, today) as Project;
    return success(written(renamed, [projectEffect(renamed, "changed")]));
  },

  set_project_due_date({ input, today, sql }) {
    const project = readProject(sql, input.id, today);
    if (!project) return failure("not_found", NO_SUCH_PROJECT);
    if (project.due_date === input.due_date) return success(written(project, []));
    // A Project's Due Date says nothing about its Tasks': theirs stay as they are.
    sql.exec(`UPDATE projects SET due_date = ? WHERE id = ?`, input.due_date, project.id);
    const dated = readProject(sql, project.id, today) as Project;
    return success(written(dated, [projectEffect(dated, "changed")]));
  },

  finish_project: (call) => declare("finished", call),

  drop_project: (call) => declare("dropped", call),

  reopen_project({ input, arrivedAt, today, sql }) {
    const project = readProject(sql, input.id, today);
    if (!project) return failure("not_found", NO_SUCH_PROJECT);
    if (project.state.is === "open") return success(written(project, []));
    // The Tasks dropped with it stay Dropped: reopening a Project reopens no Task.
    return declared(sql, project, { what: "reopened", at: arrivedAt }, today, []);
  },

  get_project({ input, today, sql }) {
    const project = readProject(sql, input.id, today);
    return project ? success(project) : failure("not_found", NO_SUCH_PROJECT);
  },

  list_projects({ input, today, sql }) {
    let before = Number.MAX_SAFE_INTEGER;
    if (input.cursor !== undefined) {
      const position = decodeCursor(input.cursor);
      if (position === null) {
        return failure("invalid_input", "The cursor is not one this list gave.");
      }
      before = position;
    }
    // Newest first, narrowed by the state the last declaration left it in. One more than a page
    // is read to learn whether another page follows.
    const rows = sql
      .exec<ProjectRow>(
        `SELECT p.* FROM projects p
         WHERE p.seq < ?
           AND (? IS NULL OR ? = coalesce(
             nullif((SELECT what FROM project_events e WHERE e.project = p.id
                     ORDER BY e.seq DESC LIMIT 1), 'reopened'),
             'open'))
         ORDER BY p.seq DESC LIMIT ?`,
        before,
        input.state ?? null,
        input.state ?? null,
        PAGE_SIZE + 1,
      )
      .toArray();
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return success({
      items: projectsWithTasks(sql, page, today),
      next_cursor: rows.length > PAGE_SIZE && last ? encodeCursor(last.seq) : null,
    });
  },
};

/**
 * A Project is declared at an end. Unlike a Task's, a Project's end is never refused: one at the
 * other end is declared at this one directly. Each Task still open in it is Dropped by rule, so
 * closing a Project never has to be refused for what is in it.
 */
function declare(
  end: End,
  { input, arrivedAt, today, sql }: ToolCall<"finish_project" | "drop_project">,
): ToolResult<Written<Project>> {
  const project = readProject(sql, input.id, today);
  if (!project) return failure("not_found", NO_SUCH_PROJECT);
  if (project.state.is === end) return success(written(project, []));
  const stillOpen = project.tasks.filter((task) => task.state.is === "open");
  for (const task of stillOpen) insertTaskEvent(sql, task.id, { what: "dropped", at: arrivedAt });
  return declared(sql, project, { what: end, at: arrivedAt }, today, stillOpen);
}

/** Something was declared of a Project: it is the call's Effect, and each Task a rule dropped. */
function declared(
  sql: SqlStorage,
  project: Project,
  event: ProjectEvent,
  today: Day,
  dropped: Task[],
): ToolResult<Written<Project>> {
  insertProjectEvent(sql, project.id, event);
  const updated = readProject(sql, project.id, today) as Project;
  const tasks = new Map(updated.tasks.map((task) => [task.id, task]));
  return success(
    written(updated, [
      projectEffect(updated, "changed"),
      ...dropped.map((task) => taskEffect(tasks.get(task.id) as Task, "changed", "rule")),
    ]),
  );
}

function encodeCursor(seq: number): string {
  return btoa(JSON.stringify(["projects", seq]));
}

function decodeCursor(cursor: string): number | null {
  try {
    const value: unknown = JSON.parse(atob(cursor));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value[0] === "projects" &&
      Number.isSafeInteger(value[1]) &&
      value[1] >= 0
    ) {
      return value[1];
    }
  } catch {
    // Not base64 or not JSON: not a cursor this list gave.
  }
  return null;
}

import {
  type Day,
  type Effect,
  instantToIso,
  type Project,
  type ProjectEvent,
  projectState,
  summarizeWords,
} from "@praxis/domain";
import { untrashedById } from "./record-tables.ts";
import { tasksIn } from "./task-rows.ts";

export type ProjectRow = {
  seq: number;
  id: string;
  name: string;
  at: number;
  due_date: string | null;
};

type EventRow = { project: string; what: ProjectEvent["what"]; at: number };

/** Make a Project, and return its id. */
export function insertProject(
  sql: SqlStorage,
  project: { name: string; dueDate: Day | null; at: number },
): string {
  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO projects (id, name, at, due_date) VALUES (?, ?, ?, ?)`,
    id,
    project.name,
    project.at,
    project.dueDate,
  );
  return id;
}

/** Add one thing declared of a Project. Its state follows from these. */
export function insertProjectEvent(sql: SqlStorage, project: string, event: ProjectEvent): void {
  sql.exec(
    `INSERT INTO project_events (project, what, at) VALUES (?, ?, ?)`,
    project,
    event.what,
    event.at,
  );
}

/** A Project that exists in this Context, with its Tasks, read as on `today`. */
export function readProject(sql: SqlStorage, id: string, today: Day): Project | null {
  const rows = sql.exec<ProjectRow>(`SELECT * FROM untrashed_projects WHERE id = ?`, id).toArray();
  return projectsWithTasks(sql, rows, today)[0] ?? null;
}

/** The Projects with these ids that exist in this Context, by id, read as on `today`. */
export function readProjects(sql: SqlStorage, ids: string[], today: Day): Map<string, Project> {
  return untrashedById(sql, "project", ids, (rows: ProjectRow[]) =>
    projectsWithTasks(sql, rows, today),
  );
}

/** The open Projects in this Context, in the order they were made, read as on `today`. */
export function openProjects(sql: SqlStorage, today: Day): Project[] {
  // Open is derived: a Project is open unless the last thing declared of it was an end.
  const rows = sql
    .exec<ProjectRow>(
      `SELECT p.* FROM untrashed_projects p
       WHERE coalesce((SELECT what FROM project_events e WHERE e.project = p.id
                       ORDER BY e.seq DESC LIMIT 1), 'reopened') = 'reopened'
       ORDER BY p.seq`,
    )
    .toArray();
  return projectsWithTasks(sql, rows, today);
}

/** The Projects with their state and their Tasks, read as on `today`. */
export function projectsWithTasks(sql: SqlStorage, rows: ProjectRow[], today: Day): Project[] {
  const ids = rows.map((row) => row.id);
  const events = Map.groupBy(
    sql
      .exec<EventRow>(
        `SELECT project, what, at FROM project_events
         WHERE project IN (SELECT value FROM json_each(?)) ORDER BY seq`,
        JSON.stringify(ids),
      )
      .toArray(),
    (event) => event.project,
  );
  const tasks = tasksIn(sql, ids, today);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    at: instantToIso(row.at),
    due_date: row.due_date,
    state: projectState(events.get(row.id) ?? [], row.due_date, today),
    tasks: tasks.get(row.id) ?? [],
  }));
}

/** The Effect of a call on a Project, with its one-line summary. */
export function projectEffect(project: Pick<Project, "id" | "name">, what: Effect["what"]): Effect {
  return {
    kind: "project",
    id: project.id,
    what,
    summary: summarizeWords(project.name),
    by: "call",
  };
}

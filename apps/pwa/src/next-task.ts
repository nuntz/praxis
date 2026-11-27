import type { Entry, Project, Task } from "@praxis/domain";
import { createSignal } from "solid-js";
import { type CallTool, unreachableMessage } from "./tools.ts";

// A Project's page with no open Task offers to write its next Task (section 8.3). A Task is made
// only with an Entry, and a Project has no Entry of its own, so the page aims the Journal's
// composer at the Project for one Entry, and every Task that Entry makes is put in it once the
// Entry is recorded. The aim is the screen's intent, not a rule of the model: nothing of it is in
// the words, and an Entry written any other way is recorded as any Entry is.

/** A Project as the aim names it. */
export type ProjectNamed = Pick<Project, "id" | "name">;

/** A Task as what is said of it names it. */
export type TaskTitled = Pick<Task, "id" | "title">;

/** The Project the composer's next Entry is written for, in the Context it is of. */
export type Aim = { context: string; project: ProjectNamed };

const [wanted, setWanted] = createSignal<Aim | null>(null);

/** Aim the composer at a Project, as it next shows, or now if it is shown. */
export const aimComposer: (aim: Aim) => void = setWanted;

/**
 * The aim asked for, for the composer of this Context, which it then has: asked once, it is given
 * once. One asked for another Context is let go, since it is of a Project there.
 */
export function takeAim(context: string): Aim | null {
  const aim = wanted();
  if (aim === null) return null;
  setWanted(null);
  return aim.context === context ? aim : null;
}

/** Tasks an aimed Entry made that were not put in its Project. */
export type NotPutIn = Aim & { tasks: TaskTitled[] };

const listeners = new Set<(left: NotPutIn) => void>();

/** Hear of Tasks made but not put in their Project, as Attention says them. */
export function onNotPutIn(listener: (left: NotPutIn) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Put every Task an aimed Entry made in the Project it was aimed at. Those that could not be are
 * told to whoever hears, together; nothing is undone.
 */
export async function putTasksMadeIn(callTool: CallTool, aim: Aim, entry: Entry): Promise<void> {
  const { tasks } = await putTasksIn(callTool, aim.project.id, entry.tasks);
  if (tasks.length === 0) return;
  for (const listener of listeners) listener({ ...aim, tasks });
}

/**
 * Put each Task in a Project, with `move_task`: those still not in it, and the last reason one
 * was not, or none when every one is.
 */
export async function putTasksIn(
  callTool: CallTool,
  projectId: string,
  tasks: TaskTitled[],
): Promise<{ tasks: TaskTitled[]; problem: string }> {
  const left: TaskTitled[] = [];
  let problem = "";
  for (const task of tasks) {
    try {
      const result = await callTool("move_task", { id: task.id, project_id: projectId });
      if (result.ok) continue;
      problem = result.error.message;
    } catch (error) {
      problem = unreachableMessage(error);
    }
    left.push({ id: task.id, title: task.title });
  }
  return { tasks: left, problem };
}

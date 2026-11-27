import { type Day, type Task, type TaskDates, utcMidnight, waitedOnName } from "@praxis/domain";
import Calendar from "lucide-solid/icons/calendar";
import { createMemo, createSignal, type JSX, Show } from "solid-js";
import { todayIn } from "./days.tsx";
import { SettlingField } from "./SettlingField.tsx";
import { unreachableMessage, useCallTool, useContextId } from "./tools.ts";
import { discardUnsent, finishTask, unsentFinishOf } from "./unsent.ts";

/** A day as the Device's locale writes it. A day has no time zone of its own. */
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

export function formatDay(day: Day): string {
  return dayFormat.format(utcMidnight(day));
}

/**
 * A Task where it is shown, in the Journal on the Entry it hangs off or in Attention, finished or
 * reopened from there by its checkbox (section 8.3). Each state that holds is its own mark,
 * Overdue is marked on the date, and nothing is ranked.
 */
export function TaskItem(props: {
  task: Task;
  /** The Context's time zone, in which the day it was Delegated is told. */
  timeZone: string;
  /** Its id on the page, where it is the place a link to the Task leads. */
  anchor?: string;
  /** A mark the place showing it adds, such as why it is listed there. */
  mark?: JSX.Element;
  onTask: (task: Task) => void;
  onFinished?: OnFinished;
  onProblem: (message: string) => void;
}) {
  const [editingDates, setEditingDates] = createSignal(false);
  const finishing = createFinishing({
    task: () => props.task,
    onTask: props.onTask,
    onFinished: props.onFinished,
    onProblem: props.onProblem,
  });

  return (
    <li
      class="task"
      id={props.anchor}
      tabIndex={props.anchor === undefined ? undefined : -1}
      classList={{ closed: finishing.closed() }}
    >
      <label>
        <input
          type="checkbox"
          checked={finishing.shownFinished()}
          disabled={finishing.sending() || finishing.dropped()}
          onChange={(event) => void finishing.toggle(event.currentTarget)}
        />
        <span class="task-title">{props.task.title}</span>
      </label>
      <TaskMarks task={props.task} timeZone={props.timeZone} mark={props.mark} />
      {/* A well-known action, so its icon stands alone, named for the Task (section 8.11). */}
      <button
        type="button"
        class="task-dates-toggle"
        aria-label={`Dates for ${props.task.title}`}
        title={`Dates for ${props.task.title}`}
        aria-expanded={editingDates()}
        onClick={() => setEditingDates((shown) => !shown)}
      >
        <Calendar size={18} aria-hidden="true" />
      </button>
      <Show when={editingDates()}>
        <TaskDatesEditor task={props.task} onTask={props.onTask} onProblem={props.onProblem} />
      </Show>
    </li>
  );
}

/**
 * What finishing a Task where it is shown needs of it: its title, where it stands, and what its
 * Recurrence makes of the finish.
 */
type Finishable = Pick<Task, "id" | "title" | "state" | "recurrence" | "due_date">;

/**
 * A Task finished from its round control: as it was when finished, and as the server then said it
 * is, or null while its finish is Unsent on this Device.
 */
export type Finish = {
  task: Omit<Finishable, "state">;
  finished: Task | null;
};

/** A Task was finished from its round control, which is given. */
export type OnFinished = (finish: Finish, control: HTMLElement) => void;

/**
 * Finishing and reopening a Task from where it is shown, by its round control, through the tools
 * Attention uses: with no network a finish is kept Unsent, and a finish still Unsent is undone on
 * the Device. What the server says of the Task after is given to `onTask`, and a finish made, sent
 * or Unsent, is what `setFinished` gives back, and what `toggle` gives `onFinished`.
 */
export function createFinishing(props: {
  task: () => Finishable;
  onTask: (task: Task) => void;
  onFinished?: OnFinished | undefined;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  const contextId = useContextId();
  const [sending, setSending] = createSignal(false);
  const finished = () => props.task().state.is === "finished";
  // Finished on this Device and not yet sent; one the server refused is shown in Attention instead.
  const unsentFinish = () => unsentFinishOf(props.task().id);
  const shownFinished = () => finished() || unsentFinish() !== null;

  async function setFinished(finish: boolean): Promise<Finish | null> {
    // A finish still Unsent is undone on the Device, with no trace (section 8.8).
    const unsent = unsentFinish();
    if (unsent) {
      discardUnsent(unsent.id);
      return null;
    }
    // Read before the answer, since the Task may be a store's, which the live channel changes.
    const { id, title, recurrence, due_date } = props.task();
    const task = { id, title, recurrence, due_date };
    setSending(true);
    try {
      if (finish) {
        // With no network the finish is kept Unsent, and the Task shows it.
        const outcome = await finishTask(contextId, task);
        if (outcome.kind === "refused") {
          props.onProblem(outcome.message);
          return null;
        }
        if (outcome.kind === "unsent") return { task, finished: null };
        props.onTask(outcome.value);
        return { task, finished: outcome.value };
      }
      const result = await callTool("reopen_task", { id });
      if (!result.ok) {
        props.onProblem(result.error.message);
        return null;
      }
      // What a rule did besides, releasing a Task waiting on it or making the next Occurrence,
      // comes over the live channel.
      props.onTask(result.value.record);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
    return null;
  }

  /** The round control changed: whatever the answer, it shows the Task as it now stands. */
  async function toggle(box: HTMLInputElement) {
    const finish = await setFinished(box.checked);
    // As the server last said it is, or finished Unsent on this Device.
    box.checked = shownFinished();
    if (finish) props.onFinished?.(finish, box);
  }

  return {
    sending,
    /** Finished, on the server or Unsent on this Device. */
    shownFinished,
    dropped: () => props.task().state.is === "dropped",
    /** At an end, or finished Unsent: drawn muted. */
    closed: () => props.task().state.is !== "open" || unsentFinish() !== null,
    setFinished,
    toggle,
  };
}

/**
 * Each state that holds for a Task as its own mark, wherever it is shown: finished Unsent, the mark
 * the place adds, Dropped, its Due Date with Overdue, Recurring, Waiting, Delegated and Deferred.
 */
export function TaskMarks(props: {
  task: Pick<Task, "id" | "state" | "due_date" | "recurrence">;
  /** The Context's time zone, in which the day it was Delegated is told. */
  timeZone: string;
  mark?: JSX.Element;
}) {
  const open = () => (props.task.state.is === "open" ? props.task.state : null);
  const sinceFormat = createMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: props.timeZone }),
  );
  return (
    <>
      <Show when={unsentFinishOf(props.task.id)}>
        <span class="task-mark unsent-mark">Finished, Unsent</span>
      </Show>
      {props.mark}
      <Show when={props.task.state.is === "dropped"}>
        <span class="task-mark">Dropped</span>
      </Show>
      <Show when={props.task.due_date}>
        {(due) => (
          <DueMark due={due()} overdue={open()?.overdue != null} timeZone={props.timeZone} />
        )}
      </Show>
      <Show when={props.task.recurrence}>
        <span class="task-mark">Recurring</span>
      </Show>
      <Show when={open()?.waiting}>
        {(waiting) => (
          <span class="task-mark">
            Waiting on{" "}
            {waiting()
              .map(({ on }) => waitedOnName(on))
              .join(", ")}
          </span>
        )}
      </Show>
      <Show when={open()?.delegated}>
        {(delegated) => (
          <span class="task-mark">
            Delegated to {delegated().to.name} since{" "}
            {sinceFormat().format(new Date(delegated().since))}
          </span>
        )}
      </Show>
      <Show when={open()?.deferred}>
        {(deferred) => <span class="task-mark">Deferred until {formatDay(deferred().until)}</span>}
      </Show>
    </>
  );
}

/**
 * A Due Date, a Task's or a Project's, with Overdue marked on it, and today's said as today, in
 * the Context's time zone. Both are bold, and only Overdue is in `warn` (section 8.11).
 */
export function DueMark(props: { due: Day; overdue: boolean; timeZone: string }) {
  const today = () => !props.overdue && props.due === todayIn(props.timeZone);
  return (
    <span class="task-mark" classList={{ overdue: props.overdue, "due-today": today() }}>
      Due {today() ? "today" : formatDay(props.due)}
      <Show when={props.overdue}>, Overdue</Show>
    </span>
  );
}

/**
 * Each send of a Task's dates from the Journal is numbered, and an answer is placed only if no
 * later send's answer for that Task is placed already: one from before it would show the Task
 * without the later day (#162). The count is the Journal's, not an editor's: dates closed and
 * opened again are a new editor, and an answer to the first still lands.
 */
let dateSends = 0;
const datesPlaced = new Map<string, number>();

/**
 * A Task's Due Date and Defer Date, each set once it settles and cleared by emptying it. Kept or
 * refused, the field shows the day the server last said the Task has, once left (`SettlingField`).
 */
function TaskDatesEditor(props: {
  task: Task;
  onTask: (task: Task) => void;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  async function setDate(id: string, field: keyof TaskDates, day: string) {
    // biome-ignore lint/plugin: a write, not a read: latestRead() would drop an earlier answer once a later day is sent, though the later one may be refused, and send it again after a change.
    const mine = ++dateSends;
    try {
      const result = await callTool("set_task_dates", { id, [field]: day === "" ? null : day });
      if (!result.ok) return props.onProblem(result.error.message);
      if (mine < (datesPlaced.get(id) ?? 0)) return;
      datesPlaced.set(id, mine);
      props.onTask(result.value.record);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    }
  }

  // The Task the fields are for, as they are drawn: a day sent once they are gone is still its.
  const id = props.task.id;
  const field = (name: keyof TaskDates, label: string) => (
    <label class="task-date">
      {label}
      <SettlingField
        type="date"
        value={props.task[name]}
        onSettle={(day) => setDate(id, name, day)}
      />
    </label>
  );

  return (
    <div class="task-dates">
      {field("due_date", "Due Date")}
      {field("defer_date", "Defer Date")}
    </div>
  );
}

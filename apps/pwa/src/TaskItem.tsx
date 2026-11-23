import { type Day, type Task, type TaskDates, utcMidnight, waitedOnName } from "@praxis/domain";
import Calendar from "lucide-solid/icons/calendar";
import { createMemo, createSignal, type JSX, Show } from "solid-js";
import { todayIn } from "./days.tsx";
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
  onProblem: (message: string) => void;
}) {
  const [editingDates, setEditingDates] = createSignal(false);
  const finishing = createFinishing({
    task: () => props.task,
    onTask: props.onTask,
    onProblem: props.onProblem,
  });

  async function toggle(box: HTMLInputElement) {
    await finishing.setFinished(box.checked);
    // Whatever the answer, the box shows the Task as the server last said it is, or finished
    // Unsent on this Device.
    box.checked = finishing.shownFinished();
  }

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
          onChange={(event) => void toggle(event.currentTarget)}
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

/** What finishing a Task where it is shown needs of it: its title and where it stands. */
type Finishable = Pick<Task, "id" | "title" | "state">;

/**
 * Finishing and reopening a Task from where it is shown, by its round control, through the tools
 * Attention uses: with no network a finish is kept Unsent, and a finish still Unsent is undone on
 * the Device. What the server says of the Task after is given to `onTask`.
 */
export function createFinishing(props: {
  task: () => Finishable;
  onTask: (task: Task) => void;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  const contextId = useContextId();
  const [sending, setSending] = createSignal(false);
  const finished = () => props.task().state.is === "finished";
  // Finished on this Device and not yet sent; one the server refused is shown in Attention instead.
  const unsentFinish = () => unsentFinishOf(props.task().id);
  const shownFinished = () => finished() || unsentFinish() !== null;

  async function setFinished(finish: boolean): Promise<void> {
    // A finish still Unsent is undone on the Device, with no trace (section 8.8).
    const unsent = unsentFinish();
    if (unsent) return discardUnsent(unsent.id);
    const task = props.task();
    setSending(true);
    try {
      if (finish) {
        // With no network the finish is kept Unsent, and the Task shows it.
        const outcome = await finishTask(contextId, task);
        if (outcome.kind === "refused") return props.onProblem(outcome.message);
        if (outcome.kind === "made") props.onTask(outcome.value);
        return;
      }
      const result = await callTool("reopen_task", { id: task.id });
      if (!result.ok) return props.onProblem(result.error.message);
      // What a rule did besides, releasing a Task waiting on it or making the next Occurrence,
      // comes over the live channel.
      props.onTask(result.value.record);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  return {
    sending,
    /** Finished, on the server or Unsent on this Device. */
    shownFinished,
    dropped: () => props.task().state.is === "dropped",
    /** At an end, or finished Unsent: drawn muted. */
    closed: () => props.task().state.is !== "open" || unsentFinish() !== null,
    setFinished,
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

/** A Task's Due Date and Defer Date, each set as it is picked and cleared by emptying it. */
function TaskDatesEditor(props: {
  task: Task;
  onTask: (task: Task) => void;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  async function setDate(field: keyof TaskDates, input: HTMLInputElement) {
    try {
      const result = await callTool("set_task_dates", {
        id: props.task.id,
        [field]: input.value === "" ? null : input.value,
      });
      if (!result.ok) return props.onProblem(result.error.message);
      props.onTask(result.value.record);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      // Whatever the answer, the field shows the day the server last said the Task has.
      input.value = props.task[field] ?? "";
    }
  }

  const field = (name: keyof TaskDates, label: string) => (
    <label class="task-date">
      {label}
      <input
        type="date"
        value={props.task[name] ?? ""}
        onChange={(event) => void setDate(name, event.currentTarget)}
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

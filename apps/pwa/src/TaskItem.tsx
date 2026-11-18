import { type Day, type Task, type TaskDates, utcMidnight, waitedOnName } from "@praxis/domain";
import { createMemo, createSignal, type JSX, Show } from "solid-js";
import { unreachableMessage, useCallTool } from "./tools.ts";

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
  const callTool = useCallTool();
  const [sending, setSending] = createSignal(false);
  const [editingDates, setEditingDates] = createSignal(false);
  const finished = () => props.task.state.is === "finished";
  const dropped = () => props.task.state.is === "dropped";
  const open = () => (props.task.state.is === "open" ? props.task.state : null);
  const sinceFormat = createMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: props.timeZone }),
  );

  async function toggle(box: HTMLInputElement) {
    setSending(true);
    try {
      const tool = box.checked ? "finish_task" : "reopen_task";
      const result = await callTool(tool, { id: props.task.id });
      if (!result.ok) return props.onProblem(result.error.message);
      // What a rule did besides, releasing a Task waiting on it or making the next Occurrence,
      // comes over the live channel.
      props.onTask(result.value.record);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      // Whatever the answer, the box shows the Task as the server last said it is.
      box.checked = finished();
      setSending(false);
    }
  }

  return (
    <li
      class="task"
      id={props.anchor}
      tabIndex={props.anchor === undefined ? undefined : -1}
      classList={{ closed: props.task.state.is !== "open" }}
    >
      <label>
        <input
          type="checkbox"
          checked={finished()}
          disabled={sending() || dropped()}
          onChange={(event) => void toggle(event.currentTarget)}
        />
        <span class="task-title">{props.task.title}</span>
      </label>
      {props.mark}
      <Show when={dropped()}>
        <span class="task-mark">Dropped</span>
      </Show>
      <Show when={props.task.due_date}>
        {(due) => <DueMark due={due()} overdue={open()?.overdue != null} />}
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
      <button
        type="button"
        class="quiet"
        aria-expanded={editingDates()}
        onClick={() => setEditingDates((shown) => !shown)}
      >
        Dates
      </button>
      <Show when={editingDates()}>
        <TaskDatesEditor task={props.task} onTask={props.onTask} onProblem={props.onProblem} />
      </Show>
    </li>
  );
}

/** A Due Date, a Task's or a Project's, with Overdue marked on it. */
export function DueMark(props: { due: Day; overdue: boolean }) {
  return (
    <span class="task-mark" classList={{ overdue: props.overdue }}>
      Due {formatDay(props.due)}
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

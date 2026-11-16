import {
  type Day,
  type Entry,
  type Link,
  type Task,
  type TaskDates,
  utcMidnight,
  waitedOnName,
} from "@praxis/domain";
import { createSignal, For, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { Composer } from "./Composer.tsx";
import { Peer } from "./design/Peer.tsx";
import { callTool, unreachableMessage } from "./tools.ts";

/** A day as the Device's locale writes it. A day has no time zone of its own. */
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

function formatDay(day: Day): string {
  return dayFormat.format(utcMidnight(day));
}

/**
 * The Journal: Entries in time order, and the composer that records one with no model turn. Each
 * Entry's time is shown in the Context's time zone, so the Journal's days agree with today.
 */
export function Journal(props: { timeZone: string; contextName: string | undefined }) {
  const timeFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: props.timeZone,
  });
  // Oldest first, as shown. `list_entries` gives newest first, a page at a time. A store, so a
  // record that changes is patched in place and what is open on it stays open.
  const [entries, setEntries] = createStore<Entry[]>([]);
  const [earlierCursor, setEarlierCursor] = createSignal<string | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);

  async function loadPage(cursor?: string) {
    try {
      const result = await callTool("list_entries", cursor === undefined ? {} : { cursor });
      if (!result.ok) return setProblem(result.error.message);
      setEntries((shown) => [...result.value.items.toReversed(), ...shown]);
      setEarlierCursor(result.value.next_cursor);
    } catch (error) {
      setProblem(unreachableMessage(error));
    }
  }

  onMount(() => loadPage());

  /**
   * Show a Task as a write returned it, on the Entry it hangs off: in its place, or after the
   * others when a rule made it, as a Recurrence makes the next Occurrence on the same Entry.
   */
  function showTask(task: Task) {
    setProblem(null);
    const onEntry = (entry: Entry) => entry.id === task.origin_entry;
    const shown = entries.find(onEntry)?.tasks.some((each) => each.id === task.id);
    // Patched in place, so what is open on it stays open.
    if (shown) setEntries(onEntry, "tasks", (each) => each.id === task.id, task);
    else setEntries(onEntry, "tasks", (tasks) => [...tasks, task]);
  }

  return (
    <Peer id="journal" title="Journal">
      <div class="peer-body">
        <Show when={earlierCursor()}>
          {(cursor) => (
            <button type="button" class="quiet" onClick={() => loadPage(cursor())}>
              Show earlier Entries
            </button>
          )}
        </Show>
        <ol class="entry-list" aria-label="Entries">
          <For each={entries}>
            {(entry) => (
              <EntryItem
                entry={entry}
                time={timeFormat.format(new Date(entry.at))}
                onTask={showTask}
                onProblem={setProblem}
              />
            )}
          </For>
        </ol>
      </div>
      <div class="peer-foot">
        <Show when={problem()}>
          {(message) => (
            <p class="problem" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Composer
          contextName={props.contextName}
          onRecorded={(entry) => {
            setProblem(null);
            setEntries((shown) => [...shown, entry]);
          }}
          onProblem={setProblem}
        />
      </div>
    </Peer>
  );
}

function EntryItem(props: {
  entry: Entry;
  /** When it was made, as shown in the Context's time zone. */
  time: string;
  onTask: (task: Task) => void;
  onProblem: (message: string) => void;
}) {
  return (
    <li class="entry" data-testid="entry">
      <time class="entry-time" datetime={props.entry.at}>
        {props.time}
      </time>
      <p class="entry-words" data-testid="words">
        {props.entry.words}
      </p>
      <Show when={props.entry.links.length > 0}>
        <ul class="link-list" aria-label="Mentions and References">
          <For each={props.entry.links}>{(link) => <LinkItem link={link} />}</For>
        </ul>
      </Show>
      <Show when={props.entry.tasks.length > 0}>
        <ul class="task-list" aria-label="Tasks">
          <For each={props.entry.tasks}>
            {(task) => <TaskItem task={task} onTask={props.onTask} onProblem={props.onProblem} />}
          </For>
        </ul>
      </Show>
    </li>
  );
}

/** A Mention, a tinted pill, or a Reference, an inset pill, kept beside the Entry's words. */
function LinkItem(props: { link: Link }) {
  return (
    <li class="link" classList={{ [props.link.kind]: true }}>
      {props.link.kind === "mention" ? "@" : "#"}
      {props.link.to.summary}
    </li>
  );
}

/**
 * A Task where it is shown, finished or reopened from there by its checkbox. Each state that
 * holds is its own mark, and Overdue is marked on the date.
 */
function TaskItem(props: {
  task: Task;
  onTask: (task: Task) => void;
  onProblem: (message: string) => void;
}) {
  const [sending, setSending] = createSignal(false);
  const [editingDates, setEditingDates] = createSignal(false);
  const finished = () => props.task.state.is === "finished";
  const dropped = () => props.task.state.is === "dropped";
  const open = () => (props.task.state.is === "open" ? props.task.state : null);

  async function toggle(box: HTMLInputElement) {
    setSending(true);
    try {
      const tool = box.checked ? "finish_task" : "reopen_task";
      const result = await callTool(tool, { id: props.task.id });
      if (!result.ok) return props.onProblem(result.error.message);
      props.onTask(result.value.record);
      // A Task reaching an end releases each Task waiting on it and makes its next Occurrence,
      // by rule: show those as they now are too, until live updates (section 9.5) bring them.
      for (const effect of result.value.effects) {
        if (effect.kind !== "task" || effect.id === props.task.id) continue;
        const other = await callTool("get_task", { id: effect.id });
        if (!other.ok) return props.onProblem(other.error.message);
        props.onTask(other.value);
      }
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      // Whatever the answer, the box shows the Task as the server last said it is.
      box.checked = finished();
      setSending(false);
    }
  }

  return (
    <li class="task" classList={{ closed: props.task.state.is !== "open" }}>
      <label>
        <input
          type="checkbox"
          checked={finished()}
          disabled={sending() || dropped()}
          onChange={(event) => void toggle(event.currentTarget)}
        />
        <span class="task-title">{props.task.title}</span>
      </label>
      <Show when={dropped()}>
        <span class="task-mark">Dropped</span>
      </Show>
      <Show when={props.task.due_date}>
        {(due) => (
          <span class="task-mark" classList={{ overdue: open()?.overdue != null }}>
            Due {formatDay(due())}
            <Show when={open()?.overdue}>, Overdue</Show>
          </span>
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
        {(delegated) => <span class="task-mark">Delegated to {delegated().to.name}</span>}
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

/** A Task's Due Date and Defer Date, each set as it is picked and cleared by emptying it. */
function TaskDatesEditor(props: {
  task: Task;
  onTask: (task: Task) => void;
  onProblem: (message: string) => void;
}) {
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

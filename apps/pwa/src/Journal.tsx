import { type Entry, inlineTasks, type Task } from "@praxis/domain";
import { createSignal, For, onMount, Show } from "solid-js";
import { callTool, Unreachable } from "./tools.ts";

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The Journal: Entries in time order, and the composer that records one with no model turn. */
export function Journal() {
  // Oldest first, as shown. `list_entries` gives newest first, a page at a time.
  const [entries, setEntries] = createSignal<Entry[]>([]);
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

  /** Show a Task as a write returned it, on the Entry it hangs off. */
  function showTask(task: Task) {
    setProblem(null);
    setEntries((shown) =>
      shown.map((entry) =>
        entry.id === task.origin_entry
          ? { ...entry, tasks: entry.tasks.map((each) => (each.id === task.id ? task : each)) }
          : entry,
      ),
    );
  }

  return (
    <section class="journal" aria-labelledby="journal-heading">
      <h1 id="journal-heading" class="column-heading">
        Journal
      </h1>
      <div class="entries">
        <Show when={earlierCursor()}>
          {(cursor) => (
            <button type="button" class="quiet" onClick={() => loadPage(cursor())}>
              Show earlier Entries
            </button>
          )}
        </Show>
        <ol class="entry-list" aria-label="Entries">
          <For each={entries()}>
            {(entry) => <EntryItem entry={entry} onTask={showTask} onProblem={setProblem} />}
          </For>
        </ol>
      </div>
      <Composer
        onRecorded={(entry) => {
          setProblem(null);
          setEntries((shown) => [...shown, entry]);
        }}
        onProblem={setProblem}
      />
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </section>
  );
}

function EntryItem(props: {
  entry: Entry;
  onTask: (task: Task) => void;
  onProblem: (message: string) => void;
}) {
  return (
    <li class="entry" data-testid="entry">
      <time class="entry-time" datetime={props.entry.at}>
        {timeFormat.format(new Date(props.entry.at))}
      </time>
      <p class="entry-words" data-testid="words">
        {props.entry.words}
      </p>
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

/** A Task where it is shown, finished or reopened from there by its checkbox. */
function TaskItem(props: {
  task: Task;
  onTask: (task: Task) => void;
  onProblem: (message: string) => void;
}) {
  const [sending, setSending] = createSignal(false);
  const finished = () => props.task.state.is === "finished";
  const dropped = () => props.task.state.is === "dropped";

  async function toggle(box: HTMLInputElement) {
    setSending(true);
    try {
      const tool = box.checked ? "finish_task" : "reopen_task";
      const result = await callTool(tool, { id: props.task.id });
      if (!result.ok) return props.onProblem(result.error.message);
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
    </li>
  );
}

function Composer(props: {
  onRecorded: (entry: Entry) => void;
  onProblem: (message: string) => void;
}) {
  const [words, setWords] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const canRecord = () => !sending() && words().trim() !== "";

  async function record() {
    if (!canRecord()) return;
    setSending(true);
    try {
      // The editor finds the Inline Tasks; the server never reads words for them.
      const result = await callTool("record_entry", {
        words: words(),
        tasks: inlineTasks(words()),
      });
      if (!result.ok) return props.onProblem(result.error.message);
      props.onRecorded(result.value.record);
      setWords("");
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      class="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void record();
      }}
    >
      <label for="new-entry" class="visually-hidden">
        New Entry
      </label>
      <textarea
        id="new-entry"
        rows={3}
        placeholder="Write in the Journal"
        value={words()}
        onInput={(event) => setWords(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void record();
          }
        }}
      />
      <button type="submit" disabled={!canRecord()}>
        Record
      </button>
    </form>
  );
}

/** The message of a call that never reached a tool. Anything else is a fault, thrown on. */
function unreachableMessage(error: unknown): string {
  if (error instanceof Unreachable) return error.message;
  throw error;
}

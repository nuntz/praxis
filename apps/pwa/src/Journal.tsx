import type { Entry } from "@praxis/domain";
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
          <For each={entries()}>{(entry) => <EntryItem entry={entry} />}</For>
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

function EntryItem(props: { entry: Entry }) {
  return (
    <li class="entry">
      <time class="entry-time" datetime={props.entry.at}>
        {timeFormat.format(new Date(props.entry.at))}
      </time>
      <p class="entry-words" data-testid="words">
        {props.entry.words}
      </p>
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
      const result = await callTool("record_entry", { words: words() });
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

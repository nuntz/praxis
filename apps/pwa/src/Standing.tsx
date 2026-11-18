import { type Entry, STANDING_CEILING, standingSize } from "@praxis/domain";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { unreachableMessage, useCallTool } from "./tools.ts";
import { Words } from "./Words.tsx";

const characters = (count: number) => count.toLocaleString();

/**
 * The current Context's Standing Entries (section 8.6): the full list, newest first, with how much
 * of the ceiling they take. An Entry is marked standing from the Journal and unmarked from either.
 * It is read again on every change, since an edit, a delete or a restore can change it.
 */
export function Standing(props: { timeZone: string }) {
  const callTool = useCallTool();
  const live = useLive();
  const [entries, setEntries] = createSignal<Entry[] | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);
  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: props.timeZone,
  });
  const size = () => (entries() ?? []).reduce((sum, entry) => sum + standingSize(entry.words), 0);

  // A read overtaken by a later one is dropped, so the list shows the last the Context said.
  // Every page is read: the list is the full one, which the ceiling keeps short.
  const { read } = latestRead(async (current) => {
    try {
      const read: Entry[] = [];
      let cursor: string | null | undefined;
      do {
        const result = await callTool("list_entries", {
          standing: true,
          ...(cursor ? { cursor } : {}),
        });
        if (!current()) return;
        if (!result.ok) {
          setProblem(result.error.message);
          return;
        }
        read.push(...result.value.items);
        cursor = result.value.next_cursor;
      } while (cursor);
      setProblem(null);
      setEntries(read);
    } catch (error) {
      if (!current()) return;
      setProblem(unreachableMessage(error));
    }
  });

  onMount(async () => {
    await live.ready;
    await read();
  });
  onCleanup(live.listen({ changed: () => read(), readAfresh: () => read() }));

  async function unmark(id: string) {
    setSending(true);
    try {
      const result = await callTool("unmark_standing", { id });
      if (!result.ok) return setProblem(result.error.message);
      setProblem(null);
      await read();
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <section id="standing" class="settings" aria-labelledby="standing-heading">
      <h2 id="standing-heading" class="column-heading">
        Standing Entries
      </h2>
      <p class="settings-note">
        The Agent is given these at the start of every Run here, and keeps honouring them. When two
        disagree, the newer wins. Mark an Entry standing from the Journal.
      </p>
      <Show when={entries()}>
        {(listed) => (
          <Show
            when={listed().length > 0}
            fallback={<p class="settings-note">No Entry is standing.</p>}
          >
            <p class="settings-note" data-testid="standing-size">
              {characters(size())} of {characters(STANDING_CEILING)} characters
            </p>
            <ul class="standing-items" aria-label="Standing Entries">
              <For each={listed()}>
                {(entry) => (
                  <li class="standing-item" data-testid="standing-entry">
                    <time class="standing-day" datetime={entry.at}>
                      {dateFormat.format(new Date(entry.at))}
                    </time>
                    <Words words={entry.words} />
                    <div class="standing-actions">
                      <button
                        type="button"
                        class="quiet"
                        disabled={sending()}
                        onClick={() => void unmark(entry.id)}
                      >
                        Unmark
                      </button>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>
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

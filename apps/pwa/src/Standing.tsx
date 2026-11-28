import { type Entry, STANDING_CEILING, standingSize } from "@praxis/domain";
import { imageLoadingIn } from "@praxis/domain/markdown";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Problem } from "./design/SettingRows.tsx";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { contextCopy, readFromCopy } from "./offline-copy.ts";
import { online } from "./online.ts";
import { SettingsSection, sectionChanges } from "./SettingsSection.tsx";
import { Unreachable, unreachableMessage, useCallTool, useContextId } from "./tools.ts";
import { Words } from "./Words.tsx";

const characters = (count: number) => count.toLocaleString();

/**
 * The current Context's Standing Entries (section 8.6): the full list, newest first, with how much
 * of the ceiling they take. An Entry is marked standing from the Journal and unmarked from either.
 * It is read again on every change, since an edit, a delete or a restore can change it.
 */
export function Standing(props: { timeZone: string }) {
  const callTool = useCallTool();
  const contextId = useContextId();
  const live = useLive();
  const [entries, setEntries] = createSignal<Entry[] | null>(null);
  // What the last read met, said in place of the list it could not read.
  const [problem, setProblem] = createSignal<string | null>(null);
  const { change, sending, problemAt } = sectionChanges();
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
      // With no network the list is the Offline Copy's, as last fetched (section 8.8).
      const held = error instanceof Unreachable ? contextCopy(contextId) : null;
      if (held === null) return setProblem(unreachableMessage(error));
      setProblem(null);
      setEntries(held.standing);
    }
  });

  onMount(async () => {
    await live.ready;
    await read();
  });
  onCleanup(live.listen({ changed: () => read(), readAfresh: () => read() }));

  async function unmark(id: string) {
    if ((await change("standing", () => callTool("unmark_standing", { id }))) !== null) {
      await read();
    }
  }

  return (
    <SettingsSection note="The Agent is given these at the start of every Run here and keeps honouring them, the newer where two disagree. Mark an Entry standing from the Journal.">
      <Show when={!problem()} fallback={<Problem message={problem()} />}>
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
                      <Words
                        words={entry.words}
                        images={
                          online() && !readFromCopy(contextId) ? imageLoadingIn(entry) : "never"
                        }
                      />
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
              {/* #214 puts the list in a group's box, and this under it. */}
              <Problem message={problemAt("standing")} />
            </Show>
          )}
        </Show>
      </Show>
    </SettingsSection>
  );
}

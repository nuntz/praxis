import { type Entry, STANDING_CEILING, standingSize, type ToolResult } from "@praxis/domain";
import { imageLoadingIn } from "@praxis/domain/markdown";
import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import { Problem, SettingsGroup } from "./design/SettingRows.tsx";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { contextCopy, readFromCopy } from "./offline-copy.ts";
import { online } from "./online.ts";
import { listedCount, SettingsSection, sectionChanges } from "./SettingsSection.tsx";
import {
  type CallTool,
  Unreachable,
  unreachableMessage,
  useCallTool,
  useContextId,
} from "./tools.ts";
import { Words } from "./Words.tsx";

const characters = (count: number) => count.toLocaleString();

/**
 * The Context's Standing Entries, every page of them: the list is the full one, which the ceiling
 * keeps short. The first refusal answers for the whole read.
 */
async function readStanding(callTool: CallTool): Promise<ToolResult<Entry[]>> {
  const read: Entry[] = [];
  let cursor: string | null | undefined;
  do {
    const result = await callTool("list_entries", {
      standing: true,
      ...(cursor ? { cursor } : {}),
    });
    if (!result.ok) return result;
    read.push(...result.value.items);
    cursor = result.value.next_cursor;
  } while (cursor);
  return { ok: true, value: read };
}

/** How many Entries stand, as the phone's list of sections shows it, or null unread. */
export async function standingListed(callTool: CallTool): Promise<string | null> {
  const result = await readStanding(callTool);
  return result.ok ? listedCount(result.value.length) : null;
}

/**
 * The current Context's Standing Entries (section 8.6): the full list, newest first, with how much
 * of the ceiling they take. An Entry is marked standing from the Journal and unmarked from either.
 * It is read again on every change, since an edit, a delete or a restore can change it.
 */
export function Standing(props: {
  timeZone: string;
  /** The section's note in place of its own, as the Offline Copy's list says it needs the network. */
  note?: JSX.Element;
}) {
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
  const { read } = latestRead(async (current) => {
    try {
      const result = await readStanding(callTool);
      if (!current()) return;
      if (!result.ok) {
        setProblem(result.error.message);
        return;
      }
      setProblem(null);
      setEntries(result.value);
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
    <SettingsSection
      note={
        props.note ??
        "The Agent is given these at the start of every Run here and keeps honouring them, the newer where two disagree. Mark an Entry standing from the Journal."
      }
    >
      <Show when={!problem()} fallback={<Problem message={problem()} />}>
        <Show when={entries()}>
          {(listed) => (
            <>
              <Show when={listed().length > 0}>
                <p class="settings-note" data-testid="standing-size">
                  {characters(size())} of {characters(STANDING_CEILING)} characters
                </p>
              </Show>
              <SettingsGroup
                heading="Standing Entries"
                problem={problemAt("standing")}
                list={{
                  each: listed(),
                  empty: "No Entry is standing.",
                  row: (entry) => (
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
                  ),
                }}
              />
            </>
          )}
        </Show>
      </Show>
    </SettingsSection>
  );
}

import { type Author, type Entry, isHeld, type Version } from "@praxis/domain";
import { createEffect, createSignal, createUniqueId, For, on, onCleanup, Show } from "solid-js";
import { authorName } from "./authors.ts";
import { Comparison } from "./Comparison.tsx";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { online } from "./online.ts";
import { needsNetwork, unreachableMessage, useCallTool } from "./tools.ts";

/** How many Versions are shown at first, and how many more each "Show earlier Versions" shows. */
const SHOWN_AT_ONCE = 5;

/**
 * An Entry's Versions, newest first, each headed by whose change replaced its words and compared
 * from the current words to its own (section 3.2), shown as typed, never rendered (section 8.4).
 * Restoring one is a new change, made against the version shown.
 */
export function Versions(props: {
  entry: Entry;
  /** An instant with its date, in the Context's time zone. */
  formatWhen: (at: string) => string;
  /** The time of day of an instant, in the Context's time zone. */
  formatTime: (at: string) => string;
  onEntry: (entry: Entry) => void;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  const live = useLive();
  // Each Version's heading is named by this and its number, for its Restore to point at.
  const headingIds = createUniqueId();
  const [versions, setVersions] = createSignal<Version[]>([]);
  // Whether earlier Versions are still to be read, past those read.
  const [more, setMore] = createSignal(false);
  const [shown, setShown] = createSignal(SHOWN_AT_ONCE);
  const [sending, setSending] = createSignal(false);
  // Said in the box while the Versions could not be read: that they need the network.
  const [note, setNote] = createSignal<string | null>(null);
  // What the last restore did, under the Entry, which takes the focus once it is said.
  const [restored, setRestored] = createSignal<string | null>(null);
  let box!: HTMLElement;
  let line: HTMLParagraphElement | undefined;

  // Every read is from the newest, as far as is shown, so the last one sent is the list whole.
  const listed = latestRead(async (current) => {
    try {
      const read: Version[] = [];
      let cursor: string | null = null;
      do {
        const page: { id: string; cursor?: string } =
          cursor === null ? { id: props.entry.id } : { id: props.entry.id, cursor };
        const result = await callTool("list_entry_versions", page);
        if (!current()) return;
        if (!result.ok) return props.onProblem(result.error.message);
        read.push(...result.value.items);
        cursor = result.value.next_cursor;
      } while (cursor !== null && read.length < shown());
      setNote(null);
      setVersions(read);
      setMore(cursor !== null);
    } catch (error) {
      if (!current()) return;
      // An Entry's Versions are not in the Offline Copy (section 8.8).
      setNote(needsNetwork(error, "Versions need the network."));
    }
  });

  // Read again whenever the words change, here or anywhere, since each change makes a Version.
  createEffect(
    on(
      () => props.entry.version,
      () => void listed.read(),
    ),
  );
  // Read again once the network, and with it the live channel, is back.
  const again = () => {
    if (note() !== null) void listed.read();
  };
  onCleanup(live.listen({ rejoined: again }));
  createEffect(on(online, (now) => now && again(), { defer: true }));

  /** Five more, read first where fewer are read than are to be shown. */
  function showEarlier() {
    setShown((now) => now + SHOWN_AT_ONCE);
    if (versions().length < shown() && more()) void listed.read();
  }

  async function restore(version: Version) {
    if (sending()) return;
    setSending(true);
    try {
      const result = await callTool("restore_entry_version", {
        id: props.entry.id,
        restore: version.version,
        version: props.entry.version,
      });
      if (!result.ok) {
        return props.onProblem(
          result.error.code === "stale"
            ? "This Entry changed since its Versions were shown, so nothing was restored. Close the Versions and open them again to see them as they now are."
            : result.error.message,
        );
      }
      // A change by the person's own hand is never held.
      if (isHeld(result.value)) throw new Error("A change by hand was held");
      props.onEntry(result.value.record);
      setRestored(
        `Words restored to those before ${whose(version.changed.by)} change at ${props.formatTime(version.changed.at)}`,
      );
      // The Restore pressed is gone with the Versions read again, so the line takes the focus,
      // unless the person took it out of the Versions meanwhile.
      const at = document.activeElement;
      if (at === null || at === document.body || box.contains(at)) {
        queueMicrotask(() => line?.focus());
      }
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <section class="versions" aria-label="Versions" ref={box}>
        <Show when={note()}>{(said) => <p class="versions-note">{said()}</p>}</Show>
        <ol class="version-list">
          <For each={versions().slice(0, shown())}>
            {(version) => {
              const heading = `${headingIds}-${version.version}`;
              return (
                <li class="version" data-testid="version">
                  <h4 class="version-heading" id={heading}>
                    Before {whose(version.changed.by)} change,{" "}
                    {props.formatWhen(version.changed.at)}
                  </h4>
                  <Comparison now={props.entry.words} brought={version.words} />
                  <Show
                    when={version.words !== props.entry.words}
                    fallback={<p class="version-now">These are the words now</p>}
                  >
                    <button
                      type="button"
                      class="quiet"
                      // Only said to be disabled while a restore is out, so it keeps the focus.
                      aria-disabled={sending() ? "true" : undefined}
                      aria-describedby={heading}
                      onClick={() => void restore(version)}
                    >
                      Restore this Version
                    </button>
                  </Show>
                </li>
              );
            }}
          </For>
        </ol>
        <Show when={versions().length > shown() || more()}>
          <button type="button" class="quiet" onClick={showEarlier}>
            Show earlier Versions
          </button>
        </Show>
      </section>
      <Show when={restored()}>
        {(said) => (
          <p class="version-restored" role="status" tabIndex={-1} ref={line}>
            {said()}
          </p>
        )}
      </Show>
    </>
  );
}

/** Whose change replaced a Version's words, as the screen says it: "your", "the Agent's". */
function whose(author: Author): string {
  return author.kind === "person" ? "your" : `${authorName(author)}'s`;
}

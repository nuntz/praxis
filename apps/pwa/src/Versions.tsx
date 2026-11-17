import { compareWords, type Entry, type Version } from "@praxis/domain";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { authorName } from "./authors.ts";
import { unreachableMessage, useCallTool } from "./tools.ts";

/**
 * An Entry's Versions, newest first, each compared against the current words and shown as typed,
 * never rendered (section 8.4). Restoring one is a new change, made against the version shown.
 */
export function Versions(props: {
  entry: Entry;
  /** An instant as the Journal shows it, in the Context's time zone. */
  formatTime: (at: string) => string;
  onEntry: (entry: Entry) => void;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  const [versions, setVersions] = createSignal<Version[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);

  async function load(from?: string) {
    try {
      const result = await callTool(
        "list_entry_versions",
        from === undefined ? { id: props.entry.id } : { id: props.entry.id, cursor: from },
      );
      if (!result.ok) return props.onProblem(result.error.message);
      setVersions((shown) => [...(from === undefined ? [] : shown), ...result.value.items]);
      setCursor(result.value.next_cursor);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    }
  }

  // Read again whenever the words change, here or anywhere, since each change makes a Version.
  createEffect(
    on(
      () => props.entry.version,
      () => void load(),
    ),
  );

  async function restore(version: Version) {
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
      props.onEntry(result.value.record);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <section class="versions" aria-label="Versions">
      <ol class="version-list">
        <For each={versions()}>
          {(version) => (
            <li class="version" data-testid="version">
              <p class="version-meta">
                Changed by {authorName(version.changed.by)}, {props.formatTime(version.changed.at)}
              </p>
              <p class="version-words" data-testid="comparison">
                <For each={compareWords(version.words, props.entry.words)}>
                  {(part) =>
                    part.kind === "gone" ? (
                      <del>{part.text}</del>
                    ) : part.kind === "come" ? (
                      <ins>{part.text}</ins>
                    ) : (
                      <span>{part.text}</span>
                    )
                  }
                </For>
              </p>
              <button
                type="button"
                class="quiet"
                disabled={sending() || version.words === props.entry.words}
                onClick={() => void restore(version)}
              >
                Restore this Version
              </button>
            </li>
          )}
        </For>
      </ol>
      <Show when={cursor()}>
        {(from) => (
          <button type="button" class="quiet" onClick={() => void load(from())}>
            Show earlier Versions
          </button>
        )}
      </Show>
    </section>
  );
}

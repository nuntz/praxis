import type { RecordKind, RecordNamed, ToolResult, TrashItem } from "@praxis/domain";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { unreachableMessage, useCallTool } from "./tools.ts";

/** What each kind of record is called, in the glossary's words. */
const KIND: Record<RecordKind, string> = {
  entry: "Entry",
  task: "Task",
  project: "Project",
  person: "Person",
};

/** Said wherever something is removed for good: a file the person downloaded is out of reach. */
export const DOWNLOADED =
  "Praxis cannot reach a file you downloaded, such as an Export: what is removed here stays in it.";

/**
 * The current Context's Trash (section 8.6): each item, what went with it and when it will be
 * removed for good. An item is restored, or removed for good, whole; emptying the Trash removes
 * every item. It is read again on every change, since any delete, restore or removal changes it.
 */
export function Trash(props: { timeZone: string }) {
  const callTool = useCallTool();
  const live = useLive();
  const [items, setItems] = createSignal<TrashItem[] | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);
  const dateFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: props.timeZone,
  });

  // A read overtaken by a later one is dropped, so the list shows the last the Context said.
  const { read } = latestRead(async (current) => {
    try {
      const result = await callTool("list_trash", {});
      if (!current()) return;
      if (!result.ok) {
        setProblem(result.error.message);
        return;
      }
      setItems(result.value.items);
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

  async function send(call: () => Promise<ToolResult<unknown>>) {
    setSending(true);
    try {
      const result = await call();
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
    <section id="trash" class="settings" aria-labelledby="trash-heading">
      <h2 id="trash-heading" class="column-heading">
        Trash
      </h2>
      <p class="settings-note">
        What is deleted stays here 30 days, then it is removed for good. Restoring it brings back
        everything that went with it.
      </p>
      <Show when={items()}>
        {(listed) => (
          <Show
            when={listed().length > 0}
            fallback={<p class="settings-note">The Trash is empty.</p>}
          >
            <ul class="trash-items" aria-label="In the Trash">
              <For each={listed()}>
                {(item) => (
                  <li class="trash-item" data-testid="trash-item">
                    <p class="trash-record">
                      <span class="trash-kind">{KIND[item.record.kind]}</span> {item.record.summary}
                    </p>
                    <Show when={item.went_with.length > 0}>
                      <p class="settings-note">
                        With it: <WentWith records={item.went_with} />
                      </p>
                    </Show>
                    <p class="settings-note">
                      Removed for good on {dateFormat.format(new Date(item.removed_at))}
                    </p>
                    <div class="trash-actions">
                      <button
                        type="button"
                        disabled={sending()}
                        onClick={() => void send(() => callTool("restore", { id: item.record.id }))}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        class="quiet"
                        disabled={sending()}
                        onClick={() =>
                          void send(() => callTool("remove_for_good", { id: item.record.id }))
                        }
                      >
                        Remove for good
                      </button>
                    </div>
                  </li>
                )}
              </For>
            </ul>
            <p class="settings-note">{DOWNLOADED}</p>
            <button
              type="button"
              class="quiet"
              disabled={sending()}
              onClick={() => void send(() => callTool("empty_trash", {}))}
            >
              Empty the Trash
            </button>
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

/** What went with a deleted record, each named by its kind and its summary. */
function WentWith(props: { records: RecordNamed[] }) {
  return (
    <For each={props.records}>
      {(record, index) => (
        <>
          {index() > 0 && "; "}
          {KIND[record.kind]} {record.summary}
        </>
      )}
    </For>
  );
}

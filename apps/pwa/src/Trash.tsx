import type { RecordKind, RecordNamed, TrashItem } from "@praxis/domain";
import { createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show } from "solid-js";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import {
  type CallTool,
  needsNetwork,
  SignInLapsed,
  Unreachable,
  unreachableMessage,
  useCallTool,
} from "./tools.ts";

/** What each kind of record is called, in the glossary's words, one and many. */
const KIND: Record<RecordKind, string> = {
  entry: "Entry",
  task: "Task",
  project: "Project",
  person: "Person",
};
const KIND_PLURAL: Record<RecordKind, string> = {
  entry: "Entries",
  task: "Tasks",
  project: "Projects",
  person: "Persons",
};

/** Said wherever something is removed for good: a file the person downloaded is out of reach. */
export const DOWNLOADED =
  "Praxis cannot reach a file you downloaded, such as an Export: what is removed here stays in it.";

/**
 * Said beside it in the Trash (section 3.8): the Conversation keeps what the Agent quoted of a
 * record removed for good, dropped only when the person clears it, whole.
 */
const QUOTED =
  "The Conversation keeps what the Agent quoted of a record removed here until you clear it, in this Context's settings.";

/** Said by the screen when the removals marked could not be sent as the Trash was left (ADR 0027). */
export const NOTHING_REMOVED = "Praxis could not be reached: nothing was removed for good.";

/** Said when only some of them could be. */
const NOT_ALL_REMOVED =
  "Praxis could not be reached: some of what you marked was not removed for good.";

/** How an item is marked to be removed for good on leaving: by emptying the Trash, by itself, or not. */
type Mark = "emptying" | "one" | null;

/** What a restore said, standing where its item was: before the item that followed it, or last. */
type Said = { said: string; before: string | null };

/**
 * The current Context's Trash (section 8.6): each item, what went with it and when it will be
 * removed for good, read a page at a time. An item is restored whole. Removing one for good, or
 * emptying the Trash, only marks what would go, and the removals are sent when the Trash is left
 * (ADR 0027): by another section of Settings, by closing Settings or by switching Context, never
 * by the app being hidden. Each is the person's to take back meanwhile. The list is read again on
 * every change, since any delete, restore or removal changes it.
 */
export function Trash(props: {
  timeZone: string;
  /** Says what the screen must say once the Trash is no longer shown to say it. */
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  const live = useLive();
  const [items, setItems] = createSignal<TrashItem[] | null>(null);
  /** The cursor to the earlier items, or null once every one is shown. */
  const [earlierFrom, setEarlierFrom] = createSignal<string | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  /** The record id of the item whose restore is out, if one is. */
  const [restoring, setRestoring] = createSignal<string | null>(null);
  /** The items marked to be removed for good on leaving, by their record's id. */
  const [marked, setMarked] = createSignal<ReadonlySet<string>>(new Set());
  /** While the Trash is to be emptied on leaving: the `deleted_at` of the newest item it showed. */
  const [emptyingUpTo, setEmptyingUpTo] = createSignal<string | null>(null);
  const [said, setSaid] = createSignal<Said | null>(null);
  const dates = {
    deleted: new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      timeZone: props.timeZone,
    }),
    stays: new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: props.timeZone,
    }),
  };

  /**
   * Read the newest items afresh, as many pages as were shown, or the next page of earlier ones.
   * A read overtaken by a later one is dropped, so the list shows the last the Context said.
   */
  const listed = latestRead(async (current, earlier: boolean) => {
    const shown = items() ?? [];
    let cursor = earlier ? earlierFrom() : null;
    if (earlier && cursor === null) return;
    const read: TrashItem[] = earlier ? [...shown] : [];
    try {
      do {
        const result = await callTool("list_trash", cursor === null ? {} : { cursor });
        if (!current()) return;
        if (!result.ok) return setProblem(result.error.message);
        read.push(...result.value.items);
        cursor = result.value.next_cursor;
      } while (!earlier && cursor !== null && read.length < shown.length);
      setItems(keptAsShown(shown, read));
      setEarlierFrom(cursor);
    } catch (error) {
      if (!current()) return;
      setProblem(needsNetwork(error, "The Trash needs the network."));
    }
  });

  onMount(async () => {
    await live.ready;
    await listed.read(false);
  });
  onCleanup(
    live.listen({ changed: () => listed.read(false), readAfresh: () => listed.read(false) }),
  );
  // Leaving the Trash sends what it marked; the app hidden or killed sends nothing.
  onCleanup(() => {
    const upTo = emptyingUpTo();
    const markedOneByOne = (items() ?? [])
      .filter((item) => marked().has(item.record.id) && (upTo === null || item.deleted_at > upTo))
      .map((item) => item.record.id);
    if (upTo !== null || markedOneByOne.length > 0) {
      void removeOnLeaving(callTool, upTo, markedOneByOne, props.onProblem);
    }
  });

  /** How an item is marked to be removed for good on leaving: by emptying, by itself, or not. */
  function markOf(item: TrashItem): Mark {
    const upTo = emptyingUpTo();
    if (upTo !== null && item.deleted_at <= upTo) return "emptying";
    return marked().has(item.record.id) ? "one" : null;
  }

  function setMark(id: string, on: boolean) {
    setSaid(null);
    setMarked((was) => {
      const now = new Set(was);
      if (on) now.add(id);
      else now.delete(id);
      return now;
    });
  }

  /**
   * Bring an item back, whole. What it brought back is said where it stood, and takes the focus;
   * a refusal leaves the focus on Restore, with the problem said.
   */
  async function restore(item: TrashItem) {
    // Pressed again while one is on its way, it asks nothing more.
    if (restoring() !== null) return;
    setSaid(null);
    setRestoring(item.record.id);
    try {
      const result = await callTool("restore", { id: item.record.id });
      if (!result.ok) return setProblem(result.error.message);
      setProblem(null);
      const shown = items() ?? [];
      const at = shown.findIndex((each) => each.record.id === item.record.id);
      setMarked((was) => new Set([...was].filter((id) => id !== item.record.id)));
      setItems(shown.filter((each) => each.record.id !== item.record.id));
      setSaid({
        said: restoredWords(result.value.record),
        before: shown[at + 1]?.record.id ?? null,
      });
      document.getElementById(saidId)?.focus();
      // A read still out answers from before the restore, so it is sent again.
      listed.changed();
      void listed.read(false);
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setRestoring(null);
    }
  }

  const saidId = createUniqueId();
  const emptyingId = createUniqueId();
  let emptyButton: HTMLButtonElement | undefined;
  let keepThemButton: HTMLButtonElement | undefined;

  /** The rows: each item, and what a restore said where the item it brought back stood. */
  const rows = createMemo(() => {
    const shown = items() ?? [];
    const line = said();
    if (line === null) return shown;
    const at =
      line.before === null ? -1 : shown.findIndex((each) => each.record.id === line.before);
    const index = at === -1 ? shown.length : at;
    return [...shown.slice(0, index), line, ...shown.slice(index)];
  });

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
        {(listedItems) => (
          <>
            <Show when={emptyingUpTo() !== null && listedItems().length > 0}>
              <p class="trash-emptying">
                <span id={emptyingId}>
                  Everything in the Trash now is removed for good when you leave the Trash.
                </span>{" "}
                <button
                  ref={keepThemButton}
                  type="button"
                  class="quiet"
                  aria-describedby={emptyingId}
                  onClick={() => {
                    setSaid(null);
                    setEmptyingUpTo(null);
                    setMarked(new Set<string>());
                    emptyButton?.focus();
                  }}
                >
                  Keep them
                </button>
              </p>
            </Show>
            <Show when={rows().length > 0}>
              <ul class="trash-items" aria-label="In the Trash">
                <For each={rows()}>
                  {(row) =>
                    "said" in row ? (
                      <li class="trash-said">
                        <p id={saidId} role="status" tabindex="-1">
                          {row.said}
                        </p>
                      </li>
                    ) : (
                      <TrashRow
                        item={row}
                        dates={dates}
                        mark={markOf(row)}
                        restoring={restoring() === row.record.id}
                        onRestore={() => void restore(row)}
                        onMark={(on) => setMark(row.record.id, on)}
                      />
                    )
                  }
                </For>
              </ul>
            </Show>
            <Show
              when={listedItems().length > 0}
              fallback={<p class="settings-note">The Trash is empty.</p>}
            >
              <Show when={earlierFrom() !== null}>
                <button
                  type="button"
                  class="quiet"
                  onClick={() => {
                    setSaid(null);
                    void listed.read(true);
                  }}
                >
                  Show earlier
                </button>
              </Show>
              <p class="settings-note">{DOWNLOADED}</p>
              <p class="settings-note">{QUOTED}</p>
              <Show when={emptyingUpTo() === null}>
                <button
                  ref={emptyButton}
                  type="button"
                  class="quiet"
                  onClick={() => {
                    // Up to the newest delete shown: one made after it, unseen, stays.
                    const newest = listedItems()[0];
                    if (!newest) return;
                    setSaid(null);
                    setEmptyingUpTo(newest.deleted_at);
                    keepThemButton?.focus();
                  }}
                >
                  Empty the Trash
                </button>
              </Show>
            </Show>
          </>
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

/**
 * One item: what was deleted, Restore, what went with it and when, and at the row's end, apart
 * from Restore, Remove for good or the mark that it will be. Each act is described by the record
 * line, so a list of buttons tells them apart.
 */
function TrashRow(props: {
  item: TrashItem;
  dates: { deleted: Intl.DateTimeFormat; stays: Intl.DateTimeFormat };
  mark: Mark;
  /** Whether this item's restore is out. */
  restoring: boolean;
  onRestore: () => void;
  onMark: (on: boolean) => void;
}) {
  const recordId = createUniqueId();
  const markId = createUniqueId();
  let removeButton: HTMLButtonElement | undefined;
  let keepButton: HTMLButtonElement | undefined;
  return (
    <li class="trash-item" data-testid="trash-item">
      <div class="trash-words">
        <p class="trash-record" id={recordId}>
          <span class="trash-kind">{KIND[props.item.record.kind]}</span> {props.item.record.summary}
        </p>
        <button
          type="button"
          class="quiet"
          // Only said to be disabled while a restore is out, so it keeps the focus.
          aria-disabled={props.restoring}
          aria-describedby={recordId}
          onClick={() => {
            if (!props.restoring) props.onRestore();
          }}
        >
          Restore
        </button>
        <Show when={props.item.went_with.length > 0}>
          <p class="settings-note">
            With it: <WentWith records={props.item.went_with} />
          </p>
        </Show>
        <p class="settings-note">
          Deleted {props.dates.deleted.format(new Date(props.item.deleted_at))} · Stays until{" "}
          {props.dates.stays.format(new Date(props.item.removed_at))}
        </p>
      </div>
      <div class="trash-removal">
        <Show
          when={props.mark !== null}
          fallback={
            <button
              ref={removeButton}
              type="button"
              class="quiet"
              aria-describedby={recordId}
              onClick={() => {
                props.onMark(true);
                keepButton?.focus();
              }}
            >
              Remove for good
            </button>
          }
        >
          <p class="trash-marked">
            <span id={markId}>Removed for good when you leave the Trash</span>
            {/* Marked by emptying, only Keep them takes it back. */}
            <Show when={props.mark === "one"}>
              {" "}
              <button
                ref={keepButton}
                type="button"
                class="quiet"
                aria-describedby={`${markId} ${recordId}`}
                onClick={() => {
                  props.onMark(false);
                  removeButton?.focus();
                }}
              >
                Keep it
              </button>
            </Show>
          </p>
        </Show>
      </div>
    </li>
  );
}

/**
 * Send what the Trash marked, as it is left. A removal that cannot be sent removes nothing, and
 * the screen says so; one whose item has left the Trash meanwhile, restored or past its 30 days,
 * is not found and says nothing, since what is so already holds.
 */
async function removeOnLeaving(
  callTool: CallTool,
  upTo: string | null,
  markedOneByOne: string[],
  onProblem: (message: string) => void,
) {
  const sent = await Promise.allSettled([
    ...(upTo === null ? [] : [callTool("empty_trash", { up_to: upTo })]),
    ...markedOneByOne.map((id) => callTool("remove_for_good", { id })),
  ]);
  const unreached = sent.filter(
    (each) => each.status === "rejected" && each.reason instanceof Unreachable,
  ).length;
  if (unreached > 0) onProblem(unreached === sent.length ? NOTHING_REMOVED : NOT_ALL_REMOVED);
  for (const each of sent) {
    if (each.status === "fulfilled") {
      if (!each.value.ok && each.value.error.code !== "not_found") {
        onProblem(each.value.error.message);
      }
    } else if (!(each.reason instanceof Unreachable || each.reason instanceof SignInLapsed)) {
      // A lapsed sign-in says so on the screen already; anything else is a fault.
      throw each.reason;
    }
  }
}

/** What a restore brought back, as said where it stood: "“Paint the hall” and 2 Tasks are back…". */
function restoredWords(item: TrashItem): string {
  const { kind, summary } = item.record;
  const named = kind === "entry" || kind === "task" ? `“${summary}”` : summary;
  const counted = new Map<RecordKind, number>();
  for (const record of item.went_with)
    counted.set(record.kind, (counted.get(record.kind) ?? 0) + 1);
  const parts = [
    named,
    ...[...counted].map(([of, n]) => `${n} ${n === 1 ? KIND[of] : KIND_PLURAL[of]}`),
  ];
  const which = new Intl.ListFormat("en", { type: "conjunction" }).format(parts);
  const where = kind === "entry" || kind === "task" ? " in the Journal" : "";
  return `${which} ${parts.length === 1 ? "is" : "are"} back${where}.`;
}

/**
 * The items as read, each kept as the object already shown where it reads the same, so a row the
 * person has the focus in stays the element it was.
 */
function keptAsShown(shown: TrashItem[], read: TrashItem[]): TrashItem[] {
  const byId = new Map(shown.map((item) => [item.record.id, item]));
  return read.map((item) => {
    const was = byId.get(item.record.id);
    return was && JSON.stringify(was) === JSON.stringify(item) ? was : item;
  });
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

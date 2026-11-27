import {
  type Effect,
  type Entry,
  type EntryNamed,
  type Link,
  summarizeWords,
  type Task,
} from "@praxis/domain";
import { imageLoadingIn } from "@praxis/domain/markdown";
import ArrowRightLeft from "lucide-solid/icons/arrow-right-left";
import CornerDownRight from "lucide-solid/icons/corner-down-right";
import ListPlus from "lucide-solid/icons/list-plus";
import Pencil from "lucide-solid/icons/pencil";
import Pin from "lucide-solid/icons/pin";
import Trash from "lucide-solid/icons/trash";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { authorName } from "./authors.ts";
import { Composer } from "./Composer.tsx";
import { dayAndTimeIn, partIntoDays } from "./days.tsx";
import { PeerBody } from "./design/Peer.tsx";
import { EntryActions } from "./EntryActions.tsx";
import { EntryPage } from "./EntryPage.tsx";
import { followNewest } from "./follow-newest.tsx";
import { heldAnchor, useHeldChanges } from "./HeldChanges.tsx";
import { JOURNAL_COMPOSER } from "./keys.tsx";
import { useLive } from "./live-context.ts";
import { MoveRecord } from "./Move.tsx";
import { contextCopy, noteOpened, readFromCopy, readingCopy } from "./offline-copy.ts";
import { online } from "./online.ts";
import { createSearch } from "./Search.tsx";
import type { UnsentEntry } from "./stored.ts";
import { TaskItem } from "./TaskItem.tsx";
import {
  needsNetwork,
  Unreachable,
  unreachableMessage,
  useCallTool,
  useContextId,
} from "./tools.ts";
import { UnsentEntryItem, unsentEntriesIn } from "./Unsent.tsx";
import { onSent } from "./unsent.ts";
import { Versions } from "./Versions.tsx";
import { Words } from "./Words.tsx";

/** Where a record shown in the Journal is, for a link to it from elsewhere on the screen. */
export function recordAnchor(kind: "entry" | "task", id: string): string {
  return `${kind}-${id}`;
}

/**
 * The Journal: Entries in time order, and the composer that records one with no model turn. Each
 * Entry's time is shown in the Context's time zone, so the Journal's days agree with today. What
 * its column holds; the column itself is the screen's, so it stays while a new zone is read.
 */
export function Journal(props: {
  timeZone: string;
  contextName: string | undefined;
  /** Bring a Held Change into view in Attention, by its anchor there. */
  onShowHeldChange: (anchor: string) => void;
  /** Hands over the way to bring an Entry into view, for one opened from elsewhere on the screen. */
  giveToEntry: (toEntry: (id: string) => void) => void;
}) {
  const callTool = useCallTool();
  const contextId = useContextId();
  const live = useLive();
  // An instant as the Context's zone tells it: with its date where nothing else says the day, as
  // in an Entry's Versions, and the time of day alone under a day's caption.
  const timeFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: props.timeZone,
  });
  const timeOfDay = new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
    timeZone: props.timeZone,
  });
  // Oldest first, as shown. `list_entries` gives newest first, a page at a time. A store, so a
  // record that changes is patched in place and what is open on it stays open.
  const [entries, setEntries] = createStore<Entry[]>([]);
  const [earlierCursor, setEarlierCursor] = createSignal<string | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  // What the screen last told the person under the Journal: what a move did, once its Entry has
  // left the Journal (section 3.9), or what an Entry kept Unsent left off (section 8.8).
  const [told, setTold] = createSignal<string | null>(null);
  // The Entry the composer's next Entry is a Follow-up to, if the person chose one.
  const [followingUp, setFollowingUp] = createSignal<EntryNamed | null>(null);
  // Whether the Entries shown are the Offline Copy's, as no network let them be read.
  const [fromCopy, setFromCopy] = createSignal(false);
  // Whether the newest page has been read from Praxis, so a Journal with nothing in it can say so,
  // and one not yet read does not.
  const [newestRead, setNewestRead] = createSignal(false);

  async function loadPage(cursor?: string) {
    try {
      const result = await callTool("list_entries", cursor === undefined ? {} : { cursor });
      if (!result.ok) return setProblem(result.error.message);
      // An Entry the live channel brought while the page was read is shown once. An earlier page
      // goes above, keeping what is in view where it was.
      const show = () =>
        setEntries((shown) => {
          const page = result.value.items.filter((read) => !shown.some((e) => e.id === read.id));
          return [...page.toReversed(), ...shown];
        });
      if (cursor === undefined) {
        show();
        setNewestRead(true);
      } else column.keepPlace(show);
      setEarlierCursor(result.value.next_cursor);
    } catch (error) {
      // With no network the Journal is the Offline Copy's, as last fetched (section 8.8): the
      // last 30 days and the older Entries this Device opened. Older ones need the network.
      const held = error instanceof Unreachable && cursor === undefined && contextCopy(contextId);
      if (!held) {
        return setProblem(
          cursor === undefined
            ? unreachableMessage(error)
            : needsNetwork(error, "Older Entries need the network."),
        );
      }
      setEntries(held.entries.toReversed());
      setEarlierCursor(null);
      setFromCopy(true);
      readingCopy(contextId, true);
    }
  }

  // Shown from the copy, the Journal is read again once the network is back.
  onMount(() => {
    const onOnline = () => {
      if (fromCopy()) void readAfresh();
    };
    window.addEventListener("online", onOnline);
    onCleanup(() => window.removeEventListener("online", onOnline));
  });

  // Read once the live channel is open, so a change made meanwhile is either read or brought.
  onMount(async () => {
    await live.ready;
    await loadPage();
  });
  onCleanup(live.listen({ changed: (change) => patch(change.effects), readAfresh }));
  // An Unsent write accepted is shown as the server keeps it, as its Unsent copy leaves.
  onCleanup(
    onSent((sent) => {
      if (sent.context !== contextId) return;
      setProblem(null);
      // Read as it now is: the live channel may have brought something newer than the answer.
      if (sent.kind === "finish") void refreshTask(sent.task.id);
      else void refreshAround(sent.entry.id);
    }),
  );

  /**
   * The Entries shown with the Unsent ones on this Device, each where it will go by the
   * time it was made (section 8.8). Each keeps its identity, so what is open on it stays open.
   */
  const withUnsent = createMemo((): (Entry | UnsentEntry)[] => {
    const unsentHere = unsentEntriesIn(contextId);
    const shown: (Entry | UnsentEntry)[] = [];
    let next = 0;
    for (const entry of entries) {
      while (next < unsentHere.length && (unsentHere[next] as UnsentEntry).made_at < entry.at) {
        shown.push(unsentHere[next] as UnsentEntry);
        next++;
      }
      shown.push(entry);
    }
    return [...shown, ...unsentHere.slice(next)];
  });

  /** Show what a change did, by reading each record its Effects name as it now is. */
  async function patch(effects: Effect[]) {
    for (const effect of effects) {
      if (effect.kind === "entry") await refreshAround(effect.id);
      if (effect.kind === "task") await refreshTask(effect.id);
      if (effect.what === "changed") renameLinksTo(effect);
      // Sent to the Trash or back from it, a record's links show it deleted or not.
      else await refreshEntriesLinking(effect.id);
      await refreshTasksNaming(effect.id);
    }
  }

  /** Some changes are gone from the log, so the Journal is read again from its newest page. */
  async function readAfresh() {
    const wasFromCopy = fromCopy();
    setEntries([]);
    setEarlierCursor(null);
    setFromCopy(false);
    setNewestRead(false);
    await loadPage();
    // Read from Praxis again, the Journal is no longer the copy's.
    if (wasFromCopy && !fromCopy()) readingCopy(contextId, false);
  }

  /**
   * Show an Entry as it now is, and each Entry shown with it as a Follow-up or as the one it
   * follows up, which names it by its summary and lists it among its Follow-ups.
   */
  async function refreshAround(id: string) {
    const entry = await refreshEntry(id);
    const related = new Set(
      entries
        .filter(
          (shown) =>
            shown.follow_up_to?.id === id || shown.follow_ups.some((each) => each.id === id),
        )
        .map((shown) => shown.id),
    );
    if (entry?.follow_up_to) related.add(entry.follow_up_to.id);
    related.delete(id);
    for (const each of related) {
      if (entries.some((shown) => shown.id === each)) await refreshEntry(each);
    }
  }

  /** Show an Entry as it now is: in place, in time order, or gone if it is. */
  async function refreshEntry(id: string): Promise<Entry | null> {
    const result = await callTool("get_entry", { id });
    if (!result.ok) {
      if (result.error.code === "not_found")
        setEntries((shown) => shown.filter((e) => e.id !== id));
      return null;
    }
    const entry = result.value;
    showEntry(entry);
    return entry;
  }

  /** Show an Entry as a read or a write gave it: in place, or in time order. */
  function showEntry(entry: Entry) {
    const at = entries.findIndex((shown) => shown.id === entry.id);
    // Patched in place, so what is open on it stays open.
    if (at !== -1) return setEntries(at, reconcile(entry, { key: "id" }));
    const oldest = entries[0];
    // Earlier than the earliest shown, with earlier ones still to load: it shows when they do.
    if (earlierCursor() !== null && oldest && entry.at < oldest.at) return;
    const after = entries.findIndex((shown) => shown.at > entry.at);
    setEntries((shown) => shown.toSpliced(after === -1 ? shown.length : after, 0, entry));
  }

  /**
   * Bring a record into view: an Entry, or a Task on the Entry it hangs off, reading earlier pages
   * until that Entry is shown. One gone meanwhile is never shown, and nothing is brought.
   */
  async function bringIntoView(entry: string, anchor: string) {
    for (;;) {
      if (entries.some((shown) => shown.id === entry)) break;
      const cursor = earlierCursor();
      if (cursor === null) return;
      await loadPage(cursor);
      // A page refused or not reached leaves the cursor where it was: the problem is shown.
      if (earlierCursor() === cursor) return;
    }
    // Opened here, an older Entry stays in the Offline Copy, readable with no network.
    const opened = entries.find((shown) => shown.id === entry);
    if (opened) noteOpened(contextId, structuredClone(unwrap(opened)));
    requestAnimationFrame(() => {
      const shown = document.getElementById(anchor);
      shown?.scrollIntoView({ block: "center" });
      shown?.focus();
    });
  }

  /** Show a Task as it now is, on the Entry it hangs off, or gone from it if it is. */
  async function refreshTask(id: string) {
    const result = await callTool("get_task", { id });
    if (result.ok) return showTask(result.value);
    if (result.error.code !== "not_found") return;
    setEntries(
      (entry) => entry.tasks.some((task) => task.id === id),
      "tasks",
      (tasks) => tasks.filter((task) => task.id !== id),
    );
  }

  /** A record's summary is what a link to it shows: a Task's title, a Project's or Person's name. */
  function renameLinksTo(effect: Effect) {
    setEntries(
      (entry) => entry.links.some((link) => link.to.id === effect.id),
      "links",
      (link) => link.to.id === effect.id,
      "to",
      "summary",
      effect.summary,
    );
  }

  /** Read again each Entry shown that links to this record. */
  async function refreshEntriesLinking(id: string) {
    const linking = entries.filter((entry) => entry.links.some((link) => link.to.id === id));
    for (const entry of linking) await refreshEntry(entry.id);
  }

  /** Read again each Task shown that names this record, waiting on it or Delegated to it. */
  async function refreshTasksNaming(id: string) {
    const naming = entries
      .flatMap((entry) => entry.tasks)
      .filter((task) => {
        if (task.id === id || task.state.is !== "open") return false;
        const { waiting, delegated } = task.state;
        return delegated?.to.id === id || (waiting ?? []).some(({ on }) => on.id === id);
      });
    for (const task of naming) await refreshTask(task.id);
  }

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

  // What a search found is shown in place of the Entries, which stay as they were under it.
  const search = createSearch({
    timeZone: props.timeZone,
    get contextName() {
      return props.contextName;
    },
    formatTime: dayAndTimeIn(props.timeZone),
    onShowInJournal: (entry, anchor) => void bringIntoView(entry, anchor),
  });
  const searching = search.shown;
  // An Entry opened from elsewhere on the screen is shown as a hit opened is: the search ends, and
  // earlier Entries are read until it is shown.
  props.giveToEntry((id) => {
    if (searching()) search.end();
    void bringIntoView(id, recordAnchor("entry", id));
  });
  // The Entries open at their newest, beside the composer; what was found keeps its own order.
  const column = followNewest({ items: withUnsent, anchored: () => !searching() });
  // Parted into days in the zone its times are shown in, each caption inside the list so the
  // column sees it change size.
  const { DayStart } = partIntoDays(() => props.timeZone);
  const madeBefore = (index: number) => {
    const prior = withUnsent()[index - 1];
    return prior === undefined ? undefined : madeAt(prior);
  };

  return (
    <>
      <search.Field />
      <PeerBody ref={column.scroller}>
        <search.Found />
        <Show when={!searching() && earlierCursor()}>
          {(cursor) => (
            <button type="button" class="quiet" onClick={() => loadPage(cursor())}>
              Show earlier Entries
            </button>
          )}
        </Show>
        <Show when={!searching() && fromCopy()}>
          <p class="peer-note">Older Entries need the network.</p>
        </Show>
        {/* Read from Praxis and holding nothing, it says so; the Offline Copy's may be short of it. */}
        <Show when={!searching() && newestRead() && !fromCopy() && withUnsent().length === 0}>
          <p class="peer-empty">Nothing recorded in {props.contextName ?? "this Context"} yet.</p>
        </Show>
        <ol class="entry-list" aria-label="Entries" hidden={searching()} ref={column.content}>
          <For each={withUnsent()}>
            {(entry, index) => (
              <>
                <DayStart at={madeAt(entry)} before={madeBefore(index())} />
                {isUnsent(entry) ? (
                  <UnsentEntryItem
                    write={entry}
                    formatTime={(at) => timeOfDay.format(new Date(at))}
                  />
                ) : (
                  <EntryItem
                    entry={entry}
                    formatTime={(at) => timeOfDay.format(new Date(at))}
                    formatWhen={(at) => timeFormat.format(new Date(at))}
                    timeZone={props.timeZone}
                    onEntry={(changed) => {
                      setProblem(null);
                      showEntry(changed);
                    }}
                    onFollowUp={() => {
                      setFollowingUp({ id: entry.id, summary: summarizeWords(entry.words) });
                      document.getElementById(JOURNAL_COMPOSER)?.focus();
                    }}
                    onTask={showTask}
                    onShowHeldChange={props.onShowHeldChange}
                    onDeleted={(effects) => {
                      setProblem(null);
                      void patch(effects);
                    }}
                    onMoved={(said) => {
                      setProblem(null);
                      setTold(said);
                    }}
                    onProblem={setProblem}
                  />
                )}
              </>
            )}
          </For>
        </ol>
      </PeerBody>
      <div class="peer-foot">
        <column.JumpToLatest />
        <Show when={told()}>
          {(said) => (
            <p class="moved" role="status">
              {said()}
            </p>
          )}
        </Show>
        <Show when={problem()}>
          {(message) => (
            <p class="problem" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Composer
          contextName={props.contextName}
          timeZone={props.timeZone}
          followingUp={followingUp()}
          onStopFollowingUp={() => setFollowingUp(null)}
          onUnsent={(leftOff, aimedAt) => {
            setProblem(null);
            if (told() === LINKS_LEFT_OFF) setTold(null);
            setFollowingUp(null);
            // Nothing is dropped silently (section 8.8).
            const lost = [
              leftOff ? (contextCopy(contextId) ? LEFT_OFF_WITH_COPY : LEFT_OFF) : null,
              aimedAt ? aimLeftOff(aimedAt.name) : null,
            ].filter((said) => said !== null);
            if (lost.length > 0) setTold(lost.join(" "));
            // Kept Unsent, it is in the Journal all the same, and the person's own.
            column.toNewest();
          }}
          onRecorded={(entry) => {
            setProblem(null);
            if (told() === LINKS_LEFT_OFF) setTold(null);
            setFollowingUp(null);
            showEntry(entry);
            column.toNewest();
            if (entry.follow_up_to) void refreshEntry(entry.follow_up_to.id);
          }}
          onLinksLeftOff={() => setTold(LINKS_LEFT_OFF)}
          onProblem={setProblem}
        />
      </div>
    </>
  );
}

/** Said when the composer's draft comes from another Context, whose records its links were to. */
const LINKS_LEFT_OFF =
  "The draft came from another Context, and its links were left off: each was to a record there, so pick them again here.";

/** Said when an Entry kept Unsent leaves off what it cannot take with no Offline Copy. */
const LEFT_OFF =
  "Kept Unsent with its words and Inline Tasks only: its links and the Entry it followed up need the network, so add them once it is sent.";

/** Said when an Entry kept Unsent leaves off what the Offline Copy does not hold. */
const LEFT_OFF_WITH_COPY =
  "Kept Unsent without what this Device does not hold: a new Person or Project, or a link or Follow-up to a record not in its Offline Copy, needs the network, so add it once it is sent.";

/**
 * Said when an Entry aimed at a Project is kept Unsent: its Tasks are made only once it is sent,
 * and the aim lasted the one Entry, so nothing puts them in the Project.
 */
function aimLeftOff(project: string): string {
  return `Kept Unsent, so the Tasks it makes once sent are not put in ${project}: put them there from their pages.`;
}

/** What Standing means, on the mark a Standing Entry always shows. */
const STANDING = "A Standing Entry is given to the Agent at the start of every Run";

/** Whether what the Journal shows is an Entry still Unsent on this Device. */
function isUnsent(item: Entry | UnsentEntry): item is UnsentEntry {
  return "made_at" in item;
}

/** When what the Journal shows was made: an Entry's time, or an Unsent one's on this Device. */
function madeAt(item: Entry | UnsentEntry): string {
  return isUnsent(item) ? item.made_at : item.at;
}

function EntryItem(props: {
  entry: Entry;
  /** An instant's time of day in the Context's time zone, under the caption of its day. */
  formatTime: (at: string) => string;
  /** An instant with its date, in the Context's time zone, where no caption says its day. */
  formatWhen: (at: string) => string;
  /** The Context's time zone. */
  timeZone: string;
  /** The Entry as a change to it returned it. */
  onEntry: (entry: Entry) => void;
  /** The person chose to record a Follow-up to it. */
  onFollowUp: () => void;
  onTask: (task: Task) => void;
  /** Bring a Held Change on it into view in Attention. */
  onShowHeldChange: (anchor: string) => void;
  /** The Entry went to the Trash, with what went with it: what the delete changed. */
  onDeleted: (effects: Effect[]) => void;
  /** The Entry moved to another Context, with its unit, as said. */
  onMoved: (said: string) => void;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  const contextId = useContextId();
  const heldChanges = useHeldChanges();
  // The newest Held Change left on it, which its marker leads to in Attention.
  const held = () => heldChanges.all().find((each) => each.entry.id === props.entry.id);
  // The Entry's page, open on its words or on adding a Task, or shut.
  const [page, setPage] = createSignal<"words" | "task" | null>(null);
  let item!: HTMLLIElement;
  const [showingVersions, setShowingVersions] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [marking, setMarking] = createSignal(false);
  const [moving, setMoving] = createSignal(false);

  /**
   * Mark the Entry standing, so the Agent keeps honouring it, or unmark it. A mark past the
   * ceiling is refused, and the reason shown.
   */
  async function toggleStanding() {
    setMarking(true);
    try {
      const tool = props.entry.standing ? "unmark_standing" : "mark_standing";
      const result = await callTool(tool, { id: props.entry.id });
      if (!result.ok) return props.onProblem(result.error.message);
      props.onEntry(result.value.record);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      setMarking(false);
    }
  }

  // No asking first: what is deleted is put back from the Trash.
  async function deleteEntry() {
    setDeleting(true);
    try {
      const result = await callTool("delete_entry", { id: props.entry.id });
      if (!result.ok) return props.onProblem(result.error.message);
      props.onDeleted(result.value.effects);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      setDeleting(false);
    }
  }
  return (
    <li
      ref={item}
      class="entry"
      id={recordAnchor("entry", props.entry.id)}
      data-testid="entry"
      tabIndex={-1}
    >
      <div class="entry-head">
        <time class="entry-time" datetime={props.entry.at}>
          {props.formatTime(props.entry.at)}
        </time>
        <Show when={props.entry.edited}>
          {(edited) => (
            <button
              type="button"
              class="quiet entry-mark"
              aria-expanded={showingVersions()}
              onClick={() => setShowingVersions((shown) => !shown)}
            >
              {edited().by.kind === "person" ? "Edited" : `Edited by ${authorName(edited().by)}`}
            </button>
          )}
        </Show>
        <Show when={props.entry.standing}>
          <span class="entry-mark standing-mark" title={STANDING}>
            <Pin size={13} aria-hidden="true" />
            Standing
          </span>
        </Show>
        <Show when={held()}>
          {(left) => (
            <a
              class="entry-mark held-mark"
              href={`#${heldAnchor(left().id)}`}
              onClick={(event) => {
                event.preventDefault();
                props.onShowHeldChange(heldAnchor(left().id));
              }}
            >
              Held Change for your tap
            </a>
          )}
        </Show>
        <EntryActions
          frequent={[
            { label: "Edit", icon: Pencil, onSelect: () => setPage("words") },
            { label: "Add a Task", icon: ListPlus, onSelect: () => setPage("task") },
            { label: "Follow up", icon: CornerDownRight, onSelect: () => props.onFollowUp() },
            {
              label: props.entry.standing ? "Unmark Standing" : "Mark Standing",
              icon: Pin,
              disabled: marking(),
              onSelect: () => void toggleStanding(),
            },
          ]}
          rest={[
            { label: "Move", icon: ArrowRightLeft, onSelect: () => setMoving((shown) => !shown) },
            {
              label: "Delete",
              icon: Trash,
              disabled: deleting(),
              onSelect: () => void deleteEntry(),
            },
          ]}
        />
      </div>
      <Show when={moving()}>
        <MoveRecord
          record={{ kind: "entry", id: props.entry.id }}
          onMoved={props.onMoved}
          onClose={() => setMoving(false)}
        />
      </Show>
      <Show when={props.entry.follow_up_to}>
        {(to) => (
          <Show
            when={!to().deleted}
            fallback={<p class="entry-follows">Continues a deleted Entry</p>}
          >
            <p class="entry-follows">
              Follows up <a href={`#${recordAnchor("entry", to().id)}`}>“{to().summary}”</a>
            </p>
          </Show>
        )}
      </Show>
      <Words
        words={props.entry.words}
        // Read with no network, as from the copy, an image shows its description (section 8.8).
        images={online() && !readFromCopy(contextId) ? imageLoadingIn(props.entry) : "never"}
        testId="words"
      />
      <Show when={page()}>
        {(start) => (
          <EntryPage
            entry={props.entry}
            timeZone={props.timeZone}
            when={props.formatWhen(props.entry.at)}
            start={start()}
            column={item.closest<HTMLElement>(".peer") ?? document.body}
            onSaved={props.onEntry}
            onTask={props.onTask}
            onClose={() => {
              const opener = start() === "task" ? "Add a Task" : "Edit";
              setPage(null);
              // The focus goes back to the action that opened the page: its button in the
              // toolbar, or the one button of a touch screen's menu.
              queueMicrotask(() =>
                (
                  item.querySelector<HTMLElement>(
                    `[aria-label="${opener}"], [aria-label="Actions for this Entry"]`,
                  ) ?? item
                ).focus(),
              );
            }}
          />
        )}
      </Show>
      <Show when={showingVersions() && props.entry.edited}>
        <Versions
          entry={props.entry}
          formatTime={props.formatWhen}
          onEntry={props.onEntry}
          onProblem={props.onProblem}
        />
      </Show>
      <Show when={props.entry.links.length > 0}>
        <ul class="link-list" aria-label="Mentions and References">
          <For each={props.entry.links}>{(link) => <LinkItem link={link} />}</For>
        </ul>
      </Show>
      <Show when={props.entry.tasks.length > 0}>
        <ul class="task-list" aria-label="Tasks">
          <For each={props.entry.tasks}>
            {(task) => (
              <TaskItem
                task={task}
                timeZone={props.timeZone}
                anchor={recordAnchor("task", task.id)}
                onTask={props.onTask}
                onProblem={props.onProblem}
              />
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.entry.follow_ups.length > 0}>
        <section class="follow-ups">
          <h3 class="follow-ups-title">Follow-ups</h3>
          <ul aria-label="Follow-ups">
            <For each={props.entry.follow_ups}>
              {(each) => (
                <li>
                  <a href={`#${recordAnchor("entry", each.id)}`}>{each.summary}</a>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </li>
  );
}

/**
 * A Mention, a tinted pill, or a Reference, an inset pill, kept beside the Entry's words. One to a
 * record in the Trash is dormant, and says it is deleted.
 */
function LinkItem(props: { link: Link }) {
  return (
    <li
      class="link"
      classList={{ [props.link.kind]: !props.link.to.deleted, deleted: !!props.link.to.deleted }}
    >
      {props.link.kind === "mention" ? "@" : "#"}
      {props.link.to.summary}
      <Show when={props.link.to.deleted}>
        <span class="link-deleted">, deleted</span>
      </Show>
    </li>
  );
}

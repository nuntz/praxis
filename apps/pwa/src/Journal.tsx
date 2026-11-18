import {
  type Effect,
  type Entry,
  type EntryNamed,
  type Link,
  summarizeWords,
  type Task,
} from "@praxis/domain";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { authorName } from "./authors.ts";
import { Composer } from "./Composer.tsx";
import { EntryEditor } from "./EntryEditor.tsx";
import { heldAnchor, useHeldChanges } from "./HeldChanges.tsx";
import { useLive } from "./live-context.ts";
import { TaskItem } from "./TaskItem.tsx";
import { unreachableMessage, useCallTool } from "./tools.ts";
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
}) {
  const callTool = useCallTool();
  const live = useLive();
  const timeFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: props.timeZone,
  });
  // Oldest first, as shown. `list_entries` gives newest first, a page at a time. A store, so a
  // record that changes is patched in place and what is open on it stays open.
  const [entries, setEntries] = createStore<Entry[]>([]);
  const [earlierCursor, setEarlierCursor] = createSignal<string | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  // The Entry the composer's next Entry is a Follow-up to, if the person chose one.
  const [followingUp, setFollowingUp] = createSignal<EntryNamed | null>(null);

  async function loadPage(cursor?: string) {
    try {
      const result = await callTool("list_entries", cursor === undefined ? {} : { cursor });
      if (!result.ok) return setProblem(result.error.message);
      // An Entry the live channel brought while the page was read is shown once.
      setEntries((shown) => {
        const page = result.value.items.filter((read) => !shown.some((e) => e.id === read.id));
        return [...page.toReversed(), ...shown];
      });
      setEarlierCursor(result.value.next_cursor);
    } catch (error) {
      setProblem(unreachableMessage(error));
    }
  }

  // Read once the live channel is open, so a change made meanwhile is either read or brought.
  onMount(async () => {
    await live.ready;
    await loadPage();
  });
  onCleanup(live.listen({ changed: (change) => patch(change.effects), readAfresh }));

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
    setEntries([]);
    setEarlierCursor(null);
    await loadPage();
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

  return (
    <>
      <div class="peer-body">
        <Show when={earlierCursor()}>
          {(cursor) => (
            <button type="button" class="quiet" onClick={() => loadPage(cursor())}>
              Show earlier Entries
            </button>
          )}
        </Show>
        <ol class="entry-list" aria-label="Entries">
          <For each={entries}>
            {(entry) => (
              <EntryItem
                entry={entry}
                formatTime={(at) => timeFormat.format(new Date(at))}
                timeZone={props.timeZone}
                onEntry={(changed) => {
                  setProblem(null);
                  showEntry(changed);
                }}
                onFollowUp={() => {
                  setFollowingUp({ id: entry.id, summary: summarizeWords(entry.words) });
                  document.getElementById("new-entry")?.focus();
                }}
                onTask={showTask}
                onShowHeldChange={props.onShowHeldChange}
                onDeleted={(effects) => {
                  setProblem(null);
                  void patch(effects);
                }}
                onProblem={setProblem}
              />
            )}
          </For>
        </ol>
      </div>
      <div class="peer-foot">
        <Show when={problem()}>
          {(message) => (
            <p class="problem" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Composer
          contextName={props.contextName}
          followingUp={followingUp()}
          onStopFollowingUp={() => setFollowingUp(null)}
          onRecorded={(entry) => {
            setProblem(null);
            setFollowingUp(null);
            showEntry(entry);
            if (entry.follow_up_to) void refreshEntry(entry.follow_up_to.id);
          }}
          onProblem={setProblem}
        />
      </div>
    </>
  );
}

function EntryItem(props: {
  entry: Entry;
  /** An instant as shown in the Context's time zone. */
  formatTime: (at: string) => string;
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
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  const heldChanges = useHeldChanges();
  // The newest Held Change waiting on it, which its marker leads to in Attention.
  const held = () => heldChanges.waiting().find((each) => each.entry.id === props.entry.id);
  const [editing, setEditing] = createSignal(false);
  const [showingVersions, setShowingVersions] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [marking, setMarking] = createSignal(false);

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
    <li class="entry" id={recordAnchor("entry", props.entry.id)} data-testid="entry" tabIndex={-1}>
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
        <Show when={held()}>
          {(waiting) => (
            <a
              class="entry-mark held-mark"
              href={`#${heldAnchor(waiting().id)}`}
              onClick={(event) => {
                event.preventDefault();
                props.onShowHeldChange(heldAnchor(waiting().id));
              }}
            >
              Held Change waiting
            </a>
          )}
        </Show>
        <Show when={!editing()}>
          <button type="button" class="quiet entry-mark" onClick={() => setEditing(true)}>
            Edit
          </button>
        </Show>
        <button type="button" class="quiet entry-mark" onClick={() => props.onFollowUp()}>
          Follow up
        </button>
        <button
          type="button"
          class="quiet entry-mark"
          aria-pressed={props.entry.standing}
          title="A Standing Entry is given to the Agent at the start of every Run"
          disabled={marking()}
          onClick={() => void toggleStanding()}
        >
          Standing
        </button>
        <button
          type="button"
          class="quiet entry-mark"
          disabled={deleting()}
          onClick={() => void deleteEntry()}
        >
          Delete
        </button>
      </div>
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
      <Show when={editing()} fallback={<Words words={props.entry.words} testId="words" />}>
        <EntryEditor
          entry={props.entry}
          onSaved={(entry) => {
            setEditing(false);
            props.onEntry(entry);
          }}
          onCancel={() => setEditing(false)}
          onProblem={props.onProblem}
        />
      </Show>
      <Show when={showingVersions() && props.entry.edited}>
        <Versions
          entry={props.entry}
          formatTime={props.formatTime}
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

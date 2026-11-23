import {
  hasWords,
  narrows,
  type SearchHit,
  type Task,
  type WordsOnly,
  wordsOnlySaying,
} from "@praxis/domain";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import SearchIcon from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { todayIn } from "./days.tsx";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { onPhone } from "./media.ts";
import {
  chipsSaid,
  everythingSaid,
  isNarrowed,
  lifted,
  type Narrowing,
  NOT_NARROWED,
  narrowingInputs,
} from "./narrowing.ts";
import { online } from "./online.ts";
import { SearchChips } from "./SearchChips.tsx";
import { SearchGroups } from "./SearchGroups.tsx";
import type { HitActions, JournalPlace, NarrowsTo } from "./SearchHit.tsx";
import { needsNetwork, useCallTool } from "./tools.ts";

/** Search runs on the server, over the whole Journal, so it needs the network (section 8.8). */
const SEARCH_NEEDS_NETWORK = "Search needs the network.";

/**
 * Search in the Journal column (sections 8.4 and 9.4): one field, the chips under it that narrow
 * it, and while the field holds words, what `search` finds in place of the Entries, from words and
 * from meaning, and a line saying so when it is from words alone. A Project, a Person or an Author
 * chip with no words lists everything it holds, newest first, and a Project or a Person found
 * narrows the search to it. What is found is grouped by kind (SearchGroups.tsx), each hit saying
 * when it was made as the Journal's days do, and by whom when not by the person (SearchHit.tsx).
 *
 * It says what to do and gets out of the way: the field's clear button clears the words alone,
 * Escape or opening a hit ends the search, chips and all, and on a desktop `/` reaches the field.
 * Empty and focused, the field says what it searches; Nothing found names the words and offers to
 * lift each chip set. Offline, the field and chips are shown but cannot be used, and say why.
 *
 * The field and what is found are shown apart: the field above the column's scrolling body, so
 * nothing scrolls under it, and what is found inside it, where the Entries are.
 */
export function createSearch(props: {
  /**
   * The Context's time zone: the time chip's days are reckoned in it, and a Task's and a
   * Project's marks tell their days in it.
   */
  timeZone: string;
  /** The Context's name, which the empty field says it searches. */
  contextName: string | undefined;
  /**
   * When a record found was made: its day as the Journal reckons it, and its time, in the
   * Context's zone.
   */
  formatTime: (at: string) => string;
  /** Bring a record into view in the Journal: the Entry it is, or that a Task hangs off. */
  onShowInJournal: (entry: string, anchor: string) => void;
}) {
  const callTool = useCallTool();
  const live = useLive();
  const [words, setWords] = createSignal("");
  const [narrowing, setNarrowing] = createSignal<Narrowing>(NOT_NARROWED);
  // What is asked: the words and the narrowing together, a new one on each change to either.
  const query = createMemo((): Query => ({ words: words(), narrowing: narrowing() }));
  // In a store, each hit kept by its id as the list is read again, so a row shown stays the same
  // row, its round control keeping the focus, and only what changed in it is drawn again.
  const [found, setFound] = createStore<{ hits: SearchHit[] | null }>({ hits: null });
  const hits = () => found.hits;
  const setHits = (next: SearchHit[] | null | ((shown: SearchHit[] | null) => SearchHit[])) => {
    const hits = typeof next === "function" ? next(found.hits) : next;
    setFound("hits", hits === null ? null : reconcile(hits, { key: "id" }));
  };
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [wordsOnly, setWordsOnly] = createSignal<WordsOnly | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  // Whether the person entered the search on a phone, where it is a screen of its own until it ends.
  const [entered, setEntered] = createSignal(false);
  // Whether Close in meaning was unfolded, for these words: new words fold it again.
  const [meaningUnfolded, setMeaningUnfolded] = createSignal(false);
  // Counts each list read from its first page or cleared: a later page asked for before is from an
  // older answer, whose cursor reads the same as the newer one's, so it is dropped, and so is a
  // write's answer a read since has overtaken.
  let answers = 0;

  /**
   * The `search` tool's input for what is asked, the time chip's days from today there. With no
   * words, it asks for everything a Project, a Person or an Author chip holds.
   */
  const inputOf = (asked: Query) => ({
    ...(hasWords(asked) ? { words: asked.words } : {}),
    ...narrowingInputs(asked.narrowing, todayIn(props.timeZone)),
  });

  // Each change to the words or the chips asks afresh, from the first page, and only the answer to
  // the latest is shown. Read again for a change, the list reads as many pages as it shows, so a
  // page "Show more found" brought stays.
  const { read: find, changed } = latestRead(async (current, asked: Query, through: number) => {
    try {
      // Read once the live channel is ready, so a change made meanwhile is either read or brought.
      await live.ready;
      const read: SearchHit[] = [];
      let cursor: string | null = null;
      let first: WordsOnly | null | undefined;
      do {
        const page: { cursor?: string } = cursor === null ? {} : { cursor };
        const result = await callTool("search", { ...inputOf(asked), ...page });
        // Emptied meanwhile, the field asks nothing: its answer would show under no words.
        if (!current() || query() !== asked) return;
        if (!result.ok) return setProblem(result.error.message);
        read.push(...result.value.items);
        cursor = result.value.next_cursor;
        first ??= result.value.words_only;
      } while (cursor !== null && read.length < through);
      answers += 1;
      setProblem(null);
      setHits(read);
      setNextCursor(cursor);
      setWordsOnly(first ?? null);
    } catch (error) {
      if (current() && query() === asked) setProblem(needsNetwork(error, SEARCH_NEEDS_NETWORK));
    }
  });

  // What is found follows what changes, as the Journal does: a record deleted leaves the list, a
  // Task finished anywhere says so, and the list is read again as far as it is shown.
  onCleanup(live.listen({ changed: refind, readAfresh: refind }));

  async function refind(): Promise<void> {
    if (asking()) await find(query(), hits()?.length ?? 0);
  }

  // Whether words were typed, not only spaces.
  const wordsGiven = () => hasWords({ words: words() });
  // A time chip alone asks nothing: the Journal's days already show a time (section 8.4). A
  // Project, a Person or an Author chip asks with no words, for everything it holds, newest first,
  // as the tool takes it. The tool now lists a range of days alone too: #130 asks with the time
  // chip alone, and until then its days are set aside here.
  const asking = () => {
    const { from: _from, to: _to, ...input } = inputOf(query());
    return hasWords(input) || narrows(input);
  };
  // On a phone the search is a screen of its own from the moment its field is entered, in place of
  // the Journal's Entries before it asks anything; wider, the Entries stay until it asks.
  const shown = () => asking() || (onPhone() && entered());

  function ask(typed: string) {
    setWords(typed);
    setMeaningUnfolded(false);
    askAgain();
  }

  function narrow(narrowed: Narrowing) {
    setNarrowing(narrowed);
    askAgain();
  }

  function askAgain() {
    if (!asking()) {
      answers += 1;
      setHits(null);
      setNextCursor(null);
      setWordsOnly(null);
      setProblem(null);
      // A read still out answers for words no longer asked, so it is dropped.
      changed();
      return;
    }
    void find(query(), 0);
  }

  async function showMore(cursor: string) {
    const asked = query();
    const after = answers;
    const stillAsked = () => query() === asked && answers === after;
    try {
      const result = await callTool("search", { ...inputOf(asked), cursor });
      if (!stillAsked()) return;
      if (!result.ok) return setProblem(result.error.message);
      setHits((shown) => [...(shown ?? []), ...result.value.items]);
      setNextCursor(result.value.next_cursor);
    } catch (error) {
      if (stillAsked()) setProblem(needsNetwork(error, SEARCH_NEEDS_NETWORK));
    }
  }

  /**
   * The search ends, words and chips both, and the Journal is as it was left: by Escape, by back on
   * a phone, and by opening a hit, so the Journal shows it.
   */
  function end() {
    setEntered(false);
    setWords("");
    setNarrowing(NOT_NARROWED);
    setMeaningUnfolded(false);
    askAgain();
  }

  /** A Task found, where it stands as a write from its round control left it. */
  function patchTask(task: Task) {
    const at = found.hits?.findIndex((hit) => hit.kind === "task" && hit.id === task.id) ?? -1;
    if (at === -1) return;
    const { due_date, defer_date, recurrence, state } = task;
    setFound("hits", at, { due_date, defer_date, recurrence, state });
  }

  /** What a hit does once tapped, and what it is shown with. */
  const actions: HitActions = {
    get timeZone() {
      return props.timeZone;
    },
    formatTime: (at) => props.formatTime(at),
    onShow(place: JournalPlace) {
      props.onShowInJournal(place.entry, place.anchor);
      end();
    },
    /**
     * Narrow the search to a Project found, a closed one too, or a Person found, in place of the
     * words: the chip of its kind is set to it.
     */
    onNarrowTo(hit: NarrowsTo) {
      setNarrowing({ ...narrowing(), [hit.kind]: { id: hit.id, name: hit.summary } });
      ask("");
    },
    // The live channel may bring the Task, newer, before the write's answer: a list read since the
    // write was sent shows it as it now is, so the answer is placed only while none was (as
    // `placeAnswered` in Conversation.tsx does).
    answering() {
      const after = answers;
      return (task) => {
        if (answers === after) patchTask(task);
      };
    },
    onProblem: setProblem,
  };

  /** Escape ends the search, unless something in it, as a chip's picker, took it first. */
  function endOnEscape(event: KeyboardEvent): boolean {
    if (event.key !== "Escape" || event.defaultPrevented) return false;
    if (!shown() && words() === "" && !isNarrowed(narrowing())) return false;
    event.preventDefault();
    end();
    return true;
  }

  let field: HTMLInputElement | undefined;
  const [focused, setFocused] = createSignal(false);
  const context = () => props.contextName ?? "this Context";

  // The empty field's line goes as the field loses the focus. Lost to a press, it goes once the
  // press is done, so the Entries moving up under it do not take what was pressed from the pointer.
  let pressing = false;
  const pressed = () => {
    pressing = true;
  };
  const released = () => {
    pressing = false;
    setTimeout(() => setFocused(document.activeElement === field));
  };
  document.addEventListener("pointerdown", pressed, true);
  document.addEventListener("pointerup", released, true);
  document.addEventListener("pointercancel", released, true);
  onCleanup(() => {
    document.removeEventListener("pointerdown", pressed, true);
    document.removeEventListener("pointerup", released, true);
    document.removeEventListener("pointercancel", released, true);
  });
  const blurred = () => {
    if (!pressing) setFocused(false);
  };

  // On a desktop, `/` puts the cursor in the field, unless it is typed where it is a `/`.
  const onSlash = (event: KeyboardEvent) => {
    if (event.key !== "/" || event.defaultPrevented || event.ctrlKey || event.metaKey) return;
    if (onPhone() || !online() || typedInto(event.target)) return;
    if (!field?.checkVisibility()) return;
    event.preventDefault();
    field.focus();
  };
  document.addEventListener("keydown", onSlash);
  onCleanup(() => document.removeEventListener("keydown", onSlash));

  // What the field is described by: why it cannot be used, or, empty, what it searches.
  const describedBy = () => {
    if (!online()) return "journal-search-offline";
    return words() === "" ? "journal-search-covers" : undefined;
  };

  const Field = () => (
    <div class="journal-search" classList={{ shown: shown() }}>
      <search onKeyDown={endOnEscape}>
        <div class="search-row">
          <Show when={onPhone() && shown()}>
            <button
              type="button"
              class="icon-button search-back"
              aria-label="Back to the Journal"
              onClick={end}
            >
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
          </Show>
          <label class="visually-hidden" for="journal-search-words">
            Search this Context
          </label>
          <div class="search-field">
            <SearchIcon class="search-field-icon" size={18} aria-hidden="true" />
            <input
              ref={field}
              id="journal-search-words"
              type="search"
              placeholder={`Search ${narrowing().project ? `within ${narrowing().project?.name}` : context()}`}
              autocomplete="off"
              aria-keyshortcuts={onPhone() ? undefined : "/"}
              aria-describedby={describedBy()}
              disabled={!online()}
              value={words()}
              onInput={(event) => ask(event.currentTarget.value)}
              onFocus={() => {
                setFocused(true);
                setEntered(onPhone());
              }}
              onBlur={blurred}
            />
            <Show when={words() !== ""}>
              <button
                type="button"
                class="search-clear"
                aria-label="Clear the words"
                disabled={!online()}
                onClick={() => {
                  ask("");
                  field?.focus();
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </Show>
            <Show when={words() === "" && !onPhone() && online()}>
              {/* Drawn as a key; the field's own name says it is reached by `/`. */}
              <span class="search-key" aria-hidden="true">
                /
              </span>
            </Show>
          </div>
        </div>
        <SearchChips
          narrowing={narrowing()}
          onNarrow={narrow}
          timeZone={props.timeZone}
          disabled={!online()}
        />
        <p id="journal-search-covers" class="search-note" hidden={!(focused() && words() === "")}>
          Searches the Entries, Tasks, Projects and Persons of {context()}, by their words and by
          what they mean.
        </p>
        <Show when={!online()}>
          <p id="journal-search-offline" class="search-note">
            {SEARCH_NEEDS_NETWORK}
          </p>
        </Show>
      </search>
    </div>
  );

  /**
   * Nothing found: the words named, so a typo shows, and for each chip set what it keeps out and
   * an offer to lift it, which reads the list again.
   */
  const NothingFound = () => (
    <div class="search-nothing">
      <p class="search-nothing-title">
        {wordsGiven() ? `Nothing found for “${words().trim()}”` : "Nothing found"}
      </p>
      <For each={chipsSaid(narrowing(), todayIn(props.timeZone))}>
        {(said) => (
          <>
            <p class="search-nothing-kept">{said.kept}</p>
            <button
              type="button"
              class="search-lift"
              onClick={() => {
                narrow(lifted(narrowing(), said.chip));
                field?.focus();
              }}
            >
              {said.offer}
            </button>
          </>
        )}
      </For>
    </div>
  );

  const Found = () => (
    <Show when={asking()}>
      <section
        class="search-found"
        aria-label="Found"
        onKeyDown={(event) => {
          // Ended from a hit, which then leaves, the cursor goes back to the field.
          if (endOnEscape(event)) field?.focus();
        }}
      >
        {/* There from the first words, so each count and Nothing found is announced as it comes. */}
        <div class="search-status" role="status">
          <Show when={hits()}>
            {(found) => (
              <Show when={found().length > 0} fallback={<NothingFound />}>
                <p class="search-count">
                  {wordsGiven()
                    ? `Found ${found().length}${nextCursor() === null ? "" : " and more"}`
                    : everythingSaid(narrowing(), todayIn(props.timeZone))}
                </p>
              </Show>
            )}
          </Show>
        </div>
        <Show when={hits() && wordsOnly()}>
          {(why) => <p class="search-words-only">{wordsOnlySaying(why())}</p>}
        </Show>
        <Show when={problem()}>
          {(message) => (
            <p class="problem" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show when={hits()}>
          {(found) => (
            <>
              <SearchGroups
                hits={found()}
                words={words()}
                wordsOnly={wordsOnly()}
                unfolded={meaningUnfolded()}
                onToggleMeaning={() => setMeaningUnfolded((unfolded) => !unfolded)}
                actions={actions}
              />
              {/* One for the whole list: what it brings joins its kind's group, so none is cut short. */}
              <Show when={nextCursor()}>
                {(cursor) => (
                  <button type="button" class="quiet" onClick={() => void showMore(cursor())}>
                    Show more found
                  </button>
                )}
              </Show>
            </>
          )}
        </Show>
      </section>
    </Show>
  );

  return {
    /**
     * Whether the search is shown, in place of the Entries: while it asks, and on a phone from the
     * moment its field is entered until the search ends.
     */
    shown,
    Field,
    Found,
  };
}

/** Whether a key goes to where it is typed as text: a field, a composer or the like. */
function typedInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select") !== null;
}

/** What a search asks: its words, and what its chips narrow it to. */
type Query = { words: string; narrowing: Narrowing };

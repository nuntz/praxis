import {
  hasWords,
  narrowsSearch,
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
import { screenKey } from "./keys.tsx";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { onPhone } from "./media.ts";
import {
  chipsSaid,
  everythingSaid,
  lifted,
  type Narrowing,
  NOT_NARROWED,
  narrowingInputs,
} from "./narrowing.ts";
import { online } from "./online.ts";
import { afterPress } from "./press.ts";
import { SearchChips } from "./SearchChips.tsx";
import { SearchGroups } from "./SearchGroups.tsx";
import type { HitActions, JournalPlace, NarrowsTo } from "./SearchHit.tsx";
import { needsNetwork, useCallTool } from "./tools.ts";
import { askOnPause } from "./typing-pause.ts";

/** Search runs on the server, over the whole Journal, so it needs the network (section 8.8). */
const SEARCH_NEEDS_NETWORK = "Search needs the network.";

/** How long a search asked waits for its answer before the status says it is searching. */
const SEARCHING_AFTER = 300;

/**
 * Search in the Journal column (sections 8.4 and 9.4): one field, the chips under it that narrow
 * it, and while the field holds words, what `search` finds in place of the Entries, from words and
 * from meaning, and a line saying so when it is from words alone. Any chip set with no words lists
 * everything it holds, newest first, a time chip alone too, and a Project or a Person found
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
  // What the hits shown answer, which a newer search still out has not yet replaced.
  const [answered, setAnswered] = createSignal<Query | null>(null);
  const [wordsOnly, setWordsOnly] = createSignal<WordsOnly | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  // Whether the person entered the search: its field focused, or on a phone its button tapped. On a
  // phone it is then a screen of its own until it ends; wider, its chips show until the person
  // leaves it having asked nothing (section 8.4).
  const [entered, setEntered] = createSignal(false);
  // Whether Close in meaning was unfolded, for these words: new words fold it again.
  const [meaningUnfolded, setMeaningUnfolded] = createSignal(false);
  // Counts each list read from its first page or cleared: a later page asked for before is from an
  // older answer, whose cursor reads the same as the newer one's, so it is dropped, and so is a
  // write's answer a read since has overtaken.
  let answers = 0;

  /**
   * The `search` tool's input for what is asked, the time chip's days from today there. With no
   * words, it asks for everything the chips set hold.
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
        if (!result.ok) {
          settled(asked);
          return setProblem(result.error.message);
        }
        read.push(...result.value.items);
        cursor = result.value.next_cursor;
        first ??= result.value.words_only;
      } while (cursor !== null && read.length < through);
      answers += 1;
      setProblem(null);
      setHits(read);
      setNextCursor(cursor);
      setWordsOnly(first ?? null);
      settled(asked);
    } catch (error) {
      if (current() && query() === asked) {
        settled(asked);
        setProblem(needsNetwork(error, SEARCH_NEEDS_NETWORK));
      }
    }
  });

  // What is found follows what changes, as the Journal does: a record deleted leaves the list, a
  // Task finished anywhere says so, and the list is read again as far as it is shown.
  onCleanup(live.listen({ changed: refind, readAfresh: refind }));

  async function refind(): Promise<void> {
    if (asking()) await find(query(), hits()?.length ?? 0);
  }

  // Any chip set asks with no words, the time chip too, for everything it holds, newest first, as
  // the tool takes it (section 8.4).
  const asking = () => {
    const input = inputOf(query());
    return hasWords(input) || narrowsSearch(input);
  };
  // On a phone the search is a screen of its own from the moment its field is entered, in place of
  // the Journal's Entries before it asks anything; wider, the Entries stay until it asks.
  const shown = () => asking() || (onPhone() && entered());
  // Whether the search is in use, so its chips show: entered, or asking.
  const inUse = () => entered() || asking();
  // Whether a newer search than the one shown is asked, waiting on a pause in typing or out.
  const out = () => asking() && answered() !== query();
  // Whether what is asked has had no answer for a while, so the status says it is searching.
  const [slow, setSlow] = createSignal(false);
  let slowly: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(slowly));
  /** A search sent: unanswered for a while, the status says it is searching, as it goes on saying. */
  function sent() {
    if (slow()) return;
    clearTimeout(slowly);
    slowly = setTimeout(() => setSlow(true), SEARCHING_AFTER);
  }
  /** What is asked is answered, or asks nothing: what is shown is for it, and nothing is out. */
  function settled(asked: Query | null) {
    clearTimeout(slowly);
    setSlow(false);
    setAnswered(asked);
  }
  const searchingSaid = () => slow() && out();
  // The words and chips of what is shown, which the count and Nothing found say.
  const shownWords = () => answered()?.words ?? words();
  const shownNarrowing = () => answered()?.narrowing ?? narrowing();

  // The words are asked once typing pauses (section 8.4); a chip, the clear button and Escape act at
  // once, dropping words still waiting.
  const pause = askOnPause();
  onCleanup(pause.cancel);

  /** Words typed in the field: asked once typing pauses, or cleared at once when nothing is asked. */
  function typed(value: string) {
    setWords(value);
    setMeaningUnfolded(false);
    if (asking()) pause.later(askAgain);
    else pause.now(askAgain);
  }

  function ask(value: string) {
    setWords(value);
    setMeaningUnfolded(false);
    pause.now(askAgain);
  }

  function narrow(narrowed: Narrowing) {
    setNarrowing(narrowed);
    pause.now(askAgain);
  }

  function askAgain() {
    if (!asking()) {
      answers += 1;
      settled(null);
      setHits(null);
      setNextCursor(null);
      setWordsOnly(null);
      setProblem(null);
      // A read still out answers for words no longer asked, so it is dropped.
      changed();
      return;
    }
    sent();
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
    pause.now(askAgain);
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

  /**
   * Escape ends the search, unless something in it, as a chip's picker, took it first. The chips
   * fold away with it, so the focus they held goes to the field. On a phone the field goes with
   * its screen, so the focus goes to the button that opens it, wherever it was.
   */
  function endOnEscape(event: KeyboardEvent): boolean {
    if (event.key !== "Escape" || event.defaultPrevented) return false;
    if (!inUse() && words() === "") return false;
    event.preventDefault();
    const held = document.activeElement !== field;
    if (held && !onPhone()) field?.focus();
    end();
    if (onPhone()) openButton?.focus();
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

  // Wider than a phone, the search is left by a press or the focus going anywhere outside it, and
  // folds back to its field once it asks nothing. On a phone only its back arrow leaves it.
  let searchElement: HTMLElement | undefined;
  let openButton: HTMLButtonElement | undefined;
  const leftFrom = (event: Event) => {
    if (onPhone() || !entered() || asking()) return;
    if (event.target instanceof Node && searchElement?.contains(event.target)) return;
    afterPress(() => {
      if (!asking() && !searchElement?.contains(document.activeElement)) setEntered(false);
    });
  };
  document.addEventListener("pointerdown", leftFrom, true);
  document.addEventListener("focusin", leftFrom, true);
  onCleanup(() => {
    document.removeEventListener("pointerdown", leftFrom, true);
    document.removeEventListener("focusin", leftFrom, true);
  });

  /**
   * Enter the search from its button on a phone: its screen shows, with the caret in the field.
   * Offline it opens all the same, to the field that cannot be used and says why.
   */
  function enter() {
    setEntered(true);
    field?.focus();
  }

  // Wider than a phone, `/` puts the cursor in the field, unless it is typed where it is a `/`, or
  // the field is out of reach, under Attention opened in between.
  const onSlash = (event: KeyboardEvent) => {
    if (event.key !== "/" || !screenKey(event) || onPhone() || !online()) return;
    if (!field?.checkVisibility() || field.closest("[inert]")) return;
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
    <>
      {/* On a phone the field waits behind this button beside the Journal's title (section 8.4). */}
      <Show when={onPhone() && !shown()}>
        <button
          ref={openButton}
          type="button"
          class="icon-button search-open"
          aria-label="Open the search"
          onClick={enter}
        >
          <SearchIcon size={20} aria-hidden="true" />
        </button>
      </Show>
      <div class="journal-search" classList={{ shown: shown(), "in-use": inUse() }}>
        <search ref={searchElement} onKeyDown={endOnEscape}>
          <div class="search-row">
            <Show when={onPhone() && shown()}>
              <button
                type="button"
                class="icon-button search-back"
                aria-label="Back to the Journal"
                onClick={() => {
                  end();
                  // Back on the Journal, the person is where they opened the search from.
                  openButton?.focus();
                }}
              >
                <ArrowLeft size={20} aria-hidden="true" />
              </button>
            </Show>
            <label class="visually-hidden" for="journal-search-words">
              Search this Context
            </label>
            {/* A press anywhere on the pill puts the caret in its input, as on the input itself. */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: the pill is no control of its own: a press on it is a press on its input, which the keyboard and a screen reader reach directly. */}
            <div
              class="search-field"
              onMouseDown={(event) => {
                const pressed = event.target as Element;
                if (pressed === field || pressed.closest("button") || !field || field.disabled) {
                  return;
                }
                event.preventDefault();
                field.focus();
                setEntered(true);
              }}
            >
              <SearchIcon class="search-field-icon" size={18} aria-hidden="true" />
              <input
                ref={field}
                id="journal-search-words"
                type="search"
                // Within a Project, the field does not name it: the chip does, and a long name is cut.
                placeholder={
                  narrowing().project ? "Search within this Project" : `Search ${context()}`
                }
                autocomplete="off"
                aria-keyshortcuts={onPhone() ? undefined : "/"}
                aria-describedby={describedBy()}
                disabled={!online()}
                value={words()}
                onInput={(event) => typed(event.currentTarget.value)}
                onFocus={() => {
                  setFocused(true);
                  setEntered(true);
                }}
                // Folded by Escape with the caret kept in it, a press enters it again.
                onClick={() => setEntered(true)}
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
    </>
  );

  // Whether what is shown found nothing, so Nothing found says so and offers to lift each chip.
  const nothingFound = () => !searchingSaid() && hits()?.length === 0;
  const chipsKept = () => chipsSaid(shownNarrowing(), todayIn(props.timeZone));

  /**
   * The status: Searching… while an answer is slow, the count, or Nothing found, the words named,
   * so a typo shows, and for each chip set what it keeps out. Its offers to lift each chip follow
   * it, outside it, so a screen reader hears no button's word read into a sentence; each is drawn
   * beside what it lifts, on the row after it (styles.css, `.search-said`).
   */
  const Status = () => (
    <div class="search-status" role="status">
      <Show when={!searchingSaid()} fallback={<p class="search-count">Searching…</p>}>
        <Show when={hits()}>
          {(found) => (
            <Show
              when={found().length > 0}
              fallback={
                <>
                  <p class="search-nothing-title">
                    {hasWords({ words: shownWords() })
                      ? `Nothing found for “${shownWords().trim()}”`
                      : "Nothing found"}
                  </p>
                  <For each={chipsKept()}>
                    {(said, at) => (
                      <p class="search-nothing-kept" style={{ "grid-row": String(2 + 2 * at()) }}>
                        {said.kept}
                      </p>
                    )}
                  </For>
                </>
              }
            >
              <p class="search-count">
                {hasWords({ words: shownWords() })
                  ? `Found ${found().length}${nextCursor() === null ? "" : " and more"}`
                  : everythingSaid(shownNarrowing(), todayIn(props.timeZone))}
              </p>
            </Show>
          )}
        </Show>
      </Show>
    </div>
  );

  /** Each chip set, offered lifted, which reads the list again. */
  const Offers = () => (
    <For each={chipsKept()}>
      {(said, at) => (
        <button
          type="button"
          class="quiet search-lift"
          style={{ "grid-row": String(3 + 2 * at()) }}
          onClick={() => {
            narrow(lifted(narrowing(), said.chip));
            field?.focus();
          }}
        >
          {said.offer}
        </button>
      )}
    </For>
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
        <div
          class="search-said"
          classList={{ "search-nothing": nothingFound() }}
          style={{ "--said-rows": String(nothingFound() ? 1 + 2 * chipsKept().length : 1) }}
        >
          <Status />
          <Show when={nothingFound()}>
            <Offers />
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
            // While a newer search is out, what is shown is for the words before, and says so.
            <div class="search-shown" classList={{ stale: out() }} aria-busy={out()}>
              <SearchGroups
                hits={found()}
                words={shownWords()}
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
            </div>
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
    /** End the search, its words and its chips, as opening a hit does. */
    end,
    Field,
    Found,
  };
}

/** What a search asks: its words, and what its chips narrow it to. */
type Query = { words: string; narrowing: Narrowing };

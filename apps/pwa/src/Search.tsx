import { type Excerpt, type SearchHit, type WordsOnly, wordsOnlySaying } from "@praxis/domain";
import type { LucideIcon } from "lucide-solid";
import BookOpen from "lucide-solid/icons/book-open";
import Circle from "lucide-solid/icons/circle";
import Folder from "lucide-solid/icons/folder";
import User from "lucide-solid/icons/user";
import { createSignal, For, Index, onCleanup, Show } from "solid-js";
import { authorName } from "./authors.ts";
import { SectionTitle } from "./design/SectionTitle.tsx";
import { recordAnchor } from "./Journal.tsx";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { needsNetwork, useCallTool } from "./tools.ts";

/** Search runs on the server, over the whole Journal, so it needs the network (section 8.8). */
const SEARCH_NEEDS_NETWORK = "Search needs the network.";
/** What each kind of record a search finds is called. */
const KIND: Record<SearchHit["kind"], string> = {
  entry: "Entry",
  task: "Task",
  project: "Project",
  person: "Person",
};

/**
 * Search in the Journal column (sections 8.4 and 9.4): one field, and while it holds words, what
 * `search` finds in place of the Entries, from words and from meaning, and a line saying so when
 * it is from words alone. What is found is grouped by kind under Attention's headings, each hit
 * saying when it was made as the Journal's days do, and by whom when not by the person. An Entry
 * or a Task found is brought into view in the Journal. An excerpt is shown as plain text with what
 * matched marked, never as Markdown, since it is cut from the words wherever the match fell.
 *
 * The field and what is found are shown apart: the field above the column's scrolling body, so
 * nothing scrolls under it, and what is found inside it, where the Entries are.
 */
export function createSearch(props: {
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
  const [hits, setHits] = createSignal<SearchHit[] | null>(null);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [wordsOnly, setWordsOnly] = createSignal<WordsOnly | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  // Counts each first page shown or list cleared: a later page asked for before is from an older
  // answer, whose cursor reads the same as the newer one's, so it is dropped.
  let answers = 0;

  // Each change to the words asks afresh, and only the answer to the latest is shown.
  const { read: find, changed } = latestRead(async (current, asked: string) => {
    try {
      // Read once the live channel is open, so a change made meanwhile is either read or brought.
      await live.ready;
      const result = await callTool("search", { words: asked });
      // Emptied meanwhile, the field asks nothing: its answer would show under no words.
      if (!current() || words() !== asked) return;
      if (!result.ok) return setProblem(result.error.message);
      answers += 1;
      setProblem(null);
      setHits(result.value.items);
      setNextCursor(result.value.next_cursor);
      setWordsOnly(result.value.words_only);
    } catch (error) {
      if (current() && words() === asked) setProblem(needsNetwork(error, SEARCH_NEEDS_NETWORK));
    }
  });

  // What is found follows what changes, as the Journal does: a record deleted leaves the list, and
  // the list is read again from its first page.
  onCleanup(live.listen({ changed: refind, readAfresh: refind }));

  async function refind(): Promise<void> {
    if (asking()) await find(words());
  }

  const asking = () => words().trim() !== "";

  function ask(typed: string) {
    setWords(typed);
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
    void find(typed);
  }

  async function showMore(cursor: string) {
    const asked = words();
    const after = answers;
    const stillAsked = () => words() === asked && answers === after;
    try {
      const result = await callTool("search", { words: asked, cursor });
      if (!stillAsked()) return;
      if (!result.ok) return setProblem(result.error.message);
      setHits((shown) => [...(shown ?? []), ...result.value.items]);
      setNextCursor(result.value.next_cursor);
    } catch (error) {
      if (stillAsked()) setProblem(needsNetwork(error, SEARCH_NEEDS_NETWORK));
    }
  }

  function show(place: JournalPlace) {
    props.onShowInJournal(place.entry, place.anchor);
    ask("");
  }

  const Field = () => (
    <div class="journal-search">
      <search>
        <label class="visually-hidden" for="journal-search-words">
          Search this Context
        </label>
        <input
          id="journal-search-words"
          type="search"
          placeholder="Search"
          autocomplete="off"
          value={words()}
          onInput={(event) => ask(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && asking()) {
              event.preventDefault();
              ask("");
            }
          }}
        />
      </search>
    </div>
  );

  /** When a record found was made, and by whom when that is not the person. */
  const Made = (made: { hit: SearchHit }) => (
    <span class="search-made">
      <time datetime={made.hit.at}>{props.formatTime(made.hit.at)}</time>
      <Show when={authorShown(made.hit)}>{(author) => ` · ${author()}`}</Show>
    </span>
  );

  /**
   * One record found, its excerpt and when it was made in the order shown: an Entry's time over
   * its words, a Task's, a Project's and a Person's under its title, after its kind for a screen
   * reader. An Entry or a Task is a link that brings it into view in the Journal, named by what
   * it holds, so its name is its kind, its time and its excerpt, and every word it shows.
   */
  const Hit = (shown: { hit: SearchHit }) => {
    const hit = shown.hit;
    const parts =
      hit.kind === "entry"
        ? [<Made hit={hit} />, <ExcerptShown excerpt={hit.excerpt} />]
        : [<ExcerptShown excerpt={hit.excerpt} />, <Made hit={hit} />];
    const kind = <span class="visually-hidden">{KIND[hit.kind]}, </span>;
    const place = placeInJournal(hit);
    return (
      <li class={`search-hit search-${hit.kind}`} data-testid="search-hit">
        {place === null ? (
          // #122 and #123 make a Project or a Person found narrow the search to it.
          <span class="search-hit-body">
            {kind}
            {parts}
          </span>
        ) : (
          // #120 puts a Task's round control before its link.
          <a
            class="search-hit-body"
            href={`#${place.anchor}`}
            onClick={(event) => {
              event.preventDefault();
              show(place);
            }}
          >
            {kind}
            {parts}
          </a>
        )}
      </li>
    );
  };

  const Found = () => (
    <Show when={asking()}>
      <section class="search-found" aria-label="Found">
        <Show when={hits()}>
          {(found) => (
            <p class="search-count" role="status">
              {found().length === 0
                ? "Nothing found"
                : `Found ${found().length}${nextCursor() === null ? "" : " and more"}`}
            </p>
          )}
        </Show>
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
              <Index each={groupByKind(found())}>
                {(group) => (
                  <section
                    class={`search-group search-group-${group().kind}`}
                    aria-labelledby={`search-${group().kind}`}
                  >
                    <SectionTitle
                      id={`search-${group().kind}`}
                      title={group().title}
                      icon={group().icon}
                      count={group().hits.length}
                    />
                    <ol class="search-hits">
                      <For each={group().hits}>{(hit) => <Hit hit={hit} />}</For>
                    </ol>
                  </section>
                )}
              </Index>
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
    /** Whether what is found is shown, in place of the Entries. */
    shown: asking,
    Field,
    Found,
  };
}

/** A group of what a search found, under a heading of its own. */
export type FoundGroup = {
  kind: SearchHit["kind"];
  title: string;
  icon: LucideIcon;
  /** In the order the tool gave them. */
  hits: SearchHit[];
};

/** The groups what a search finds is shown in, in this order on every search (section 8.4). */
const GROUPS: Omit<FoundGroup, "hits">[] = [
  { kind: "project", title: "Projects", icon: Folder },
  { kind: "person", title: "Persons", icon: User },
  { kind: "task", title: "Tasks", icon: Circle },
  { kind: "entry", title: "Entries", icon: BookOpen },
];

/**
 * The one ranked list a search gives, every page shown of it, parted by kind into its groups: each
 * holds its hits in the tool's order, and a kind with none found has no group. The tool's list is
 * reordered for no other caller.
 */
export function groupByKind(hits: SearchHit[]): FoundGroup[] {
  // #119 sets the Entries found only by meaning apart, after the Entries.
  return GROUPS.map((group) => ({
    ...group,
    hits: hits.filter((hit) => hit.kind === group.kind),
  })).filter((group) => group.hits.length > 0);
}

/** Who made a record found, as the screen names them, when it is not the person. */
function authorShown(hit: SearchHit): string | null {
  if (hit.kind !== "entry" && hit.kind !== "task") return null;
  return hit.author.kind === "person" ? null : authorName(hit.author);
}

/** Where a record found is shown in the Journal: the Entry to read it on, and its anchor there. */
type JournalPlace = { entry: string; anchor: string };

/** Where a record found is in the Journal, or null for a Project or Person, which it never shows. */
function placeInJournal(hit: SearchHit): JournalPlace | null {
  switch (hit.kind) {
    case "entry":
      return { entry: hit.id, anchor: recordAnchor("entry", hit.id) };
    case "task":
      return { entry: hit.origin_entry, anchor: recordAnchor("task", hit.id) };
    default:
      return null;
  }
}

/** An excerpt as typed, with what matched marked: never rendered as Markdown (section 8.4). */
function ExcerptShown(props: { excerpt: Excerpt }) {
  const parts = () => {
    const { text, matches } = props.excerpt;
    const cut: { text: string; matched: boolean }[] = [];
    let from = 0;
    for (const { start, end } of matches) {
      if (start > from) cut.push({ text: text.slice(from, start), matched: false });
      cut.push({ text: text.slice(start, end), matched: true });
      from = end;
    }
    if (from < text.length) cut.push({ text: text.slice(from), matched: false });
    return cut;
  };
  return (
    <span class="search-excerpt" data-testid="search-excerpt">
      <Index each={parts()}>
        {(part) => (part().matched ? <mark>{part().text}</mark> : part().text)}
      </Index>
    </span>
  );
}

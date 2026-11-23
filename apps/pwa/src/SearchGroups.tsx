import type { SearchHit, WordsOnly } from "@praxis/domain";
import type { LucideIcon } from "lucide-solid";
import BookOpen from "lucide-solid/icons/book-open";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Circle from "lucide-solid/icons/circle";
import Folder from "lucide-solid/icons/folder";
import User from "lucide-solid/icons/user";
import { For, Index, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { SectionTitle } from "./design/SectionTitle.tsx";
import { Hit, type HitActions } from "./SearchHit.tsx";
import { type FoundGroup, groupByKind } from "./search-groups.ts";

/** Each group's icon, as Attention's headings have; Close in meaning has none, set apart by its hairline and its line. */
const ICON: Record<FoundGroup["kind"], LucideIcon | undefined> = {
  project: Folder,
  person: User,
  task: Circle,
  entry: BookOpen,
  meaning: undefined,
};

/**
 * What a search found, every page shown of it, in its groups by kind under Attention's headings,
 * each with its count. Close in meaning is folded while anything holds the words, behind a button
 * that unfolds it, and shown unfolded when nothing does.
 */
export function SearchGroups(props: {
  hits: SearchHit[];
  words: string;
  wordsOnly: WordsOnly | null;
  /** Whether Close in meaning was unfolded, for these words. */
  unfolded: boolean;
  onToggleMeaning: () => void;
  actions: HitActions;
}) {
  const groups = () =>
    groupByKind({ hits: props.hits, words: props.words, wordsOnly: props.wordsOnly });
  const foldable = () => groups().some((group) => group.kind !== "meaning");
  const folded = (group: FoundGroup) => group.kind === "meaning" && foldable() && !props.unfolded;
  return (
    <Index each={groups()}>
      {(group) => (
        <section
          class={`search-group search-group-${group().kind}`}
          aria-labelledby={`search-${group().kind}`}
        >
          <SectionTitle
            id={`search-${group().kind}`}
            title={group().title}
            icon={ICON[group().kind]}
            count={group().hits.length}
          />
          <Show when={group().kind === "meaning"}>
            <p class="search-meaning-note">
              These hold none of the words, but are about something close.
            </p>
            <Show when={foldable()}>
              <MeaningFold
                count={group().hits.length}
                unfolded={props.unfolded}
                controls={`search-${group().kind}-hits`}
                onToggle={props.onToggleMeaning}
              />
            </Show>
          </Show>
          {/* Folded, the list is there and hidden, so the fold controls what it names. */}
          <ol class="search-hits" id={`search-${group().kind}-hits`} hidden={folded(group())}>
            <For each={group().hits}>{(hit) => <Hit hit={hit} actions={props.actions} />}</For>
          </ol>
        </section>
      )}
    </Index>
  );
}

/** The button that unfolds Close in meaning, and folds it again, saying how many it holds. */
function MeaningFold(props: {
  count: number;
  unfolded: boolean;
  /** The id of the list it shows. */
  controls: string;
  onToggle: () => void;
}) {
  const Chevron = () => (props.unfolded ? ChevronUp : ChevronDown);
  return (
    <button
      type="button"
      class="search-fold"
      aria-expanded={props.unfolded}
      aria-controls={props.controls}
      onClick={() => props.onToggle()}
    >
      {props.unfolded ? "Hide" : "Show"} {props.count} {props.count === 1 ? "Entry" : "Entries"}
      <Dynamic component={Chevron()} class="search-fold-chevron" size={14} aria-hidden="true" />
    </button>
  );
}

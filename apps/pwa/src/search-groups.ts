import { hasWords, type SearchHit, type WordsOnly } from "@praxis/domain";

/** A group of what a search found, under a heading of its own. */
export type FoundGroup = {
  /** The kind of record it holds, or `meaning` for the Entries found only by meaning. */
  kind: SearchHit["kind"] | "meaning";
  title: string;
  /** In the order the tool gave them. */
  hits: SearchHit[];
};

/** The groups what a search finds is shown in, in this order on every search (section 8.4). */
const GROUPS: Omit<FoundGroup, "hits">[] = [
  { kind: "project", title: "Projects" },
  { kind: "person", title: "Persons" },
  { kind: "task", title: "Tasks" },
  { kind: "entry", title: "Entries" },
];

/** The Entries found only by meaning, set apart after the Entries that hold the words. */
const CLOSE_IN_MEANING: Omit<FoundGroup, "hits"> = { kind: "meaning", title: "Close in meaning" };

/**
 * The one ranked list a search gives, every page shown of it, parted by kind into its groups: each
 * holds its hits in the tool's order, and a kind with none found has no group. The tool's list is
 * reordered for no other caller.
 *
 * Where words were given and the answer is not from words alone, meaning was asked with them: an
 * Entry in which nothing matched was found only by meaning, and goes after the Entries, under Close
 * in meaning, and one found both ways stays with the words. With no words, or an answer from words
 * alone, there is no such group.
 */
export function groupByKind(found: {
  hits: SearchHit[];
  words: string;
  wordsOnly: WordsOnly | null;
}): FoundGroup[] {
  const byMeaning = hasWords(found) && found.wordsOnly === null;
  const onlyByMeaning = (hit: SearchHit) =>
    byMeaning && hit.kind === "entry" && hit.excerpt.matches.length === 0;
  return [
    ...GROUPS.map((group) => ({
      ...group,
      hits: found.hits.filter((hit) => hit.kind === group.kind && !onlyByMeaning(hit)),
    })),
    { ...CLOSE_IN_MEANING, hits: found.hits.filter(onlyByMeaning) },
  ].filter((group) => group.hits.length > 0);
}

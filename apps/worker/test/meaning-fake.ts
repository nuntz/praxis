import { MEANING_DIMENSIONS, type MeaningIndex } from "../src/meaning.ts";

// The meaning index is one of the faked things (section 13): Workers AI's embeddings and the
// Vectorize index they are kept in. The fake runs in the tests' own isolate, as the scripted model
// does, so a test says which words mean alike and reads what each Context's part holds.
//
// It embeds a text by the meanings its words carry: each group of words a test has said mean alike
// is one meaning, and a word in no group carries none. Two texts are as alike as the meanings they
// share, so a search for "dentist" finds an Entry about a molar once a test has said the two mean
// alike, and finds nothing by meaning otherwise. It keeps embeddings only, never words, and answers
// at once.

/** The groups of words that mean alike, each by the slot of its meaning in an embedding. */
const meanings = new Map<string, number>();

/** Each Context's part of the index: the embedding of each Entry in it. */
const parts = new Map<string, Map<string, number[]>>();

let present = true;
let failing = false;
/** While held, embedding waits until the test lets it go. */
let held: Promise<void> | null = null;

/**
 * Say these words mean alike: an embedding of any of them carries one meaning. A word keeps the
 * first group it was put in. Say so before the Entries are saved: one embedded before would keep
 * an embedding the fake no longer gives its words, which the oracle finds.
 */
export function meanAlike(...words: string[]): void {
  const slot = new Set(meanings.values()).size;
  if (slot >= MEANING_DIMENSIONS) throw new Error("The fake has no room for another meaning");
  for (const word of words) {
    const key = word.toLowerCase();
    if (!meanings.has(key)) meanings.set(key, slot);
  }
}

/** The fake's embedding of a text: the meanings its words carry, as a unit vector. */
export function fakeEmbedding(text: string): number[] {
  const embedding = new Array<number>(MEANING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const slot = meanings.get(word);
    if (slot !== undefined) embedding[slot] = 1;
  }
  const length = Math.hypot(...embedding);
  return length === 0 ? embedding : embedding.map((value) => value / length);
}

function likeness(a: number[], b: number[]): number {
  return a.reduce((sum, value, at) => sum + value * (b[at] ?? 0), 0);
}

function partOf(context: string): Map<string, number[]> {
  let part = parts.get(context);
  if (part === undefined) {
    part = new Map();
    parts.set(context, part);
  }
  return part;
}

function check(): void {
  if (failing) throw new Error("The fake meaning index is unreachable, as the test asked");
}

export const fakeMeaning: MeaningIndex = {
  async embed(texts) {
    check();
    const embeddings = texts.map(fakeEmbedding);
    await held;
    return embeddings;
  },
  async put(context, embeddings) {
    check();
    const part = partOf(context);
    for (const { entry, embedding } of embeddings) part.set(entry, embedding);
  },
  async remove(context, entries) {
    check();
    const part = partOf(context);
    for (const entry of entries) part.delete(entry);
  },
  async nearest(context, embedding, count) {
    check();
    return [...partOf(context)]
      .map(([entry, held]) => ({ entry, likeness: likeness(embedding, held) }))
      .sort((a, b) => b.likeness - a.likeness)
      .slice(0, count);
  },
};

/** The meaning index of the test's Deployment: the fake, or none while a test stands for one without. */
export function testMeaning(): MeaningIndex | null {
  return present ? fakeMeaning : null;
}

/** What a Context's part of the index holds: each Entry's embedding, by its id, as a copy. */
export function heldEmbeddings(context: string): Map<string, number[]> {
  return new Map(parts.get(context) ?? []);
}

/** Stand for a Deployment with no meaning index, or with one again. */
export function setMeaningPresent(to: boolean): void {
  present = to;
}

/** Make the meaning index fail every call, as an outage would, or answer again. */
export function setMeaningFailing(to: boolean): void {
  failing = to;
}

/**
 * Hold every embedding begun from now until the returned function lets them go, so a test can
 * change an Entry while its words, as they were, are being embedded.
 */
export function holdEmbedding(): () => void {
  let release = () => {};
  held = new Promise((resolve) => {
    release = () => {
      held = null;
      resolve();
    };
  });
  return release;
}

/** Forget which words mean alike, for the next test. Each Context's part is its own. */
export function forgetMeanings(): void {
  meanings.clear();
}

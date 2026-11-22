/**
 * How the named views order what they list, Attention's sections and the weeks ahead: by keys
 * compared part by part. Kept apart from the package's exports, since no caller orders anything.
 */

/** Something listed, with what it is ordered by. */
export type Sorted<T> = { item: T; by: (string | number)[] };

/** The items in the order of what they are sorted by, earliest first, in the order given on a tie. */
export function inOrder<T>(sorted: Sorted<T>[]): T[] {
  return sorted.toSorted((a, b) => compare(a.by, b.by)).map(({ item }) => item);
}

/**
 * Two keys, part by part. Days and ISO 8601 instants compare as text in the order they fall, and
 * an instant held as milliseconds as a number.
 */
export function compare(a: (string | number)[], b: (string | number)[]): number {
  for (const [index, part] of a.entries()) {
    const other = b[index] as string | number;
    if (part !== other) return part < other ? -1 : 1;
  }
  return 0;
}

/**
 * A seeded source of numbers in [0, 1) (mulberry32), so every run draws the same: what a test over
 * orderings or edits draws from (CODING_STANDARDS.md, Reads and changes).
 */
export function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

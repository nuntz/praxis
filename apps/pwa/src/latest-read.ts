/**
 * A read whose last answer wins (CODING_STANDARDS.md, Reads and changes). Each read is numbered:
 * `current()` turns false once a later read is sent or the screen changes what the read shows, and
 * the read drops its answer then, checking `current()` after each wait and before showing
 * anything. A read whose answer a change overtook is sent again, with the same arguments, since
 * that answer is from before the change. The one way to invalidate a read is another read or
 * `changed()`, so no answer is ever dropped without a read to replace it.
 */
export type LatestRead<A extends unknown[]> = {
  /** Read, dropping the answer of any read still out. */
  read: (...args: A) => Promise<void>;
  /**
   * The screen changed what the read shows, by a write of its own: a read still out answers from
   * before it, so it is sent again.
   */
  changed: () => void;
};

export function latestRead<A extends unknown[] = []>(
  read: (current: () => boolean, ...args: A) => Promise<unknown>,
): LatestRead<A> {
  let reads = 0;
  let changes = 0;

  async function send(...args: A): Promise<void> {
    reads += 1;
    const mine = reads;
    const before = changes;
    await read(() => mine === reads && changes === before, ...args);
    // Overtaken by a change and by no later read: read again, or the answer from before stands.
    if (mine === reads && changes !== before) await send(...args);
  }

  return {
    read: send,
    changed() {
      changes += 1;
    },
  };
}

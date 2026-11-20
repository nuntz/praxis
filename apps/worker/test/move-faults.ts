// What a test makes go wrong when a unit is moved into a Context (section 3.9), which the test
// Worker's ContextObject (test/worker.ts) reads: the plugin runs it in the tests' own isolate.
// A Context's object can be made to fail taking one, before it takes it or after, as when the
// answer is lost. One stuck on its upgrade is made so by test/upgrade-faults.ts.

/** For each Context by id, how its next attempts at taking a move fail, in order. */
const failing = new Map<string, ("before" | "after")[]>();

/**
 * The next `times` attempts to move a unit into the Context with this id fail: before it takes
 * the unit, or after, so the unit is in and the answer never reaches whoever asked.
 */
export function failMovesInto(id: string, times: number, when: "before" | "after"): void {
  failing.set(id, [...(failing.get(id) ?? []), ...Array.from({ length: times }, () => when)]);
}

/** Nothing goes wrong from here on, for the next test. */
export function clearMoveFaults(): void {
  failing.clear();
}

/** How the next attempt at taking a move into the Context with this id fails, if it does. */
export function nextMoveFault(id: string): "before" | "after" | null {
  const ahead = failing.get(id);
  return ahead?.shift() ?? null;
}

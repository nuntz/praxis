import type { Step } from "../src/steps/index.ts";

// What a test makes go wrong in an object's upgrade (section 11), which the test Worker's objects
// read as they wake: the plugin runs them in the tests' own isolate. An object can be given steps
// of a release still to come at the top of its ladder, such as one that fails, and every object
// wakes under the release the test names.

/** The steps given to the object with each id, above the release's own. */
const added = new Map<string, Step[]>();

/** The release objects wake under, or none, as when the deploy names none. */
let release = "";

/**
 * A step that fails part-way: it has made a table, changed the shape of another and a row, then
 * throws, so its transaction leaves the object as it was.
 */
export const failingStep: Step = (sql) => {
  sql.exec(`CREATE TABLE made_by_a_failing_step (never_kept TEXT)`);
  sql.exec(`ALTER TABLE ladder ADD COLUMN never_kept TEXT`);
  sql.exec(`UPDATE ladder SET never_kept = 'kept by no step that finished'`);
  throw new Error("A step made to fail");
};

/** Give the object with this id these steps at the top of its ladder when it next wakes. */
export function addSteps(id: string, ...steps: Step[]): void {
  added.set(id, [...(added.get(id) ?? []), ...steps]);
}

/** The object with this id wakes with its ladder as the release has it, as once a fix is deployed. */
export function mendSteps(id: string): void {
  added.delete(id);
}

/** Objects wake under this release from now on. */
export function wakeUnder(named: string): void {
  release = named;
}

/** The release objects wake under, as the deploy would name it: none unless a test named one. */
export function testRelease(): string {
  return release;
}

/** The ladder of the object with this id: the release's, and the steps a test gave it. */
export function ladderOf(ladder: readonly Step[], id: string): readonly Step[] {
  const more = added.get(id);
  return more === undefined ? ladder : [...ladder, ...more];
}

/** Nothing goes wrong from here on, for the next test. */
export function clearUpgradeFaults(): void {
  added.clear();
  release = "";
}

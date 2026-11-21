import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hashOf,
  hashProblems,
  type Instead,
  lastReleased,
  released,
  releasedSince,
  root,
} from "./released.ts";

// The guard of what the screen stores for a later load (section 8.8, CODING_STANDARDS.md,
// Upgrades): each shape a release stored under a key is a fixture in apps/pwa/test/stored/, which
// apps/pwa/test/stored.test.ts reads through the current screen's reader. A fixture released is
// never edited or dropped, or a later release could stop reading what an earlier one stored with
// nothing failing: `released.json` there keeps the hash of each as it was released, held to the
// last release's too (lint/released.ts). A new fixture goes in with its hash in the same change.

const fixtures = "apps/pwa/test/stored";

const INSTEAD: Instead = {
  edited: "a new shape is a new fixture",
  dropped: "no fixture is dropped",
};

/** Each fixture in the repo, by name, with its text: every file there but the hashes. */
function fixtureFiles(): Map<string, string> {
  return new Map(
    readdirSync(join(root, fixtures))
      .filter((file) => file !== "released.json")
      .map((file) => [file, readFileSync(join(root, fixtures, file), "utf8")]),
  );
}

describe("the stored shapes' guard", () => {
  test("every fixture is as it was released, and none is gone", () => {
    expect(hashProblems(fixtureFiles(), released(fixtures), INSTEAD)).toEqual([]);
  });

  test("every hash the last release had is still there, unchanged", () => {
    expect(releasedSince(lastReleased(fixtures) ?? {}, released(fixtures), INSTEAD)).toEqual([]);
  });

  test("fails a released fixture edited or dropped, and one with no hash", () => {
    const text = '["a"]\n';
    const hashes = { "praxis.unsent-0001.txt": hashOf(text) };
    const files = new Map([["praxis.unsent-0001.txt", text]]);
    expect(hashProblems(files, hashes, INSTEAD)).toEqual([]);
    expect(hashProblems(new Map([["praxis.unsent-0001.txt", '["b"]\n']]), hashes, INSTEAD)).toEqual(
      [`praxis.unsent-0001.txt was released and has changed since: ${INSTEAD.edited}`],
    );
    expect(hashProblems(new Map(), hashes, INSTEAD)).toEqual([
      `praxis.unsent-0001.txt was released and is gone: ${INSTEAD.dropped}`,
    ]);
    expect(hashProblems(files, {}, INSTEAD)).toEqual([
      `praxis.unsent-0001.txt has no hash in released.json: add ${hashOf(text)}`,
    ]);
  });
});

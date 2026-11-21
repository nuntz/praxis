import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readStored, STORED_KEYS, type StoredKey, store } from "../src/stored.ts";
import { offline0001, unsent0002 } from "./stored-reads.ts";

// What the screen stores on a Device for a later load is read by every later release as it was
// stored (section 8.8, CODING_STANDARDS.md, Upgrades). Each shape a release stored under a key is
// a fixture in test/stored/, named by the key and numbered, its text as stored with a newline
// after it. lint/stored.test.ts holds a released fixture to its hash, so it is never edited: a
// release that changes a shape adds a fixture of the new one. Here each is read through the
// screen's own reader, and what it reads as is written out below by hand, in the current shape.

const fixtures = join(import.meta.dir, "stored");

/** A fixture's name: its key and its number. */
const FIXTURE = /^(praxis\.[a-z]+)-(\d{4})\.txt$/;

/** What each fixture reads as under the current screen. */
const READS_AS: Record<string, unknown> = {
  "praxis.unsent-0001.txt": [
    {
      id: "5b0d2c1e-7a4f-4c39-9e61-3f2a8d7b4c10",
      context: "ctx-home",
      key: "00000000-0000-4000-8000-000000000001",
      keyed_at: "2026-11-20T08:15:00.000Z",
      made_at: "2026-11-20T08:15:00.000Z",
      refused: null,
      kind: "entry",
      words: "Written in the tunnel\n[] Post the form",
      tasks: [{ title: "Post the form" }],
      // Kept with no Offline Copy, before an Unsent Entry could take either.
      links: [],
      follow_up_to: null,
    },
    {
      id: "9c4e1f7a-2b6d-4e83-8f15-0a3c7d9e2b42",
      context: "ctx-home",
      key: "00000000-0000-4000-8000-000000000002",
      keyed_at: "2026-11-20T08:20:00.000Z",
      made_at: "2026-11-20T08:20:00.000Z",
      refused: null,
      kind: "finish",
      task: { id: "task-renew", title: "Renew the passport" },
    },
    {
      id: "e2a7b9c4-6f1d-4a58-b3e2-8d0c5f7a1e94",
      context: "ctx-work",
      key: "00000000-0000-4000-8000-000000000003",
      keyed_at: "2026-11-19T17:02:00.000Z",
      made_at: "2026-11-19T17:02:00.000Z",
      refused: "The Context was retired.",
      kind: "entry",
      words: "Call back about the lease",
      tasks: [],
      links: [],
      follow_up_to: null,
    },
  ],
  "praxis.unsent-0002.txt": unsent0002,
  "praxis.contexts-0001.txt": [
    { id: "ctx-home", name: "Home", accent: "teal", retired: false },
    { id: "ctx-work", name: "Work", accent: "rust", retired: true },
  ],
  "praxis.context-0001.txt": "ctx-home",
  "praxis.device-0001.txt": "4a9e2c7b-3d1f-4b85-a6e0-9f2c8d5b7e13",
  "praxis.offline-0001.txt": offline0001,
};

/** Each fixture, by name, with its key and the text stored. */
function fixtureFiles(): { name: string; key: string; number: number; text: string }[] {
  return readdirSync(fixtures).flatMap((name) => {
    const match = FIXTURE.exec(name);
    if (!match?.[1] || !match[2]) return [];
    const text = readFileSync(join(fixtures, name), "utf8").replace(/\n$/, "");
    return [{ name, key: match[1], number: Number(match[2]), text }];
  });
}

/** This browser's storage, as the test's own map. */
const kept = new Map<string, string>();

beforeEach(() => {
  kept.clear();
  globalThis.localStorage = {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  } as Storage;
});

describe("what the screen stores for a later load", () => {
  test("every stored key has a fixture of each shape released, numbered with no gap", () => {
    const files = fixtureFiles();
    expect(
      readdirSync(fixtures).filter((name) => !FIXTURE.test(name) && name !== "released.json"),
    ).toEqual([]);
    for (const key of STORED_KEYS) {
      const numbers = files
        .filter((file) => file.key === key)
        .map((file) => file.number)
        .toSorted((a, b) => a - b);
      expect({ key, numbers }).toEqual({ key, numbers: numbers.map((_, place) => place + 1) });
      expect({ key, fixtures: numbers.length }).not.toEqual({ key, fixtures: 0 });
    }
    expect(files.map((file) => file.key).filter((key) => !isStoredKey(key))).toEqual([]);
  });

  test("every fixture reads through the screen's own reader as written out here", () => {
    const files = fixtureFiles();
    expect(files.map((file) => file.name).toSorted()).toEqual(Object.keys(READS_AS).toSorted());
    for (const file of files) {
      kept.set(file.key, file.text);
      expect({ [file.name]: readStored(file.key as StoredKey) as unknown }).toEqual({
        [file.name]: READS_AS[file.name],
      });
    }
  });

  test("the current screen stores each key in the shape of its last fixture", () => {
    const files = fixtureFiles();
    for (const key of STORED_KEYS) {
      const last = files
        .filter((file) => file.key === key)
        .toSorted((a, b) => b.number - a.number)[0];
      if (!last) throw new Error(`${key} has no fixture`);
      kept.set(key, last.text);
      expect(store(key, readStored(key) as never)).toBe(true);
      // A release that stores another shape adds a fixture of it.
      expect({ [key]: kept.get(key) }).toEqual({ [key]: last.text });
    }
  });

  test("an Unsent write the screen cannot read is not shown, and is kept when the rest are stored", () => {
    const later = { id: "w-later", kind: "photo", made_at: "2026-11-20T09:00:00.000Z" };
    const readable = (READS_AS["praxis.unsent-0001.txt"] as unknown[])[0];
    kept.set("praxis.unsent", JSON.stringify([readable, later]));
    expect(readStored("praxis.unsent")).toEqual([readable as never]);

    expect(store("praxis.unsent", [])).toBe(true);
    expect(JSON.parse(kept.get("praxis.unsent") ?? "null")).toEqual([later]);
  });
});

describe("an Unsent Entry as stored", () => {
  test("one whose links or Follow-up the screen cannot read is not shown, and is kept", () => {
    const [entry] = unsent0002;
    const unreadable = [
      { ...entry, links: [{ to: { kind: "new_person", name: "Ana" }, anchor: null }] },
      {
        ...entry,
        links: [{ to: { kind: "person", id: "p", summary: "P" }, anchor: { start: 1 } }],
      },
      { ...entry, follow_up_to: { id: "entry-passport" } },
      { ...entry, links: "none" },
    ];
    kept.set("praxis.unsent", JSON.stringify(unreadable));
    expect(readStored("praxis.unsent")).toEqual([]);

    expect(store("praxis.unsent", [])).toBe(true);
    expect(JSON.parse(kept.get("praxis.unsent") ?? "null")).toEqual(unreadable);
  });
});

describe("the Offline Copy as stored", () => {
  test("one the screen cannot read is read as none, to be fetched again", () => {
    const [context] = offline0001.contexts;
    for (const stored of [
      { ...offline0001, contexts: [{ ...context, fetched_at: 7 }] },
      { ...offline0001, contexts: [{ ...context, entries: [{ id: "e" }] }] },
      {
        ...offline0001,
        contexts: [{ ...context, tasks: [{ ...context?.tasks[0], state: { is: "lost" } }] }],
      },
      "not a copy",
    ]) {
      kept.set("praxis.offline", JSON.stringify(stored));
      expect({ stored, read: readStored("praxis.offline") }).toEqual({ stored, read: null });
    }
  });

  test("what it holds besides a record's own fields is not read, and not stored again", () => {
    const [context] = offline0001.contexts;
    if (!context) throw new Error("The fixture holds a Context");
    const conversation = { id: "msg-1", words: "Said to the Agent" };
    const stored = {
      ...offline0001,
      messages: [conversation],
      contexts: [{ ...context, messages: [conversation] }],
    };
    kept.set("praxis.offline", JSON.stringify(stored));

    expect(readStored("praxis.offline")).toEqual(offline0001 as never);
  });
});

function isStoredKey(key: string): key is StoredKey {
  return (STORED_KEYS as readonly string[]).includes(key);
}

import { describe, expect, test } from "bun:test";
import {
  type ConnectionCall,
  conversationToolNames,
  conversationTools,
  type Effect,
  toolNames,
  tools,
} from "@praxis/domain";
import { changeCaller, effectLines, effectWords, readWords } from "../src/change-words.ts";

// How Changes says what happened (section 8.6): each Effect as stored, read with the tool of the
// change it is in, in the glossary's words.

const effect = (over: Partial<Effect>): Effect => ({
  kind: "entry",
  id: "e1",
  what: "made",
  summary: "Called the plumber",
  by: "call",
  ...over,
});

describe("effectWords", () => {
  test("a record made or changed says so", () => {
    expect(effectWords("record_entry", effect({}))).toBe("Entry made");
    expect(effectWords("edit_entry", effect({ what: "changed" }))).toBe("Entry changed");
  });

  test("a record deleted by a delete went to the Trash", () => {
    expect(effectWords("delete_entry", effect({ what: "deleted" }))).toBe(
      "Entry sent to the Trash",
    );
    expect(effectWords("delete_project", effect({ kind: "project", what: "deleted" }))).toBe(
      "Project sent to the Trash",
    );
    expect(effectWords("delete_entry", effect({ kind: "task", what: "deleted", by: "rule" }))).toBe(
      "Task sent to the Trash by a rule",
    );
    // The tap on a Held Change that deletes makes the delete the Agent asked for.
    expect(effectWords("make_held_change", effect({ what: "deleted" }))).toBe(
      "Entry sent to the Trash",
    );
  });

  test("a record made by a restore came back from the Trash", () => {
    expect(effectWords("restore", effect({}))).toBe("Entry restored from the Trash");
  });

  test("a record deleted from the Trash is removed for good, with its words", () => {
    const removed = effect({ what: "deleted", summary: "" });
    expect(effectWords("remove_for_good", removed)).toBe(
      "Entry removed for good: its words are gone",
    );
    expect(effectWords("empty_trash", { ...removed, kind: "task", by: "rule" })).toBe(
      "Task removed for good by a rule: its words are gone",
    );
  });

  test("an Entry changed by a restore of a Version has that Version's words", () => {
    expect(effectWords("restore_entry_version", effect({ what: "changed" }))).toBe(
      "Entry words restored to a Version",
    );
  });

  test("a Held Change is left, made by the tap, cancelled or lapsed", () => {
    const held = (over: Partial<Effect>) => effect({ kind: "held_change", ...over });
    expect(effectWords("edit_entry", held({}))).toBe("Held Change left");
    expect(effectWords("make_held_change", held({ what: "deleted" }))).toBe(
      "Held Change made by your tap",
    );
    expect(effectWords("cancel_held_change", held({ what: "deleted" }))).toBe(
      "Held Change cancelled",
    );
    expect(effectWords("edit_entry", held({ what: "deleted", by: "rule" }))).toBe(
      "Held Change lapsed",
    );
    // A tap on one lapses the others on its Entry.
    expect(effectWords("make_held_change", held({ what: "deleted", by: "rule" }))).toBe(
      "Held Change lapsed",
    );
  });

  test("what is no record keeps its stored words, the spend cap as the glossary writes it", () => {
    expect(effectWords("delete_context", effect({ kind: "context", what: "deleted" }))).toBe(
      "Context deleted",
    );
    expect(effectWords("set_spend_cap", effect({ kind: "spend_cap", what: "changed" }))).toBe(
      "The spend cap changed",
    );
  });
});

describe("changeCaller", () => {
  test("a change is named by its caller", () => {
    expect(changeCaller({ kind: "hand" }, "record_entry")).toBe("You");
    expect(changeCaller({ kind: "agent" }, "edit_entry")).toBe("The Agent");
    expect(changeCaller({ kind: "clock" }, "add_task")).toBe("The clock");
    expect(changeCaller({ kind: "connection", id: "c1", name: "Claude" }, "record_entry")).toBe(
      "Claude",
    );
  });

  test("the person's tap on a Held Change makes the change for the Agent", () => {
    expect(changeCaller({ kind: "hand" }, "make_held_change")).toBe("You, for the Agent");
    // A cancel is the person's own.
    expect(changeCaller({ kind: "hand" }, "cancel_held_change")).toBe("You");
  });
});

describe("effectLines", () => {
  const task = (id: string, over: Partial<Effect> = {}) =>
    effect({ kind: "task", id, what: "deleted", summary: `Task ${id}`, by: "rule", ...over });

  test("a rule's Effects of one kind and what fold into one line, the call's stay one each", () => {
    const lines = effectLines("delete_entry", [
      effect({ what: "deleted" }),
      task("t1"),
      task("t2"),
      task("t3"),
      effect({ kind: "held_change", id: "h1", what: "deleted", summary: "Edit", by: "rule" }),
      task("t4", { what: "changed" }),
    ]);
    expect(lines).toEqual([
      { kind: "one", words: "Entry sent to the Trash", summary: "Called the plumber" },
      {
        kind: "folded",
        words: "and 3 Tasks sent to the Trash by a rule",
        summaries: ["Task t1", "Task t2", "Task t3"],
      },
      { kind: "one", words: "Held Change lapsed", summary: "Edit" },
      { kind: "one", words: "Task changed by a rule", summary: "Task t4" },
    ]);
  });

  test("a fold holds only the Effects together, so each item emptied keeps its own", () => {
    const gone = (over: Partial<Effect>) => effect({ what: "deleted", summary: "", ...over });
    const lines = effectLines("empty_trash", [
      gone({ id: "e1" }),
      gone({ kind: "task", id: "t1", by: "rule" }),
      gone({ kind: "task", id: "t2", by: "rule" }),
      gone({ id: "e2" }),
      gone({ kind: "task", id: "t3", by: "rule" }),
      gone({ kind: "task", id: "t4", by: "rule" }),
    ]);
    expect(lines.map((line) => line.words)).toEqual([
      "Entry removed for good: its words are gone",
      "and 2 Tasks removed for good by a rule: their words are gone",
      "Entry removed for good: its words are gone",
      "and 2 Tasks removed for good by a rule: their words are gone",
    ]);
  });

  test("Effects the call made itself never fold", () => {
    const lines = effectLines("remove_for_good", [
      effect({ what: "deleted", summary: "" }),
      effect({ id: "e2", what: "deleted", summary: "" }),
    ]);
    expect(lines.map((line) => line.kind)).toEqual(["one", "one"]);
  });

  test("a fold that leads the change has no and, and words gone are theirs", () => {
    const gone = (id: string) => task(id, { summary: "" });
    expect(effectLines("empty_trash", [gone("t1"), gone("t2")])).toEqual([
      {
        kind: "folded",
        words: "2 Tasks removed for good by a rule: their words are gone",
        summaries: ["", ""],
      },
    ]);
  });
});

describe("readWords", () => {
  const read = (over: Partial<ConnectionCall>): ConnectionCall => ({
    at: "2026-11-27T09:00:00.000Z",
    caller: { kind: "connection", id: "c1", name: "Claude" },
    tool: "search",
    kind: "read",
    result: "ok",
    records: 3,
    ...over,
  });

  test("a read is named in words, with how many records came back", () => {
    expect(readWords(read({}))).toBe("Searched: 3 records");
    expect(readWords(read({ tool: "list_entries", records: 1 }))).toBe("Listed Entries: 1 record");
    expect(readWords(read({ tool: "get_entry", records: 1 }))).toBe("Read an Entry: 1 record");
  });

  test("an answer other than ok is said in a sentence", () => {
    expect(readWords(read({ result: "invalid_input", records: 0 }))).toBe(
      "Searched: the request was malformed",
    );
  });

  test("a name that is no tool of Praxis's is said as none", () => {
    expect(readWords(read({ tool: null, kind: null, result: "not_found", records: 0 }))).toBe(
      "Called a tool Praxis does not have",
    );
  });

  test("every read tool has its words, and every answer its sentence", () => {
    const reads = [
      ...toolNames.filter((name) => tools[name].kind === "read"),
      ...conversationToolNames.filter((name) => conversationTools[name].kind === "read"),
    ];
    expect(reads.length).toBeGreaterThan(20);
    for (const tool of reads) {
      expect(readWords(read({ tool }))).not.toContain(tool);
    }
    for (const result of ["not_found", "not_offered", "held", "stale", "refused"] as const) {
      const [, answered = ""] = readWords(read({ result })).split(": ");
      expect(answered.split(" ").length).toBeGreaterThan(2);
    }
  });
});

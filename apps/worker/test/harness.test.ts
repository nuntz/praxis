import type { Change, Effect, ToolResult } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { forget, leakedMarkers, logs, marked } from "./markers.ts";
import { answering, forgetSuperseded, scriptModel, supersededScripts } from "./model-fake.ts";
import { judge, judgeDeployment, type Records, type Seen, type SeenDeployment } from "./oracle.ts";
import { agent, connection, hand, newContext, value } from "./seam.ts";

// The harness is what every seam test leans on, so it is tested for what it must catch.

const at = "2026-11-15T09:00:00.000Z";
const made: Effect = { kind: "entry", id: "e1", what: "made", summary: "Words", by: "call" };
const record = { id: "e1", words: "Words" };

function records(entries: Record<string, string> = {}): Records {
  return new Map(Object.entries(entries).map(([id, row]) => [`entry:${id}`, row]));
}

function logged(effects: Effect[], caller: Change["caller"] = hand): Change[] {
  return [{ at, caller, tool: "record_entry", effects }];
}

/** A record_entry by the hand that made one Entry and said so, as it should. */
function aGoodWrite(): Seen {
  return {
    request: { caller: hand, tool: "record_entry", input: {}, arrivedAt: Date.parse(at) },
    result: { ok: true, value: { record, effects: [made], changed: true } },
    before: records(),
    after: records({ e1: "row" }),
    logged: logged([made]),
    firstWithKey: null,
  };
}

/**
 * The Agent's edit_entry on the person's words, which left a Held Change, and with it changed
 * these Effects too, reported and logged.
 */
function aHeldCall(alsoChanged: Effect[]): Seen {
  const left: Effect = {
    kind: "held_change",
    id: "h1",
    what: "made",
    summary: "Edit your Entry's words",
    by: "call",
  };
  const effects = [left, ...alsoChanged];
  return {
    request: { caller: agent, tool: "edit_entry", input: {}, arrivedAt: Date.parse(at) },
    result: { ok: true, value: { record: { id: "h1" }, effects, changed: true, held: true } },
    before: records({ e1: "row" }),
    after: new Map([
      ["entry:e1", alsoChanged.length > 0 ? "row, changed" : "row"],
      ["held_change:h1", "waiting"],
    ]),
    logged: [{ at, caller: agent, tool: "edit_entry", effects }],
    firstWithKey: null,
  };
}

describe("the oracle", () => {
  test("fails a read of Run records that gives words with one", () => {
    const read = (model: string): Seen => ({
      request: { caller: hand, tool: "get_run", input: {}, arrivedAt: Date.parse(at) },
      result: { ok: true, value: { id: "r1", model } },
      before: records(),
      after: records(),
      logged: [],
      firstWithKey: null,
    });

    expect(judge(read("claude-sonnet-5-5"))).toEqual([]);
    expect(judge(read(marked("Said in the Run")))).toEqual([
      "get_run gave words with a Run record (section 5.8).",
    ]);
  });

  test("passes a write whose Effects are exactly what changed, logged with its caller", () => {
    expect(judge(aGoodWrite())).toEqual([]);
  });

  test("fails a removal for good that leaves the record's words in the change log", () => {
    const words = marked("Removed for good");
    const removal = (log: string[]): Seen => {
      const gone: Effect = { ...made, what: "deleted", summary: "" };
      return {
        request: { caller: hand, tool: "remove_for_good", input: {}, arrivedAt: Date.parse(at) },
        result: { ok: true, value: { record: { items: 1 }, effects: [gone], changed: true } },
        before: records({ e1: "in the Trash" }),
        after: records(),
        logged: [{ at, caller: hand, tool: "remove_for_good", effects: [gone] }],
        firstWithKey: null,
        words: { before: new Map([["entry:e1", words]]), after: new Map(), log },
      };
    };

    expect(judge(removal(["", "Other words"]))).toEqual([]);
    expect(judge(removal(["", `Left behind: ${words}`]))).toEqual([
      expect.stringContaining("words of a record removed for good"),
    ]);
  });

  test("passes a held call that left its Held Change and changed nothing else", () => {
    expect(judge(aHeldCall([]))).toEqual([]);
  });

  test("fails a held call that changed anything but its Held Change, even saying so", () => {
    const changed: Effect = { ...made, what: "changed" };
    const seen = aHeldCall([changed]);

    expect(judge(seen)).toEqual([expect.stringContaining("nothing but its Held Change")]);
  });

  test("fails a write that changed a record its Effects leave out", () => {
    const seen = { ...aGoodWrite(), after: records({ e1: "row", e2: "row" }) };

    expect(judge(seen)).toEqual([expect.stringContaining("not the Effects returned")]);
  });

  test("fails a write whose Effects name a record that did not change", () => {
    const seen = { ...aGoodWrite(), after: records() };

    expect(judge(seen)).toEqual([expect.stringContaining("not the Effects returned")]);
  });

  test("fails a write that says a record was changed when it was made", () => {
    const changed: Effect = { ...made, what: "changed" };
    const seen = {
      ...aGoodWrite(),
      result: { ok: true, value: { record, effects: [changed], changed: true } },
      logged: logged([changed]),
    } satisfies Seen;

    expect(judge(seen)).toEqual([expect.stringContaining("not the Effects returned")]);
  });

  test("fails a write whose change log names another caller, or another summary", () => {
    expect(judge({ ...aGoodWrite(), logged: logged([made], connection) })).toEqual([
      expect.stringContaining("change log"),
    ]);
    expect(judge({ ...aGoodWrite(), logged: logged([{ ...made, summary: "Other" }]) })).toEqual([
      expect.stringContaining("change log"),
    ]);
    expect(judge({ ...aGoodWrite(), logged: [] })).toEqual([expect.stringContaining("change log")]);
  });

  test("fails a write that changes nothing but does not say so, or logs it", () => {
    const nothing = {
      ...aGoodWrite(),
      result: { ok: true, value: { record, effects: [], changed: true } },
      after: records(),
      logged: [],
    } satisfies Seen;

    expect(judge(nothing)).toEqual([expect.stringContaining("whether anything changed")]);
    expect(
      judge({
        ...nothing,
        result: { ok: true, value: { record, effects: [], changed: false } },
        logged: logged([]),
      }),
    ).toEqual([expect.stringContaining("change log")]);
  });

  test("fails a refused call, or a read, that changes anything", () => {
    const refused: ToolResult<never> = { ok: false, error: { code: "refused", message: "No" } };
    expect(judge({ ...aGoodWrite(), result: refused })).toEqual([
      expect.stringContaining("failed changed records"),
      expect.stringContaining("failed added to the change log"),
    ]);

    const read = { ...aGoodWrite(), request: { ...aGoodWrite().request, tool: "list_entries" } };
    expect(judge(read)).toEqual([
      expect.stringContaining("read changed records"),
      expect.stringContaining("read added to the change log"),
    ]);
  });

  test("fails a repeated key that changes anything or answers differently", () => {
    const first = aGoodWrite().result;
    const repeat: Seen = { ...aGoodWrite(), before: records({ e1: "row" }), firstWithKey: first };
    expect(judge({ ...repeat, logged: [] })).toEqual([]);

    expect(judge({ ...repeat, after: records({ e1: "row", e2: "row" }), logged: [] })).toEqual([
      expect.stringContaining("repeated key changed records"),
    ]);
    const other: ToolResult<unknown> = {
      ok: true,
      value: { record: { id: "e2" }, effects: [], changed: false },
    };
    expect(judge({ ...repeat, firstWithKey: other, logged: [] })).toEqual([
      expect.stringContaining("did not return the first result"),
    ]);
  });
});

describe("the marker check", () => {
  test("finds a marker in anything logged", () => {
    const words = marked("Called Ali about the lease");
    console.warn("Something went wrong with", { words });

    expect(leakedMarkers()).toHaveLength(1);
    forget();
  });

  test("hears what a Context object logs", async () => {
    const context = newContext();

    value(await context.call(hand, "record_entry", { words: marked("Seen by nobody") }));

    expect(logs()).toContainEqual(expect.stringContaining('"tool":"record_entry"'));
  });
});

describe("the oracle, on a Deployment write", () => {
  const renamed: Effect = {
    kind: "context",
    id: "c1",
    what: "changed",
    summary: "Studio",
    by: "call",
  };
  const settings = (name: string): Records => new Map([["context:c1", name]]);

  /** A rename_context that renamed the Context in its own object and logged it there, as it should. */
  function aGoodRename(): SeenDeployment {
    return {
      request: { caller: hand, tool: "rename_context", input: {}, arrivedAt: Date.parse(at) },
      result: { ok: true, value: { record: {}, effects: [renamed], changed: true } },
      contexts: new Map([
        [
          "c1",
          {
            before: settings("Work"),
            after: settings("Studio"),
            logged: [{ at, caller: hand, tool: "rename_context", effects: [renamed] }],
          },
        ],
      ]),
      kept: { before: new Map(), after: new Map() },
    };
  }

  test("passes a change to a Context reported and logged in it with its caller", () => {
    expect(judgeDeployment(aGoodRename())).toEqual([]);
  });

  test("fails a change to a Context that its change log leaves out", () => {
    const seen = aGoodRename();
    seen.contexts.set("c1", { before: settings("Work"), after: settings("Studio"), logged: [] });

    expect(judgeDeployment(seen)).toEqual([expect.stringMatching(/change log of the Context c1/)]);
  });

  test("fails a change to a Context that no Effect reports", () => {
    const seen = { ...aGoodRename(), result: { ok: true, value: { effects: [] } } as const };

    expect(judgeDeployment(seen)).toEqual([
      expect.stringMatching(/c1 changed with no Effect/),
      expect.stringMatching(/change log of the Context c1/),
    ]);
  });

  test("fails a Context made with more than its settings, or a change log already begun", () => {
    const made: Effect = { ...renamed, what: "made", summary: "Work" };
    const seen: SeenDeployment = {
      request: { caller: hand, tool: "create_context", input: {}, arrivedAt: Date.parse(at) },
      result: { ok: true, value: { record: {}, effects: [made], changed: true } },
      contexts: new Map([
        [
          "c1",
          {
            before: null,
            after: new Map([...settings("Work"), ["entry:e1", "row"]]),
            logged: logged([made]),
          },
        ],
      ]),
      kept: { before: new Map(), after: new Map() },
    };

    expect(judgeDeployment(seen)).toEqual([
      expect.stringMatching(/holds more than its settings/),
      expect.stringMatching(/does not start empty/),
    ]);
  });

  /** Ending a Connection: its row changed, and the call's Effects say so. */
  function anEnding(effects: Effect[]): SeenDeployment {
    return {
      request: { caller: hand, tool: "end_connection", input: {}, arrivedAt: Date.parse(at) },
      result: { ok: true, value: { record: {}, effects, changed: effects.length > 0 } },
      contexts: new Map(),
      kept: {
        before: new Map([["connection:k1", "not ended"]]),
        after: new Map([["connection:k1", "ended"]]),
      },
    };
  }
  const ended: Effect = {
    kind: "connection",
    id: "k1",
    what: "changed",
    summary: "Laptop",
    by: "call",
  };

  test("passes a change to a Connection its Effects report", () => {
    expect(judgeDeployment(anEnding([ended]))).toEqual([]);
  });

  test("fails a change to a Connection that no Effect reports, or an Effect on one unchanged", () => {
    expect(judgeDeployment(anEnding([]))).toEqual([
      expect.stringMatching(/Connections, Devices and cap changed are not the Effects/),
    ]);
    expect(judgeDeployment(anEnding([ended, { ...ended, id: "k2" }]))).toEqual([
      expect.stringMatching(/Connections, Devices and cap changed are not the Effects/),
    ]);
  });

  /** Switching a Device's Notifications off, which takes it from the list, with these Effects. */
  function aDeviceGone(effects: Effect[]): SeenDeployment {
    return {
      request: {
        caller: hand,
        tool: "set_device_notifications",
        input: {},
        arrivedAt: Date.parse(at),
      },
      result: { ok: true, value: { record: null, effects, changed: effects.length > 0 } },
      contexts: new Map(),
      kept: { before: new Map([["device:d1", "on"]]), after: new Map() },
    };
  }

  test("passes a Device gone from the list its Effects report, and fails one they leave out", () => {
    const gone: Effect = {
      kind: "device",
      id: "d1",
      what: "deleted",
      summary: "Phone",
      by: "call",
    };
    expect(judgeDeployment(aDeviceGone([gone]))).toEqual([]);
    expect(judgeDeployment(aDeviceGone([]))).toEqual([
      expect.stringMatching(/Connections, Devices and cap changed are not the Effects/),
    ]);
  });

  /** Setting the spend cap from 20 to 30 US dollars, with these Effects. */
  function aCapSet(effects: Effect[]): SeenDeployment {
    return {
      request: { caller: hand, tool: "set_spend_cap", input: {}, arrivedAt: Date.parse(at) },
      result: { ok: true, value: { record: {}, effects, changed: effects.length > 0 } },
      contexts: new Map(),
      kept: {
        before: new Map([["spend_cap:spend_cap", "20"]]),
        after: new Map([["spend_cap:spend_cap", "30"]]),
      },
    };
  }
  const capSet: Effect = {
    kind: "spend_cap",
    id: "spend_cap",
    what: "changed",
    summary: "30 US dollars a month",
    by: "call",
  };

  test("passes a change to the spend cap its Effects report, and fails one they leave out", () => {
    expect(judgeDeployment(aCapSet([capSet]))).toEqual([]);
    expect(judgeDeployment(aCapSet([]))).toEqual([
      expect.stringMatching(/Connections, Devices and cap changed are not the Effects/),
    ]);
  });
});

describe("the platform's logs", () => {
  test("carry only ids, tool names, result codes, counts and timings", async () => {
    const context = newContext();
    const words = marked("Ask the landlord about the boiler");

    const { record } = value(await context.call(connection, "record_entry", { words }));
    await context.call(hand, "get_entry", { id: record.id });
    await context.call(hand, "get_entry", { id: "nothing" });
    await context.call(hand, "record_entry", { words: " " });
    await context.callAny(hand, "no_such_tool", { words });

    const lines = logs().map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toEqual([
      // The Deployment object made the Context first.
      { tool: "create_context", result: "ok", effects: 1, ms: expect.any(Number) },
      { tool: "record_entry", result: "ok", effects: 1, ms: expect.any(Number) },
      { tool: "get_entry", result: "ok", ms: expect.any(Number) },
      { tool: "get_entry", result: "not_found", ms: expect.any(Number) },
      { tool: "record_entry", result: "invalid_input", ms: expect.any(Number) },
      { tool: "unknown", result: "not_offered", ms: expect.any(Number) },
    ]);
  });
});

describe("the scripted model", () => {
  test("is held to the script a Context was first asked with: a script given after that is seen asked out of turn", async () => {
    scriptModel(answering("First."));
    const context = newContext();
    await context.callAny(hand, "send_message", { words: "Hello" });
    await context.runsEnded();
    scriptModel(answering("Never heard."));

    await context.callAny(hand, "send_message", { words: "Again" });
    await context.runsEnded();

    expect(supersededScripts()).toEqual(["Again"]);
    // Seen, so the harness's own check after this test passes.
    forgetSuperseded();
  });
});

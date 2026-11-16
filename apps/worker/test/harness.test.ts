import type { Change, Effect, ToolResult } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { forget, leakedMarkers, logs, marked } from "./markers.ts";
import { judge, type Records, type Seen } from "./oracle.ts";
import { connection, hand, newContext, value } from "./seam.ts";

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

describe("the oracle", () => {
  test("passes a write whose Effects are exactly what changed, logged with its caller", () => {
    expect(judge(aGoodWrite())).toEqual([]);
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

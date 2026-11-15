import {
  type Caller,
  type Change,
  type Effect,
  failure,
  instantToIso,
  PAGE_SIZE,
  success,
} from "@praxis/domain";
import type { Handlers } from "../registry.ts";

type CallRow = {
  seq: number;
  at: number;
  caller_kind: Caller["kind"];
  caller_name: string | null;
  tool: string;
};

type EffectRow = {
  call: number;
  kind: Effect["kind"];
  record_id: string;
  what: Effect["what"];
  summary: string;
  by: Effect["by"];
};

export const changeTools: Pick<Handlers, "list_changes"> = {
  list_changes({ input, sql }) {
    let after = 0;
    if (input.cursor !== undefined) {
      const position = decodeCursor(input.cursor);
      if (position === null)
        return failure("invalid_input", "The cursor is not one this list gave.");
      after = position;
    }
    // Oldest first. One more than a page is read to learn whether another page follows.
    const calls = sql
      .exec<CallRow>(
        `SELECT * FROM change_calls WHERE seq > ? ORDER BY seq LIMIT ?`,
        after,
        PAGE_SIZE + 1,
      )
      .toArray();
    const page = calls.slice(0, PAGE_SIZE);
    const last = page.at(-1)?.seq ?? after;
    const effects = Map.groupBy(
      sql
        .exec<EffectRow>(
          `SELECT * FROM changes WHERE call > ? AND call <= ? ORDER BY call, ord`,
          after,
          last,
        )
        .toArray(),
      (row) => row.call,
    );
    return success({
      items: page.map((call) => toChange(call, effects.get(call.seq) ?? [])),
      cursor: encodeCursor(last),
      more: calls.length > PAGE_SIZE,
    });
  },
};

function toChange(call: CallRow, effects: EffectRow[]): Change {
  return {
    at: instantToIso(call.at),
    caller: toCaller(call),
    tool: call.tool,
    effects: effects.map((row) => ({
      kind: row.kind,
      id: row.record_id,
      what: row.what,
      summary: row.summary,
      by: row.by,
    })),
  };
}

function toCaller(row: CallRow): Caller {
  switch (row.caller_kind) {
    case "connection":
    case "read_only_connection":
      return { kind: row.caller_kind, name: row.caller_name ?? "" };
    default:
      return { kind: row.caller_kind };
  }
}

function encodeCursor(seq: number): string {
  return btoa(JSON.stringify(["changes", seq]));
}

function decodeCursor(cursor: string): number | null {
  try {
    const value: unknown = JSON.parse(atob(cursor));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value[0] === "changes" &&
      Number.isSafeInteger(value[1]) &&
      value[1] >= 0
    ) {
      return value[1];
    }
  } catch {
    // Not base64 or not JSON: not a cursor this list gave.
  }
  return null;
}

import type { RecordKind } from "./effects.ts";

/** The closed set of error codes of section 4.3. */
export type ErrorCode =
  | "not_found"
  | "invalid_input"
  | "not_offered"
  | "held"
  | "stale"
  | "refused";

/** A record standing in the way of a refused change, with its one-line summary. */
export type InTheWay = { kind: RecordKind; id: string; summary: string };

export type ToolError = {
  code: ErrorCode;
  message: string;
  /** For `refused`: each thing in the way, as data. */
  in_the_way?: InTheWay[];
};

export type ToolResult<T> = { ok: true; value: T } | { ok: false; error: ToolError };

export function success<T>(value: T): ToolResult<T> {
  return { ok: true, value };
}

export function failure(code: ErrorCode, message: string): ToolResult<never> {
  return { ok: false, error: { code, message } };
}

/** A rule stands in the way of the change: the result lists each thing in the way. */
export function refusal(message: string, inTheWay: InTheWay[]): ToolResult<never> {
  return { ok: false, error: { code: "refused", message, in_the_way: inTheWay } };
}

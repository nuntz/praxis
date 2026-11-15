/** The closed set of error codes of section 4.3. */
export type ErrorCode =
  | "not_found"
  | "invalid_input"
  | "not_offered"
  | "held"
  | "stale"
  | "refused";

export type ToolError = { code: ErrorCode; message: string };

export type ToolResult<T> = { ok: true; value: T } | { ok: false; error: ToolError };

export function success<T>(value: T): ToolResult<T> {
  return { ok: true, value };
}

export function failure(code: ErrorCode, message: string): ToolResult<never> {
  return { ok: false, error: { code, message } };
}

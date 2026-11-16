import type { ToolResult } from "@praxis/domain";

/**
 * One line per call for the platform's logs, from a Context's object or the Deployment object. It
 * carries only the tool's name, the result's code, how many Effects a write had and the time,
 * never words or names (section 2, principle 7). `tool` is null for a name no registry has.
 */
export function logCall(
  call: { tool: string | null; write: boolean },
  result: ToolResult<unknown>,
  ms: number,
): void {
  const line: Record<string, string | number> = {
    tool: call.tool ?? "unknown",
    result: result.ok ? "ok" : result.error.code,
    ms,
  };
  if (result.ok && call.write) {
    line.effects = (result.value as { effects: unknown[] }).effects.length;
  }
  console.log(JSON.stringify(line));
}

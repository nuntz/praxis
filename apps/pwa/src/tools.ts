import type { ToolInput, ToolName, ToolOutput, ToolResult } from "@praxis/domain";

/** A call that never reached a tool, so it has no result. */
export class Unreachable extends Error {}

/** The screen reads and writes only through tools, as the person's hand. */
export async function callTool<N extends ToolName>(
  tool: N,
  input: ToolInput<N>,
): Promise<ToolResult<ToolOutput[N]>> {
  let response: Response;
  try {
    response = await fetch(`/api/tools/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Unreachable("Praxis could not be reached.");
  }
  if (!response.ok) throw new Unreachable(`Praxis answered ${response.status}.`);
  return (await response.json()) as ToolResult<ToolOutput[N]>;
}

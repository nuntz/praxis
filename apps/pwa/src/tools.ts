import type {
  DeploymentToolInput,
  DeploymentToolName,
  DeploymentToolOutput,
  ToolInput,
  ToolName,
  ToolOutput,
  ToolResult,
} from "@praxis/domain";
import { createContext, useContext } from "solid-js";

/** A call that never reached a tool, so it has no result. */
export class Unreachable extends Error {}

/** Call a tool at its address, as the person's hand. */
async function post<T>(path: string, input: unknown): Promise<ToolResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Unreachable("Praxis could not be reached.");
  }
  if (!response.ok) throw new Unreachable(`Praxis answered ${response.status}.`);
  return (await response.json()) as ToolResult<T>;
}

/** Call a Deployment tool, which the screen reaches whatever Context is current. */
export function callDeploymentTool<N extends DeploymentToolName>(
  tool: N,
  input: DeploymentToolInput<N>,
): Promise<ToolResult<DeploymentToolOutput[N]>> {
  return post(`/api/deployment/tools/${tool}`, input);
}

/** Calls the tools of one Context. No tool names a Context: the address the call goes to does. */
export type CallTool = <N extends ToolName>(
  tool: N,
  input: ToolInput<N>,
) => Promise<ToolResult<ToolOutput[N]>>;

/** The caller of one Context's tools. */
export function contextTools(contextId: string): CallTool {
  return (tool, input) =>
    post(`/api/contexts/${encodeURIComponent(contextId)}/tools/${tool}`, input);
}

/** The current Context's tools, for whatever is shown inside it. */
export const CurrentContextTools = createContext<CallTool>();

/**
 * The caller of the current Context's tools. Read once when a component is made, so a call it
 * makes later goes to the Context it was shown in, even if the person has switched since.
 */
export function useCallTool(): CallTool {
  const callTool = useContext(CurrentContextTools);
  if (!callTool) throw new Error("Shown outside any Context");
  return callTool;
}

/** The message of a call that never reached a tool. Anything else is a fault, thrown on. */
export function unreachableMessage(error: unknown): string {
  if (error instanceof Unreachable) return error.message;
  throw error;
}

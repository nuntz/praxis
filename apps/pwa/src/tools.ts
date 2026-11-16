import type {
  DeploymentToolInput,
  DeploymentToolName,
  DeploymentToolOutput,
  ToolInput,
  ToolName,
  ToolOutput,
  ToolResult,
} from "@praxis/domain";
import { createContext, createSignal, useContext } from "solid-js";

/** A call that never reached a tool, so it has no result. */
export class Unreachable extends Error {}

/**
 * A call that never reached a tool because the person's Access sign-in has lapsed. Unlike a
 * network failure, signing in again mends it, so the screen asks the person to (section 7.1).
 */
export class SignInLapsed extends Error {}

const [signInLapsed, setSignInLapsed] = createSignal(false);

/** Whether a call has found the person's Access sign-in lapsed since the screen was loaded. */
export { signInLapsed };

/** Call a tool at its address, as the person's hand. */
async function post<T>(path: string, input: unknown): Promise<ToolResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      // Access in front answers a lapsed sign-in by sending the browser to its login page,
      // elsewhere. Followed, that fails as a network failure would; not followed, it is told apart.
      redirect: "manual",
    });
  } catch {
    throw new Unreachable("Praxis could not be reached.");
  }
  // The Worker itself refuses a request Access did not sign in.
  if (response.type === "opaqueredirect" || response.status === 401) {
    setSignInLapsed(true);
    throw new SignInLapsed("Your sign-in has lapsed.");
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

/**
 * The message of a call that never reached a tool, for a network failure or a lapsed sign-in.
 * Anything else is a fault, thrown on.
 */
export function unreachableMessage(error: unknown): string {
  if (error instanceof Unreachable || error instanceof SignInLapsed) return error.message;
  throw error;
}

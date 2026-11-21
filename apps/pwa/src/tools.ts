import type {
  ConversationToolInput,
  ConversationToolName,
  ConversationToolOutput,
  DeploymentToolInput,
  DeploymentToolName,
  DeploymentToolOutput,
  ToolInput,
  ToolName,
  ToolOutput,
  ToolResult,
} from "@praxis/domain";
import { DEVICE_HEADER, UPGRADE_HEADER } from "@praxis/domain";
import { createContext, createSignal, useContext } from "solid-js";
import { thisDevice } from "./device.ts";

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
async function post<T>(
  path: string,
  input: unknown,
  headers: Record<string, string> = {},
): Promise<ToolResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(input),
      // Access in front answers a lapsed sign-in by sending the browser to its login page,
      // elsewhere. Followed, that fails as a network failure would; not followed, it is told apart.
      redirect: "manual",
    });
  } catch {
    throw new Unreachable("Praxis could not be reached: this needs the network.");
  }
  // The Worker itself refuses a request Access did not sign in.
  if (response.type === "opaqueredirect" || response.status === 401) {
    setSignInLapsed(true);
    throw new SignInLapsed("Your sign-in has lapsed.");
  }
  // The Worker's page for a Deployment stuck on its upgrade (section 11): opening the screen again
  // shows that page in its place, since nothing can be reached until a release mends it.
  if (response.headers.get(UPGRADE_HEADER) === "stuck") {
    location.reload();
    throw new Unreachable("Praxis could not upgrade.");
  }
  if (!response.ok) throw new Unreachable(`Praxis answered ${response.status}.`);
  return (await response.json()) as ToolResult<T>;
}

/**
 * Call a Deployment tool, which the screen reaches whatever Context is current. Each call names
 * this browser as a Device, so the Device list shows when it was last seen.
 */
export function callDeploymentTool<N extends DeploymentToolName>(
  tool: N,
  input: DeploymentToolInput<N>,
): Promise<ToolResult<DeploymentToolOutput[N]>> {
  const device = thisDevice();
  return post(`/api/deployment/tools/${tool}`, input, device ? { [DEVICE_HEADER]: device } : {});
}

/** What a Deployment write returns as its record: a Context or a Connection, as it now is. */
export type DeploymentWritten<N extends DeploymentToolName> = DeploymentToolOutput[N] extends {
  record: infer R;
}
  ? R
  : never;

/**
 * Call a Deployment write, for what it changed as it now is. A refusal or an outage is reported as
 * a problem, and gives nothing; a call that goes through clears the problem.
 */
export async function writeToDeployment<N extends DeploymentToolName>(
  tool: N,
  input: DeploymentToolInput<N>,
  onProblem: (message: string | null) => void,
): Promise<DeploymentWritten<N> | null> {
  try {
    const result = await callDeploymentTool(tool, input);
    if (!result.ok) {
      onProblem(result.error.message);
      return null;
    }
    onProblem(null);
    return (result.value as unknown as { record: DeploymentWritten<N> }).record;
  } catch (error) {
    onProblem(unreachableMessage(error));
    return null;
  }
}

/** A tool the screen calls in a Context: a Context tool, or a Conversation tool. */
type InContext = ToolName | ConversationToolName;

type InputOf<N extends InContext> = N extends ToolName
  ? ToolInput<N>
  : N extends ConversationToolName
    ? ConversationToolInput<N>
    : never;

type OutputOf<N extends InContext> = N extends ToolName
  ? ToolOutput[N]
  : N extends ConversationToolName
    ? ConversationToolOutput[N]
    : never;

/** Calls the tools of one Context. No tool names a Context: the address the call goes to does. */
export type CallTool = <N extends InContext>(
  tool: N,
  input: InputOf<N>,
) => Promise<ToolResult<OutputOf<N>>>;

/** The caller of one Context's tools. */
export function contextTools(contextId: string): CallTool {
  return (tool, input) =>
    post(`/api/contexts/${encodeURIComponent(contextId)}/tools/${tool}`, input);
}

/** The current Context's tools, for whatever is shown inside it. */
export const CurrentContextTools = createContext<CallTool>();

/** The current Context's id, for what is shown inside it and kept on the Device for it. */
export const CurrentContextId = createContext<string>();

/** The current Context's id, read once when a component is made, as `useCallTool` is. */
export function useContextId(): string {
  const id = useContext(CurrentContextId);
  if (id === undefined) throw new Error("Shown outside any Context");
  return id;
}

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

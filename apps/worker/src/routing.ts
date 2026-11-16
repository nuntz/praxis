import { failure, success, type ToolResult } from "@praxis/domain";
import type { ContextObject } from "./context-object.ts";
import type { DeploymentObject } from "./deployment-object.ts";

export type ContextStub = DurableObjectStub<ContextObject>;
export type DeploymentStub = DurableObjectStub<DeploymentObject>;

/** The one Deployment object of a Deployment. */
export function deploymentOf(env: Env): DeploymentStub {
  return env.DEPLOYMENT.get(env.DEPLOYMENT.idFromName("deployment"));
}

/**
 * The object of the Context with this id. The Worker asks the Deployment object first, on every
 * request, so a retired Context is out of reach from the next request on (section 9.2). A
 * Context's id is its object's, so one that was never made, or is retired, is not found.
 */
export async function reachContext(
  env: Env,
  deployment: DeploymentStub,
  id: string,
): Promise<ToolResult<ContextStub>> {
  if (!(await deployment.isReachable(id))) {
    return failure("not_found", "There is no such Context, or it is retired.");
  }
  return success(env.CONTEXT.get(env.CONTEXT.idFromString(id)));
}

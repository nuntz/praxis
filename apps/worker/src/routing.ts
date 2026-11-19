import { failure, success, type ToolResult } from "@praxis/domain";
import type { ContextObject, DeploymentObject } from "./index.ts";

export type ContextStub = DurableObjectStub<ContextObject>;
export type DeploymentStub = DurableObjectStub<DeploymentObject>;

/** The jurisdictions a Deployment may keep its objects in, chosen once at setup (section 9.2). */
const JURISDICTIONS: readonly string[] = [
  "eu",
  "us",
  "fedramp",
] satisfies DurableObjectJurisdiction[];

/**
 * A namespace of objects in the Deployment's jurisdiction, or the namespace itself when it has
 * none. Every object is made or named through here (lint/outside-jurisdiction.grit); an id read
 * back with `idFromString` carries its jurisdiction already. workerd keeps no jurisdiction, so
 * tests run without one and only a Deployment shows it working.
 */
function inJurisdiction<T extends Rpc.DurableObjectBranded | undefined>(
  namespace: DurableObjectNamespace<T>,
  env: Env,
): DurableObjectNamespace<T> {
  const jurisdiction = env.JURISDICTION;
  if (!jurisdiction) return namespace;
  if (!JURISDICTIONS.includes(jurisdiction)) {
    throw new Error(
      `JURISDICTION is ${JSON.stringify(jurisdiction)}, which is none of ${JURISDICTIONS.join(", ")}.`,
    );
  }
  return namespace.jurisdiction(jurisdiction as DurableObjectJurisdiction);
}

/** The one Deployment object of a Deployment. */
export function deploymentOf(env: Env): DeploymentStub {
  const namespace = inJurisdiction(env.DEPLOYMENT, env);
  return namespace.get(namespace.idFromName("deployment"));
}

/** A new Context's object, in the Deployment's jurisdiction, with its id. */
export function newContextObject(env: Env): { id: DurableObjectId; stub: ContextStub } {
  const namespace = inJurisdiction(env.CONTEXT, env);
  const id = namespace.newUniqueId();
  return { id, stub: namespace.get(id) };
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

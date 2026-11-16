import { type Caller, failure, type ToolResult } from "@praxis/domain";
import { ACCESS_TOKEN_HEADER, type Access, type AccessApplication, AccessGate } from "./access.ts";
import { arrivalTime } from "./arrival.ts";
import type { ToolRequest } from "./registry.ts";
import { deploymentOf, reachContext } from "./routing.ts";

/** The screen calls a Deployment tool at this path, with the tool's input as the JSON body. */
const DEPLOYMENT_TOOL_PATH = /^\/api\/deployment\/tools\/([a-z_]+)$/;

/**
 * The screen calls a Context tool at this path, which names the Context by its id: the screen's
 * current Context decides it, and no tool takes a Context as input (section 4.1).
 */
const CONTEXT_TOOL_PATH = /^\/api\/contexts\/([0-9A-Za-z_-]+)\/tools\/([a-z_]+)$/;

/** MCP is served under this path (section 7.2); it is not served yet, but signed in like the rest. */
const MCP_PATH = /^\/mcp(\/|$)/;

/** The screen is the person's hand. */
const HAND: Caller = { kind: "hand" };

/**
 * Praxis behind Access. Every request is checked before anything else, whatever it is for: the
 * screen and its files, the tool endpoint and MCP. A refused request reaches nothing.
 */
export function praxis(accessOf: (env: Env) => Access) {
  // One gate per isolate, so the keys are read once and kept, unless the application changes.
  let held: { application: AccessApplication; gate: AccessGate } | null = null;
  const gateFor = (env: Env) => {
    const access = accessOf(env);
    const { teamDomain, audience } = access.application;
    const same =
      held?.application.teamDomain === teamDomain && held.application.audience === audience;
    if (!held || !same) held = { application: access.application, gate: new AccessGate(access) };
    return held.gate;
  };

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const arrivedAt = arrivalTime();
      const signIn = await gateFor(env).check(request.headers.get(ACCESS_TOKEN_HEADER), arrivedAt);
      if (signIn === "signed_out") return signedOut();
      if (signIn === "unavailable") return unavailable();

      const { pathname } = new URL(request.url);
      if (!pathname.startsWith("/api/") && !MCP_PATH.test(pathname)) {
        return env.ASSETS.fetch(request);
      }
      const deploymentTool = DEPLOYMENT_TOOL_PATH.exec(pathname);
      const contextTool = CONTEXT_TOOL_PATH.exec(pathname);
      if (!deploymentTool && !contextTool) return new Response("Not found", { status: 404 });
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
      }

      let input: unknown;
      try {
        input = await request.json();
      } catch {
        return Response.json(failure("invalid_input", "The body is not JSON."));
      }

      const deployment = deploymentOf(env);
      if (deploymentTool?.[1]) {
        return Response.json(
          await deployment.call({ caller: HAND, tool: deploymentTool[1], input, arrivedAt }),
        );
      }
      const [, contextId = "", tool = ""] = contextTool ?? [];
      return Response.json(
        await callContext(env, deployment, contextId, { caller: HAND, tool, input, arrivedAt }),
      );
    },
  } satisfies ExportedHandler<Env>;
}

/**
 * A request Access did not sign in, or whose sign-in has lapsed. Signing in again mends it, so
 * the screen tells it apart from a network failure (section 8.8) and asks the person to.
 */
function signedOut(): Response {
  return new Response("Sign in to Praxis through Cloudflare Access.", {
    status: 401,
    headers: { "cache-control": "no-store" },
  });
}

/** The keys to check the sign-in with could not be read. Signing in again would not mend it. */
function unavailable(): Response {
  console.error(JSON.stringify({ access: "unavailable" }));
  return new Response("Praxis could not check the sign-in. Try again shortly.", {
    status: 503,
    headers: { "cache-control": "no-store", "retry-after": "5" },
  });
}

/** Ask the Deployment object which Context the request is for, then call that Context's object. */
async function callContext(
  env: Env,
  deployment: ReturnType<typeof deploymentOf>,
  contextId: string,
  request: ToolRequest,
): Promise<ToolResult<unknown>> {
  const reached = await reachContext(env, deployment, contextId);
  if (!reached.ok) return reached;
  return reached.value.call(request);
}

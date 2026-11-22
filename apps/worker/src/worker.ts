import {
  type Caller,
  DEVICE_HEADER,
  failure,
  SIGN_IN_HEADER,
  type ToolResult,
  UPGRADE_HEADER,
} from "@praxis/domain";
import { ACCESS_TOKEN_HEADER, type Access, AccessGate, type NotThePersons } from "./access.ts";
import { arrivalTime } from "./arrival.ts";
import { type StuckUpgrade, stuckIn, stuckWords } from "./ladder.ts";
import { connectionCaller, connectionIdIn, noConnection, serveConnection } from "./mcp.ts";
import type { ToolRequest } from "./registry.ts";
import { deploymentOf, reachContext } from "./routing.ts";

/** The screen calls a Deployment tool at this path, with the tool's input as the JSON body. */
const DEPLOYMENT_TOOL_PATH = /^\/api\/deployment\/tools\/([a-z_]+)$/;

/**
 * The screen calls a Context tool at this path, which names the Context by its id: the screen's
 * current Context decides it, and no tool takes a Context as input (section 4.1).
 */
const CONTEXT_TOOL_PATH = /^\/api\/contexts\/([0-9A-Za-z_-]+)\/tools\/([a-z_]+)$/;

/** The screen opens the live channel of its current Context at this path (section 9.5). */
const LIVE_PATH = /^\/api\/contexts\/([0-9A-Za-z_-]+)\/live$/;

/** MCP is served under this path, a Connection at an address holding its id (section 7.2). */
const MCP_PATH = /^\/mcp(\/|$)/;

/** The screen is the person's hand. */
const HAND: Caller = { kind: "hand" };

/**
 * Praxis behind Access, for the person whose Google address it is given, the only one that signs
 * in to it (section 7.1). Every request is checked before anything else, whatever it is for: the
 * screen and its files, the tool endpoint and MCP. A refused request reaches nothing.
 */
export function praxis(accessOf: (env: Env) => Access) {
  // One gate per isolate, so the keys are read once and kept, unless the Access it checks changes.
  let held: { access: Access; gate: AccessGate } | null = null;
  const gateFor = (access: Access) => {
    const same =
      held?.access.application.teamDomain === access.application.teamDomain &&
      held.access.application.audience === access.application.audience &&
      held.access.signInEmail === access.signInEmail;
    if (!held || !same) held = { access, gate: new AccessGate(access) };
    return held.gate;
  };

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const arrivedAt = arrivalTime();
      const token = request.headers.get(ACCESS_TOKEN_HEADER);
      const signIn = await gateFor(accessOf(env)).check(token, arrivedAt);
      if (signIn === "signed_out") return signedOut();
      if (signIn === "unavailable") return unavailable();
      if (signIn !== "signed_in") return notThePersons(signIn);
      try {
        return await route(request, env, arrivedAt);
      } catch (error) {
        // Nothing can be routed while the Deployment object is stuck on its upgrade (section 11).
        const stuck = stuckIn(error);
        if (stuck !== null) return stuckPage(stuck);
        throw error;
      }
    },

    /**
     * The daily trigger (wrangler.jsonc): the day's Backup, at the time it was due to fire, so a
     * late start keeps the day it was for (section 10.1). Nothing waits on it, and the Deployment
     * object answers a failure, which its standing Notice tells the person of.
     */
    async scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
      context.waitUntil(deploymentOf(env).backUp(controller.scheduledTime));
    },
  } satisfies ExportedHandler<Env>;
}

/** Route a request Access signed in: to MCP, the screen's files, a live channel or a tool. */
async function route(request: Request, env: Env, arrivedAt: number): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (MCP_PATH.test(pathname)) return serveMcp(request, env, pathname, arrivedAt);
  if (!pathname.startsWith("/api/")) {
    // Opening the screen asks first, so a stuck Deployment shows its page in place of a
    // screen whose every call would fail.
    if (opensTheScreen(request)) {
      const stuck = await deploymentOf(env).upgradeStuck();
      if (stuck !== null) return stuckPage(stuck);
    }
    return withPolicy(await env.ASSETS.fetch(request));
  }
  const live = LIVE_PATH.exec(pathname);
  if (live) return openLive(request, env, live[1] ?? "");
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
      await deployment.call({
        caller: HAND,
        tool: deploymentTool[1],
        input,
        arrivedAt,
        ...deviceOf(request),
      }),
    );
  }
  const [, contextId = "", tool = ""] = contextTool ?? [];
  return Response.json(
    await callContext(env, deployment, contextId, { caller: HAND, tool, input, arrivedAt }),
  );
}

/**
 * The content security policy of the screen and its files: everything from the screen's own
 * address, and images from any https host, since an image in an Entry is given by its address and
 * Praxis keeps none of its bytes (section 8.4, ADR 0025). Nothing else from elsewhere.
 */
const SCREEN_POLICY =
  "default-src 'self'; img-src 'self' https:; base-uri 'none'; frame-ancestors 'none'";

/** One of the screen's files, served under the screen's content security policy. */
function withPolicy(served: Response): Response {
  const response = new Response(served.body, served);
  response.headers.set("content-security-policy", SCREEN_POLICY);
  return response;
}

/**
 * The one plain page a Deployment whose Deployment object is stuck on its upgrade shows for every
 * request, saying under which release (section 11). Only a release that mends it changes that, so
 * it is unavailable, never the person's doing, and the screen reloads into it when a call meets it.
 */
function stuckPage(stuck: StuckUpgrade): Response {
  const release = escapeHtml(stuck.release);
  const why = escapeHtml(stuckWords(stuck));
  return plainPage(
    "Praxis could not upgrade",
    `<p>The upgrade under release <code>${release}</code> failed: for the Deployment's own object, ${why}.</p>
<p>Nothing was changed or lost: it stays as it was before the upgrade, and serves nothing until a release that mends it is deployed.</p>`,
    { status: 503, headers: { [UPGRADE_HEADER]: "stuck" } },
  );
}

/**
 * One of the plain pages the Worker shows in place of the screen when nothing can be reached: a
 * heading saying what is wrong, the paragraphs that say what mends it, never kept by a cache.
 */
function plainPage(
  heading: string,
  paragraphs: string,
  { status, headers }: { status: number; headers: Record<string, string> },
): Response {
  const page = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5">
<h1>${heading}</h1>
${paragraphs}
</body>
</html>
`;
  return new Response(page, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/**
 * Whether a request opens the screen, as a page rather than one of its files: by the mode the
 * browser says, or, from a browser that says none, by asking for HTML. The screen reloads into the
 * stuck page, so one never shown it would reload for good.
 */
function opensTheScreen(request: Request): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  if (mode !== null) return mode === "navigate";
  return request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
}

/** Text made safe to place in HTML. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The Device the screen names in a request, if it names one. */
function deviceOf(request: Request): { device?: string } {
  const device = request.headers.get(DEVICE_HEADER);
  return device ? { device } : {};
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

/**
 * Access signed the request in, but not as the person: signing in again would hand back the same
 * Google account, so this is no lapsed sign-in (a 401, which the screen asks to sign in again on)
 * but a refusal, with the way out of that account; or, while the Deployment names no address of
 * the person's, with the deploy that mends it. Logged as why, never the address itself.
 */
function notThePersons(why: NotThePersons): Response {
  console.warn(JSON.stringify({ access: "email", result: why }));
  const refused = { status: 403, headers: { [SIGN_IN_HEADER]: "not-the-persons" } };
  if (why === "unset") {
    return plainPage(
      "This Praxis names no Google address to let in",
      `<p>Its configuration names no Google address of the person's, so it lets no one in.</p>
<p>Set <code>praxis:signInEmail</code> to the person's Google address and deploy again (docs/deployment.md).</p>`,
      refused,
    );
  }
  return plainPage(
    "This Praxis belongs to another Google address",
    `<p>You are signed in to Cloudflare Access with a Google address this Praxis does not let in. Only the person it belongs to signs in to it.</p>
<p><a href="/cdn-cgi/access/logout">Sign out of Cloudflare Access</a>, then sign in with the Google address this Praxis belongs to.</p>`,
    refused,
  );
}

/** The keys to check the sign-in with could not be read. Signing in again would not mend it. */
function unavailable(): Response {
  console.error(JSON.stringify({ access: "unavailable" }));
  return new Response("Praxis could not check the sign-in. Try again shortly.", {
    status: 503,
    headers: { "cache-control": "no-store", "retry-after": "5" },
  });
}

/**
 * Serve an MCP request. The path alone says which Connection is calling, and the Deployment object
 * is asked on every request whether it may be called and in which Context, so ending one or
 * switching it to reading only takes effect on its next call (section 7.2).
 */
async function serveMcp(
  request: Request,
  env: Env,
  pathname: string,
  arrivedAt: number,
): Promise<Response> {
  const id = connectionIdIn(pathname);
  // One ask answers both: a Connection may be called only while its Context is not retired.
  const connection = id === null ? null : await deploymentOf(env).callableConnection(id);
  if (connection === null) return noConnection(request);
  const context = env.CONTEXT.get(env.CONTEXT.idFromString(connection.context_id));
  const caller = connectionCaller(connection);
  return serveConnection(request, caller, (tool, input) =>
    context.call({ caller, tool, input, arrivedAt }),
  );
}

/**
 * Open the live channel to a Context's object, asking the Deployment object first, as for a tool
 * call, so a retired Context opens none. The object answers a request that is no WebSocket.
 */
async function openLive(request: Request, env: Env, contextId: string): Promise<Response> {
  const reached = await reachContext(env, deploymentOf(env), contextId);
  if (!reached.ok) return new Response(reached.error.message, { status: 404 });
  return reached.value.fetch(request);
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

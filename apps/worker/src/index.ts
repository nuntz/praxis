import { type Caller, failure, type ToolResult } from "@praxis/domain";
import { arrivalTime } from "./arrival.ts";
import type { ToolRequest } from "./registry.ts";
import { deploymentOf, reachContext } from "./routing.ts";

export { ContextObject } from "./context-object.ts";
export { DeploymentObject } from "./deployment-object.ts";

/** The screen calls a Deployment tool at this path, with the tool's input as the JSON body. */
const DEPLOYMENT_TOOL_PATH = /^\/api\/deployment\/tools\/([a-z_]+)$/;

/**
 * The screen calls a Context tool at this path, which names the Context by its id: the screen's
 * current Context decides it, and no tool takes a Context as input (section 4.1).
 */
const CONTEXT_TOOL_PATH = /^\/api\/contexts\/([0-9A-Za-z_-]+)\/tools\/([a-z_]+)$/;

/** The screen is the person's hand. */
const HAND: Caller = { kind: "hand" };

export default {
  async fetch(request, env): Promise<Response> {
    const arrivedAt = arrivalTime();
    const { pathname } = new URL(request.url);
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

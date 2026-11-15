import { type Caller, failure } from "@praxis/domain";
import { arrivalTime } from "./arrival.ts";

export { ContextObject } from "./context-object.ts";

/** The screen calls a Context tool at this path, with the tool's input as the JSON body. */
const TOOL_PATH = /^\/api\/tools\/([a-z_]+)$/;

/** The screen is the person's hand. */
const HAND: Caller = { kind: "hand" };

export default {
  async fetch(request, env): Promise<Response> {
    const arrivedAt = arrivalTime();
    const url = new URL(request.url);
    const match = TOOL_PATH.exec(url.pathname);
    if (!match?.[1]) return new Response("Not found", { status: 404 });
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return Response.json(failure("invalid_input", "The body is not JSON."));
    }

    const result = await currentContext(env).call({
      caller: HAND,
      tool: match[1],
      input,
      arrivedAt,
    });
    return Response.json(result);
  },
} satisfies ExportedHandler<Env>;

/**
 * The Context this request is for. There is one Context until the Deployment object routes
 * requests between several (section 9.2).
 */
function currentContext(env: Env) {
  return env.CONTEXT.get(env.CONTEXT.idFromName("only-context"));
}

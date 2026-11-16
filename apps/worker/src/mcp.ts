import { createMcpHandler, ProtocolErrorCode, Server } from "@modelcontextprotocol/server";
import {
  type Caller,
  type Connection,
  inputJsonSchema,
  offeredTo,
  type ToolResult,
  tools,
} from "@praxis/domain";

/**
 * Praxis as an MCP server (section 7, ADR 0009). A Connection is reached at its address, which
 * holds its opaque id and nothing else; the Worker asks the Deployment object which Connection
 * that is on every request, then serves it the Context tools it is offered, through the same
 * registry the screen calls. Only the stateless 2026-07-28 protocol is served, with no sessions,
 * and only tools: no resources, no prompts.
 */

/** A Connection's address: `/mcp/` and its id (section 7.2). */
const CONNECTION_ADDRESS = /^\/mcp\/([0-9A-Za-z_-]+)$/;

/** The Connection id an address under `/mcp` holds, or null when it is no Connection's. */
export function connectionIdIn(pathname: string): string | null {
  return CONNECTION_ADDRESS.exec(pathname)?.[1] ?? null;
}

/** The caller a Connection is on this call: by its id, under its name now, reading only or not. */
export function connectionCaller(connection: Connection): Caller {
  const kind = connection.reading_only ? "read_only_connection" : "connection";
  return { kind, id: connection.id, name: connection.name };
}

/**
 * The refusal for an address no Connection can be called at: one that has ended, one whose
 * Context is retired, and one that never existed alike, so the address says nothing about which
 * (section 7.2). The person mends it by making a new Connection, and the message says so.
 */
export async function noConnection(request: Request): Promise<Response> {
  let id: string | number | null = null;
  try {
    const sent: unknown = await request.json();
    const given = (sent as { id?: unknown } | null)?.id;
    if (typeof given === "string" || typeof given === "number") id = given;
  } catch {
    // Not a JSON-RPC request: the refusal answers no id.
  }
  return Response.json(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: ProtocolErrorCode.InvalidRequest,
        message:
          "No Connection is reached at this address: it has ended, or there never was one. Make a new Connection in Praxis and paste its address into this client.",
      },
    },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Serve one MCP request from a Connection that may be called. `call` runs a Context tool in the
 * Connection's Context, as the Connection, through the registry; its result is given back as the
 * screen is given it, so a refusal carries its code and says why.
 */
export function serveConnection(
  request: Request,
  caller: Caller,
  call: (tool: string, input: unknown) => Promise<ToolResult<unknown>>,
): Promise<Response> {
  const handler = createMcpHandler(
    () => {
      const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
      server.setRequestHandler("tools/list", async () => ({ tools: listed(caller) }));
      server.setRequestHandler("tools/call", async ({ params }) => {
        const result = await call(params.name, params.arguments ?? {});
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
          isError: !result.ok,
        };
      });
      return server;
    },
    {
      // Older clients are refused, never served the 2025 handshake (section 7.1). A tool sends
      // nothing before its result, so every answer is one JSON body, with no stream.
      legacy: "reject",
      // Only the error's kind: its message could quote what was sent (section 2, principle 7).
      onerror: (error) => console.error(JSON.stringify({ mcp: "error", error: error.name })),
    },
  );
  return handler.fetch(request);
}

/**
 * Who Praxis says it is. The protocol asks for a version; Praxis versions nothing it serves
 * (section 4.10), so it is fixed.
 */
const SERVER_INFO = { name: "Praxis", version: "1" };

/**
 * The Context tools a caller is offered, under the names and schemas the screen calls them by.
 * The hints come from each tool's metadata (section 7.3).
 */
function listed(caller: Caller) {
  return offeredTo(caller.kind).map((name) => {
    const tool = tools[name];
    return {
      name,
      description: tool.description,
      inputSchema: inputJsonSchema(name) as { type: "object" },
      annotations:
        tool.kind === "read"
          ? { readOnlyHint: true }
          : { readOnlyHint: false, destructiveHint: tool.destructive },
    };
  });
}

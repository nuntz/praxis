import { env } from "cloudflare:workers";

// MCP as an outside agent reaches it (sections 7 and 13): a real MCP SDK client over Streamable
// HTTP against the Worker in workerd, signed in by Access with a test key. Like endpoint.test.ts
// it reaches the objects over HTTP, so the oracle does not see these calls: it covers only what
// MCP adds, which Connection is calling, what it is offered and what it is refused. What the tools
// do is tested at the seam.
//
// A request Praxis serves goes through the SDK client: a 2026-07-28 request carries headers that
// must agree with its body, and the SDK sends them. A request written by hand here is one Praxis
// refuses before it gets that far.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  type Connection,
  type ContextListing,
  type Entry,
  inputJsonSchema,
  type ToolName,
  type ToolResult,
  tools,
} from "@praxis/domain";
import { beforeEach, describe, expect, test } from "vitest";
import { ACCESS_TOKEN_HEADER } from "../src/access.ts";
import { praxis } from "../src/worker.ts";
import { fakeAccess, TEST_APPLICATION } from "./access-fake.ts";
import { offering } from "./offering.ts";

const ORIGIN = "https://praxis.test";

let worker: ReturnType<typeof praxis>;
let token: string;

beforeEach(async () => {
  const access = await fakeAccess(TEST_APPLICATION);
  worker = praxis(() => access.setup());
  // The Worker reads the real clock when a request arrives, so the token is signed at it.
  token = await access.sign(Date.now());
});

/** A request to the Worker as Access lets it through, signed in as the person. */
function send(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(ACCESS_TOKEN_HEADER, token);
  return worker.fetch(new Request(url, { ...init, headers }), env);
}

/** A tool called by the person's hand, as the screen calls it. */
async function byHand<T>(path: string, input: unknown): Promise<T> {
  const response = await send(`${ORIGIN}${path}`, { method: "POST", body: JSON.stringify(input) });
  const result = (await response.json()) as ToolResult<T>;
  if (!result.ok) throw new Error(`${path}: ${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function makeContext(name: string): Promise<string> {
  const made = await byHand<{ record: ContextListing }>("/api/deployment/tools/create_context", {
    name,
    time_zone: "Europe/Paris",
    accent: "teal",
  });
  return made.record.id;
}

async function makeConnection(
  context_id: string,
  name = "Claude Code",
  reading_only = false,
): Promise<Connection> {
  const made = await byHand<{ record: Connection }>("/api/deployment/tools/create_connection", {
    name,
    context_id,
    reading_only,
  });
  return made.record;
}

function deploymentTool(tool: string, input: unknown) {
  return byHand(`/api/deployment/tools/${tool}`, input);
}

function entriesOf(contextId: string) {
  return byHand<{ items: Entry[] }>(`/api/contexts/${contextId}/tools/list_entries`, {});
}

/** An outside agent with the address pasted into it, speaking only the 2026-07-28 protocol. */
async function connectTo(address: string): Promise<Client> {
  const client = new Client(
    { name: "an outside agent", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(address, ORIGIN), {
    fetch: (url, init) => send(url, init),
  });
  await client.connect(transport);
  return client;
}

/** A tool called over MCP, and the result Praxis gave, the same as the screen is given. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const called = await client.callTool({ name, arguments: args });
  return {
    isError: called.isError ?? false,
    result: called.structuredContent as ToolResult<never>,
  };
}

/** The tools a column of the offering table says a caller is offered. */
function offeredIn(column: 3 | 4): string[] {
  return Object.entries(offering)
    .filter(([, row]) => row[column] === "yes")
    .map(([tool]) => tool)
    .toSorted();
}

describe("what a Connection is offered", () => {
  test("its tool list is the Connection column of the offering table, under the same names and schemas, and nothing but tools", async () => {
    const client = await connectTo((await makeConnection(await makeContext("Work"))).address);

    const listed = (await client.listTools()).tools;

    expect(listed.map((tool) => tool.name).toSorted()).toEqual(offeredIn(3));
    for (const tool of listed) {
      const { kind, description } = tools[tool.name as ToolName];
      expect(tool.description).toBe(description);
      expect(tool.inputSchema).toEqual(inputJsonSchema(tool.name as ToolName));
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(kind === "read");
      const { destructive } = tools[tool.name as ToolName] as { destructive?: boolean };
      expect(tool.annotations?.destructiveHint, tool.name).toBe(destructive);
    }
    expect(client.getServerCapabilities()).toEqual({ tools: {} });
  });

  test("a schema is the domain's, as JSON Schema", async () => {
    const client = await connectTo((await makeConnection(await makeContext("Work"))).address);

    const getEntry = (await client.listTools()).tools.find((tool) => tool.name === "get_entry");

    expect(getEntry?.inputSchema).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
      additionalProperties: false,
    });
  });

  test("a write that only adds is not destructive; one that changes or takes away is", async () => {
    const client = await connectTo((await makeConnection(await makeContext("Work"))).address);

    const hints = Object.fromEntries(
      (await client.listTools()).tools.map((tool) => [tool.name, tool.annotations]),
    );

    expect(hints.record_entry).toEqual({ readOnlyHint: false, destructiveHint: false });
    expect(hints.create_person).toEqual({ readOnlyHint: false, destructiveHint: false });
    expect(hints.drop_task).toEqual({ readOnlyHint: false, destructiveHint: true });
    expect(hints.remove_link).toEqual({ readOnlyHint: false, destructiveHint: true });
    expect(hints.list_entries).toEqual({ readOnlyHint: true });
  });

  test("a Connection limited to reading is offered the reading tools only, and is refused a write", async () => {
    const work = await makeContext("Work");
    const client = await connectTo((await makeConnection(work, "Reader", true)).address);

    const listed = (await client.listTools()).tools.map((tool) => tool.name).toSorted();
    const written = await call(client, "record_entry", { words: "Never recorded" });

    expect(listed).toEqual(offeredIn(4));
    expect(written).toMatchObject({ isError: true, result: { error: { code: "not_offered" } } });
    expect((await entriesOf(work)).items).toEqual([]);
  });

  test("a tool not offered to it is refused, whatever its name", async () => {
    const client = await connectTo((await makeConnection(await makeContext("Work"))).address);

    for (const name of ["set_time_zone", "create_context", "no_such_tool"]) {
      expect(await call(client, name, {}), name).toMatchObject({
        isError: true,
        result: { ok: false, error: { code: "not_offered" } },
      });
    }
  });

  test("a held call is refused, with the error saying to add a Follow-up or ask the person to make the edit", async () => {
    const work = await makeContext("Work");
    const theirs = await byHand<{ record: Entry }>(`/api/contexts/${work}/tools/record_entry`, {
      words: "The person's own words",
    });
    const client = await connectTo((await makeConnection(work)).address);

    const edited = await call(client, "edit_entry", {
      id: theirs.record.id,
      words: "Rewritten from outside",
      version: theirs.record.version,
    });

    expect(edited).toMatchObject({
      isError: true,
      result: {
        ok: false,
        error: { code: "held", message: expect.stringMatching(/Follow-up.*ask the person/s) },
      },
    });
    expect((await entriesOf(work)).items).toEqual([theirs.record]);
  });
});

describe("what a Connection reaches", () => {
  test("its own Context only, through the same tools as the screen, as its own Author", async () => {
    const work = await makeContext("Work");
    const home = await makeContext("Home");
    await byHand(`/api/contexts/${home}/tools/record_entry`, { words: "Fix the bike" });
    const connection = await makeConnection(work, "Claude Code");
    const client = await connectTo(connection.address);

    const recorded = await call(client, "record_entry", { words: "Draft the plan" });
    const read = await call(client, "list_entries");

    expect(recorded).toMatchObject({
      isError: false,
      result: {
        ok: true,
        value: {
          record: { words: "Draft the plan", author: { kind: "connection", name: "Claude Code" } },
        },
      },
    });
    expect(read).toMatchObject({ result: { value: { items: [{ words: "Draft the plan" }] } } });
    expect((await entriesOf(work)).items.map((entry) => entry.words)).toEqual(["Draft the plan"]);
    expect((await entriesOf(home)).items.map((entry) => entry.words)).toEqual(["Fix the bike"]);
    const changes = await byHand<{ items: { caller: unknown }[] }>(
      `/api/contexts/${work}/tools/list_changes`,
      {},
    );
    expect(changes.items.map((change) => change.caller)).toEqual([
      { kind: "connection", id: connection.id, name: "Claude Code" },
    ]);
  });

  test("a result it is given is the one the screen is given, and a refusal says why", async () => {
    const client = await connectTo((await makeConnection(await makeContext("Work"))).address);

    const missing = await call(client, "get_entry", { id: "no-such-entry" });
    const invalid = await call(client, "record_entry", { words: " " });
    const read = await client.callTool({ name: "get_settings", arguments: {} });

    expect(missing).toMatchObject({
      isError: true,
      result: { ok: false, error: { code: "not_found" } },
    });
    expect(invalid).toMatchObject({ isError: true, result: { error: { code: "invalid_input" } } });
    expect(read.content).toEqual([{ type: "text", text: JSON.stringify(read.structuredContent) }]);
  });

  test("its name is the Author of what it made, and is kept after it ends", async () => {
    const work = await makeContext("Work");
    const connection = await makeConnection(work, "Laptop");
    const client = await connectTo(connection.address);
    await call(client, "record_entry", { words: "Recorded from the laptop" });

    await deploymentTool("end_connection", { id: connection.id });

    expect((await entriesOf(work)).items).toMatchObject([
      { words: "Recorded from the laptop", author: { kind: "connection", name: "Laptop" } },
    ]);
  });
});

describe("a Connection is checked on every call", () => {
  /** The refusal every request to an address no Connection can be called at is given. */
  async function refusal(address: string) {
    const response = await send(new URL(address, ORIGIN), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }),
    });
    return { status: response.status, body: await response.json() };
  }

  test("ending one refuses its next call, saying to make a new Connection", async () => {
    const connection = await makeConnection(await makeContext("Work"));
    const client = await connectTo(connection.address);
    expect(await call(client, "get_settings")).toMatchObject({ isError: false });

    await deploymentTool("end_connection", { id: connection.id });

    await expect(call(client, "get_settings")).rejects.toThrow(/make a new Connection in Praxis/i);
  });

  test("an ended Connection and an address that never existed get the same refusal", async () => {
    const connection = await makeConnection(await makeContext("Work"));
    await deploymentTool("end_connection", { id: connection.id });

    const ended = await refusal(connection.address);

    expect(ended).toEqual({
      status: 404,
      body: {
        jsonrpc: "2.0",
        id: 7,
        error: { code: -32600, message: expect.stringMatching(/make a new Connection in Praxis/i) },
      },
    });
    for (const address of ["/mcp/never-made", "/mcp", "/mcp/", `/mcp/${connection.id}/more`]) {
      expect(await refusal(address), address).toEqual(ended);
    }
  });

  test("switching it to reading only takes effect on its next call", async () => {
    const work = await makeContext("Work");
    const connection = await makeConnection(work);
    const client = await connectTo(connection.address);

    await deploymentTool("set_connection_reading_only", { id: connection.id, reading_only: true });

    expect(await call(client, "record_entry", { words: "Not now" })).toMatchObject({
      isError: true,
      result: { error: { code: "not_offered" } },
    });
    expect((await client.listTools()).tools.map((tool) => tool.name).toSorted()).toEqual(
      offeredIn(4),
    );
    expect((await entriesOf(work)).items).toEqual([]);
  });

  test("retiring its Context ends it, and bringing the Context back does not restore it", async () => {
    const work = await makeContext("Work");
    await makeContext("Home");
    const connection = await makeConnection(work);
    const client = await connectTo(connection.address);

    await deploymentTool("retire_context", { id: work });
    await expect(call(client, "list_entries")).rejects.toThrow(/make a new Connection/i);

    await deploymentTool("bring_back_context", { id: work });
    await expect(call(client, "list_entries")).rejects.toThrow(/make a new Connection/i);
  });
});

describe("the protocol", () => {
  test("an older client is refused: only the stateless 2026-07-28 protocol is served", async () => {
    const connection = await makeConnection(await makeContext("Work"));

    const response = await send(new URL(connection.address, ORIGIN), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "an older client", version: "1" },
        },
      }),
    });

    expect(await response.json()).toMatchObject({
      id: 1,
      error: { code: -32022, data: { supported: ["2026-07-28"] } },
    });
    expect(response.headers.get("mcp-session-id")).toBeNull();
  });

  test("there are no sessions to open or close", async () => {
    const { address } = await makeConnection(await makeContext("Work"));

    for (const method of ["GET", "DELETE"]) {
      expect((await send(new URL(address, ORIGIN), { method })).status, method).toBe(405);
    }
  });
});

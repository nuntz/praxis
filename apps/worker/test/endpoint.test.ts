import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";

// The one test that reaches the objects the way the screen does, over HTTP, so it is the one test
// whose calls the oracle does not see. It covers only the endpoint's own work: the sign-in every
// request needs, which object, which caller, which tool, and the body. What the tools do is
// tested at the seam.
import { DEVICE_HEADER, type Device } from "@praxis/domain";
import { beforeEach, describe, expect, test } from "vitest";
import { ACCESS_TOKEN_HEADER } from "../src/access.ts";
import { praxis } from "../src/worker.ts";
import { fakeAccess, TEST_APPLICATION, TOKEN_LIFE } from "./access-fake.ts";
import { subscribe } from "./push-fake.ts";

/** The Worker behind a fake Access, and a token Access put on the person's requests. */
let access: Awaited<ReturnType<typeof fakeAccess>>;
let worker: ReturnType<typeof praxis>;
let token: string;

beforeEach(async () => {
  access = await fakeAccess(TEST_APPLICATION);
  worker = praxis(() => ({ keySet: access.keySet, application: TEST_APPLICATION }));
  // The Worker reads the real clock when a request arrives, so the token is signed at it.
  token = await access.sign(Date.now());
});

/** A request as it reaches the Worker, with Access's token on it unless another is given. */
function send(path: string, init: RequestInit = {}, signedWith: string | null = token) {
  const headers = new Headers(init.headers);
  if (signedWith !== null) headers.set(ACCESS_TOKEN_HEADER, signedWith);
  return worker.fetch(new Request(`https://praxis.test${path}`, { ...init, headers }), env);
}

function post(path: string, body: string) {
  return send(path, { method: "POST", headers: { "content-type": "application/json" }, body });
}

async function callTool(path: string, input: unknown) {
  return (await post(path, JSON.stringify(input))).json() as Promise<{
    ok: boolean;
    value?: unknown;
    error?: { code: string };
  }>;
}

async function makeContext(name: string): Promise<string> {
  const made = await callTool("/api/deployment/tools/create_context", {
    name,
    time_zone: "Europe/Paris",
    accent: "moss",
  });
  return (made.value as { record: { id: string } }).record.id;
}

/** Every kind of request Praxis answers: the screen, its files, the tool endpoint and MCP. */
const EVERYWHERE: [string, RequestInit][] = [
  ["/", {}],
  ["/index.html", {}],
  ["/manifest.webmanifest", {}],
  ["/a/path/the/screen/routes", {}],
  ["/api/deployment/tools/list_contexts", { method: "POST", body: "{}" }],
  ["/api/contexts/x/tools/list_entries", { method: "POST", body: "{}" }],
  ["/api/other", { method: "POST", body: "{}" }],
  ["/mcp", { method: "POST", body: "{}" }],
  ["/mcp/an-address", { method: "POST", body: "{}" }],
  ["/api/contexts/x/live", { headers: { upgrade: "websocket" } }],
];

describe("the Access sign-in every request needs", () => {
  test("a request with no Access token is refused, wherever it is for", async () => {
    for (const [path, init] of EVERYWHERE) {
      expect((await send(path, init, null)).status, path).toBe(401);
    }
  });

  test("a token Access did not sign, or that has lapsed, is refused, wherever it is for", async () => {
    const lapsed = await access.sign(Date.now() - 2 * TOKEN_LIFE);
    const other = await access.sign(Date.now(), { aud: ["another-application"] });

    for (const signedWith of ["not-a-token", lapsed, other]) {
      for (const [path, init] of EVERYWHERE) {
        expect((await send(path, init, signedWith)).status, path).toBe(401);
      }
    }
  });

  test("a refused request reaches no tool", async () => {
    const id = await makeContext("Home");

    await send(
      `/api/contexts/${id}/tools/record_entry`,
      {
        method: "POST",
        body: JSON.stringify({ words: "Never recorded" }),
      },
      null,
    );

    expect(await callTool(`/api/contexts/${id}/tools/list_entries`, {})).toMatchObject({
      value: { items: [] },
    });
  });

  test("signed in, the request reaches what it is for", async () => {
    expect((await send("/mcp", { method: "POST", body: "{}" })).status).toBe(404);
    expect(await callTool("/api/deployment/tools/list_contexts", {})).toMatchObject({ ok: true });
  });

  test("when Access's keys cannot be read the request is unavailable, not signed out", async () => {
    access.setReachable(false);

    for (const [path, init] of EVERYWHERE) {
      expect((await send(path, init)).status, path).toBe(503);
    }
  });

  test("the Worker as deployed lets nothing in until it names its Access application", async () => {
    // The configuration in the repo names none: the setup wizard gives each Deployment its own.
    const response = await exports.default.fetch(
      new Request("https://praxis.test/api/deployment/tools/list_contexts", {
        method: "POST",
        headers: { [ACCESS_TOKEN_HEADER]: token },
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
  });
});

describe("the screen and its files", () => {
  // CI runs these tests before the screen is built, so they see none of its files, and a local run
  // sees the same from the empty folder vitest.config.ts serves, whatever build apps/pwa/dist holds.
  test("are none of them here, as in CI, whatever the screen's build holds", async () => {
    for (const path of ["/", "/index.html", "/manifest.webmanifest"]) {
      expect((await env.ASSETS.fetch(`https://praxis.test${path}`)).status, path).toBe(404);
    }
  });

  test("carry the content security policy: the screen's own address, and images from any https host", async () => {
    // Whatever they answer, which here is that each is not found.
    for (const path of ["/", "/index.html", "/manifest.webmanifest", "/a/path/the/screen/routes"]) {
      const served = await send(path);
      expect(served.headers.get("content-security-policy"), path).toBe(
        "default-src 'self'; img-src 'self' https:; base-uri 'none'; frame-ancestors 'none'",
      );
    }
  });
});

describe("the screen's tool endpoint", () => {
  test("the screen calls Deployment tools as the person's hand", async () => {
    const id = await makeContext("Home");

    const listed = await callTool("/api/deployment/tools/list_contexts", {});

    expect(listed).toMatchObject({ ok: true });
    expect((listed.value as { items: unknown[] }).items).toContainEqual({
      id,
      name: "Home",
      accent: "moss",
      retired: false,
    });
  });

  test("the Device a Deployment call names in its header is seen then", async () => {
    const device = crypto.randomUUID();
    const fromDevice = (tool: string, input: unknown) =>
      send(`/api/deployment/tools/${tool}`, {
        method: "POST",
        headers: { "content-type": "application/json", [DEVICE_HEADER]: device },
        body: JSON.stringify(input),
      }).then((response) => response.json() as Promise<{ value: unknown }>);
    const seen = async () => {
      const { value } = await fromDevice("list_devices", {});
      return (value as { items: Device[] }).items.find(({ id }) => id === device)?.seen;
    };
    await fromDevice("set_device_notifications", {
      id: device,
      on: true,
      subscription: subscribe(),
      user_agent: "Mozilla/5.0 (Macintosh) Version/18.1 Safari/605.1.15",
    });
    const first = await seen();
    // The Worker reads the real clock when a request arrives.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const later = await seen();

    expect(first).toEqual(expect.any(String));
    expect(Date.parse(later ?? "")).toBeGreaterThan(Date.parse(first ?? ""));
  });

  test("the screen calls a Context's tools as the person's hand, at the address naming it", async () => {
    const work = await makeContext("Work");
    const home = await makeContext("Home");

    const recorded = await callTool(`/api/contexts/${work}/tools/record_entry`, {
      words: "Typed in the Journal",
    });

    expect(recorded).toMatchObject({
      ok: true,
      value: { record: { words: "Typed in the Journal", author: { kind: "person" } } },
    });
    expect(await callTool(`/api/contexts/${work}/tools/list_entries`, {})).toMatchObject({
      ok: true,
      value: { items: [{ words: "Typed in the Journal" }], next_cursor: null },
    });
    expect(await callTool(`/api/contexts/${home}/tools/list_entries`, {})).toMatchObject({
      ok: true,
      value: { items: [], next_cursor: null },
    });
  });

  test("an address naming no Context, or a retired one, reaches nothing", async () => {
    const work = await makeContext("Work");
    await makeContext("Home");
    await callTool("/api/deployment/tools/retire_context", { id: work });

    for (const id of [work, "no-such-context", "0".repeat(64)]) {
      expect(await callTool(`/api/contexts/${id}/tools/list_entries`, {})).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
  });

  test("a body that is not JSON is invalid input", async () => {
    const work = await makeContext("Work");

    for (const path of [
      `/api/contexts/${work}/tools/record_entry`,
      "/api/deployment/tools/create_context",
    ]) {
      expect(await (await post(path, "words")).json()).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    }
  });

  test("a tool is called with POST only", async () => {
    for (const path of [
      "/api/contexts/x/tools/list_entries",
      "/api/deployment/tools/list_contexts",
    ]) {
      expect((await send(path)).status).toBe(405);
    }
  });

  test("any other path under /api is not found", async () => {
    for (const path of ["/api/contexts/x/live/more", "/api/contexts/live"]) {
      expect((await send(path, { headers: { upgrade: "websocket" } })).status).toBe(404);
    }
    for (const path of ["/api/tools/list_entries", "/api/contexts/x/list_entries", "/api/other"]) {
      expect((await post(path, "{}")).status).toBe(404);
    }
  });
});

describe("the live channel's address", () => {
  /** Open the live channel at a Context's address, as the screen does. */
  function openLive(id: string, headers: HeadersInit = { upgrade: "websocket" }) {
    return send(`/api/contexts/${id}/live`, { headers });
  }

  test("signed in, it opens the channel of the Context the address names", async () => {
    const work = await makeContext("Work");
    await makeContext("Home");

    const response = await openLive(work);
    const socket = response.webSocket;
    if (!socket) throw new Error(`No channel opened: ${response.status}`);
    socket.accept();
    const messages: { items: { tool: string }[] }[] = [];
    const twoArrived = new Promise<void>((resolve) =>
      socket.addEventListener("message", (event) => {
        messages.push(JSON.parse(String(event.data)));
        if (messages.length === 2) resolve();
      }),
    );
    await callTool(`/api/contexts/${work}/tools/record_entry`, { words: "Seen live" });
    await twoArrived;

    expect(response.status).toBe(101);
    expect(messages.map((message) => message.items.map((change) => change.tool))).toEqual([
      [],
      ["record_entry"],
    ]);
    socket.close(1000, "Done");
  });

  test("an address naming no Context, or a retired one, opens nothing", async () => {
    const work = await makeContext("Work");
    await makeContext("Home");
    await callTool("/api/deployment/tools/retire_context", { id: work });

    for (const id of [work, "no-such-context", "0".repeat(64)]) {
      const response = await openLive(id);
      expect(response.status, id).toBe(404);
      expect(response.webSocket).toBeNull();
    }
  });

  test("a request that is not for a WebSocket is told to upgrade", async () => {
    const work = await makeContext("Work");

    for (const headers of [{ upgrade: "h2c" }, {}]) {
      expect((await openLive(work, headers)).status).toBe(426);
    }
  });
});

describe("the daily trigger", () => {
  test("makes the day's Backup through the Deployment object, at the time it fired", async () => {
    await makeContext("Work");
    const fired = createScheduledController({
      scheduledTime: Date.parse("2026-11-16T03:00:00.000Z"),
      cron: "0 3 * * *",
    });
    const context = createExecutionContext();

    await worker.scheduled?.(fired, env, context);
    await waitOnExecutionContext(context);

    expect(await callTool("/api/deployment/tools/get_last_backup", {})).toEqual({
      ok: true,
      value: { made_at: "2026-11-16T03:00:00.000Z" },
    });
  });
});

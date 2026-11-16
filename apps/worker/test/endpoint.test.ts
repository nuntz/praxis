import { exports } from "cloudflare:workers";

// The one test that reaches the objects the way the screen does, over HTTP, so it is the one test
// whose calls the oracle does not see. It covers only the endpoint's own work: which object,
// which caller, which tool, and the body. What the tools do is tested at the seam.
import { describe, expect, test } from "vitest";

function post(path: string, body: string) {
  return exports.default.fetch(
    new Request(`https://praxis.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
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
      const response = await exports.default.fetch(`https://praxis.test${path}`);
      expect(response.status).toBe(405);
    }
  });

  test("any other path under /api is not found", async () => {
    for (const path of ["/api/tools/list_entries", "/api/contexts/x/list_entries", "/api/other"]) {
      expect((await post(path, "{}")).status).toBe(404);
    }
  });
});

import { exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

function callTool(tool: string, body: string) {
  return exports.default.fetch(
    new Request(`https://praxis.test/api/tools/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
}

describe("the screen's tool endpoint", () => {
  test("the screen calls Context tools as the person's hand", async () => {
    const recorded = await (
      await callTool("record_entry", JSON.stringify({ words: "Typed in the Journal" }))
    ).json();

    expect(recorded).toMatchObject({
      ok: true,
      value: { record: { words: "Typed in the Journal", author: { kind: "person" } } },
    });

    const listed = await (await callTool("list_entries", "{}")).json();
    expect(listed).toMatchObject({
      ok: true,
      value: { items: [{ words: "Typed in the Journal" }], next_cursor: null },
    });
  });

  test("a body that is not JSON is invalid input", async () => {
    const result = await (await callTool("record_entry", "words")).json();

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  test("a tool is called with POST only", async () => {
    const response = await exports.default.fetch("https://praxis.test/api/tools/list_entries");

    expect(response.status).toBe(405);
  });
});

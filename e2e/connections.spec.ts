import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Locator, Page } from "@playwright/test";
import {
  callDeploymentTool,
  closeSettings,
  expect,
  lastShown,
  makeContext,
  openSettings,
  showSection,
  test,
} from "./fixtures.ts";

// The person makes a Connection in the Deployment's settings, for an outside agent to work in one
// Context, and pastes its address into the agent (sections 7.2 and 8.6, ADR 0009).

/**
 * An outside agent with the address pasted into it, signed in through Access as the person: the
 * stand-in for Access in front of the Worker signs in every request it lets through.
 */
async function connectTo(address: string): Promise<Client> {
  const client = new Client(
    { name: "a browser journey", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(address)));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })).structuredContent;
}

test("the person makes a Connection to one Context, and its address reaches that Context until it is ended", async ({
  page,
  context: browser,
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const work = await makeContext(page, { name: `Work ${tag}`, time_zone: "UTC", accent: "teal" });
  await lastShown(page, work.id);
  await browser.grantPermissions(["clipboard-read", "clipboard-write"]);
  const connections = page.getByRole("region", { name: "Connections" });
  const name = `Claude ${tag}`;
  const row = connections.getByTestId("connection-row").filter({
    has: page.getByText(name, { exact: true }),
  });
  // The settings' first read of the Connections answers only once the new one shows, as it can
  // on a busy Deployment: what it answers was read before the Connection was made.
  await page.route(
    /\/list_connections$/,
    async (route) => {
      const answer = await route.fetch();
      await row.waitFor();
      await route.fulfill({ response: answer });
    },
    { times: 1 },
  );
  await page.goto("/");
  await openSettings(page, "Connections");

  // The form is opened on demand, its first field focused.
  const form = connections.getByRole("form", { name: "New Connection" });
  await expect(form).toHaveCount(0);
  await connections.getByRole("button", { name: "New Connection…", exact: true }).click();
  await expect(form.getByLabel("Name", { exact: true })).toBeFocused();
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form
    .getByRole("combobox", { name: "Context", exact: true })
    .selectOption({ label: work.name });
  await form.getByRole("button", { name: "Make the Connection" }).click();
  // Made, the form closes.
  await expect(form).toHaveCount(0);

  await expect(row.getByText(`in ${work.name}`, { exact: true })).toBeVisible();
  await expect(row.getByRole("switch", { name: "Reading only", exact: true })).not.toBeChecked();
  // An address under /mcp on this Deployment, holding an opaque id that never names the Context,
  // shown whole, and copied by its Copy.
  const shown = new RegExp(`^${new URL(page.url()).origin}/mcp/[0-9A-Za-z_-]{20,}$`);
  const address = row.getByText(shown);
  await expect(address).toBeVisible();
  const pasted = await address.textContent();
  if (pasted === null) throw new Error("The address is shown");
  expect(pasted).not.toContain(work.id);
  await row.getByRole("button", { name: `Copy the address of ${name}`, exact: true }).click();
  await expect(row.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(pasted);
  await expect(row.getByRole("status")).toHaveText("");

  // Pasted into an agent, it reaches that Context, as the Connection.
  const agent = await connectTo(pasted);
  expect(await call(agent, "get_settings")).toMatchObject({ ok: true, value: { name: work.name } });

  // Limited to reading from its next call on, which its note says.
  // The switch shows on at the tap; the Connection is limited once the tool has answered.
  const switched = page.waitForResponse(/\/set_connection_reading_only$/);
  await row.getByRole("switch", { name: "Reading only", exact: true }).check();
  await switched;
  await expect(row.getByRole("switch", { name: "Reading only", exact: true })).toBeChecked();
  await expect(row.getByText(`in ${work.name} · Reading only`, { exact: true })).toBeVisible();
  expect(await call(agent, "record_entry", { words: `Never recorded ${tag}` })).toMatchObject({
    ok: false,
    error: { code: "not_offered" },
  });

  // End, from behind More, only marks it, beside a Keep it that takes the focus: until
  // Connections is left it works, and Keep it takes the mark back, the focus back on More.
  const keep = row.getByRole("button", { name: "Keep it", exact: true });
  await end(row, name);
  await expect(
    row.getByText("Ends when you leave Connections. Its address stops working.", { exact: true }),
  ).toBeVisible();
  await expect(keep).toBeFocused();
  expect(await call(agent, "get_settings")).toMatchObject({ ok: true });
  await keep.click();
  await expect(row.getByRole("button", { name: `More for ${name}`, exact: true })).toBeFocused();
  await showSection(page, "Devices");
  expect(await call(agent, "get_settings")).toMatchObject({ ok: true });

  // Ended, and Connections left, the address is refused with what to do instead.
  await showSection(page, "Connections");
  await end(row, name);
  const ending = page.waitForResponse(/\/end_connection$/);
  await showSection(page, "Devices");
  expect((await (await ending).json()).ok).toBe(true);
  await showSection(page, "Connections");
  await expect(row).toHaveCount(0);
  await expect(call(agent, "get_settings")).rejects.toThrow(/Make a new Connection in Praxis/);
});

/** End a Connection from behind its row's More, as the person does. */
async function end(row: Locator, name: string) {
  await row.getByRole("button", { name: `More for ${name}`, exact: true }).click();
  await row
    .page()
    .getByRole("menu", { name: `More for ${name}`, exact: true })
    .getByRole("menuitem", { name: "End", exact: true })
    .click();
}

/** Whether a Connection, by its id, is still listed: one ended is not. */
async function listed(page: Page, id: string): Promise<boolean> {
  const { items } = await callDeploymentTool(page, "list_connections", {});
  return items.some((connection: { id: string }) => connection.id === id);
}

test("a Connection marked to end with no network is not ended as Connections is left, and the screen says so", async ({
  page,
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const work = await makeContext(page, { name: `Kept ${tag}`, time_zone: "UTC", accent: "teal" });
  const name = `Agent ${tag}`;
  const { record } = await callDeploymentTool(page, "create_connection", {
    name,
    context_id: work.id,
    reading_only: false,
  });
  await page.goto("/");
  const connections = await openSettings(page, "Connections");
  const row = connections.getByTestId("connection-row").filter({
    has: page.getByText(name, { exact: true }),
  });

  await end(row, name);
  await expect(row.getByRole("button", { name: "Keep it", exact: true })).toBeFocused();
  await page.context().setOffline(true);
  await closeSettings(page);
  await expect(page.getByRole("alert")).toHaveText(
    "Praxis could not be reached: nothing was ended.",
  );
  await page.context().setOffline(false);
  expect(await listed(page, record.id)).toBe(true);
});

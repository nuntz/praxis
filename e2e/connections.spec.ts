import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, lastShown, makeContext, test } from "./fixtures.ts";

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
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const work = await makeContext(page, { name: `Work ${tag}`, time_zone: "UTC", accent: "teal" });
  await lastShown(page, work.id);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const connections = page.getByRole("region", { name: "Connections" });
  const name = `Claude ${tag}`;

  const form = connections.getByRole("form", { name: "New Connection" });
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form
    .getByRole("combobox", { name: "Context", exact: true })
    .selectOption({ label: work.name });
  await form.getByRole("button", { name: "Make the Connection" }).click();

  const row = connections.getByTestId("connection-row").filter({
    has: page.getByRole("textbox", { name: `Name of ${name}` }),
  });
  await expect(row.getByText(`in ${work.name}`)).toBeVisible();
  await expect(row.getByLabel("Reading only", { exact: true })).not.toBeChecked();
  const address = await row.getByLabel(`Address of ${name}`, { exact: true }).inputValue();
  // An address under /mcp on this Deployment, holding an opaque id that never names the Context.
  expect(address).toMatch(new RegExp(`^${new URL(page.url()).origin}/mcp/[0-9A-Za-z_-]{20,}$`));
  expect(address).not.toContain(work.id);

  // Pasted into an agent, it reaches that Context, as the Connection.
  const agent = await connectTo(address);
  expect(await call(agent, "get_settings")).toMatchObject({ ok: true, value: { name: work.name } });

  // Limited to reading from its next call on.
  // The box shows checked at the tap; the Connection is limited once the tool has answered.
  const switched = page.waitForResponse(/\/set_connection_reading_only$/);
  await row.getByLabel("Reading only", { exact: true }).check();
  await switched;
  await expect(row.getByLabel("Reading only", { exact: true })).toBeChecked();
  expect(await call(agent, "record_entry", { words: `Never recorded ${tag}` })).toMatchObject({
    ok: false,
    error: { code: "not_offered" },
  });

  // Ended, it leaves the list, and the address is refused with what to do instead.
  await row.getByRole("button", { name: `End ${name}` }).click();
  await expect(row).toHaveCount(0);
  await expect(call(agent, "get_settings")).rejects.toThrow(/Make a new Connection in Praxis/);
});

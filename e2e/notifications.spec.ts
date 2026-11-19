import { conversationAddress } from "@praxis/domain";
import { callContextTool, expect, lastShown, makeContext, onPhone, test } from "./fixtures.ts";

// Notifications (sections 8.7 and 8.10, ADR 0013). A browser cannot be pushed to in a journey, so
// what is sent is tested at the seam, and delivery by hand per Deployment (section 13). A journey
// covers the screen's end: the Context's one switch, the Devices section, and the address a tap
// on a Notification opens. The Worker the journeys run against has no signing key pair.

test("a Context's settings turn its one Notification switch, and the Deployment's say what a Device needs", async ({
  page,
}) => {
  const { id, name } = await makeContext(page, {
    name: `Notified ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "plum",
  });
  await lastShown(page, id);

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: `Settings for ${name}` });
  const notifications = settings.getByRole("checkbox", { name: /Brief or the Review is ready/ });
  await expect(notifications).toBeChecked();

  const turned = page.waitForResponse((response) =>
    response.url().endsWith(`/api/contexts/${id}/tools/set_notifications`),
  );
  await notifications.uncheck();
  await turned;

  // What the server kept, read back as the screen reads it.
  expect(await callContextTool(page, id, "get_settings", {})).toMatchObject({
    notifications: false,
  });
  const devices = page.getByRole("region", { name: "Devices" });
  await expect(devices.getByText(/no key to send Notifications with/)).toBeVisible();
});

test("the address a Notification's tap opens shows its Context's Conversation", async ({
  page,
}, testInfo) => {
  const { id, name } = await makeContext(page, {
    name: `Tapped ${crypto.randomUUID().slice(0, 8)}`,
    time_zone: "UTC",
    accent: "moss",
  });

  await page.goto(conversationAddress(id));

  await expect(page.getByRole("button", { name: `Context: ${name}` })).toBeVisible();
  await expect(page.getByRole("region", { name: "Conversation" })).toBeVisible();
  if (onPhone(testInfo)) {
    await expect(
      page.getByRole("navigation", { name: "Columns" }).getByRole("button", { name: "Agent" }),
    ).toHaveAttribute("aria-current", "true");
  }
  // The address is put back, so a reload opens where the person last was.
  await expect(page).toHaveURL(/\/$/);
});

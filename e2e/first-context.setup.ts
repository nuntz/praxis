import { expect, test } from "./fixtures.ts";

// A Deployment has no Context until the first is made, and every journey but the ones that make
// their own shares that one. The server starts empty for each run, so the first run of this
// makes it, by the screen a Deployment with none shows; a repeat finds it made.

test("the person makes the first Context, in the Device's time zone, from a screen showing nothing else", async ({
  page,
}, testInfo) => {
  const listed = await page.request.post("/api/deployment/tools/list_contexts", { data: {} });
  const { value } = await listed.json();
  test.skip(value.items.length > 0, "The first Context is already made.");

  await page.goto("/");
  const form = page.getByRole("form", { name: "Make your first Context" });
  await expect(form.getByLabel("Time zone", { exact: true })).toHaveValue(
    testInfo.project.use.timezoneId ?? "",
  );
  await expect(page.getByRole("region", { name: "Journal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Context: / })).toHaveCount(0);

  await form.getByLabel("Name", { exact: true }).fill("Personal");
  // The time zone left as this Device's; the accent left as the first, Blue.
  await form.getByRole("button", { name: "Make the Context" }).click();

  await expect(page.getByRole("button", { name: "Context: Personal" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Journal" })).toBeVisible();
});

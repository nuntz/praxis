import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import type { StandingNotice } from "@praxis/domain";
import {
  callContextTool,
  callDeploymentTool,
  expect,
  makeContext,
  openSettings,
  test,
} from "./fixtures.ts";

// An Export (section 10.1, ADR 0018): the person makes one in the Deployment's settings and keeps
// a zip of Praxis's own JSON files, one for the Deployment and one per Context. A Backup is the
// same file, made by the system each day, and the settings say when the last one was.

/** The paths an archive holds, from its central directory, and each stored file's text. */
function readArchive(bytes: Buffer): Map<string, string> {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const local = bytes.readUInt32LE(at + 42);
    const path = bytes.toString("utf8", at + 46, at + 46 + nameLength);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    files.set(path, bytes.toString("utf8", start, start + size));
    at += 46 + nameLength;
  }
  return files;
}

test("the person makes an Export in settings and keeps a zip of the whole Deployment", async ({
  page,
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const work = await makeContext(page, { name: `Export ${tag}`, time_zone: "UTC", accent: "moss" });
  const words = `Kept in the Export ${tag}`;
  await callContextTool(page, work.id, "record_entry", { words });

  await page.goto("/");
  const section = (await openSettings(page, "Backups and Export")).getByRole("region", {
    name: "Export",
  });
  const downloaded = page.waitForEvent("download");
  await section.getByRole("button", { name: "Make an Export" }).click();
  const download = await downloaded;

  expect(download.suggestedFilename()).toMatch(/^praxis-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = readArchive(await readFile(await download.path()));
  const deployment = JSON.parse(files.get("deployment.json") ?? "null");
  expect(deployment).toMatchObject({ format: "praxis-export", format_version: 2 });
  expect(deployment.contexts).toContainEqual(
    expect.objectContaining({ id: work.id, name: work.name, file: `contexts/${work.id}.json` }),
  );
  const context = JSON.parse(files.get(`contexts/${work.id}.json`) ?? "null");
  expect(context.entries).toEqual([expect.objectContaining({ words })]);
});

test("an Export that cannot be made is said under its group, and its button is held while it is out", async ({
  page,
}) => {
  let answer: () => void = () => {};
  await page.route(/\/tools\/make_export$/, async (route) => {
    await new Promise<void>((resolve) => {
      answer = resolve;
    });
    await route.abort();
  });
  await page.goto("/");
  const section = (await openSettings(page, "Backups and Export")).getByRole("region", {
    name: "Export",
  });
  // "Make an Export", or "Making the Export…" while it is out.
  const make = section.getByRole("button", { name: /^Mak(e|ing)/ });
  await make.click();
  await expect(make).toBeDisabled();
  answer();

  await expect(section.getByRole("alert")).toHaveCount(1);
  await expect(make).toBeEnabled();
});

test("the Deployment's settings say when the last Backup was made", async ({ page }) => {
  // wrangler dev fires the daily trigger when asked (--test-scheduled, playwright.config.ts).
  expect((await page.request.get("/__scheduled?cron=0+3+*+*+*")).ok()).toBe(true);
  // Nothing waits on the trigger, so the journey waits for the Backup before settings read it.
  await expect
    .poll(async () => (await callDeploymentTool(page, "get_last_backup", {})).made_at)
    .not.toBeNull();

  await page.goto("/");
  const section = await openSettings(page, "Backups and Export");
  const backups = section.getByRole("region", { name: "Backups" });

  // The row is titled by a name, its day and time on its right, as this Device writes them.
  await expect(backups.getByText("Last Backup", { exact: true })).toBeVisible();
  const { made_at } = await callDeploymentTool(page, "get_last_backup", {});
  await expect(backups.getByTestId("last-backup")).toHaveText(
    await page.evaluate(
      (at) =>
        new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
          Date.parse(at),
        ),
      made_at as string,
    ),
  );
});

/**
 * The screen is told these are the standing Notices: the shared Deployment makes a Backup whenever
 * a journey asks, and failing them for real would reach every other journey's screen.
 */
async function noticesAre(page: Page, items: StandingNotice[]) {
  await page.route(/\/list_notices$/, async (route) => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ok: true, value: { items } } });
  });
}

/** The note a section opens with. */
const note = (section: Locator) => section.locator(".settings-note").first();

test("while no Backup has been made for three days, Backups and Export opens by offering an Export", async ({
  page,
}) => {
  const lastMade = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  await noticesAre(page, [{ kind: "no_backup", last_made: lastMade }]);
  await page.goto("/");
  const section = await openSettings(page, "Backups and Export");

  const day = await page.evaluate(
    (at) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(at),
    Date.parse(lastMade),
  );
  await expect(note(section)).toHaveText(`No Backup since ${day}. An Export keeps a copy now.`);
  // Make an Export is the section's one button, and so its one solid one.
  await expect(section.getByRole("button")).toHaveCount(1);
  await expect(section.getByRole("button", { name: "Make an Export" })).not.toHaveClass(/quiet/);
  // It is said in the section's own words: the Notice shows in Attention only.
  await expect(section.getByTestId("standing-notice")).toHaveCount(0);
});

test("while none has ever been made for three days, Backups and Export says none was", async ({
  page,
}) => {
  await noticesAre(page, [{ kind: "no_backup", last_made: null }]);
  await page.goto("/");
  const section = await openSettings(page, "Backups and Export");

  await expect(note(section)).toHaveText("No Backup yet. An Export keeps a copy now.");
});

test("with a Backup made in the last three days, Backups and Export opens on what it is for", async ({
  page,
}) => {
  await noticesAre(page, []);
  await page.goto("/");
  const section = await openSettings(page, "Backups and Export");

  await expect(note(section)).toHaveText(
    /^Praxis backs up the whole Deployment by itself each day\./,
  );
});

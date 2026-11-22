import { readFile } from "node:fs/promises";
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

test("the Deployment's settings say when the last Backup was made", async ({ page }) => {
  // wrangler dev fires the daily trigger when asked (--test-scheduled, playwright.config.ts).
  expect((await page.request.get("/__scheduled?cron=0+3+*+*+*")).ok()).toBe(true);
  // Nothing waits on the trigger, so the journey waits for the Backup before settings read it.
  await expect
    .poll(async () => (await callDeploymentTool(page, "get_last_backup", {})).made_at)
    .not.toBeNull();

  await page.goto("/");
  await openSettings(page, "Backups and Export");

  await expect(page.getByRole("region", { name: "Backups" }).getByTestId("last-backup")).toHaveText(
    /^The last Backup was made .+\.$/,
  );
});

import { exportZip } from "@praxis/domain";
import { beforeEach, describe, expect, test } from "vitest";
import { emptyBucket, holdKeeping, keptBackups, setBucketRefusing } from "./bucket.ts";
import { marked } from "./markers.ts";
import { atOnce, DAY, hand, newDeployment, value } from "./seam.ts";
import { mendSteps, wakeUnder } from "./upgrade-faults.ts";

// The daily Backup (sections 10.1, 10.3 and 10.5, ADR 0018): the Export's file, made by the system
// once a day into R2 on the person's account and deleted after 30 days, always on. The Worker's
// daily trigger asks the Deployment object for it, as `backUp` does here at the test's time.

type Deployment = ReturnType<typeof newDeployment>;

// The tests of a file share its bucket, so each starts with it empty.
beforeEach(emptyBucket);

async function makeContext(deployment: Deployment, name: string) {
  const made = await deployment.call(hand, "create_context", {
    name,
    time_zone: "UTC",
    accent: "blue",
  });
  return value(made).record.id;
}

/** The text of each file a stored zip holds, by its path, read from its central directory. */
function readArchive(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const end = bytes.length - 22;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.set(path, decoder.decode(bytes.subarray(start, start + size)));
    at += 46 + nameLength;
  }
  return files;
}

describe("the daily Backup", () => {
  test("is the Export's file, kept in the bucket under the day it was made, holding every Context, retired ones too", async () => {
    const deployment = newDeployment("2026-11-15T03:00:00.000Z");
    const work = await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");
    const words = marked("Call Ana about the roof: café, 屋根 🏠");
    atOnce(await deployment.context(home).call(hand, "record_entry", { words }));
    await deployment.call(hand, "retire_context", { id: home });

    await deployment.backUp();

    const exported = value(await deployment.call(hand, "make_export", {}));
    const kept = await keptBackups();
    expect([...kept.keys()]).toEqual(["praxis-export-2026-11-15.zip"]);
    const backup = kept.get("praxis-export-2026-11-15.zip") ?? new Uint8Array();
    expect(backup).toEqual(exportZip(exported));
    const files = readArchive(backup);
    expect([...files.keys()]).toEqual([
      "deployment.json",
      `contexts/${work}.json`,
      `contexts/${home}.json`,
    ]);
    expect(JSON.parse(files.get(`contexts/${home}.json`) ?? "null").entries).toEqual([
      expect.objectContaining({ words }),
    ]);
  });

  test("is deleted once it is 30 days old, by the Backup made that day", async () => {
    const deployment = newDeployment("2026-11-15T03:00:00.000Z");
    await makeContext(deployment, "Work");
    await deployment.backUp();
    deployment.advance(29 * DAY);
    await deployment.backUp();
    expect([...(await keptBackups()).keys()]).toEqual([
      "praxis-export-2026-11-15.zip",
      "praxis-export-2026-12-14.zip",
    ]);

    deployment.advance(DAY);
    await deployment.backUp();

    expect([...(await keptBackups()).keys()]).toEqual([
      "praxis-export-2026-12-14.zip",
      "praxis-export-2026-12-15.zip",
    ]);
  });

  test("none made for three days since the first Context was made is a standing Notice in every Context, tried or not, until one is made", async () => {
    const deployment = newDeployment("2026-11-15T03:00:00.000Z");
    const work = deployment.context(await makeContext(deployment, "Work"));
    deployment.advance(DAY);
    const home = deployment.context(await makeContext(deployment, "Home"));
    setBucketRefusing(true);
    expect(await deployment.backUp()).toBe("failed");
    // The daily trigger fires on no other day.
    deployment.advance(2 * DAY - 60_000);
    expect(value(await work.call(hand, "list_notices", {})).items).toEqual([]);

    deployment.advance(60_000);

    const notice = { kind: "no_backup", last_made: null };
    expect(value(await work.call(hand, "list_notices", {})).items).toEqual([notice]);
    expect(value(await home.call(hand, "list_notices", {})).items).toEqual([notice]);
    expect(value(await deployment.call(hand, "get_last_backup", {}))).toEqual({ made_at: null });

    setBucketRefusing(false);
    await deployment.backUp();

    expect(value(await work.call(hand, "list_notices", {})).items).toEqual([]);
  });

  test("none succeeding for three days since the last one made is a standing Notice saying when that was", async () => {
    const deployment = newDeployment("2026-11-15T03:00:00.000Z");
    const work = deployment.context(await makeContext(deployment, "Work"));
    await deployment.backUp();
    setBucketRefusing(true);
    deployment.advance(DAY);
    expect(await deployment.backUp()).toBe("failed");
    // A day the daily trigger did not fire at all counts as one that failed.
    deployment.advance(2 * DAY - 60_000);
    expect(value(await work.call(hand, "list_notices", {})).items).toEqual([]);

    deployment.advance(60_000);

    expect(value(await work.call(hand, "list_notices", {})).items).toEqual([
      { kind: "no_backup", last_made: "2026-11-15T03:00:00.000Z" },
    ]);
  });

  test("is deleted once it is 30 days old by the Backup tried that day, even one that fails", async () => {
    const deployment = newDeployment("2026-11-15T03:00:00.000Z");
    await makeContext(deployment, "Work");
    await deployment.backUp();
    setBucketRefusing(true);
    deployment.advance(30 * DAY);

    expect(await deployment.backUp()).toBe("failed");

    expect([...(await keptBackups()).keys()]).toEqual([]);
  });
});

describe("the daily Backup, while a Context is stuck on its upgrade", () => {
  test("carries on for the other Contexts, and keeps the last that holds it past its 30 days until it upgrades, as its Notice says", async () => {
    const deployment = newDeployment("2026-11-15T03:00:00.000Z");
    const work = await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");
    await deployment.backUp();
    await deployment.stickOnUpgrade(home);
    deployment.advance(DAY);

    expect(await deployment.backUp()).toBe("made");

    const kept = await keptBackups();
    const files = readArchive(kept.get("praxis-export-2026-11-16.zip") ?? new Uint8Array());
    expect([...files.keys()]).toEqual(["deployment.json", `contexts/${work}.json`]);
    expect(
      JSON.parse(files.get("deployment.json") ?? "null").contexts.map(
        ({ name }: { name: string }) => name,
      ),
    ).toEqual(["Work"]);
    const notice = {
      kind: "context_stuck",
      context: "Home",
      release: "unreleased",
      backup_kept: "2026-11-15T03:00:00.000Z",
    };
    expect(value(await deployment.context(work).call(hand, "list_notices", {})).items).toEqual([
      notice,
    ]);

    deployment.advance(30 * DAY);
    await deployment.backUp();
    expect([...(await keptBackups()).keys()]).toEqual([
      "praxis-export-2026-11-15.zip",
      "praxis-export-2026-12-16.zip",
    ]);

    // Upgraded under a release that mends it, the Backup holds it again, and the one kept for it
    // goes with the others its age.
    mendSteps(home);
    wakeUnder("release-that-mends-it");
    await deployment.wakeAgain(home);
    deployment.advance(DAY);
    await deployment.backUp();

    expect([...(await keptBackups()).keys()]).toEqual([
      "praxis-export-2026-12-16.zip",
      "praxis-export-2026-12-17.zip",
    ]);
    expect(value(await deployment.context(work).call(hand, "list_notices", {})).items).toEqual([]);
  });

  test("keeps the last Backup that held it, though an earlier one finished after it", async () => {
    const deployment = newDeployment("2026-11-15T03:00:00.000Z");
    const work = await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");
    const { reached, release } = holdKeeping();
    const earlier = deployment.backUp();
    await reached;
    deployment.advance(DAY);
    // The later one is kept while the earlier waits, which finishes after it.
    await deployment.backUp();
    release();
    await earlier;
    await deployment.stickOnUpgrade(home);
    deployment.advance(DAY);
    await deployment.backUp();

    expect(value(await deployment.context(work).call(hand, "list_notices", {})).items).toEqual([
      expect.objectContaining({ context: "Home", backup_kept: "2026-11-16T03:00:00.000Z" }),
    ]);
  });

  test("an Export the person makes is refused, since it is always the whole Deployment", async () => {
    const deployment = newDeployment("2026-11-15T03:00:00.000Z");
    await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");
    await deployment.stickOnUpgrade(home);

    expect(await deployment.call(hand, "make_export", {})).toMatchObject({
      ok: false,
      error: { code: "refused", in_the_way: [{ kind: "context", id: home, summary: "Home" }] },
    });
  });
});

describe("get_last_backup", () => {
  test("says when the last Backup was made, and that none has been before the first", async () => {
    const deployment = newDeployment("2026-11-15T03:00:00.000Z");
    await makeContext(deployment, "Work");
    expect(value(await deployment.call(hand, "get_last_backup", {}))).toEqual({ made_at: null });

    await deployment.backUp();
    deployment.advance(DAY);
    await deployment.backUp();
    deployment.advance(60_000);

    expect(value(await deployment.call(hand, "get_last_backup", {}))).toEqual({
      made_at: "2026-11-16T03:00:00.000Z",
    });
  });
});

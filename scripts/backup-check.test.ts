import { describe, expect, test } from "bun:test";
import wrangler from "../apps/worker/wrangler.jsonc";
import { deploysWithoutBackup, lastDueBackup, WITHOUT_BACKUP } from "./backup-check.ts";

describe("the deploy's check for a Backup from the last day", () => {
  test("looks for today's once the daily trigger has fired, yesterday's before", () => {
    expect(lastDueBackup(Date.parse("2026-11-20T03:00:00.000Z"))).toBe(
      "praxis-export-2026-11-20.zip",
    );
    expect(lastDueBackup(Date.parse("2026-11-20T02:59:59.999Z"))).toBe(
      "praxis-export-2026-11-19.zip",
    );
    expect(lastDueBackup(Date.parse("2026-03-01T01:00:00.000Z"))).toBe(
      "praxis-export-2026-02-28.zip",
    );
  });

  test("fires when wrangler.jsonc's daily trigger does", () => {
    expect(wrangler.triggers.crons).toEqual(["0 3 * * *"]);
  });

  test("goes on without one only when the commit's message has a line saying so", () => {
    expect(deploysWithoutBackup(`Fix the boiler\n\n${WITHOUT_BACKUP}\n`)).toBe(true);
    expect(deploysWithoutBackup("Fix the boiler\n\ndeploy-without-backup: YES")).toBe(true);
    expect(deploysWithoutBackup("Fix the boiler")).toBe(false);
    expect(deploysWithoutBackup(`Do not write ${WITHOUT_BACKUP} on a line of its own`)).toBe(false);
  });
});

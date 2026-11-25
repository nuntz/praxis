import { describe, expect, test } from "bun:test";
import wrangler from "../apps/worker/wrangler.jsonc";
import {
  BACKUP_BUCKET,
  backupListing,
  deploysWithoutBackup,
  holdsBackup,
  lastDueBackup,
  WITHOUT_BACKUP,
} from "./backup-check.ts";

/** The Backup due on 2026-11-22. */
const DUE = "praxis-export-2026-11-22.zip";

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

  test("finds the Backup when the bucket lists an object of exactly its name", () => {
    const listing = { success: true, result: [{ key: DUE, size: 1 }] };
    expect(holdsBackup(DUE, 200, JSON.stringify(listing))).toBe(true);
  });

  test("does not take an object whose name only starts with the Backup's for it", () => {
    const listing = {
      success: true,
      result: [{ key: `${DUE}.old`, size: 1 }],
    };
    expect(holdsBackup(DUE, 200, JSON.stringify(listing))).toBe(false);
  });

  test("finds no Backup when the bucket lists nothing under its name", () => {
    const listing = { success: true, result: [] };
    expect(holdsBackup(DUE, 200, JSON.stringify(listing))).toBe(false);
  });

  test("finds no Backup when there is no bucket yet, as before the first `pulumi up` made it", () => {
    const noBucket = {
      success: false,
      errors: [{ code: 10006, message: "The specified bucket does not exist." }],
    };
    expect(holdsBackup(DUE, 404, JSON.stringify(noBucket))).toBe(false);
    const elsewhere = { success: false, errors: [{ code: 7003, message: "Could not route" }] };
    expect(() => holdsBackup(DUE, 404, JSON.stringify(elsewhere))).toThrow("HTTP 404");
  });

  test("fails, naming the status, when the API does not answer with a listing", () => {
    const refused = { success: false, errors: [{ code: 10000, message: "Authentication error" }] };
    expect(() => holdsBackup(DUE, 200, JSON.stringify(refused))).toThrow(
      "HTTP 200: Authentication error",
    );
    expect(() => holdsBackup(DUE, 403, JSON.stringify(refused))).toThrow(
      "HTTP 403: Authentication error",
    );
    expect(() => holdsBackup(DUE, 502, "<html>Bad gateway</html>")).toThrow("HTTP 502");
  });

  test("lists the bucket under the Backup's name, in the Deployment's jurisdiction if it has one", () => {
    const inEu = backupListing(DUE, { account: "acc123", jurisdiction: "eu", token: "tok" });
    expect(inEu.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/acc123/r2/buckets/praxis-backups/objects?prefix=${DUE}`,
    );
    expect(BACKUP_BUCKET).toBe("praxis-backups");
    expect(inEu.headers).toEqual({ Authorization: "Bearer tok", "cf-r2-jurisdiction": "eu" });
    const anywhere = backupListing(DUE, { account: "acc123", jurisdiction: "", token: "tok" });
    expect(anywhere.url).toBe(inEu.url);
    expect(anywhere.headers).toEqual({ Authorization: "Bearer tok" });
  });
});

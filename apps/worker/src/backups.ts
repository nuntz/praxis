import { exportZip, exportZipName, success } from "@praxis/domain";
import { startTimer } from "./arrival.ts";
import { countBackupsFrom, lastBackup, noteBackupMade } from "./backup-rows.ts";
import { type DeploymentHandlers, exportOf } from "./deployment-tools.ts";
import { keptBackups, noteBackedUp, noteUpgrade } from "./upgrade-rows.ts";

/** The Deployment tools about the daily Backup. */
export type BackupToolName = "get_last_backup";

export const backupHandlers: Pick<DeploymentHandlers, BackupToolName> = {
  async get_last_backup({ sql }) {
    return success(lastBackup(sql));
  },
};

/** What a daily Backup came to: made and kept, or failed, which the Notice tells in time. */
export type BackupOutcome = "made" | "failed";

/** How long a Backup is kept (section 10.5). */
const KEPT_FOR = 30 * 24 * 60 * 60 * 1000;

/**
 * Make the daily Backup as at `at` (section 10.1, ADR 0018): the Export's file, the same zip the
 * person downloads, kept in the Deployment's bucket under the day it was made. A Context whose
 * object is stuck on its upgrade writes no file: the Backup carries on for the others, and the
 * last that holds it is kept until it upgrades (section 11). Then every other Backup made 30 days
 * or more before it is deleted, whether this one was made or not, so nothing removed for good
 * outlives its 30 days in a Backup (ADR 0018). A failure is logged and answered, never thrown,
 * since nothing waits on the daily trigger: the standing Notice is how the person learns.
 */
export async function backUp(sql: SqlStorage, env: Env, at: number): Promise<BackupOutcome> {
  const elapsed = startTimer();
  countBackupsFrom(sql, at);
  let outcome: BackupOutcome = "made";
  try {
    const { made, stuck, filed } = await exportOf(sql, env, at);
    // Waking each object is how a Context stuck on its upgrade, or no longer, is found out when it
    // could not say so itself. Noted as each answered, whatever was noted meanwhile: an object
    // stays stuck or not for as long as it lives under one release, so what it said then holds.
    for (const { id, stuck: why } of stuck) noteUpgrade(sql, id, why);
    for (const id of filed) noteUpgrade(sql, id, null);
    await env.BACKUPS.put(exportZipName(made), exportZip(made), {
      httpMetadata: { contentType: "application/zip" },
      customMetadata: { made_at: made.made_at },
    });
    noteBackupMade(sql, at);
    noteBackedUp(sql, filed, at);
  } catch (error) {
    outcome = "failed";
    logFailure("making", error);
  }
  try {
    await deleteAgedOut(env.BACKUPS, at, keptBackups(sql));
  } catch (error) {
    logFailure("deleting", error);
  }
  console.log(JSON.stringify({ backup: outcome, ms: elapsed() }));
  return outcome;
}

/** A line for the platform's logs. The platform's errors carry no words, and Praxis's none either. */
function logFailure(step: "making" | "deleting", error: unknown): void {
  const why = error instanceof Error ? error.message : "unknown";
  console.error(JSON.stringify({ backup: "failed", step, error: why }));
}

/**
 * Delete each Backup made 30 days or more before `at`, by the instant it carries, but those kept
 * by the instant they were made: the last holding each Context stuck on its upgrade (section
 * 10.5). Anything else in the bucket is not Praxis's and is left.
 */
async function deleteAgedOut(bucket: R2Bucket, at: number, kept: Set<string>): Promise<void> {
  const aged: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ include: ["customMetadata"], ...(cursor ? { cursor } : {}) });
    for (const object of page.objects) {
      const madeAtIso = object.customMetadata?.made_at ?? "";
      if (kept.has(madeAtIso)) continue;
      if (at - Date.parse(madeAtIso) >= KEPT_FOR) aged.push(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (aged.length > 0) await bucket.delete(aged);
}

// The deploy's check that a Backup from the last day exists (SPEC section 11, ADR 0019): a deploy is
// a one-way door once any object wakes under it, so the deploy stops with a warning when the Backup
// the daily trigger was last due to make is not in the bucket. The person goes on without it by
// pushing a commit whose message has the line `Deploy-Without-Backup: yes`. The deploy job
// (.github/workflows/ci.yml) asks:
//
//   bun scripts/backup-check.ts due          the name of the Backup due last, as at now
//   bun scripts/backup-check.ts overridden   whether the message on stdin says to go on without it
//
// and looks for that Backup in the bucket itself, with wrangler.

/** The line in a commit's message that deploys it without a Backup from the last day. */
export const WITHOUT_BACKUP = "Deploy-Without-Backup: yes";

/** When the daily trigger fires, in UTC hours (apps/worker/wrangler.jsonc, section 10.3). */
const DUE_AT_HOUR = 3;

/**
 * The name of the Backup the daily trigger was last due to make, as at `now`: today's once 03:00
 * UTC has come, yesterday's before. A Backup is named after the day it was due (section 10.3).
 */
export function lastDueBackup(now: number): string {
  const due = new Date(now);
  if (due.getUTCHours() < DUE_AT_HOUR) due.setUTCDate(due.getUTCDate() - 1);
  return `praxis-export-${due.toISOString().slice(0, 10)}.zip`;
}

/** Whether a commit's message says to deploy it without a Backup from the last day. */
export function deploysWithoutBackup(message: string): boolean {
  return message
    .split("\n")
    .some((line) => line.trim().toLowerCase() === WITHOUT_BACKUP.toLowerCase());
}

if (import.meta.main) {
  const [asked] = process.argv.slice(2);
  if (asked === "due") {
    console.log(lastDueBackup(Date.now()));
  } else if (asked === "overridden") {
    process.exit(deploysWithoutBackup(await Bun.stdin.text()) ? 0 : 1);
  } else {
    console.error("Ask `due` or `overridden`.");
    process.exit(2);
  }
}

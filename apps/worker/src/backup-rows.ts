import { instantToIso, type LastBackup, type StandingNotice } from "@praxis/domain";

/** How long without a Backup made before it is a standing Notice (section 10.3). */
const OVERDUE_AFTER = 3 * 24 * 60 * 60 * 1000;

type BackupRow = { counted_from: number; last_made: number | null };

function backupRow(sql: SqlStorage): BackupRow | null {
  return sql.exec<BackupRow>(`SELECT counted_from, last_made FROM backups`).toArray()[0] ?? null;
}

/**
 * Start counting the three days of section 10.3 at `at`, unless they are counted already: when the
 * first Context is made, so a Deployment whose daily trigger never fires is told, and when a
 * Backup is first tried, for one whose Contexts were made before there were Backups.
 */
export function countBackupsFrom(sql: SqlStorage, at: number): void {
  sql.exec(`INSERT OR IGNORE INTO backups (one, counted_from, last_made) VALUES (1, ?, NULL)`, at);
}

/** Note a Backup made at `at`. Another may have finished meanwhile: one made later stays the last. */
export function noteBackupMade(sql: SqlStorage, at: number): void {
  sql.exec(`UPDATE backups SET last_made = ? WHERE last_made IS NULL OR last_made < ?`, at, at);
}

/** When the last Backup was made, as `get_last_backup` answers. */
export function lastBackup(sql: SqlStorage): LastBackup {
  const made = backupRow(sql)?.last_made ?? null;
  return { made_at: made === null ? null : instantToIso(made) };
}

/**
 * The standing Notice of section 10.3 as at `at`: no Backup made for three days, counted from the
 * last one made or, before any, from the first Context made. A day the daily trigger did not fire
 * counts as one that failed. None while the Deployment has never held a Context.
 */
export function backupNotice(sql: SqlStorage, at: number): StandingNotice | null {
  const row = backupRow(sql);
  if (row === null || at - (row.last_made ?? row.counted_from) < OVERDUE_AFTER) return null;
  return {
    kind: "no_backup",
    last_made: row.last_made === null ? null : instantToIso(row.last_made),
  };
}

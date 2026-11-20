import { instantToIso, type StandingNotice } from "@praxis/domain";
import { backupNotice } from "./backup-rows.ts";
import { readSpend } from "./spend-rows.ts";
import { stuckNotices } from "./upgrade-rows.ts";

/**
 * What a Run found of the key, reported by its Context: the model's provider refused it, or took
 * it, in a Run started at `at`.
 */
export type KeyReport = { key: "refused" | "taken"; at: number };

/**
 * Note what a Run found of the key. A refusal stands from the first one until a call succeeds, in
 * whichever Context (section 5.6). Reports from several Contexts may arrive out of order, so a
 * Run that took the key ends only a refusal from no later than it started: one refused since
 * stands until a later Run takes it.
 */
export function takeKeyReport(sql: SqlStorage, report: KeyReport): void {
  if (report.key === "refused") {
    sql.exec(`INSERT OR IGNORE INTO key_refused (one, since) VALUES (1, ?)`, report.at);
  } else {
    sql.exec(`DELETE FROM key_refused WHERE since <= ?`, report.at);
  }
}

/**
 * The Deployment's standing Notices as at `at` (section 8.3): the key refused, the month's spend
 * nearing or reaching the cap, no Backup made for three days, and each Context stuck on its
 * upgrade. Each stays until its cause is gone.
 */
export function standingNotices(sql: SqlStorage, at: number): StandingNotice[] {
  const notices: StandingNotice[] = [];
  const refused = sql.exec<{ since: number }>(`SELECT since FROM key_refused`).toArray()[0];
  if (refused) notices.push({ kind: "key_refused", since: instantToIso(refused.since) });
  const spend = readSpend(sql, at);
  if (spend.notice) notices.push({ kind: spend.notice, spent: spend.spent, cap: spend.cap });
  const backup = backupNotice(sql, at);
  if (backup) notices.push(backup);
  notices.push(...stuckNotices(sql));
  return notices;
}

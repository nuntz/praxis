import { instantToIso, type StandingNotice } from "@praxis/domain";
import { backupNotice } from "./backup-rows.ts";
import { readSpend } from "./spend-rows.ts";
import { stuckNotices } from "./upgrade-rows.ts";

/**
 * What a Run found of the model's key, or a Call of the voice key, reported by its Context: the
 * provider refused it, or took it, in a Run started or a Call set up at `at`.
 */
export type KeyReport = { key: "refused" | "taken"; at: number; provider: "model" | "voice" };

/** Where each provider's refusal of its key is kept. */
const REFUSED_IN = { model: "key_refused", voice: "voice_key_refused" } as const;

/**
 * Note what a Run or a Call found of its provider's key. A refusal stands from the first one until
 * a call succeeds, in whichever Context (sections 5.6 and 6). Reports from several Contexts may
 * arrive out of order, so one that took the key ends only a refusal from no later than it: one
 * refused since stands until a later one takes it.
 */
export function takeKeyReport(sql: SqlStorage, report: KeyReport): void {
  const table = REFUSED_IN[report.provider];
  if (report.key === "refused") {
    sql.exec(`INSERT OR IGNORE INTO ${table} (one, since) VALUES (1, ?)`, report.at);
  } else {
    sql.exec(`DELETE FROM ${table} WHERE since <= ?`, report.at);
  }
}

/**
 * The Deployment's standing Notices as at `at` (section 8.3): either key refused, the month's spend
 * nearing or reaching the cap, no Backup made for three days, and each Context stuck on its
 * upgrade. Each stays until its cause is gone.
 */
export function standingNotices(sql: SqlStorage, at: number): StandingNotice[] {
  const notices: StandingNotice[] = [];
  for (const [kind, table] of [
    ["key_refused", REFUSED_IN.model],
    ["voice_key_refused", REFUSED_IN.voice],
  ] as const) {
    const refused = sql.exec<{ since: number }>(`SELECT since FROM ${table}`).toArray()[0];
    if (refused) notices.push({ kind, since: instantToIso(refused.since) });
  }
  const spend = readSpend(sql, at);
  if (spend.notice) notices.push({ kind: spend.notice, spent: spend.spent, cap: spend.cap });
  const backup = backupNotice(sql, at);
  if (backup) notices.push(backup);
  notices.push(...stuckNotices(sql));
  return notices;
}

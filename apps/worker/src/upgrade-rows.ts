import { instantToIso, type StandingNotice } from "@praxis/domain";
import type { StuckUpgrade } from "./ladder.ts";

/**
 * Note what a Context's object said of its upgrade, or what the daily Backup found: it is stuck
 * under a release, or it is not (section 11). Only a Context on the list is noted.
 */
export function noteUpgrade(sql: SqlStorage, context: string, stuck: StuckUpgrade | null): void {
  if (stuck === null) {
    sql.exec(`DELETE FROM stuck_contexts WHERE context_id = ?`, context);
    return;
  }
  sql.exec(
    `INSERT INTO stuck_contexts (context_id, release)
       SELECT id, ? FROM contexts WHERE id = ?
     ON CONFLICT (context_id) DO UPDATE SET release = excluded.release`,
    stuck.release,
    context,
  );
}

/**
 * The standing Notice naming each Context stuck on its upgrade, in the order made, with the
 * release it is stuck under and when the Backup kept for it was made (section 11).
 */
export function stuckNotices(sql: SqlStorage): StandingNotice[] {
  return sql
    .exec<{ name: string; release: string; backed_up: number | null }>(
      `SELECT c.name, s.release, c.backed_up FROM stuck_contexts s
       JOIN contexts c ON c.id = s.context_id ORDER BY c.seq`,
    )
    .toArray()
    .map(({ name, release, backed_up }) => ({
      kind: "context_stuck",
      context: name,
      release,
      backup_kept: backed_up === null ? null : instantToIso(backed_up),
    }));
}

/**
 * When each Backup kept past its 30 days was made, as the instant it carries: the last that holds
 * each Context stuck on its upgrade, until that Context upgrades (section 10.5).
 */
export function keptBackups(sql: SqlStorage): Set<string> {
  return new Set(
    sql
      .exec<{ backed_up: number }>(
        `SELECT c.backed_up FROM stuck_contexts s JOIN contexts c ON c.id = s.context_id
         WHERE c.backed_up IS NOT NULL`,
      )
      .toArray()
      .map(({ backed_up }) => instantToIso(backed_up)),
  );
}

/**
 * Note that the Backup made at `at` holds these Contexts' files. Another may have finished
 * meanwhile: one made later stays the last.
 */
export function noteBackedUp(sql: SqlStorage, contexts: string[], at: number): void {
  sql.exec(
    `UPDATE contexts SET backed_up = ?
     WHERE id IN (SELECT value FROM json_each(?)) AND (backed_up IS NULL OR backed_up < ?)`,
    at,
    JSON.stringify(contexts),
    at,
  );
}

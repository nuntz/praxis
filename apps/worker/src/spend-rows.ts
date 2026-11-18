import { DEFAULT_SPEND_CAP, monthOf, type Spend, spendNotice } from "@praxis/domain";

/**
 * The spend the Deployment object keeps (section 5.7): the cap, and what each Context has spent in
 * each calendar month. It holds no words and nothing from any Journal.
 */

/**
 * The monthly cap, in US dollars. The setup wizard (#41) asks for it and offers 20; until a
 * Deployment's has, it has that cap, since there is always one.
 */
export function readCap(sql: SqlStorage): number {
  const row = sql.exec<{ dollars: number }>(`SELECT dollars FROM spend_cap`).toArray()[0];
  return row?.dollars ?? DEFAULT_SPEND_CAP;
}

export function writeCap(sql: SqlStorage, dollars: number): void {
  sql.exec(
    `INSERT INTO spend_cap (one, dollars) VALUES (1, ?)
     ON CONFLICT (one) DO UPDATE SET dollars = excluded.dollars`,
    dollars,
  );
}

/** What a Context reports it has spent in a calendar month (YYYY-MM, UTC), in all, in US dollars. */
export type SpendReport = { context: string; month: string; spent: number };

/**
 * Take a Context's report of what it has spent in a month, in all. A report is the Context's whole
 * total for the month, never an amount to add, so one sent twice or overtaken by a later one
 * counts once, and the month's count never goes down.
 */
export function takeSpendReport(sql: SqlStorage, report: SpendReport): void {
  sql.exec(
    `INSERT INTO spend (month, context_id, dollars) VALUES (?, ?, ?)
     ON CONFLICT (month, context_id) DO UPDATE SET dollars = max(dollars, excluded.dollars)`,
    report.month,
    report.context,
    report.spent,
  );
}

/** What the Deployment has spent in the calendar month `at` falls in, against its cap. */
export function readSpend(sql: SqlStorage, at: number): Spend {
  const month = monthOf(at);
  const spent =
    sql
      .exec<{ dollars: number | null }>(
        `SELECT sum(dollars) AS dollars FROM spend WHERE month = ?`,
        month,
      )
      .one().dollars ?? 0;
  const cap = readCap(sql);
  return { month, spent, cap, notice: spendNotice(spent, cap) };
}

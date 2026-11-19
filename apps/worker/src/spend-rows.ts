import {
  DEFAULT_SPEND_CAP,
  type MonthSpend,
  monthOf,
  type Spend,
  spendNotice,
} from "@praxis/domain";

/**
 * The spend the Deployment object keeps (section 5.7): the cap, and what each Context has spent in
 * each calendar month. It holds no words and nothing from any Journal.
 */

/**
 * The monthly cap, in US dollars. A Deployment starts with 20, which the setup wizard tells the
 * person and where to change it, and keeps it until the person sets one, since there is always one.
 */
export function readCap(sql: SqlStorage): number {
  return capChosen(sql) ?? DEFAULT_SPEND_CAP;
}

/** The cap the person set, or null while they have set none. */
export function capChosen(sql: SqlStorage): number | null {
  return (
    sql.exec<{ dollars: number }>(`SELECT dollars FROM spend_cap`).toArray()[0]?.dollars ?? null
  );
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

/**
 * What Contexts no longer listed spent in each calendar month, in all, with no name attached, for
 * an Export (section 10.1). A listed Context's spend is not here: its Run records hold it.
 */
export function deletedContextsSpend(sql: SqlStorage): MonthSpend[] {
  return sql
    .exec<MonthSpend>(
      `SELECT month, sum(dollars) AS dollars FROM spend
       WHERE context_id NOT IN (SELECT id FROM contexts)
       GROUP BY month ORDER BY month`,
    )
    .toArray();
}

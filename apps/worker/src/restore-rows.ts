import type { ContextFile } from "@praxis/domain";
import { startSchedule } from "./clock-rows.ts";
import { putIn } from "./move-rows.ts";
import { expireTrash, sendToTrash } from "./trash-rows.ts";

/**
 * Put a Context's file of an Export into this object's tables, as the restore does at `at`
 * (section 10.2): its settings under the object's own id, the name the Deployment lists it by,
 * every record under its id with its Versions, links, events, Recurrence and Author, its Standing
 * marks, the Trash with each item's clock counting from the original delete, and its Run records.
 * Each unit the file holds as moving stays here, among the rest, since no other Context took it.
 * Then what has been in the Trash 30 days by `at` is removed for good, as the alarm would have.
 *
 * Nothing goes in the change log, which the file does not hold: the Context starts as one made.
 * A Run the file holds as going cannot go on without its Conversation, and comes back failed.
 * Throws when the file does not hold together, as a record linking to none there.
 */
/**
 * What a Context restored is made as, beside its file: the name the Deployment lists it by, the
 * Deployment object it keeps, and when the restore was asked for.
 */
export type Restoring = { name: string; deployment: string; at: number };

export function putBack(sql: SqlStorage, id: string, as: Restoring, file: ContextFile): void {
  const { context } = file;
  sql.exec(
    `INSERT INTO context_settings
       (id, name, time_zone, deployment, brief_time, review_day, review_time, notifications)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    as.name,
    context.time_zone,
    as.deployment,
    context.brief_time,
    context.review_day,
    context.review_time,
    context.notifications ? 1 : 0,
  );
  // A delegation names its Person, so the Persons go in first.
  for (const person of file.persons) {
    sql.exec(
      `INSERT INTO persons (id, name, at) VALUES (?, ?, ?)`,
      person.id,
      person.name,
      Date.parse(person.at),
    );
  }
  putIn(sql, null, file);
  for (const unit of file.moving) putIn(sql, null, unit);
  for (const entry of file.entries) {
    if (entry.standing) sql.exec(`INSERT INTO standing_marks (entry) VALUES (?)`, entry.id);
  }
  for (const item of file.trash) {
    const id = sendToTrash(sql, item.deleted, item.went_with, Date.parse(item.at));
    for (const link of item.dormant_links) {
      sql.exec(
        `INSERT INTO dormant_links (item, task, what, to_kind, to_id) VALUES (?, ?, ?, ?, ?)`,
        id,
        link.task,
        link.what,
        link.to.kind,
        link.to.id,
      );
    }
  }
  const astray = sql
    .exec<{ kind: string; record_id: string }>(
      `SELECT kind, record_id FROM trashed WHERE record_id NOT IN (
         SELECT id FROM entries UNION ALL SELECT id FROM tasks
         UNION ALL SELECT id FROM projects UNION ALL SELECT id FROM persons)`,
    )
    .toArray()[0];
  if (astray)
    throw new Error(
      `The Trash holds the ${astray.kind} ${astray.record_id}, which the file does not`,
    );
  for (const run of file.runs) {
    sql.exec(
      `INSERT INTO runs
         (id, started_by, at, model, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, cost, ended, failure)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      run.id,
      run.started_by,
      Date.parse(run.at),
      run.model,
      run.tokens.input,
      run.tokens.output,
      run.tokens.cache_read,
      run.tokens.cache_write,
      run.cost,
      run.ended ?? "failed",
      run.failure,
    );
  }
  expireTrash(sql, as.at);
  // Its first Brief and Review are the first to come after it came back.
  startSchedule(sql, as.at);
}

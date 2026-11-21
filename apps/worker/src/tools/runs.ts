import { failure, success } from "@praxis/domain";
import type { Handlers } from "../registry.ts";
import { runById, runRecord, runRecordsPage } from "../run-rows.ts";

/**
 * The Run records (section 5.8), read by the person's hand alone: what the Agent did, without any
 * agent log and without its words.
 */
export const runTools: Pick<Handlers, "list_runs" | "get_run"> = {
  list_runs({ input, sql }) {
    return runRecordsPage(sql, input.cursor);
  },

  get_run({ input, sql }) {
    const row = runById(sql, input.id);
    if (row === null) return failure("not_found", "There is no such Run in this Context.");
    return success(runRecord(sql, row));
  },
};

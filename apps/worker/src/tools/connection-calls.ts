import { connectionCallsPage } from "../connection-call-rows.ts";
import type { Handlers } from "../registry.ts";

/**
 * The record of a Connection's calls (section 7.3), read by the person's hand alone: what an
 * outside agent read and wrote here, without any of what it sent or was given.
 */
export const connectionCallTools: Pick<Handlers, "list_connection_calls"> = {
  list_connection_calls({ input, sql }) {
    return connectionCallsPage(sql, input.cursor, {
      ...(input.connection_id === undefined ? {} : { connection: input.connection_id }),
      ...(input.reads_only === undefined ? {} : { readsOnly: input.reads_only }),
    });
  },
};

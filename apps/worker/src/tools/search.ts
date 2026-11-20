import type { Handlers } from "../registry.ts";
import { search } from "../search-rows.ts";
import { timeZoneOf } from "../settings.ts";

export const searchTools: Pick<Handlers, "search"> = {
  search({ input, sql }) {
    // One ranked list, the same for every caller: nothing here asks who calls (ADR 0023).
    return search(sql, input, timeZoneOf(sql));
  },
};

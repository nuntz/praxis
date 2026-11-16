import { success, written } from "@praxis/domain";
import type { Handlers } from "../registry.ts";
import { contextEffect, readSettings, setTimeZone, timeZoneOf } from "../settings.ts";

export const settingsTools: Pick<Handlers, "get_settings" | "set_time_zone"> = {
  get_settings({ arrivedAt, sql }) {
    return success(readSettings(sql, arrivedAt));
  },

  set_time_zone({ input, arrivedAt, sql }) {
    // The schema gives the zone as the runtime names it, so one zone written two ways is one.
    if (input.time_zone === timeZoneOf(sql)) {
      return success(written(readSettings(sql, arrivedAt), []));
    }
    // A Due Date and a Defer Date are days, so nothing else moves: only today shifts.
    setTimeZone(sql, input.time_zone);
    return success(written(readSettings(sql, arrivedAt), [contextEffect(sql)]));
  },
};

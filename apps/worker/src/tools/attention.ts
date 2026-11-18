import { attention, success } from "@praxis/domain";
import { openProjects } from "../project-rows.ts";
import type { Handlers } from "../registry.ts";
import { timeZoneOf } from "../settings.ts";
import { openTasks } from "../task-rows.ts";

export const attentionTools: Pick<Handlers, "view_attention"> = {
  view_attention({ today, sql }) {
    // Derived from the Journal by rule, the same for every caller: nothing here asks who calls.
    return success(
      attention(openTasks(sql, today), openProjects(sql, today), today, timeZoneOf(sql)),
    );
  },
};

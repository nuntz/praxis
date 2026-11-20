import { failure, success } from "@praxis/domain";
import { moveUnit } from "../move-rows.ts";
import type { Handlers } from "../registry.ts";
import { NO_SUCH_ENTRY } from "./entries.ts";
import { NO_SUCH_PROJECT } from "./projects.ts";

/**
 * What moving a record to another Context would take, for the person to see before confirming
 * (section 3.9). The move itself is a Deployment tool, `move_record`, since it reaches two Contexts.
 */
export const moveTools: Pick<Handlers, "get_move_unit"> = {
  get_move_unit({ input, sql }) {
    const unit = moveUnit(sql, input);
    if (unit === null) {
      return failure("not_found", input.kind === "entry" ? NO_SUCH_ENTRY : NO_SUCH_PROJECT);
    }
    return success(unit);
  },
};

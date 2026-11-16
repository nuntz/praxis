/**
 * The offering table of section 4.10 (ADR 0015), kept by hand and never derived from the
 * registry, so a change in who is offered what always shows as a diff to this file. One row per
 * tool in the registry, one column per caller, in the order of `everyCaller`. It grows a row with each tool and must equal the
 * spec's table for the tools it has.
 */
export type Offer = "yes" | "no";

// biome-ignore format: read as a table
export const offering: Record<string, [Offer, Offer, Offer, Offer, Offer]> = {
  //               hand   agent  clock  connection  read-only connection
  record_entry: [  "yes", "yes", "no",  "yes",      "no"  ],
  get_entry: [     "yes", "yes", "yes", "yes",      "yes" ],
  list_entries: [  "yes", "yes", "yes", "yes",      "yes" ],
  add_link: [      "yes", "yes", "no",  "yes",      "no"  ],
  remove_link: [   "yes", "yes", "no",  "yes",      "no"  ],
  add_task: [      "yes", "yes", "no",  "yes",      "no"  ],
  finish_task: [   "yes", "yes", "no",  "yes",      "no"  ],
  drop_task: [     "yes", "yes", "no",  "yes",      "no"  ],
  reopen_task: [   "yes", "yes", "no",  "yes",      "no"  ],
  rename_task: [   "yes", "yes", "no",  "yes",      "no"  ],
  set_task_dates: ["yes", "yes", "no",  "yes",      "no"  ],
  delegate_task: [ "yes", "yes", "no",  "yes",      "no"  ],
  take_back_task: ["yes", "yes", "no",  "yes",      "no"  ],
  wait_on: [       "yes", "yes", "no",  "yes",      "no"  ],
  stop_waiting: [  "yes", "yes", "no",  "yes",      "no"  ],
  get_task: [      "yes", "yes", "yes", "yes",      "yes" ],
  list_tasks: [    "yes", "yes", "yes", "yes",      "yes" ],
  move_task: [     "yes", "yes", "no",  "yes",      "no"  ],
  make_project_from_task: [
                   "yes", "yes", "no",  "yes",      "no"  ],
  create_project: ["yes", "yes", "no",  "yes",      "no"  ],
  rename_project: ["yes", "yes", "no",  "yes",      "no"  ],
  set_project_due_date: [
                   "yes", "yes", "no",  "yes",      "no"  ],
  finish_project: ["yes", "yes", "no",  "yes",      "no"  ],
  drop_project: [  "yes", "yes", "no",  "yes",      "no"  ],
  reopen_project: ["yes", "yes", "no",  "yes",      "no"  ],
  get_project: [   "yes", "yes", "yes", "yes",      "yes" ],
  list_projects: [ "yes", "yes", "yes", "yes",      "yes" ],
  create_person: [ "yes", "yes", "no",  "yes",      "no"  ],
  rename_person: [ "yes", "yes", "no",  "yes",      "no"  ],
  get_person: [    "yes", "yes", "yes", "yes",      "yes" ],
  list_persons: [  "yes", "yes", "yes", "yes",      "yes" ],
  get_settings: [  "yes", "yes", "yes", "yes",      "yes" ],
  set_time_zone: [ "yes", "no",  "no",  "no",       "no"  ],
  list_changes: [  "yes", "yes", "yes", "yes",      "yes" ],
};

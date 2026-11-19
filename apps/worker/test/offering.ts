import { marked } from "./markers.ts";

/**
 * The offering table of section 4.10 (ADR 0015), kept by hand and never derived from the
 * registry, so a change in who is offered what always shows as a diff to this file. One row per
 * tool in the registry, one column per caller, in the order of `everyCaller`. It grows a row with each tool and must equal the
 * spec's table for the tools it has. A write the spec marks held is offered: holding is a rule
 * of the tool on the person's words (section 4.7), not whether the caller may call it.
 */
export type Offer = "yes" | "no";

// biome-ignore format: read as a table
export const offering: Record<string, [Offer, Offer, Offer, Offer, Offer]> = {
  //               hand   agent  clock  connection  read-only connection
  record_entry: [  "yes", "yes", "no",  "yes",      "no"  ],
  get_entry: [     "yes", "yes", "yes", "yes",      "yes" ],
  list_entries: [  "yes", "yes", "yes", "yes",      "yes" ],
  edit_entry: [    "yes", "yes", "no",  "yes",      "no"  ],
  restore_entry_version: [
                   "yes", "yes", "no",  "yes",      "no"  ],
  delete_entry: [  "yes", "yes", "no",  "yes",      "no"  ],
  list_entry_versions: [
                   "yes", "yes", "yes", "yes",      "yes" ],
  add_link: [      "yes", "yes", "no",  "yes",      "no"  ],
  remove_link: [   "yes", "yes", "no",  "yes",      "no"  ],
  mark_standing: [ "yes", "yes", "no",  "no",       "no"  ],
  unmark_standing: [
                   "yes", "yes", "no",  "no",       "no"  ],
  add_task: [      "yes", "yes", "no",  "yes",      "no"  ],
  finish_task: [   "yes", "yes", "no",  "yes",      "no"  ],
  drop_task: [     "yes", "yes", "no",  "yes",      "no"  ],
  reopen_task: [   "yes", "yes", "no",  "yes",      "no"  ],
  rename_task: [   "yes", "yes", "no",  "yes",      "no"  ],
  set_task_dates: ["yes", "yes", "no",  "yes",      "no"  ],
  set_recurrence: ["yes", "yes", "no",  "yes",      "no"  ],
  remove_recurrence: [
                   "yes", "yes", "no",  "yes",      "no"  ],
  delegate_task: [ "yes", "yes", "no",  "yes",      "no"  ],
  take_back_task: ["yes", "yes", "no",  "yes",      "no"  ],
  wait_on: [       "yes", "yes", "no",  "yes",      "no"  ],
  stop_waiting: [  "yes", "yes", "no",  "yes",      "no"  ],
  delete_task: [   "yes", "yes", "no",  "yes",      "no"  ],
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
  delete_project: ["yes", "yes", "no",  "yes",      "no"  ],
  get_project: [   "yes", "yes", "yes", "yes",      "yes" ],
  list_projects: [ "yes", "yes", "yes", "yes",      "yes" ],
  create_person: [ "yes", "yes", "no",  "yes",      "no"  ],
  rename_person: [ "yes", "yes", "no",  "yes",      "no"  ],
  delete_person: [ "yes", "yes", "no",  "yes",      "no"  ],
  get_person: [    "yes", "yes", "yes", "yes",      "yes" ],
  list_persons: [  "yes", "yes", "yes", "yes",      "yes" ],
  get_settings: [  "yes", "yes", "yes", "yes",      "yes" ],
  set_time_zone: [ "yes", "no",  "no",  "no",       "no"  ],
  set_brief_time: ["yes", "yes", "no",  "no",       "no"  ],
  set_review_time: [
                   "yes", "yes", "no",  "no",       "no"  ],
  set_notifications: [
                   "yes", "no",  "no",  "no",       "no"  ],
  view_attention: ["yes", "yes", "yes", "yes",      "yes" ],
  restore: [       "yes", "yes", "no",  "no",       "no"  ],
  remove_for_good: [
                   "yes", "no",  "no",  "no",       "no"  ],
  empty_trash: [   "yes", "no",  "no",  "no",       "no"  ],
  list_trash: [    "yes", "yes", "yes", "yes",      "yes" ],
  list_changes: [  "yes", "yes", "yes", "yes",      "yes" ],
  make_held_change: [
                   "yes", "no",  "no",  "no",       "no"  ],
  cancel_held_change: [
                   "yes", "yes", "no",  "no",       "no"  ],
  list_held_changes: [
                   "yes", "yes", "yes", "no",       "no"  ],
  list_notices: [  "yes", "no",  "no",  "no",       "no"  ],
  // The Conversation tools (section 4.12): the person's hand only.
  send_message: [  "yes", "no",  "no",  "no",       "no"  ],
  retry_run: [     "yes", "no",  "no",  "no",       "no"  ],
  note_shown: [    "yes", "no",  "no",  "no",       "no"  ],
  list_messages: [ "yes", "no",  "no",  "no",       "no"  ],
};

/**
 * The Deployment tools of section 4.11, kept by hand the same way, in the same columns. Every one
 * is offered to the person's hand only, never to the Agent or a Connection in any form.
 */
// biome-ignore format: read as a table
export const deploymentOffering: Record<string, [Offer, Offer, Offer, Offer, Offer]> = {
  //                   hand   agent  clock  connection  read-only connection
  list_contexts: [      "yes", "no",  "no",  "no",       "no"  ],
  create_context: [     "yes", "no",  "no",  "no",       "no"  ],
  rename_context: [     "yes", "no",  "no",  "no",       "no"  ],
  set_context_accent: [ "yes", "no",  "no",  "no",       "no"  ],
  retire_context: [     "yes", "no",  "no",  "no",       "no"  ],
  bring_back_context: [ "yes", "no",  "no",  "no",       "no"  ],
  list_connections: [   "yes", "no",  "no",  "no",       "no"  ],
  create_connection: [  "yes", "no",  "no",  "no",       "no"  ],
  rename_connection: [  "yes", "no",  "no",  "no",       "no"  ],
  set_connection_reading_only: [
                        "yes", "no",  "no",  "no",       "no"  ],
  end_connection: [     "yes", "no",  "no",  "no",       "no"  ],
  list_devices: [       "yes", "no",  "no",  "no",       "no"  ],
  rename_device: [      "yes", "no",  "no",  "no",       "no"  ],
  set_device_notifications: [
                        "yes", "no",  "no",  "no",       "no"  ],
  remove_device: [      "yes", "no",  "no",  "no",       "no"  ],
  get_spend: [          "yes", "no",  "no",  "no",       "no"  ],
  set_spend_cap: [      "yes", "no",  "no",  "no",       "no"  ],
  make_export: [        "yes", "no",  "no",  "no",       "no"  ],
};

/**
 * An input each tool runs with, so an offered call is seen to run. Every row needs one, which the
 * registry guard in lint/seam.test.ts checks.
 */
export const runsWith: Record<string, () => unknown> = {
  record_entry: () => ({ words: marked("Offered") }),
  get_entry: () => ({ id: "no-such-entry" }),
  list_entries: () => ({}),
  edit_entry: () => ({ id: "no-such-entry", words: marked("Offered"), version: 0 }),
  restore_entry_version: () => ({ id: "no-such-entry", restore: 0, version: 1 }),
  delete_entry: () => ({ id: "no-such-entry" }),
  list_entry_versions: () => ({ id: "no-such-entry" }),
  add_link: () => ({ entry_id: "no-such-entry", to: { kind: "new_person", name: marked("Ali") } }),
  remove_link: () => ({ entry_id: "no-such-entry", to: { kind: "person", id: "no-such-person" } }),
  mark_standing: () => ({ id: "no-such-entry" }),
  unmark_standing: () => ({ id: "no-such-entry" }),
  add_task: () => ({ entry_id: "no-such-entry", title: marked("Offered") }),
  finish_task: () => ({ id: "no-such-task" }),
  drop_task: () => ({ id: "no-such-task" }),
  reopen_task: () => ({ id: "no-such-task" }),
  rename_task: () => ({ id: "no-such-task", title: marked("Offered") }),
  set_task_dates: () => ({ id: "no-such-task", due_date: "2026-12-01" }),
  set_recurrence: () => ({ id: "no-such-task", recurrence: { kind: "days", every: 1 } }),
  remove_recurrence: () => ({ id: "no-such-task" }),
  delegate_task: () => ({ id: "no-such-task", person_id: "no-such-person" }),
  take_back_task: () => ({ id: "no-such-task" }),
  wait_on: () => ({ id: "no-such-task", on: { kind: "task", id: "no-such-task" } }),
  stop_waiting: () => ({ id: "no-such-task", on: { kind: "project", id: "no-such-project" } }),
  delete_task: () => ({ id: "no-such-task" }),
  get_task: () => ({ id: "no-such-task" }),
  list_tasks: () => ({}),
  move_task: () => ({ id: "no-such-task", project_id: null }),
  make_project_from_task: () => ({ id: "no-such-task" }),
  create_project: () => ({ name: marked("Offered") }),
  rename_project: () => ({ id: "no-such-project", name: marked("Offered") }),
  set_project_due_date: () => ({ id: "no-such-project", due_date: null }),
  finish_project: () => ({ id: "no-such-project" }),
  drop_project: () => ({ id: "no-such-project" }),
  reopen_project: () => ({ id: "no-such-project" }),
  delete_project: () => ({ id: "no-such-project" }),
  get_project: () => ({ id: "no-such-project" }),
  list_projects: () => ({}),
  create_person: () => ({ name: marked("Offered") }),
  rename_person: () => ({ id: "no-such-person", name: marked("Offered") }),
  delete_person: () => ({ id: "no-such-person" }),
  get_person: () => ({ id: "no-such-person" }),
  list_persons: () => ({}),
  get_settings: () => ({}),
  set_time_zone: () => ({ time_zone: "Europe/Paris" }),
  set_brief_time: () => ({ time: "06:30" }),
  set_review_time: () => ({ day: "friday", time: "16:00" }),
  set_notifications: () => ({ on: false }),
  view_attention: () => ({}),
  restore: () => ({ id: "no-such-record" }),
  remove_for_good: () => ({ id: "no-such-record" }),
  empty_trash: () => ({}),
  list_trash: () => ({}),
  list_changes: () => ({}),
  make_held_change: () => ({ id: "no-such-held-change" }),
  cancel_held_change: () => ({ id: "no-such-held-change" }),
  list_held_changes: () => ({}),
  list_notices: () => ({}),
  send_message: () => ({ words: marked("Offered") }),
  retry_run: () => ({ run: "no-such-run" }),
  note_shown: () => ({ message: "no-such-message" }),
  list_messages: () => ({}),
};

/** An input each Deployment tool runs with, given a Context made first. Every row needs one. */
export const deploymentRunsWith: Record<string, (id: string) => unknown> = {
  list_contexts: () => ({}),
  create_context: () => ({ name: "Side", time_zone: "Europe/Paris", accent: "teal" }),
  rename_context: (id) => ({ id, name: "Side" }),
  set_context_accent: (id) => ({ id, accent: "teal" }),
  retire_context: (id) => ({ id }),
  bring_back_context: (id) => ({ id }),
  list_connections: () => ({}),
  create_connection: (id) => ({ name: "Claude Code", context_id: id, reading_only: false }),
  rename_connection: () => ({ id: "no-such-connection", name: "Laptop" }),
  set_connection_reading_only: () => ({ id: "no-such-connection", reading_only: true }),
  end_connection: () => ({ id: "no-such-connection" }),
  list_devices: () => ({}),
  rename_device: () => ({ id: "no-such-device", name: "Laptop" }),
  set_device_notifications: () => ({ id: "no-such-device", on: false }),
  remove_device: () => ({ id: "no-such-device" }),
  get_spend: () => ({}),
  set_spend_cap: () => ({ cap: 25 }),
  make_export: () => ({}),
};

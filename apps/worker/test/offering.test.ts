import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { deploymentOffering, offering } from "./offering.ts";
import { everyCaller, hand, newContext, newDeployment, value } from "./seam.ts";

/** An input each tool runs with, so an offered call is seen to run. Every row needs one. */
const runsWith: Record<string, () => unknown> = {
  record_entry: () => ({ words: marked("Offered") }),
  get_entry: () => ({ id: "no-such-entry" }),
  list_entries: () => ({}),
  add_link: () => ({ entry_id: "no-such-entry", to: { kind: "new_person", name: marked("Ali") } }),
  remove_link: () => ({ entry_id: "no-such-entry", to: { kind: "person", id: "no-such-person" } }),
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
  get_project: () => ({ id: "no-such-project" }),
  list_projects: () => ({}),
  create_person: () => ({ name: marked("Offered") }),
  rename_person: () => ({ id: "no-such-person", name: marked("Offered") }),
  get_person: () => ({ id: "no-such-person" }),
  list_persons: () => ({}),
  get_settings: () => ({}),
  set_time_zone: () => ({ time_zone: "Europe/Paris" }),
  list_changes: () => ({}),
  send_message: () => ({ words: marked("Offered") }),
  list_messages: () => ({}),
};

// The generic test of ADR 0015: every tool, as every caller, against the table kept by hand.
// The oracle holds a call that is not offered to changing nothing.

describe("the offering table", () => {
  for (const [tool, row] of Object.entries(offering)) {
    everyCaller.forEach((caller, column) => {
      const offered = row[column] === "yes";

      test(`${tool} is ${offered ? "" : "not "}offered to the ${caller.kind}`, async () => {
        const input = runsWith[tool];
        expect(
          input,
          `${tool} needs an input it runs with: add one to runsWith in apps/worker/test/offering.test.ts`,
        ).toBeDefined();

        const result = await newContext().callAny(caller, tool, input?.());

        if (!offered) expect(result).toMatchObject({ ok: false, error: { code: "not_offered" } });
        else if (!result.ok)
          expect(["not_offered", "invalid_input"]).not.toContain(result.error.code);
      });
    });
  }
});

/** An input each Deployment tool runs with, given a Context made first. Every row needs one. */
const deploymentRunsWith: Record<string, (id: string) => unknown> = {
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
};

// The same, for the Deployment tools against their own table. The oracle sees only a Context's
// tables, so a call not offered is seen to change nothing by the list of Contexts after it.

describe("the Deployment tools' offering table", () => {
  for (const [tool, row] of Object.entries(deploymentOffering)) {
    everyCaller.forEach((caller, column) => {
      const offered = row[column] === "yes";

      test(`${tool} is ${offered ? "" : "not "}offered to the ${caller.kind}`, async () => {
        const input = deploymentRunsWith[tool];
        expect(
          input,
          `${tool} needs an input it runs with: add one to deploymentRunsWith in apps/worker/test/offering.test.ts`,
        ).toBeDefined();
        const deployment = newDeployment();
        const made = value(
          await deployment.call(hand, "create_context", {
            name: "Work",
            time_zone: "Europe/Paris",
            accent: "blue",
          }),
        ).record;

        const result = await deployment.callAny(caller, tool, input?.(made.id));

        if (offered) {
          if (!result.ok) expect(["not_offered", "invalid_input"]).not.toContain(result.error.code);
          return;
        }
        expect(result).toMatchObject({ ok: false, error: { code: "not_offered" } });
        expect(value(await deployment.call(hand, "list_contexts", {})).items).toEqual([made]);
      });
    });
  }

  test("a name no registry has is not offered", async () => {
    const result = await newDeployment().callAny(hand, "no_such_tool", {});

    expect(result).toMatchObject({ ok: false, error: { code: "not_offered" } });
  });
});

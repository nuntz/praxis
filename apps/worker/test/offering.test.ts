import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { offering } from "./offering.ts";
import { everyCaller, newContext } from "./seam.ts";

/** An input each tool runs with, so an offered call is seen to run. Every row needs one. */
const runsWith: Record<string, () => unknown> = {
  record_entry: () => ({ words: marked("Offered") }),
  get_entry: () => ({ id: "no-such-entry" }),
  list_entries: () => ({}),
  add_task: () => ({ entry_id: "no-such-entry", title: marked("Offered") }),
  finish_task: () => ({ id: "no-such-task" }),
  drop_task: () => ({ id: "no-such-task" }),
  reopen_task: () => ({ id: "no-such-task" }),
  rename_task: () => ({ id: "no-such-task", title: marked("Offered") }),
  set_task_dates: () => ({ id: "no-such-task", due_date: "2026-12-01" }),
  get_task: () => ({ id: "no-such-task" }),
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
  get_settings: () => ({}),
  set_time_zone: () => ({ time_zone: "Europe/Paris" }),
  list_changes: () => ({}),
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

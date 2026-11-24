import { describe, expect, test } from "bun:test";
import { ticketClosedBy } from "./before-close.ts";

// Which ticket a shell command closes, so the ticket check runs with it as closing first.

describe("the ticket a command closes", () => {
  test("is the number gh issue close is given", () => {
    expect(ticketClosedBy('gh issue close 137 --comment "Verified on the Deployment."')).toBe(137);
  });

  test("is the number in the issue's address, or after options gh takes first", () => {
    expect(ticketClosedBy("gh issue close https://github.com/nuntz/praxis/issues/78")).toBe(78);
    expect(ticketClosedBy("gh issue close --repo nuntz/praxis 52 --reason completed")).toBe(52);
    expect(ticketClosedBy('git pull && gh issue close -c "Done." 61')).toBe(61);
  });

  test("is none for a command that only reads, reopens, or names a close inside quotes", () => {
    expect(ticketClosedBy("gh issue view 137 --json state")).toBeNull();
    expect(ticketClosedBy("gh issue reopen 137")).toBeNull();
    expect(ticketClosedBy('echo "gh issue close 5" >> notes.md')).toBeNull();
    expect(ticketClosedBy("gh pr close 144")).toBeNull();
  });
});

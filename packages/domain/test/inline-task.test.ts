import { describe, expect, test } from "bun:test";
import { inlineTasks } from "../src/index.ts";

// Parsing an Inline Task is one of the few places with direct tests (section 13): what the person
// types at the start of a line is too varied for scenarios at the tool seam.

describe("an Inline Task", () => {
  test.each([
    ["[] Call Ali", "Call Ali"],
    ["[ ] Call Ali", "Call Ali"],
    ["- [ ] Call Ali", "Call Ali"],
    ["[]Call Ali", "Call Ali"],
    ["[ ]\tCall Ali  ", "Call Ali"],
    ["[] Pay [the] rent - [ ] today", "Pay [the] rent - [ ] today"],
    ["[] 🙃 café", "🙃 café"],
  ])("a line starting %p makes the Task %p", (words, title) => {
    expect(inlineTasks(words)).toEqual([{ title }]);
  });

  test("each marked line makes one Task, in the order typed, whatever ends the lines", () => {
    const words =
      "Called the landlord.\r\n[] Send the lease\nNo answer yet\r- [ ] Ask about the boiler\n[ ] Pay rent";

    expect(inlineTasks(words)).toEqual([
      { title: "Send the lease" },
      { title: "Ask about the boiler" },
      { title: "Pay rent" },
    ]);
  });

  test.each([
    ["a list item", "- Call Ali"],
    ["a list item with brackets later", "- Call [] Ali"],
    ["a marker later in the line", "Call Ali [] tomorrow"],
    ["an indented marker", "  [] Call Ali"],
    ["an indented list item", "  - [ ] Call Ali"],
    ["a checked box", "[x] Call Ali"],
    ["a checked list item", "- [x] Call Ali"],
    ["a wider box", "[  ] Call Ali"],
    ["a list item with an empty box", "- [] Call Ali"],
    ["another bullet", "* [ ] Call Ali"],
    ["a marker with no title", "[]"],
    ["a marker with only spaces after it", "- [ ]   \t"],
    ["no marker at all", "Called Ali about the lease"],
    ["nothing", ""],
  ])("%s makes no Task", (_, words) => {
    expect(inlineTasks(words)).toEqual([]);
  });

  test("blank and unmarked lines between Tasks make nothing", () => {
    expect(inlineTasks("\n\n[] One\n\n- Two\n[ ] Three\n")).toEqual([
      { title: "One" },
      { title: "Three" },
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import { inlineTasks, inlineTasksAdded } from "../src/index.ts";

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

describe("the Inline Tasks an edit adds", () => {
  test("are the marked lines the new words have and the old did not, in the order typed", () => {
    const before = "Lease\n[] Sign it";
    const after = "[] Read it\nLease\n[] Sign it\n[ ] Send it back";

    expect(inlineTasksAdded(before, after)).toEqual([
      { title: "Read it" },
      { title: "Send it back" },
    ]);
  });

  test.each([
    ["moving a marked line", "[] One\n[] Two", "[] Two\n[] One"],
    ["changing its marker", "[] One", "- [ ] One"],
    ["deleting a marked line", "[] One\n[] Two", "[] Two"],
    ["changing an unmarked line", "Lease\n[] One", "The lease\n[] One"],
  ])("%s adds none", (_, before, after) => {
    expect(inlineTasksAdded(before, after)).toEqual([]);
  });

  test("a line whose title changed adds a Task by its new title, and the old one stays", () => {
    expect(inlineTasksAdded("[] Call Ali", "[] Call Bea")).toEqual([{ title: "Call Bea" }]);
  });

  test("a second line with a title already marked adds one more", () => {
    expect(inlineTasksAdded("[] Call Ali", "[] Call Ali\n[] Call Ali")).toEqual([
      { title: "Call Ali" },
    ]);
  });
});

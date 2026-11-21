import { describe, expect, test } from "bun:test";
import { parseToolInput } from "../src/index.ts";

// Direct tests only where the input space is too large for scenarios at the tool seam
// (section 13): here, the shapes words can take on their way into the Journal.

describe("record_entry's words", () => {
  const asTyped = [
    "  leading and trailing spaces  ",
    "Windows line ends\r\nand a tab\there",
    "no final newline",
    "a final newline\n",
    "\n\nblank lines first",
    "emoji 🙃 and a family 👩‍👩‍👧",
    "café composed (NFC)",
    "café decomposed (NFD)",
    "zero​width space and a soft­hyphen",
    "right-to-left ‫שלום‬ marks",
    "# not a heading to the server, - [ ] nor a Task",
    "<b>markup</b> means nothing to the server",
    "x".repeat(20_000),
  ];

  test.each(asTyped)("are kept exactly as typed: %#", (words) => {
    expect(parseToolInput("record_entry", { words }, "hand")).toEqual({
      ok: true,
      input: { words },
    });
  });

  const blank = ["", " ", "\n", "\r\n\t ", " ", "　", " ", "﻿"];

  test.each(blank)("are needed: whitespace alone is invalid input: %#", (words) => {
    expect(parseToolInput("record_entry", { words }, "hand")).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });
});

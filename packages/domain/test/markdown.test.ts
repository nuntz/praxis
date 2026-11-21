import { describe, expect, test } from "bun:test";
import { type MarkdownBlock, type MarkdownInline, renderMarkdown } from "../src/markdown.ts";

// What the Markdown renderer lets through is one of the few places with direct tests (section
// 13): words can take any shape, and the screen shows only the fixed set of section 8.4, with
// everything else as typed.

/** Words that are one paragraph of plain text. */
function paragraph(text: string): MarkdownBlock[] {
  return [{ kind: "paragraph", children: [{ kind: "text", text }] }];
}

describe("the set", () => {
  test("emphasis and strong", () => {
    expect(renderMarkdown("Closes *Friday*, __not__ later")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "Closes " },
          { kind: "emphasis", children: [{ kind: "text", text: "Friday" }] },
          { kind: "text", text: ", " },
          { kind: "strong", children: [{ kind: "text", text: "not" }] },
          { kind: "text", text: " later" },
        ],
      },
    ]);
  });

  test("inline code, kept as typed inside it", () => {
    expect(renderMarkdown("Run `bun run *forecast*` first")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "Run " },
          { kind: "code", text: "bun run *forecast*" },
          { kind: "text", text: " first" },
        ],
      },
    ]);
  });

  test.each([
    ["fenced, its language set aside", '```json\n{ "ceiling": 12000 }\n  **kept**\n```'],
    ["indented", '    { "ceiling": 12000 }\n      **kept**'],
  ])("a code block, %s", (_, words) => {
    expect(renderMarkdown(words)).toEqual([
      { kind: "code_block", text: '{ "ceiling": 12000 }\n  **kept**' },
    ]);
  });

  test("headings, three levels kept apart and every deeper one as the third", () => {
    const heading = (level: 1 | 2 | 3, text: string): MarkdownBlock => ({
      kind: "heading",
      level,
      children: [{ kind: "text", text }],
    });

    expect(
      renderMarkdown("# Offsite\n## Venues\n### Next\n#### Then\n###### Last\nUnderlined\n==="),
    ).toEqual([
      heading(1, "Offsite"),
      heading(2, "Venues"),
      heading(3, "Next"),
      heading(3, "Then"),
      heading(3, "Last"),
      heading(1, "Underlined"),
    ]);
  });

  test("a quote, holding blocks of its own", () => {
    expect(renderMarkdown("> Keep it *under* 12,000.\n>\n> # Signed\n\nAfter")).toEqual([
      {
        kind: "quote",
        children: [
          {
            kind: "paragraph",
            children: [
              { kind: "text", text: "Keep it " },
              { kind: "emphasis", children: [{ kind: "text", text: "under" }] },
              { kind: "text", text: " 12,000." },
            ],
          },
          { kind: "heading", level: 1, children: [{ kind: "text", text: "Signed" }] },
        ],
      },
      ...paragraph("After"),
    ]);
  });

  test("bulleted and numbered lists, nested, a numbered one from the number typed", () => {
    const words = "- The boathouse\n  1. holds forty\n  2. no projector\n* Print works\n\n3. Quote";

    expect(renderMarkdown(words)).toEqual([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          [
            ...paragraph("The boathouse"),
            {
              kind: "list",
              ordered: true,
              start: 1,
              items: [paragraph("holds forty"), paragraph("no projector")],
            },
          ],
        ],
      },
      { kind: "list", ordered: false, start: 1, items: [paragraph("Print works")] },
      { kind: "list", ordered: true, start: 3, items: [paragraph("Quote")] },
    ]);
  });

  test("a table, each column aligned as typed and a short row filled out", () => {
    const words =
      "| Venue | Holds | Notes |\n|:--|--:|:-:|\n| *Boathouse* | 40 | none |\n| Print works | 65 |";
    const text = (shown: string): MarkdownInline[] => [{ kind: "text", text: shown }];

    expect(renderMarkdown(words)).toEqual([
      {
        kind: "table",
        align: ["left", "right", "center"],
        head: [text("Venue"), text("Holds"), text("Notes")],
        rows: [
          [[{ kind: "emphasis", children: text("Boathouse") }], text("40"), text("none")],
          [text("Print works"), text("65"), []],
        ],
      },
    ]);
  });

  test("a table's column typed with no alignment has none, unless it holds only numbers", () => {
    const words = [
      "| Venue | Holds | Deposit | Share | Code | Ceiling |",
      "|---|---|---|---|---|---|",
      "| Boathouse | 40 | 1,500 | 12.5% | B2 | 12 000 |",
      "| Print works | 65 | −3,000 | 8% | 7 | |",
    ].join("\n");

    expect(renderMarkdown(words)).toMatchObject([
      { kind: "table", align: [null, "right", "right", "right", null, "right"] },
    ]);
  });

  test("a column typed with an alignment keeps it, numbers or not", () => {
    expect(renderMarkdown("| a | b |\n|:-:|:--|\n| 1 | 2 |")).toMatchObject([
      { kind: "table", align: ["center", "left"] },
    ]);
  });

  test("a column with no numbers in it is not taken for one", () => {
    expect(renderMarkdown("| a | b |\n|---|---|\n| | — |")).toMatchObject([
      { kind: "table", align: [null, null] },
    ]);
  });

  test("a Reference's #, with no space after it, makes no heading", () => {
    expect(renderMarkdown("#Offsite 2027")).toEqual(paragraph("#Offsite 2027"));
  });
});

describe("the addresses", () => {
  const link = (href: string, text: string): MarkdownInline => ({
    kind: "link",
    href,
    children: [{ kind: "text", text }],
  });

  test.each([
    [
      "a link",
      "[the *wiki*](https://wiki.example.com/finance)",
      "https://wiki.example.com/finance",
    ],
    [
      "a link by reference",
      "[the wiki]\n\n[the wiki]: https://wiki.example.com",
      "https://wiki.example.com",
    ],
    ["an autolink", "<https://forms.example.com/offsite>", "https://forms.example.com/offsite"],
    ["a scheme in capitals", "[form](HTTPS://Forms.example.com)", "HTTPS://Forms.example.com"],
  ])("%s to an https address is a link", (_, words, href) => {
    expect(renderMarkdown(words)).toMatchObject([
      { kind: "paragraph", children: [{ kind: "link", href }] },
    ]);
  });

  test("a bare https address is a link to itself, ending before the mark that ends the sentence", () => {
    expect(renderMarkdown("The form is at https://forms.example.com/offsite?q=1.")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "The form is at " },
          link("https://forms.example.com/offsite?q=1", "https://forms.example.com/offsite?q=1"),
          { kind: "text", text: "." },
        ],
      },
    ]);
  });

  test.each([
    ["a link to http", "[form](http://forms.example.com)"],
    ["a link to a path", "[form](/offsite)"],
    ["a link to a fragment", "[form](#offsite)"],
    ["a link to script", "[form](javascript:alert(1))"],
    ["a link to data", "[form](data:text/html;base64,PGI+)"],
    ["a link to mail", "[Priya](mailto:priya@example.com)"],
    ["a link with no slashes after the scheme", "[form](https:forms.example.com)"],
    ["a link with a scheme and no host", "[form](https://)"],
    ["a link to a definition of http", "[form]\n\n[form]: http://forms.example.com"],
    ["an autolink to http", "<http://forms.example.com>"],
    ["an autolink to mail", "<priya@example.com>"],
    ["a bare http address", "at http://forms.example.com"],
    ["a bare address with no scheme", "at www.example.com or example.com"],
    ["a bare mail address", "priya@example.com"],
    ["a scheme-relative address", "at //forms.example.com"],
  ])("%s is shown as typed", (_, words) => {
    const shown = renderMarkdown(words);

    expect(JSON.stringify(shown)).not.toContain('"link"');
    expect(textOf(shown)).toBe(words.replace(/\n\n/g, ""));
  });
});

/** Every text a rendering holds, run together, as a check that nothing typed was dropped. */
function textOf(shown: unknown): string {
  if (Array.isArray(shown)) return shown.map(textOf).join("");
  if (shown && typeof shown === "object") {
    const { text } = shown as { text?: string };
    return (text ?? "") + Object.values(shown).filter(Array.isArray).map(textOf).join("");
  }
  return "";
}

describe("shown as typed", () => {
  test.each([
    ["quotes nested past any depth", `${"> ".repeat(500)}deep words\n\nAfter`],
    [
      "lists nested past any depth",
      `${Array.from({ length: 300 }, (_, at) => `${"  ".repeat(at)}- x`).join("\n")} deep words\n\nAfter`,
    ],
    ["an unclosed run of marks", `${"*_[`".repeat(5000)} deep words\n\nAfter`],
  ])("words of any shape are shown, never refused or dropped: %s", (_, words) => {
    const shown = textOf(renderMarkdown(words));

    expect(shown).toContain("deep words");
    expect(shown).toEndWith("After");
  });

  test("plain words are one paragraph of themselves", () => {
    expect(renderMarkdown("Called the landlord")).toEqual(paragraph("Called the landlord"));
  });

  test("each line of a paragraph stays a line", () => {
    expect(renderMarkdown("Lease renewal\nneeds a signature  \nby Friday")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "Lease renewal" },
          { kind: "break" },
          { kind: "text", text: "needs a signature" },
          { kind: "break" },
          { kind: "text", text: "by Friday" },
        ],
      },
    ]);
  });

  test.each([
    ["Is <b>bold</b> and <i onclick='x()'>not</i> <!-- here -->"],
    ['Is <img src="https://example.com/a.png" alt="*a*"> here'],
    ["Is <a href=https://example.com>a link</a>"],
  ])("raw HTML within a line, %p", (words) => {
    expect(renderMarkdown(words)).toEqual(paragraph(words));
  });

  test.each([
    ["a script", "<script>alert(1)</script>"],
    ["an image tag", '<img src="https://example.com/a.png">'],
    ["Markdown between tags", "<div>\n**kept** at https://example.com\n</div>"],
  ])("raw HTML on lines of its own, %s", (_, words) => {
    expect(renderMarkdown(`${words}\n\nAfter`)).toEqual([
      { kind: "typed", text: words },
      ...paragraph("After"),
    ]);
  });

  test("strikethrough", () => {
    expect(renderMarkdown("Was ~~Friday~~ Monday")).toEqual(paragraph("Was ~~Friday~~ Monday"));
  });

  test("a footnote, its mark and its note", () => {
    expect(renderMarkdown("Seen[^1]\n\n[^1]: The second signature")).toEqual([
      ...paragraph("Seen[^1]"),
      ...paragraph("[^1]: The second signature"),
    ]);
  });

  test("a footnote whose note is an address is no link's definition", () => {
    expect(renderMarkdown("Seen[^1]\n\n[^1]: https://example.com/note")).toMatchObject([
      ...paragraph("Seen[^1]"),
      { kind: "paragraph", children: [{ kind: "text", text: "[^1]: " }, { kind: "link" }] },
    ]);
  });

  test.each(["---", "***", "___", "- - -", "* * *", " _ _ _ "])("a rule, %p", (rule) => {
    expect(renderMarkdown(`Before\n\n${rule}\n\nAfter`)).toEqual([
      ...paragraph("Before"),
      { kind: "typed", text: rule },
      ...paragraph("After"),
    ]);
  });

  test("a line underlining the one above it is a heading, not a rule", () => {
    expect(renderMarkdown("Venues\n---")).toEqual([
      { kind: "heading", level: 2, children: [{ kind: "text", text: "Venues" }] },
    ]);
  });

  test.each([
    ["checked", "- [x] Called Priya"],
    ["on another bullet", "* [ ] Ask the boathouse"],
    ["indented", "  - [ ] Ask the boathouse"],
  ])("a task-list checkbox, %s, is a list item's words", (_, words) => {
    expect(renderMarkdown(words)).toEqual([
      { kind: "list", ordered: false, start: 1, items: [paragraph(words.trim().slice(2))] },
    ]);
  });
});

describe("an Inline Task's line", () => {
  test("is shown as typed, its marker and spacing kept, with the marked lines after it", () => {
    expect(renderMarkdown("[]  Ask for a *quote*\n- [ ] Confirm the date\n[ ]\tPay")).toEqual([
      { kind: "typed", text: "[]  Ask for a *quote*\n- [ ] Confirm the date\n[ ]\tPay" },
    ]);
  });

  test("ends the paragraph, list or quote before it, and the words after it start anew", () => {
    expect(
      renderMarkdown(
        "Called the landlord\n[] Send the lease\nNo answer\n- Bring the deposit\n- [ ] Confirm\n> Quoted\n[] Pay",
      ),
    ).toEqual([
      ...paragraph("Called the landlord"),
      { kind: "typed", text: "[] Send the lease" },
      ...paragraph("No answer"),
      { kind: "list", ordered: false, start: 1, items: [paragraph("Bring the deposit")] },
      { kind: "typed", text: "- [ ] Confirm" },
      { kind: "quote", children: paragraph("Quoted") },
      { kind: "typed", text: "[] Pay" },
    ]);
  });

  test("is no table's row", () => {
    expect(renderMarkdown("[] Compare | the two\n|---|---|")).toEqual([
      { kind: "typed", text: "[] Compare | the two" },
      ...paragraph("|---|---|"),
    ]);
  });

  test.each([
    ["a marker with no title, which makes no Task", "[]"],
    ["a marker in a code block", "```\n[] Not a Task\n```"],
  ])("is not %s", (_, words) => {
    expect(renderMarkdown(words)).not.toContainEqual(expect.objectContaining({ kind: "typed" }));
  });
});

describe("an image", () => {
  test("to an https address is its address and description", () => {
    expect(
      renderMarkdown("![Floor plan of the *print works*](https://example.com/plan.png)"),
    ).toEqual([
      {
        kind: "paragraph",
        children: [
          {
            kind: "image",
            src: "https://example.com/plan.png",
            description: "Floor plan of the print works",
          },
        ],
      },
    ]);
  });

  test.each([
    ["http", "![Plan](http://example.com/plan.png)"],
    ["data", "![Plan](data:image/png;base64,iVBORw0KGgo=)"],
    ["a path", "![Plan](/plan.png)"],
  ])("to %s is shown as typed", (_, words) => {
    expect(renderMarkdown(words)).toEqual(paragraph(words));
  });
});

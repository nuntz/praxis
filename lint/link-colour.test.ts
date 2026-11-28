import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./released.ts";

// No link on the screen is drawn in the browser's own colour, blue in light and violet in dark,
// which no token names and the One Accent Rule (DESIGN.md) leaves to no link. A link styled by a
// class of its own sets its colour there; one that sets none takes the stylesheet's base rule for
// every link, in ink, visited, hovered or focused alike. The mark on an Entry with a Held Change
// waiting once set no colour, and nothing above it set one for a link, so it was the browser's.
//
// It reads the stylesheet as written, its comments left out, rule by rule, those inside an at-rule
// such as a theme's `@media` included. A rule for every link is one whose selector list names `a`
// by itself or in a state, such as `a:visited`, with no class or ancestor; a rule for a visited or
// unvisited link, whatever else it names, counts too, since that is the browser's colour's state.

const styles = readFileSync(join(root, "apps/pwa/src/styles.css"), "utf8");

/** Whether a selector is for every link, or for the states the browser colours a link by. */
function forEveryLink(selector: string): boolean {
  return selector
    .split(",")
    .map((each) => each.trim())
    .some(
      (each) =>
        /^a(?::[\w-]+(?:\([^)]*\))?)*$/.test(each) || /:(?:any-)?link\b|:visited\b/.test(each),
    );
}

/** The colour each rule for every link sets, in the order written; none where no rule sets one. */
function everyLinkColours(css: string): string[] {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Innermost rules only: a selector holds no brace, so an at-rule's own text is never one.
  return [...uncommented.matchAll(/([^{};]*)\{([^{}]*)\}/g)]
    .filter(([, selector]) => forEveryLink(selector ?? ""))
    .flatMap(([, , body]) =>
      [...(body ?? "").matchAll(/(?<![\w-])color\s*:\s*([^;]+)/g)].map(([, value]) =>
        (value ?? "").trim(),
      ),
    );
}

test("every link on the screen is in ink, in every state, unless its own rule says otherwise", () => {
  expect(everyLinkColours(styles)).toEqual(["var(--ink)"]);
});

test("a rule for every link counts in a list, in a state or in a theme; a link's class or place does not", () => {
  const css = `
    /* a { color: var(--ink); } */
    button, a, label { touch-action: manipulation; }
    a.entry-mark { color: var(--muted); }
    .words a { color: var(--ink); }
    a:active { opacity: 0.7; }
  `;
  expect(everyLinkColours(css)).toEqual([]);
  expect(
    everyLinkColours(`${css}
      h1, a { color: var(--ink); }
      a:hover, a:focus-visible { color: var(--accent); }
      .settings a:visited { color: purple; }
      @media (prefers-color-scheme: dark) { :root { --ink: #eef0f4; } a { color: var(--muted); } }
    `),
  ).toEqual(["var(--ink)", "var(--accent)", "purple", "var(--muted)"]);
});

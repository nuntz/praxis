import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./released.ts";

// Every opacity in the screen's stylesheet is one DESIGN.md names: 0.5 for a control disabled,
// 0.7 for one pressed (Buttons), and 0 or 1 for what is hidden or shown, as an Entry's toolbar is.
// An opacity on words takes them under the 4.5:1 the design system holds every text pairing to,
// which the token test cannot see: in #199 hits dimmed to 0.6 while a newer search was out failed
// the accessibility check once a journey ended on them. A new level is a change to DESIGN.md first,
// and dims words by a colour it names, as `muted` does, rather than by an opacity.
//
// It reads the stylesheet as written, its comments left out, and only `opacity` declarations: a
// transition naming opacity sets none.

const styles = readFileSync(join(root, "apps/pwa/src/styles.css"), "utf8");

/** The levels DESIGN.md names. */
const NAMED = new Set([0, 0.5, 0.7, 1]);

/** Each `opacity` declared at a level DESIGN.md does not name, as written. */
function unnamedOpacities(css: string): string[] {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...uncommented.matchAll(/(?<![\w-])opacity\s*:\s*([^;}]+)/g)]
    .filter(([, value]) => {
      const level = value?.trim().replace(/\s*!important$/, "") ?? "";
      const number = level.endsWith("%") ? Number(level.slice(0, -1)) / 100 : Number(level);
      return !NAMED.has(number);
    })
    .map(([declaration]) => declaration.trim());
}

test("every opacity in the screen's stylesheet is a level DESIGN.md names", () => {
  expect(unnamedOpacities(styles)).toEqual([]);
});

test("an unnamed level is reported, written any way; named levels, transitions and comments are not", () => {
  const css = `
    /* Once dimmed: opacity: 0.6; */
    button:disabled { opacity: 0.5; }
    .pressed { opacity: .7; transition: opacity 160ms ease-out; }
    .toolbar { opacity: 0; } .toolbar.shown { opacity: 1 !important; }
    .stale { opacity: 0.6; }
    .faint { opacity: 40%; }
    .half { opacity: 50%; }
  `;
  expect(unnamedOpacities(css)).toEqual(["opacity: 0.6", "opacity: 40%"]);
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./released.ts";

// A field's placeholder is text the person reads, so it is held to the Pairing Rule (DESIGN.md)
// like any other: shown in a text token the pairing test holds to 4.5:1 on a field's ground, in
// light and in dark. Left to the browser it is the browser's own grey, 4.2:1 on `inset` in light
// and nearer 3:1 in dark, which the token test cannot see and the journeys' check skips; and
// Firefox fades it further unless told not to.
//
// This guard reads the rules that style a placeholder itself, as the stylesheet writes them. A
// field faded as a whole, as a disabled one is like every disabled control, is not its business.

const styles = readFileSync(join(root, "apps/pwa/src/styles.css"), "utf8");

/** Each rule of a stylesheet that styles a placeholder, prefixed or not: its selector and its declarations. */
function placeholderRules(css: string) {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [
    ...uncommented.matchAll(/([^{}]*::(?:-webkit-input-|-moz-)?placeholder[^{}]*)\{([^}]*)\}/g),
  ].map(([, selector, body]) => ({
    selector: (selector ?? "").trim(),
    declarations: Object.fromEntries(
      (body ?? "")
        .split(";")
        .filter((declaration) => declaration.includes(":"))
        .map((declaration) => {
          const at = declaration.indexOf(":");
          return [declaration.slice(0, at).trim(), declaration.slice(at + 1).trim()];
        }),
    ) as Record<string, string>,
  }));
}

/** The text tokens the pairing test holds on every ground a field takes. */
const TEXT_TOKENS = ["var(--muted)", "var(--ink)"];

/** Each declaration of a placeholder rule that shows it in another colour or fades it. */
function strays(css: string): string[] {
  return placeholderRules(css).flatMap(({ selector, declarations }) =>
    Object.entries(declarations)
      .filter(([property, value]) =>
        property === "opacity"
          ? value !== "1"
          : (property === "color" || property === "-webkit-text-fill-color") &&
            !TEXT_TOKENS.includes(value),
      )
      .map(([property, value]) => `${selector} { ${property}: ${value} }`),
  );
}

test("every placeholder is shown in muted, in full, never in the browser's own grey", () => {
  const everywhere = placeholderRules(styles).find(({ selector }) => selector === "::placeholder");
  expect(everywhere?.declarations).toMatchObject({ color: "var(--muted)", opacity: "1" });
});

test("no placeholder rule, anywhere or for any browser, sets another colour or fades it", () => {
  // The stylesheet's placeholder rules were found, so none reported below is none there.
  expect(placeholderRules(styles).map(({ selector }) => selector)).toContain("::placeholder");
  expect(strays(styles)).toEqual([]);
});

test("a placeholder rule that recolours or fades it is reported, prefixed or not", () => {
  const css = `
    ::placeholder { color: var(--muted); opacity: 1; }
    .search input::placeholder { color: var(--muted); opacity: 0.6; }
    input::-webkit-input-placeholder { color: #9aa0aa; }
    input::-moz-placeholder { -webkit-text-fill-color: url(a:b); }
  `;
  expect(strays(css)).toEqual([
    ".search input::placeholder { opacity: 0.6 }",
    "input::-webkit-input-placeholder { color: #9aa0aa }",
    "input::-moz-placeholder { -webkit-text-fill-color: url(a:b) }",
  ]);
});

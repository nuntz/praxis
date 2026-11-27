import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./released.ts";

// A field's placeholder is text the person reads, so it is held to the Pairing Rule (DESIGN.md)
// like any other: shown in a text token the pairing test holds to 4.5:1 on a field's ground, in
// light and in dark. Left to the browser it is the browser's own grey, 4.2:1 on `inset` in light
// and nearer 3:1 in dark, which the token test cannot see and the journeys' check skips; and
// Firefox fades it further unless told not to.

const styles = readFileSync(join(root, "apps/pwa/src/styles.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Each rule of the stylesheet that styles a placeholder, prefixed or not: its selector and its declarations. */
const placeholderRules = [
  ...styles.matchAll(/([^{}]*::(?:-webkit-input-|-moz-)?placeholder[^{}]*)\{([^}]*)\}/g),
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

/** The text tokens the pairing test holds on every ground a field takes. */
const TEXT_TOKENS = ["var(--muted)", "var(--ink)"];

test("every placeholder is shown in muted, in full, never in the browser's own grey", () => {
  const everywhere = placeholderRules.find(({ selector }) => selector === "::placeholder");
  expect(everywhere?.declarations).toMatchObject({ color: "var(--muted)", opacity: "1" });
});

test("no placeholder rule, anywhere or for any browser, sets another colour or fades it", () => {
  const strays = placeholderRules.flatMap(({ selector, declarations }) =>
    Object.entries(declarations)
      .filter(([property, value]) =>
        property === "opacity"
          ? value !== "1"
          : (property === "color" || property === "-webkit-text-fill-color") &&
            !TEXT_TOKENS.includes(value),
      )
      .map(([property, value]) => `${selector} { ${property}: ${value} }`),
  );
  expect(strays).toEqual([]);
});

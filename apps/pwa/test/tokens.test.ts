import { describe, expect, test } from "bun:test";
import { ACCENTS as DOMAIN_ACCENTS } from "@praxis/domain";
import { ACCENTS, type ColorToken, colors, type Theme } from "../src/design/tokens.ts";

// Every text pairing the design system names, in light and in dark, is at least 4.5:1 (WCAG 2.2
// AA, section 8.11). The screen's own accessibility check sees only the accent it shows, so the
// six accents are checked here, each against the grounds its usage note puts it on.

/** WCAG 2.2's relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (at: number) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

const tints = ACCENTS.map((accent) => `${accent}-tint` as const);

/** Each text colour, and the grounds it is named on. */
const pairings: [ColorToken, ColorToken[]][] = [
  ["ink", ["ground", "surface", "inset", "notice", "match", ...tints]],
  ["muted", ["ground", "surface", "inset"]],
  ["warn", ["surface", "inset"]],
  // The "Jump to latest" pill and a set search chip, the reverse of ink on surface.
  ["surface", ["ink"]],
  // A composer's label, a Mention, and Record's word while it has nothing to send.
  ...ACCENTS.map((accent): [ColorToken, ColorToken[]] => [accent, ["surface", `${accent}-tint`]]),
  ...ACCENTS.map((accent): [ColorToken, ColorToken[]] => ["on-accent", [accent]]),
  // The End Call button's icon, on its solid warn: warn's one fill.
  ["on-accent", ["warn"]],
];

const cases = (["light", "dark"] as Theme[]).flatMap((theme) =>
  pairings.flatMap(([text, grounds]) => grounds.map((ground) => [theme, text, ground] as const)),
);

describe("every text pairing is at least 4.5:1", () => {
  test.each(cases)("in %s, %s on %s", (theme, text, ground) => {
    expect(contrast(colors[text][theme], colors[ground][theme])).toBeGreaterThanOrEqual(4.5);
  });
});

// A composer's send with nothing to send is the accent's icon on the accent's tint, with no fill of
// its own: a mark the person must still see, so at least 3:1, WCAG 2.2's bar for a non-text mark.
// The accent's 4.5:1 as text on its tint implies it today; it is its own bar should that one change.
// Record's word beside it is the accent as text on its tint, among the pairings above.
const atRestCases = (["light", "dark"] as Theme[]).flatMap((theme) =>
  ACCENTS.map((accent) => [theme, accent] as const),
);

describe("a composer's send with nothing to send", () => {
  test.each(atRestCases)("in %s, %s's icon on its tint is at least 3:1", (theme, accent) => {
    expect(contrast(colors[accent][theme], colors[`${accent}-tint`][theme])).toBeGreaterThanOrEqual(
      3,
    );
  });
});

test("a known pairing measures as WCAG gives it", () => {
  // Black on white is 21:1 and a colour on itself 1:1, by the formula's own ends.
  expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21);
  expect(contrast("#2B55C4", "#2B55C4")).toBe(1);
});

describe("the accents", () => {
  test("are the set the Deployment tools take", () => {
    expect([...ACCENTS]).toEqual([...DOMAIN_ACCENTS]);
  });
});

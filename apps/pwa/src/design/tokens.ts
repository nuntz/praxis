/**
 * Praxis's design tokens: the source of its look (section 8.11), written from the Praxis design
 * system. The stylesheet is generated from them at build time (`tokensCss`), and every component
 * takes its colours, type, spacing and radii from the custom properties they become.
 */

export type Theme = "light" | "dark";

/**
 * The fixed set of Context accents. A Context has one, and nothing else takes an accent. The
 * domain package holds the same set for the tools; a test keeps the two equal, since the build
 * reads this file on its own.
 */
export const ACCENTS = ["blue", "rust", "teal", "plum", "moss", "slate"] as const;
export type Accent = (typeof ACCENTS)[number];

/** A colour's value in each theme. */
type ThemedColor = Record<Theme, string>;

/** Light and dark both follow the Device. Every colour has a value in each. */
export const colors = {
  /** The page behind the panels, and the top bar. */
  ground: { light: "#ECEEF2", dark: "#0F1114" },
  /** A panel: the Attention, Journal and Conversation columns, a card on the phone, the tab bar. */
  surface: { light: "#FFFFFF", dark: "#1B1E24" },
  /** A Task row, the search field, a day marker, the active tab, code. Sits on surface. */
  inset: { light: "#F4F5F8", dark: "#252931" },
  /** A hairline border. */
  rule: { light: "#D5D9E0", dark: "#3A3F4A" },
  /** Text on ground, surface, inset, notice and any accent tint. Also the app icon's tile. */
  ink: { light: "#1A1D23", dark: "#EEF0F4" },
  /** Secondary text on ground, surface and inset, and the border of a Task's round control. */
  muted: { light: "#596070", dark: "#A3AAB8" },
  /**
   * Overdue, a Project with no open Task, and a refusal the screen shows in words. Text on surface
   * and inset, always with words. Also the solid fill of the End Call button, under on-accent, its
   * one fill.
   */
  warn: { light: "#B42318", dark: "#FF9388" },
  /** The ground of a standing Notice. Text on it is ink. */
  notice: { light: "#FFF0CC", dark: "#3B300F" },
  /**
   * The mark on what a search matched, in an excerpt or a title. Text on it is ink, at 600.
   * Nothing else takes it.
   */
  match: { light: "#FFE58A", dark: "#5C4A0E" },
  /** Text and icons on a solid accent, and the icon on the End Call button's solid warn. */
  "on-accent": { light: "#FFFFFF", dark: "#14161B" },
  // Each accent is solid under on-accent, or text on surface and on its tint. The tint marks where
  // the person is about to write or decide: both composers, a Held Change and a Mention.
  blue: { light: "#2B55C4", dark: "#9DB6FF" },
  "blue-tint": { light: "#E6ECFA", dark: "#1E2740" },
  rust: { light: "#A8480C", dark: "#F2A766" },
  "rust-tint": { light: "#FAEBDD", dark: "#3A2616" },
  teal: { light: "#0E6B66", dark: "#6FD0C6" },
  "teal-tint": { light: "#DFF1EF", dark: "#12302E" },
  plum: { light: "#8A2F7E", dark: "#E3A1DA" },
  "plum-tint": { light: "#F6E6F4", dark: "#361C33" },
  moss: { light: "#4C6A14", dark: "#B5D075" },
  "moss-tint": { light: "#EBF2DC", dark: "#232E10" },
  slate: { light: "#4A5568", dark: "#B4BECF" },
  "slate-tint": { light: "#E9ECF1", dark: "#262B35" },
} as const satisfies Record<string, ThemedColor>;

export type ColorToken = keyof typeof colors;

/**
 * What a colour takes instead when the Device asks for more contrast. A hairline is then drawn in
 * muted, so an edge that tone alone does not give, such as Attention's over the Journal in between,
 * stands out plainly.
 */
export const moreContrast = { rule: "muted" } as const satisfies Partial<
  Record<ColorToken, ColorToken>
>;

/**
 * One family, Figtree, shipped with the app so nothing is fetched from elsewhere. Code alone uses
 * the Device's own monospace.
 */
export const families = {
  sans: '"Figtree Variable", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

/**
 * A type style. `tracking`, in em, is set as `--tracking-<name>` beside `--type-<name>`, since the
 * `font` shorthand cannot carry it. Figtree has no tracking of its own for small sizes, as a
 * system face has, so the smallest styles are opened up a little to stay legible.
 */
type TypeStyle = {
  family: keyof typeof families;
  size: number;
  line: number;
  weight: number;
  tracking?: number;
};

export const typography = {
  "screen-title": { family: "sans", size: 26, line: 32, weight: 700 },
  wordmark: { family: "sans", size: 22, line: 28, weight: 700 },
  "column-title": { family: "sans", size: 20, line: 26, weight: 700 },
  /** An Entry's words, one step larger than the interface around them. */
  words: { family: "sans", size: 17, line: 26, weight: 400 },
  "body-phone": { family: "sans", size: 16, line: 23, weight: 400 },
  body: { family: "sans", size: 15, line: 22, weight: 400 },
  "row-title": { family: "sans", size: 15, line: 22, weight: 500 },
  button: { family: "sans", size: 15, line: 22, weight: 700 },
  label: { family: "sans", size: 13, line: 18, weight: 700, tracking: 0.01 },
  meta: { family: "sans", size: 13, line: 18, weight: 400 },
  caption: { family: "sans", size: 12, line: 16, weight: 600, tracking: 0.01 },
  "code-block": { family: "mono", size: 14, line: 22, weight: 400 },
} as const satisfies Record<string, TypeStyle>;

export const spacing = {
  /** Between a Task row and the next. */
  "space-1": 4,
  /** Between a control and its neighbour. */
  "space-2": 8,
  /** Inside a Task row and a small card. The gap above a composer. */
  "space-3": 12,
  /** The phone's side gutter. Between sections in a column. */
  "space-4": 16,
  /** A desktop panel's inset, shared by every column's header, content and composer. */
  "space-5": 20,
  /** Between panels, and between the panels and the edge of the window. */
  "panel-gap": 14,
} as const;

export const radius = {
  /** A Mention, a Task row, a box inside a card. */
  "radius-sm": 10,
  /** A card. */
  "radius-md": 14,
  /** A panel and a composer. */
  "radius-lg": 20,
  /** Buttons, the Context switcher, badges, the tab bar. A Task's control is a full circle. */
  "radius-pill": 999,
} as const;

function declarations(entries: [string, string][]): string {
  return entries.map(([name, value]) => `  --${name}: ${value};`).join("\n");
}

function colorDeclarations(theme: Theme): string {
  return declarations(Object.entries(colors).map(([name, pair]) => [name, pair[theme]]));
}

/**
 * The tokens as custom properties: light on `:root`, dark when the Device prefers it, with no
 * switch. `.accent-<name>` sets `--accent` and `--accent-tint` for what is inside it.
 */
export function tokensCss(): string {
  const fixed = declarations([
    ...Object.entries(families).map(([name, value]): [string, string] => [`font-${name}`, value]),
    ...Object.entries(typography).map(([name, style]): [string, string] => [
      `type-${name}`,
      `${style.weight} ${style.size}px/${style.line}px var(--font-${style.family})`,
    ]),
    ...Object.entries(typography).flatMap(([name, style]): [string, string][] =>
      "tracking" in style ? [[`tracking-${name}`, `${style.tracking}em`]] : [],
    ),
    ...Object.entries({ ...spacing, ...radius }).map(([name, px]): [string, string] => [
      name,
      `${px}px`,
    ]),
  ]);
  const accents = ACCENTS.map(
    (accent) =>
      `.accent-${accent} {\n  --accent: var(--${accent});\n  --accent-tint: var(--${accent}-tint);\n}`,
  );
  return [
    `:root {\n  color-scheme: light dark;\n${colorDeclarations("light")}\n${fixed}\n}`,
    `@media (prefers-color-scheme: dark) {\n:root {\n${colorDeclarations("dark")}\n}\n}`,
    `@media (prefers-contrast: more) {\n:root {\n${declarations(
      Object.entries(moreContrast).map(([name, instead]) => [name, `var(--${instead})`]),
    )}\n}\n}`,
    ...accents,
  ].join("\n\n");
}

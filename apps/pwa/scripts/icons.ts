// Makes the app icon's files in public/ (section 8.11): the Lucide hammer in white on a dark
// neutral tile, which never takes a Context's accent. Run by hand when the mark changes, with
// `bun run icons`; the files it writes are committed. The PNGs are drawn by Playwright's Chromium.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { colors } from "../src/design/tokens.ts";

/** Lucide's hammer (ISC licence), on its 24px grid. */
const HAMMER = [
  "m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9",
  "m18 15 4-4",
  "m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5",
];

/**
 * The mark on a 100 by 100 tile. A rounded tile for where the icon is shown as drawn; a square
 * one, with the hammer inside the middle 80%, for a system that cuts its own shape from it.
 */
function svg(shape: "rounded" | "square"): string {
  const tile = shape === "rounded" ? `rx="23"` : "";
  // The stroke is 2.2 rather than Lucide's 2, so the mark holds at favicon size.
  const [at, scale] = shape === "rounded" ? [19, 2.6] : [26, 2];
  const paths = HAMMER.map((d) => `<path d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Praxis</title><rect width="100" height="100" ${tile} fill="${colors.ink.light}"/><g transform="translate(${at} ${at}) scale(${scale})" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>\n`;
}

const out = join(import.meta.dir, "../public");
writeFileSync(join(out, "icon.svg"), svg("rounded"));

const browser = await chromium.launch();
const page = await browser.newPage();
const pngs: [string, "rounded" | "square", number][] = [
  ["icon-192.png", "rounded", 192],
  ["icon-512.png", "rounded", 512],
  ["icon-maskable-512.png", "square", 512],
  // iOS rounds the corners itself.
  ["apple-touch-icon.png", "square", 180],
];
for (const [name, shape, size] of pngs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(shape)}`,
  );
  await page.locator("svg").screenshot({ path: join(out, name), omitBackground: true });
}
await browser.close();

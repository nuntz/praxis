import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./released.ts";

// Nothing on the screen is a size container. With Attention's rows made one, iOS Safari
// locked up for good as each row's mark gave way to its title, laid out again at every try, and
// the screen showed Attention's heading and nothing under it (#187). No browser the journeys run
// in locks up, so this guard is what keeps a size container from coming back: an element's share
// of its row is a percentage of its containing block, as the mark's 40% is.
//
// It reads the stylesheet as written, its comments left out: every `container-type` and
// `container` shorthand stays `normal`, and no length is in container query units (cqi and kin),
// which measure against a size container. A container that only answers style queries would
// pass, being no size container; none is used.

const styles = readFileSync(join(root, "apps/pwa/src/styles.css"), "utf8");

/** Each declaration or length in a stylesheet that makes or measures against a size container. */
function sizeContainers(css: string): string[] {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const declared = [...uncommented.matchAll(/(?<![\w-])container(-type)?\s*:\s*([^;}]+)/g)]
    .filter(([, typeOnly, value]) => {
      // The shorthand is a name, then `/` and the type, which is normal when left out.
      const type = typeOnly ? value : value?.includes("/") ? value.split("/").at(-1) : "normal";
      return type?.trim() !== "normal";
    })
    .map(([declaration]) => declaration.trim());
  const measured = [...uncommented.matchAll(/-?\d*\.?\d+cq(?:i|b|w|h|min|max)\b/g)].map(
    ([length]) => length,
  );
  const queried = [...uncommented.matchAll(/@container\b[^{]*/g)].map(([query]) => query.trim());
  return [...declared, ...measured, ...queried];
}

test("nothing in the screen's stylesheet is a size container or measures against one", () => {
  expect(sizeContainers(styles)).toEqual([]);
});

test("a size container, its query and its units are each reported; normal and comments are not", () => {
  const css = `
    /* A row was once a size container: container-type: inline-size; max-width: 40cqi; */
    .row { container-type: inline-size; }
    .card { container: card / size; }
    .plain { container-type: normal; container: none / normal; }
    .named { container: sidebar; }
    .mark { max-width: 40cqi; margin-inline: 2.5cqmin; }
    @container card (width > 30em) { .mark { display: none; } }
  `;
  expect(sizeContainers(css)).toEqual([
    "container-type: inline-size",
    "container: card / size",
    "40cqi",
    "2.5cqmin",
    "@container card (width > 30em)",
  ]);
});

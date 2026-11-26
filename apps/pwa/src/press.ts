/**
 * What folds away as the focus leaves it, a composer at rest or the search's chips, folds once a
 * press is done, never during it: folded at the press's start, it would move what is under the
 * pointer, and the press would land on something else, or on nothing.
 */

let pressing = false;
let waiting: (() => void)[] = [];

if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      pressing = true;
    },
    true,
  );
  const released = () => {
    pressing = false;
    // After the press's click, which is dispatched once the pointer is up.
    setTimeout(() => {
      const run = waiting;
      waiting = [];
      for (const each of run) each();
    });
  };
  document.addEventListener("pointerup", released, true);
  document.addEventListener("pointercancel", released, true);
}

/** Run `fold` now, or, while a press is under way, once it is done. */
export function afterPress(fold: () => void): void {
  if (pressing) waiting.push(fold);
  else fold();
}

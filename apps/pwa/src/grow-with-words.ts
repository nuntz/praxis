import { createEffect, onCleanup, onMount } from "solid-js";

/** The most of its column's height, as shown, a composer takes as its words grow (section 8.2). */
const CEILING = 0.4;

/**
 * A composer's field grows with its words past its two lines, a line at a time, until the composer
 * is 40% of its column's height, and then scrolls within itself. With fewer words it shrinks again,
 * never below the height its styles give it: two lines focused, one at rest (section 8.2). Both
 * composers call it from their field's `ref`, given what changes their size: the words, and in the
 * Journal what is said above them, a Follow-up or an aim.
 */
export function growWithWords(field: HTMLTextAreaElement, sizedBy: () => unknown) {
  function fit() {
    const composer = field.closest<HTMLElement>(".composer");
    const column = field.closest(".peer");
    if (!composer || !column) return;
    // What the composer holds besides the field: its label, a Follow-up or an aim, its padding.
    const around = composer.offsetHeight - field.offsetHeight;
    // Held at its height while the field is measured at its least, so the column over it keeps its
    // size and where it is scrolled to, as at its newest.
    composer.style.minHeight = `${composer.offsetHeight}px`;
    field.style.height = "";
    const least = field.clientHeight;
    const needed = field.scrollHeight;
    if (needed > least) {
      const line = Number.parseFloat(getComputedStyle(field).lineHeight);
      const room = shownHeight(column) * CEILING - around;
      // Whole lines only, so the field at its ceiling never shows half of one.
      const most = least + Math.max(0, Math.floor((room - least) / line) * line);
      field.style.height = `${Math.min(needed, most)}px`;
    }
    composer.style.minHeight = "";
  }

  createEffect(() => {
    sizedBy();
    fit();
  });
  // The column is resized as the window is, or shown as a phone's tab is; the keyboard opening
  // changes how much of it is shown.
  const resized = new ResizeObserver(fit);
  onMount(() => {
    const peer = field.closest(".peer");
    if (peer) resized.observe(peer);
  });
  window.visualViewport?.addEventListener("resize", fit);
  window.visualViewport?.addEventListener("scroll", fit);
  onCleanup(() => {
    resized.disconnect();
    window.visualViewport?.removeEventListener("resize", fit);
    window.visualViewport?.removeEventListener("scroll", fit);
  });
}

/**
 * How much of the column is shown: on a phone with the on-screen keyboard up, only what is above
 * the keyboard, so the composer never covers the column.
 */
function shownHeight(column: Element): number {
  const box = column.getBoundingClientRect();
  const view = window.visualViewport;
  const top = Math.max(box.top, view?.offsetTop ?? 0);
  const bottom = Math.min(box.bottom, view ? view.offsetTop + view.height : window.innerHeight);
  return Math.max(0, bottom - top);
}

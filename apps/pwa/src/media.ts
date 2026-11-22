import { type Accessor, createSignal } from "solid-js";

/**
 * Whether a media query holds, as the browser last said, followed as it changes. Outside a browser
 * it is `otherwise`.
 */
function holds(query: string, otherwise: boolean): Accessor<boolean> {
  const media = typeof window === "undefined" ? undefined : window.matchMedia(query);
  const [matches, setMatches] = createSignal(media?.matches ?? otherwise);
  media?.addEventListener("change", (event) => setMatches(event.matches));
  return matches;
}

/**
 * Whether the Device has a fine pointer that hovers, as a mouse or a trackpad. An Entry's actions
 * are a toolbar shown on hover where it has, and a menu behind one button on a touch screen
 * (section 8.4).
 */
export const pointerHovers = holds("(hover: hover) and (pointer: fine)", true);

/**
 * Whether the screen is a phone's width (section 8.1), the stylesheet's `(width < 720px)`, which a
 * media query there cannot take from anywhere else. A phone shows Settings' list of sections and a
 * section as screens of their own; wider, the list is beside the section shown.
 */
export const onPhone = holds("(width < 720px)", false);

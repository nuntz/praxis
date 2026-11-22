import { createSignal } from "solid-js";

/**
 * Whether the Device has a fine pointer that hovers, as a mouse or a trackpad, as the browser last
 * said. An Entry's actions are a toolbar shown on hover where it has, and a menu behind one button
 * on a touch screen (section 8.4).
 */
const query =
  typeof window === "undefined"
    ? undefined
    : window.matchMedia("(hover: hover) and (pointer: fine)");

const [pointerHovers, setPointerHovers] = createSignal(query?.matches ?? true);

query?.addEventListener("change", (event) => setPointerHovers(event.matches));

export { pointerHovers };

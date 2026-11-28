import type { LucideIcon } from "lucide-solid";
import ChevronDown from "lucide-solid/icons/chevron-down";
import X from "lucide-solid/icons/x";
import { createEffect, createSignal, createUniqueId, type JSX, onCleanup, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { onPhone } from "../media.ts";

/** What a chip holds once set: as it says it, and as a screen reader hears it before "remove". */
export type ChipHeld = { shown: string; named: string };

/**
 * One chip of a row that narrows what is shown, as search's do (section 8.4). Not set, it is a
 * pill saying what it would narrow by, with a chevron, and opens its picker under it; set, it is
 * in ink, says what it holds, with an x, and one tap lifts it. It is one button either way, so the
 * focus stays on it as it is set or lifted. It is one line, what it holds cut with an ellipsis, so
 * its name says the whole of it, and on a desktop its tooltip too. The picker takes the focus as it
 * opens, and goes on Escape, on a tap outside it or once the focus leaves it, the focus back on the
 * chip. It opens inside its column: where it would run past the column's end, it is aligned to the
 * chip's end instead, and it is never wider than the column.
 */
export function Chip(props: {
  /** What the chip narrows by, which names its picker: "Time", "Project". */
  name: string;
  /** What it says while not set: "Any time", "Project". */
  label: string;
  /** Before its words, set or not, when it has one. */
  icon?: LucideIcon | undefined;
  /** What it holds, or null while it is not set. */
  held: ChipHeld | null;
  /** Lift what it holds. */
  onLift: () => void;
  /** Its picker, given how to put itself away once something is picked. */
  picker: (putAway: () => void) => JSX.Element;
}) {
  const id = createUniqueId();
  const [shown, setShown] = createSignal(false);
  let wrapper!: HTMLDivElement;
  let button!: HTMLButtonElement;
  let panel: HTMLDivElement | undefined;

  function show() {
    setShown(true);
    if (panel) placeWithin(panel);
    panel?.querySelector<HTMLElement>("button, input, select, [tabindex]")?.focus();
  }

  /** The picker inside the column it opens in, which would clip it. */
  function placeWithin(picker: HTMLElement) {
    const column = (wrapper.closest(".peer") ?? document.documentElement).getBoundingClientRect();
    picker.style.maxWidth = `${column.width}px`;
    picker.classList.toggle("from-end", picker.getBoundingClientRect().right > column.right);
  }

  function putAway() {
    button.focus();
    setShown(false);
  }

  // A tap outside the picker puts it away: listened for only while it is shown.
  createEffect(() => {
    if (!shown()) return;
    const outside = (event: PointerEvent) => {
      if (!wrapper.contains(event.target as Node)) setShown(false);
    };
    document.addEventListener("pointerdown", outside);
    onCleanup(() => document.removeEventListener("pointerdown", outside));
  });

  return (
    <div
      ref={wrapper}
      class="chip-holder"
      onFocusOut={(event) => {
        const to = event.relatedTarget as Node | null;
        if (shown() && to && !wrapper.contains(to)) setShown(false);
      }}
    >
      <button
        ref={button}
        type="button"
        class="chip"
        classList={{ set: props.held !== null }}
        aria-label={props.held === null ? undefined : `${props.held.named}, remove`}
        title={props.held === null || onPhone() ? undefined : props.held.named}
        aria-haspopup={props.held === null ? "dialog" : undefined}
        aria-expanded={props.held === null ? shown() : undefined}
        aria-controls={props.held === null && shown() ? id : undefined}
        onClick={() => {
          if (props.held !== null) props.onLift();
          else if (shown()) setShown(false);
          else show();
        }}
      >
        <Show when={props.icon}>
          {(icon) => <Dynamic component={icon()} class="chip-icon" size={14} aria-hidden="true" />}
        </Show>
        {/* Its own direction is taken anew for each thing it says: a browser keeps the first. */}
        <Show when={props.held?.shown ?? props.label} keyed>
          {(words) => (
            <span class="chip-words" dir="auto">
              {words}
            </span>
          )}
        </Show>
        <Dynamic
          component={props.held === null ? ChevronDown : X}
          class="chip-end"
          size={14}
          aria-hidden="true"
        />
      </button>
      <Show when={props.held === null && shown()}>
        <div
          ref={panel}
          id={id}
          class="chip-picker"
          role="dialog"
          aria-label={props.name}
          // Handled here, so nothing around the chip, as the search field or Settings, takes it too.
          on:keydown={(event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            putAway();
          }}
        >
          {props.picker(putAway)}
        </div>
      </Show>
    </div>
  );
}

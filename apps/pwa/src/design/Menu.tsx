import type { LucideIcon } from "lucide-solid";
import { createEffect, createSignal, createUniqueId, Index, onCleanup, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { spacing } from "./tokens.ts";

/** One action of a menu or a toolbar: its words, its icon, and what choosing it does. */
export type Action = {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
};

/** How far a menu stands from its button, and keeps from the edge of the window. */
const GAP = spacing["space-1"];

/**
 * Where a menu is drawn beside its button, in the window (`view`), and the most it may be high:
 * under its button, at its right edge, or over it where it does not fit under it and there is more
 * room over it. Where it fits on neither side, it takes the room it has and scrolls.
 */
function placeMenu(
  button: { top: number; bottom: number; right: number },
  menu: { width: number; height: number },
  view: { width: number; height: number },
): { top: number; left: number; maxHeight: number } {
  const roomUnder = view.height - GAP - (button.bottom + GAP);
  const roomOver = button.top - GAP - GAP;
  const opensUnder = menu.height <= roomUnder || roomUnder >= roomOver;
  const maxHeight = Math.max(0, opensUnder ? roomUnder : roomOver);
  const top = opensUnder
    ? button.bottom + GAP
    : button.top - GAP - Math.min(menu.height, maxHeight);
  const left = Math.max(GAP, Math.min(button.right - menu.width, view.width - GAP - menu.width));
  return { top, left, maxHeight };
}

/**
 * A button that stands alone as an icon, named, with its tooltip saying the same (section 8.11),
 * opening a menu of actions beside it. The menu is drawn in the top layer, above every Entry and
 * column, placed by its button as it opens and as anything under it scrolls (`placeMenu`). It
 * takes the keyboard's focus as it opens, moves it with the arrow keys, and goes on Escape, on Tab
 * or on a choice, the focus back on its button, and on a tap outside it, the focus where the tap
 * leaves it.
 */
export function Menu(props: { label: string; icon: LucideIcon; items: Action[] }) {
  const id = createUniqueId();
  const [shown, setShown] = createSignal(false);
  let wrapper!: HTMLDivElement;
  let button!: HTMLButtonElement;
  let list: HTMLDivElement | undefined;

  const items = () => [
    ...(list?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []),
  ];

  function place() {
    if (!list) return;
    // Measured at its whole height, its own scroll and borders with it, without letting go of the
    // room it is given, which would send it back to its top.
    const height = list.scrollHeight + list.offsetHeight - list.clientHeight;
    const { top, left, maxHeight } = placeMenu(
      button.getBoundingClientRect(),
      { width: list.getBoundingClientRect().width, height },
      {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
    );
    list.style.top = `${top}px`;
    list.style.left = `${left}px`;
    list.style.maxHeight = `${maxHeight}px`;
  }

  function show() {
    setShown(true);
    list?.showPopover();
    place();
    items()[0]?.focus();
  }

  function putAway() {
    button.focus();
    setShown(false);
  }

  // A tap or a click outside the menu puts it away, wherever the focus was left: listened for only
  // while it is shown, since every Entry in the Journal has a menu.
  createEffect(() => {
    if (!shown()) return;
    const outside = (event: PointerEvent) => {
      if (!wrapper.contains(event.target as Node)) setShown(false);
    };
    document.addEventListener("pointerdown", outside);
    onCleanup(() => document.removeEventListener("pointerdown", outside));
  });

  // Drawn in the window rather than in its column, the menu follows its button as the column under
  // it scrolls or the window changes size.
  createEffect(() => {
    if (!shown()) return;
    const options = { capture: true, passive: true };
    // Its own scroll, where it is too long for the room it has, moves nothing under it.
    const scrolled = (event: Event) => {
      if (!list?.contains(event.target as Node)) place();
    };
    document.addEventListener("scroll", scrolled, options);
    window.addEventListener("resize", place);
    onCleanup(() => {
      document.removeEventListener("scroll", scrolled, options);
      window.removeEventListener("resize", place);
    });
  });

  function onKeyDown(event: KeyboardEvent) {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = {
      ArrowDown: (at + 1) % all.length,
      ArrowUp: (at - 1 + all.length) % all.length,
      Home: 0,
      End: all.length - 1,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      all[next]?.focus();
    } else if (event.key === "Escape") {
      // Handled here, so nothing around the menu, as Settings or a search, takes it too: listened
      // for on the menu itself, not delegated to the document, so stopping it stops it there.
      event.preventDefault();
      event.stopPropagation();
      putAway();
    } else if (event.key === "Tab") {
      // From its button, the focus moves on past the menu as it goes.
      putAway();
    }
  }

  return (
    <div
      ref={wrapper}
      class="menu"
      onFocusOut={(event) => {
        const to = event.relatedTarget as Node | null;
        if (shown() && to && !wrapper.contains(to)) setShown(false);
      }}
    >
      <button
        ref={button}
        type="button"
        class="icon-button"
        aria-label={props.label}
        title={props.label}
        aria-haspopup="menu"
        aria-expanded={shown()}
        aria-controls={shown() ? id : undefined}
        onClick={() => (shown() ? setShown(false) : show())}
      >
        <Dynamic component={props.icon} size={18} aria-hidden="true" />
      </button>
      <Show when={shown()}>
        <div
          ref={list}
          id={id}
          class="menu-list"
          popover="manual"
          role="menu"
          aria-label={props.label}
          on:keydown={onKeyDown}
        >
          <Index each={props.items}>
            {(item) => (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item().disabled}
                onClick={() => {
                  putAway();
                  item().onSelect();
                }}
              >
                <Dynamic component={item().icon} size={16} aria-hidden="true" />
                {item().label}
              </button>
            )}
          </Index>
        </div>
      </Show>
    </div>
  );
}

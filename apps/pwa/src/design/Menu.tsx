import type { LucideIcon } from "lucide-solid";
import { createEffect, createSignal, createUniqueId, Index, onCleanup, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

/** One action of a menu or a toolbar: its words, its icon, and what choosing it does. */
export type Action = {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
};

/**
 * A button that stands alone as an icon, named, with its tooltip saying the same (section 8.11),
 * opening a menu of actions under it. The menu takes the keyboard's focus as it opens, moves it
 * with the arrow keys, and goes on Escape, on Tab, on a choice or on a tap outside it, the focus
 * back on its button.
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

  function show() {
    setShown(true);
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

import type { ContextListing } from "@praxis/domain";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { createSignal, For, Show } from "solid-js";

/**
 * The Context switcher, in the top bar at every width (section 8.1). It names the current Context
 * in its accent and lists the others not retired. Switching changes what is shown and where new
 * records go; there is no combined view. While a Call goes on, its list says switching ends it.
 */
export function ContextSwitcher(props: {
  current: ContextListing;
  contexts: ContextListing[];
  /** As the list opens: in between, Attention is closed first (section 8.1). */
  onOpen: () => void;
  onSwitch: (id: string) => void;
  /** A Call goes on in the current Context, which switching ends (section 6). */
  callGoing: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  let toggle!: HTMLButtonElement;
  const shown = () => props.contexts.filter((context) => !context.retired);

  /**
   * Put the list away, with Escape from it or its button, and go back to the button. The Escape is
   * spent, so Settings, whose top bar the switcher is in too, stays open.
   */
  function putAway(event: KeyboardEvent) {
    if (event.key !== "Escape" || !open()) return;
    event.preventDefault();
    setOpen(false);
    toggle.focus();
  }

  function pick(id: string) {
    setOpen(false);
    toggle.focus();
    if (id !== props.current.id) props.onSwitch(id);
  }

  return (
    <div class="switcher">
      <button
        ref={toggle}
        type="button"
        class={`context accent-${props.current.accent}`}
        aria-expanded={open()}
        aria-controls="context-list"
        onClick={() => {
          if (!open()) props.onOpen();
          setOpen((was) => !was);
        }}
        onKeyDown={putAway}
      >
        <span class="visually-hidden">Context: </span>
        <span class="context-name">{props.current.name}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <ul id="context-list" class="context-list" aria-label="Contexts">
          <Show when={props.callGoing}>
            {/* Not a choice: each choice is described by it. */}
            <li id="switch-ends-call" class="switch-ends-call" aria-hidden="true">
              Switching ends the Call.
            </li>
          </Show>
          <For each={shown()}>
            {(context) => (
              <li>
                <button
                  type="button"
                  class="context-choice"
                  aria-current={context.id === props.current.id ? "true" : undefined}
                  aria-describedby={
                    props.callGoing && context.id !== props.current.id
                      ? "switch-ends-call"
                      : undefined
                  }
                  onClick={() => pick(context.id)}
                  onKeyDown={putAway}
                >
                  <span class={`swatch accent-${context.accent}`} aria-hidden="true" />
                  {context.name}
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

import Ellipsis from "lucide-solid/icons/ellipsis";
import { Index, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { type Action, Menu } from "./design/Menu.tsx";
import { pointerHovers } from "./media.ts";

/**
 * An Entry's actions, never shown as words with every Entry (section 8.4). Where the Device has a
 * pointer that hovers, the frequent ones are icon buttons in a toolbar at the Entry's top right,
 * the rest behind its More button, shown while the Entry is hovered or anything in it has the
 * focus. On a touch screen all of them are a menu behind one button.
 */
export function EntryActions(props: { frequent: Action[]; rest: Action[] }) {
  return (
    <Show
      when={pointerHovers()}
      fallback={
        <Menu
          label="Actions for this Entry"
          icon={Ellipsis}
          items={[...props.frequent, ...props.rest]}
        />
      }
    >
      <div class="entry-actions" role="toolbar" aria-label="Entry actions">
        <Index each={props.frequent}>
          {(action) => (
            <button
              type="button"
              class="icon-button"
              aria-label={action().label}
              title={action().label}
              disabled={action().disabled}
              onClick={() => action().onSelect()}
            >
              <Dynamic component={action().icon} size={16} aria-hidden="true" />
            </button>
          )}
        </Index>
        <Menu
          label={`More: ${props.rest.map((action) => action.label).join(", ")}`}
          icon={Ellipsis}
          items={props.rest}
        />
      </div>
    </Show>
  );
}

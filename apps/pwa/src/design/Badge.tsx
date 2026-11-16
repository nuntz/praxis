import { Show } from "solid-js";

/** A count as the Device's locale writes it. */
const countFormat = new Intl.NumberFormat();

/** A count in the Context's accent, shown only when there is something to count. */
export function Badge(props: { count: number; label: string }) {
  return (
    <Show when={props.count > 0}>
      <span class="badge">
        {countFormat.format(props.count)}
        <span class="visually-hidden"> {props.label}</span>
      </span>
    </Show>
  );
}

import type { LucideIcon } from "lucide-solid";
import { Show } from "solid-js";
import { Dynamic } from "solid-js/web";

/** A count as the Device's locale writes it. */
const countFormat = new Intl.NumberFormat();

/**
 * The heading of a section in a column, as Attention's are drawn (section 8.11): `muted`, its icon
 * before its name, and after the name how many it holds, where that is said, as for what a search
 * finds. The section is named by it, through its id.
 */
export function SectionTitle(props: {
  id: string;
  title: string;
  icon?: LucideIcon;
  count?: number;
}) {
  return (
    <h3 id={props.id} class="section-title">
      <Show when={props.icon}>
        {(icon) => <Dynamic component={icon()} size={16} aria-hidden="true" />}
      </Show>
      {props.title}
      <Show when={props.count !== undefined}>
        {" "}
        <span class="section-count">{countFormat.format(props.count ?? 0)}</span>
      </Show>
    </h3>
  );
}

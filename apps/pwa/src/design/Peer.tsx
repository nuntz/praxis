import type { JSX } from "solid-js";

/** The three peers, which are also a phone's three tabs. */
export type PeerId = "attention" | "journal" | "conversation";

/**
 * One of the three peers of the main screen (section 8.1): a panel on the ground, titled, with
 * what it holds beneath. None hosts another. Which ones show at a width is the screen's layout.
 */
export function Peer(props: {
  id: PeerId;
  title: string;
  /** Beside the title: a count, or what the column is about. */
  aside?: JSX.Element;
  onKeyDown?: (event: KeyboardEvent) => void;
  children?: JSX.Element;
}) {
  return (
    <section
      id={props.id}
      class={`peer ${props.id}`}
      aria-labelledby={`${props.id}-heading`}
      onKeyDown={(event) => props.onKeyDown?.(event)}
    >
      <header class="peer-header">
        <h2 id={`${props.id}-heading`} class="peer-title">
          {props.title}
        </h2>
        {props.aside}
      </header>
      {props.children}
    </section>
  );
}

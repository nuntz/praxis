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
  /** At the header's end, after the aside: Attention's Close, in between. */
  end?: JSX.Element;
  /**
   * Given, the heading takes the focus from code (`tabindex="-1"`), and is described by the aside,
   * so a screen reader reads the title and its count together: Attention's, as it opens in between.
   */
  headingRef?: (heading: HTMLHeadingElement) => void;
  /** The key that brings the heading the focus, declared on it: Attention's `a`. */
  headingKey?: "a" | undefined;
  /** Out of reach of Tab, a pointer and a screen reader, as under Attention opened in between. */
  inert?: boolean | undefined;
  onKeyDown?: (event: KeyboardEvent) => void;
  children?: JSX.Element;
}) {
  return (
    <section
      id={props.id}
      class={`peer ${props.id}`}
      aria-labelledby={`${props.id}-heading`}
      inert={props.inert}
      onKeyDown={(event) => props.onKeyDown?.(event)}
    >
      <header class="peer-header">
        <h2
          ref={(heading) => props.headingRef?.(heading)}
          id={`${props.id}-heading`}
          class="peer-title"
          tabIndex={props.headingRef ? -1 : undefined}
          aria-describedby={props.headingRef ? `${props.id}-aside` : undefined}
          aria-keyshortcuts={props.headingKey}
        >
          {props.title}
        </h2>
        <span id={`${props.id}-aside`} class="peer-aside">
          {props.aside}
        </span>
        {props.end}
      </header>
      {props.children}
    </section>
  );
}

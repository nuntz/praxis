import ArrowDownIcon from "lucide-solid/icons/arrow-down";
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";

/** Within this many pixels of its end, a column is at its newest. */
const NEAR_THE_END = 40;

/** A count as the Device's locale writes it. */
const countFormat = new Intl.NumberFormat();

/**
 * One column behaviour for the Journal and the Conversation (section 8.1): each keeps time order,
 * oldest first, and opens at its newest, beside its composer. At its newest it stays there as more
 * arrives. Scrolled away, it keeps the person's place and counts what arrived below, for a pill
 * above the composer that takes them back. The person's own send always brings it into view, and
 * older items added above keep what is in view where it was. Items are told apart by their ids, so
 * one patched in place is not counted as arriving.
 */
export function followNewest(options: {
  /** What the column shows, oldest first. */
  items: () => readonly { id: string }[];
  /**
   * Whether the column is held to its newest now: the Journal's search results are not, and keep
   * their own order, and the column goes back to where it was once they go.
   */
  anchored?: () => boolean;
}) {
  const anchored = options.anchored ?? (() => true);
  let scroller: HTMLElement | undefined;
  const [atNewest, setAtNewest] = createSignal(true);
  const [arrived, setArrived] = createSignal(0);
  // Where the person left the column, from its top, for when it is shown again: a column hidden,
  // as a phone's tab is, loses its place.
  let left = 0;
  let shownHeight = 0;

  function toEnd() {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  /** The person's own send, or the pill: the newest comes into view. */
  function toNewest() {
    setAtNewest(true);
    setArrived(0);
    toEnd();
  }

  /** Where the person scrolled to: at the newest, what arrived is seen. */
  function scrolled() {
    if (!scroller || scroller.clientHeight === 0 || !anchored()) return;
    left = scroller.scrollTop;
    const near = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= NEAR_THE_END;
    setAtNewest(near);
    if (near) setArrived(0);
  }

  /** The column or what it holds changed size: at its newest it stays there. */
  function resized() {
    if (!scroller) return;
    const wasHidden = shownHeight === 0;
    shownHeight = scroller.clientHeight;
    if (shownHeight === 0 || !anchored()) return;
    if (atNewest()) toEnd();
    else if (wasHidden) scroller.scrollTop = left;
  }

  const observer = new ResizeObserver(resized);
  onCleanup(() => observer.disconnect());

  // What arrived after the newest seen counts for the pill; what was added above, as earlier
  // pages are, does not. A column that held nothing opens at its newest.
  let seen = new Set<string>();
  createEffect(
    on(
      () => options.items().map((item) => item.id),
      (ids) => {
        const opening = seen.size === 0;
        let lastSeen = -1;
        ids.forEach((id, at) => {
          if (seen.has(id)) lastSeen = at;
        });
        const added = ids.slice(lastSeen + 1).filter((id) => !seen.has(id)).length;
        seen = new Set(ids);
        if (ids.length === 0) return;
        if (opening) return toNewest();
        if (atNewest()) {
          if (anchored()) toEnd();
        } else setArrived((count) => count + added);
      },
    ),
  );

  // The search gone, the column is back where it was.
  createEffect(
    on(anchored, (now) => {
      if (!now || !scroller) return;
      if (atNewest()) toEnd();
      else scroller.scrollTop = left;
    }),
  );

  /** The pill above the composer, while the column is scrolled away from what arrived. */
  function JumpToLatest() {
    return (
      <Show when={anchored() && arrived() > 0}>
        <button type="button" class="jump-to-latest" onClick={toNewest}>
          <ArrowDownIcon size={16} aria-hidden="true" />
          {countFormat.format(arrived())} new · Jump to latest
        </button>
      </Show>
    );
  }

  return {
    /** The column's scrolling element, as its `ref`. */
    scroller(element: HTMLElement) {
      scroller = element;
      element.addEventListener("scroll", scrolled, { passive: true });
      observer.observe(element);
    },
    /** What the column holds, as its `ref`, so a change in its size is seen. */
    content(element: HTMLElement) {
      observer.observe(element);
    },
    toNewest,
    /**
     * Add older items above, keeping what is in view where it was: the distance to the end stays
     * the same, as nothing below changed.
     */
    keepPlace(add: () => void) {
      if (!scroller) return add();
      const fromEnd = scroller.scrollHeight - scroller.scrollTop;
      add();
      scroller.scrollTop = scroller.scrollHeight - fromEnd;
    },
    JumpToLatest,
  };
}

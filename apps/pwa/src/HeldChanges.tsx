import { type Change, dayIn, type HeldChange } from "@praxis/domain";
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  useContext,
} from "solid-js";
import { Comparison } from "./Comparison.tsx";
import { todayIn } from "./days.tsx";
import { latestRead } from "./latest-read.ts";
import type { CurrentLive } from "./live-context.ts";
import { type CallTool, unreachableMessage } from "./tools.ts";

/**
 * A Held Change no longer waiting, said in its place until the person next acts: made, cancelled
 * or lapsed. `from` is the card shown for it that held the focus or was tapped, whose line then
 * takes the focus, or null.
 */
export type HeldEnded = { held: HeldChange; said: string; from: Element | null };

/**
 * What a Held Change's line says once it has gone, by the tool of the change that took it away: a
 * lapse is the Effect of whatever changed its Entry.
 */
function saidGone(tool: string): string {
  if (tool === "make_held_change") return "Made by your tap";
  if (tool === "cancel_held_change") return "Cancelled";
  return "Lapsed: its Entry changed";
}

/** Said where the person tapped one that lapsed before the screen heard. */
const LAPSED_UNHEARD = "That change no longer applies: its Entry changed";

/** Keys that only move the focus or scroll, which is no act of the person's on the screen. */
const MOVING_KEYS = new Set([
  "Tab",
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

/**
 * The Held Changes left for the person's tap in the current Context (section 4.7), read once for the whole screen:
 * Attention lists them first and counts them, the Journal marks their Entries, and the
 * Conversation shows each where the Agent left it.
 */
export type HeldChanges = {
  /** Every Held Change left for the tap, newest first. */
  all: () => HeldChange[];
  /**
   * Every Held Change shown, newest first: those left for the tap, and those made, cancelled or
   * lapsed since the person last acted, which are said in their place and never stored.
   */
  shown: () => HeldChange[];
  /** The Held Change with this id, while it is shown, left for the tap or said to have gone. */
  find: (id: string) => HeldChange | undefined;
  /** How a Held Change shown went, or undefined while it is still left for the tap. */
  ended: (id: string) => HeldEnded | undefined;
  /**
   * Make it, by the person's tap on the card `from`, or cancel it. Gives the problem to show, or
   * null.
   */
  decide: (held: HeldChange, how: "make" | "cancel", from: Element) => Promise<string | null>;
};

/**
 * Follow the Held Changes of a Context: read once the live channel is open, and read again on any
 * change to one, which the change that lapses one carries too, or when the screen reads afresh.
 */
export function followHeldChanges(callTool: CallTool, live: CurrentLive): HeldChanges {
  const [all, setAll] = createSignal<HeldChange[]>([]);
  const [ended, setEnded] = createSignal<ReadonlyMap<string, HeldEnded>>(new Map());

  /**
   * Say how one went, once: the first to tell it says it, and its card keeps its place. The card
   * the focus goes to may come later: a tap's own answer can follow the live channel's word of
   * it, which found no focus on the card where a tapped button takes none, as in Safari.
   */
  function end(held: HeldChange, said: string, from: Element | null) {
    const before = ended().get(held.id);
    if (before && (before.from !== null || from === null)) return;
    setEnded((shown) =>
      new Map(shown).set(held.id, before ? { ...before, from } : { held, said, from }),
    );
  }

  // The lines go when the person next acts: a press, once its click is done, so nothing moves
  // under it and a scroll is none, or a key that does more than move the focus or scroll.
  const forget = () => {
    if (ended().size > 0) setEnded(new Map());
  };
  const keyed = (event: KeyboardEvent) => {
    if (!MOVING_KEYS.has(event.key)) forget();
  };
  document.addEventListener("click", forget, true);
  document.addEventListener("keydown", keyed, true);
  onCleanup(() => {
    document.removeEventListener("click", forget, true);
    document.removeEventListener("keydown", keyed, true);
  });

  // The last read wins, and a tap made while a read was out reads again.
  const listed = latestRead(async (current) => {
    try {
      // A Held Change waits for a tap, so there are seldom more than a page of them; every page is
      // read, since all of them are shown and counted.
      const items: HeldChange[] = [];
      let cursor: string | null | undefined;
      do {
        const result = await callTool("list_held_changes", cursor ? { cursor } : {});
        if (!current() || !result.ok) return;
        items.push(...result.value.items);
        cursor = result.value.next_cursor;
      } while (cursor);
      // A Held Change never changes while it waits, so one shown already keeps its showing.
      const before = new Map(all().map((held) => [held.id, held]));
      setAll(items.map((held) => before.get(held.id) ?? held));
    } catch {
      // Unreachable: the next change or reconnection reads again.
    }
  });
  const read = () => listed.read();

  const changed = async (change: Change) => {
    const effects = change.effects.filter((effect) => effect.kind === "held_change");
    if (effects.length === 0) return;
    for (const effect of effects) {
      const held = all().find((each) => each.id === effect.id);
      if (effect.what !== "deleted" || !held) continue;
      end(held, saidGone(change.tool), cardHolding(held.id, document.activeElement));
    }
    await read();
  };
  onCleanup(live.listen({ changed, readAfresh: read }));
  void live.ready.then(read);

  const shown = createMemo(() => {
    const waiting = all();
    const gone = [...ended().values()]
      .map((each) => each.held)
      .filter((held) => !waiting.some((each) => each.id === held.id));
    // Newest first, as the tool lists them; one gone keeps its place among them.
    return [...waiting, ...gone].sort((a, b) => b.at.localeCompare(a.at));
  });

  return {
    all,
    shown,
    find: (id) => shown().find((held) => held.id === id),
    ended: (id) => ended().get(id),
    async decide(held, how, from) {
      const tool = how === "make" ? "make_held_change" : "cancel_held_change";
      try {
        const result = await callTool(tool, { id: held.id });
        // The line takes the focus where the person tapped, unless they took it elsewhere since.
        const at = document.activeElement;
        const focus = at === null || at === document.body || from.contains(at) ? from : null;
        if (!result.ok) {
          if (result.error.code !== "not_found") return result.error.message;
          // It lapsed before the screen heard: said where it was tapped, and read again.
          end(held, LAPSED_UNHEARD, focus);
          await read();
          return null;
        }
        end(held, saidGone(tool), focus);
        // Gone at once. A read already out answers from before the tap, so it is sent again.
        listed.changed();
        setAll((waiting) => waiting.filter((each) => each.id !== held.id));
        return null;
      } catch (error) {
        return unreachableMessage(error);
      }
    },
  };
}

/** The card for this Held Change that holds the focus, if any does. */
function cardHolding(id: string, focused: Element | null): Element | null {
  const card = focused?.closest("[data-held-change]") ?? null;
  return card?.getAttribute("data-held-change") === id ? card : null;
}

export const CurrentHeldChanges = createContext<HeldChanges>();

export function useHeldChanges(): HeldChanges {
  const held = useContext(CurrentHeldChanges);
  if (!held) throw new Error("Shown outside any Context");
  return held;
}

/** Where a Held Change is in Attention, for the marker on its Entry to lead to. */
export function heldAnchor(id: string): string {
  return `held-${id}`;
}

/**
 * One Held Change: what the tap would do to which Entry, who asked and when, and the tap that
 * makes it or cancels it. An edit compares the words now with those the tap brings, as typed and
 * never rendered (section 8.4), with the Tasks it would make; a delete shows the words and the
 * Tasks that would go with them. Once made, cancelled or lapsed, a line says so in its place.
 */
export function HeldChangeItem(props: {
  held: HeldChange;
  /** The zone the Context's times are shown in. */
  timeZone: string | undefined;
  anchor?: string;
}) {
  const heldChanges = useHeldChanges();
  const [sending, setSending] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const ended = () => heldChanges.ended(props.held.id);
  let card!: HTMLElement;

  async function decide(how: "make" | "cancel") {
    if (sending()) return;
    setSending(true);
    setProblem(await heldChanges.decide(props.held, how, card));
    setSending(false);
  }

  return (
    <Show
      when={ended()}
      fallback={
        <section
          ref={card}
          class="held-change"
          id={props.anchor}
          data-held-change={props.held.id}
          tabIndex={props.anchor ? -1 : undefined}
          aria-label={`Held Change: ${props.held.summary}`}
        >
          <p class="held-change-title">
            {props.held.summary}: “{props.held.entry.summary}”
          </p>
          {/* Only the Agent leaves one (ADR 0005). */}
          <p class="held-change-asked">
            Asked by the Agent,{" "}
            <time datetime={props.held.at}>{askedAt(props.held.at, props.timeZone)}</time>
          </p>
          <Show
            when={props.held.after}
            fallback={
              <>
                <p class="held-change-label">The Entry</p>
                <p class="held-change-words" data-testid="held-words">
                  {props.held.before}
                </p>
                <p class="held-change-note">
                  The Entry goes to the Trash, where it can be restored
                </p>
              </>
            }
          >
            {(after) => (
              <>
                <p class="held-change-label">What your tap changes</p>
                <Comparison now={props.held.before} brought={after()} />
              </>
            )}
          </Show>
          <Show when={props.held.new_tasks.length > 0}>
            <p class="held-change-label">Makes these Tasks</p>
            <ul class="held-change-tasks">
              <For each={props.held.new_tasks}>{(task) => <li>{task.title}</li>}</For>
            </ul>
          </Show>
          <Show when={props.held.goes_with.length > 0}>
            <p class="held-change-label">These Tasks go to the Trash with it</p>
            <ul class="held-change-tasks">
              <For each={props.held.goes_with}>{(task) => <li>{task.summary}</li>}</For>
            </ul>
          </Show>
          <div class="held-change-actions">
            {/* Only said to be disabled while a tap is out, so the button keeps the focus. */}
            <button
              type="button"
              aria-disabled={sending() ? "true" : undefined}
              onClick={() => void decide("make")}
            >
              {props.held.after === null ? "Delete it" : "Make this change"}
            </button>
            <button
              type="button"
              class="quiet"
              aria-disabled={sending() ? "true" : undefined}
              onClick={() => void decide("cancel")}
            >
              Cancel
            </button>
          </div>
          <Show when={problem()}>
            {(message) => (
              <p class="problem" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </section>
      }
    >
      {(gone) => <GoneLine gone={gone()} card={card} anchor={props.anchor} />}
    </Show>
  );
}

/**
 * The line said in a Held Change's place once it has gone. It takes the focus where `card` is the
 * one the person tapped, or held the focus as it lapsed, whenever the store comes to know it.
 */
function GoneLine(props: {
  gone: HeldEnded;
  card: Element | undefined;
  anchor: string | undefined;
}) {
  let line!: HTMLParagraphElement;
  createEffect(
    on(
      () => props.gone.from,
      (from) => {
        if (from !== null && from === props.card) line.focus();
      },
    ),
  );
  return (
    <p class="held-change-said" role="status" tabIndex={-1} id={props.anchor} ref={line}>
      {props.gone.said}
    </p>
  );
}

/** When the Agent asked: the time of day, with the date too on any day but today. */
function askedAt(at: string, zone: string | undefined): string {
  const timeZone = zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dayIn(Date.parse(at), timeZone) === todayIn(timeZone);
  return new Intl.DateTimeFormat(
    undefined,
    today
      ? { timeStyle: "short", timeZone }
      : { dateStyle: "medium", timeStyle: "short", timeZone },
  ).format(new Date(at));
}

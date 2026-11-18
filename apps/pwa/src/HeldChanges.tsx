import type { Change, HeldChange } from "@praxis/domain";
import { createContext, createSignal, For, onCleanup, Show, useContext } from "solid-js";
import { latestRead } from "./latest-read.ts";
import type { CurrentLive } from "./live-context.ts";
import { type CallTool, unreachableMessage } from "./tools.ts";

/**
 * The Held Changes left for the person's tap in the current Context (section 4.7), read once for the whole screen:
 * Attention lists them first and counts them, the Journal marks their Entries, and the
 * Conversation shows each where the Agent left it.
 */
export type HeldChanges = {
  /** Every Held Change left for the tap, newest first. */
  all: () => HeldChange[];
  /** The Held Change with this id, while it is still there to tap. */
  find: (id: string) => HeldChange | undefined;
  /** Make it, by the person's tap, or cancel it. Gives the problem to show, or null. */
  decide: (held: HeldChange, how: "make" | "cancel") => Promise<string | null>;
};

/**
 * Follow the Held Changes of a Context: read once the live channel is open, and read again on any
 * change to one, which the change that lapses one carries too, or when the screen reads afresh.
 */
export function followHeldChanges(callTool: CallTool, live: CurrentLive): HeldChanges {
  const [all, setAll] = createSignal<HeldChange[]>([]);
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
      setAll(items);
    } catch {
      // Unreachable: the next change or reconnection reads again.
    }
  });
  const read = () => listed.read();

  const changed = async (change: Change) => {
    if (change.effects.some((effect) => effect.kind === "held_change")) await read();
  };
  onCleanup(live.listen({ changed, readAfresh: read }));
  void live.ready.then(read);

  return {
    all,
    find: (id) => all().find((held) => held.id === id),
    async decide(held, how) {
      try {
        const result = await callTool(how === "make" ? "make_held_change" : "cancel_held_change", {
          id: held.id,
        });
        if (!result.ok) {
          // One that lapsed meanwhile is gone: read again, so it is no longer shown.
          if (result.error.code === "not_found") await read();
          return result.error.message;
        }
        // Gone at once. A read already out answers from before the tap, so it is sent again.
        listed.changed();
        setAll((shown) => shown.filter((each) => each.id !== held.id));
        return null;
      } catch (error) {
        return unreachableMessage(error);
      }
    },
  };
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
 * One Held Change: what the tap would do to which Entry, its words before and after as typed and
 * never rendered (section 8.4), the Tasks an edit would make and a delete would take, and the tap
 * that makes it or cancels it.
 */
export function HeldChangeItem(props: { held: HeldChange; anchor?: string }) {
  const heldChanges = useHeldChanges();
  const [sending, setSending] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  async function decide(how: "make" | "cancel") {
    setSending(true);
    setProblem(await heldChanges.decide(props.held, how));
    setSending(false);
  }

  return (
    <section
      class="held-change"
      id={props.anchor}
      tabIndex={props.anchor ? -1 : undefined}
      aria-label={`Held Change: ${props.held.summary}`}
    >
      <p class="held-change-title">
        {props.held.summary}: “{props.held.entry.summary}”
      </p>
      <p class="held-change-label">{props.held.after === null ? "The Entry" : "Now"}</p>
      <p class="held-change-words" data-testid="held-before">
        {props.held.before}
      </p>
      <Show when={props.held.after}>
        {(after) => (
          <>
            <p class="held-change-label">After your tap</p>
            <p class="held-change-words" data-testid="held-after">
              {after()}
            </p>
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
        <button type="button" disabled={sending()} onClick={() => void decide("make")}>
          {props.held.after === null ? "Delete it" : "Make this change"}
        </button>
        <button
          type="button"
          class="quiet"
          disabled={sending()}
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
  );
}

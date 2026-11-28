import type { ToolResult } from "@praxis/domain";
import { createEffect, createSignal, createUniqueId, on, onCleanup, Show } from "solid-js";
import { SignInLapsed, Unreachable } from "./tools.ts";

/** What the screen says when what was marked could not be sent as its section was left. */
export type Unsent = {
  /** None of it reached Praxis. */
  nothing: string;
  /** Some of it did not, where more than one act can be marked. */
  notAll?: string;
};

/** One act marked, as it is sent: the tool's call. */
export type MarkedSend = () => Promise<ToolResult<unknown>>;

/**
 * The marks of a section of Settings whose acts cannot be put back (ADR 0027, ADR 0028): a tap
 * marks what it would do and sends nothing, and what is marked is sent as the section closes, by
 * another section opened, the phone's list of sections opened, Settings closed or the Context
 * switched, since each of these takes the section off the screen. The app hidden or killed sends
 * nothing. Each mark is the person's to take off meanwhile. `sends` says what to send of what is
 * marked as it closes, which may hold more than the marks, as emptying the Trash does.
 */
export function marksSentOnLeaving<K>(options: {
  sends: (marked: ReadonlySet<K>) => MarkedSend[];
  unsent: Unsent;
  /** Says what the screen must say once the section is no longer shown to say it. */
  onProblem: (message: string) => void;
}) {
  const [marked, setMarked] = createSignal<ReadonlySet<K>>(new Set());
  onCleanup(() => {
    const sends = options.sends(marked());
    if (sends.length > 0) void sendMarked(sends, options.unsent, options.onProblem);
  });
  return {
    /** Whether `key` is marked. */
    has: (key: K) => marked().has(key),
    /** Whether anything is marked. */
    any: () => marked().size > 0,
    /** Mark `key`, or take its mark off. */
    mark(key: K, on: boolean) {
      setMarked((was) => {
        const now = new Set(was);
        if (on) now.add(key);
        else now.delete(key);
        return now;
      });
    },
    /** Take every mark off. */
    clear: () => setMarked(new Set<K>()),
  };
}

/**
 * Send what was marked, as its section is left. A mark that cannot be sent does nothing, and the
 * screen says so; one whose record has gone meanwhile is not found and says nothing, since what
 * is so already holds. Any other refusal is said as the tool words it.
 */
async function sendMarked(
  sends: MarkedSend[],
  unsent: Unsent,
  onProblem: (message: string) => void,
) {
  const sent = await Promise.allSettled(sends.map((send) => send()));
  const unreached = sent.filter(
    (each) => each.status === "rejected" && each.reason instanceof Unreachable,
  ).length;
  if (unreached > 0) {
    onProblem(unreached === sent.length ? unsent.nothing : (unsent.notAll ?? unsent.nothing));
  }
  for (const each of sent) {
    if (each.status === "fulfilled") {
      if (!each.value.ok && each.value.error.code !== "not_found") {
        onProblem(each.value.error.message);
      }
    } else if (!(each.reason instanceof Unreachable || each.reason instanceof SignInLapsed)) {
      // A lapsed sign-in says so on the screen already; anything else is a fault.
      throw each.reason;
    }
  }
}

/**
 * Marking puts the focus on Keep it (ADR 0028): the `keepRef` to give the `MarkedLine` drawn while
 * `marked` holds, which takes the focus as `marked` comes to hold, once the line is drawn, and not
 * when a line is drawn marked already, as a row read again is.
 */
export function focusOnMarking(marked: () => boolean): (button: HTMLButtonElement) => void {
  let keep: HTMLButtonElement | undefined;
  createEffect(
    on(
      marked,
      (now) => {
        if (now) keep?.focus();
      },
      { defer: true },
    ),
  );
  return (button) => {
    keep = button;
  };
}

/**
 * What a marked act will do and when, as its row reads it, beside a Keep it that takes the mark
 * off, which `focusOnMarking` gives the focus as it is marked, and which gives it back to what
 * marked it. One marked only with others, as by emptying the Trash, has no Keep it of its own; the
 * line for all of them keeps them (`keep`).
 */
export function MarkedLine(props: {
  says: string;
  /** The id of what names the thing marked, which Keep it is described by too. */
  of?: string;
  /** Take the mark off, the focus back where it was marked from. */
  onKeep?: (() => void) | undefined;
  keepRef?: (button: HTMLButtonElement) => void;
  /** What Keep it says: "Keep them", for the line of all that is marked. */
  keep?: string;
}) {
  const saysId = createUniqueId();
  return (
    <p class="marked">
      <span id={saysId}>{props.says}</span>
      <Show when={props.onKeep}>
        {(keep) => (
          <>
            {" "}
            <button
              ref={(button) => props.keepRef?.(button)}
              type="button"
              class="quiet"
              aria-describedby={props.of === undefined ? saysId : `${saysId} ${props.of}`}
              onClick={() => keep()()}
            >
              {props.keep ?? "Keep it"}
            </button>
          </>
        )}
      </Show>
    </p>
  );
}

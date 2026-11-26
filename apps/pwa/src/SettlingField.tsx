import { createEffect, on, onCleanup } from "solid-js";

/** How long a picked day or time stays as it is before it is sent, unless its field is left sooner. */
export const SETTLES_MS = 700;

/**
 * A day's or a time's field, sent once it is left or what is in it has stayed as it is a moment:
 * typed by keyboard, a date changes at each keystroke of its year, through days nobody meant.
 *
 * What is in the field is the person's while it has the focus, or holds what was picked and is not
 * yet answered: a record read again meanwhile shows its value only in a field left alone, so a read
 * landing mid-date never takes the typing back. A date half typed fires no event, so the focus is
 * what says it is being typed. Bound with `value={…}`, the field would be written over at each read
 * (`lint/bound-field.grit`). Kept or refused, once answered and left, the field shows the record's
 * value as it now is.
 */
export function SettlingField(props: {
  type: "date" | "time";
  /** The record's value, or null for none. */
  value: string | null;
  id?: string | undefined;
  overdue?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Sent with what the field settled on, "" once emptied, unless the record holds it already. */
  onSettle: (value: string) => Promise<unknown>;
}) {
  let input!: HTMLInputElement;
  let settling: ReturnType<typeof setTimeout> | undefined;
  let picked: string | null = null;
  let answering = 0;
  /** Whether the record's value changed while the field was not left alone, and is not shown. */
  let behind = false;

  /** The record's value, in the field if it is left alone. */
  function show() {
    if (picked !== null || answering > 0 || document.activeElement === input) {
      behind = true;
      return;
    }
    input.value = props.value ?? "";
    behind = false;
  }
  createEffect(on(() => props.value, show));

  async function send() {
    clearTimeout(settling);
    if (picked === null) return;
    const value = picked;
    picked = null;
    // What the record holds already is not sent, unless a pick before it is still out: the record
    // then holds what this one takes back.
    if (answering === 0 && value === (props.value ?? "")) return;
    answering += 1;
    try {
      await props.onSettle(value);
    } finally {
      answering -= 1;
      show();
    }
  }
  onCleanup(() => void send());

  return (
    <input
      ref={input}
      type={props.type}
      id={props.id}
      classList={{ overdue: props.overdue }}
      disabled={props.disabled}
      onChange={(event) => {
        picked = event.currentTarget.value;
        clearTimeout(settling);
        settling = setTimeout(() => void send(), SETTLES_MS);
      }}
      onBlur={() => {
        void send();
        // A task later, past a change a browser fires after leaving, as a phone's picker may: the
        // field catches up only on what it was not shown.
        if (behind) setTimeout(show);
      }}
    />
  );
}

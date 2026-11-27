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
 *
 * A pick still settling as the field goes, with its page, is sent once the page has gone, for the
 * record the page's `onSettle` names: by then the page's record may read as stale, and the screen
 * may show another (#162).
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
  /** The record's value as last read, which the field can still compare with once it is gone. */
  let recorded = "";
  let gone = false;

  /** The record's value, in the field if it is left alone. */
  function show() {
    if (gone) return;
    recorded = props.value ?? "";
    if (picked !== null || answering > 0 || document.activeElement === input) {
      behind = true;
      return;
    }
    input.value = recorded;
    behind = false;
    showEmpty();
  }
  createEffect(on(() => props.value, show));

  /** Whether the field holds no day or time, so its placeholder is drawn muted (styles.css). */
  function showEmpty() {
    input.classList.toggle("empty", input.value === "");
  }

  async function send(settle = props.onSettle) {
    clearTimeout(settling);
    if (picked === null) return;
    const value = picked;
    picked = null;
    // What the record holds already is not sent, unless a pick before it is still out: the record
    // then holds what this one takes back.
    if (answering === 0 && value === recorded) return;
    answering += 1;
    try {
      await settle(value);
    } finally {
      answering -= 1;
      show();
    }
  }
  onCleanup(() => {
    gone = true;
    // Sent once the page is gone: sending as it goes would change the screen while it is taken
    // down, which throws and leaves the page shown.
    const settle = props.onSettle;
    queueMicrotask(() => void send(settle));
  });

  return (
    <input
      ref={input}
      type={props.type}
      id={props.id}
      classList={{ overdue: props.overdue }}
      disabled={props.disabled}
      onInput={showEmpty}
      onChange={(event) => {
        const field = event.currentTarget;
        showEmpty();
        clearTimeout(settling);
        // A part of a day erased empties the field's value as emptying it all does, but it is a
        // day half there, not none: nothing is picked until it is whole or empty (#162).
        if (field.value === "" && field.validity.badInput) {
          picked = null;
          return;
        }
        picked = field.value;
        settling = setTimeout(() => void send(), SETTLES_MS);
      }}
      onBlur={() => {
        // A field taken away with its page may be left as it goes: the cleanup sends for it.
        if (gone) return;
        void send();
        // A task later, past a change a browser fires after leaving, as a phone's picker may: the
        // field catches up on what it was not shown, or from a day left half there.
        if (behind || input.validity.badInput) setTimeout(show);
      }}
    />
  );
}

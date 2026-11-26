import { createEffect, on } from "solid-js";

/**
 * A text field that shows its record's value while nothing has been typed in it, as a name's
 * field in Settings does. What is typed is the person's until it is sent: a record read again
 * meanwhile never takes it back, as a field bound with `value={…}` would at each read
 * (`lint/bound-field.grit`). `typed` is called as the person types: typed back to the record's value, the
 * field follows it again. `send` sends what was typed,
 * and once it is answered, kept or refused, the field shows the record's value as it now is,
 * unless typed in again meanwhile.
 */
export function followRecord(field: () => HTMLInputElement, value: () => string) {
  let typed = false;
  createEffect(
    on(value, (now) => {
      if (!typed) field().value = now;
    }),
  );
  return {
    typed() {
      typed = field().value !== value();
    },
    async send<T>(write: () => Promise<T>): Promise<T> {
      typed = false;
      try {
        return await write();
      } finally {
        if (!typed) field().value = value();
      }
    },
  };
}

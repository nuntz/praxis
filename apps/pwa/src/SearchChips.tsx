import type { Day } from "@praxis/domain";
import { createSignal, For } from "solid-js";
import { daysSaid, todayIn } from "./days.tsx";
import { Chip, type ChipHeld } from "./design/Chip.tsx";
import { LAST_DAYS, lastDaysSaid, type Narrowing, type TimeNarrowing } from "./narrowing.ts";

/**
 * The chips under the search field (section 8.4), in the order time, Project, Person, Author,
 * each setting or lifting one field of the search's narrowing. Its days are the Context's.
 */
export function SearchChips(props: {
  narrowing: Narrowing;
  onNarrow: (narrowing: Narrowing) => void;
  /** The Context's time zone, which today is reckoned in. */
  timeZone: string;
}) {
  const today = () => todayIn(props.timeZone);
  const narrow = (changed: Partial<Narrowing>) =>
    props.onNarrow({ ...props.narrowing, ...changed });
  return (
    <fieldset class="search-chips" aria-label="Narrow the search">
      <Chip
        name="Time"
        label="Any time"
        held={timeHeld(props.narrowing.time, today())}
        onLift={() => narrow({ time: null })}
        picker={(putAway) => (
          <TimePicker
            today={today()}
            onPick={(time) => {
              putAway();
              narrow({ time });
            }}
          />
        )}
      />
      {/* #122 adds the Project chip, #123 the Person chip and #124 the Author chip, in that order. */}
    </fieldset>
  );
}

/** What the time chip says it holds, or null while it is not set. */
function timeHeld(time: TimeNarrowing | null, today: Day): ChipHeld | null {
  if (time === null) return null;
  const said = time.kind === "last" ? lastDaysSaid(time.days) : daysSaid(time.from, time.to, today);
  return { shown: said, named: said };
}

/**
 * The time chip's picker: any time, the presets up to today, and a range of days, its two ends
 * named fields, the first on or before the last and neither after today.
 */
function TimePicker(props: { today: Day; onPick: (time: TimeNarrowing | null) => void }) {
  const [from, setFrom] = createSignal("");
  const [to, setTo] = createSignal("");
  return (
    <>
      <ul class="chip-choices">
        <li>
          <button type="button" onClick={() => props.onPick(null)}>
            Any time
          </button>
        </li>
        <For each={LAST_DAYS}>
          {(days) => (
            <li>
              <button type="button" onClick={() => props.onPick({ kind: "last", days })}>
                {lastDaysSaid(days)}
              </button>
            </li>
          )}
        </For>
      </ul>
      <form
        class="chip-range"
        aria-label="A range of days"
        onSubmit={(event) => {
          event.preventDefault();
          props.onPick({ kind: "range", from: from(), to: to() });
        }}
      >
        <label>
          From
          <input
            type="date"
            required
            max={to() || props.today}
            value={from()}
            onInput={(event) => setFrom(event.currentTarget.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            required
            min={from() || undefined}
            max={props.today}
            value={to()}
            onInput={(event) => setTo(event.currentTarget.value)}
          />
        </label>
        <button type="submit">Search these days</button>
      </form>
    </>
  );
}

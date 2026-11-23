import type { Day } from "@praxis/domain";
import Folder from "lucide-solid/icons/folder";
import { createSignal, For } from "solid-js";
import { daysSaid, todayIn } from "./days.tsx";
import { Chip, type ChipHeld } from "./design/Chip.tsx";
import {
  LAST_DAYS,
  lastDaysSaid,
  type Narrowing,
  type RecordNarrowing,
  type TimeNarrowing,
} from "./narrowing.ts";
import { ChoicePicker, referencesOffered } from "./Pickers.tsx";
import { useCallTool, useContextId } from "./tools.ts";

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
      <Chip
        name="Project"
        label="Project"
        icon={props.narrowing.project === null ? undefined : Folder}
        held={recordHeld("Project", props.narrowing.project)}
        onLift={() => narrow({ project: null })}
        picker={(putAway) => (
          <ProjectPicker
            onPick={(project) => {
              putAway();
              narrow({ project });
            }}
          />
        )}
      />
      {/* #123 adds the Person chip and #124 the Author chip, in that order. */}
    </fieldset>
  );
}

/** What a chip that narrows to a record says it holds: its name, or null while it is not set. */
function recordHeld(chip: string, record: RecordNarrowing | null): ChipHeld | null {
  return record === null ? null : { shown: record.name, named: `${chip}: ${record.name}` };
}

/**
 * The Project chip's picker: the composer's `#` picker, offering Projects alone, the Finished and
 * Dropped ones among them, marked as such, and never making a new one.
 */
function ProjectPicker(props: { onPick: (project: RecordNarrowing) => void }) {
  const callTool = useCallTool();
  const contextId = useContextId();
  return (
    <ChoicePicker
      label="Projects"
      fieldLabel="Find a Project"
      none="No Project is named so."
      offer={(typed) => referencesOffered(callTool, contextId, typed, "projects")}
      onPick={(choice) => {
        if (choice.to.kind === "project") props.onPick({ id: choice.to.id, name: choice.name });
      }}
    />
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

import type { Connection, Day } from "@praxis/domain";
import Folder from "lucide-solid/icons/folder";
import { createSignal, For, onMount, Show } from "solid-js";
import { todayIn } from "./days.tsx";
import { Chip, type ChipHeld } from "./design/Chip.tsx";
import {
  type AuthorNarrowing,
  authorSaid,
  LAST_DAYS,
  lastDaysSaid,
  type Narrowing,
  type RecordNarrowing,
  type TimeNarrowing,
  timeSaid,
} from "./narrowing.ts";
import { ChoicePicker, referencesOffered } from "./Pickers.tsx";
import { callDeploymentTool, useCallTool, useContextId } from "./tools.ts";

/**
 * The chips under the search field (section 8.4), in the order time, Project, Person, Author,
 * each setting or lifting one field of the search's narrowing. Its days are the Context's.
 */
export function SearchChips(props: {
  narrowing: Narrowing;
  onNarrow: (narrowing: Narrowing) => void;
  /** The Context's time zone, which today is reckoned in. */
  timeZone: string;
  /** Shown but not usable, as offline. */
  disabled: boolean;
}) {
  const today = () => todayIn(props.timeZone);
  const narrow = (changed: Partial<Narrowing>) =>
    props.onNarrow({ ...props.narrowing, ...changed });
  return (
    <fieldset class="search-chips" aria-label="Narrow the search" disabled={props.disabled}>
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
      {/* #123 adds the Person chip here, before the Author's. */}
      <Chip
        name="Author"
        label="Author"
        held={authorHeld(props.narrowing.author)}
        onLift={() => narrow({ author: null })}
        picker={(putAway) => (
          <AuthorPicker
            onPick={(author) => {
              putAway();
              narrow({ author });
            }}
          />
        )}
      />
    </fieldset>
  );
}

/** What the Author chip says it holds, "By Claude Code", or null while it is not set. */
function authorHeld(author: AuthorNarrowing | null): ChipHeld | null {
  if (author === null) return null;
  const said = authorSaid(author);
  return { shown: `By ${said}`, named: `Author: ${said}` };
}

/** A Connection the Author chip offers by its name, and whether every one so named has ended. */
type NamedConnection = { name: string; ended: boolean };

/**
 * The Author chip's picker: you, the Agent, any Connection, and each Connection of this Context by
 * its name, in the order they were made, an ended one too, marked so, since its name stays on what
 * it made. A name two Connections share is offered once, as the search finds it by its name.
 */
function AuthorPicker(props: { onPick: (author: AuthorNarrowing) => void }) {
  const contextId = useContextId();
  const [connections, setConnections] = createSignal<NamedConnection[]>([]);
  onMount(async () => {
    try {
      const listed = await callDeploymentTool("list_connections", { ended: true });
      if (listed.ok) setConnections(namedOnce(listed.value.items, contextId));
    } catch {
      // Unreached, the picker offers the Authors that need no list.
    }
  });
  const choice = (label: string, author: AuthorNarrowing) => (
    <li>
      <button type="button" onClick={() => props.onPick(author)}>
        {label}
      </button>
    </li>
  );
  return (
    <ul class="chip-choices">
      {choice("You", { kind: "person" })}
      {choice("The Agent", { kind: "agent" })}
      {choice("Any Connection", { kind: "connection" })}
      <For each={connections()}>
        {(connection) => (
          <li>
            <button
              type="button"
              onClick={() => props.onPick({ kind: "connection", name: connection.name })}
            >
              {connection.name}
              <Show when={connection.ended}>
                <span class="choice-detail"> · Ended</span>
              </Show>
            </button>
          </li>
        )}
      </For>
    </ul>
  );
}

/** A Context's Connections by name, each name once, where it first came, ended if all so named are. */
function namedOnce(connections: Connection[], contextId: string): NamedConnection[] {
  const named = new Map<string, NamedConnection>();
  for (const { name, context_id, ended } of connections) {
    if (context_id !== contextId) continue;
    const earlier = named.get(name);
    named.set(name, { name, ended: ended && (earlier?.ended ?? true) });
  }
  return [...named.values()];
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
  const said = timeSaid(time, today);
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

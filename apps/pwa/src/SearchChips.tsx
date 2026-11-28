import type { Connection, Day } from "@praxis/domain";
import type { LucideIcon } from "lucide-solid";
import Folder from "lucide-solid/icons/folder";
import User from "lucide-solid/icons/user";
import { createSignal, For, type JSX, onMount, Show } from "solid-js";
import { todayIn } from "./days.tsx";
import { Chip } from "./design/Chip.tsx";
import {
  type AuthorNarrowing,
  CHIPS,
  chipSaid,
  LAST_DAYS,
  lastDaysSaid,
  lifted,
  type Narrowing,
  type RecordNarrowing,
  type TimeNarrowing,
} from "./narrowing.ts";
import { ChoicePicker, personsOffered, referencesOffered } from "./Pickers.tsx";
import { callDeploymentTool, useCallTool, useContextId } from "./tools.ts";

/**
 * The chips under the search field (section 8.4), in the narrowing's order, time, Project, Person,
 * Author, each setting or lifting one field of the search's narrowing. Its days are the Context's.
 */
export function SearchChips(props: {
  narrowing: Narrowing;
  onNarrow: (narrowing: Narrowing) => void;
  /** The Context's time zone, which today is reckoned in. */
  timeZone: string;
  /** Shown but not usable, as offline. */
  disabled: boolean;
}) {
  return (
    <fieldset class="search-chips" aria-label="Narrow the search" disabled={props.disabled}>
      <For each={CHIPS}>
        {(chip) => (
          <NarrowingChip
            chip={chip}
            narrowing={props.narrowing}
            onNarrow={props.onNarrow}
            timeZone={props.timeZone}
          />
        )}
      </For>
    </fieldset>
  );
}

/** What a chip's picker is given: today in the Context, its zone, and what to do with a pick. */
type PickerProps<Chip extends keyof Narrowing> = {
  today: Day;
  timeZone: string;
  onPick: (held: Narrowing[Chip]) => void;
};

/** How each chip is drawn: what it narrows by, what it says while not set, its icon and picker. */
const DRAWN: {
  [Chip in keyof Narrowing]: {
    /** What the chip narrows by, which names its picker. */
    name: string;
    /** What it says while not set. */
    label: string;
    /** Before what it holds once set, for a chip that has one. */
    icon?: LucideIcon;
    picker: (props: PickerProps<Chip>) => JSX.Element;
  };
} = {
  time: { name: "Time", label: "Any time", picker: (props) => <TimePicker {...props} /> },
  project: {
    name: "Project",
    label: "Project",
    icon: Folder,
    picker: (props) => <RecordPicker kind="project" {...props} />,
  },
  person: {
    name: "Person",
    label: "Person",
    icon: User,
    picker: (props) => <RecordPicker kind="person" {...props} />,
  },
  author: { name: "Author", label: "Author", picker: (props) => <AuthorPicker {...props} /> },
};

/** One chip of the row: set, it says what it holds, and one tap lifts it; not set, its picker. */
function NarrowingChip<C extends keyof Narrowing>(props: {
  chip: C;
  narrowing: Narrowing;
  onNarrow: (narrowing: Narrowing) => void;
  timeZone: string;
}) {
  const drawn = DRAWN[props.chip];
  const today = () => todayIn(props.timeZone);
  const said = () => chipSaid(props.chip, props.narrowing, today());
  return (
    <Chip
      name={drawn.name}
      label={drawn.label}
      icon={said() === null ? undefined : drawn.icon}
      held={said()}
      onLift={() => props.onNarrow(lifted(props.narrowing, props.chip))}
      picker={(putAway) =>
        drawn.picker({
          get today() {
            return today();
          },
          timeZone: props.timeZone,
          onPick: (held) => {
            putAway();
            props.onNarrow({ ...props.narrowing, [props.chip]: held });
          },
        })
      }
    />
  );
}

/** A Connection the Author chip offers by its name, and whether every one so named has ended. */
type NamedConnection = { name: string; ended: boolean };

/**
 * The Author chip's picker: you, the Agent, any Connection, and each Connection of this Context by
 * its name, in the order they were made, an ended one too, marked so, since its name stays on what
 * it made. A name two Connections share is offered once, as the search finds it by its name.
 */
function AuthorPicker(props: PickerProps<"author">) {
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
              <span dir="auto">{connection.name}</span>
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

/** What a record chip calls its kind of record. */
const RECORD_KIND = { project: "Project", person: "Person" } as const;

/**
 * The Project and the Person chips' picker: the composer's own, `#` offering Projects alone, the
 * Finished and Dropped ones among them, marked as such, and `@` each Person told apart from another
 * with the same name as there. It never makes a new one.
 */
function RecordPicker(
  props: PickerProps<"project" | "person"> & { kind: keyof typeof RECORD_KIND },
) {
  const callTool = useCallTool();
  const contextId = useContextId();
  const kind = RECORD_KIND[props.kind];
  return (
    <ChoicePicker
      label={`${kind}s`}
      fieldLabel={`Find a ${kind}`}
      placeholder={`Find a ${kind}`}
      none={`No ${kind} is named so.`}
      offer={(typed) =>
        props.kind === "project"
          ? referencesOffered(callTool, contextId, typed, "projects")
          : personsOffered(callTool, contextId, typed, props.timeZone)
      }
      onPick={(choice) => {
        if (choice.to.kind === props.kind) {
          props.onPick({ id: choice.to.id, name: choice.name } satisfies RecordNarrowing);
        }
      }}
    />
  );
}

/**
 * The time chip's picker: any time, the presets up to today, and a range of days, its two ends
 * named fields, the first on or before the last and neither after today.
 */
function TimePicker(props: PickerProps<"time">) {
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
          props.onPick({ kind: "range", from: from(), to: to() } satisfies TimeNarrowing);
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

import { namedZone } from "@praxis/domain";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { choiceKeys } from "./Pickers.tsx";

/** A time zone as the list offers it: its IANA name, and its offset from UTC now. */
type Zone = { name: string; offset: string };

/** The zones a Context can be put in, as this browser knows them, UTC among them. */
function knownZones(): string[] {
  const listed = Intl.supportedValuesOf("timeZone");
  return listed.includes("UTC") ? listed : [...listed, "UTC"].sort();
}

/** A zone's offset from UTC at an instant, as the list says it: "UTC+05:45", "UTC-03:00", "UTC". */
function offsetAt(zone: string, at: number): string {
  const said = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  const offset = said?.replace(/^GMT/, "") ?? "";
  return offset === "" || offset === "+00:00" ? "UTC" : `UTC${offset}`;
}

/** What was typed, or a zone's name and offset, as they are compared: an underscore is a space. */
function heard(words: string): string {
  return words.toLowerCase().replaceAll("_", " ");
}

/** The zones whose name or offset holds what was typed, every one when nothing is. */
function zonesHolding(zones: Zone[], typed: string): Zone[] {
  const asked = heard(typed.trim());
  if (asked === "") return zones;
  return zones.filter((zone) => heard(`${zone.name} ${zone.offset}`).includes(asked));
}

/**
 * A time zone picked from a list (section 3.1): a field that shows the zone it holds while it is
 * left alone, and, typed in, lists the browser's IANA zones whose name or offset holds what was
 * typed, each with its offset now. The arrows move through them, or open the whole list from a field not typed
 * in, with its zone highlighted; Enter or a tap picks one, and Escape puts the list away and the
 * field back to its zone. Nothing typed is ever sent: only a zone the list offered is picked.
 */
export function TimeZonePicker(props: {
  /** The field's id, so a label outside it names it. */
  id: string;
  describedBy?: string | undefined;
  /** The zone it holds: the Context's, or the one picked for a Context not made yet. */
  value: string;
  disabled?: boolean;
  /** A zone picked. While its answer is out, the field shows it; then the zone it holds. */
  onPick: (zone: string) => unknown;
}) {
  let field!: HTMLInputElement;
  const listId = createUniqueId();
  const optionId = (index: number) => `${listId}-${index}`;
  // What is typed while the person types, and the zone picked while its answer is out: either
  // stands in the field for the zone it holds, so a read landing meanwhile takes nothing back.
  const [typed, setTyped] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal<string | null>(null);
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(-1);
  const shown = () => typed() ?? pending() ?? props.value;

  // Each zone's offset is read as the list opens, so it says the offset now.
  const zones = createMemo(() => {
    if (!open()) return [];
    const now = Date.now();
    return knownZones().map((name) => ({ name, offset: offsetAt(name, now) }));
  });
  const offered = createMemo(() => zonesHolding(zones(), typed() ?? ""));
  const listed = () => open() && offered().length > 0;

  /** Open the list, its zone highlighted when nothing is typed, else the first that holds it. */
  function show() {
    setOpen(true);
    const own = namedZone(shown()) ?? shown();
    const at = typed() === null ? offered().findIndex((zone) => zone.name === own) : -1;
    setHighlight(offered().length === 0 ? -1 : Math.max(at, 0));
  }

  /** Put the list away and the field back to its zone, what was typed let go. */
  function putAway() {
    setOpen(false);
    setTyped(null);
    setHighlight(-1);
  }

  async function pick(zone: Zone) {
    const held = props.value;
    putAway();
    if (zone.name === held) return;
    setPending(zone.name);
    try {
      await props.onPick(zone.name);
    } finally {
      setPending(null);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && (open() || typed() !== null)) {
      // The list's, so Settings is not put away with it.
      event.preventDefault();
      putAway();
      return;
    }
    // While something is typed, Enter is the picker's: with nothing chosen it chooses nothing,
    // rather than send the form with the zone it held.
    if (event.key === "Enter" && (open() || typed() !== null)) event.preventDefault();
    if (!open()) {
      if (event.key !== "ArrowDown") return;
      event.preventDefault();
      show();
      return;
    }
    choiceKeys(event, {
      choices: offered(),
      highlight: highlight(),
      setHighlight,
      choose: (zone) => void pick(zone),
    });
  }

  // The highlighted zone stays in sight as the arrows move through a list that scrolls.
  createEffect(
    on(highlight, (at) => {
      if (at >= 0 && listed())
        document.getElementById(optionId(at))?.scrollIntoView({ block: "nearest" });
    }),
  );

  // A form put back puts the field back to the zone it holds, which no reset knows of.
  onMount(() => {
    const form = field.form;
    if (!form) return;
    const reset = () => queueMicrotask(() => (field.value = shown()));
    form.addEventListener("reset", reset);
    onCleanup(() => form.removeEventListener("reset", reset));
  });

  return (
    <div class="zone-picker">
      <input
        ref={field}
        id={props.id}
        type="text"
        role="combobox"
        aria-describedby={props.describedBy}
        aria-autocomplete="list"
        aria-expanded={listed()}
        aria-controls={listed() ? listId : undefined}
        aria-activedescendant={listed() && highlight() >= 0 ? optionId(highlight()) : undefined}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        disabled={props.disabled}
        value={shown()}
        onFocus={() => field.select()}
        onInput={(event) => {
          setTyped(event.currentTarget.value);
          setOpen(true);
          setHighlight(offered().length > 0 ? 0 : -1);
        }}
        onKeyDown={onKeyDown}
        onBlur={putAway}
      />
      <Show when={listed()}>
        <div id={listId} class="link-picker" role="listbox" aria-label="Time zones">
          <For each={offered()}>
            {(zone, index) => (
              <div
                id={optionId(index())}
                role="option"
                tabIndex={-1}
                aria-selected={highlight() === index()}
                classList={{ highlighted: highlight() === index() }}
                // The focus stays in the field, so a tap picks rather than leaves it.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void pick(zone)}
                // The keys are the field's own, but a zone given the focus is picked by Enter too.
                onKeyDown={(event) => {
                  if (event.key === "Enter") void pick(zone);
                }}
              >
                <span class="zone-name">
                  {/* A long name breaks after a slash, never inside a word. */}
                  <For each={zone.name.split("/")}>
                    {(part, at) => (
                      <>
                        {at() > 0 ? "/" : ""}
                        {at() > 0 ? <wbr /> : null}
                        {part}
                      </>
                    )}
                  </For>
                </span>{" "}
                <span class="zone-offset">{zone.offset}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={open() && offered().length === 0}>
        <p class="choice-none">No time zone is named so.</p>
      </Show>
    </div>
  );
}

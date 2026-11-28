import {
  ACCENTS,
  type Accent,
  type ContextListing,
  type DeploymentToolInput,
  type DeploymentToolName,
} from "@praxis/domain";
import Archive from "lucide-solid/icons/archive";
import ArchiveRestore from "lucide-solid/icons/archive-arrow-up";
import Palette from "lucide-solid/icons/palette";
import Trash from "lucide-solid/icons/trash";
import { createSignal, createUniqueId, For, Match, onMount, Show, Switch } from "solid-js";
import type { Action } from "./design/Menu.tsx";
import { Problem, SettingsGroup } from "./design/SettingRows.tsx";
import { deviceTimeZone } from "./device.ts";
import { MakeExport } from "./Export.tsx";
import { latestRead } from "./latest-read.ts";
import { marksSentOnLeaving } from "./leaving.tsx";
import { RecordRow } from "./RecordRow.tsx";
import {
  listedCount,
  type SectionChanges,
  SettingsSection,
  sectionChanges,
} from "./SettingsSection.tsx";
import { TimeZonePicker } from "./TimeZonePicker.tsx";
import { DOWNLOADED } from "./Trash.tsx";
import { callDeploymentTool, useContextId } from "./tools.ts";

/** An accent as the person reads it. */
function accentName(accent: Accent): string {
  return accent[0]?.toUpperCase() + accent.slice(1);
}

/** A Deployment tool that changes one Context, and returns it as it now is. */
type ContextChange = Extract<
  DeploymentToolName,
  "create_context" | "rename_context" | "set_context_accent" | "bring_back_context"
>;

/** The note of the only Context not retired, which `retire_context` refuses (section 4.11). */
const ONLY_ONE = "The only Context: make another to retire it.";

/**
 * What a Context marked to retire says until Contexts is left (ADR 0028): what else ends with it,
 * by how many Connections it has, or, unread, that any it has do.
 */
function retires(connections: number | undefined): string {
  const after =
    connections === undefined
      ? "Any Connections it has end."
      : connections === 0
        ? "Nothing else ends."
        : connections === 1
          ? "Its Connection ends."
          : `Its ${connections} Connections end.`;
  return `Retires when you leave Contexts. ${after}`;
}

/**
 * Whether a Context was just made from Contexts. Made, it becomes the current one, which draws
 * Settings afresh over it, so the Contexts drawn then give the focus back to New Context…, as
 * Cancel does.
 */
let madeHere = false;

/**
 * The Deployment's Contexts, in its settings (section 8.6): each with its accent, the current one
 * said so, renamed, given another accent, retired or brought back here, and a new one made from a
 * form opened on demand. Retiring hides a Context and deletes nothing; a retired one can then be
 * deleted for good (section 10.4). Retiring also ends its Connections, which bringing it back does
 * not, so Retire only marks it, and it retires as Contexts is left (ADR 0028).
 */
export function Contexts(props: {
  contexts: ContextListing[];
  onChanged: (context: ContextListing) => void;
  onMade: (context: ContextListing) => void;
  onDeleted: (id: string) => void;
  /** Says what the screen must say once Contexts is no longer shown to say it. */
  onProblem: (message: string) => void;
}) {
  const changes = sectionChanges();
  const current = useContextId();
  const retiring = marksSentOnLeaving<string>({
    sends: (marked) =>
      [...marked].map((id) => async () => {
        const retired = await callDeploymentTool("retire_context", { id });
        if (retired.ok) props.onChanged(retired.value.record);
        return retired;
      }),
    unsent: {
      nothing: "Praxis could not be reached: nothing was retired.",
      notAll: "Praxis could not be reached: some of what you marked was not retired.",
    },
    onProblem: (message) => props.onProblem(message),
  });
  const connected = connectionsByContext();
  const [making, setMaking] = createSignal(false);
  let newButton: HTMLButtonElement | undefined;
  onMount(() => {
    if (!madeHere) return;
    madeHere = false;
    newButton?.focus();
  });
  const byId = (id: string) => props.contexts.find((context) => context.id === id);
  // A Context marked to retire is counted as retired, so the last one left is never marked too.
  const staying = () =>
    props.contexts.filter((context) => !context.retired && !retiring.has(context.id));

  return (
    <SettingsSection note="Each Context keeps a Journal, a Conversation and settings of its own. Retiring one hides it and ends its Connections, and deletes nothing.">
      <SettingsGroup
        heading="Contexts"
        problem={changes.problemAt("contexts")}
        list={{
          // By id, so a Context changed keeps its row, and what is open in it.
          each: props.contexts.map((context) => context.id),
          empty: "No Context is made yet.",
          row: (id) => (
            <Show when={byId(id)}>
              {(context) => (
                <ContextRow
                  context={context()}
                  current={id === current}
                  only={staying().length === 1 && staying()[0]?.id === id}
                  changes={changes}
                  onChanged={props.onChanged}
                  onDeleted={props.onDeleted}
                  retiring={retiring.has(id) ? retires(connected.of(id)) : null}
                  onRetire={(on) => {
                    retiring.mark(id, on);
                    if (on) void connected.read();
                  }}
                />
              )}
            </Show>
          ),
        }}
      />
      <Show
        when={making()}
        fallback={
          <button ref={newButton} type="button" class="quiet" onClick={() => setMaking(true)}>
            New Context…
          </button>
        }
      >
        <NewContext
          heading="New Context"
          changes={changes}
          onMade={(made) => {
            setMaking(false);
            madeHere = true;
            props.onMade(made);
            // Still here, when Settings was not drawn afresh for it.
            if (madeHere) {
              madeHere = false;
              newButton?.focus();
            }
          }}
          onCancel={() => {
            setMaking(false);
            newButton?.focus();
          }}
        />
      </Show>
    </SettingsSection>
  );
}

function ContextRow(props: {
  context: ContextListing;
  /** Whether it is the current Context. */
  current: boolean;
  /** Whether it is the only Context not retired, which cannot be retired. */
  only: boolean;
  changes: SectionChanges;
  onChanged: (context: ContextListing) => void;
  onDeleted: (id: string) => void;
  /** What it says while marked to retire as Contexts is left, or null. */
  retiring: string | null;
  /** Mark it to retire, or take the mark off. */
  onRetire: (on: boolean) => void;
}) {
  const sending = () => props.changes.sending();
  // What an act behind More opened under the row.
  const [opened, setOpened] = createSignal<"accent" | "delete" | null>(null);
  let more: HTMLButtonElement | undefined;

  function close() {
    setOpened(null);
    more?.focus();
  }

  async function send<N extends ContextChange>(tool: N, input: DeploymentToolInput<N>) {
    const changed = await props.changes.change("contexts", () => callDeploymentTool(tool, input));
    const context = (changed as { record: ContextListing } | null)?.record ?? null;
    if (context) props.onChanged(context);
    return context;
  }

  const note = () =>
    [
      accentName(props.context.accent),
      props.current && "Current",
      props.context.retired && "Retired",
    ]
      .filter(Boolean)
      .join(" · ");

  const ending = (): Action[] => {
    const id = props.context.id;
    if (props.context.retired) {
      return [
        {
          label: "Bring back",
          icon: ArchiveRestore,
          disabled: sending(),
          onSelect: () => void send("bring_back_context", { id }),
        },
        {
          label: "Delete…",
          icon: Trash,
          disabled: sending(),
          onSelect: () => setOpened("delete"),
        },
      ];
    }
    if (props.only) return [];
    return [{ label: "Retire", icon: Archive, onSelect: () => props.onRetire(true) }];
  };

  return (
    <RecordRow
      testId="context-row"
      name={props.context.name}
      accent={props.context.accent}
      note={
        <>
          {note()}
          <Show when={props.only}>
            <span class="record-why">{ONLY_ONE}</span>
          </Show>
        </>
      }
      sending={sending()}
      onRename={async (name) =>
        (await send("rename_context", { id: props.context.id, name })) !== null
      }
      moreRef={(button) => {
        more = button;
      }}
      marked={
        props.retiring === null
          ? undefined
          : { says: props.retiring, onKeep: () => props.onRetire(false) }
      }
      more={[
        {
          label: "Accent",
          icon: Palette,
          disabled: sending(),
          onSelect: () => setOpened("accent"),
        },
        ...ending(),
      ]}
      under={
        <Switch>
          <Match when={opened() === "accent"}>
            <AccentChoice
              context={props.context}
              sending={sending()}
              onPick={async (accent) => {
                const changed = await send("set_context_accent", { id: props.context.id, accent });
                if (changed) close();
              }}
              onDone={close}
            />
          </Match>
          <Match when={opened() === "delete" && props.context.retired}>
            <DeleteContext
              context={props.context}
              changes={props.changes}
              onDeleted={props.onDeleted}
              onKept={close}
            />
          </Match>
        </Switch>
      }
    />
  );
}

/**
 * A Context's accents in place, under its row, as round swatches: the one it has ringed, and said
 * in words too. A tap on another gives it that one; on its own, or Escape, puts them away.
 */
function AccentChoice(props: {
  context: ContextListing;
  sending: boolean;
  onPick: (accent: Accent) => void;
  onDone: () => void;
}) {
  const now = createUniqueId();
  let fieldset!: HTMLFieldSetElement;
  onMount(() => fieldset.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus());

  return (
    <fieldset
      ref={fieldset}
      class="accent-choice"
      aria-describedby={now}
      on:keydown={(event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        props.onDone();
      }}
    >
      <legend class="visually-hidden">Accent of {props.context.name}</legend>
      <span class="accent-swatches">
        <For each={ACCENTS}>
          {(accent) => (
            <button
              type="button"
              class={`accent-swatch accent-${accent}`}
              aria-label={accentName(accent)}
              title={accentName(accent)}
              aria-pressed={accent === props.context.accent}
              disabled={props.sending}
              onClick={() =>
                accent === props.context.accent ? props.onDone() : props.onPick(accent)
              }
            />
          )}
        </For>
      </span>
      <span id={now} class="settings-row-note">
        {accentName(props.context.accent)} now
      </span>
    </fieldset>
  );
}

/**
 * Deleting a retired Context for good (section 10.4): the person is offered an Export first, told
 * what cannot be reached, and deletes it only once they have typed its name, which the tool checks
 * too.
 */
function DeleteContext(props: {
  context: ContextListing;
  changes: SectionChanges;
  onDeleted: (id: string) => void;
  onKept: () => void;
}) {
  const [typed, setTyped] = createSignal("");
  const sending = () => props.changes.sending();
  // What went wrong here, the Export offered or the delete, is said in this form.
  const at = `delete ${props.context.id}`;

  async function remove(event: SubmitEvent) {
    event.preventDefault();
    const name = typed();
    const deleted = await props.changes.change(at, () =>
      callDeploymentTool("delete_context", { id: props.context.id, name }),
    );
    if (deleted !== null) props.onDeleted(props.context.id);
  }

  return (
    <form
      class="delete-context"
      aria-label={`Delete ${props.context.name}`}
      onSubmit={(event) => void remove(event)}
    >
      <p class="settings-note">
        Deleting {props.context.name} removes everything in it for good: its Journal and its Trash,
        its Run records and its Conversation, what search holds of it, and its Connections. There is
        no Trash for it and no way back. An Export keeps a copy.
      </p>
      <div>
        {/* Quiet beside the form's one solid button, Delete for good (section 8.6). */}
        <MakeExport changes={props.changes} at={at} quiet />
      </div>
      <p class="settings-note">
        {DOWNLOADED} Its files in Backups go as those Backups age out, within 30 days.
      </p>
      <label>
        Type {props.context.name} to delete it
        <input
          type="text"
          autocomplete="off"
          spellcheck={false}
          value={typed()}
          onInput={(event) => setTyped(event.currentTarget.value)}
        />
      </label>
      <div class="delete-context-actions">
        <button type="submit" disabled={sending() || typed() !== props.context.name}>
          Delete {props.context.name} for good
        </button>
        <button type="button" class="quiet" disabled={sending()} onClick={() => props.onKept()}>
          Keep it
        </button>
      </div>
      <Problem message={props.changes.problemAt(at)} />
    </form>
  );
}

/**
 * Make a Context with its name, its time zone, picked from the list and starting as this Device's,
 * and its accent.
 * It is also how the first Context is made, in a Deployment that has none yet, where it sends
 * through changes of its own and stays open; in Settings, through its section's, opened on demand
 * under a heading of its own, the focus in its first field, and closed once made or cancelled.
 */
export function NewContext(props: {
  heading: string;
  changes?: SectionChanges;
  onMade: (context: ContextListing) => void;
  /** Close it unmade: given where it was opened on demand. */
  onCancel?: () => void;
}) {
  const { change, sending, problemAt } = props.changes ?? sectionChanges();
  const [zone, setZone] = createSignal(deviceTimeZone());
  const zoneId = createUniqueId();
  let nameField!: HTMLInputElement;
  onMount(() => {
    if (props.onCancel) nameField.focus();
  });

  async function make(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const fields = new FormData(form);
    const input = {
      name: String(fields.get("name") ?? ""),
      time_zone: zone(),
      accent: String(fields.get("accent") ?? "") as Accent,
    };
    const made = await change("new-context", () => callDeploymentTool("create_context", input));
    if (made === null) return;
    form.reset();
    setZone(deviceTimeZone());
    props.onMade(made.record);
  }

  return (
    <form
      class="new-context"
      classList={{ "new-record": props.onCancel !== undefined }}
      aria-label={props.heading}
      onSubmit={(event) => void make(event)}
    >
      <h3 class="label">{props.heading}</h3>
      <div class="new-record-fields">
        <label>
          Name
          <input ref={nameField} name="name" type="text" required />
        </label>
        {/* Not a label round the field: it would name the field by the zones listed under it. */}
        <div class="new-context-zone">
          <label for={zoneId}>Time zone</label>
          <TimeZonePicker id={zoneId} value={zone()} onPick={setZone} />
        </div>
        <label>
          Accent
          <select name="accent">
            <For each={ACCENTS}>
              {(accent) => <option value={accent}>{accentName(accent)}</option>}
            </For>
          </select>
        </label>
        <span class="new-record-acts">
          <button type="submit" disabled={sending()}>
            Make the Context
          </button>
          <Show when={props.onCancel}>
            {(cancel) => (
              <button type="button" class="quiet" onClick={() => cancel()()}>
                Cancel
              </button>
            )}
          </Show>
        </span>
      </div>
      <Problem message={problemAt("new-context")} />
    </form>
  );
}

/**
 * How many Connections each Context has, read as Contexts opens and again as one is marked to
 * retire, which ends them; unknown until read, or when the read fails.
 */
function connectionsByContext() {
  const [counted, setCounted] = createSignal<ReadonlyMap<string, number> | null>(null);
  const { read } = latestRead(async (current) => {
    try {
      const listed = await callDeploymentTool("list_connections", {});
      if (!current() || !listed.ok) return;
      const counts = new Map<string, number>();
      for (const { context_id } of listed.value.items) {
        counts.set(context_id, (counts.get(context_id) ?? 0) + 1);
      }
      setCounted(counts);
    } catch {
      // Unread, the mark says any Connections it has end.
    }
  });
  onMount(() => void read());
  return {
    read,
    of: (id: string) => {
      const counts = counted();
      return counts === null ? undefined : (counts.get(id) ?? 0);
    },
  };
}

/** How many Contexts are not retired, as the phone's list of sections shows it. */
export function contextsListed(contexts: ContextListing[]): string {
  return listedCount(contexts.filter((context) => !context.retired).length);
}

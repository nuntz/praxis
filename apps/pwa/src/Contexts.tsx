import {
  ACCENTS,
  type Accent,
  type ContextListing,
  type DeploymentToolInput,
  type DeploymentToolName,
} from "@praxis/domain";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { Problem } from "./design/SettingRows.tsx";
import { deviceTimeZone } from "./device.ts";
import { MakeExport } from "./Export.tsx";
import { followRecord } from "./follow-record.ts";
import { type SectionChanges, SettingsSection, sectionChanges } from "./SettingsSection.tsx";
import { TimeZonePicker } from "./TimeZonePicker.tsx";
import { DOWNLOADED } from "./Trash.tsx";
import { callDeploymentTool } from "./tools.ts";

/** An accent as the person reads it. */
function accentName(accent: Accent): string {
  return accent[0]?.toUpperCase() + accent.slice(1);
}

/** A Deployment tool that changes one Context, and returns it as it now is. */
type ContextChange = Extract<
  DeploymentToolName,
  | "create_context"
  | "rename_context"
  | "set_context_accent"
  | "retire_context"
  | "bring_back_context"
>;

/**
 * The Deployment's Contexts, in its settings (section 8.6): each with its accent, renamed, given
 * another accent, retired or brought back here, and a new one made. Retiring hides a Context and
 * deletes nothing; a retired one can then be deleted for good (section 10.4).
 */
export function Contexts(props: {
  contexts: ContextListing[];
  onChanged: (context: ContextListing) => void;
  onMade: (context: ContextListing) => void;
  onDeleted: (id: string) => void;
}) {
  const changes = sectionChanges();

  return (
    <SettingsSection note="Each Context keeps a Journal, a Conversation and settings of its own. Retiring one hides it and ends its Connections, and deletes nothing.">
      <ul class="context-rows">
        <For each={props.contexts}>
          {(context) => (
            <ContextRow
              context={context}
              changes={changes}
              onChanged={props.onChanged}
              onDeleted={props.onDeleted}
            />
          )}
        </For>
      </ul>
      {/* #214 puts the Contexts in a group's box, and this under it. */}
      <Problem message={changes.problemAt("contexts")} />
      <NewContext heading="New Context" changes={changes} onMade={props.onMade} />
    </SettingsSection>
  );
}

function ContextRow(props: {
  context: ContextListing;
  changes: SectionChanges;
  onChanged: (context: ContextListing) => void;
  onDeleted: (id: string) => void;
}) {
  const sending = () => props.changes.sending();
  const [deleting, setDeleting] = createSignal(false);
  let nameField!: HTMLInputElement;
  const name = followRecord(
    () => nameField,
    () => props.context.name,
  );

  async function send<N extends ContextChange>(tool: N, input: DeploymentToolInput<N>) {
    const changed = await props.changes.change("contexts", () => callDeploymentTool(tool, input));
    const context = (changed as { record: ContextListing } | null)?.record ?? null;
    if (context) props.onChanged(context);
    return context;
  }

  async function rename(event: SubmitEvent) {
    event.preventDefault();
    await name.send(() => send("rename_context", { id: props.context.id, name: nameField.value }));
  }

  return (
    <li class="context-row" data-testid="context-row">
      <span class={`swatch accent-${props.context.accent}`} aria-hidden="true" />
      <form class="context-rename" onSubmit={(event) => void rename(event)}>
        <input
          ref={nameField}
          type="text"
          aria-label={`Name of ${props.context.name}`}
          onInput={name.typed}
          required
        />
        <button type="submit" class="quiet" disabled={sending()}>
          Rename
        </button>
      </form>
      <label class="context-accent">
        <span class="visually-hidden">Accent of {props.context.name}</span>
        <select
          disabled={sending()}
          onChange={(event) =>
            void send("set_context_accent", {
              id: props.context.id,
              accent: event.currentTarget.value as Accent,
            })
          }
        >
          <For each={ACCENTS}>
            {(accent) => (
              <option value={accent} selected={accent === props.context.accent}>
                {accentName(accent)}
              </option>
            )}
          </For>
        </select>
      </label>
      <Show
        when={props.context.retired}
        fallback={
          <button
            type="button"
            class="quiet"
            disabled={sending()}
            onClick={() => void send("retire_context", { id: props.context.id })}
          >
            Retire {props.context.name}
          </button>
        }
      >
        <span class="retired">Retired</span>
        <button
          type="button"
          class="quiet"
          disabled={sending()}
          onClick={() => void send("bring_back_context", { id: props.context.id })}
        >
          Bring back {props.context.name}
        </button>
        <button
          type="button"
          class="quiet"
          disabled={sending()}
          aria-expanded={deleting()}
          onClick={() => setDeleting((open) => !open)}
        >
          Delete {props.context.name}…
        </button>
        <Show when={deleting()}>
          <DeleteContext
            context={props.context}
            changes={props.changes}
            onDeleted={props.onDeleted}
            onKept={() => setDeleting(false)}
          />
        </Show>
      </Show>
    </li>
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
        <MakeExport changes={props.changes} at={at} />
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
 * through changes of its own; in Settings, through its section's.
 */
export function NewContext(props: {
  heading: string;
  changes?: SectionChanges;
  onMade: (context: ContextListing) => void;
}) {
  const { change, sending, problemAt } = props.changes ?? sectionChanges();
  const [zone, setZone] = createSignal(deviceTimeZone());
  const zoneId = createUniqueId();

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
    <form class="new-context" aria-label={props.heading} onSubmit={(event) => void make(event)}>
      <h3 class="label">{props.heading}</h3>
      <label>
        Name
        <input name="name" type="text" required />
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
      <button type="submit" disabled={sending()}>
        Make the Context
      </button>
      <Problem message={problemAt("new-context")} />
    </form>
  );
}

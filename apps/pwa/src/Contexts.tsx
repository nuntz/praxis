import {
  ACCENTS,
  type Accent,
  type ContextListing,
  type DeploymentToolInput,
  type DeploymentToolName,
} from "@praxis/domain";
import { createSignal, For, Show } from "solid-js";
import { deviceTimeZone } from "./ContextSettings.tsx";
import { callDeploymentTool, unreachableMessage } from "./tools.ts";

/** An accent as the person reads it. */
function accentName(accent: Accent): string {
  return accent[0]?.toUpperCase() + accent.slice(1);
}

/** A Deployment tool that changes one Context, and returns it as it now is. */
type ContextChange = Exclude<DeploymentToolName, "list_contexts">;

/**
 * Call a Deployment tool that changes one Context, for the Context as it now is. A refusal or an
 * outage is reported as a problem, and gives nothing.
 */
async function changeContext<N extends ContextChange>(
  tool: N,
  input: DeploymentToolInput<N>,
  onProblem: (message: string | null) => void,
): Promise<ContextListing | null> {
  try {
    const result = await callDeploymentTool(tool, input);
    if (!result.ok) {
      onProblem(result.error.message);
      return null;
    }
    onProblem(null);
    return (result.value as { record: ContextListing }).record;
  } catch (error) {
    onProblem(unreachableMessage(error));
    return null;
  }
}

/**
 * The Deployment's Contexts, in its settings (section 8.6): each with its accent, renamed, given
 * another accent, retired or brought back here, and a new one made. Retiring hides a Context and
 * deletes nothing.
 */
export function Contexts(props: {
  contexts: ContextListing[];
  onChanged: (context: ContextListing) => void;
  onMade: (context: ContextListing) => void;
}) {
  const [problem, setProblem] = createSignal<string | null>(null);

  return (
    <section id="contexts" class="settings" aria-labelledby="contexts-heading">
      <h2 id="contexts-heading" class="column-heading">
        Contexts
      </h2>
      <ul class="context-rows">
        <For each={props.contexts}>
          {(context) => (
            <ContextRow context={context} onChanged={props.onChanged} onProblem={setProblem} />
          )}
        </For>
      </ul>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <NewContext heading="New Context" onMade={props.onMade} />
    </section>
  );
}

function ContextRow(props: {
  context: ContextListing;
  onChanged: (context: ContextListing) => void;
  onProblem: (message: string | null) => void;
}) {
  const [sending, setSending] = createSignal(false);
  let nameField!: HTMLInputElement;

  async function send<N extends ContextChange>(tool: N, input: DeploymentToolInput<N>) {
    setSending(true);
    const changed = await changeContext(tool, input, props.onProblem);
    setSending(false);
    if (changed) props.onChanged(changed);
    return changed;
  }

  async function rename(event: SubmitEvent) {
    event.preventDefault();
    const done = await send("rename_context", { id: props.context.id, name: nameField.value });
    if (!done) nameField.value = props.context.name;
  }

  return (
    <li class="context-row" data-testid="context-row">
      <span class={`swatch accent-${props.context.accent}`} aria-hidden="true" />
      <form class="context-rename" onSubmit={(event) => void rename(event)}>
        <input
          ref={nameField}
          type="text"
          aria-label={`Name of ${props.context.name}`}
          value={props.context.name}
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
      </Show>
    </li>
  );
}

/**
 * Make a Context with its name, its time zone, which starts as this Device's, and its accent.
 * It is also how the first Context is made, in a Deployment that has none yet.
 */
export function NewContext(props: { heading: string; onMade: (context: ContextListing) => void }) {
  const [problem, setProblem] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);

  async function make(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const fields = new FormData(form);
    setSending(true);
    const made = await changeContext(
      "create_context",
      {
        name: String(fields.get("name") ?? ""),
        time_zone: String(fields.get("time_zone") ?? ""),
        accent: String(fields.get("accent") ?? "") as Accent,
      },
      setProblem,
    );
    setSending(false);
    if (!made) return;
    form.reset();
    props.onMade(made);
  }

  return (
    <form class="new-context" aria-label={props.heading} onSubmit={(event) => void make(event)}>
      <h3 class="label">{props.heading}</h3>
      <label>
        Name
        <input name="name" type="text" required />
      </label>
      <label>
        Time zone
        <input name="time_zone" type="text" value={deviceTimeZone()} required />
      </label>
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
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </form>
  );
}

import type {
  Connection,
  ContextListing,
  DeploymentToolInput,
  DeploymentToolName,
} from "@praxis/domain";
import { createEffect, createSignal, createUniqueId, For, on, Show } from "solid-js";
import { SwitchInput } from "./design/SettingRows.tsx";
import { latestRead } from "./latest-read.ts";
import { callDeploymentTool, unreachableMessage, writeToDeployment } from "./tools.ts";

/** A Deployment tool that changes one Connection, and returns it as it now is. */
type ConnectionChange = Extract<
  DeploymentToolName,
  "create_connection" | "rename_connection" | "set_connection_reading_only" | "end_connection"
>;

/** The whole address of a Connection, on this Deployment's own hostname, to paste into a client. */
function fullAddress(connection: Connection): string {
  return new URL(connection.address, location.origin).href;
}

/**
 * The Deployment's Connections, in its settings (section 8.6): each outside agent the person lets
 * work in one Context, with the address to paste into it. Made, renamed, limited to reading or
 * not, and ended here, by the person's hand only. Retiring a Context ends its Connections, so the
 * list is read again whenever the Contexts change.
 */
export function Connections(props: { contexts: ContextListing[] }) {
  const [connections, setConnections] = createSignal<Connection[]>([]);
  const [problem, setProblem] = createSignal<string | null>(null);
  const shown = () => props.contexts.filter((context) => !context.retired);
  const contextName = (id: string) =>
    props.contexts.find((context) => context.id === id)?.name ?? "";

  // A read answers with the list as the Deployment held it when the read was sent. One overtaken
  // by a later read, or sent before a change made here since, would show the list without that
  // change: it is dropped, and in the second case the list is read again.
  const listed = latestRead(async (current) => {
    try {
      const result = await callDeploymentTool("list_connections", {});
      if (!current()) return;
      if (!result.ok) return setProblem(result.error.message);
      setConnections(result.value.items);
    } catch (error) {
      if (!current()) return;
      setProblem(unreachableMessage(error));
    }
  });

  createEffect(
    on(
      () => props.contexts,
      () => listed.read(),
    ),
  );

  function made(connection: Connection) {
    listed.changed();
    setConnections((listed) => [...listed, connection]);
  }

  function show(changed: Connection) {
    listed.changed();
    setConnections((listed) =>
      changed.ended
        ? listed.filter((connection) => connection.id !== changed.id)
        : listed.map((connection) => (connection.id === changed.id ? changed : connection)),
    );
  }

  return (
    <section id="connections" class="settings" aria-labelledby="connections-heading">
      <h2 id="connections-heading" class="column-heading">
        Connections
      </h2>
      <p class="settings-note">
        An outside agent, such as Claude or ChatGPT, works in one Context through a Connection.
        Paste its address into the agent, and sign in there as yourself.
      </p>
      <Show
        when={connections().length > 0}
        fallback={<p class="settings-note">No outside agent is connected.</p>}
      >
        <ul class="connection-rows" aria-label="Connections">
          <For each={connections()}>
            {(connection) => (
              <ConnectionRow
                connection={connection}
                contextName={contextName(connection.context_id)}
                onChanged={show}
                onProblem={setProblem}
              />
            )}
          </For>
        </ul>
      </Show>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={shown().length > 0}>
        <NewConnection contexts={shown()} onMade={made} />
      </Show>
    </section>
  );
}

function ConnectionRow(props: {
  connection: Connection;
  contextName: string;
  onChanged: (connection: Connection) => void;
  onProblem: (message: string | null) => void;
}) {
  const [sending, setSending] = createSignal(false);
  const readingOnly = createUniqueId();
  let nameField!: HTMLInputElement;

  async function send<N extends ConnectionChange>(tool: N, input: DeploymentToolInput<N>) {
    setSending(true);
    const changed = (await writeToDeployment(tool, input, props.onProblem)) as Connection | null;
    setSending(false);
    if (changed) props.onChanged(changed);
    return changed;
  }

  async function rename(event: SubmitEvent) {
    event.preventDefault();
    const done = await send("rename_connection", {
      id: props.connection.id,
      name: nameField.value,
    });
    if (!done) nameField.value = props.connection.name;
  }

  return (
    <li class="connection-row" data-testid="connection-row">
      <form class="context-rename" onSubmit={(event) => void rename(event)}>
        <input
          ref={nameField}
          type="text"
          aria-label={`Name of ${props.connection.name}`}
          value={props.connection.name}
          required
        />
        <button type="submit" class="quiet" disabled={sending()}>
          Rename
        </button>
      </form>
      <span class="connection-context">in {props.contextName}</span>
      <label class="connection-address">
        <span class="visually-hidden">Address of {props.connection.name}</span>
        <input
          type="text"
          readOnly
          value={fullAddress(props.connection)}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <div class="connection-reading-only">
        <label for={readingOnly}>Reading only</label>
        <SwitchInput
          id={readingOnly}
          checked={props.connection.reading_only}
          disabled={sending()}
          onChange={(event) => {
            const toggle = event.currentTarget;
            void send("set_connection_reading_only", {
              id: props.connection.id,
              reading_only: toggle.checked,
            }).then((changed) => {
              if (!changed) toggle.checked = props.connection.reading_only;
            });
          }}
        />
      </div>
      <button
        type="button"
        class="quiet"
        disabled={sending()}
        onClick={() => void send("end_connection", { id: props.connection.id })}
      >
        End {props.connection.name}
      </button>
    </li>
  );
}

/** Make a Connection with its name, its Context, which never changes, and whether it reads only. */
function NewConnection(props: {
  contexts: ContextListing[];
  onMade: (connection: Connection) => void;
}) {
  const [problem, setProblem] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);
  const readingOnly = createUniqueId();

  async function make(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const fields = new FormData(form);
    setSending(true);
    const made = await writeToDeployment(
      "create_connection",
      {
        name: String(fields.get("name") ?? ""),
        context_id: String(fields.get("context_id") ?? ""),
        reading_only: fields.get("reading_only") !== null,
      },
      setProblem,
    );
    setSending(false);
    if (!made) return;
    form.reset();
    props.onMade(made);
  }

  return (
    <form class="new-context" aria-label="New Connection" onSubmit={(event) => void make(event)}>
      <h3 class="label">New Connection</h3>
      <label>
        Name
        <input name="name" type="text" required />
      </label>
      <label>
        Context
        <select name="context_id">
          <For each={props.contexts}>
            {(context) => <option value={context.id}>{context.name}</option>}
          </For>
        </select>
      </label>
      <div class="connection-reading-only">
        <label for={readingOnly}>Reading only</label>
        <SwitchInput id={readingOnly} name="reading_only" />
      </div>
      <button type="submit" disabled={sending()}>
        Make the Connection
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

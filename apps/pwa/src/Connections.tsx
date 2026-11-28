import type {
  Connection,
  ContextListing,
  DeploymentToolInput,
  DeploymentToolName,
} from "@praxis/domain";
import Unplug from "lucide-solid/icons/unplug";
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Problem, SettingsGroup, SwitchInput } from "./design/SettingRows.tsx";
import { latestRead } from "./latest-read.ts";
import { RecordRow } from "./RecordRow.tsx";
import {
  listedCount,
  type SectionChanges,
  SettingsSection,
  sectionChanges,
} from "./SettingsSection.tsx";
import { callDeploymentTool, unreachableMessage } from "./tools.ts";

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
  // What the last read met, said in place of the list it could not read.
  const [problem, setProblem] = createSignal<string | null>(null);
  const changes = sectionChanges();
  const [making, setMaking] = createSignal(false);
  let newButton: HTMLButtonElement | undefined;
  const byId = (id: string) => connections().find((connection) => connection.id === id);
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
      setProblem(null);
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
    <SettingsSection note="An outside agent, such as Claude or ChatGPT, works in one Context through a Connection. Paste its address into the agent, and sign in there as yourself.">
      <Show when={!problem()} fallback={<Problem message={problem()} />}>
        <SettingsGroup
          heading="Connections"
          problem={changes.problemAt("connections")}
          list={{
            // By id, so a Connection changed keeps its row, and what is open in it.
            each: connections().map((connection) => connection.id),
            empty: "No outside agent is connected.",
            row: (id) => (
              <Show when={byId(id)}>
                {(connection) => (
                  <ConnectionRow
                    connection={connection()}
                    contextName={contextName(connection().context_id)}
                    changes={changes}
                    onChanged={show}
                  />
                )}
              </Show>
            ),
          }}
        />
      </Show>
      <Show when={shown().length > 0}>
        <Show
          when={making()}
          fallback={
            <button ref={newButton} type="button" class="quiet" onClick={() => setMaking(true)}>
              New Connection…
            </button>
          }
        >
          <NewConnection
            contexts={shown()}
            changes={changes}
            onMade={(connection) => {
              setMaking(false);
              made(connection);
              newButton?.focus();
            }}
            onCancel={() => {
              setMaking(false);
              newButton?.focus();
            }}
          />
        </Show>
      </Show>
    </SettingsSection>
  );
}

function ConnectionRow(props: {
  connection: Connection;
  contextName: string;
  changes: SectionChanges;
  onChanged: (connection: Connection) => void;
}) {
  const sending = () => props.changes.sending();
  const readingOnly = createUniqueId();

  async function send<N extends ConnectionChange>(tool: N, input: DeploymentToolInput<N>) {
    const changed = await props.changes.change("connections", () =>
      callDeploymentTool(tool, input),
    );
    const connection = (changed as { record: Connection } | null)?.record ?? null;
    if (connection) props.onChanged(connection);
    return connection;
  }

  const note = () =>
    [`in ${props.contextName}`, props.connection.reading_only && "Reading only"]
      .filter(Boolean)
      .join(" · ");

  return (
    <RecordRow
      testId="connection-row"
      name={props.connection.name}
      note={note()}
      detail={<Address connection={props.connection} />}
      act={
        <span class="record-switch">
          <label for={readingOnly}>Reading only</label>
          <SwitchInput
            id={readingOnly}
            checked={props.connection.reading_only}
            disabled={sending()}
            onTurn={async (on) => {
              const input = { id: props.connection.id, reading_only: on };
              return (await send("set_connection_reading_only", input)) !== null;
            }}
          />
        </span>
      }
      sending={sending()}
      onRename={async (name) =>
        (await send("rename_connection", { id: props.connection.id, name })) !== null
      }
      more={[
        // #215 has End wait until the section is left.
        {
          label: "End",
          icon: Unplug,
          disabled: sending(),
          onSelect: () => void send("end_connection", { id: props.connection.id }),
        },
      ]}
    />
  );
}

/** How long "Copied" is said once an address is copied. */
const COPIED_FOR = 2000;

/**
 * A Connection's whole address, in mono, to paste into an outside agent, with a quiet Copy that
 * says for a moment that it copied it.
 */
function Address(props: { connection: Connection }) {
  const [said, setSaid] = createSignal("");
  let saying: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(saying));

  async function copy() {
    clearTimeout(saying);
    try {
      await navigator.clipboard.writeText(fullAddress(props.connection));
      setSaid("Copied");
      saying = setTimeout(() => setSaid(""), COPIED_FOR);
    } catch {
      setSaid("Not copied: select the address to copy it.");
    }
  }

  return (
    <span class="record-address">
      <span class="record-address-text" translate="no">
        {fullAddress(props.connection)}
      </span>
      <button
        type="button"
        class="quiet"
        aria-label={`Copy the address of ${props.connection.name}`}
        onClick={() => void copy()}
      >
        Copy
      </button>
      <span class="record-copied" role="status">
        {said()}
      </span>
    </span>
  );
}

/** Make a Connection with its name, its Context, which never changes, and whether it reads only. */
function NewConnection(props: {
  contexts: ContextListing[];
  changes: SectionChanges;
  onMade: (connection: Connection) => void;
  onCancel: () => void;
}) {
  const { change, sending, problemAt } = props.changes;
  const readingOnly = createUniqueId();
  let nameField!: HTMLInputElement;
  onMount(() => nameField.focus());

  async function make(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const fields = new FormData(form);
    const input = {
      name: String(fields.get("name") ?? ""),
      context_id: String(fields.get("context_id") ?? ""),
      reading_only: fields.get("reading_only") !== null,
    };
    const made = await change("new-connection", () =>
      callDeploymentTool("create_connection", input),
    );
    if (made === null) return;
    form.reset();
    props.onMade(made.record);
  }

  return (
    <form
      class="new-context new-record"
      aria-label="New Connection"
      onSubmit={(event) => void make(event)}
    >
      <h3 class="label">New Connection</h3>
      <div class="new-record-fields">
        <label>
          Name
          <input ref={nameField} name="name" type="text" required />
        </label>
        <label>
          Context
          <select name="context_id">
            <For each={props.contexts}>
              {(context) => <option value={context.id}>{context.name}</option>}
            </For>
          </select>
        </label>
        <span class="record-switch">
          <label for={readingOnly}>Reading only</label>
          <SwitchInput id={readingOnly} name="reading_only" />
        </span>
        <span class="new-record-acts">
          <button type="submit" disabled={sending()}>
            Make the Connection
          </button>
          <button type="button" class="quiet" onClick={() => props.onCancel()}>
            Cancel
          </button>
        </span>
      </div>
      <Problem message={problemAt("new-connection")} />
    </form>
  );
}

/** How many Connections there are, as the phone's list of sections shows it, or null unread. */
export async function connectionsListed(): Promise<string | null> {
  const result = await callDeploymentTool("list_connections", {});
  return result.ok ? listedCount(result.value.items.length) : null;
}

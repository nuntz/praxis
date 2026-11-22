import {
  type Caller,
  type Change,
  type ConnectionCall,
  type Effect,
  type EffectKind,
  isConnection,
  type ToolInput,
} from "@praxis/domain";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { callDeploymentTool, needsNetwork, useCallTool, useContextId } from "./tools.ts";

/** What each kind of thing an Effect names is called, in the glossary's words. */
const KIND: Record<EffectKind, string> = {
  entry: "Entry",
  task: "Task",
  project: "Project",
  person: "Person",
  context: "Context",
  held_change: "Held Change",
  connection: "Connection",
  device: "Device",
  spend_cap: "Spend cap",
};

/** Who the list is narrowed to: every caller, or one, a Connection by its id. */
type Narrowed = NonNullable<ToolInput<"list_changes">["caller"]> | null;

/** One line of the list: a change, or a Connection's read beside the changes. */
type Line = { kind: "change"; change: Change } | { kind: "read"; call: ConnectionCall };

const atOf = (line: Line) => (line.kind === "change" ? line.change.at : line.call.at);

/** A caller as the screen names them. */
function callerName(caller: Caller): string {
  switch (caller.kind) {
    case "hand":
      return "You";
    case "agent":
      return "The Agent";
    case "clock":
      return "The clock";
    case "connection":
    case "read_only_connection":
      return caller.name;
  }
}

/** Whether a change was made by the caller the list is narrowed to. */
function madeBy(change: Change, narrowed: Narrowed): boolean {
  if (narrowed === null) return true;
  const { caller } = change;
  if (narrowed.kind === "connection") return isConnection(caller) && caller.id === narrowed.id;
  return caller.kind === narrowed.kind;
}

/** The option of the select for a narrowing, and back. */
function optionOf(narrowed: Narrowed): string {
  if (narrowed === null) return "";
  return narrowed.kind === "connection" ? `connection:${narrowed.id}` : narrowed.kind;
}

function narrowedBy(option: string): Narrowed {
  if (option === "") return null;
  if (option.startsWith("connection:")) {
    return { kind: "connection", id: option.slice("connection:".length) };
  }
  return { kind: option as "hand" | "agent" | "clock" };
}

/**
 * The current Context's Changes (section 8.6): what changed and who changed it, newest first,
 * narrowed to one caller if the person likes, with what its Connections read listed alongside.
 * The changes come from `list_changes` read newest first and from the live channel meanwhile; the
 * reads from `list_connection_calls`, which the live channel does not carry, so they are as of the
 * last read. Both lists are paged: the list shows only as far back as both have been read, so
 * nothing older shows while something newer is still unread on the other.
 */
export function Changes(props: { timeZone: string }) {
  const callTool = useCallTool();
  const contextId = useContextId();
  const live = useLive();
  const [narrowed, setNarrowed] = createSignal<Narrowed>(null);
  const [changes, setChanges] = createSignal<Change[]>([]);
  const [connectionReads, setConnectionReads] = createSignal<ConnectionCall[]>([]);
  /** The cursor to the earlier changes, and to the earlier reads, or null once all are shown. */
  const [changesFrom, setChangesFrom] = createSignal<string | null>(null);
  const [readsFrom, setReadsFrom] = createSignal<string | null>(null);
  const [connections, setConnections] = createSignal<{ id: string; name: string }[]>([]);
  /** Whether the lists have been read once, as narrowed now. */
  const [loaded, setLoaded] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const timeFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: props.timeZone,
  });

  /** The reads of the Connections that the narrowing shows: of one, of every one, or none. */
  const readsInput = (by: Narrowed, cursor?: string): ToolInput<"list_connection_calls"> => ({
    reads_only: true,
    ...(by?.kind === "connection" ? { connection_id: by.id } : {}),
    ...(cursor === undefined ? {} : { cursor }),
  });
  const showsReads = (by: Narrowed) => by === null || by.kind === "connection";

  /**
   * Read the newest of both lists afresh, or the earlier of each that has more: one read, so the
   * last asked wins, and narrowing or a change meanwhile drops what a read still out answers.
   */
  const listed = latestRead(async (current, earlier: boolean) => {
    const by = narrowed();
    const changesCursor = earlier ? changesFrom() : null;
    const readsCursor = earlier ? readsFrom() : null;
    const asksChanges = !earlier || changesCursor !== null;
    const asksReads = showsReads(by) && (!earlier || readsCursor !== null);
    try {
      const [changed, called] = await Promise.all([
        asksChanges
          ? callTool("list_changes", {
              newest_first: true,
              ...(changesCursor === null ? {} : { cursor: changesCursor }),
              ...(by === null ? {} : { caller: by }),
            })
          : null,
        asksReads
          ? callTool("list_connection_calls", readsInput(by, readsCursor ?? undefined))
          : null,
      ]);
      if (!current()) return;
      if (changed !== null && !changed.ok) return setProblem(changed.error.message);
      if (called !== null && !called.ok) return setProblem(called.error.message);
      setProblem(null);
      if (changed !== null) {
        setChanges((shown) => [...(earlier ? shown : []), ...changed.value.items]);
        setChangesFrom(changed.value.more ? changed.value.cursor : null);
      }
      if (called !== null) {
        setConnectionReads((shown) => [...(earlier ? shown : []), ...called.value.items]);
        setReadsFrom(called.value.next_cursor);
      } else if (!earlier) {
        setConnectionReads([]);
        setReadsFrom(null);
      }
      setLoaded(true);
    } catch (error) {
      if (!current()) return;
      setProblem(needsNetwork(error, "The Changes need the network."));
    }
  });

  /** The Connections the list can be narrowed to: this Context's, and any seen in it, ended or not. */
  const connectionOptions = () => {
    const named = new Map(connections().map(({ id, name }) => [id, name]));
    for (const line of [
      ...changes().map((change) => change.caller),
      ...connectionReads().map((call) => call.caller),
    ]) {
      if (isConnection(line) && !named.has(line.id)) named.set(line.id, line.name);
    }
    return [...named].map(([id, name]) => ({ id, name }));
  };

  /**
   * Both lists, newest first, as far back as both have been read: a list with more stops the other
   * at its oldest line, so nothing it has still to give is left out between.
   */
  const lines = (): Line[] => {
    const shownChanges = changes();
    const shownReads = connectionReads();
    const horizons = [
      changesFrom() === null ? null : shownChanges.at(-1)?.at,
      readsFrom() === null ? null : shownReads.at(-1)?.at,
    ].filter((at): at is string => typeof at === "string");
    // ISO instants of one form sort as their times do.
    const horizon = horizons.toSorted().at(-1) ?? "";
    return [
      ...shownChanges.map((change): Line => ({ kind: "change", change })),
      ...shownReads.map((call): Line => ({ kind: "read", call })),
    ]
      .filter((line) => atOf(line) >= horizon)
      .toSorted((a, b) => (atOf(a) < atOf(b) ? 1 : atOf(a) > atOf(b) ? -1 : 0));
  };

  onMount(async () => {
    await live.ready;
    await listed.read(false);
    try {
      const listed = await callDeploymentTool("list_connections", {});
      if (listed.ok) {
        setConnections(
          listed.value.items
            .filter((connection) => connection.context_id === contextId)
            .map(({ id, name }) => ({ id, name })),
        );
      }
    } catch {
      // The Connections seen in the list are offered still.
    }
  });
  onCleanup(
    live.listen({
      // A change has no id to place it by, so the newest are read afresh, which drops a read
      // still out: the answer then holds it, once.
      changed: (change) => (madeBy(change, narrowed()) ? listed.read(false) : undefined),
      readAfresh: () => listed.read(false),
    }),
  );

  function narrow(option: string) {
    setNarrowed(narrowedBy(option));
    setChanges([]);
    setConnectionReads([]);
    setChangesFrom(null);
    setReadsFrom(null);
    setLoaded(false);
    void listed.read(false);
  }

  return (
    <section id="changes" class="settings" aria-labelledby="changes-heading">
      <h2 id="changes-heading" class="column-heading">
        Changes
      </h2>
      <p class="settings-note">
        What changed in this Context in the last 90 days and who changed it, newest first, with what
        its Connections read.
      </p>
      <label class="changes-by">
        Made by
        <select
          value={optionOf(narrowed())}
          onChange={(event) => narrow(event.currentTarget.value)}
        >
          <option value="">Anyone</option>
          <option value="hand">You</option>
          <option value="agent">The Agent</option>
          <option value="clock">The clock, in a Brief or a Review</option>
          <For each={connectionOptions()}>
            {(connection) => (
              <option value={optionOf({ kind: "connection", id: connection.id })}>
                {connection.name}
              </option>
            )}
          </For>
        </select>
      </label>
      <Show when={loaded()}>
        <Show
          when={lines().length > 0}
          fallback={<p class="settings-note">Nothing changed here in the last 90 days.</p>}
        >
          <ol class="change-lines" aria-label="Changes and reads">
            <For each={lines()}>
              {(line) =>
                line.kind === "change" ? (
                  <ChangeLine change={line.change} time={timeFormat} />
                ) : (
                  <ReadLine call={line.call} time={timeFormat} />
                )
              }
            </For>
          </ol>
        </Show>
        <Show when={changesFrom() !== null || readsFrom() !== null}>
          <button type="button" class="quiet" onClick={() => void listed.read(true)}>
            Show earlier
          </button>
        </Show>
      </Show>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </section>
  );
}

/** One change: who made it and when, and each of its Effects, a rule's marked as one. */
function ChangeLine(props: { change: Change; time: Intl.DateTimeFormat }) {
  return (
    <li class="change-line" data-testid="change">
      <p class="change-meta">
        {callerName(props.change.caller)}, {props.time.format(new Date(props.change.at))}
      </p>
      <ul class="change-effects">
        <For each={props.change.effects}>{(effect) => <EffectLine effect={effect} />}</For>
      </ul>
    </li>
  );
}

function EffectLine(props: { effect: Effect }) {
  return (
    <li>
      <span class="change-kind">
        {KIND[props.effect.kind]} {props.effect.what}
        {props.effect.by === "rule" ? " by a rule" : ""}
      </span>{" "}
      {props.effect.summary}
    </li>
  );
}

/** One read by a Connection: which tool, what it answered and how many records came back. */
function ReadLine(props: { call: ConnectionCall; time: Intl.DateTimeFormat }) {
  const answered = () =>
    props.call.result === "ok"
      ? `${props.call.records} ${props.call.records === 1 ? "record" : "records"}`
      : `answered ${props.call.result}`;
  return (
    <li class="change-line" data-testid="connection-read">
      <p class="change-meta">
        {callerName(props.call.caller)}, {props.time.format(new Date(props.call.at))}
      </p>
      <p class="change-read">
        Read with <code>{props.call.tool}</code>: {answered()}
      </p>
    </li>
  );
}

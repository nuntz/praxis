import type { AgentMessage, Effect, Message, MessagesPage, RunCall } from "@praxis/domain";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { Peer } from "./design/Peer.tsx";
import { HeldChangeItem, useHeldChanges } from "./HeldChanges.tsx";
import { recordAnchor } from "./Journal.tsx";
import { useLive } from "./live-context.ts";
import { CapNotice, readSpend, spend } from "./Spend.tsx";
import { unreachableMessage, useCallTool } from "./tools.ts";
import { Words } from "./Words.tsx";

const moneyFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 2,
});

/**
 * The Conversation with the Agent in the current Context (section 8.5): every Message, scrollable
 * to the start, and the composer that sends one. The Agent's answer is shown as it is written, and
 * a Run's calls fold under the Message it left. Without the model's key there is no Agent, and the
 * Conversation says so in place of its composer; at the spend cap, the cap's Notice and a way to
 * the cap in settings take the composer's place.
 */
export function Conversation(props: {
  contextName: string | undefined;
  /** Bring a record a Run changed into view, wherever it is shown. */
  onShowRecord: (anchor: string) => void;
  /** Open the settings at the spend cap. */
  onShowCap: () => void;
}) {
  const callTool = useCallTool();
  const live = useLive();
  // Oldest first, as shown. `list_messages` gives newest first, a page at a time.
  const [messages, setMessages] = createStore<Message[]>([]);
  const [earlierCursor, setEarlierCursor] = createSignal<string | null>(null);
  const [agent, setAgent] = createSignal<MessagesPage["agent"] | null>(null);
  // The answer being written in the Run going now, all of it so far.
  const [writing, setWriting] = createSignal<string | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);

  async function loadPage(cursor?: string) {
    try {
      const result = await callTool("list_messages", cursor === undefined ? {} : { cursor });
      if (!result.ok) return setProblem(result.error.message);
      setAgent(result.value.agent);
      const page = result.value.items.toReversed();
      if (cursor === undefined) {
        // The newest page, read afresh: what the live channel brought meanwhile is kept once.
        setMessages((shown) => [
          ...page,
          ...shown.filter((message) => !page.some((read) => read.id === message.id)),
        ]);
      } else {
        setMessages((shown) => [
          ...page.filter((read) => !shown.some((message) => message.id === read.id)),
          ...shown,
        ]);
      }
      setEarlierCursor(result.value.next_cursor);
    } catch (error) {
      setProblem(unreachableMessage(error));
    }
  }

  /** A Message now whole: in its place by its id, or after the others as the newest. */
  function place(message: Message) {
    if (message.from === "agent") setWriting(null);
    // What a Run spent is counted once it ends, and may bring the warning or the cap.
    if (message.from === "agent" && message.run.ended !== null) void readSpend();
    const at = messages.findIndex((shown) => shown.id === message.id);
    if (at !== -1) return setMessages(at, reconcile(message, { key: "id" }));
    setMessages((shown) => [...shown, message]);
  }

  // At the cap the composer gives way to a Notice. Whether the cap is reached is the spend's to say,
  // read for the whole screen.
  const capReached = () => spend()?.notice === "cap_reached";

  // Read once the live channel is open, so a Message added meanwhile is either read or brought.
  onMount(async () => {
    await live.ready;
    await loadPage();
  });
  onCleanup(
    live.listen({
      answer: setWriting,
      message: place,
      // What was said while the channel was down is not replayed: the newest page is read.
      rejoined: async () => {
        await loadPage();
      },
    }),
  );

  return (
    <Peer
      id="conversation"
      title="Conversation"
      aside={<span class="peer-note">with the Agent, in {props.contextName}</span>}
    >
      <div class="peer-body">
        <Show when={earlierCursor()}>
          {(cursor) => (
            <button type="button" class="quiet" onClick={() => loadPage(cursor())}>
              Show earlier Messages
            </button>
          )}
        </Show>
        <ol class="message-list" aria-label="Messages">
          <For each={messages}>
            {(message) => (
              <Show
                when={message.from === "agent" ? (message as AgentMessage) : null}
                fallback={
                  <li class="message from-person" data-testid="message">
                    <span class="message-from">You</span>
                    <p class="message-words">{message.words}</p>
                  </li>
                }
              >
                {(said) => <AgentMessageItem message={said()} onShowRecord={props.onShowRecord} />}
              </Show>
            )}
          </For>
          <Show when={writing()}>
            {(words) => (
              <li class="message from-agent writing" aria-busy="true">
                <span class="message-from">Agent</span>
                <Words words={words()} />
              </li>
            )}
          </Show>
        </ol>
      </div>
      <div class="peer-foot">
        <Show when={problem()}>
          {(message) => (
            <p class="problem" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show when={agent() === "no_key"}>
          <p class="notice" role="status">
            There is no Agent here: this Deployment's configuration gives no key for its model. The
            Journal works as ever.
          </p>
        </Show>
        <Show when={agent() === "model_has_no_price"}>
          <p class="notice" role="status">
            There is no Agent here: this Deployment's configuration names a model Praxis ships no
            price for. The Journal works as ever.
          </p>
        </Show>
        <Show when={agent() === "available" && capReached()}>
          <div class="cap-reached">
            <CapNotice />
            <button type="button" class="quiet" onClick={() => props.onShowCap()}>
              Raise the cap in settings
            </button>
          </div>
        </Show>
        <Show when={agent() === "available" && !capReached()}>
          <MessageComposer
            contextName={props.contextName}
            onSent={(message) => {
              setProblem(null);
              place(message);
            }}
            onProblem={setProblem}
          />
        </Show>
      </div>
    </Peer>
  );
}

/** A Message from the Agent, shown as an Entry's words are, with its Run's calls folded under it. */
function AgentMessageItem(props: {
  message: AgentMessage;
  onShowRecord: (anchor: string) => void;
}) {
  const run = () => props.message.run;
  const heldChanges = useHeldChanges();
  // A Held Change the Run left waits here, where the Agent left it, until it is made, cancelled or
  // lapses (section 8.5).
  const leftForTap = () =>
    run()
      .calls.flatMap((call) => call.effects)
      .filter((effect) => effect.kind === "held_change" && effect.what === "made")
      .flatMap((effect) => heldChanges.find(effect.id) ?? []);
  return (
    <li class="message from-agent" data-testid="message">
      <span class="message-from">Agent</span>
      <Show when={props.message.words}>
        <Words words={props.message.words} />
      </Show>
      <For each={leftForTap()}>{(held) => <HeldChangeItem held={held} />}</For>
      {/* Opened, it shows the Run's calls, and once it has ended, what it cost. */}
      <Show when={run().calls.length > 0 || run().cost !== null}>
        <details class="run-calls">
          <summary>
            {callCount(run().calls.length)}
            <Show when={run().ended === null}> so far</Show>
          </summary>
          <Show when={run().calls.length > 0}>
            <ul aria-label="Calls">
              <For each={run().calls}>
                {(call) => <CallItem call={call} onShowRecord={props.onShowRecord} />}
              </For>
            </ul>
          </Show>
          <Show when={run().cost !== null}>
            <p class="run-cost">Cost {moneyFormat.format(run().cost ?? 0)}</p>
          </Show>
        </details>
      </Show>
    </li>
  );
}

function callCount(count: number): string {
  if (count === 0) return "No calls";
  return count === 1 ? "1 call" : `${count} calls`;
}

/** What each kind of thing a change can touch is called, in the glossary's words. */
const KIND: Record<Effect["kind"], string> = {
  entry: "Entry",
  task: "Task",
  project: "Project",
  person: "Person",
  context: "Context",
  held_change: "Held Change",
  connection: "Connection",
  spend_cap: "Spend cap",
};

/** What each way a change touched a record is called. */
const DID: Record<Effect["what"], string> = {
  made: "Made",
  changed: "Changed",
  deleted: "Deleted",
};

/** One call of a Run: the tool, how it went, and each change it made, linked to its record. */
function CallItem(props: { call: RunCall; onShowRecord: (anchor: string) => void }) {
  return (
    <li class="run-call">
      <code>{props.call.tool}</code>
      <Show when={props.call.result !== "ok"}>
        <span class="call-result">{props.call.result}</span>
      </Show>
      <Show when={props.call.effects.length > 0}>
        <ul aria-label="Changes">
          <For each={props.call.effects}>
            {(effect) => (
              <li>
                {DID[effect.what]} {KIND[effect.kind]}:{" "}
                <Show
                  when={
                    effect.what !== "deleted" && (effect.kind === "entry" || effect.kind === "task")
                      ? recordAnchor(effect.kind, effect.id)
                      : null
                  }
                  fallback={<span>{effect.summary}</span>}
                >
                  {(anchor) => (
                    <a
                      href={`#${anchor()}`}
                      onClick={(event) => {
                        event.preventDefault();
                        props.onShowRecord(anchor());
                      }}
                    >
                      {effect.summary}
                    </a>
                  )}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}

/** The Conversation's composer, which sends a Message to the Agent and nothing else (ADR 0022). */
function MessageComposer(props: {
  contextName: string | undefined;
  onSent: (message: Message) => void;
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  const [words, setWords] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const canSend = () => !sending() && words().trim() !== "";

  async function send() {
    if (!canSend()) return;
    setSending(true);
    try {
      const result = await callTool("send_message", { words: words() });
      if (!result.ok) {
        // Refused for the cap: read the spend, so the Notice takes the composer's place.
        if (result.error.in_the_way?.some((thing) => thing.kind === "spend_cap")) {
          void readSpend();
        }
        return props.onProblem(result.error.message);
      }
      setWords("");
      props.onSent(result.value.message);
    } catch (error) {
      props.onProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <div class="composer-area">
      <form
        class="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {/* Colour never carries the Context alone: the composer names it. */}
        <label for="new-message" class="composer-label">
          {props.contextName ? `Message the Agent in ${props.contextName}` : "Message the Agent"}
        </label>
        <div class="composer-row">
          <textarea
            id="new-message"
            rows={2}
            value={words()}
            onInput={(event) => setWords(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button type="submit" disabled={!canSend()}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

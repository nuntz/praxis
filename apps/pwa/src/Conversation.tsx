import type {
  AgentMessage,
  Effect,
  Message,
  MessagesPage,
  PersonMessage,
  RunCall,
  RunFailure,
} from "@praxis/domain";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { Peer } from "./design/Peer.tsx";
import { HeldChangeItem, useHeldChanges } from "./HeldChanges.tsx";
import { recordAnchor } from "./Journal.tsx";
import { useLive } from "./live-context.ts";
import { readNotices } from "./Notices.tsx";
import { online } from "./online.ts";
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
 * the cap in settings take the composer's place, and without a network a Notice saying so. A
 * person's Message whose Run failed keeps a Notice under it, and the newest a way to try again.
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
    // A Run that ended counts what it spent, which may bring the warning or the cap, and may have
    // found the key refused or taken: a failed one's Notice comes on the person's Message.
    if (
      (message.from === "agent" && message.run.ended !== null) ||
      (message.from === "person" && message.notice !== null)
    ) {
      void readSpend();
      void readNotices();
    }
    const at = messages.findIndex((shown) => shown.id === message.id);
    if (at !== -1) return setMessages(at, reconcile(message, { key: "id" }));
    setMessages((shown) => [...shown, message]);
  }

  /**
   * The person's Message as a tool answered with it, sent or tried again. The live channel may
   * have brought it already, and newer: a Run can fail before the answer arrives. So it is placed
   * only where it is not shown, or where what is shown is the Run it says it replaced.
   */
  function placeAnswered(message: PersonMessage, replacing?: string) {
    const shown = messages.find((placed) => placed.id === message.id) as PersonMessage | undefined;
    if (shown === undefined || (replacing !== undefined && shown.notice?.run === replacing)) {
      place(message);
    }
  }

  /** The newest of the person's Messages: only its Run can be tried again. */
  const newestOfPerson = createMemo(() =>
    messages.findLast((message) => message.from === "person"),
  );

  /** Try the failed Run under the person's Message again. */
  async function retry(message: PersonMessage): Promise<void> {
    // Read before the call: the Message is the one shown, which the live channel may change
    // while the call is out, as when the Run tried again fails before its answer arrives.
    const failed = message.notice?.run;
    if (failed === undefined) return;
    try {
      const result = await callTool("retry_run", { run: failed });
      if (!result.ok) {
        if (result.error.in_the_way?.some((thing) => thing.kind === "spend_cap")) {
          void readSpend();
        }
        setProblem(result.error.message);
        return;
      }
      setProblem(null);
      placeAnswered(result.value.message, failed);
    } catch (error) {
      setProblem(unreachableMessage(error));
    }
  }

  // At the cap the composer gives way to a Notice. Whether the cap is reached is the spend's to say,
  // read for the whole screen.
  const capReached = () => spend()?.notice === "cap_reached";

  /**
   * What the foot of the Conversation shows, in place of the composer or as it: no Agent, no
   * network, the cap reached, or the composer, when a Message can be sent and a Run tried again.
   */
  const foot = (): MessagesPage["agent"] | "offline" | "cap_reached" | "composer" | null => {
    const there = agent();
    if (there !== "available") return there;
    if (!online()) return "offline";
    return capReached() ? "cap_reached" : "composer";
  };

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
                  <PersonMessageItem
                    message={message as PersonMessage}
                    canRetry={message.id === newestOfPerson()?.id && foot() === "composer"}
                    onRetry={retry}
                  />
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
        <Show when={foot() === "no_key"}>
          <p class="notice" role="status">
            There is no Agent here: this Deployment's configuration gives no key for its model. The
            Journal works as ever.
          </p>
        </Show>
        <Show when={foot() === "model_has_no_price"}>
          <p class="notice" role="status">
            There is no Agent here: this Deployment's configuration names a model Praxis ships no
            price for. The Journal works as ever.
          </p>
        </Show>
        <Show when={foot() === "offline"}>
          <p class="notice" role="status">
            No network: the Conversation needs one. The Agent can be reached again once this Device
            is back online.
          </p>
        </Show>
        <Show when={foot() === "cap_reached"}>
          <div class="cap-reached">
            <CapNotice />
            <button type="button" class="quiet" onClick={() => props.onShowCap()}>
              Raise the cap in settings
            </button>
          </div>
        </Show>
        <Show when={foot() === "composer"}>
          <MessageComposer
            contextName={props.contextName}
            onSent={(message) => {
              setProblem(null);
              placeAnswered(message);
            }}
            onProblem={setProblem}
          />
        </Show>
      </div>
    </Peer>
  );
}

/** Why a Run failed, as the Notice under the person's Message says it. */
const FAILED: Record<RunFailure, string> = {
  model_unavailable:
    "The model could not be reached, so the Agent did not answer. Your Message is kept.",
  key_refused:
    "The model's provider refused this Deployment's key, so the Agent did not answer. Your Message is kept.",
};

/**
 * A Message from the person, shown as typed. While its Run has failed, a Notice under it says why,
 * which is not a Message, with a way to try again on the newest (section 8.5).
 */
function PersonMessageItem(props: {
  message: PersonMessage;
  canRetry: boolean;
  onRetry: (message: PersonMessage) => Promise<void>;
}) {
  const [retrying, setRetrying] = createSignal(false);
  return (
    <li class="message from-person" data-testid="message">
      <span class="message-from">You</span>
      <p class="message-words">{props.message.words}</p>
      <Show when={props.message.notice}>
        {(notice) => (
          <div class="run-notice">
            <p class="notice" role="status">
              {FAILED[notice().failure]}
            </p>
            <Show when={props.canRetry}>
              <button
                type="button"
                class="quiet"
                disabled={retrying()}
                onClick={async () => {
                  setRetrying(true);
                  try {
                    await props.onRetry(props.message);
                  } finally {
                    setRetrying(false);
                  }
                }}
              >
                Try again
              </button>
            </Show>
          </div>
        )}
      </Show>
    </li>
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
  onSent: (message: PersonMessage) => void;
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

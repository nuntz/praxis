import type {
  AgentMessage,
  CallEnd,
  ClockFold,
  Effect,
  Message,
  MessagesPage,
  PersonMessage,
  RunCall,
  RunFailure,
} from "@praxis/domain";
import { runTranscriptName } from "@praxis/domain";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { DeviceCall } from "./call.ts";
import { Peer } from "./design/Peer.tsx";
import { download } from "./Export.tsx";
import { followNewest } from "./follow-newest.tsx";
import { HeldChangeItem, useHeldChanges } from "./HeldChanges.tsx";
import { recordAnchor } from "./Journal.tsx";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { readNotices } from "./Notices.tsx";
import { online } from "./online.ts";
import { CapNotice, readSpend, spend } from "./Spend.tsx";
import { callDeploymentTool, unreachableMessage, useCallTool } from "./tools.ts";
import { Words } from "./Words.tsx";

const moneyFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 2,
});

/**
 * How many Briefs and Reviews the current Context's Conversation shows that are not yet read: the
 * Agent tab carries it as a badge on a phone (section 8.5).
 */
const [unread, setUnread] = createSignal(0);

export { unread as unreadBriefs };

/**
 * The Conversation with the Agent in the current Context (section 8.5): every Message, scrollable
 * to the start, and the composer that sends one. The Agent's answer is shown as it is written, and
 * a Run's calls fold under the Message it left. Without the model's key there is no Agent, and the
 * Conversation says so in place of its composer; at the spend cap, the cap's Notice and a way to
 * the cap in settings take the composer's place, and without a network a Notice saying so. A
 * person's Message whose Run failed keeps a Notice under it, and the newest a way to try again.
 * With the voice key a Call can be started from the composer, and on this Device while it goes on
 * the composer gives way to the Call's controls (section 6).
 */
export function Conversation(props: {
  contextId: string;
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
  const [voice, setVoice] = createSignal<MessagesPage["voice"]>("no_key");
  // The Call going on this Device in this Context, and while one is being set up.
  const [call, setCall] = createSignal<DeviceCall | null>(null);
  const [calling, setCalling] = createSignal(false);
  const [muted, setMuted] = createSignal(false);
  // Why the last Call ended, when it was not the person's tap: a Notice, never a Message.
  const [callEnded, setCallEnded] = createSignal<string | null>(null);
  // The Messages open at their newest, beside the composer (section 8.1). With no network none
  // is shown, and the column is back where it was once one is.
  const column = followNewest({ items: () => messages, anchored: online });

  /**
   * The newest page, read afresh, the last read's answer winning: a burst of changes to Tasks
   * while a Brief is shown reads it several times (CODING_STANDARDS.md, Reads and changes).
   */
  const newest = latestRead((current) => loadPage(undefined, current));

  async function loadPage(cursor?: string, current: () => boolean = () => true) {
    try {
      const result = await callTool("list_messages", cursor === undefined ? {} : { cursor });
      if (!current()) return;
      if (!result.ok) return setProblem(result.error.message);
      setAgent(result.value.agent);
      setVoice(result.value.voice);
      const page = result.value.items.toReversed();
      if (cursor === undefined) {
        // The newest page, read afresh: what the live channel brought meanwhile is kept once.
        setMessages((shown) => [
          ...page,
          ...shown.filter((message) => !page.some((read) => read.id === message.id)),
        ]);
      } else {
        // An earlier page goes above, keeping what is in view where it was.
        column.keepPlace(() =>
          setMessages((shown) => [
            ...page.filter((read) => !shown.some((message) => message.id === read.id)),
            ...shown,
          ]),
        );
      }
      setEarlierCursor(result.value.next_cursor);
    } catch (error) {
      setProblem(unreachableMessage(error));
    }
  }

  /**
   * A Message now whole: in its place by its id, or after the others as the newest. A new Brief
   * or Review replaces one of its kind not yet read (section 5.4).
   */
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
    const replacing = message.from === "agent" ? message.clock : null;
    setMessages((shown) => [
      ...shown.filter(
        (placed) =>
          !(
            replacing &&
            placed.from === "agent" &&
            placed.clock?.kind === replacing.kind &&
            !placed.clock.read
          ),
      ),
      message,
    ]);
  }

  /**
   * Praxis has shown a Brief or a Review in a focused window: say so, so it is read on every
   * Device. It is shown read here once the server has said so.
   */
  async function shown(message: AgentMessage): Promise<void> {
    try {
      const result = await callTool("note_shown", { message: message.id });
      if (!result.ok) return;
      const at = messages.findIndex((placed) => placed.id === message.id);
      const placed = messages[at];
      if (placed?.from === "agent" && placed.clock) {
        setMessages(at, reconcile({ ...placed, clock: { ...placed.clock, read: true } }));
      }
    } catch (error) {
      // Not shown as a problem: the next time it is in view, it is noted again.
      unreachableMessage(error);
    }
  }

  createEffect(() =>
    setUnread(
      messages.filter((message) => message.from === "agent" && message.clock?.read === false)
        .length,
    ),
  );
  onCleanup(() => setUnread(0));

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
        readSpendIfCapped(result.error);
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
    // With no network the Conversation says only that it needs one, read or not (section 8.8).
    if (!online()) return "offline";
    const there = agent();
    if (there !== "available") return there;
    return capReached() ? "cap_reached" : "composer";
  };

  /**
   * Start a Call in this Context. What the person says is sent as spoken Messages, each placed as
   * a typed one is, and the Agent's answers are passed back to be spoken.
   */
  async function startCall(): Promise<void> {
    if (calling() || call()) return;
    setCalling(true);
    setCallEnded(null);
    setProblem(null);
    try {
      const started = await DeviceCall.start(callTool, {
        ask: async (words) => {
          try {
            const result = await callTool("send_message", { words, spoken: true });
            if (!result.ok) {
              readSpendIfCapped(result.error);
              setProblem(result.error.message);
              return { refused: result.error.message };
            }
            placeAnswered(result.value.message);
            column.toNewest();
            return { message: result.value.message.id };
          } catch (error) {
            const why = unreachableMessage(error);
            setProblem(why);
            return { refused: why };
          }
        },
        failed: (notice) => FAILED[notice.failure],
        ended: ({ ended, reason, record }) => {
          setCall(null);
          setMuted(false);
          setCallEnded(callEndedWords(record?.ended ?? ended, record?.provider_reason ?? reason));
          // A Call counts toward the month's spend, which may now near or reach the cap.
          void readSpend();
          void readNotices();
        },
      });
      if (typeof started === "string") {
        setProblem(started);
        // Refused at the cap, whose Notice then takes the composer's place, or for the voice key,
        // whose standing Notice the Deployment now holds.
        void readSpend();
        void readNotices();
      } else setCall(started);
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setCalling(false);
    }
  }

  // A Call belongs to the Context it was started in: switching away, or leaving, ends it.
  onCleanup(() => void call()?.hangUp());

  // Read once the live channel is open, so a Message added meanwhile is either read or brought.
  onMount(async () => {
    await live.ready;
    await newest.read();
  });
  onCleanup(
    live.listen({
      answer: setWriting,
      message: (message) => {
        place(message);
        call()?.answer(message);
      },
      gone: (id) => setMessages((shown) => shown.filter((message) => message.id !== id)),
      // Cleared, from this Device or another: every Message is gone, and the Conversation starts
      // afresh from the newest page, read again.
      cleared: async () => {
        setMessages([]);
        setEarlierCursor(null);
        setWriting(null);
        await newest.read();
      },
      // A Brief or Review says how many of the Tasks it names have been finished since: a change to
      // a Task may change that, so the newest page is read again while one is shown.
      changed: async (change) => {
        const briefShown = messages.some((message) => message.from === "agent" && message.clock);
        if (briefShown && change.effects.some((effect) => effect.kind === "task")) {
          await newest.read();
        }
      },
      // What was said while the channel was down is not replayed: the newest page is read.
      rejoined: async () => {
        await newest.read();
      },
    }),
  );

  return (
    <Peer
      id="conversation"
      title="Conversation"
      aside={<span class="peer-note">with the Agent, in {props.contextName}</span>}
    >
      <div class="peer-body" ref={column.scroller}>
        <Show when={online() && earlierCursor()}>
          {(cursor) => (
            <button type="button" class="quiet" onClick={() => loadPage(cursor())}>
              Show earlier Messages
            </button>
          )}
        </Show>
        {/* With no network nothing of the Conversation is shown, an unread Brief included. */}
        <ol class="message-list" aria-label="Messages" hidden={!online()} ref={column.content}>
          <For each={messages}>
            {(message) => (
              <Show
                when={message.from === "agent" ? (message as AgentMessage) : null}
                fallback={
                  <PersonMessageItem
                    contextId={props.contextId}
                    message={message as PersonMessage}
                    canRetry={message.id === newestOfPerson()?.id && foot() === "composer"}
                    onRetry={retry}
                  />
                }
              >
                {(said) => (
                  <AgentMessageItem
                    contextId={props.contextId}
                    message={said()}
                    onShowRecord={props.onShowRecord}
                    onShown={shown}
                  />
                )}
              </Show>
            )}
          </For>
          <Show when={writing()}>
            {(words) => (
              <li class="message from-agent writing" aria-busy="true">
                <span class="message-from">Agent</span>
                <Words words={words()} images="never" />
              </li>
            )}
          </Show>
        </ol>
      </div>
      <div class="peer-foot">
        <column.JumpToLatest />
        {/* With no network the notice below says what a call that could not be made would. */}
        <Show when={foot() !== "offline" && problem()}>
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
        <Show when={foot() === "unavailable"}>
          <p class="notice" role="status">
            This Conversation cannot be opened under this release of Praxis, so the Agent answers
            nothing here. Nothing in the Journal is touched, and it works as ever. Clearing the
            Conversation in this Context's settings starts it afresh.
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
        <Show when={callEnded()}>
          {(why) => (
            <p class="notice" role="status">
              {why()}
            </p>
          )}
        </Show>
        {/* A Call going keeps its controls, offline or at the cap too, so it can always be ended. */}
        <Show when={call()}>
          {(going) => (
            <CallControls
              contextName={props.contextName}
              muted={muted()}
              onMute={(on) => {
                going().mute(on);
                setMuted(going().muted);
              }}
              onEnd={() => void going().hangUp()}
            />
          )}
        </Show>
        <Show when={foot() === "composer" && !call()}>
          <MessageComposer
            contextName={props.contextName}
            onSent={(message) => {
              setProblem(null);
              placeAnswered(message);
              column.toNewest();
            }}
            onProblem={setProblem}
          />
          <Show when={voice() === "available"}>
            <button
              type="button"
              class="quiet start-call"
              disabled={calling()}
              onClick={() => void startCall()}
            >
              {calling() ? "Starting a Call…" : "Start a Call"}
            </button>
          </Show>
        </Show>
      </div>
    </Peer>
  );
}

/**
 * Why a Call ended, as the Notice in the Conversation's foot says it, or null for the person's own
 * tap, which needs none: as the object's record says, or, when the object could not be reached,
 * as this Device saw it. The provider's reason is its own word for it.
 */
function callEndedWords(ended: CallEnd, reason: string | null): string | null {
  switch (ended) {
    case "hung_up":
      return null;
    case "lost":
      return "The Call ended: the connection to the voice provider was lost.";
    case "left":
      return "The Call ended when Praxis was left: the tab hidden, the screen locked or the network gone.";
    case "silence":
      return "The Call ended after two minutes in which nothing was said.";
    case "replaced":
      return "The Call ended: another Call was started in this Deployment.";
    case "no_sign_of_life":
      return "The Call ended: Praxis heard nothing from this Device for 45 seconds.";
    case "cap_reached":
      return "The Call ended: this month's spend reached its cap.";
    case "provider_ended":
      break;
  }
  switch (reason) {
    case "expired":
      return "The Call ended: it reached the voice provider's two-hour limit.";
    case "content":
      return "The Call ended: the voice provider's safety filter ended it.";
    default:
      return "The Call ended: the voice provider ended it.";
  }
}

/**
 * The Call's controls, which the Conversation's composer gives way to on the Device in the Call
 * (section 6): end it, and mute, which turns the microphone off while the Call goes on.
 */
function CallControls(props: {
  contextName: string | undefined;
  muted: boolean;
  onMute: (muted: boolean) => void;
  onEnd: () => void;
}) {
  return (
    <section
      class="call-controls"
      aria-label={props.contextName ? `Call in ${props.contextName}` : "Call"}
    >
      <p class="call-status" role="status">
        {props.muted ? "In a Call, muted" : "In a Call: speak to the Agent"}
      </p>
      <div class="call-buttons">
        <button type="button" aria-pressed={props.muted} onClick={() => props.onMute(!props.muted)}>
          Mute
        </button>
        <button type="button" class="end-call" onClick={() => props.onEnd()}>
          End the Call
        </button>
      </div>
    </section>
  );
}

/**
 * A call refused for the spend cap: read the spend, so the cap's Notice takes the composer's place.
 */
function readSpendIfCapped(error: { in_the_way?: { kind: string }[] }): void {
  if (error.in_the_way?.some((thing) => thing.kind === "spend_cap")) void readSpend();
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
 * which is not a Message, with a way to try again on the newest (section 8.5), and to save the
 * failed Run's transcript, for debugging.
 */
function PersonMessageItem(props: {
  contextId: string;
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
            <SaveTranscript contextId={props.contextId} run={notice().run} />
          </div>
        )}
      </Show>
    </li>
  );
}

/**
 * Call `then` once the element is shown in a focused window: on the screen, in a window that has
 * the focus and is not hidden. A column or tab not shown is not on the screen.
 */
function whenShown(element: Element, then: () => void): () => void {
  let inView = false;
  let done = false;
  const check = () => {
    if (done || !inView || !document.hasFocus() || document.visibilityState !== "visible") return;
    done = true;
    then();
  };
  const observer = new IntersectionObserver((entries) => {
    inView = entries.some((entry) => entry.isIntersecting);
    check();
  });
  observer.observe(element);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
  return () => {
    observer.disconnect();
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", check);
  };
}

const takenFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const CLOCK_NAMED: Record<ClockFold["kind"], string> = { brief: "Brief", review: "Review" };

/** What a Brief or a Review says of itself: when it was taken, and what has been finished since. */
function ClockHeading(props: { clock: ClockFold }) {
  const finished = () => props.clock.finished_since;
  return (
    <p class="clock-taken">
      <strong>{CLOCK_NAMED[props.clock.kind]}</strong>, taken{" "}
      <time datetime={props.clock.taken}>{takenFormat.format(new Date(props.clock.taken))}</time>
      <Show when={finished() > 0}>
        .{" "}
        {finished() === 1
          ? "A Task it names has been finished since."
          : `${finished()} Tasks it names have been finished since.`}
      </Show>
    </p>
  );
}

/** A Message from the Agent, shown as an Entry's words are, with its Run's calls folded under it. */
function AgentMessageItem(props: {
  contextId: string;
  message: AgentMessage;
  onShowRecord: (anchor: string) => void;
  /** A Brief or Review not yet read has been shown in a focused window. */
  onShown: (message: AgentMessage) => void;
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
  let item!: HTMLLIElement;
  onMount(() => {
    if (props.message.clock?.read !== false) return;
    onCleanup(whenShown(item, () => props.onShown(props.message)));
  });
  return (
    <li
      ref={item}
      class="message from-agent"
      classList={{ unread: props.message.clock?.read === false }}
      data-testid="message"
    >
      <span class="message-from">Agent</span>
      <Show when={props.message.clock}>{(clock) => <ClockHeading clock={clock()} />}</Show>
      <Show when={props.message.words}>
        <Words words={props.message.words} images="never" testId="words" />
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
          <Show when={run().ended !== null}>
            <SaveTranscript contextId={props.contextId} run={run().id} />
          </Show>
        </details>
      </Show>
    </li>
  );
}

/**
 * Save one Run as a file, for debugging (section 5.8): what the Agent was given, said and called.
 * It is the only way the Conversation's text leaves Praxis, and only the person's tap saves one.
 */
function SaveTranscript(props: { contextId: string; run: string }) {
  const [saving, setSaving] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  async function save() {
    setSaving(true);
    try {
      const result = await callDeploymentTool("save_run_transcript", {
        context_id: props.contextId,
        run_id: props.run,
      });
      if (!result.ok) return setProblem(result.error.message);
      setProblem(null);
      download(
        new Blob([JSON.stringify(result.value, null, 2)], { type: "application/json" }),
        runTranscriptName(result.value),
      );
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="run-transcript">
      <button type="button" class="quiet" disabled={saving()} onClick={() => void save()}>
        {saving() ? "Saving the transcript…" : "Save this Run's transcript"}
      </button>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
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
  device: "Device",
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
        readSpendIfCapped(result.error);
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

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
import ArrowUp from "lucide-solid/icons/arrow-up";
import MicIcon from "lucide-solid/icons/mic";
import MicOffIcon from "lucide-solid/icons/mic-off";
import PhoneIcon from "lucide-solid/icons/phone";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { DeviceCall } from "./call.ts";
import { partIntoDays } from "./days.tsx";
import { Peer } from "./design/Peer.tsx";
import { download } from "./Export.tsx";
import { followNewest } from "./follow-newest.tsx";
import { HeldChangeItem, useHeldChanges } from "./HeldChanges.tsx";
import { recordAnchor } from "./Journal.tsx";
import { CONVERSATION_COMPOSER, ComposerKey } from "./keys.tsx";
import { latestRead } from "./latest-read.ts";
import { useLive } from "./live-context.ts";
import { readNotices } from "./Notices.tsx";
import { online } from "./online.ts";
import { afterPress } from "./press.ts";
import { CapLink } from "./SettingsLink.tsx";
import { CapNotice, readSpend, spend } from "./Spend.tsx";
import { callDeploymentTool, unreachableMessage, useCallTool } from "./tools.ts";
import { Words } from "./Words.tsx";

const moneyFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 2,
});

/**
 * The kinds of the Briefs and Reviews the current Context's Conversation shows that are not yet
 * read, at most one of each: the Agent tab carries a mark for them on a phone (section 8.5).
 */
const [unread, setUnread] = createSignal<ClockFold["kind"][]>([]);

export { unread as unreadBriefs };

/**
 * Whether the current Context's Conversation shows its composer, which offline, at the cap and in a
 * Call it does not: the skip link to it shows only while it does (section 8.11).
 */
const [composerShown, setComposerShown] = createSignal(false);

export { composerShown as conversationComposerShown };

/**
 * The Conversation with the Agent in the current Context (section 8.5): every Message, scrollable
 * to the start, and the composer that sends one. The Agent's answer is shown as it is written, and
 * a Run's calls fold under the Message it left. Without the model's key there is no Agent, and the
 * Conversation says so in place of its composer; at the spend cap, the cap's Notice and a way to
 * the cap in settings take the composer's place, and without a network a Notice saying so. A
 * person's Message whose Run failed keeps a Notice under it, and the newest a way to try again.
 * With the voice key and an Agent a Call starts from the Call button in the header, shown but not
 * pressable offline or at the cap, saying why. On this Device while a Call goes on the header is
 * a status bar with the time so far, and the composer gives way to Mute and End (section 6).
 */
export function Conversation(props: {
  contextId: string;
  contextName: string | undefined;
  /**
   * The zone the Context's times are shown in, by which the Messages are parted into days: its
   * own, or before its settings are read, the Offline Copy's or the Device's.
   */
  timeZone: string | undefined;
  /** Bring a record a Run changed into view, wherever it is shown. */
  onShowRecord: (anchor: string) => void;
  /** Out of reach under Attention opened in between (section 8.1). */
  inert?: boolean;
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
  // Parted into days in the Context's zone, each caption inside the list so the column sees it
  // change size.
  const { DayStart } = partIntoDays(() => props.timeZone);
  /**
   * When the Message at this place was made, for its day: the person's when sent, a Brief's or a
   * Review's when taken. An answer carries no time of its own and falls on the day of what it
   * answers, the Message before it; none is known before the first one that has a time. The place
   * after the last is the answer being written, which falls on the day of the last that has one.
   */
  function madeAt(index: number): string | undefined {
    for (let at = index; at >= 0; at--) {
      const message = messages[at];
      if (message?.from === "person") return message.at;
      if (message?.clock) return message.clock.taken;
    }
    return undefined;
  }

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

  createEffect(() => {
    const kinds = messages.flatMap((message) =>
      message.from === "agent" && message.clock?.read === false ? [message.clock.kind] : [],
    );
    setUnread((["brief", "review"] as const).filter((kind) => kinds.includes(kind)));
  });
  onCleanup(() => setUnread([]));

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
   * What the Call button in the header shows (section 8.5): nothing without the voice key or an
   * Agent, or while a Call goes on here, whose status bar takes the header's place; why it cannot
   * be pressed offline or at the cap; else that a Call can start.
   */
  const callOffer = (): CallOffer | null => {
    if (call() || voice() !== "available" || agent() !== "available") return null;
    if (!online()) return "offline";
    return capReached() ? "cap_reached" : "ready";
  };
  /** Why the Call button cannot be pressed, shown under it in words. */
  const noCall = () => {
    const offer = callOffer();
    return offer === null || offer === "ready" ? null : NO_CALL[offer];
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
      inert={props.inert}
      aside={
        <Show when={callOffer()}>
          {(offer) => (
            <CallButton
              contextName={props.contextName}
              offer={offer()}
              starting={calling()}
              onStart={() => void startCall()}
            />
          )}
        </Show>
      }
    >
      <Show when={noCall()}>
        {(why) => (
          <p id={CALL_UNAVAILABLE} class="call-unavailable">
            {why()}
          </p>
        )}
      </Show>
      <Show when={call()}>
        {(going) => <CallBar contextName={props.contextName} since={going().since} />}
      </Show>
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
            {(message, index) => (
              <>
                <DayStart at={madeAt(index())} before={madeAt(index() - 1)} />
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
                      timeZone={props.timeZone}
                      onShowRecord={props.onShowRecord}
                      onShown={shown}
                    />
                  )}
                </Show>
              </>
            )}
          </For>
          <Show when={writing()}>
            {(words) => (
              <>
                {/* Being written, it falls on the day of what it answers, as it will once written. */}
                <DayStart at={madeAt(messages.length)} before={madeAt(messages.length - 1)} />
                <li class="message from-agent writing" aria-busy="true">
                  <span class="message-from">Agent</span>
                  <Words words={words()} images="never" />
                </li>
              </>
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
            <CapLink />
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

/** What the Call button offers where it shows: a Call, or why none can start. */
type CallOffer = "ready" | keyof typeof NO_CALL;

/** Why the Call button cannot be pressed, in the words it is described by and shown under it. */
const NO_CALL = {
  offline: "Calls need the network.",
  cap_reached: "No Call can start: this month's spend reached its cap.",
} as const;

/** The id of the words under the Call button saying why it cannot be pressed. */
const CALL_UNAVAILABLE = "call-unavailable";

/**
 * The Call button in the Conversation's header (section 8.5): the phone icon and "Call", on a phone
 * too. Offline or at the cap it is shown but cannot be pressed, and is described by
 * why, in the words shown under it: it stays focusable, so the reason is heard as well as seen.
 */
function CallButton(props: {
  contextName: string | undefined;
  offer: CallOffer;
  starting: boolean;
  onStart: () => void;
}) {
  const name = () =>
    props.contextName ? `Start a Call with the Agent in ${props.contextName}` : "Start a Call";
  const why = () => (props.offer === "ready" ? null : NO_CALL[props.offer]);
  return (
    <button
      type="button"
      class="call-button"
      aria-label={name()}
      title={why() ?? name()}
      aria-disabled={why() !== null || props.starting ? "true" : undefined}
      aria-busy={props.starting ? "true" : undefined}
      aria-describedby={why() === null ? undefined : CALL_UNAVAILABLE}
      onClick={() => {
        if (why() === null && !props.starting) props.onStart();
      }}
    >
      <PhoneIcon size={18} aria-hidden="true" />
      Call
    </button>
  );
}

/** A length of time as a clock shows it, in minutes and seconds, and hours once there are any. */
function timeSoFar(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const two = (part: number) => String(part).padStart(2, "0");
  const hours = Math.floor(seconds / 3600);
  const minutes = two(Math.floor(seconds / 60) % 60);
  return hours > 0 ? `${hours}:${minutes}:${two(seconds % 60)}` : `${minutes}:${two(seconds % 60)}`;
}

/**
 * The status bar that takes the Conversation's header's place on the Device in a Call (section
 * 8.5): on a Call in this Context, and the time so far, counted on this Device's clock.
 */
function CallBar(props: { contextName: string | undefined; since: number }) {
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));
  return (
    <div class="call-bar">
      <span class="call-dot" aria-hidden="true" />
      <div class="call-bar-words">
        <p class="call-bar-title" role="status">
          {props.contextName ? `On a Call in ${props.contextName}` : "On a Call"}
        </p>
        <p class="call-bar-meta">
          {/* A timer is not read out as it changes, so the second hand says nothing. */}
          <span role="timer">{timeSoFar(now() - props.since)}</span> · what you say is kept as
          Messages
        </p>
      </div>
    </div>
  );
}

/**
 * The Call's controls, which the Conversation's composer gives way to on the Device in the Call
 * (section 6): mute, which turns the microphone off while the Call goes on, and End, on solid
 * `warn`, the phone icon turned, each a round button with its words under it.
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
      <button
        type="button"
        class="call-control mute"
        aria-pressed={props.muted}
        onClick={() => props.onMute(!props.muted)}
      >
        <span class="call-control-round">
          <MicOffIcon size={24} aria-hidden="true" />
        </span>
        Mute
      </button>
      <button type="button" class="call-control end" onClick={() => props.onEnd()}>
        <span class="call-control-round">
          <PhoneIcon size={26} aria-hidden="true" />
        </span>
        End Call
      </button>
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
  request_refused:
    "The model's provider refused Praxis's request, so the Agent did not answer. Your Message is kept.",
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
      <span class="message-from">
        You
        {/* Said in a Call, not typed: the mark is the screen's, never part of what was said. */}
        <Show when={props.message.spoken}>
          <span class="message-spoken">
            <MicIcon size={12} aria-hidden="true" />
            Spoken
          </span>
        </Show>
      </span>
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

const CLOCK_NAMED: Record<ClockFold["kind"], string> = { brief: "Brief", review: "Review" };

/**
 * What a Brief or a Review says of itself: when it was taken, and what has been finished since. Its
 * time is the time of day alone, in the Context's zone, as the caption above it says its day there.
 */
function ClockHeading(props: { clock: ClockFold; timeZone: string | undefined }) {
  const finished = () => props.clock.finished_since;
  const taken = () =>
    new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: props.timeZone }).format(
      new Date(props.clock.taken),
    );
  return (
    <p class="clock-taken">
      <strong>{CLOCK_NAMED[props.clock.kind]}</strong>, taken{" "}
      <time datetime={props.clock.taken}>{taken()}</time>
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
  /** The zone the Context's times are shown in. */
  timeZone: string | undefined;
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
      <Show when={props.message.clock}>
        {(clock) => <ClockHeading clock={clock()} timeZone={props.timeZone} />}
      </Show>
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
  // At rest, with nothing written and the focus elsewhere, it folds to one line (section 8.2).
  const [focused, setFocused] = createSignal(false);
  const folded = () => !focused() && words() === "";
  setComposerShown(true);
  onCleanup(() => setComposerShown(false));

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
        data-folded={folded() ? "" : undefined}
        onFocusIn={() => setFocused(true)}
        onFocusOut={(event) => {
          const form = event.currentTarget;
          afterPress(() => setFocused(form.contains(document.activeElement)));
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {/* Colour never carries the Context alone: the composer names it. */}
        <label for={CONVERSATION_COMPOSER} class="composer-label">
          <span class="composer-label-words">
            {props.contextName ? `Message the Agent in ${props.contextName}` : "Message the Agent"}
          </span>
          <ComposerKey shown={folded()} letter="m" />
        </label>
        <div class="composer-row">
          <textarea
            id={CONVERSATION_COMPOSER}
            rows={2}
            aria-keyshortcuts="m"
            value={words()}
            onInput={(event) => setWords(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {/* A well-known action, so its icon stands alone (section 8.11). */}
          <button
            type="submit"
            class="send-button"
            aria-label="Send"
            title="Send"
            disabled={!canSend()}
            data-nothing-to-send={words().trim() === "" ? "" : undefined}
          >
            <ArrowUp size={20} aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}

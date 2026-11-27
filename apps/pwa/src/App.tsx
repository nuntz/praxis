import {
  type ClockFold,
  type ContextListing,
  conversationOpened,
  type Settings,
} from "@praxis/domain";
import BookOpen from "lucide-solid/icons/book-open";
import Inbox from "lucide-solid/icons/inbox";
import MessageCircle from "lucide-solid/icons/message-circle";
import SettingsIcon from "lucide-solid/icons/settings";
import X from "lucide-solid/icons/x";
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Attention } from "./Attention.tsx";
import { deviceTimeZone } from "./ContextSettings.tsx";
import { ContextSwitcher } from "./ContextSwitcher.tsx";
import { NewContext } from "./Contexts.tsx";
import { Conversation, conversationComposerShown, unreadBriefs } from "./Conversation.tsx";
import { Badge } from "./design/Badge.tsx";
import { Mark } from "./design/Mark.tsx";
import { Peer, type PeerId } from "./design/Peer.tsx";
import { receiveShared, wantComposer } from "./draft.ts";
import { RestoreExport } from "./Export.tsx";
import { CurrentHeldChanges, followHeldChanges } from "./HeldChanges.tsx";
import { Journal } from "./Journal.tsx";
import {
  CONVERSATION_COMPOSER,
  followScreenKeys,
  JOURNAL_COMPOSER,
  type KeyTargets,
  SkipLinks,
} from "./keys.tsx";
import { latestRead } from "./latest-read.ts";
import { Live, socketOpener } from "./live.ts";
import { CurrentContextLive, type CurrentLive, liveAddress } from "./live-context.ts";
import { CurrentMoveTargets } from "./Move.tsx";
import { inBetween } from "./media.ts";
import { followNotices } from "./Notices.tsx";
import { contextCopy, copyFetchedAt, fetchIfMissing, keepCopyFresh } from "./offline-copy.ts";
import { online } from "./online.ts";
import { followAddress, leaveSettings, openSettings, place } from "./place.ts";
import { afterPress } from "./press.ts";
import { SettingsBar, SettingsScreen } from "./Settings.tsx";
import { followSpend } from "./Spend.tsx";
import { readStored, store } from "./stored.ts";
import {
  CurrentContextId,
  CurrentContextTools,
  callDeploymentTool,
  contextTools,
  signInLapsed,
  Unreachable,
  unreachableMessage,
} from "./tools.ts";
import { ClearingCopy, knowShownContexts, refusedIn, UnsentStatus } from "./Unsent.tsx";
import { keepSending } from "./unsent.ts";
import { type ComposerOpening, composerOpened, followLaunches } from "./ways-in.ts";

/**
 * How long the screen waits for the live channel before reading anyway, as behind a proxy that
 * refuses WebSockets. Once the channel opens, what was read is read afresh.
 */
const READY_WITHIN = 3000;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Where this browser keeps the Context it last showed, and the Contexts it last read, so Praxis
// opens on one with no network (stored.ts). Without storage the screen opens on the first Context
// with the network, and says so where it cannot reach it.
const LAST_SHOWN = "praxis.context";
const CONTEXTS_LAST_READ = "praxis.contexts";

/**
 * The main screen of the current Context: Attention, the Journal and the Conversation as three
 * peers (section 8.1, ADR 0022). Three columns on a desktop; in between, the Journal and the
 * Conversation, with Attention opened from the top bar; on a phone, three tabs, opening on
 * Attention. The widths are the stylesheet's; this holds which Context is current, which tab is
 * shown and whether Attention is open: in between, a layer over the other two, which are inert
 * while it is. Settings takes the main screen's place at its own address (section 8.6), with the
 * main screen kept underneath as it was left.
 */
export function App() {
  // The Deployment's Contexts, once read. One is current: the one this browser last showed, or
  // the first not retired. Everything below the top bar is that Context's alone.
  const [contexts, setContexts] = createSignal<ContextListing[] | null>(null);
  // A Notification's tap opens Praxis on its Context's Conversation (section 8.7).
  const opened = conversationOpened(location.search);
  if (opened !== null) {
    store(LAST_SHOWN, opened);
    history.replaceState(null, "", "/");
  }
  // The home-screen shortcut and the share sheet open Praxis on the Journal's composer, with what
  // was shared, or launch it into the window open (section 8.9).
  const openedAt = location.href;
  const openedOnComposer = composerOpened(new URL(openedAt));
  if (openedOnComposer) {
    openComposer(openedOnComposer);
    history.replaceState(null, "", "/");
  }
  // Read only now, once both are put back to `/`: Settings, or one of its sections, has an address
  // of its own, which the browser's back and forward move between (section 8.6).
  onCleanup(followAddress());
  const [chosen, setChosen] = createSignal<string | null>(opened ?? readStored(LAST_SHOWN));
  const current = createMemo(() => {
    const shown = (contexts() ?? []).filter((context) => !context.retired);
    return shown.find((context) => context.id === chosen()) ?? shown[0] ?? null;
  });
  const currentId = createMemo(() => current()?.id ?? null);

  const [settings, setSettings] = createSignal<Settings | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<PeerId>(
    opened !== null ? "conversation" : openedOnComposer ? "journal" : "attention",
  );
  const [attentionOpen, setAttentionOpen] = createSignal(false);
  // Without the settings the Journal is still shown, its times in the Context's zone as the
  // Offline Copy holds it, or with no copy in the Device's zone.
  const [unread, setUnread] = createSignal(false);
  const timeZone = createMemo(() => {
    const read = settings()?.time_zone;
    if (read !== undefined || !unread()) return read;
    const id = currentId();
    return (id === null ? null : contextCopy(id))?.time_zone ?? deviceTimeZone();
  });
  // The count is the Unsent writes the server refused, the Held Changes and the Due section
  // (section 8.3).
  const [dueCount, setDueCount] = createSignal(0);
  const [heldCount, setHeldCount] = createSignal(0);
  const refusedCount = () => {
    const id = currentId();
    return id === null ? 0 : refusedIn(id).length;
  };
  const count = () => refusedCount() + dueCount() + heldCount();
  let attentionButton!: HTMLButtonElement;
  let attentionHeading: HTMLHeadingElement | undefined;

  // In between, Attention open is a layer: the Journal and the Conversation under it are inert, so
  // Tab, a pointer and a screen reader reach only Attention and the top bar. A press outside it
  // closes it, and they stay inert until that press is done: on a touch screen the press's mouse
  // events and its click are aimed once the finger lifts, and would land on what is under it.
  const layered = () => attentionOpen() && inBetween();
  const [pressedOut, setPressedOut] = createSignal(false);
  const underLayer = () => layered() || pressedOut();

  /** Open Attention from the top bar, the focus on its heading, read out with its count. */
  function openAttention() {
    setAttentionOpen(true);
    attentionHeading?.focus();
  }

  /** Put Attention away, by its button, its Close or Escape, the focus back on its button. */
  function closeAttention() {
    setAttentionOpen(false);
    attentionButton.focus();
  }

  function putAttentionAway(event: KeyboardEvent) {
    if (event.key !== "Escape" || !attentionOpen()) return;
    closeAttention();
  }

  createEffect(() => {
    if (!layered()) return;
    const outside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("#attention, .top-bar")) return;
      setPressedOut(true);
      setAttentionOpen(false);
      afterPress(() => setPressedOut(false));
    };
    document.addEventListener("pointerdown", outside, true);
    onCleanup(() => document.removeEventListener("pointerdown", outside, true));
  });

  /**
   * Give a composer the caret: its column shown first, on a phone its tab and in between with
   * Attention shut, since a field in a hidden tab or under the layer takes no focus. Whether it had
   * one to give.
   */
  function toComposer(column: "journal" | "conversation", id: string): boolean {
    const field = document.getElementById(id);
    if (!field) return false;
    setTab(column);
    setAttentionOpen(false);
    setPressedOut(false);
    field.focus();
    return document.activeElement === field;
  }

  /**
   * Where the skip links and the keys lead (section 8.11). Attention opens in between, as from its
   * button; on a phone its tab shows first; on a desktop it is there, and its heading takes the focus.
   */
  const keyTargets: KeyTargets = {
    toJournalComposer: () => toComposer("journal", JOURNAL_COMPOSER),
    toConversationComposer: () => toComposer("conversation", CONVERSATION_COMPOSER),
    toAttention() {
      if (!attentionHeading) return false;
      if (inBetween()) openAttention();
      else {
        setTab("attention");
        attentionHeading.focus();
      }
      return true;
    },
  };
  onMount(() => followScreenKeys(keyTargets, () => current() !== null && !inSettings()));

  /**
   * Bring a record shown in the Journal into view, from a change a Run made: on a phone, the
   * Journal's tab first.
   */
  function showRecord(anchor: string) {
    setTab("journal");
    requestAnimationFrame(() => {
      const shown = document.getElementById(anchor);
      shown?.scrollIntoView({ block: "center" });
      shown?.focus();
    });
  }

  /**
   * Bring a Held Change into view in Attention, from the marker on its Entry: on a phone,
   * Attention's tab first, and in between, Attention opened.
   */
  function showHeldChange(anchor: string) {
    setTab("attention");
    setAttentionOpen(true);
    requestAnimationFrame(() => {
      const shown = document.getElementById(anchor);
      shown?.scrollIntoView({ block: "center" });
      shown?.focus();
    });
  }

  /** Give the composer the caret, with what was shared if anything was. */
  function openComposer(opening: ComposerOpening) {
    if (opening.shared === null) wantComposer();
    else receiveShared(opening.shared);
  }

  // Launched into this window, the Journal is shown first: on a phone the composer takes the caret
  // only once its tab is shown.
  onMount(() =>
    followLaunches(openedAt, (address) => {
      const opening = composerOpened(address);
      if (!opening) return;
      leaveSettings();
      setTab("journal");
      openComposer(opening);
    }),
  );

  /** Show another Context, with Attention shut. */
  function switchTo(id: string) {
    setAttentionOpen(false);
    setChosen(id);
    store(LAST_SHOWN, id);
  }

  /** Show a Context as a Deployment tool that changed it returned it. */
  function showChangedContext(changed: ContextListing) {
    contextsRead.changed();
    setContexts((shown) =>
      (shown ?? []).map((context) => (context.id === changed.id ? changed : context)),
    );
    // The Context's own settings carry its name too.
    if (changed.id === currentId()) {
      setSettings((read) => (read ? { ...read, name: changed.name } : read));
    }
  }

  /** A Context deleted for good leaves the list: only a retired one can be, never the current. */
  function dropContext(id: string) {
    contextsRead.changed();
    setContexts((shown) => (shown ?? []).filter((context) => context.id !== id));
  }

  function addContext(made: ContextListing) {
    contextsRead.changed();
    setContexts((shown) => [...(shown ?? []), made]);
    switchTo(made.id);
  }

  /** Show the Contexts an Export brought back, on the first not retired. */
  function restored(listed: ContextListing[]) {
    contextsRead.changed();
    setContexts(listed);
    const shown = listed.find((context) => !context.retired);
    if (shown) switchTo(shown.id);
  }

  // Settings shows only over a Context, in place of its main screen, which stays as it was left
  // underneath: its tab, where each column was scrolled and its composers' drafts.
  const inSettings = () => place().settings && current() !== null;
  const section = () => {
    const at = place();
    return at.settings ? at.section : null;
  };
  let gear: HTMLButtonElement | undefined;
  // Escape returns to the main screen, unless something in Settings, such as a menu, took it first.
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !inSettings()) return;
      leaveSettings();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });
  // Back on the main screen, the person is where they opened Settings from.
  createEffect(
    on(inSettings, (shown, was) => {
      if (was && !shown) gear?.focus();
    }),
  );

  onMount(() => onCleanup(followSpend()));
  // A refused Unsent write for a Context no longer shown is put to the person in the one that is.
  createEffect(() => {
    const listed = contexts();
    if (listed) knowShownContexts(listed.filter((each) => !each.retired).map((each) => each.id));
  });
  // Unsent writes are sent while Praxis is open, whichever Context is shown (section 8.8).
  onMount(() => onCleanup(keepSending()));
  // The Offline Copy, where it is switched on, is fetched again while Praxis is open, and holds
  // the Context shown as soon as it can.
  onMount(() => onCleanup(keepCopyFresh()));
  createEffect(() => {
    const id = currentId();
    if (id !== null) fetchIfMissing(id);
  });

  // A tap on a Notification while Praxis is open here brings its Conversation into view.
  onMount(() => {
    const worker = navigator.serviceWorker;
    if (!worker) return;
    const onMessage = (event: MessageEvent<{ open?: string }>) => {
      const id = conversationOpened(new URL(event.data?.open ?? "/", location.origin).search);
      if (id === null) return;
      leaveSettings();
      switchTo(id);
      setTab("conversation");
    };
    worker.addEventListener("message", onMessage);
    onCleanup(() => worker.removeEventListener("message", onMessage));
  });

  // Whether the Contexts shown are the ones this browser last read, as no network gave any.
  let shownAsLastRead = false;

  /**
   * Read the Contexts. With no network the screen shows the ones last read, if any, and reads them
   * again once the network is back. A lapsed sign-in shows none: signing in again is what mends it.
   * Only the last read's answer is shown, and one a change of the screen's own overtook is sent
   * again, since the Deployment tools work again once the network is back.
   */
  const contextsRead = latestRead(async (current) => {
    try {
      const result = await callDeploymentTool("list_contexts", {});
      if (!current()) return;
      if (!result.ok) return setProblem(result.error.message);
      shownAsLastRead = false;
      setContexts(result.value.items);
    } catch (error) {
      if (!current()) return;
      const kept = error instanceof Unreachable ? readStored(CONTEXTS_LAST_READ) : null;
      if (contexts() === null && kept?.some((context) => !context.retired)) {
        shownAsLastRead = true;
        return setContexts(kept);
      }
      // Shown as last read already, they stay so until a read answers.
      if (!shownAsLastRead) setProblem(unreachableMessage(error));
    }
  });

  /** Read the Contexts again if those shown are the ones last read, the network being back. */
  async function readContextsIfLastRead() {
    if (shownAsLastRead) await contextsRead.read();
  }

  onMount(() => void contextsRead.read());
  onMount(() => {
    const onOnline = () => void readContextsIfLastRead();
    window.addEventListener("online", onOnline);
    onCleanup(() => window.removeEventListener("online", onOnline));
  });
  // What the browser keeps is the list as last shown, as read or as changed since.
  createEffect(() => {
    const listed = contexts();
    if (listed && !shownAsLastRead) store(CONTEXTS_LAST_READ, listed);
  });

  /** Read a Context's settings, while it is still current. */
  async function readSettings(id: string) {
    try {
      const result = await contextTools(id)("get_settings", {});
      if (id !== currentId()) return;
      if (!result.ok) {
        setUnread(true);
        return setProblem(result.error.message);
      }
      setSettings(result.value);
    } catch (error) {
      if (id !== currentId()) return;
      setUnread(true);
      setProblem(unreachableMessage(error));
    }
  }

  // Each Context starts with no settings shown, until its live channel has opened to read them.
  createEffect(
    on(currentId, () => {
      setSettings(null);
      setDueCount(0);
      setHeldCount(0);
      setUnread(false);
      setProblem(null);
    }),
  );

  /**
   * The live channel of the Context now current, open while it is (section 9.5): switching closes
   * it, and the next Context opens its own. What it brings about the Context itself, a new name
   * or time zone, is read here; the rest is heard by what shows it.
   */
  function openLive(id: string): CurrentLive {
    const tools = contextTools(id);
    const live = new Live({
      open: socketOpener(liveAddress(id)),
      listChanges: (input) => tools("list_changes", input),
      wait: pause,
      readyBy: pause(READY_WITHIN),
    });
    const wake = () => live.wake();
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    onCleanup(() => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      live.close();
    });

    live.listen({
      async changed(change) {
        const onThis = change.effects.find((effect) => effect.kind === "context");
        if (!onThis) return;
        contextsRead.changed();
        setContexts(
          (shown) =>
            shown?.map((context) =>
              context.id === onThis.id ? { ...context, name: onThis.summary } : context,
            ) ?? shown,
        );
        await readSettings(id);
      },
      async readAfresh() {
        // The channel opened once the network was back, after the screen opened with none.
        await readContextsIfLastRead();
        await readSettings(id);
      },
    });

    void live.ready.then(() => readSettings(id));
    return { listen: (listener) => live.listen(listener), ready: live.ready };
  }

  return (
    <div
      class={`screen accent-${current()?.accent ?? "slate"}`}
      data-tab={tab()}
      data-attention={attentionOpen() ? "open" : "shut"}
    >
      <header class="top-bar">
        <Show when={current() && !inSettings()}>
          <SkipLinks
            targets={keyTargets}
            attentionOpens={inBetween()}
            conversationComposerShown={conversationComposerShown()}
          />
        </Show>
        <Show
          when={inSettings() ? current() : null}
          fallback={
            <h1 class="wordmark">
              <Mark />
              <span class="wordmark-word">Praxis</span>
            </h1>
          }
        >
          {(shown) => <SettingsBar section={section()} contextName={shown().name} />}
        </Show>
        <Show when={current()}>
          {(shown) => (
            <ContextSwitcher
              current={shown()}
              contexts={contexts() ?? []}
              onOpen={() => setAttentionOpen(false)}
              onSwitch={switchTo}
            />
          )}
        </Show>
        <Show when={current() && !inSettings()}>
          <button
            ref={attentionButton}
            type="button"
            class="attention-toggle"
            aria-expanded={attentionOpen()}
            aria-controls="attention"
            aria-keyshortcuts="a"
            title="Attention (a)"
            onClick={() => (attentionOpen() ? closeAttention() : openAttention())}
            onKeyDown={putAttentionAway}
          >
            Attention
            <AttentionCount count={count()} />
          </button>
        </Show>
        <span class="top-bar-fill" />
        <Show when={inSettings()}>
          <span class="settings-hint">Esc closes</span>
        </Show>
        <Show when={current() && !inSettings()}>
          <button
            ref={gear}
            type="button"
            class="icon-button"
            aria-label="Settings"
            onClick={() => {
              setAttentionOpen(false);
              openSettings();
            }}
          >
            <SettingsIcon size={18} aria-hidden="true" />
          </button>
        </Show>
      </header>
      <UnsentStatus />
      <ClearingCopy />
      <Show when={signInLapsed()}>
        <p class="problem" role="alert">
          Your sign-in has lapsed. <a href="/">Sign in again</a> to carry on.
        </p>
      </Show>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={contexts()?.length === 0}>
        <main class="first-context">
          <NewContext heading="Make your first Context" onMade={addContext} />
          <RestoreExport onRestored={restored} />
        </main>
      </Show>
      {/* Keyed on the Context, so switching shows only the new one's and calls go only to it. */}
      <Show when={currentId()} keyed>
        {(id) => {
          const live = openLive(id);
          const heldChanges = followHeldChanges(contextTools(id), live);
          onCleanup(followNotices(contextTools(id)));
          createEffect(() => setHeldCount(heldChanges.all().length));
          return (
            <CurrentContextId.Provider value={id}>
              <CurrentContextTools.Provider value={contextTools(id)}>
                <CurrentContextLive.Provider value={live}>
                  <CurrentHeldChanges.Provider value={heldChanges}>
                    <CurrentMoveTargets.Provider
                      value={{
                        from: id,
                        to: () =>
                          (contexts() ?? []).filter((each) => each.id !== id && !each.retired),
                      }}
                    >
                      <Show when={inSettings()}>
                        <SettingsScreen
                          section={section()}
                          contextName={current()?.name ?? ""}
                          settings={settings()}
                          onSettingsChanged={setSettings}
                          offlineZone={
                            (!online() || copyFetchedAt() !== null ? timeZone() : null) ?? null
                          }
                          contexts={contexts() ?? []}
                          onContextChanged={showChangedContext}
                          onContextMade={addContext}
                          onContextDeleted={dropContext}
                        />
                      </Show>
                      <main class="peers" hidden={inSettings()}>
                        <Peer
                          id="attention"
                          title="Attention"
                          aside={<AttentionCount count={count()} />}
                          end={
                            <button
                              type="button"
                              class="icon-button attention-close"
                              aria-label="Close Attention"
                              title="Close Attention"
                              onClick={closeAttention}
                            >
                              <X size={18} aria-hidden="true" />
                            </button>
                          }
                          headingRef={(heading) => {
                            attentionHeading = heading;
                          }}
                          headingKey={inBetween() ? undefined : "a"}
                          onKeyDown={putAttentionAway}
                        >
                          <Show when={timeZone()} keyed>
                            {(zone) => <Attention timeZone={zone} onDueCount={setDueCount} />}
                          </Show>
                        </Peer>
                        {/* Today and the Entries' times follow the time zone, so a new one reads afresh,
                      inside a column that stays: the region is the same one before the zone is read
                      and after. */}
                        <Peer id="journal" title="Journal" inert={underLayer()}>
                          <Show when={timeZone()} keyed>
                            {(zone) => (
                              <Journal
                                timeZone={zone}
                                contextName={current()?.name}
                                onShowHeldChange={showHeldChange}
                              />
                            )}
                          </Show>
                        </Peer>
                        <Conversation
                          contextId={currentId() ?? ""}
                          contextName={current()?.name}
                          timeZone={timeZone()}
                          onShowRecord={showRecord}
                          inert={underLayer()}
                        />
                      </main>
                      <nav class="tabs" aria-label="Columns" hidden={inSettings()}>
                        <TabButton tab="attention" shown={tab()} onShow={setTab}>
                          <Inbox size={20} aria-hidden="true" />
                          Attention
                          <AttentionCount count={count()} />
                        </TabButton>
                        <TabButton tab="journal" shown={tab()} onShow={setTab}>
                          <BookOpen size={20} aria-hidden="true" />
                          Journal
                        </TabButton>
                        <TabButton tab="conversation" shown={tab()} onShow={setTab}>
                          <MessageCircle size={20} aria-hidden="true" />
                          Agent
                          <UnreadMark kinds={unreadBriefs()} />
                        </TabButton>
                      </nav>
                    </CurrentMoveTargets.Provider>
                  </CurrentHeldChanges.Provider>
                </CurrentContextLive.Provider>
              </CurrentContextTools.Provider>
            </CurrentContextId.Provider>
          );
        }}
      </Show>
    </div>
  );
}

function TabButton(props: {
  tab: PeerId;
  shown: PeerId;
  onShow: (tab: PeerId) => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      aria-controls={props.tab}
      aria-current={props.shown === props.tab ? "true" : undefined}
      onClick={() => props.onShow(props.tab)}
    >
      {props.children}
    </button>
  );
}

/**
 * A dot on the Agent tab while a Brief or a Review is unread, read out as which (section 8.5).
 */
function UnreadMark(props: { kinds: ClockFold["kind"][] }) {
  const named = () =>
    props.kinds.map((kind) => (kind === "brief" ? "Brief" : "Review")).join(" and ");
  return (
    <Show when={props.kinds.length > 0}>
      <span class="unread-mark" aria-hidden="true" />
      <span class="visually-hidden"> {named()} unread</span>
    </Show>
  );
}

/** The count of what is open for the person to act on, wherever Attention is named. */
function AttentionCount(props: { count: number }) {
  return <Badge count={props.count} label="to act on" />;
}

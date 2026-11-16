import type { Settings } from "@praxis/domain";
import SettingsIcon from "lucide-solid/icons/settings";
import { createMemo, createSignal, type JSX, onMount, Show } from "solid-js";
import { ContextSettings, deviceTimeZone } from "./ContextSettings.tsx";
import { Badge } from "./design/Badge.tsx";
import { Mark } from "./design/Mark.tsx";
import { Peer, type PeerId } from "./design/Peer.tsx";
import type { Accent } from "./design/tokens.ts";
import { Journal } from "./Journal.tsx";
import { callTool, unreachableMessage } from "./tools.ts";

/**
 * The main screen of the current Context: Attention, the Journal and the Conversation as three
 * peers (section 8.1, ADR 0022). Three columns on a desktop; in between, the Journal and the
 * Conversation, with Attention opened from the top bar; on a phone, three tabs, opening on
 * Attention. The widths are the stylesheet's; this holds only which tab is shown and whether
 * Attention is open.
 */
export function App() {
  const [settings, setSettings] = createSignal<Settings | null>(null);
  const [showSettings, setShowSettings] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<PeerId>("attention");
  const [attentionOpen, setAttentionOpen] = createSignal(false);
  // Without the settings the Journal is still shown, its times in the Device's zone.
  const [unread, setUnread] = createSignal(false);
  const timeZone = createMemo(
    () => settings()?.time_zone ?? (unread() ? deviceTimeZone() : undefined),
  );
  // The one Context there is takes Blue until the Deployment holds each Context's accent (#56).
  const accent = (): Accent => "blue";
  // What the count is made of comes with Attention itself (#49): nothing is counted yet.
  const count = () => 0;
  let attentionButton!: HTMLButtonElement;

  /** Opened from the top bar in between, Attention is put away with Escape, from it or its button. */
  function putAttentionAway(event: KeyboardEvent) {
    if (event.key !== "Escape" || !attentionOpen()) return;
    setAttentionOpen(false);
    attentionButton.focus();
  }

  onMount(async () => {
    try {
      const result = await callTool("get_settings", {});
      if (!result.ok) {
        setUnread(true);
        return setProblem(result.error.message);
      }
      setSettings(result.value);
    } catch (error) {
      setUnread(true);
      setProblem(unreachableMessage(error));
    }
  });

  return (
    <div
      class={`screen accent-${accent()}`}
      data-tab={tab()}
      data-attention={attentionOpen() ? "open" : "shut"}
    >
      <header class="top-bar">
        <h1 class="wordmark">
          <Mark />
          Praxis
        </h1>
        <Show when={settings()}>{(current) => <span class="context">{current().name}</span>}</Show>
        <button
          ref={attentionButton}
          type="button"
          class="attention-toggle"
          aria-expanded={attentionOpen()}
          aria-controls="attention"
          onClick={() => setAttentionOpen((open) => !open)}
          onKeyDown={putAttentionAway}
        >
          Attention
          <AttentionCount count={count()} />
        </button>
        <span class="top-bar-fill" />
        <Show when={settings()}>
          <button
            type="button"
            class="icon-button"
            aria-label="Settings"
            aria-expanded={showSettings()}
            aria-controls="context-settings"
            onClick={() => setShowSettings((shown) => !shown)}
          >
            <SettingsIcon size={18} aria-hidden="true" />
          </button>
        </Show>
      </header>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={showSettings() && settings()}>
        {(current) => <ContextSettings settings={current()} onChanged={setSettings} />}
      </Show>
      <main class="peers">
        <Peer
          id="attention"
          title="Attention"
          aside={<AttentionCount count={count()} />}
          onKeyDown={putAttentionAway}
        />
        {/* Today and the Entries' times follow the time zone, so a new one reads the Journal afresh. */}
        <Show when={timeZone()} keyed fallback={<Peer id="journal" title="Journal" />}>
          {(zone) => <Journal timeZone={zone} contextName={settings()?.name} />}
        </Show>
        <Peer
          id="conversation"
          title="Conversation"
          aside={
            <Show when={settings()}>
              {(current) => <span class="peer-note">with the Agent, in {current().name}</span>}
            </Show>
          }
        />
      </main>
      <nav class="tabs" aria-label="Columns">
        <TabButton tab="attention" shown={tab()} onShow={setTab}>
          Attention
          <AttentionCount count={count()} />
        </TabButton>
        <TabButton tab="journal" shown={tab()} onShow={setTab}>
          Journal
        </TabButton>
        <TabButton tab="conversation" shown={tab()} onShow={setTab}>
          Agent
        </TabButton>
      </nav>
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

/** The count of what is open for the person to act on, wherever Attention is named. */
function AttentionCount(props: { count: number }) {
  return <Badge count={props.count} label="to act on" />;
}

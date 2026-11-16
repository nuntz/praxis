import type { Settings } from "@praxis/domain";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { ContextSettings, deviceTimeZone } from "./ContextSettings.tsx";
import { Journal } from "./Journal.tsx";
import { callTool, unreachableMessage } from "./tools.ts";

/** The main screen of the current Context, which decides what is shown. */
export function App() {
  const [settings, setSettings] = createSignal<Settings | null>(null);
  const [showSettings, setShowSettings] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  // Without the settings the Journal is still shown, its times in the Device's zone.
  const [unread, setUnread] = createSignal(false);
  const timeZone = createMemo(
    () => settings()?.time_zone ?? (unread() ? deviceTimeZone() : undefined),
  );

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
    <main class="main-screen">
      <Show when={settings()}>
        {(current) => (
          <header class="top-bar">
            <span class="context-name">{current().name}</span>
            <button
              type="button"
              class="quiet"
              aria-expanded={showSettings()}
              aria-controls="context-settings"
              onClick={() => setShowSettings((shown) => !shown)}
            >
              Settings
            </button>
          </header>
        )}
      </Show>
      <Show when={showSettings() && settings()}>
        {(current) => <ContextSettings settings={current()} onChanged={setSettings} />}
      </Show>
      {/* Today and the Entries' times follow the time zone, so a new one reads the Journal afresh. */}
      <Show when={timeZone()} keyed>
        {(zone) => <Journal timeZone={zone} />}
      </Show>
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </main>
  );
}

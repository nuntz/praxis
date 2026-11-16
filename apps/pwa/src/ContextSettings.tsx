import { namedZone, type Settings } from "@praxis/domain";
import { createSignal, Show } from "solid-js";
import { unreachableMessage, useCallTool } from "./tools.ts";

/** The time zone this Device is in, as its browser names it. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The current Context's settings. Travel changes nothing by itself: when this Device is in another
 * time zone, both are shown here with one tap to switch, and nowhere else is it raised.
 */
export function ContextSettings(props: {
  settings: Settings;
  onChanged: (settings: Settings) => void;
}) {
  const callTool = useCallTool();
  const [sending, setSending] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const device = deviceTimeZone();
  // Named as this browser names it, so one zone known by two names is not told apart.
  const differs = () => namedZone(props.settings.time_zone) !== device;

  async function useDeviceZone() {
    setSending(true);
    try {
      const result = await callTool("set_time_zone", { time_zone: device });
      if (!result.ok) return setProblem(result.error.message);
      setProblem(null);
      props.onChanged(result.value.record);
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <section id="context-settings" class="settings" aria-labelledby="settings-heading">
      <h2 id="settings-heading" class="column-heading">
        Settings for {props.settings.name}
      </h2>
      <dl class="setting">
        <dt>Time zone</dt>
        <dd data-testid="time-zone">{props.settings.time_zone}</dd>
        <Show when={differs()}>
          <dt>This Device</dt>
          <dd data-testid="device-time-zone">{device}</dd>
        </Show>
      </dl>
      <Show when={differs()}>
        <button type="button" disabled={sending()} onClick={() => void useDeviceZone()}>
          Use {device}
        </button>
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

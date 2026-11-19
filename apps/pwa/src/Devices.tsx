import type {
  DeploymentToolInput,
  DeploymentToolOutput,
  Device,
  PushSubscription,
} from "@praxis/domain";
import { createSignal, For, onMount, Show } from "solid-js";
import {
  canNotify,
  NotificationsRefused,
  subscribeHere,
  thisDevice,
  unsubscribeHere,
} from "./device.ts";
import { latestRead } from "./latest-read.ts";
import { callDeploymentTool, unreachableMessage, writeToDeployment } from "./tools.ts";

/**
 * The Deployment's Devices, in its settings (section 8.10): each browser with Notifications
 * switched on, by its name and when it was last seen, renamed or removed from here, and this
 * browser's own switch. Removing a Device switches it off and does not sign it out.
 */
export function Devices() {
  const [devices, setDevices] = createSignal<Device[]>([]);
  const [pushKey, setPushKey] = createSignal<string | null>(null);
  const [read, setRead] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);
  const here = thisDevice();
  const hereListed = () => devices().find((device) => device.id === here);

  const listed = latestRead(async (current) => {
    try {
      const result = await callDeploymentTool("list_devices", {});
      if (!current()) return;
      if (!result.ok) return setProblem(result.error.message);
      setDevices(result.value.items);
      setPushKey(result.value.push_key);
      setRead(true);
    } catch (error) {
      if (!current()) return;
      setProblem(unreachableMessage(error));
    }
  });

  onMount(() => listed.read());

  /** Show a Device as a write returned it, or take it off the list once it has left. */
  function show(id: string, changed: Device | null) {
    listed.changed();
    setDevices((shown) =>
      changed === null
        ? shown.filter((device) => device.id !== id)
        : shown.some((device) => device.id === id)
          ? shown.map((device) => (device.id === id ? changed : device))
          : [...shown, changed],
    );
  }

  /** Switch Notifications on here: the browser asks the person, then subscribes. */
  async function switchOnHere(key: string) {
    if (here === null) return;
    setSending(true);
    try {
      const subscription = await subscribeHere(key);
      const switched = await writeToDeployment(
        "set_device_notifications",
        {
          id: here,
          on: true,
          // A browser's subscription carries its endpoint and both keys.
          subscription: subscription as PushSubscription,
          user_agent: navigator.userAgent,
        },
        setProblem,
      );
      if (switched !== null) show(here, switched);
    } catch (error) {
      if (error instanceof NotificationsRefused) setProblem(error.message);
      else setProblem("This browser could not subscribe to Notifications. Try again shortly.");
    } finally {
      setSending(false);
    }
  }

  /**
   * Call a Device write for whether it went through, saying what went wrong otherwise. Its record
   * is null once the Device has left the list, so the record alone cannot say.
   */
  async function write<N extends "remove_device" | "set_device_notifications">(
    tool: N,
    input: DeploymentToolInput<N>,
  ): Promise<DeploymentToolOutput[N] | null> {
    setSending(true);
    try {
      const result = await callDeploymentTool(tool, input);
      if (!result.ok) {
        setProblem(result.error.message);
        return null;
      }
      setProblem(null);
      return result.value;
    } catch (error) {
      setProblem(unreachableMessage(error));
      return null;
    } finally {
      setSending(false);
    }
  }

  /** Remove a Device, from any Device; this one also gives up its push subscription. */
  async function remove(device: Device) {
    if ((await write("remove_device", { id: device.id })) === null) return;
    show(device.id, null);
    if (device.id === here) await unsubscribeHere().catch(() => {});
  }

  async function switchOffHere() {
    if (here === null) return;
    if ((await write("set_device_notifications", { id: here, on: false })) === null) return;
    show(here, null);
    await unsubscribeHere().catch(() => {});
  }

  return (
    <section id="devices" class="settings" aria-labelledby="devices-heading">
      <h2 id="devices-heading" class="column-heading">
        Devices
      </h2>
      <p class="settings-note">
        A Device is listed while Notifications are switched on there. It is told when the Agent
        leaves a Brief or a Review, in a Context whose Notifications are on, and of nothing else.
      </p>
      <Show when={read()}>
        <ThisDevice
          listed={hereListed()}
          pushKey={pushKey()}
          sending={sending()}
          onSwitchOn={(key) => void switchOnHere(key)}
          onSwitchOff={() => void switchOffHere()}
        />
      </Show>
      <Show
        when={devices().length > 0}
        fallback={<p class="settings-note">No Device has Notifications switched on.</p>}
      >
        <ul class="connection-rows" aria-label="Devices">
          <For each={devices()}>
            {(device) => (
              <DeviceRow
                device={device}
                here={device.id === here}
                sending={sending()}
                onRenamed={(renamed) => show(device.id, renamed)}
                onRemove={() => void remove(device)}
                onProblem={setProblem}
              />
            )}
          </For>
        </ul>
        <p class="settings-note">
          Removing a Device switches off everything on it. It stays signed in: the sign-in is
          Cloudflare Access's, and ends there.
        </p>
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

/** This browser's own switch, or why it has none. */
function ThisDevice(props: {
  listed: Device | undefined;
  pushKey: string | null;
  sending: boolean;
  onSwitchOn: (key: string) => void;
  onSwitchOff: () => void;
}) {
  return (
    <Show
      when={canNotify()}
      fallback={
        <p class="settings-note">
          This browser cannot receive Notifications. On an iPhone or iPad, add Praxis to the Home
          Screen and open it from there.
        </p>
      }
    >
      <Show
        when={props.pushKey}
        fallback={
          <p class="settings-note">
            This Deployment has no key to send Notifications with: the setup wizard makes one.
          </p>
        }
      >
        {(key) => (
          <Show
            when={props.listed?.notifications}
            fallback={
              <button
                type="button"
                disabled={props.sending}
                onClick={() => props.onSwitchOn(key())}
              >
                Switch on Notifications here
              </button>
            }
          >
            <button
              type="button"
              class="quiet"
              disabled={props.sending}
              onClick={props.onSwitchOff}
            >
              Switch off Notifications here
            </button>
          </Show>
        )}
      </Show>
    </Show>
  );
}

function DeviceRow(props: {
  device: Device;
  here: boolean;
  sending: boolean;
  onRenamed: (device: Device) => void;
  onRemove: () => void;
  onProblem: (message: string | null) => void;
}) {
  const [sending, setSending] = createSignal(false);
  let nameField!: HTMLInputElement;

  async function rename(event: SubmitEvent) {
    event.preventDefault();
    setSending(true);
    const renamed = await writeToDeployment(
      "rename_device",
      { id: props.device.id, name: nameField.value },
      props.onProblem,
    );
    setSending(false);
    if (renamed) props.onRenamed(renamed);
    else nameField.value = props.device.name;
  }

  return (
    <li class="connection-row" data-testid="device-row">
      <form class="context-rename" onSubmit={(event) => void rename(event)}>
        <input
          ref={nameField}
          type="text"
          aria-label={`Name of ${props.device.name}`}
          value={props.device.name}
          required
        />
        <button type="submit" class="quiet" disabled={sending() || props.sending}>
          Rename
        </button>
      </form>
      <Show when={props.here}>
        <span class="connection-context">This Device</span>
      </Show>
      <span class="connection-context">
        Last seen <time datetime={props.device.seen}>{seenAt(props.device.seen)}</time>
      </span>
      <button
        type="button"
        class="quiet"
        disabled={sending() || props.sending}
        onClick={props.onRemove}
      >
        Remove {props.device.name}
      </button>
    </li>
  );
}

/** When a Device was last seen, in the Device's own locale. */
function seenAt(seen: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(seen),
  );
}

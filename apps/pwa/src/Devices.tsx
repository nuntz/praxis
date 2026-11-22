import type {
  DeploymentToolInput,
  DeploymentToolOutput,
  Device,
  PushSubscription,
} from "@praxis/domain";
import { createSignal, For, onMount, Show } from "solid-js";
import { SettingRow, SettingsGroup, SwitchInput } from "./design/SettingRows.tsx";
import {
  canNotify,
  NotificationsRefused,
  subscribeHere,
  thisDevice,
  unsubscribeHere,
} from "./device.ts";
import { latestRead } from "./latest-read.ts";
import { clearCopy, copyProblem, offlineCopy, startCopy } from "./offline-copy.ts";
import { callDeploymentTool, unreachableMessage, writeToDeployment } from "./tools.ts";
import { unsentKeptQuestion } from "./Unsent.tsx";
import { discardUnsentWrites, unsent } from "./unsent.ts";

/**
 * The Deployment's Devices, in its settings (section 8.10): each browser with Notifications or an
 * Offline Copy switched on, by its name and when it was last seen, renamed or removed from here,
 * and this browser's own switches. Removing a Device switches it off and does not sign it out.
 * Switching the Offline Copy off here, or removing this Device, clears the copy, and the person is
 * asked first about any Unsent writes (section 8.8).
 */
export function Devices() {
  const [devices, setDevices] = createSignal<Device[]>([]);
  const [pushKey, setPushKey] = createSignal<string | null>(null);
  const [read, setRead] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);
  const here = thisDevice();
  const hereListed = () => devices().find((device) => device.id === here);
  // What clears the copy here, waiting for the person to say what becomes of the Unsent writes.
  const [asking, setAsking] = createSignal<(() => Promise<boolean>) | null>(null);

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

  /**
   * Switch Notifications on here: the browser asks the person, then subscribes. Says whether they
   * are on.
   */
  async function switchOnHere(key: string): Promise<boolean> {
    if (here === null) return false;
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
      if (switched === null) return false;
      show(here, switched);
      return true;
    } catch (error) {
      if (error instanceof NotificationsRefused) setProblem(error.message);
      else setProblem("This browser could not subscribe to Notifications. Try again shortly.");
      return false;
    } finally {
      setSending(false);
    }
  }

  /**
   * Call a Device write for whether it went through, saying what went wrong otherwise. Its record
   * is null once the Device has left the list, so the record alone cannot say.
   */
  async function write<
    N extends "remove_device" | "set_device_notifications" | "set_device_offline_copy",
  >(tool: N, input: DeploymentToolInput<N>): Promise<DeploymentToolOutput[N] | null> {
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

  /**
   * Clear the copy here once a write that switches it off has gone through, asking first what
   * becomes of the Unsent writes this Device holds, if any.
   */
  function clearingCopy(switchOff: () => Promise<boolean>) {
    if (offlineCopy() === null || unsent().length === 0) {
      void switchOff().then((done) => {
        if (done) clearCopy();
      });
      return;
    }
    setAsking(() => switchOff);
  }

  /** The person said what becomes of the Unsent writes: the copy is switched off and cleared. */
  async function answered(discard: boolean) {
    const switchOff = asking();
    // Only the writes the person was asked about: one made while the switch is out is kept.
    const askedAbout = unsent().map((write) => write.id);
    setAsking(null);
    if (!switchOff || !(await switchOff())) return;
    if (discard) discardUnsentWrites(askedAbout);
    clearCopy();
  }

  /** Remove a Device, from any Device; this one also gives up its push subscription and its copy. */
  function remove(device: Device) {
    const removing = async () => {
      if ((await write("remove_device", { id: device.id })) === null) return false;
      show(device.id, null);
      if (device.id === here) await unsubscribeHere().catch(() => {});
      return true;
    };
    if (device.id === here) clearingCopy(removing);
    else void removing();
  }

  /**
   * Switch the Offline Copy on here: it is fetched at once, and kept fresh while Praxis is open.
   * Says whether it is on.
   */
  async function switchCopyOnHere(): Promise<boolean> {
    if (here === null) return false;
    setSending(true);
    const switched = await writeToDeployment(
      "set_device_offline_copy",
      { id: here, on: true, user_agent: navigator.userAgent },
      setProblem,
    );
    setSending(false);
    if (switched === null) return false;
    show(here, switched);
    await startCopy();
    return true;
  }

  function switchCopyOffHere() {
    if (here === null) return;
    clearingCopy(async () => {
      const off = await write("set_device_offline_copy", { id: here, on: false });
      if (off === null) return false;
      show(here, off.record);
      return true;
    });
  }

  /** Switch Notifications off here, and give up the push subscription. Says whether they are off. */
  async function switchOffHere(): Promise<boolean> {
    if (here === null) return false;
    const off = await write("set_device_notifications", { id: here, on: false });
    if (off === null) return false;
    show(here, off.record);
    await unsubscribeHere().catch(() => {});
    return true;
  }

  return (
    <section id="devices" class="settings" aria-labelledby="devices-heading">
      <h2 id="devices-heading" class="column-heading">
        Devices
      </h2>
      <p class="settings-note">
        A Device is listed while Notifications or an Offline Copy is switched on there. With
        Notifications it is told when the Agent leaves a Brief or a Review, in a Context whose
        Notifications are on, and of nothing else.
      </p>
      <p class="settings-note">
        An Offline Copy keeps, for every Context, Attention, the open Tasks and Projects, the
        Persons, the Standing Entries and the last 30 days of Entries in this browser's storage,
        unencrypted, to read with no network. It holds no Conversation and no image.
      </p>
      <Show when={read()}>
        <SettingsGroup heading="This Device">
          <ThisDevice
            listed={hereListed()}
            pushKey={pushKey()}
            sending={sending()}
            onSwitchOn={(key) => switchOnHere(key)}
            onSwitchOff={() => switchOffHere()}
          />
          <SettingRow
            title="Offline Copy on this Device"
            description="Kept in this browser, to read with no network"
            labels
            control={(ids) => (
              <SwitchInput
                id={ids.id}
                aria-describedby={ids.describedBy}
                checked={hereListed()?.offline_copy ?? false}
                disabled={sending() || here === null || asking() !== null}
                onTurn={(on) => {
                  if (on) return switchCopyOnHere();
                  // Nothing is switched off until the person says what becomes of the Unsent
                  // writes, if there are any, and the copy is cleared once it is.
                  switchCopyOffHere();
                  return false;
                }}
              />
            )}
          />
        </SettingsGroup>
      </Show>
      <Show when={asking()}>
        <fieldset class="clearing-copy" aria-labelledby="clearing-copy-question">
          <p id="clearing-copy-question">
            Switching off clears the Offline Copy from this browser.{" "}
            {unsentKeptQuestion(unsent().length)}
          </p>
          <div class="held-change-actions">
            <button type="button" onClick={() => void answered(false)}>
              Keep Unsent writes
            </button>
            <button type="button" class="quiet" onClick={() => void answered(true)}>
              Discard them too
            </button>
            <button type="button" class="quiet" onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        </fieldset>
      </Show>
      <Show when={copyProblem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show
        when={devices().length > 0}
        fallback={
          <p class="settings-note">No Device has Notifications or an Offline Copy switched on.</p>
        }
      >
        <ul class="connection-rows" aria-label="Devices">
          <For each={devices()}>
            {(device) => (
              <DeviceRow
                device={device}
                here={device.id === here}
                sending={sending()}
                onRenamed={(renamed) => show(device.id, renamed)}
                onRemove={() => remove(device)}
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

/** This browser's own Notification switch, or why it has none. */
function ThisDevice(props: {
  listed: Device | undefined;
  pushKey: string | null;
  sending: boolean;
  onSwitchOn: (key: string) => Promise<boolean>;
  onSwitchOff: () => Promise<boolean>;
}) {
  const title = "Notifications on this Device";
  return (
    <Show
      when={canNotify()}
      fallback={
        <SettingRow
          title={title}
          description="This browser cannot receive Notifications. On an iPhone or iPad, add Praxis to the Home Screen and open it from there."
        />
      }
    >
      <Show
        when={props.pushKey}
        fallback={
          <SettingRow
            title={title}
            description="This Deployment has no key to send Notifications with: the setup wizard makes one."
          />
        }
      >
        {(key) => (
          <SettingRow
            title={title}
            description="Told when the Agent leaves a Brief or a Review"
            labels
            control={(ids) => (
              <SwitchInput
                id={ids.id}
                aria-describedby={ids.describedBy}
                checked={props.listed?.notifications ?? false}
                disabled={props.sending}
                onTurn={(on) => (on ? props.onSwitchOn(key()) : props.onSwitchOff())}
              />
            )}
          />
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
      <span class="connection-context">{switchedOn(props.device)}</span>
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

/** What is switched on at a Device, as its row says. */
function switchedOn(device: Device): string {
  if (device.notifications && device.offline_copy) return "Notifications and Offline Copy";
  return device.notifications ? "Notifications" : "Offline Copy";
}

/** When a Device was last seen, in the Device's own locale. */
function seenAt(seen: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(seen),
  );
}

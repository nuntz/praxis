import {
  type ClockKind,
  conversationAddress,
  type Device,
  effectOnDevice,
  failure,
  instantToIso,
  nameDevice,
  type PushSubscription,
  refusal,
  success,
  type ToolResult,
  written,
} from "@praxis/domain";
import type { DeploymentHandlers } from "./deployment-tools.ts";
import { type Notification, type PushSender, topicOf } from "./push.ts";

type DeviceRow = {
  id: string;
  name: string;
  notifications: number;
  subscription: string | null;
  seen: number;
};

/** The Device tools, which this module runs for the Deployment object. */
export type DeviceToolName =
  | "list_devices"
  | "rename_device"
  | "set_device_notifications"
  | "remove_device";

/** How each kind of Notification names itself, after the Context's name (ADR 0013). */
const READY: Record<ClockKind, string> = {
  brief: "your Brief is ready",
  review: "your Review is ready",
};

/**
 * Send a Brief's or Review's Notification to every Device with Notifications switched on, in fixed
 * wording naming the kind and the Context and nothing else. A Device whose subscription the push
 * service says is gone is switched off. Nothing for a Context retired or not listed.
 */
export async function notifyDevices(
  sql: SqlStorage,
  push: PushSender,
  notice: { context: string; kind: ClockKind; at: number },
): Promise<void> {
  const { context, kind, at } = notice;
  const named = sql
    .exec<{ name: string }>(`SELECT name FROM contexts WHERE id = ? AND retired = 0`, context)
    .toArray()[0];
  if (!named) return;
  const devices = sql
    .exec<{ id: string; subscription: string }>(
      `SELECT id, subscription FROM devices WHERE notifications = 1 ORDER BY seq`,
    )
    .toArray();
  const notification: Notification = {
    title: `${named.name}: ${READY[kind]}`,
    tag: `${kind}:${context}`,
    open: conversationAddress(context),
  };
  const topic = await topicOf(context, kind);
  const sent = await Promise.all(
    devices.map(async ({ id, subscription }) => {
      const to = JSON.parse(subscription) as PushSubscription;
      const how = await push.send(to, notification, { topic, at }).catch(() => "failed" as const);
      return { id, subscription, how };
    }),
  );
  // Only the subscription found gone: the Device may have switched on again meanwhile.
  for (const { id, subscription, how } of sent) {
    if (how === "gone") switchNotificationsOff(sql, id, subscription);
  }
  const count = (how: string) => sent.filter((one) => one.how === how).length;
  console.log(
    JSON.stringify({
      notified: kind,
      sent: count("sent"),
      gone: count("gone"),
      failed: count("failed"),
    }),
  );
}

/**
 * The Device tools (section 4.11). A Device is listed only while something is switched on there,
 * so switching the last thing off, or removing it, takes its row.
 */
export const deviceHandlers: Pick<DeploymentHandlers, DeviceToolName> = {
  async list_devices({ sql, push }) {
    const rows = sql.exec<DeviceRow>(`SELECT ${COLUMNS} FROM devices ORDER BY seq`).toArray();
    return success({ items: rows.map(toDevice), push_key: push.publicKey });
  },

  async rename_device({ input, sql }) {
    const found = device(sql, input.id);
    if (found === null) return noSuchDevice();
    if (found.name === input.name) return success(written(found, []));
    sql.exec(`UPDATE devices SET name = ? WHERE id = ?`, input.name, found.id);
    const renamed = { ...found, name: input.name };
    return success(written(renamed, [effectOnDevice(renamed, "changed")]));
  },

  async set_device_notifications({ input, sql, arrivedAt, push }) {
    const found = device(sql, input.id);
    if (!input.on) {
      if (found === null) return success(written(null, []));
      switchNotificationsOff(sql, found.id);
      return success(written(null, [effectOnDevice(found, "deleted")]));
    }
    if (push.publicKey === null) {
      return refusal(
        "This Deployment has no key to send Notifications with: the setup wizard makes one, and a deploy gives it to the Worker.",
        [],
      );
    }
    // The schema takes both whenever the call switches Notifications on.
    const subscription = JSON.stringify(input.subscription);
    if (found === null) {
      const made: Device = {
        id: input.id,
        name: nameDevice(input.user_agent ?? ""),
        notifications: true,
        seen: instantToIso(arrivedAt),
      };
      sql.exec(
        `INSERT INTO devices (id, name, notifications, subscription, seen) VALUES (?, ?, 1, ?, ?)`,
        made.id,
        made.name,
        subscription,
        arrivedAt,
      );
      return success(written(made, [effectOnDevice(made, "made")]));
    }
    if (found.notifications && subscriptionOf(sql, found.id) === subscription) {
      return success(written(found, []));
    }
    sql.exec(
      `UPDATE devices SET notifications = 1, subscription = ? WHERE id = ?`,
      subscription,
      found.id,
    );
    const switched = { ...found, notifications: true };
    return success(written(switched, [effectOnDevice(switched, "changed")]));
  },

  async remove_device({ input, sql }) {
    const found = device(sql, input.id);
    if (found === null) return noSuchDevice();
    // Notifications are all that can be on for now, so removing it is switching them off.
    switchNotificationsOff(sql, found.id);
    return success(written(null, [effectOnDevice(found, "deleted")]));
  },
};

/**
 * Switch a Device's Notifications off, or only while it still holds this subscription. They are
 * all that can be switched on for now, so the Device leaves the list: the Offline Copy (#71) will
 * keep it listed while that is on.
 */
function switchNotificationsOff(sql: SqlStorage, id: string, subscription?: string): void {
  if (subscription === undefined) sql.exec(`DELETE FROM devices WHERE id = ?`, id);
  else sql.exec(`DELETE FROM devices WHERE id = ? AND subscription = ?`, id, subscription);
}

/** The Device with this id was seen at `at`, if it is listed: a sighting, not a change. */
export function noteSeen(sql: SqlStorage, id: string, at: number): void {
  sql.exec(`UPDATE devices SET seen = max(seen, ?) WHERE id = ?`, at, id);
}

/** A Device's columns, as `toDevice` reads them. */
const COLUMNS = "id, name, notifications, subscription, seen";

function device(sql: SqlStorage, id: string): Device | null {
  const row = sql.exec<DeviceRow>(`SELECT ${COLUMNS} FROM devices WHERE id = ?`, id).toArray()[0];
  return row ? toDevice(row) : null;
}

function subscriptionOf(sql: SqlStorage, id: string): string | null {
  return (
    sql
      .exec<{ subscription: string | null }>(`SELECT subscription FROM devices WHERE id = ?`, id)
      .toArray()[0]?.subscription ?? null
  );
}

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    notifications: row.notifications === 1,
    seen: instantToIso(row.seen),
  };
}

function noSuchDevice(): ToolResult<never> {
  return failure("not_found", "There is no such Device: nothing is switched on there.");
}

import type { PushSubscription } from "@praxis/domain";
import type { Notification, PushSender } from "../src/push.ts";
import { carried } from "./markers.ts";

// The Web Push sender is one of the four faked things (section 13). The fake stands in for every
// browser's push service at once: it hands out subscriptions as a browser would get them, keeps
// what is sent to each, and says a subscription is gone once it is unsubscribed. It runs in the
// tests' own isolate, as the scripted model does, so a test reads what its Deployment sent.

/** A Notification as the fake's push service took it, with the topic it replaces by. */
export type Pushed = { notification: Notification; topic: string };

const subscribed = new Map<string, Pushed[]>();
let failing = false;
let keyed = true;

/** The fake's public key: what a browser would subscribe with. */
export const FAKE_PUSH_KEY = "BFakePushKeyOfTheTestDeployment";

export const fakePush: PushSender = {
  get publicKey() {
    return keyed ? FAKE_PUSH_KEY : null;
  },
  async send(to, notification, { topic }) {
    if (failing) return "failed";
    const received = subscribed.get(to.endpoint);
    if (received === undefined) return "gone";
    // Everything a Notification carries is held to the marker check, as a log line is.
    carried(JSON.stringify(notification));
    received.push({ notification, topic });
    return "sent";
  },
};

/** A new subscription at the fake push service, as a browser's PushManager would give one. */
export function subscribe(): PushSubscription {
  const endpoint = `https://push.praxis.test/${crypto.randomUUID()}`;
  subscribed.set(endpoint, []);
  return { endpoint, keys: { p256dh: "BUserAgentKey", auth: "AuthSecret" } };
}

/** The subscription's browser has unsubscribed: the push service says it is gone from now on. */
export function unsubscribe(subscription: PushSubscription): void {
  subscribed.delete(subscription.endpoint);
}

/** What has been sent to a subscription so far, oldest first, as a copy. */
export function received(subscription: PushSubscription): Pushed[] {
  return [...(subscribed.get(subscription.endpoint) ?? [])];
}

/** Stand for a Deployment with no signing key pair, or with one again. */
export function setPushKeyed(to: boolean): void {
  keyed = to;
}

/** Make the push service refuse everything, as an outage would, or take it again. */
export function setPushFailing(to: boolean): void {
  failing = to;
}

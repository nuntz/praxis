// This browser as a Device (section 8.10): an id it keeps in its own storage, made the first time
// it is asked for, and what it takes to switch Notifications on here. Praxis keeps a record of it
// only while something is switched on.

/** Where this browser keeps its id as a Device. */
const DEVICE_ID = "praxis.device";

/** This browser's id as a Device, made and kept the first time; null without storage. */
export function thisDevice(): string | null {
  try {
    const kept = localStorage.getItem(DEVICE_ID);
    if (kept) return kept;
    const made = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID, made);
    return made;
  } catch {
    return null;
  }
}

/** Whether this browser can receive a Notification by Web Push at all. */
export function canNotify(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The person refused this browser's permission to show Notifications. */
export class NotificationsRefused extends Error {}

/**
 * Subscribe this browser to its push service with the Deployment's public key, asking the person
 * for permission first, which a browser lets a page ask only from a tap. A subscription made for
 * another key is given up first: it could carry nothing this Deployment sends.
 */
export async function subscribeHere(publicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new NotificationsRefused(
      "This browser was not given permission to show Notifications. Allow them in its settings for this site, then switch them on again.",
    );
  }
  const registration = await navigator.serviceWorker.ready;
  const key = fromBase64url(publicKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameKey(existing.options.applicationServerKey, key)) return existing.toJSON();
  await existing?.unsubscribe();
  const made = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  return made.toJSON();
}

/** Give up this browser's push subscription, if it has one. */
export async function unsubscribeHere(): Promise<void> {
  if (!canNotify()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const existing = await registration?.pushManager.getSubscription();
  await existing?.unsubscribe();
}

function sameKey(given: ArrayBuffer | null, key: Uint8Array): boolean {
  if (given === null) return false;
  const bytes = new Uint8Array(given);
  return bytes.length === key.length && bytes.every((byte, at) => byte === key[at]);
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

import { z } from "zod";

/**
 * A Device as the Deployment object lists it (section 8.10): one browser's installation of Praxis,
 * known by an id that browser keeps. It is listed only while Notifications or an Offline Copy is
 * switched on there. Not a record. Its push subscription is kept beside it and never given out.
 */
export type Device = {
  /** The id the browser keeps in its own storage. */
  id: string;
  /** Named by itself from the browser and the system, such as "Safari on iPhone", until renamed. */
  name: string;
  /** Whether it is sent a Notification when the Agent leaves a Brief or a Review (section 8.7). */
  notifications: boolean;
  /**
   * Whether it keeps an Offline Copy, a fixed set of each Context's Journal to read with no network
   * (section 8.8). The Device holds the copy itself; Praxis holds only the switch, so a Device
   * switched off or removed from elsewhere clears its copy on its next contact.
   */
  offline_copy: boolean;
  /** When it was last seen, as an ISO 8601 instant: when it last called a Deployment tool. */
  seen: string;
};

/**
 * Where a browser's push service takes a Notification for it, and the keys it is encrypted to, as
 * the browser's `PushSubscription.toJSON()` gives them. Its address is a capability: whoever
 * holds it can push to the Device, so no tool gives it out.
 */
export type PushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/**
 * The header the screen names its Device in, by the id its browser keeps, on each Deployment
 * call, so the Device list shows when each was last seen (section 8.10).
 */
export const DEVICE_HEADER = "praxis-device";

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/, { message: "A key is base64url." });

export const pushSubscription = z.object({
  endpoint: z.url({ protocol: /^https$/, message: "A push subscription's endpoint is https." }),
  keys: z.object({ p256dh: base64url, auth: base64url }),
});

/** The browsers a Device is named after, each by the token its user agent carries, first found first. */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\bOPR\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

/** The systems a Device is named after, first found first: an iPhone's user agent says Mac OS X. */
const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMacintosh\b/, "Mac"],
  [/\bLinux\b/, "Linux"],
];

/**
 * The name a Device is given by itself, from the browser and the system its user agent names,
 * such as "Safari on iPhone". What it cannot tell is left out, down to "A browser".
 */
export function nameDevice(userAgent: string): string {
  const browser = BROWSERS.find(([token]) => token.test(userAgent))?.[1];
  const system = SYSTEMS.find(([token]) => token.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  if (browser) return browser;
  if (system) return `A browser on ${system}`;
  return "A browser";
}

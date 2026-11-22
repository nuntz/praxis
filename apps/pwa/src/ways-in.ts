// The two ways of opening the Journal's composer from outside Praxis (section 8.9): the home-screen
// shortcut and the share sheet. The manifest names this address for both (vite.config.ts), and it
// is the screen like any other: the Worker serves the screen at every address, and the service
// worker keeps it at every navigation.

/** The address the shortcut opens, and the share sheet with what it shares. */
export const NEW_ENTRY = "/new-entry";

/** The fields the share sheet fills in, each named for itself in the address (vite.config.ts). */
export const SHARED_FIELDS = ["title", "text", "url"] as const;

/**
 * What an app shared, as the share sheet opened the composer with it: each field it gave on a line
 * of its own, as given. A link the text already holds, as an app may give it in both, is given
 * once. Praxis fetches nothing of a link: it is text. Null when nothing was shared, as from the
 * shortcut.
 */
export function sharedText(address: URL): string | null {
  const given = (field: (typeof SHARED_FIELDS)[number]) => address.searchParams.get(field) ?? "";
  const text = given("text");
  const url = text.includes(given("url")) ? "" : given("url");
  const lines = [given("title"), text, url].filter((line) => line.trim() !== "");
  return lines.length === 0 ? null : lines.join("\n");
}

/** The composer opened from outside: with what was shared, or with nothing, as from the shortcut. */
export type ComposerOpening = { shared: string | null };

/**
 * What an address the screen was opened at, or launched at, opens: the composer, with what was
 * shared or with nothing, as from the shortcut. Null for any other address.
 */
export function composerOpened(address: URL): ComposerOpening | null {
  if (address.pathname !== NEW_ENTRY) return null;
  return { shared: sharedText(address) };
}

/** The browser's queue of launches of the installed PWA, where it has one (Chromium). */
type LaunchQueue = {
  setConsumer(consumer: (params: { targetURL?: string | null }) => void): void;
};

/**
 * Each launch of the installed PWA into this window, by the address it was launched at. The
 * manifest's launch handler sends a share or the shortcut to the window open, not a new one, so
 * the draft there is added to (vite.config.ts). The browser gives the launch that opened the
 * window too, which the screen has opened already from its address: the first launch at that
 * address is that one. Where the browser has no launch queue, a launch opens the screen afresh.
 */
export function followLaunches(openedAt: string, open: (address: URL) => void): void {
  const queue = (window as { launchQueue?: LaunchQueue }).launchQueue;
  if (!queue) return;
  let first = true;
  queue.setConsumer(({ targetURL }) => {
    const opening = first && targetURL === openedAt;
    first = false;
    if (targetURL && !opening) open(new URL(targetURL));
  });
}

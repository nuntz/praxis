// Praxis's service worker. It does two things. It keeps the built screen, so Praxis opens with no
// network (section 8.8), and it shows a Notification (section 8.7, ADR 0013): what the Deployment
// pushed, fixed wording naming the kind and the Context, and a tap opens that Context's
// Conversation. The build writes it from this file (vite.config.ts), with its release's files.

/**
 * The release this screen is, and its files as the Worker serves them at the Deployment's own
 * address, the screen itself at "/". The build fills it in: a new release is a new service worker.
 */
const SCREEN = { release: "unbuilt", files: [] };

/** Where the screen of each release is kept, by its name. Only the current one is kept. */
const KEPT_PREFIX = "praxis-screen-";
const KEPT = `${KEPT_PREFIX}${SCREEN.release}`;

/**
 * Never asked of the service worker: the tools and live channels, MCP, and Access's own pages at
 * the Deployment's address. A request for any of them goes to the network as if it were not here.
 */
const NEVER_KEPT = /^\/(api|mcp|cdn-cgi)(\/|$)/;

/**
 * A response to keep: the Worker's own, served whole. A redirect, as Access answers a lapsed
 * sign-in with, or any failure, is not the screen.
 */
function keepable(response) {
  return response.ok && response.type === "basic" && !response.redirected;
}

/** Keep the whole of this release's screen, or none of it: one part missing opens nothing. */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(KEPT);
      try {
        await Promise.all(
          SCREEN.files.map(async (path) => {
            const response = await fetch(
              new Request(path, { cache: "reload", redirect: "manual" }),
            );
            if (!keepable(response)) throw new Error(`${path} was not served: ${response.status}`);
            await cache.put(path, response);
          }),
        );
      } catch (error) {
        await caches.delete(KEPT);
        throw error;
      }
      // The screen open now is the earlier release's, and goes on as it was, but for a file it has
      // not loaded yet, such as a typeface's, which it may then go without: the next load with the
      // network is this one's anyway, as the network is asked first.
      await self.skipWaiting();
    })(),
  );
});

/** Once this release's screen is kept, an earlier release's is not. */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(KEPT_PREFIX) && name !== KEPT) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/**
 * The screen and its files are asked of the network first, and what was kept is shown only when
 * the network cannot be reached. Whatever the network answers is shown as it answered: a lapsed
 * sign-in's redirect to Access's login page goes there, and never the kept screen in its place.
 * Nothing else passes through here, an image from another host least of all.
 */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || NEVER_KEPT.test(url.pathname)) return;
  // Every address the screen opens at is the screen: the Worker serves it at any of them.
  const kept = request.mode === "navigate" ? "/" : url.pathname;
  if (request.mode !== "navigate" && !SCREEN.files.includes(kept)) return;
  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch (error) {
        const shown = await caches.match(kept, { cacheName: KEPT });
        if (shown) return shown;
        throw error;
      }
    })(),
  );
});

/** A Notification as the Worker pushes it: its title, its tag and the address a tap opens. */
self.addEventListener("push", (event) => {
  let pushed = null;
  try {
    pushed = event.data?.json() ?? null;
  } catch {
    pushed = null;
  }
  // A push shows something whatever it carried: a browser penalises one that shows nothing.
  if (!pushed || typeof pushed.title !== "string") pushed = { title: "Praxis", tag: "praxis" };
  event.waitUntil(
    // One per kind and Context: a new Brief's replaces the last, and still alerts.
    self.registration.showNotification(pushed.title, {
      tag: pushed.tag,
      renotify: true,
      icon: "/icon-192.png",
      data: { open: pushed.open },
    }),
  );
});

/** A tap opens the Conversation it names: in a window of Praxis already open, or a new one. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const open = new URL(event.notification.data?.open ?? "/", self.location.origin);
  if (open.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const shown = windows.find((window) => new URL(window.url).origin === open.origin);
      if (!shown) return self.clients.openWindow(open.href);
      await shown.focus();
      shown.postMessage({ open: open.pathname + open.search });
    })(),
  );
});

// Praxis's service worker. For now it does one thing: a Notification (section 8.7, ADR 0013). It
// shows what the Deployment pushed, fixed wording naming the kind and the Context, and a tap opens
// that Context's Conversation. It caches nothing, and no request passes through it.

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

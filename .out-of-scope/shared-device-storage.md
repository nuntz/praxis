# Keeping journal text off a shared device

Praxis assumes each Device is the person's own. Whatever journal text it keeps in the browser's storage is protected by the Device's own lock. Praxis has no mode that keeps journal text out of persistent browser storage so that it is safe on a shared or borrowed browser.

## What a Device keeps

Two things hold journal text in `localStorage` (`apps/pwa/src/stored.ts`):

- **The Offline Copy**, under `praxis.offline`. It is off until the person switches it on for that Device, and switching it off clears it.
- **Unsent writes**, under `praxis.unsent`. Every Device takes them, with or without an Offline Copy. On a Device with no Offline Copy, an Unsent Entry holds its words and Inline Tasks, and an Unsent finish holds the Task's title.

Neither one is encrypted. Neither is cleared when the sign-in with Access lapses: Unsent writes wait untouched until the person signs in again.

## Why this is out of scope

ADR 0020 decided all of this on purpose. Its promise is that capture never fails, in a lift, on a train or in a shop. That promise depends on the person's words outliving the network, the tab and the sign-in. A mode that kept text out of persistent storage would have to reverse three of the ADR's consequences:

- the Device's own lock is the protection for what the browser stores,
- an Unsent write survives a lapsed sign-in,
- an Unsent write never expires, because throwing away the person's words defeats the point.

Praxis is a one-person app used on the person's own devices. Giving up dependable capture to make a shared browser safe trades the product's main promise for a case it does not serve. A Device that is lost or shared can be removed, which clears its Offline Copy on its next contact.

To revisit this, write a new ADR replacing ADR 0020's storage consequences, rather than adding a mode on top of them.

## Prior requests

- #140: "Unsent writes keep journal text in localStorage with the offline copy turned off"

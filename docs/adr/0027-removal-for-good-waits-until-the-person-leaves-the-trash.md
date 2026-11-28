# Removal for good waits until the person leaves the Trash

Removing an item for good, or emptying the Trash, is the one act in Praxis that cannot be put back, so it is the one place where "undo over asking" (ADR 0005) has nothing to undo with. A tap on Remove for good or Empty the Trash therefore marks what it would remove and sends nothing: the item says it will be removed for good when the person leaves the Trash, beside a Keep it that takes the mark off. The removals are sent when the Trash section closes, by opening another section of Settings, closing Settings or switching Context. We decided this because it keeps the act a single tap, as the rest of Praxis is, while leaving a moment to take it back, which a confirmation would replace with a question.

## Considered Options

- **One tap, sent at once**, as before. Rejected: it was the only irreversible act with no way back, a quiet link 8px from Restore.
- **An inline second step** ("Remove … for good: this cannot be put back", Remove or Keep). Rejected: it asks first, which ADR 0005 rejects everywhere else, and two taps become a habit that protects nothing.
- **Sending when the app is hidden as well**, on `visibilitychange`. Rejected: glancing at another app would remove what the person meant to keep, and an app killed while hidden removing nothing is the safe way to fail.
- **Holding the mark on the server**, so it reaches every Device. Rejected: it adds a state to the Trash, and a tool, for a moment that lasts only as long as one screen is open.
- **Emptying by the screen removing each item it listed.** Rejected: the Trash is read a page at a time, so what was never read would stay, and "Empty" would not empty it.

## Consequences

- The mark lives on the screen only. Nothing about the Trash changes until the removals are sent, so the Agent and a Connection still see a marked item as in the Trash, and the Agent may restore it meanwhile.
- A removal that cannot be sent removes nothing. When the network is gone, the screen's notice says nothing was removed for good. When a marked item has already left the Trash, restored or past its 30 days, nothing is said, since what is so already holds.
- `empty_trash` takes the time of the newest delete the screen showed, and removes everything deleted up to it. Anything deleted after that, by the Agent at the person's asking on another Device, stays in the Trash, so emptying never removes what the person was not shown.
- Removal at 30 days is the Context's alarm, as before, and does not wait for anything.

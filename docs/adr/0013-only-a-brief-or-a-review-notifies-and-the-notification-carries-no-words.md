# Only a Brief or a Review notifies, and the Notification carries no words

When the Agent leaves a Brief or a Review, Praxis sends a Notification by Web Push to each Device the person has switched on. Nothing else in Praxis ever sends one: not a Due Date arriving, not a Connection writing, not the monthly cap stopping Runs, not a Brief that failed to run. The Notification is fixed wording that names the kind and the Context, such as "Work: your Brief is ready", and carries nothing from the Message or the Journal, not even a count. We decided this because a Brief nobody learns about until they open Praxis is only the Attention list with a delay, because a Notification per event would bring back the event triggers that ADR 0004 ruled out, and because a lock screen is outside every Context and outside the object the Conversation's text never leaves (ADR 0010).

## Considered Options

- **Nothing outside Praxis**, only the badge on the Agent tab. Rejected: the Brief is timed by the person to be read at that time, and a badge is seen only once Praxis is already open.
- **Email.** Rejected: a second outbound channel with its own sender and address, and it would carry text derived from the Journal outside the Deployment.
- **A reminder when a Task reaches its Due Date**, or when a Connection writes. Rejected: these are what the Brief sweeps up each day, a Due Date is a day and not a time, and each is an event trigger.
- **Notifying when the monthly cap is reached or a run fails.** Rejected: both are shown inside Praxis when the person next opens it.
- **Putting a count or the first lines of the Brief in the Notification.** Rejected: it is Journal content on a lock screen, and it passes through the wording rule one helpful addition at a time.
- **One Notification for several Contexts** whose Briefs land together. Rejected: it would be the first thing to cross a Context (ADR 0003).
- **A badge on the installed app's icon.** Rejected: it can be set only when a push arrives and cannot be cleared when the Brief is read on another Device, so it would often be wrong.
- **Quiet hours, a switch per kind, or a switch per Device and Context.** Rejected: the person already sets the Brief and Review times per Context, and the Device's own focus modes cover the rest.

## Consequences

- Notifications are off until the person switches them on for a Device, and each Context has one switch covering both its Brief and its Review, beside their times.
- A Brief with nothing to raise leaves no Message and so sends nothing. A Review with nothing to raise leaves its one line and sends nothing either.
- A new Brief's Notification replaces the earlier one for that Context on a Device, and the same for a Review. Two Contexts give two Notifications.
- A Brief or Review is read once Praxis has shown it in a focused window on any Device, and read is held once per Context, not per Device. There is no "mark as read".
- A Notification cannot be withdrawn, so one may linger on a Device after the Brief was read on another. Tapping it opens that Context's Conversation.
- Every switched-on Device receives the Notification, including one with Praxis open at that moment, because browsers penalise a push that shows nothing.
- A late run notifies when it finally happens.
- The Worker holds a signing key pair for Web Push, and the Deployment's Devices hold their push subscriptions. A Device whose subscription the push service reports gone is switched off.
- On iOS a Notification reaches only a Praxis added to the Home Screen.

# The main screen is three peers and each composer has one send

The main screen is Attention, the Journal and the Conversation side by side, and none of them hosts the others: three columns on a desktop, three tabs on a phone, which opens on Attention. The Journal has its own composer, which records an Entry with no model turn, and the Conversation has its own, which sends a Message to the Agent. Where the person types decides what happens, and no composer offers both sends. We decided this because the Conversation is primary but is not data (ADR 0001): a screen built around it would make working on the Journal by hand second-class, and a composer with two sends would sooner or later put into the Journal something meant for the Agent, or the other way round.

## Considered Options

All four were drawn as a prototype before choosing.

- **The Conversation as the screen**, with the Journal in a rail or a sheet. Rejected: direct manipulation becomes second-class, when the screen is meant to stay a real surface.
- **The Journal as the screen**, with the Agent in a dock. Rejected: it hides the Agent, and a Held Change with it.
- **One stream of Entries and Messages.** Rejected: it puts what is kept and what is not in one timeline.
- **One composer with two sends.** Rejected: a wrong send writes to the Journal, or sends the Agent words meant only to be recorded.

## Consequences

- Attention has no composer.
- Recording an Entry needs no model, so it works with no key, at the cap and with no network (ADR 0020). Nothing of the Conversation does.
- A change the Agent makes shows in the other two as it happens, patched from its Effects (ADR 0007).
- A Held Change waits in three places: in the Conversation where the Agent left it, at the top of Attention and on its Entry.
- On a phone, moving between recording an Entry and asking the Agent is a change of tab.
- The share sheet and the home-screen shortcut open the Journal's composer, never the Conversation's.

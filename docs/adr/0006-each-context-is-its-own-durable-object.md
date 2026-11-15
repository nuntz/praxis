# Each Context is its own Durable Object

All of a Deployment's data lives in Durable Object SQLite, and each Context is its own object holding that Context's Journal, Tasks, Projects, Persons, Trash and Conversation. There is no D1. Inside the object the domain lives in Praxis's own tables; the agent runtime's tables hold only the Conversation. One further object belongs to the Deployment and holds the list of Contexts, the Connections and the person's Devices and settings, and nothing from any Journal. We decided this because nothing may cross a Context, and a boundary that is a separate database cannot be forgotten by a query, and because an object's single writer makes a tool call one transaction with no extra machinery.

## Considered Options

- **The Journal in D1, the Conversation in a Durable Object.** Rejected: a tool call would write to a database outside the object that runs it, so it could not be one transaction, and every read would be a network hop. Durable Object SQLite has point-in-time recovery of its own.
- **One object for the whole Deployment, with Context as a column.** Rejected: moving a record would be atomic and there would be one thing to back up, but the boundary would hold only as long as every query remembered its filter.
- **The domain as documents of the agent runtime.** Rejected: it would tie the Journal's shape and survival to an experimental runtime that has already broken its stored format once.
- **Contexts and Connections in KV, or copied into every Context's object.** Rejected: KV is eventually consistent, so an ended Connection could linger, and copies drift.

## Consequences

- The Worker asks the Deployment object which Context a request is for, then talks to that Context's object. A Context's object reaches the Deployment object only through a closed set of calls: the other Contexts' names, whether a Run or a Call may start, what was spent, notify the Devices of a Brief or a Review, and a Call starting or ending. It asks at the start of every Run, whoever started it, and the Worker hands the Agent nothing. The Deployment object reaches into a Context's object only for a Backup, a move, and ending a Call there when another starts elsewhere.
- This replaces an earlier form of this decision, in which a Context's object never read the Deployment object and the Worker handed over the other Contexts' names. A Run the clock starts has no Worker request behind it, and the cap and the one Call at a time hold across Contexts. What the rule protects is unchanged: the Deployment object holds nothing from any Journal, and no Context's object reads another's.
- The month's running spend total is in the Deployment object, fed by each Context as it spends, since a cap across Contexts cannot otherwise be checked without one Context reading another.
- **Routing a clock-started Run out through the Worker and back** was considered and rejected: the same information crosses, with one more hop. So was pushing the names and the cap state into every Context's object, for the reason copies were rejected above.
- Ending a Connection or retiring a Context takes effect on the next request.
- Moving a record between Contexts is a copy between two objects, not one transaction. The unit is never lost and never visible in both Contexts: the source hides it and marks it as moving, the destination takes it under a move id so a retry cannot add it twice, and the source removes it only once the destination has confirmed. An interrupted move is finished from the source's alarm. For a moment the unit is in neither Context's view.
- Ids are unique across the Deployment, not per Context, and a record keeps its id when it moves.
- The runtime's tables can be dropped and the object rebuilt around another runtime without touching the Journal.
- A Context's object is the only place its truth lives. Anything kept elsewhere, such as a search index or a backup, is derived from it, kept per Context, and can be thrown away and rebuilt.
- Each Context has its own alarm, so its Brief and Review are scheduled inside it.
- A jurisdiction is chosen once at setup, optionally, and applies to every object in the Deployment. It cannot be changed afterwards except by export and restore into a new Deployment.
- Each object upgrades its own tables when it wakes (ADR 0019). The daily Backup wakes every object, a retired Context's included, so the distance an upgrade must cover is set by how long the Deployment went without a deploy, not by how long an object slept.
- An Entry is text only. Nothing but backups needs R2.

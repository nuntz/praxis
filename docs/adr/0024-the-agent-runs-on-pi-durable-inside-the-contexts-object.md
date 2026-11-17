# The Agent runs on Pi Durable inside the Context's object

The Agent's loop is Pi Durable, running inside each Context's Durable Object over that object's SQLite. It gives a Run persistence, recovery after a crash or an eviction, and a tool loop, and its tables hold only the Conversation, beside Praxis's own tables for the domain (ADR 0006). We took it because it puts the Agent in the same object and the same transaction boundary as the Journal it works on, with no second store and no service between them. It came with the stack from mise and was not weighed against another runtime here. The rest of that stack (one Worker and one PWA in one workspace, Cloudflare Access, Pulumi with a setup wizard, Bun and Biome) is taken from mise as given, with nothing traded off in Praxis.

## Consequences

- What the runtime does not have is Praxis's to build: it cannot wake itself and has no recurring schedule, so the Context's alarm starts a Brief or a Review (ADR 0004); it has no approval primitive, so a Held Change is Praxis's own (ADR 0005); it has no client protocol, so the socket that carries the answer down is Praxis's own.
- The runtime has no delete for part of a Conversation. The person clears a whole Conversation or nothing (ADR 0010).
- The runtime is marked experimental, and a Conversation that has run on one minor version cannot be read after going back to the one before. This is one more reason a deploy is a one-way door (ADR 0019).
- Because its tables hold only the Conversation, which is not data (ADR 0001), they can be dropped without losing anything true. They are not on the upgrade ladder, and a runtime that cannot open them never blocks the Journal.
- A tool call interrupted by a crash is run again only if the tool is marked safe to repeat.
- How the runtime is wired into a Context's object, and what it does that its own documentation does not make plain, is in [`docs/pi-durable.md`](../pi-durable.md).

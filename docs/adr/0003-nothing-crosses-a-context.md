# Nothing crosses a Context

Every Entry, Task, Project and Person belongs to exactly one Context, and nothing links across two: no shared Person, no wait from a Task in one Context on work in another, no view that shows two Contexts together. For the person a Context is focus, since they can switch and see everything. For the Agent and for MCP callers it is a limit. There is one Agent with one Conversation per Context; inside a Context it knows the other Contexts' names and nothing else. An MCP caller is given exactly one Context when the person authorises it, and no tool takes a Context argument. We decided this because a Context is only worth having if something let into one cannot reach another, and every convenience that joins two Contexts is also a path between them.

## Considered Options

- **A Person shared across Contexts.** Rejected: their Mentions would join the Contexts, so a caller confined to one could learn about the other through them.
- **Waits across Contexts.** Rejected: the waiting Task would show something about work in a Context its readers may not see. The person writes the reason in the Task's own words instead.
- **One Conversation spanning all Contexts.** Rejected: what was said about one Context would be in front of the Agent while it acts in another, and could end up in an Entry there.
- **A combined view of all Contexts.** Rejected: it is the first place two Contexts would sit side by side, and it would need its own rules for what the Agent sees.
- **A Context argument on tools.** Rejected: a caller that can name its Context is not confined to one.

## Consequences

- Someone the person deals with in two Contexts is two Persons.
- A client that needs two Contexts is connected twice, once for each.
- Moving a record to another Context is the one act that crosses the boundary. Only the person can do it, it takes the whole unit (an Entry with its Follow-ups and the Tasks that came from it, a Project with all its Tasks), and any link back into the old Context is dropped with its text kept.
- Retiring a Context hides it and cuts off the MCP connections granted to it. It does not delete or merge anything, and the person can bring it back.
- Anything the Agent does unprompted happens inside one Context.

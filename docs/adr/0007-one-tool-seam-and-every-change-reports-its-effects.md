# One tool seam, and every change reports its Effects

Everything Praxis can do inside a Context is a tool in one registry, and the screen, the Agent and an MCP caller all go through it. A write tool is one thing that can happen (finish a Task, delegate it, record an Entry), not a patch to a record. Every write returns the record it changed and a list of Effects: each other record made, changed or deleted, what happened to it, and whether the call did it directly or a rule did. A call that changes nothing says so. The same Effects go into a change log kept in the Context's object, each with the caller that made it. We decided this because a Task's state is derived from what has happened to it, so a tool that sets fields can express changes that are not events, and because an MCP caller sees nothing but the result of its call, so a result that leaves out what a rule did next leaves that caller wrong about the Journal.

## Considered Options

- **One patch tool per kind of record**, such as `update_task` with optional fields. Rejected: fewer tools for a model to hold, but the server has to work out from a diff what was meant, and a caller can ask for a combination that is not a thing that happens.
- **A smaller or coarser set made for MCP.** Rejected: a second surface is a second place for a rule to be missed, and an outside model deserves the same Effects the Agent gets.
- **Read endpoints shaped for screens**, sharing only the writes. Rejected: a capability the Agent cannot reach is not agentic-first, and screens needing good reads is the pressure that keeps the views good.
- **Returning only the changed record** and letting callers read again. Rejected: a caller does not know what to read again, and a model narrating a bare success says "done" whether or not anything happened.
- **A Context as an input to a tool.** Rejected: nothing crosses a Context, and a tool that cannot name another Context cannot reach one.
- **A general batch tool** running a list of calls in one transaction. Rejected: it multiplies every held and refused case. A compound change exists only as a named tool.
- **A bare `create_task`** that writes a carrying Entry from the Task's title. Rejected: every Task has an Origin Entry and its words should be what was said, not something the server made up.
- **Versioned tool names or a versioned endpoint.** Rejected: a deployment is one person who upgrades everything at once, and an MCP client reads the tool list each time it connects.

## Consequences

- There are two registries. Context tools run inside one Context's object and take no Context as input: the Context is fixed by the Conversation, the MCP grant or the screen before the call arrives. Deployment tools (Contexts, moving a record, grants, devices, deleting a retired Context's data, export) run on the deployment object and are offered to the person's hand only.
- The MCP surface is the Context tools under the same names and schemas, less those never offered to an MCP caller, with held calls refused. Praxis exposes tools only over MCP, no resources or prompts, and sets the read-only and destructive hints from the tool's own metadata. A grant may narrow a caller to reads; it scopes nothing else beyond its Context.
- The screen reads and writes only through tools. Tapping a Held Change and emptying the Trash are tools offered to the person's hand only. A connected PWA receives the Effects of each change and patches what it shows.
- A Task is made only with an Entry named: `record_entry` takes the words and a list of Tasks to make with it, and `add_task` attaches one to an Entry that exists. The editor parses an Inline Task into that list; the server never reads words to find Tasks.
- A link in `record_entry` or `add_link` may name a new Person or Project to make in the same call. The server does not guess that two Persons of one name are the same.
- Reads are a few named views, one filtered list per kind, get by id, one text search and `list_changes` since a cursor. Lists are paged by cursor with a default of 50. Every Task in any result carries its derived state and the reason for it, so no caller works out state. Effects use the same one-line summaries of a record that reads do.
- `list_changes` serves the PWA catching up, an MCP caller polling and the Agent, which is given a bounded digest of what changed since its last turn. How long the log is kept is not decided here.
- Every write accepts an optional key from the caller, remembered for 24 hours per caller; a repeat returns the first result and does nothing again. The Agent's calls get a key from the runtime.
- Only a change to an Entry's words says which version it was made against, and is refused as stale if the Entry has moved on. Any other call that asks for what is already so succeeds with no Effects.
- A result is a success or an error from a closed set of codes: not found, invalid input, not offered to this caller, held, stale, refused. A refusal lists as data each thing in the way, and a change is refused only for what it brings, not for faults already there. For the Agent a held call is not an error; it returns the Held Change it left.
- A call never states its Author; the tool layer stamps it from who is calling. Tool input carries a date as a date, never as prose; the caller resolves "next Friday" with the Context's time zone.
- The set may grow and inputs may gain optional fields freely. The spec lists each tool by name, purpose, who it is offered to and when it is held; the schemas live in the domain package.

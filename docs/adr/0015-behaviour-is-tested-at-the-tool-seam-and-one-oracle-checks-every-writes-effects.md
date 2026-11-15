# Behaviour is tested at the tool seam, and one oracle checks every write's Effects

A behaviour of Praxis is tested where it is specified: at the tool seam. A test calls a tool through the registry as a named caller (the person's hand, the Agent, an MCP caller, a read-only MCP caller or an unprompted run) against a real Context object in workerd, and asserts only what a caller can see: the result, the Effects and later reads. Tests set up their state the same way, by calling tools and moving the clock, and never by writing rows. Tests do not read tables either, with one exception that belongs to the harness and not to any test: every write call in every seam test is wrapped by an oracle that snapshots the Context's domain tables before and after, and fails unless the difference is exactly the Effects returned and the same Effects are in the change log with the right caller. Which caller is offered which tool, and which calls are held or refused, is checked against a table written by hand and kept in the repo, not against the registry's own metadata. We decided this because three callers share one seam and an MCP caller sees nothing but the result of its call, so the result is the contract, and because the Effect most likely to be missing is the one a rule made that nobody thought to assert.

## Considered Options

- **Unit tests on domain functions as the main body, with a thin layer above.** Rejected: the rules live in the pure package but the promise is made by the tool, and a rule that is right in isolation can still be left out of a tool's Effects or offered to the wrong caller.
- **Asserting on tables in tests.** Rejected: it ties every test to the schema, and it lets a test pass on a row that no read ever shows a caller.
- **Seeding state by inserting rows.** Rejected: it builds states no sequence of calls can reach, and hides the day a tool stops being able to reach one that matters.
- **Asserting Effects by hand in each tool's tests.** Rejected: hand-written assertions catch only the Effects someone listed.
- **Deriving the expected offering from the registry's metadata.** Rejected: it compares the metadata with itself. With a table kept by hand, a change in who is offered what always shows as a diff to one file.
- **A line-coverage threshold.** Rejected: the registry is the unit of coverage, and a guard on it says more than a percentage.

## Consequences

- The workerd test setup can stand up several Context objects and the deployment object in one test, since moving a record and "nothing crosses a Context" need more than one.
- The pure domain package keeps direct tests only where the input space is too large for scenarios: a Task's derived state and its reason, Recurrence dates and parsing an Inline Task.
- No domain or tool code reads the real clock. A test sets the time and the Context's time zone, and fires alarms itself.
- The oracle also holds a refused, stale or repeated-key call to changing nothing, a held call to changing nothing but the Held Change it leaves, and a call that reports no Effects to changing nothing.
- The offering table has one row per tool and one column per caller, saying offered, held or refused. It is the same table the spec carries. A second, generic test calls every tool as every caller and asserts that one not offered returns "not offered" and changes nothing.
- A guard fails CI when a tool in the registry has no row in the offering table or no seam test that names it.
- A state that takes time to reach, such as a record 31 days into the Trash, is reached by moving the clock between calls. The one fixture not made through tools is an object on an old schema, for upgrade tests; it was made through the tools of its own release and saved as a dump (ADR 0019).
- The harness, not each test, also checks that no words leave the object: tests seed Entries and Messages with marker strings, and a marker found in anything logged, in a Notification or in a Run record fails the test.
- The browser suite has offline journeys (ADR 0020): record an Entry with no network and see it sent on reconnecting; finish a Task with no network and see it sent; a finish the server refuses, shown as not accepted until dismissed; a write whose answer was lost, sent again and made once; and reading the Offline Copy, with the Conversation showing only that it needs the network. A seam test covers the made-at time and a link to a record in the Trash.

# What carries over from mise

Research for [#5](https://github.com/nuntz/praxis/issues/5), a ticket on the map [#1](https://github.com/nuntz/praxis/issues/1). Researched 2026-11-14.

**Question.** Which of mise's recorded decisions and structures apply to Praxis, beyond those the map already takes as given?

**Sources.** Only mise's own public repository, [nuntz/mise](https://github.com/nuntz/mise), read at commit [`fcd3d7d`](https://github.com/nuntz/mise/commit/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e) (master on 2026-11-14): all 33 ADRs in `docs/adr/`, `SPEC.md`, `GLOSSARY.md`, `CODING_STANDARDS.md`, `AGENTS.md`, `README.md`, `docs/research/`, `docs/security/`, `docs/agents/`, the workspace layout, the CI workflow, the tool registry and the commit history. Every link below is a permalink at that commit. What Praxis is comes only from the map's Notes.

**How to read the verdicts.** Each candidate says what mise decided, why, and whether Praxis has the same forces:

- **Applies**: the force is the same, so take the decision as it stands.
- **Applies with changes**: the force is there, but something about Praxis (one person, the Journal, MCP as a surface, Contexts) changes the answer.
- **Does not apply**: the force is absent.

A verdict here is a recommendation for the map, not a decision. Section 14 lists what reads as a regret or a workaround; those are **my inferences from the record**, not views the author stated.

## Summary

| # | Candidate (mise source) | Verdict |
|---|---|---|
| 0 | Taken as given: workspace, Access, Pulumi and wizard, one tool entry point, Bun and Biome (ADRs 0002, 0004, 0005, 0007) | Given |
| 1.1 | Domain data in own SQLite tables; clients get change notices and refetch (ADR 0002) | Applies with changes |
| 1.2 | A tool's definition carries its metadata: what it changes, when it waits for a person (tool registry) | Applies with changes |
| 1.3 | A tool call is one transaction; writes that stand or fall together are one tool (coding standards) | Applies |
| 1.4 | Bytes travel over HTTP beside the tools; the mutation stays a tool (ADRs 0010, 0011) | Applies with changes |
| 1.5 | A pure domain package with no Cloudflare or Bun imports (ADR 0004) | Applies |
| 2.1 | The agent cannot confirm for a person: held calls, run only by a tap (ADR 0024) | Applies with changes |
| 2.2 | Some tools are never offered to the agent (ADRs 0024, 0025, 0027) | Applies with changes |
| 2.3 | An LLM drafts, a person makes it count; deterministic code computes, the agent narrates (ADR 0023, SPEC §2) | Applies with changes |
| 2.4 | What the agent chose stays told apart from what the person chose (ADRs 0013, 0030 to 0032) | Applies with changes |
| 3.1 | A change is refused only for the problems it brings, and the error lists them (ADR 0012) | Applies with changes |
| 3.2 | Consequences are derived when read, never stored (ADRs 0012, 0014, 0015) | Applies |
| 3.3 | A result says when nothing changed; a reason is structured data (ADRs 0013, 0030) | Applies |
| 3.4 | A derived artefact stores a fingerprint of its inputs and says when it is stale (ADR 0015) | Does not apply yet |
| 4 | Testing: two runners, real workerd for SQL, fakes that keep the contract, CI never calls a model, evals by hand, check scripts (ADR 0003, coding standards) | Applies |
| 5 | Backup is a deterministic dump of every domain table, with round-trip test and counted retention (ADR 0006) | Applies with changes |
| 6 | Notifications: Web Push sent by the Durable Object itself, per device (ADR 0025) | Applies with changes |
| 7 | Voice: GPT-Live as voice only, answered over a sideband by the same agent (ADR 0028) | Applies with changes |
| 8 | Offline: a queue of set operations on the device; the page keeps what it shows (ADR 0018) | Applies with changes |
| 9 | Tokens for readers that cannot sign in: routed before identity, never a tool, never a Caller (ADRs 0019, 0027, 0029) | Applies with changes |
| 10 | The agent conversation log read with a service token, and transcript tooling (ADR 0029) | Applies with changes |
| 11 | Design system: CSS custom properties, `tokens.css` as the source, themes as token sets, self-hosted fonts (ADRs 0020, 0033) | Applies with changes |
| 12 | Pi Durable settings learned in use (research note) | Applies; owned by #3 |
| 13 | Working practices: glossary with "avoid" terms, amended ADRs, standards from retros, agent self-check commands, upgrade and secret rules | Applies |
| – | Meal-domain decisions (ADRs 0001, 0008, 0009, 0014, 0016, 0017, 0021, 0022, 0026) | Do not apply |

## 0. Taken as given

One line each, as the map asks.

- **Worker plus PWA in one workspace**: a Bun workspace of `packages/domain`, `apps/worker`, `apps/web`, `infra` ([ADR 0004][a04]).
- **Access with the Worker verifying identity**: the Worker checks the Access token itself against keys, audience and issuer; the Durable Object trusts only the Worker ([ADR 0007][a07]).
- **Pulumi, a wizard, config outside the repo**: every deployment value lives in Pulumi Cloud and ESC; the repo ships only an example ([ADR 0005][a05]).
- **One tool entry point**: a single validated `callTool(name, input)` rather than a callable per tool ([ADR 0002][a02]).
- **Bun and Biome**: Bun installs, runs scripts and tests, and is never the runtime ([SPEC §2][spec]).

## 1. The tool seam and the workspace

### 1.1 Own tables, change notices, no SDK state document

- **Decided.** Domain data lives in mise's own SQLite tables in the Durable Object. Connected clients receive only small change notices (a topic, a revision and, for some changes, which records) and refetch through tools. The Agents SDK's broadcast state document is not used for domain data ([ADR 0002][a02]). Topics are a short enum (`household`, `recipes`, `plan`, `grocery`, `chat`, `voice`) declared on each tool ([tools.ts][tools]).
- **Why.** One blob of state would duplicate the database and give the UI a second source of truth.
- **Praxis.** **Applies with changes.** The force is the same and stronger: three kinds of caller (Agent, UI, MCP) must see one truth. Two changes. First, an MCP caller is not a connected WebSocket client, so it never gets a notice; a tool's result has to be enough on its own (see 3). Second, notice topics need to be designed for a Journal: mise found that a coarse topic cost every screen a reload and later had notices name the changed Recipes ([coding standards, "A partial refresh owes what the last one missed"][cs]; commits `c91fd2e`, `f0540c1`). A Journal with thousands of Entries wants notices that name what changed from the start. Where data lives is ticket #10.

### 1.2 A tool's definition carries its metadata

- **Decided.** Each tool is defined once in the domain package with its input and output schemas plus: the topic a success changes (absent for reads), when a call from the agent must wait for a person (`confirm`), and how many things its result lists, so that a long list is offered rather than read aloud ([tools.ts][tools]). Results are `{ ok, value } | { ok, error }` with a closed set of error codes.
- **Why.** The registry is "the one list of what Mise can do" ([ADR 0002][a02]); policy placed anywhere else can be missed by one caller.
- **Praxis.** **Applies with changes.** Same force. The metadata Praxis needs is larger: read or write, which Context a call touches, whether it is offered to the Agent, whether it is offered over MCP, and what the Agent may do without asking (ticket #9). mise had two classes of caller (a screen, the agent); Praxis has a third, and an MCP client is itself usually a model, so "from a screen it runs at once" does not extend to it (see 2.1). This is the substance of ticket #11.

### 1.3 A tool call is one transaction

- **Decided.** "A tool call runs in one transaction, the only all-or-nothing unit there is." When one write means nothing without another, one tool does both, and the server decides what the browser would otherwise guess ([coding standards, "Writes that stand or fall together are one tool call"][cs]). The pi harness also runs a round's tool calls in the order the model made them, not in parallel ([Pi Durable note, "Decisions"][pi]).
- **Why.** A screen that chained two calls left half-made state when the second failed (mise #76).
- **Praxis.** **Applies.** An Entry whose References and Mentions create or change Tasks, People and Projects is exactly a set of writes that stand or fall together.

### 1.4 Bytes over HTTP, beside the tools

- **Decided.** Photos and uploaded import files travel over `PUT`/`GET` routes because megabytes of binary do not fit in a JSON tool call over a WebSocket. The routes carry only bytes; anything that is a mutation with a typed result (the import itself) stays a tool that takes the upload's id ([ADR 0010][a10], [ADR 0011][a11]).
- **Why.** Message size limits, and keeping the tool the one path for mutations.
- **Praxis.** **Applies with changes.** It applies only if Entries can carry attachments (images, audio), which the map does not say. If they can, the staging pattern is ready-made, with one change: an MCP caller cannot use an Access-protected `PUT` the way the PWA can.

### 1.5 A pure domain package

- **Decided.** `packages/domain` holds the schemas, the tool registry and all deterministic logic, with no Cloudflare or Bun imports, enforced by the package boundary ([ADR 0004][a04]).
- **Why.** Fast tests, client and Worker sharing tool types, and no vendor lock in the domain layer.
- **Praxis.** **Applies.** Derived Task state, Recurrence and the parsing of References and Mentions out of markdown are deterministic logic of this kind, and the PWA needs the same parser the Worker uses. mise went further and put its offline queue in the domain package too ([ADR 0018][a18]).

## 2. What the agent may not do for a person

### 2.1 The agent cannot confirm for a person

- **Decided.** Destructive calls, safety overrides and changes that loosen a safety rule or change who the agent takes a speaker for are not run when the agent makes them. The Durable Object returns a Pending Confirmation, the chat shows a button naming exactly what will happen, and only the person's tap runs the call. The model has no way to confirm, "whatever the person types and however the model reads it". A confirmation can be cancelled (by tap or by telling the agent), and it expires once the state it describes changes, so a tap never runs a call against something other than what its button said. The same calls from a screen run at once, because the PWA asks in its own dialogs ([ADR 0024][a24], [confirmations.ts][conf], [GLOSSARY][gloss]).
- **Why.** "A prompt that says 'ask before deleting' is a request to the model, not a guarantee." Putting the rule in the tool layer makes it hold for any model, any prompt and voice.
- **Praxis.** **Applies with changes.** The mechanism (held calls enforced in the tool layer, a button that names the effect, expiry on change) carries over whole. Three things differ:
  - *Which calls are held.* mise's list came from allergy safety. Praxis needs its own, and there is a tension mise did not have: an agentic-first product wants the Agent to act freely, and a personal journal is hard to restore by hand. This is ticket #9.
  - *MCP callers.* mise let a screen's calls run at once because a person tapped. A call arriving over MCP comes from another model, with no Praxis screen to show a button on. Either MCP calls of held tools are refused, or they leave a Pending Confirmation that the person taps in the PWA. mise has no answer to this; tickets #4, #9 and #11 need one.
  - *Unprompted runs.* mise's scheduled job only ever made a proposal that a person could change. An Agent that acts unprompted (ticket #8) has nobody present to tap.
- mise learned several details in use that are worth keeping: each turn tells the agent which confirmations are waiting now, because a tap, cancel or expiry on a screen never reaches the conversation (commit `c5c52b4`); the agent must always make the call rather than ask in prose first (`9fb4535`); and in voice a confirmation is a tap, never a spoken "yes" ([ADR 0024][a24]).

### 2.2 Tools never offered to the agent

- **Decided.** First-run setup is not offered to the agent. Neither are a device's own notification settings ("only the device can turn its notifications on") nor the tools that mint a bearer token ("a token shown once must not pass through a model") ([ADR 0024][a24], [ADR 0025][a25], [ADR 0027][a27]).
- **Why.** Each is either about one device or handles a secret.
- **Praxis.** **Applies with changes.** The same two categories exist (device settings; anything that mints or shows a credential, which will include whatever MCP clients authenticate with). The change is that "offered to the Agent" and "offered over MCP" are separate switches.

### 2.3 An LLM drafts, a person makes it count; code computes, the agent narrates

- **Decided.** "The agent does not compute plans or lists; it calls deterministic tools and narrates results" ([SPEC §2][spec]). The week's plan comes from a pure, seeded function ([ADR 0013][a13]). Where an LLM does produce data (an allergen guess, a recipe read from a screenshot), it lands as a Suggestion or a Draft that changes nothing until a person accepts it, and the screen says it is AI-drafted ([ADR 0023][a23], [ADR 0022 amendment][a22]). Auto-applying above a confidence threshold was rejected: "a confident wrong Allergen is the failure that matters."
- **Why.** Safety, and repeatability: a deterministic parser's results "never change behind anyone's back".
- **Praxis.** **Applies with changes.** The half about computation applies as it stands: derived Task state, due dates and Recurrence should be computed by tools, never by the model. The draft-then-accept half is weaker here. Nothing in Praxis is as costly to get wrong as an allergen, and requiring acceptance for everything the Agent writes would undo "agentic-first". What probably carries over is the narrower rule in 2.4: keep the Agent's writing marked as the Agent's.

### 2.4 What the agent chose stays told apart from what the person chose

- **Decided.** After three attempts mise settled on two states: a dinner is *pencilled* (Mise chose it, it carries a structured reason, and a later proposal may change it) or *the Household's own* (a person chose, kept or cooked it, and no proposal changes it). Any direct edit by a person makes it their own. The earlier Lock control, the "Propose again" control and a Week-level "reviewed" flag were all retired ([ADR 0030][a30], [ADR 0031][a31], [ADR 0032][a32]).
- **Why.** Three controls "whose difference took an ADR to explain"; a flag that repeated, less precisely, what the per-dinner state already said and that someone had to clear by hand.
- **Praxis.** **Applies with changes.** The force is squarely present: an Agent that files, reschedules and rewrites needs a rule for what it may later change again without asking. The mise answer is a per-record provenance that a person's edit flips, shown in the UI, with no separate review state. In Praxis the records are Entries and Tasks rather than slots, and the question joins ticket #2 (is what the Agent says part of the Journal?) and ticket #9.

## 3. How changes report their consequences

### 3.1 A change is refused only for the problems it brings

- **Decided.** A slot change is refused when it leaves a Conflict the slot did not have before and no Override covers. The error lists each Conflict as data (who, which allergen, which slot) "so the PWA and the agent can name them and ask before overriding". A Conflict that already existed stays visible and blocks nothing, since blocking would also block the edit that fixes it. One tool can set several fields so that a change is "checked once, against how the Slot ends up", not through an intermediate state that would be refused ([ADR 0012][a12]).
- **Why.** Safety without deadlock, and one wording of the problem for every caller.
- **Praxis.** **Applies with changes.** Praxis has no allergens, but it will have invariants a change can break: a Task completed while its sub-tasks are open, a dependency cycle, deleting a Project or Person that Entries refer to, moving something between Contexts (tickets #6, #7). The transferable rules are: return the consequences as structured data in the result or error, judge a change by what it brings rather than by the state it found, and let one call carry a compound change. For MCP this matters more than it did in mise, because an MCP caller gets nothing but the result.

### 3.2 Consequences are derived when read, never stored

- **Decided.** Conflicts "are computed when a Slot is read, never stored". A recipe's last-cooked date and cook count are derived from the slots that cooked it. Whether a constraint is hard follows from its kind and is not stored ([ADR 0012][a12], [ADR 0014][a14], [ADR 0008][a08]).
- **Why.** A correction elsewhere applies everywhere at once, and nothing can drift.
- **Praxis.** **Applies.** The map already says "Task with derived state". mise is evidence that this holds up in use, and its one stored summary flag was later removed as redundant ([ADR 0031][a31]).

### 3.3 A result says when nothing changed, and a reason is data

- **Decided.** Tools that may or may not change anything return `{ week, changed }`, "rather than returning the same Week as if something had happened" ([ADR 0030][a30], [weeks.ts][weeks]). Each proposed dinner's reason is structured data, worded by the PWA through its message catalogue and narrated by the agent ([ADR 0013][a13]). A write tool's notes say which other reads it makes stale ([ADR 0014][a14] consequences).
- **Why.** Both the screen and the agent otherwise claim a change that did not happen.
- **Praxis.** **Applies.** A model narrating a tool result will say "done" unless the result says otherwise.

### 3.4 A fingerprint of inputs marks a derived artefact stale

- **Decided.** The grocery list stores a fingerprint of the plan it was built from; reading it says `planChanged` when the plan has moved on, and nothing rebuilds it behind a shopper's back. A fingerprint was chosen over a counter bumped by every tool "because it can't miss one" ([ADR 0015][a15]).
- **Praxis.** **Does not apply yet.** Nothing on the map is a stored artefact built from other records. It becomes relevant if the Agent produces summaries or reviews that are kept (ticket #8, Recall).

## 4. Testing strategy

- **Decided.**
  - Two runners: `bun test` for the pure domain package; Vitest inside real workerd for anything touching the Durable Object, SQLite or routes; Vitest in jsdom for the client. "SQL is only ever tested against the real thing", because a fake SQLite would not reproduce Durable Object SQLite's transaction rules and limits ([ADR 0003][a03]).
  - "A test fake keeps the real adapter's contract", with one test driving both the fake and the real adapter ([coding standards][cs]).
  - "CI never calls a model": every LLM use sits behind an interface and tests run on a fake; real models are checked by hand with recorded fixtures and agent eval cases whenever a prompt or model changes ([coding standards][cs], [SPEC §4.2][spec]).
  - One `bun run ci` command runs every step locally and in CI ([workflow][ci], [package.json][pkg]).
  - Guard scripts, most of them added after a miss their header names: `check:tests-run` (a test file no runner reaches), `check:web-calls` (a screen calling a tool no web test names), `check:private` (a personal email or a deployment value committed), `check:stories` (a spec story no ticket claims), and `check:export`, which replays the latest nightly backup through the new code's migrations and parsers before each deploy ([scripts][scripts], [coding standards, "Tightening a parser is a change to stored data"][cs]).
  - A screenshot command that renders every seeded screen for review, in each theme and in a pseudo-locale ([AGENTS.md][agents], [ADR 0020][a20]).
- **Why.** Most items trace to a bug or a silent gap that the standard or the script header names.
- **Praxis.** **Applies**, nearly unchanged; the forces are the stack's, not the domain's. Additions Praxis needs: the MCP surface wants its own seam tests (the same tools reached over MCP, including refusal of held calls), and agent evals matter more when conversation is the primary surface. `check:export` is worth having from the first deploy, since a personal journal is the one dataset that must stay readable.

## 5. Backup

- **Decided.** A nightly, deterministic dump of every domain table to R2, not through the tools. The same data always gives the same bytes, which lets a test assert export → restore → export is identical. A new table is backed up automatically, and a test pinning the table list fails when one appears, as a prompt to check it. Restore loads only into an empty deployment at the same schema version and validates every row through the domain parsers before committing. Retention keeps the newest 30 and the earliest of each month, counted rather than aged, so a stopped backup deletes nothing. Conversation tables and the harness's own tables are left out; blobs in R2 are referenced, not copied ([ADR 0006][a06]).
- **Why.** "Data lives in one DO; export from day one" ([SPEC §2][spec]); determinism makes the round trip testable.
- **Praxis.** **Applies with changes.** The map lists backup and export as unspecified; this is a proven starting point, with four changes to weigh:
  - *Conversation.* mise leaves the agent conversation out because it "is conversation, not Household data". In Praxis that depends on ticket #2: if conversation is part of the Journal, or the Agent remembers across conversations, it is data and must be in the backup.
  - *Export for people.* A table dump is a restore format. A Journal of markdown Entries also invites a human-readable export; mise never needed one.
  - *Restore across versions.* "Restoring it with the release that wrote it, then upgrading" is a real cost for a single self-hoster years later.
  - *Where data lives.* The whole design assumes one Durable Object's SQLite (ticket #10). Contexts in separate stores would change it.

## 6. Notifications

- **Decided.** The Durable Object sends Web Push itself: it encrypts per device and signs VAPID with WebCrypto, with no push library ("about a hundred lines of RFCs with test vectors"), tested against a pretend push service. A subscription belongs to a device, not a person; each device picks which kinds it gets. The VAPID key is a deployment secret the wizard makes once. The morning job is one daily run that asks what is due, not an alarm scheduled per event, so a settings change needs no rescheduling. A push service answering 404 or 410 removes the device. Messages say little ([ADR 0025][a25], [SPEC §4.9][spec]).
- **Why.** No library runs on Workers without Node's crypto; device-level routing was all a household needed.
- **Praxis.** **Applies with changes.** The mechanism carries over whole, and "per device, not per person" is simpler still with one person. What changes is the content: which Context a notification may reveal on a lock screen (a Work device showing a Personal task, or the reverse; ticket #7), and what the Agent pushes when it acts unprompted (ticket #8). On iOS, Web Push needs the PWA installed to the Home Screen ([README, "Notifications"][readme]).

## 7. Voice

- **Decided.** GPT-Live is "only the voice": it listens and speaks, and the same agent does all reasoning and tool calls. The Worker creates the session; the Durable Object holds a sideband WebSocket to it, cuts a turn from the transcript on each delegation, runs it through the same path as chat, and returns the answer to be spoken. The Durable Object also meters usage and closes the session at a daily cap. Rejected: the browser answering delegations, a second model reasoning per turn, and a chained speech-to-text pipeline ([ADR 0028][a28]). The research note records the spike: about 4 s on desktop and under 3 s on a phone from last word to spoken answer, and GPT-Live answering on its own only for greetings ([voice research][voice]).
- **Why.** One brain, one conversation, one set of tools and confirmations.
- **Praxis.** **Applies with changes.** The map leans to GPT-Live and defers voice until the Agent's shape is known. The architecture carries over. The costs mise recorded come with it: the Durable Object stays in memory for the whole session and receives reflected audio it discards; a deploy ends the session with no reattach; iOS turns the mic off when the screen locks while the session keeps billing; spoken answers need their own wording; a failure needs wording the voice model cannot turn into "say it again"; confirmations are tapped. The use differs: mise's voice is for hands-busy moments in a kitchen, while Praxis's obvious use is dictating an Entry, where the person's exact words are the data and a paraphrasing voice layer may be the wrong tool for capture. That is a question for the voice ticket, not answered by mise.

## 8. Offline behaviour

- **Decided.** Offline, a shopper can tick and add grocery lines and nothing else. Each change goes into a queue on the device before it is sent, and is resent until acknowledged; this is safe because both are set operations: a tick carries its own time and the latest wins, and an added line carries a key the device made up, so adding twice returns the same line. A refused change is dropped and the page says so. The service worker caches only the app shell. Because tools travel over a WebSocket, which a service worker cannot see, the page keeps the data it shows offline in `localStorage`, each item checked against its schema when read. Everything else needs a connection and says so ([ADR 0018][a18], [ADR 0015][a15]).
- **Why.** One narrow moment (an aisle with no signal) had to work; adding HTTP read routes would have been a second way to read the same data.
- **Praxis.** **Applies with changes.** The techniques carry over: idempotent writes under a client-made key, last-write-wins by the time of the act, a queue in the pure domain package, schema-checked local copies, controls that say why they are disabled. The scope does not. mise could name one offline moment; a journal's offline moment is capture, anywhere, and an Entry is free text, not a set operation. Appending a new Entry under a client key is safe to replay; editing an existing Entry offline is a merge problem mise never faced. The Agent is unavailable offline by nature. The map lists offline as unspecified; it probably deserves a decision before the transport is fixed (see 14, item 7).

## 9. Tokens for non-interactive readers

- **Decided.** Three readers cannot sign in through Access, and each got its own narrow door:
  - *Calendar feed*: a 256-bit token in the URL path, compared in constant time, rotatable, with any failure answering 404; the feed names no person and no allergen because "anyone with the link can read it" ([ADR 0019][a19]).
  - *Kitchen display*: a bearer token in a header, one per device with a label and last-used time, only its SHA-256 stored, shown once, revocable alone; JSON errors the device can tell apart; a strict output schema so a test catches any field added by mistake ([ADR 0027][a27]).
  - *Agent log*: an Access application of its own admitting one Access service token made by Pulumi, which the Worker verifies again itself ([ADR 0029][a29]).
- All three share a shape: the Worker routes the path before it resolves a Caller and calls a Durable Object RPC method that is not callable from any client and "runs no tool". The token is never a Caller. Each is read-only and returns a deliberately reduced view.
- **Why.** "A tool's caller is someone who signed in" ([ADR 0019][a19]). The second design reads to me as an improvement on the first: a header keeps the token out of logs and error reports, hashing means a leaked backup does not leak tokens, and per-device tokens can be revoked one at a time. The calendar token, by contrast, is stored in the clear and so "anyone holding an export can read the feed until the token is rotated".
- **Praxis.** **Applies with changes.** The good practices carry over directly (header not URL, hash at rest, shown once, label and last-used, per-client revocation, reduced views, routing before identity). The large change: every mise token is read-only and none can call a tool, while an MCP client must call tools, writes included. So Praxis needs something mise never built: a non-interactive principal that *is* a kind of caller, with a recorded identity and a scope (which tools, which Contexts). Whether that is Access service tokens, OAuth or Praxis's own tokens is ticket #4. mise's rule that a service token is never a Caller would have to be consciously reversed for MCP, not inherited. If Praxis later wants a calendar feed of due Tasks or an ambient display (both on the map's "other ways in"), ADRs 0019 and 0027 apply almost as written, with the reduced view decided per Context.

## 10. The agent conversation log

- **Decided.**
  - One shared conversation per deployment, never reset; the harness compacts it. Each turn records who is speaking and which screen it came from ([SPEC §4.7][spec]).
  - A read-only `/agent-log` route returns the recent turns, tool calls (ok or error), held confirmations and voice exchanges. It sits behind its own Access application and service token. `bun run transcript` formats it, locally or from the deployment, with `--costs` and a `--totals` mode that prints aggregates and none of the text ([ADR 0029][a29], [AGENTS.md][agents]).
  - The conversation may reach the developer's terminal and coding agent, and "never goes into git, Sentry, CI logs or the Backup". Error reporting carries no chat content, by scrubbing in the SDK and again in the Worker ([README, "Observability"][readme]).
  - A failed turn stays shown as unanswered and the next run answers only the newest turn ([SPEC §4.8][spec]; [Pi Durable note, "Pi 1.5"][pi]).
- **Why.** "When a voice or agent hand test fails, the agent debugging it needs to see what the deployed Household heard, said and did. Sentry carries no chat content and no tool calls."
- **Praxis.** **Applies with changes.** A way for the developer (and a coding agent) to read what the deployed Agent did is needed from the first agent ticket; mise added it late (see 14, item 5). Changes: with one person per deployment there is no speaker to record, but there is a Context to record on each turn; whether one never-reset conversation is right is ticket #2; and the privacy line moves, because a personal journal's conversation is more sensitive than a meal plan's, which favours the totals-only mode as the default and the full text as a deliberate act. If conversation becomes Journal data, the "never in the Backup" rule reverses (see 5).

## 11. The design system

- **Decided.** Tokens are CSS custom properties in one `tokens.css`; components are plain CSS classes that use only tokens, never a hex; no CSS-in-JS and no utility framework. A second look (kitchen mode) is a theme that redefines tokens and never layout, chosen per device and deliberately not tied to `prefers-color-scheme`. Fonts are self-hosted so they work offline and no request goes to a third party. Screens are checked in a pseudo-locale that lengthens every string ([ADR 0020][a20]). Later, `tokens.css` became the source of truth and the external Design System artifact is re-synced from it, after the artifact fell fifteen tokens behind the app ([ADR 0033][a33]). Design rules (heading roles, five button roles, what a chip's colour means) live as comments above the CSS rules and tests enforce the mechanical part ([coding standards][cs]). Screens are explored as boards on a design canvas that use the app's real markup and stylesheets, so the chosen board's CSS is most of the diff ([design canvas note][canvas]). Chat and voice surfaces were built directly from the design system, not mocked up, as "mostly behaviour" ([SPEC §8][spec]).
- **Why.** Few screens, offline caching, and a framework (SolidJS) that needs neither CSS-in-JS nor utilities.
- **Praxis.** **Applies with changes.** The structure carries over: tokens in code as the source from day one, themes as token sets, self-hosted fonts, pseudo-locale, rules enforced by tests. The changes are in content. The identity is Praxis's own. A theme per Context is a natural use of the theme mechanism (a visible cue for Work or Personal), which is a design question for tickets #7 and #12. An ordinary dark mode following the system setting is likely wanted here, where mise deliberately had none. And mise treated chat as a sheet over screens; in Praxis conversation is the primary surface, so it cannot be left unmocked the way mise left it (ticket #12).

## 12. Pi Durable in use

mise's [Pi Durable note][pi] compares its agent with the upstream examples and records what was changed as a result. Ticket #3 owns this subject; the findings that should be inputs to it:

- Compaction thresholds must be set for the model's window; with defaults on a 1M-token model, compaction "will in practice never run".
- A changed agent model does not reach a conversation that already exists unless the host sets it on start.
- Tool rounds default to parallel; mise set them sequential so calls run in the order the model made them.
- Read-only tools are marked safe to replay; writes are not.
- The harness's own failures are reported only if the host passes `onReport`, and mise reports them without content.
- A run can end without an answer for several reasons, and only some leave a failed answer in the transcript, so the host must read both to mark a turn unanswered.
- Queued turns behind a failed run are withdrawn (`afterFailedRun: "withdraw"`).
- An upgrade past Pi 1.5 can only be rolled forward, not back.
- Pi's Anthropic adapter sends only a schema's root properties, so a tool whose input is a union at the root must be flattened.

**Applies**, subject to the Pi version Praxis starts on.

## 13. Working practices

All **apply**; they are about building with coding agents on this stack, not about meals.

- **Glossary with "Avoid" terms** and ADRs treated as coding standards ([GLOSSARY][gloss], [coding standards][cs]). mise distinguishes *Member* (a person in the domain) from *Caller* (whoever signed in). Praxis has the same split between *Person* (someone mentioned in the Journal) and the one person who signs in, and will need a third word for an MCP client.
- **ADRs are amended in place** with an "Amended by" note, so each still reads true ([ADR 0013][a13], [ADR 0030][a30]).
- **Coding standards grow from retros**: each rule cites the bug it came from ([coding standards][cs]; the `chore: retro on #…` commits).
- **One command each for an agent to check its own work**: CI summary, screenshots, wait-for-deploy, transcript, upstream release notes ([AGENTS.md][agents]).
- **"An upgrade accounts for what upstream changed"**: for a project pinned to a beta harness, each changelog entry is matched to the code it reaches ([coding standards][cs]).
- **"A value the deploy log must not show is a secret"**: a public repo's deploy log is public, and masking a plain variable half-works ([coding standards][cs]).
- **CI signs in to Pulumi Cloud through GitHub OIDC**, with no long-lived token ([ADR 0005][a05], [README][readme]).
- **Dependency install scripts do not run by default**, and a dated dependency review records each advisory, its reachability and each override as a temporary exception ([SPEC §6][spec], [security review][sec]).
- **A fictional sample dataset** for development, screenshots and the round-trip test, so no real data is ever committed ([ADR 0005][a05]).
- **A walking skeleton first** (first-run setup, deployed, with backup and error reporting) before features ([SPEC §8, Drop 0][spec]), and an **agent harness spike** before building on a beta runtime (Drop 2).

## Does not apply: the meal domain

These decisions answer forces Praxis does not have: a canonical Item catalogue and its shipping in code (ADRs 0001, 0009), hard constraints naming an allergen (0008), cooking and ratings on the slot (0014), leftovers (0016), staples (0017), a recipe's course (0022), and a bought dish as a recipe (0026). Three leave a general lesson worth a line:

- **Fail closed on the unknown** (0001, 0009): an unmatched ingredient counts as conflicting. Praxis's analogue is small: an unresolved Reference or Mention should stay visibly unresolved, not be guessed.
- **Reuse an existing concept before adding a kind** ([ADR 0026][a26]): a new kind of slot "would need its own Conflicts, grocery line, Leftovers, cooking and Ratings". This is the argument to hold in mind in ticket #6 before sub-tasks become a second kind of thing.
- **A setting that changes how records are keyed applies going forward and rewrites nothing** ([ADR 0021][a21]). Praxis may meet this in Recurrence or a week-start preference. The same ADR and several fixes (`62170e7`, `a3b3c28`) show that "today", "tomorrow" and "this week" must be computed in the deployment's timezone and stated to the agent on each turn.

## 14. Inferred regrets and workarounds

**Everything in this section is my inference** from amendments, reversals, late additions and workarounds in mise's record. The author has not stated these as regrets. Each is a candidate for doing differently in Praxis.

1. **The Pi Durable defaults were checked after the agent shipped.** The agent landed on 2026-10-23/24, and the note comparing it with upstream found, the same day, that compaction would never run, a model change would not reach existing conversations, tool order was not guaranteed and the harness's failures went unreported; five fixes followed at once ([Pi Durable note][pi]; commits `b63f30e`, `160e7a7`, `c30ead9`, `4f43b8f`, `0172e0d`). *Inference:* read the harness against its examples before the first agent ticket, which is what ticket #3 does.
2. **Who decided a record took three tries.** Lock, "Propose again" and the reviewed flag were built, then replaced within two weeks by one per-record state ([ADR 0030][a30], [ADR 0031][a31], [ADR 0032][a32]). *Inference:* decide early how Praxis marks what the Agent did versus what the person did, and avoid a separate "reviewed" state.
3. **A per-call input should have been stored.** "Use it up" was an argument to one call; it "was lost on reload, on another device and in the morning job's Proposal" and was moved onto the record ([ADR 0030][a30]). *Inference:* anything a scheduled or unprompted Agent run must honour has to be stored state, not a call argument or a chat remark.
4. **A glossary term had to be renamed after it shipped.** "Suggestion" came to mean two things and one was renamed "pencilled" across code, tests, agent text and spec ([ADR 0030][a30] "Renamed"; commits `4eb13a8`, `c143b92`). *Inference:* settle the words for "something the Agent proposed" before code, since the predecessor's language is being kept by default.
5. **The agent log came late.** It was added on 2026-11-01, after the text agent and voice shipped, because nothing recorded what the deployed agent heard and did ([ADR 0029][a29]). *Inference:* build agent observability with the agent, with its privacy rule.
6. **The first agent model was too weak.** The agent moved from Haiku to Sonnet when Haiku "asked whether to do what it was asked instead of doing it", at about 20 times the price per token ([SPEC §2][spec]). mise has no in-app cap on text spend and relies on the provider's console limit ([SPEC §4.7][spec]). *Inference:* the map's Sonnet lean matches where mise ended up; cost limits ("Model access" on the map) are the open half.
7. **Offline data lives in `localStorage` because of the transport.** Tools go over a WebSocket a service worker cannot see, so the page keeps its own copies ([ADR 0018][a18]). That is sound for two weeks of meals; it reads as a workaround, and it would not scale to a Journal. *Inference:* decide what must work offline before fixing the transport and the local store.
8. **The Design System was made the source, then demoted.** Tokens were added in code and the artifact fell behind ([ADR 0033][a33]). Nothing in CI can check the two agree. *Inference:* code as the source from day one.
9. **CI held a long-lived Pulumi token, and the deploy log showed a value it should not have.** Both were fixed in November ([ADR 0005][a05] "Considered Options"; [coding standards, "A value the deploy log must not show is a secret"][cs]). *Inference:* start with OIDC and with the secrets-versus-variables rule.
10. **Guards were added after silent gaps.** A stricter parser made every read throw (mise #23), so backups are now replayed before deploy; a test folder was never run (#118); a screen's write went untested (#83) ([coding standards][cs], [scripts][scripts]). *Inference:* have these checks from the first deploy.
11. **`reserveTokens` is stretched to cap the context window**, because the harness has no "maximum context" setting; the note calls it repurposing and leaves a cleaner way as an open question ([Pi Durable note, §4 and §5][pi]). A workaround to revisit with ticket #3.
12. **Patches and overrides against upstream.** A Sentry patch was carried until upstream fixed it, and dependency overrides are recorded as "temporary tested exceptions" ([security review][sec]; commits `f3b4b12`, `222653b`). The review also records that the MCP SDK brought Express, body-parser and Hono into the lockfile with open advisories until a harness upgrade dropped it. *Inference:* Praxis will depend on MCP on purpose, so what its MCP dependency pulls in is worth a look in ticket #4.
13. **One shared, never-reset conversation needed repeated repair.** Failed turns piled up and were answered together; the agent trusted earlier turns over the tools; a held confirmation that had gone was still claimed (commits `87cdc0d`, `77976d2`, `c5c52b4`, `92b27a4`). Per-caller conversations were deferred ([SPEC §4.7][spec]). *Inference:* the fixes share one rule, "the tools are the truth, the conversation is not", and each turn is told the current state. Whether Praxis wants one endless conversation at all is ticket #2.
14. **The spec drifted from what was built.** ADRs supersede SPEC lines (the CI row, the LLM normaliser) and SPEC is still labelled "draft spec, v0.1" ([ADR 0003][a03], [ADR 0023][a23]). *Inference:* minor, but Praxis's map ends in a `SPEC.md`; saying which document wins when they disagree would help.
15. **Backup limits accepted for now.** Blobs are referenced and not copied, restore needs the same schema version, the calendar token sits in the backup in the clear, and monthly backups are kept forever ([ADR 0006][a06], [ADR 0019][a19]). *Inference:* acceptable for a meal plan; for the only copy of a personal journal, each is worth deciding rather than inheriting.

## Carry-overs likely to deserve their own decision on the Praxis map

In rough order of how much they would change the spec:

1. **Held calls for three kinds of caller** (2.1): what waits for a tap, and what happens when the caller is an MCP client or an unprompted Agent run with no screen. Feeds #9, #11, #4.
2. **A non-interactive caller that can write** (9): the identity, scope and revocation of an MCP client, reversing mise's "a token is never a Caller". Feeds #4, #11.
3. **Agent-made versus person-made records** (2.4): one provenance rule, shown in the UI, with no review state. Feeds #2, #9.
4. **Is conversation data?** (5, 10): decides backup contents, the agent log's privacy rule and compaction policy. Feeds #2 and the Backup fog.
5. **Offline scope** (8): at least offline capture of a new Entry, decided before transport and local storage. The Offline fog.
6. **Consequences in tool results** (3): structured, complete without a change notice, saying when nothing changed. Feeds #11, #6.
7. **Backup and export** (5): dump format, human-readable export, restore across versions, blobs. The Backup fog.
8. **Agent observability from the first agent ticket** (10), with a totals-only default.
9. **Testing strategy as a founding ADR** (4): adopted nearly as is, plus MCP seam tests.
10. **Notification content per Context** (6). Feeds #7, #8.

## Limits of this research

- mise's ADRs, spec and standards were read in full; the code was read only where a document pointed to it (the tool registry, confirmations, the check scripts, the CI workflow). Claims about behaviour rest on the documents, not on running mise.
- mise's issues and pull requests were not read; issue numbers appear only as the documents cite them.
- Nothing here was checked against Praxis's predecessor; the map's Notes are the only description of Praxis used.
- Sections 12 and 9 overlap tickets #3 and #4, which own those questions.

[spec]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/SPEC.md
[gloss]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/GLOSSARY.md
[cs]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/CODING_STANDARDS.md
[agents]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/AGENTS.md
[readme]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/README.md
[pi]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/research/pi-durable-examples.md
[voice]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/research/gpt-live-1-backend-agent.md
[sec]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/security/2026-11-06-dependencies.md
[canvas]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/agents/design-canvas.md
[tools]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/packages/domain/src/tools.ts
[conf]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/packages/domain/src/confirmations.ts
[weeks]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/packages/domain/src/weeks.ts
[scripts]: https://github.com/nuntz/mise/tree/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/scripts
[ci]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/.github/workflows/ci.yml
[pkg]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/package.json
[a02]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0002-single-tool-entry-point.md
[a03]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0003-two-test-runners.md
[a04]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0004-workspace-layout.md
[a05]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0005-deployment-config-outside-repo.md
[a06]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0006-backup-is-a-table-dump.md
[a07]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0007-worker-verifies-access-identity.md
[a08]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0008-hard-constraints-name-an-allergen.md
[a10]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0010-recipe-photos-over-http.md
[a11]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0011-imports-staged-over-http.md
[a12]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0012-conflicts-block-what-a-change-brings.md
[a13]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0013-a-proposal-is-fixed-by-its-seed.md
[a14]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0014-cooking-belongs-to-the-slot.md
[a15]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0015-a-grocery-list-is-built-from-a-plan-revision.md
[a18]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0018-offline-grocery-changes-are-queued-on-the-device.md
[a19]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0019-the-calendar-feed-is-read-with-a-token-over-rpc.md
[a20]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0020-the-design-system-is-css-custom-properties-with-a-kitchen-theme.md
[a21]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0021-a-new-week-start-applies-from-the-next-week.md
[a22]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0022-a-recipes-course-is-worked-out-at-import-and-corrected-by-hand.md
[a23]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0023-an-llm-suggests-items-and-a-person-accepts-them.md
[a24]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0024-the-agent-cannot-confirm-for-a-person.md
[a25]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0025-notifications-are-pushed-by-the-household-to-devices-not-members.md
[a26]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0026-a-bought-dish-is-a-recipe-with-one-ingredient.md
[a27]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0027-a-kitchen-display-reads-the-day-sheet-with-its-own-bearer-token.md
[a28]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0028-voice-is-answered-by-the-household-through-client-delegation.md
[a29]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0029-the-agent-reads-the-deployed-conversation-with-a-service-token.md
[a30]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0030-a-dinner-is-a-suggestion-or-the-households-own.md
[a31]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0031-a-week-has-no-reviewed-state.md
[a32]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0032-a-pencilled-dinner-carries-a-chip-and-says-why-in-its-sheet.md
[a33]: https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/adr/0033-tokens-css-is-the-source-the-design-system-is-synced-from-it.md

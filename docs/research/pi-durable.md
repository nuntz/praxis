# What Pi Durable gives Praxis on Cloudflare

Research for issue #3. Researched 2026-11-14 against Pi 1.5.2 (`@earendil-works/pi-durable`, `pi-ai`, `pi-schema`, all published 2026-11-10) and Cloudflare's `agents` 0.33.0.

## Answer in short

Pi Durable is a durable agent loop, not a Cloudflare product. It keeps conversations, model turns, tool calls and app-defined documents in one SQLite database, commits each step before showing it, and resumes interrupted work when the storage is reopened. On Cloudflare that database is the SQLite storage of one Durable Object, so **one Durable Object holds one Pi "Session" with any number of conversations**, and Praxis's own tables can sit in the same database.

Pi does not wake itself, speak any client protocol, or offer recurring schedules. The Durable Object's single alarm must be driven by the host (Cloudflare's `PiHarness` in the `agents` package does this), streaming to a browser is the app's own glue over Pi's `watch()`, and "run every morning" is something Praxis builds from an alarm or scheduler that submits input to a conversation. The package is marked experimental and its stored format has already broken rollback once between minors.

## Sources

Every claim below cites one of these. Line numbers are for the pinned revision.

| Key | Source |
|---|---|
| **R** | pi-durable README at tag `v1.5.2`: <https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/durable/README.md>. The README in the npm tarball of 1.5.2 is byte-identical (checked by SHA-256). |
| **CL** | pi-durable changelog, same tag: <https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/durable/CHANGELOG.md> |
| **SRC** | pi-durable source, same tag: <https://github.com/earendil-works/pi/tree/b4afdddf44e059c67ccf5097e5317d913521b470/packages/durable/src>. I read the compiled `dist/` of the npm package 1.5.2, not the TypeScript; file names below are the matching `src/` paths. |
| **CH** | Chord's Durable Object SQLite adapter, same tag: <https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/chord/src/sqlite/cloudflare.ts> (read as compiled `dist/`). |
| **AI** | pi-ai README, same tag: <https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/ai/README.md> |
| **SC** | pi-schema README, same tag: <https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/schema/README.md> |
| **CF** | Cloudflare's Pi harness guide at tag `agents@0.33.0`: <https://github.com/cloudflare/agents/blob/5684e278e44abfb592a6ae6ef3e2f5250feacd8c/docs/agents/harnesses/pi.md> |
| **CFN** | Cloudflare's working notes on hosting pi-durable in a Durable Object, same tag: <https://github.com/cloudflare/agents/blob/5684e278e44abfb592a6ae6ef3e2f5250feacd8c/examples/next/harnesses/pi/NOTES.md> |
| **CFT** | `PiHarness` source, same tag: <https://github.com/cloudflare/agents/tree/5684e278e44abfb592a6ae6ef3e2f5250feacd8c/packages/agents/src/harness/pi> (read as the published type declarations and compiled JS of `agents` 0.33.0). |
| **DOL** | Cloudflare Durable Objects limits: <https://developers.cloudflare.com/durable-objects/platform/limits/> (read 2026-11-14) |
| **DOA** | Cloudflare Durable Objects alarms API: <https://developers.cloudflare.com/durable-objects/api/alarms/> (read 2026-11-14) |
| **M** | Mise, a working Worker on Pi 1.5.2, at commit `fcd3d7d`: <https://github.com/nuntz/mise/tree/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e>. Its research note is [`docs/research/pi-durable-examples.md`](https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/docs/research/pi-durable-examples.md). |

Packages: [`@earendil-works/pi-durable`](https://www.npmjs.com/package/@earendil-works/pi-durable), [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai), [`@earendil-works/pi-schema`](https://www.npmjs.com/package/@earendil-works/pi-schema). All MIT, all from the public monorepo `earendil-works/pi`. pi-durable also needs `@earendil-works/chord` (R L43).

## 1. The three packages

- **pi-durable**: "A durable agent harness. Conversations, model turns, tool calls, and your own state are committed to storage before anything is shown" (R L5). Headed "**Experimental.** The API changes without notice between releases" (R L3).
- **pi-ai**: the model layer. One API over many providers, with token and cost tracking (AI L3). Providers include Anthropic, OpenAI, Google, Cloudflare Workers AI, Cloudflare AI Gateway, OpenRouter and any OpenAI-compatible endpoint (AI L62–L98). Its chat catalog lists only models that support tool calling (AI L5).
- **pi-schema**: JSON Schema builders (`obj`, `str`, `num`, …) and a validator that uses no `eval`, so it runs in Workers; drafts 2020-12 and 7 (SC L3–L12). Tool parameters are written with it, and pi-durable validates tool arguments through it (R L260, L921).

## 2. How state and conversations persist

**The model** (R L94–L104):

- A **Harness** is one open storage. All changes go through one line of atomic commits, "and nothing is shown before its commit is stored".
- A **Conversation** is a transcript of immutable **entries**: `pi.user`, `pi.assistant`, `pi.tool-result`, `pi.system`, `pi.reset`, `pi.compaction`, or the app's own kinds. The root conversation is created on first use; more can be created or forked (R L716–L723).
- A **Document** is typed JSON stored beside the transcript and changed in the same commits. Built-in ones per conversation: `pi.agent` (model, tools, instructions), `pi.provider`, `pi.live` (the running generation and tools), `pi.inbox` (queued input), `pi.usage` (tokens and cost).
- A **Task** is a durable state machine that checkpoints at every step. Each model request (`pi.generation`) and each tool call (`pi.tool`) is a task.
- A **Submission** is input handed to a conversation, which a caller can wait for.

**What survives a crash or eviction:**

- Work cut off stays pending and continues when the storage is reopened and `resume()` is called (R L127).
- A model request the process died during counts as a failed attempt and is retried under `settings.retry` (R L5, L216).
- `requestId` makes a submission idempotent: resubmitting after a restart returns the first submission (R L129–L136).
- Partial answers are the exception to "stored before shown". They are shown at once and stored at most about 1 s later, so "a crash loses at most about that window of an answer or of tool output" (R L527).

**What the model sees versus what is kept.** The model sees entries from the newest reset or compaction summary onward; older entries stay in storage (R L96, L595, L608). Compaction runs on its own past token thresholds, can be tuned per model or per conversation, and can be triggered by hand (R L606–L657). The defaults are fixed token counts measured back from the model's context window, which Mise found would never fire on a 1M-token model without an override (M research note, §1 item 1).

**The app's own state has two possible homes:**

1. **Pi documents** (`defineDoc`): typed JSON, scoped to a conversation, committed atomically with entries and tasks, watchable by clients (R L816–L853).
2. **Plain tables in the same Durable Object database.** Pi's tables can take a prefix (`pi_`) so they do not collide with the host's (R L877–L881). Mise does this: its domain data is in its own SQL tables and the agent reaches it only through tools (M [`household.ts` L182–L222](https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/apps/worker/src/household.ts#L182-L222)).

The README warns about option 2: to share the database, host queries should go through Pi's database adapter, because "direct storage calls bypass the queue and may be rolled back with a Pi transaction" (R L883–L892). The adapter wraps each Pi commit in `ctx.storage.transaction()` behind a queue (CH). Mise nonetheless queries `ctx.storage.sql` directly beside Pi and reads Pi's `pi_entries` table with raw SQL (M [`agentLog.ts`](https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/apps/worker/src/agentLog.ts)). I did not test how a direct host write interleaves with an open Pi transaction.

**Nothing is ever deleted by Pi.** Entries are immutable, reset and compaction only hide them from the model, and Cloudflare's notes list "Session deletion. pi has no conversation delete" as missing (CFN, "Not done yet"). I found no delete or prune call in the 1.5.2 type declarations.

## 3. How it maps onto Durable Objects

- **Storage:** `openDurableObjectSqliteStorage(ctx.storage)` uses the SQLite storage of one SQLite-backed Durable Object; "commits are its storage transactions" (R L871). The Durable Object class must be declared as a SQLite class in the Wrangler migration (CF, "Create the harness").
- **One writer:** "One process writes a storage at a time; there is no cross-process locking" (R L894). A Durable Object is already single-threaded per id, so one object = one Pi Session fits. The consequence is that all conversations of a deployment that share state live in one object.
- **Waking:** Pi's scheduler lives in memory, and an evicted object has no memory. With the `onWake` option Pi arms no timer of its own; it tells the host when it next needs to run, and the host keeps the object's alarm armed and calls `harness.resume()` when it fires. The README gives the full Durable Object class for this, including a 60 s heartbeat alarm while work runs (R L166–L212).
- **`PiHarness`** (`agents/harness/pi`, Cloudflare's package) packages that pattern: it opens Pi's storage under the `pi_` prefix, runs one wake job driven by `pi.wake()`, heartbeats every 30 s while Pi works, and retries a failed wake with backoff up to 10 minutes (CF, "How recovery works"; CFN, "One admission, one wake job"). Cloudflare states its scope plainly: it "supplies the storage and the wake. It does not provide a chat protocol or user interface" (CF, intro).
- **Sessions:** `PiHarness` calls a Pi conversation a session; the root is `"1"`; `sessions.create()`, `fork()` and `list()` manage more (CFT, `harness.ts`).
- **In practice:** Mise runs one Durable Object for the whole household, with `PiHarness` installed on an Agents SDK `Agent` class and one shared root conversation (M [`household.ts` L170–L231](https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/apps/worker/src/household.ts#L170-L231), [`wrangler.jsonc`](https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/apps/worker/wrangler.jsonc)).

## 4. How tools are declared and called

**Declaration.** A tool is `defineTool({ name, description, parameters, execute })`, where `parameters` is JSON Schema (pi-schema builders give typed `args`). Tools are grouped into a named **extension** with prompt sections and hooks, and installed in a **registry** the process owns (R L224–L243, L260–L275). Nothing in the registry is stored: conversations store tool and extension names, and rebind to whatever code is installed after a restart or deploy (R L243, L402).

**Execution** (R L277 unless noted):

- Each call is its own durable task, and its intent is committed before `execute()` runs.
- Arguments are coerced and validated against the schema first (R L260).
- If the process dies mid-call, the tool reruns only when declared `replay: "safe"`. Otherwise the model gets an `interrupted` error result. So a write tool with outside effects needs its own idempotency or stays unsafe.
- A throw becomes an error result for the model.
- A round's calls run in parallel by default; `toolExecution: "sequential"` orders them (R L420). Mise sets sequential because order mattered for its writes (M `household.ts` L210–L212), and Cloudflare saw a `git log` run before its `clone` finished under the default (CFN, "Workspace tools").
- A result has three channels: `output` for the model, `details` for UIs, `structuredOutput` for programs (R L279).

**Control around tools:**

- `beforeTool` hooks can block a call or rewrite its arguments; `afterTool` can replace the result (R L675–L676).
- `maxTurns` caps the tool rounds of one run (R L404).
- `callers` and `modelTools` restrict who may call a tool; `deferred: true` hides a tool until the model searches for it (R L335–L349).
- A tool can call other tools (`api.executeTool`) and create child tasks or subagent conversations (R L307–L331, L725–L770).

**Missing:** there is no approval or permission primitive. "pi-durable has no approval or permission primitive yet. A tool could park on a pi document and a hook, but that is ours to invent" (CFN, "The harness interface"). Mise built its own confirmation flow in app tables, returning a pending confirmation in the tool result's `details` (M [`agent.ts` L466–L500](https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/apps/worker/src/agent.ts#L466-L500)).

**One schema limit worth knowing:** as of Pi 1.4.0 the Anthropic adapter sent only the root `properties` and `required` of a tool schema, so a root-level `oneOf`/`anyOf` was lost; Mise still flattens root unions for that reason on 1.5.2 (M research note, §2.3 and "Pi 1.5.2"). I did not re-read the 1.5.2 adapter.

## 5. Scheduled and self-initiated runs

What Pi provides:

- **Durable sleep.** A task of the app's own (`defineTask`) can `runtime.sleepUntil(time, checkpoint)`. The sleep is stored, holds no invocation, survives restarts, and resumes at the next phase when due. The README's own example is a reminder task (R L140–L162).
- **Submitting without a user.** Any host code, task or tool can submit input to a conversation, which starts a run exactly as a typed message does. A task does it inside its own commit with `handle.submit(tx, draft)` (R L544–L556, L713). The input can carry its own entry kind so the transcript records that a schedule or webhook sent it, not the user; Cloudflare's guide names "a prompt from a scheduled job, a webhook payload or the outcome of an approval" (CF, "Label input the user did not type"; R L577–L591).
- **Continue.** `submit({ type: "continue" })` restarts a failed run with no new message (R L565–L575).
- **Work after a run.** An `afterRun` hook starts durable tasks once a run has answered, and those can post a follow-up that starts another run (R L682–L714).
- **Background tasks and subagents** that outlive the run that started them and report back as follow-up input (R L765–L770).

What Pi does not provide:

- **No cron or recurring schedule.** I found none in the README or the 1.5.2 type declarations. A recurring job is a task that sleeps again after each run, or a host scheduler.
- **No wake of its own on Cloudflare.** A sleep only fires if the host's alarm is armed for it (section 3). "An early alarm is harmless, a missing one strands the work" (R L195–L196).
- **No turn budget across automatic runs.** Each run, continue and follow-up starts its turn count at zero, so "a host or tool that continues automatically gets a fresh budget each time and must bound that itself" (R L404, L713).

Platform facts behind this:

- A Durable Object has one alarm; setting it replaces the previous one (DOA). `PiHarness` and the Agents SDK scheduler share it through the SDK's Lifecycle, so host code should not set the raw alarm itself. That last clause is my inference from CF ("`Lifecycle.install(this)` gives the object its startup, alarms and job queue"), not a quoted rule.
- Alarms run at least once and are retried with exponential backoff, up to 6 retries (DOA).
- An alarm handler has a 15-minute wall-time limit. `PiHarness` waits at most 10 minutes per alarm and then hands over to a fresh one, but "a single model request that streams for more than 15 minutes is still at the platform's mercy" (CFN, "Alarm wall time"; DOL).

What Mise does: its timed work (nightly export, nightly sync, morning push notifications) uses the Agents SDK's `schedule()` on the same Durable Object, and those callbacks run plain code or direct model calls. **None of them submits a turn to the Pi conversation**, so Mise is not a working example of the agent acting unprompted through Pi (M [`household.ts` L1424–L1445](https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/apps/worker/src/household.ts#L1424-L1445), L1083–L1108).

## 6. Streaming to a client

- **No wire protocol.** Pi gives an in-process watch; getting it to a browser over WebSocket, SSE or RPC is the host's work (CF, intro; CFN, "The harness interface").
- **`conversation.watch()`** returns the conversation's view now, then calls back on each commit that touches it with the new value and the list of operations that changed it, which a server can forward for a client to apply (R L477–L495).
- **What the view holds:** a window of the newest transcript entries (50 by default, trimmed back to 50 when it passes 100) plus the conversation's documents. `pi.live` carries the partial answer being streamed, running tool calls with their output, retries, compactions, and why the last run failed (R L486–L497).
- **Rate:** partial answers and tool output are committed at most every 100 ms by default, and watches see each at once (R L527).
- **Late join and reconnect:** a client starts from the current view; "nothing is replayed". There is no event log and no cursor to replay from (R L525; CFN, "Events have no cursor"). `ConversationTranscript` is a client-side helper that merges views, pages older entries and fills gaps after a reconnect (R L499–L519).
- **Hibernation:** watches live in memory. After the object hibernates or is evicted, the host must re-attach a watch for every open socket and resend the whole view (CFN, "Watches are per socket and in memory").
- **Backpressure:** commits that land while a callback runs are folded into the next call; past 10,000 pending operations the client gets the whole view again (R L525).
- **Working examples:** Cloudflare's Pi example sends `session.watch()` over WebSockets and projects it into a browser transcript (CF, "Run the example"). Mise does not stream: it submits, waits for the final answer, and tells connected clients to reload over the Agents SDK WebSocket (M [`household.ts` L351–L352](https://github.com/nuntz/mise/blob/fcd3d7dff5ea392889ff17d4708430dcb0a70d0e/apps/worker/src/household.ts#L351-L352), L1479–L1482).

## 7. Limits and rough edges

**Stability**

- Experimental, API "changes without notice between releases" (R L3). Releases so far: 1.4.0 on 2026-10-21, 1.5.0 on 2026-11-02, 1.5.2 on 2026-11-10 (npm registry).
- 1.5.0 had a long list of breaking changes: tool schema types, the storage `commit()` contract, the whole watch API (CL, "1.5.0").
- **No rollback across minors.** "After a conversation runs on Pi 1.5, rolling your Worker back to an `agents` version on Pi 1.4 leaves that conversation unreadable. Roll forward to fix a bad deploy instead" (CF, "Install the Pi packages"). Cloudflare's `agents` supports one Pi minor at a time, so the two packages must be upgraded together.

**Failure behaviour**

- A storage error ends the Harness: every pending wait rejects and the host must reopen it (R L927). `PiHarness` does the reopening (CF, "How recovery works").
- A task cut off by crashes or evictions 5 times in a row (`restartLimit`) is ended, not retried forever (R L216).
- A failed run leaves the inputs queued behind it waiting until the next input, unless `afterFailedRun` says otherwise (R L220).
- `abort()` resolves only when the conversation is idle, so a tool that ignores its abort signal hangs it (CFN, "Abort needs tools that honor their signal").
- A deploy kills in-flight work after 30 s; recovery is the same path as a crash (CFN, "Graceful eviction waits for the wake").

**Cloudflare platform limits that bound it** (DOL)

- 10 GB of SQLite storage per Durable Object on the paid plan; the same page's FAQ says 1 GB on the free plan.
- 8 MB maximum for a row, string or BLOB, which bounds a single transcript entry or document.
- 30 s of CPU per invocation by default, configurable up to 5 minutes; 15 minutes of wall time for an alarm handler.
- The Photon image processor decodes on the calling thread and its WebAssembly memory does not shrink; the README says to leave it out on Workers unless images stay small (R L258).

**Smaller things**

- System prompt changes are stored as positional transcript entries, and only differences are re-sent. A prompt section that changes on every request, such as the current time, defeats provider prompt caching (R L378). On a first turn the system entry follows the user's input (CFN, "Surprises in pi").
- The model a conversation runs on is stored with the conversation. Changing a default in code does not move existing conversations; the host must call `configure()` or `setModel` (M research note, §1 item 2; M `household.ts` L263–L273).
- The built-in compaction prompt is a coding-agent checkpoint format (M research note, §2.7). A `beforeCompact` hook can supply a different summary (R L653).
- The built-in tools (`read`, `write`, `edit`, `bash`) and the default environment target a filesystem and processes (R L247, L430–L444). A task manager would bring only its own tools, as Mise does.
- Chord pulls in `esbuild` (about 12 MB installed) though a Worker never reaches it, and pi-ai depends on the `openai` SDK (CFN, "Surprises in pi").
- Telemetry spans carry ids and control data, never message content, but failed-phase diagnostics "can contain caller content" (R L82–L86).
- Token and cost totals are kept per conversation in `pi.usage` and for the whole Session via `harness.usage()` (R L855–L861).

## What I could not verify

- **Nothing was run.** Every behaviour above is from documentation, published source and Mise's code as read, not from a test against a live Durable Object.
- **Compiled code, not TypeScript.** For pi-durable, Chord and `agents` I read the compiled npm packages and their type declarations. The README was checked identical to the tag; the source files were not diffed against the tag.
- **CFN is partly historical.** Cloudflare's notes were written across several Pi versions. Some items are overtaken (it says in one table that pi-durable has no compaction, and that the table prefix is a SQL rewrite; 1.5.2 has both compaction and a native `prefix` option, R L606, L877). The gaps I rely on from it (no approval primitive, no event cursor, no conversation delete, watches in memory) agree with what I found in the 1.5.2 README and type declarations, but absence is harder to prove than presence.
- **The normative spec** (`packages/durable/docs/spec.md`) was not read; the README was treated as its summary.
- **Host writes beside Pi transactions.** Whether direct `ctx.storage.sql` writes are safe next to Pi's commits in practice (section 2) is untested; the README advises against it and Mise does it.
- **Alarm sharing** between `PiHarness` and other Agents SDK schedules is inferred from Mise doing both in one object, not from reading the Lifecycle implementation.
- **The Anthropic root-schema limit** (section 4) was verified by Mise against Pi 1.4.0 and is still worked around on 1.5.2; I did not re-read the 1.5.2 adapter.
- **Cloudflare limits** are as the two documentation pages read on 2026-11-14; the 10 GB / 1 GB storage figures appear in different places on the same page.
- **Cost** of running this on Cloudflare (Durable Object duration billing while a run or heartbeat keeps the object awake) was not researched.

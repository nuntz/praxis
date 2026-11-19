# Pi Durable in Praxis

How the Agent's runtime (ADR 0024) is wired into a Context's object, and what it does that its README does not make plain. Read this before changing `apps/worker/src/agent.ts` or `apps/worker/test/model-fake.ts`.

Pinned at `@earendil-works/pi-durable`, `pi-ai` and `chord` **1.5.2**, which move together. The API is marked experimental and changes between releases: check the installed types, under `node_modules/.bun/@earendil-works+pi-durable@*/node_modules/@earendil-works/pi-durable/dist`, before trusting this page or the README.

## The shape

- **A plain Durable Object, no wrapper.** `ContextAgent` (`agent.ts`) opens the Harness itself with `openDurableObjectSqliteStorage(ctx.storage, { prefix: "pi_" })`, lazily on the first Conversation tool or alarm, since most requests never need it. Cloudflare's `agents` package and its `PiHarness` are not used.
- **One alarm for both.** The runtime gets `onWake`, and the Context's object folds what it says into the alarm it keeps for its own work (`keepAlarm` in `context-object.ts`): a heartbeat while the runtime is `active`, its `at` when it sleeps, and the daily pruning. The alarm calls `resume()`. Arm before anything that can start work (`send`), since a missing alarm strands a Run.
- **Praxis's own writes beside the runtime's.** The runtime commits through `ctx.storage.transaction` with async callbacks that await only in-object SQL, so Praxis's `transactionSync` writes never land inside one. Keep it that way: nothing in a runtime commit may await a model, a fetch or another object.
- **One Conversation:** the runtime's root. A person's Message is placed with `entry: { kind: "praxis.message", data }` and the data is what the screen shows. The model is shown `content`, which carries the Run's bearings before the words.
- **A Run's record and the runtime:** `startRun` keeps the record before the Run starts, keyed by the runtime's submission id. `#settle` waits on the submission and closes the record. On open, every record not ended is waited on again, so a restart cannot leave one open.
- **Tools:** every Context tool in the Agent's column, `replay: "safe"`, each write given the key `run:<callId>`, so a call run again after a crash returns its first result. The schema the model sees drops `key`.

## Gotchas

- **A Run's identity is `live.run.inputs[0]`**, the submission it answers. `live.run.taskId` is the generation task, which is handed on every model round, so it changes mid-Run.
- **The runtime calls its transcript records entries.** They are never Entries: Praxis code names them records, kinds or Messages (see Domain words in `CODING_STANDARDS.md`).
- **A scripted model's request carries the tools in its system messages**, not in `context.tools`: `normalizeContext()` moves them there. A fake that branches on what it is offered reads the person's words instead (`lastWords`).
- **The faux provider streams in chunks of random size** unless `tokenSize` is fixed. `scriptModel(..., { wordsPerSecond })` fixes it at one token, so a test of the answer as it is written sees several partials every run.
- **Partials are deferred commits**, at most every 100 ms. `observeDoc(LiveDoc, …)` sees them at once; storage gets them later. Derive nothing durable from a partial.
- **A model the runtime refuses to call ends the Run `unanswered`** with a `runFailure` reason, and the submission's `reason` and `detail` (the provider's error text for `model_error`) say why. `runFailure()` in `model.ts` reads them as the key refused or the model not reached. Praxis's `afterFailedRun: "continue"` answers the Messages queued behind it in their turn: `withdraw` would settle them without ever placing them, and their words would leave the Conversation.
- **The runtime retries, not the provider's client.** `settings.retry` takes the model's `retry` (seconds for the real one, a millisecond for the scripted one), and `stream.maxRetries: 0` stops the SDK asking again inside each attempt. A refused key is never retried: pi-ai's `isRetryableAssistantError` sees no transient error in it. Each failed attempt is kept in the transcript as an assistant record with `stopReason: "error"`, which the provider adapters skip when the model is next asked.
- **Trying a failed Run again is a `continue` submission**, which answers the transcript as it stands, so it can only answer the newest Message. It places no record of its own, so its Run record keeps `from_record`, the first runtime record that may be its own, and its spend is counted from there.

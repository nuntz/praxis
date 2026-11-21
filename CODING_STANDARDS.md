# Coding standards

Read at review. The mechanical rules are checks already: Biome, the guards in `lint/`, and the oracle in `apps/worker/test/oracle.ts`. These are the judgement calls no check can make.

## Domain words

- Name code with the terms of [`GLOSSARY.md`](GLOSSARY.md), in the sense it gives them. A name made of a term of more than one word that it lists to avoid fails `lint/glossary.test.ts`; a single word it avoids, such as "turn" or "session", is the reviewer's to catch.
- A word the glossary gives to a state (open, closed, actionable, Finished, Dropped, Deferred, Overdue, Waiting, Delegated) names that state of a Task or Project only. Other things take their own word: a Context not retired is *reachable* or *shown*.
- A library's own words are renamed where Praxis code holds them, when they collide with a glossary term: the Agent runtime's entries are its records, never Entries, and its turns and sessions are not Runs.
- A record is an Entry, Task, Project or Person. Whatever else a write returns, such as a Context or its settings, is named as what it is in its type and doc comment, even in a field called `record`.

## Registries

- A second set of tools reuses the first's machinery (parsing input, write keys, the log line, Effects) through one shared function, so a rule changed once holds for both.

## Outside services

- A cache in front of an outside service has a maximum age, and its limit on how often it asks holds after a failed ask as after a good one. Anything trusted from outside, such as a key, stops being trusted when that age passes.
- A refusal says whether the person can mend it (sign in again, change what they sent) or can only wait. One that only waiting mends is answered as unavailable, never as their doing.
- A faked adapter takes the Access key set's shape: the interface in `src/`, the fake in `test/<name>-fake.ts`, and one `contract()` suite run against the fake and, given its environment variables through Vitest's `provide`, against the real service. A service reached by a binding rather than a key, as the meaning index is, runs its contract against the real service under a Vitest configuration of its own that binds it remotely (`apps/worker/vitest.meaning.config.ts`), since a binding in `wrangler.jsonc` reaches the account in every test. A service the Device reaches itself, as the voice provider is over WebRTC, has its fake in the browser too (`e2e/voice-fake.ts`) and runs its contract in the browser suite, against the real service when given its key by hand (`e2e/voice-contract.spec.ts`). The adapter is passed in, as `praxis(accessOf)` takes it, since the Vitest plugin cannot intercept outbound requests.
- A fake's own fault, such as running out of script, fails the test as a fault, never as the service's error it stands in for. It throws `harnessFault()` (`apps/worker/test/harness-faults.ts`), so one thrown where no test awaits it, in an alarm, fails the run too.
- A fake answers at once, unless the test it is given for asserts what the screen shows while it waits, or holds it to change something meanwhile: a pace or delay set for every test is time each one spends under load, as the journeys' scripted model writing at 20 words a second put two seconds on every Run (#88).

## The Agent's runtime

- A hook into the Agent's runtime answers a failure with a decision it returns, such as `{ decline: true }`, and never throws: a throw is logged and skipped, and the runtime's own default runs in its place, as its own summarizer would for compaction (`docs/pi-durable.md`).

## Browser journeys

- A journey that acts outside the page on what a tap changed waits for that tool's answer (`page.waitForResponse`), or for something on the screen only the answer brings. A control the browser changes at the tap, such as a checkbox, proves nothing about the server.
- A journey holds whatever the other journeys leave in the shared Deployment. It reaches a control by its role and name, or by a keyboard path that passes through no column other journeys fill, and matches text a count can grow with a pattern that allows it. A journey that needs an exact count or order makes a Context of its own, as `e2e/attention.spec.ts` does. A setting the whole Deployment shares, such as the spend cap, it moves only where no other journey notices, and checks what the screen shows against what its own read answered, never against what it wrote, since its own repeats write it too. What the Deployment holds one of and every journey would change, as the one Call going, a journey holds for the whole of it, behind a lock across the workers, as `holdTheCall()` in `e2e/one-call.ts` does.
- A journey reads an Entry's words as kept from its editor, and what the Journal shows by role (a heading, a link, a list item), since the screen renders them (section 8.4): rendered text set against the words typed tests the renderer's spacing, as three journeys of #53 found. A journey that opens the editor finds the Entry by its id first, as `e2e/versions.spec.ts` does, since the editor hides the words it was found by.
- A journey stands in for something outside Praxis where the outside begins: `page.route` for a host the screen reaches, as `e2e/journal.spec.ts` does for an image's host, and a script loaded before the page for a browser API, as `e2e/voice-fake.ts` does for WebRTC and the microphone. The screen's code and the Worker's policy stay as deployed. The journey asserts what reached the stand-in, as the image host asked nothing before the tap, or the voice provider sent only the Agent's answer and the end of the Call. A route makes a host answer; it never makes the policy pass, which the browser still applies. Nor does a route reach the browser's own fetch of the service worker script, so a journey that needs a second release has the Worker serve it.
- A journey reads a value off the page (a box, a count, an order) once the screen has settled on what it measures: after something on the screen only the last read brings, as the Journal's composer comes with the time zone. A value it cannot read fails the journey as missing, never as a stand-in such as 0. `lint/read-not-stood-in.grit` catches a stand-in given where the value is read; one given later, to a variable that held it, is the reviewer's.

## Reads and changes

- What a list shows comes from its read and from the changes it learns of meanwhile, its own writes or the live channel's, in either order. A change that lands while the read is out outlives the read's answer: the list places a record from either by its id, so the record shows once, or it drops an answer a later read or change overtook and reads again, as `latestRead()` in `apps/pwa/src/latest-read.ts` does for every read the screen makes. A column reads once `live.ready` settles, so a change made meanwhile is read or brought.
- An answer shows only while the screen still asks its question. A question the person stops asking, by Escape or by leaving the field, sends no later read, so `latestRead()` still holds its answer current: the screen drops it, as the Journal's composer drops a picker's answer once its query is no longer the one shown.
- A write's own answer is overtaken the same way: the live channel may already have brought the record, newer. The screen places the answer only where nothing newer is shown, as `placeAnswered` in `apps/pwa/src/Conversation.tsx` does.
- A handler reads what it needs from the store before its first `await`, or all of it after its last, with no `await` between, as `search` does once the meaning index has answered. A store item is live: after the wait it is whatever the live channel made it.
- A write after an `await` names the state it read, in an object or on the screen, since another call or the person may have changed it meanwhile: `notifyDevices` in `apps/worker/src/devices.ts` switches a Device off only while it still holds the subscription found gone, and `sendUnsent` in `apps/pwa/src/unsent.ts` keeps an Unsent write from the person's hands while it is out (`beingSent`). A test changes that state while the call it waits on is held, as `holdEmbedding()` in `apps/worker/test/meaning-fake.ts` holds an embedding while its Entry is edited: a fake that answers at once leaves no room for the change, and the guard goes untested.
- A Deployment write that has a Context's object do something it cannot undo, before writing its own rows, holds when the answer is lost: asked again, the object answers as done, as `deleteForGood` does once its storage is gone. A test has the object do it unheard first, as `deleteObjectUnheard()` in `apps/worker/test/seam.ts` does.
- An operation with an inverse, such as delete and restore, has a seam test that runs it over orderings drawn from a seeded source (`seeded()` in `packages/domain/test/seeded.ts`) and checks that undoing every step reads back what was there, as following an anchor through an edit is tested over edits drawn from one.

## Guards

- A guard against state another write leaves behind has a test that goes red with the guard switched off. `forgetConversation` in `apps/worker/src/run-rows.ts` lets go of the Run records' handles on a cleared Conversation, since the runtime opened afresh numbers its records anew. Every test passed with it switched off until the clearing test's new Run made a change, which then landed on an old Run (#69).

## The oracle

- A new check in the oracle has a seam test that reaches the state it checks through the tools, and goes red when the code it guards is switched off: the check that a gone record's words are forgotten has `trash.test.ts` and `moving.test.ts` empty the Trash and move a unit with keys whose results held the words, and they go red when the alarm stops forgetting keys. A harness test on rows no code writes shows the check can fail, not that any test reaches it: every test passed the forgetting check vacuously until those were written (#89).

## Upgrades

- A step that adds a column fills it for the rows already there, as the code that writes it would have, from what the object holds: an object made before the step is live, and a null where the new code expects a value is a behaviour no release had. `deploymentStep1` in `apps/worker/src/steps/deployment-0001.ts` fills `backed_up` from the last Backup made.

- What the screen stores on a Device for a later load, as an Unsent write, is read by every later release as it was stored: a release that changes its shape reads the earlier one too, since the screen that stored it may be gone before it is sent (section 8.8). It goes through `apps/pwa/src/stored.ts` alone (biome.json), whose reader for each key checks what it finds rather than casting it, builds every field it reads, optional or not, and keeps an Unsent write it cannot read rather than dropping it. The Offline Copy is the one thing stored that a reader may read as none, since the server holds all it holds and it is fetched again on the next contact; its schemas in `apps/pwa/src/stored-records.ts` are held to the domain's types, so a required field the domain adds is read before it typechecks; an optional one the reviewer holds to being read. Each shape a release stored is a fixture in `apps/pwa/test/stored/`, the text as stored, never edited once released (`lint/stored.test.ts`), and `apps/pwa/test/stored.test.ts` reads every one through the current reader and fails when the current screen stores a shape the last fixture does not have: a release that changes a shape adds a fixture of the new one, with its hash, and the earlier ones still read. `e2e/opening-offline.spec.ts` stores the first Unsent fixture under a kept earlier screen, and the current screen sends it.

## The deploy job

- A check in the deploy job stops on any failure it cannot tell from a "no": a command that fails, an output it cannot read. The Backup check reads `pulumi stack output --json` and stops when that fails, rather than taking the failure as a first deploy with nothing to check.

## Decisions

- A change follows the ADRs in [`docs/adr/`](docs/adr/) that touch its area. Where it departs from one, the same change amends the ADR and the spec beside it, or the departure goes to the person as a question.
- A change that widens or narrows what a glossary term covers, such as a new kind of Effect, updates the term in [`GLOSSARY.md`](GLOSSARY.md) and the ADR stating the old scope, in the same change as `SPEC.md`.

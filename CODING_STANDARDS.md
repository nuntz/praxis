# Coding standards

Read at review. The mechanical rules are checks already: Biome, the guards in `lint/`, and the oracle in `apps/worker/test/oracle.ts`. These are the judgement calls no check can make.

## Domain words

- Name code with the terms of [`GLOSSARY.md`](GLOSSARY.md), in the sense it gives them.
- A word the glossary gives to a state (open, closed, actionable, Finished, Dropped, Deferred, Overdue, Waiting, Delegated) names that state of a Task or Project only. Other things take their own word: a Context not retired is *reachable* or *shown*.
- A record is an Entry, Task, Project or Person. Whatever else a write returns, such as a Context or its settings, is named as what it is in its type and doc comment, even in a field called `record`.

## Registries

- A second set of tools reuses the first's machinery (parsing input, write keys, the log line, Effects) through one shared function, so a rule changed once holds for both.

## Outside services

- A cache in front of an outside service has a maximum age, and its limit on how often it asks holds after a failed ask as after a good one. Anything trusted from outside, such as a key, stops being trusted when that age passes.
- A refusal says whether the person can mend it (sign in again, change what they sent) or can only wait. One that only waiting mends is answered as unavailable, never as their doing.
- A faked adapter takes the Access key set's shape: the interface in `src/`, the fake in `test/<name>-fake.ts`, and one `contract()` suite run against the fake and, given its environment variables through Vitest's `provide`, against the real service. The adapter is passed in, as `praxis(accessOf)` takes it, since the Vitest plugin cannot intercept outbound requests.

## Decisions

- A change follows the ADRs in [`docs/adr/`](docs/adr/) that touch its area. Where it departs from one, the same change amends the ADR and the spec beside it, or the departure goes to the person as a question.

# Coding standards

Read at review. The mechanical rules are checks already: Biome, the guards in `lint/`, and the oracle in `apps/worker/test/oracle.ts`. These are the judgement calls no check can make.

## Domain words

- Name code with the terms of [`GLOSSARY.md`](GLOSSARY.md), in the sense it gives them.
- A word the glossary gives to a state (open, closed, actionable, Finished, Dropped, Deferred, Overdue, Waiting, Delegated) names that state of a Task or Project only. Other things take their own word: a Context not retired is *reachable* or *shown*.
- A record is an Entry, Task, Project or Person. Whatever else a write returns, such as a Context or its settings, is named as what it is in its type and doc comment, even in a field called `record`.

## Registries

- A second set of tools reuses the first's machinery (parsing input, write keys, the log line, Effects) through one shared function, so a rule changed once holds for both.

## Decisions

- A change follows the ADRs in [`docs/adr/`](docs/adr/) that touch its area. Where it departs from one, the same change amends the ADR and the spec beside it, or the departure goes to the person as a question.

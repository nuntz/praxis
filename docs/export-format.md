# The Export format

An Export is the whole Deployment as a zip of JSON files in a format of Praxis's own (SPEC section 10.1, ADR 0018). It is how a Deployment leaves Praxis and how it comes back. A Backup is the same files. This page is for whoever reads a file outside Praxis. In the code, the format is the types in `packages/domain/src/export.ts`.

## The zip

The person makes one from the Deployment's settings, and it downloads as `praxis-export-YYYY-MM-DD.zip`, named after the day it was made (UTC). The zip stores the files uncompressed, with UTF-8 names:

| Path | What |
|---|---|
| `deployment.json` | The Deployment's file |
| `contexts/<id>.json` | One per Context, retired ones too, named by the Context's id |

Each file is one JSON object, indented. Instants are ISO 8601 in UTC, to the millisecond, such as `2026-11-15T09:00:00.000Z`. Days have no time of day and are `YYYY-MM-DD`. Lists are in the order their items were made, unless this page says otherwise.

Each Context's object writes its own file, so the files of one Export are not one instant.

## The stamp

Every file starts with the same four fields, so a file read alone says what it is:

| Field | Value |
|---|---|
| `format` | `"praxis-export"` |
| `format_version` | `1`. The format's own number, not the tables' (ADR 0019). Praxis reads a file of any earlier version and refuses a newer one. |
| `made_at` | The instant the person asked for the Export |
| `kind` | `"deployment"` or `"context"` |

## `deployment.json`

| Field | What |
|---|---|
| `contexts` | Every Context, retired or not: `id`, `name`, `accent` (one of `blue`, `rust`, `teal`, `plum`, `moss`, `slate`), `retired`, and `file`, the path of its file |
| `spend_cap` | The monthly cap in US dollars the person set, or `null` while they have set none (a Deployment then has 20) |
| `deleted_contexts_spend` | What deleted Contexts spent, one entry per calendar month (UTC): `month` as `YYYY-MM`, and `dollars`, with no name attached. A Context that is not deleted is counted from its own Run records instead. |
| `connections` | Every Connection ever made: `id`, `name` and `context_id`. A restore brings each back ended, and the person makes the permission again at the new address. |

## `contexts/<id>.json`

| Field | What |
|---|---|
| `context` | `id`, `name` and `time_zone`, a zone of the IANA database; `brief_time`, when the Brief comes each day, and `review_day` and `review_time`, when the Review comes each week, each time `HH:MM` on the 24-hour clock in that zone and `null` while it is off, the day one of `"monday"` to `"sunday"`, kept while the Review is off; and `notifications`, whether the Context's one Notification switch, covering its Brief and its Review, is on |
| `entries` | Every Entry, including those in the Trash |
| `tasks` | Every Task, including those in the Trash |
| `projects` | Every Project, including those in the Trash |
| `persons` | Every Person, including those in the Trash |
| `trash` | What is in the Trash, one item per delete, in the order deleted |
| `runs` | Every Run record, in the order started |

An **author** is `{ "kind": "person" }`, `{ "kind": "agent" }` or `{ "kind": "connection", "name": "…" }`. A record of another kind is named as `{ "kind": "entry" | "task" | "project" | "person", "id": "…" }`.

**An Entry** is its plain words exactly as typed, with its links beside them as data (ADR 0008). An image is in the words as its address only.

| Field | What |
|---|---|
| `id`, `words`, `at`, `author` | |
| `through_conversation` | Whether it came through the Conversation |
| `follow_up_to` | The id of the one earlier Entry it is a Follow-up to, or `null` |
| `links` | Its References and Mentions in the order added: `to` names a Task, Project or Person, and `anchor` is `{ start, end, text }` or `null`. `start` and `end` count UTF-16 code units, as JavaScript does, and `text` is what the span held, which the anchor follows through a change to the words. A span whose text has gone from the words is kept as it was, and reads as no anchor. |
| `standing` | Whether it is a Standing Entry |
| `versions` | Every earlier state of its words, oldest first: `version`, the `words` it had then, and `changed`, the `by` and `at` of the change that replaced them. The Entry's version is how many there are. |

**A Task** has `id`, `title`, `origin_entry`, `at`, `author`, `project` (an id or `null`), `due_date` and `defer_date` (days or `null`), `recurrence` (below, or `null`) and `events`. Its state is not in the file. It is worked out from its events, oldest first:

| `what` | With |
|---|---|
| `finished`, `dropped`, `reopened`, `taken_back` | `at` |
| `delegated` | `at`, and `person`, the Person's id |
| `waited_on`, `stopped_waiting`, `released` | `at`, and `on`, the Task or Project waited on |

A **Recurrence** is only on the open Occurrence. It is a schedule counted from the day `from`: `{ kind: "days", every, from }`, `{ kind: "weeks", every, on: ["monday", …], from }`, `{ kind: "months", every, on: 1–31 or "last", from }` or `{ kind: "years", every, from }`. Or it is an interval counted from the day the Occurrence closes: `{ kind: "interval", every, unit: "days" | "weeks" | "months" | "years" }`.

**A Project** has `id`, `name`, `at`, `due_date`, and `events`: what was declared of it, oldest first, each `{ what: "finished" | "dropped" | "reopened", at }`.

**A Person** has `id`, `name` and `at`.

**A Trash item** is what one delete sent there. `deleted` is the record deleted, `went_with` is what could not exist without it, in the order made, and `at` is the delete. The item is removed for good 30 days after `at`, a restore included. `dormant_links` are the links from Tasks not in the Trash to a record in the item, which the delete took away and a restore brings back. Each has `task`, the Task's id, `what` (`project`, `delegation` or `wait`) and `to`, the record it links to. The records themselves are in their own lists above.

**A Run record** holds no words: `id`, `started_by` (`"message"`, or `"brief"` or `"review"` for one the clock started), `at`, `model`, `tokens` (`input`, `output`, `cache_read`, `cache_write`), `cost` in US dollars by the price table of the code that ran it, `ended` (`"answered"`, `"cut_short"` for one that reached the limit of model rounds, `"failed"`, `"cap_reached"`, or `null` for one still going) and `failure` (`"model_unavailable"`, `"key_refused"` or `null`). Which changes it made is not kept, since the file holds no change log.

## What is not in it

Any Conversation or the runtime's record of one, a Message's words, a Held Change, the change log, the record of a Connection's calls, Devices and their push subscriptions, both provider keys, and the keys callers gave their writes. Praxis does not encrypt the file. Once downloaded, it is the person's, and Praxis cannot reach it.

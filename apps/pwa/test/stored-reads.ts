// What the longer fixtures in test/stored/ read as under the current screen, written out by hand
// in the current shape, for test/stored.test.ts.

const person = { kind: "person" } as const;
const renew = {
  id: "task-renew",
  title: "Renew the passport",
  origin_entry: "entry-passport",
  at: "2026-11-02T08:00:00.000Z",
  author: person,
  project: "project-move",
  due_date: "2026-11-25",
  defer_date: null,
  recurrence: null,
  state: {
    is: "open",
    actionable: true,
    waiting: null,
    delegated: null,
    deferred: null,
    overdue: null,
  },
};
const lease = {
  id: "task-lease",
  title: "Sign the lease",
  origin_entry: "entry-passport",
  at: "2026-11-02T08:00:00.000Z",
  author: person,
  project: null,
  due_date: "2026-11-18",
  defer_date: null,
  recurrence: { kind: "months", every: 1, on: "last", from: "2026-11-18" },
  state: {
    is: "open",
    actionable: false,
    waiting: [
      {
        on: { kind: "project", id: "project-move", name: "Move house" },
        since: "2026-11-03T10:00:00.000Z",
      },
    ],
    delegated: { to: { id: "person-ana", name: "Ana" }, since: "2026-11-03T10:00:00.000Z" },
    deferred: { until: "2026-11-30" },
    overdue: { since: "2026-11-19" },
  },
};
const boxes = {
  id: "task-boxes",
  title: "Buy boxes",
  origin_entry: "entry-passport",
  at: "2026-11-01T08:00:00.000Z",
  author: { kind: "agent" },
  project: "project-move",
  due_date: null,
  defer_date: null,
  recurrence: null,
  state: { is: "finished", at: "2026-11-04T12:00:00.000Z" },
};
const move = {
  id: "project-move",
  name: "Move house",
  at: "2026-11-01T08:00:00.000Z",
  due_date: "2026-12-01",
  state: { is: "open", overdue: null },
  tasks: [boxes, renew],
};
const passport = {
  id: "entry-passport",
  words: "Passport runs out in March\n[] Renew the passport",
  at: "2026-11-02T08:00:00.000Z",
  author: person,
  through_conversation: false,
  tasks: [renew, lease],
  links: [
    {
      kind: "mention",
      to: { kind: "person", id: "person-ana", summary: "Ana" },
      anchor: { start: 0, end: 8 },
    },
    {
      kind: "reference",
      to: { kind: "project", id: "project-gone", summary: "Old flat", deleted: true },
      anchor: null,
    },
  ],
  version: 1,
  edited: { by: { kind: "connection", name: "Claude" }, at: "2026-11-03T09:00:00.000Z" },
  follow_up_to: { id: "entry-old", summary: "Kept from the summer", deleted: true },
  follow_ups: [{ id: "entry-later", summary: "Booked the appointment" }],
  standing: false,
};
const older = {
  id: "entry-old",
  words: "Kept from the summer",
  at: "2026-07-14T18:30:00.000Z",
  author: person,
  through_conversation: true,
  tasks: [],
  links: [],
  version: 0,
  edited: null,
  follow_up_to: null,
  follow_ups: [{ id: "entry-passport", summary: "Passport runs out in March" }],
  standing: true,
};
/** praxis.offline-0001.txt: a copy of one Context, with every shape a record of it can take. */
export const offline0001 = {
  contexts: [
    {
      id: "ctx-home",
      fetched_at: "2026-11-20T08:00:00.000Z",
      time_zone: "Europe/Lisbon",
      attention: {
        due: [
          { kind: "task", task: lease },
          { kind: "project", project: move },
        ],
        newly_actionable: [
          { task: renew, came_up: { because: "wait_ended", at: "2026-11-19T09:00:00.000Z" } },
          { task: renew, came_up: { because: "defer_date_came", on: "2026-11-19" } },
        ],
        delegated: [lease],
        projects: [{ project: move, actionable_tasks: 1, no_open_task: false }],
        loose: [renew],
      },
      tasks: [renew, lease],
      projects: [move],
      persons: [
        {
          id: "person-ana",
          name: "Ana",
          at: "2026-11-01T08:00:00.000Z",
          latest_mention: {
            entry: "entry-passport",
            at: "2026-11-02T08:00:00.000Z",
            summary: "Passport runs out in March",
          },
        },
        { id: "person-bo", name: "Bo", at: "2026-11-01T08:00:00.000Z", latest_mention: null },
      ],
      standing: [older],
      entries: [passport, older],
      opened: ["entry-old"],
    },
  ],
};
/** praxis.unsent-0002.txt: an Unsent Entry with links and a Follow-up, kept with an Offline Copy. */
export const unsent0002 = [
  {
    id: "5b0d2c1e-7a4f-4c39-9e61-3f2a8d7b4c10",
    context: "ctx-home",
    key: "00000000-0000-4000-8000-000000000001",
    keyed_at: "2026-11-20T08:15:00.000Z",
    made_at: "2026-11-20T08:15:00.000Z",
    refused: null,
    kind: "entry",
    words: "Ana says the form is in\n[] Post the form",
    tasks: [{ title: "Post the form" }],
    links: [
      { to: { kind: "person", id: "person-ana", summary: "Ana" }, anchor: { start: 0, end: 3 } },
      { to: { kind: "project", id: "project-move", summary: "Move house" }, anchor: null },
    ],
    follow_up_to: { id: "entry-passport", summary: "Passport runs out in March" },
  },
  {
    id: "9c4e1f7a-2b6d-4e83-8f15-0a3c7d9e2b42",
    context: "ctx-home",
    key: "00000000-0000-4000-8000-000000000002",
    keyed_at: "2026-11-20T08:20:00.000Z",
    made_at: "2026-11-20T08:20:00.000Z",
    refused: null,
    kind: "finish",
    task: { id: "task-renew", title: "Renew the passport" },
  },
  {
    id: "e2a7b9c4-6f1d-4a58-b3e2-8d0c5f7a1e94",
    context: "ctx-work",
    key: "00000000-0000-4000-8000-000000000003",
    keyed_at: "2026-11-19T17:02:00.000Z",
    made_at: "2026-11-19T17:02:00.000Z",
    refused: "The Context was retired.",
    kind: "entry",
    words: "Call back about the lease",
    tasks: [],
    links: [],
    follow_up_to: null,
  },
];

import type { CallStarted, Export } from "@praxis/domain";
import { CONTEXT_LADDER, DEPLOYMENT_LADDER } from "../src/steps/index.ts";
import { marked } from "./markers.ts";
import { subscribe } from "./push-fake.ts";
import { agent, contextIn, DAY, hand, left, newDeployment, value } from "./seam.ts";
import { setVoiceRefusing } from "./voice-fake.ts";

// The fixed scenario each release's fixture is filled by (section 13, ADR 0019), run through the
// tools as every caller would. It reaches every table a step could change: Entries with Versions,
// links, Follow-ups and a Standing mark, Tasks with events, a Recurrence, a delegation and a wait,
// a Project, a Person, the Trash, a Held Change, the change log, a Connection and what it wrote, a
// Device with its push subscription and its Offline Copy on, the spend cap, a Run and its Conversation, a Call ended and
// one going, the voice key refused, and a Backup.
// Words carry markers, so the upgrade test holds them to the check that no words leave.
//
// Changing it changes no fixture already saved: the next release's is filled by it as it is then.

/** When the scenario runs, and when the fixture's Export was made. */
export const FIXTURE_TIME = "2026-11-20T09:00:00.000Z";

/**
 * A release's fixture is named by the tops of its two ladders, since a release that adds no step
 * has the tables of the one before it.
 */
export function fixtureName(
  context = CONTEXT_LADDER.length,
  deployment = DEPLOYMENT_LADDER.length,
): string {
  return `context-${context}-deployment-${deployment}`;
}

/** What a fixture holds besides the objects' dumps: their ids, and those the reads after use. */
export type FixtureIds = {
  deployment: string;
  context: string;
  connection: { id: string; name: string };
  device: string;
  /** When the scenario ended and its Export was made. */
  at: string;
};

/** Fill a Deployment and one Context by the scenario. Returns their ids and the Export made last. */
export async function fillFixture(): Promise<{ ids: FixtureIds; made: Export }> {
  const deployment = newDeployment(FIXTURE_TIME);
  const { record: listed, context } = await contextIn(deployment, "Personal", {
    time_zone: "Europe/Paris",
  });

  const boiler = value(
    await context.call(hand, "record_entry", {
      words: marked("The boiler is making that noise again"),
      tasks: [{ title: marked("Call the plumber") }, { title: marked("Find the warranty") }],
    }),
  ).record;
  const [plumber, warranty] = boiler.tasks;
  if (plumber === undefined || warranty === undefined) throw new Error("Expected two Tasks");
  value(
    await context.call(hand, "add_link", {
      entry_id: boiler.id,
      to: { kind: "new_person", name: marked("Sam") },
    }),
  );
  const sam = value(await context.call(hand, "list_persons", {})).items[0];
  if (sam === undefined) throw new Error("Expected the Person made");
  value(await context.call(hand, "delegate_task", { id: warranty.id, person_id: sam.id }));
  value(
    await context.call(hand, "set_task_dates", {
      id: plumber.id,
      due_date: "2026-11-23",
      defer_date: "2026-11-21",
    }),
  );
  value(
    await context.call(hand, "set_recurrence", {
      id: plumber.id,
      recurrence: { kind: "weeks", every: 1, on: ["monday"] },
    }),
  );

  const kitchen = value(
    await context.call(hand, "create_project", { name: marked("Kitchen") }),
  ).record;
  const followUp = value(
    await context.call(hand, "record_entry", {
      words: marked("Quote for the new tiles came in"),
      tasks: [{ title: marked("Choose the tiles") }],
      follow_up_to: boiler.id,
    }),
  ).record;
  const tiles = followUp.tasks[0];
  if (tiles === undefined) throw new Error("Expected a Task");
  value(await context.call(hand, "move_task", { id: tiles.id, project_id: kitchen.id }));
  value(
    await context.call(hand, "wait_on", {
      id: plumber.id,
      on: { kind: "project", id: kitchen.id },
    }),
  );
  value(
    await context.call(hand, "edit_entry", {
      id: followUp.id,
      words: marked("Quote for the new tiles came in, a little high"),
      version: 0,
      tasks: [],
    }),
  );
  value(await context.call(hand, "mark_standing", { id: boiler.id }));

  // The Agent's change to the person's words waits as a Held Change.
  left(
    await context.call(agent, "edit_entry", {
      id: boiler.id,
      words: marked("The boiler is making a knocking noise"),
      version: 0,
    }),
  );

  const passing = value(
    await context.call(hand, "record_entry", {
      words: marked("Nothing to keep"),
      tasks: [{ title: marked("A Task gone with it") }],
    }),
  ).record;
  deployment.advance(DAY);
  value(await context.call(hand, "delete_entry", { id: passing.id }));
  value(await context.call(hand, "finish_task", { id: plumber.id }));

  const connection = value(
    await deployment.call(hand, "create_connection", {
      name: "Claude",
      context_id: listed.id,
      reading_only: false,
    }),
  ).record;
  const asConnection = { kind: "connection", id: connection.id, name: connection.name } as const;
  value(
    await context.call(asConnection, "record_entry", { words: marked("Noted from elsewhere") }),
  );

  const device = crypto.randomUUID();
  value(
    await deployment.call(hand, "set_device_notifications", {
      id: device,
      on: true,
      subscription: subscribe(),
      user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1",
    }),
  );
  value(
    await deployment.call(hand, "set_device_offline_copy", {
      id: device,
      on: true,
      user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1",
    }),
  );
  value(await deployment.call(hand, "set_spend_cap", { cap: 30 }));

  value(await context.callAny(hand, "send_message", { words: marked("What is due this week?") }));
  await context.runsEnded();

  // A Call, which leaves a record with no words, and a Message spoken in it.
  const { call } = value(
    await context.callAny(hand, "start_call", { offer: "v=0 fixture offer" }),
  ) as { call: CallStarted };
  value(
    await context.callAny(hand, "send_message", {
      words: marked("Record that the boiler is fixed"),
      spoken: true,
    }),
  );
  await context.runsEnded();
  deployment.advance(2 * 60 * 1000);
  value(
    await context.callAny(hand, "end_call", {
      call: call.id,
      ended: "hung_up",
      provider_end: { reason: "close_requested" },
    }),
  );
  // A Call left going, which the Deployment names as the one going, with a sign of life since it
  // was set up; and the voice key refused once since, a standing Notice.
  const going = value(
    await context.callAny(hand, "start_call", { offer: "v=0 fixture offer" }),
  ) as { call: CallStarted };
  deployment.advance(15 * 1000);
  value(await context.callAny(hand, "note_call_alive", { call: going.call.id }));
  setVoiceRefusing("key_refused");
  const refused = await context.callAny(hand, "start_call", { offer: "v=0 fixture offer" });
  setVoiceRefusing(null);
  if (refused.ok) throw new Error("Expected the voice key refused");

  deployment.advance(DAY);
  await deployment.backUp();
  deployment.advance(60 * 60 * 1000);
  const made = value(await deployment.call(hand, "make_export", {}));
  return {
    ids: {
      deployment: deployment.id,
      context: listed.id,
      connection: { id: connection.id, name: connection.name },
      device,
      at: made.made_at,
    },
    made,
  };
}

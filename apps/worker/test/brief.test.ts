import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import {
  type AgentMessage,
  type MessagesPage,
  offeredTo,
  type PersonMessage,
} from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { NOTHING_TO_RAISE } from "../src/agent.ts";
import { marked } from "./markers.ts";
import {
  answering,
  calling,
  failing,
  KEY_REFUSED,
  lastWords,
  noModel,
  offeredIn,
  type Script,
  scriptModel,
  UNAVAILABLE,
} from "./model-fake.ts";
import { atOnce, DAY, hand, newContext, newDeployment, value } from "./seam.ts";

// The Brief and the Review (section 5.4, ADR 0004): once a day and once a week, at times the person
// sets for the Context, the clock starts a Run that reads the Journal and leaves one Message. The
// Context's alarm is fired by the test, at the time the test sets.

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

type Context = ReturnType<typeof newContext>;

async function messages(context: Context): Promise<MessagesPage["items"]> {
  return (value(await context.callAny(hand, "list_messages", {})) as MessagesPage).items;
}

/** Fire the Context's alarm at the time set, and wait for every Run it started to end. */
async function wake(context: Context) {
  await context.fireAlarm();
  await context.runsEnded();
}

/** A script answering "Brief 1.", "Brief 2." and so on, counting each in `asked`. */
function numbered(asked = { briefs: 0 }): Script {
  return () => {
    asked.briefs += 1;
    return fauxAssistantMessage(`Brief ${asked.briefs}.`);
  };
}

describe("the Brief", () => {
  test("the alarm starts it at its time, and it leaves one Message from the Agent", async () => {
    scriptModel(answering("Two Tasks are due today."));
    // A Monday, an hour before the Brief's 07:00.
    const context = newContext("2026-11-16T06:00:00.000Z");

    await wake(context);
    const before = await messages(context);
    context.advance(HOUR);
    await wake(context);

    expect(before).toEqual([]);
    const [brief, ...rest] = await messages(context);
    expect(rest).toEqual([]);
    expect(brief).toMatchObject({
      from: "agent",
      words: "Two Tasks are due today.",
      clock: { kind: "brief", taken: "2026-11-16T07:00:00.000Z", read: false },
      run: { ended: "answered" },
    });
  });
});

describe("a Clock Run", () => {
  test("is offered reads only", async () => {
    const offered: Set<string>[] = [];
    scriptModel((request) => {
      offered.push(offeredIn(request).tools);
      return fauxAssistantMessage("Nothing is due.");
    });
    const context = newContext("2026-11-16T06:59:00.000Z");
    context.advance(60_000);

    await wake(context);

    expect(offered).toEqual([new Set(offeredTo("clock"))]);
  });

  test("cannot change anything or leave a Held Change: a write it calls anyway is not offered", async () => {
    let entry = "";
    scriptModel(
      calling(
        [
          () => ["record_entry", { words: marked("A Brief's own Entry") }],
          () => ["delete_entry", { id: entry }],
        ],
        "Nothing is due.",
      ),
    );
    const context = newContext("2026-11-16T06:59:00.000Z");
    entry = atOnce(await context.call(hand, "record_entry", { words: marked("Call the bank") }))
      .record.id;
    context.advance(60_000);

    await wake(context);

    const [brief] = (await messages(context)) as [AgentMessage];
    expect(brief.run.calls.map(({ tool, result }) => [tool, result])).toEqual([
      ["record_entry", "not_offered"],
      ["delete_entry", "not_offered"],
    ]);
    expect(value(await context.call(hand, "list_entries", {})).items).toHaveLength(1);
    expect(value(await context.call(hand, "list_held_changes", {})).items).toEqual([]);
  });
});

describe("a Clock Run's limit", () => {
  test("is 10 model rounds, while a Message queued behind it still gets 25", async () => {
    const asked = { clock: 0, person: 0 };
    const keepGoing = marked("Keep going");
    // A model that never stops calling a tool.
    scriptModel((request) => {
      if (lastWords(request) === keepGoing) asked.person += 1;
      else asked.clock += 1;
      return fauxAssistantMessage(fauxToolCall("get_settings", {}), { stopReason: "toolUse" });
    });
    const context = newContext("2026-11-16T06:59:00.000Z");
    context.advance(60_000);

    await context.fireAlarm();
    value(await context.callAny(hand, "send_message", { words: keepGoing }));
    await context.runsEnded();

    expect(asked).toEqual({ clock: 10, person: 25 });
    const [answer, sent, brief] = (await messages(context)) as [
      AgentMessage,
      PersonMessage,
      AgentMessage,
    ];
    expect(sent.words).toBe(keepGoing);
    expect(answer.words).toMatch(/at most 25 rounds/);
    expect(brief).toMatchObject({ clock: { kind: "brief" }, run: { ended: "cut_short" } });
    expect(brief.words).toMatch(/a Brief takes at most 10 rounds/);
  });
});

describe("nothing to raise", () => {
  test("a Brief with nothing to raise leaves no Message", async () => {
    scriptModel(answering(NOTHING_TO_RAISE));
    const context = newContext("2026-11-16T06:59:00.000Z");
    context.advance(60_000);

    await wake(context);

    expect(await messages(context)).toEqual([]);
  });
});

describe("the Review", () => {
  test("comes on Sunday at 17:00, and one with nothing to raise says so in one line", async () => {
    scriptModel((request) =>
      fauxAssistantMessage(
        /weekly Review/.test(lastWords(request)) ? "Nothing has gone stale." : NOTHING_TO_RAISE,
      ),
    );
    // A Saturday evening: the Review comes the next day at 17:00, not before.
    const context = newContext("2026-11-14T17:00:00.000Z");
    await wake(context);
    context.advance(DAY - 60_000);
    await wake(context);
    const before = await messages(context);
    context.advance(60_000);

    await wake(context);

    expect(before).toEqual([]);
    expect(await messages(context)).toMatchObject([
      {
        words: "Nothing has gone stale.",
        clock: { kind: "review", taken: "2026-11-15T17:00:00.000Z" },
      },
    ]);
  });
});

describe("replacing and reading", () => {
  test("a new Brief replaces one not yet read", async () => {
    scriptModel(numbered());
    const context = newContext("2026-11-16T06:59:00.000Z");
    context.advance(60_000);
    await wake(context);

    context.advance(DAY);
    await wake(context);

    expect(await messages(context)).toMatchObject([
      { words: "Brief 2.", clock: { taken: "2026-11-17T07:00:00.000Z", read: false } },
    ]);
  });
});

describe("note_shown", () => {
  test("one Praxis has shown is read, held for the Context, and stays as an ordinary Message", async () => {
    scriptModel(numbered());
    const context = newContext("2026-11-16T06:59:00.000Z");
    context.advance(60_000);
    await wake(context);
    const [first] = (await messages(context)) as [AgentMessage];
    context.advance(3 * 60 * 60 * 1000);

    value(await context.callAny(hand, "note_shown", { message: first.id }));
    const shown = await messages(context);
    context.advance(DAY);
    await wake(context);

    expect(shown).toMatchObject([{ id: first.id, clock: { read: true } }]);
    expect(await messages(context)).toMatchObject([
      { words: "Brief 2.", clock: { read: false } },
      { id: first.id, words: "Brief 1.", clock: { read: true } },
    ]);
  });

  test("names a Brief or a Review of this Conversation", async () => {
    scriptModel(answering("Done."));
    const context = newContext();
    value(await context.callAny(hand, "send_message", { words: marked("Hello") }));
    await context.runsEnded();
    const [answer] = (await messages(context)) as [AgentMessage];

    for (const message of [answer.id, "no-such-message"]) {
      const result = await context.callAny(hand, "note_shown", { message });
      expect(result.ok ? null : result.error.code).toBe("not_found");
    }
  });
});

describe("a Brief that could not run on time", () => {
  test("runs as soon as it can, and is dropped once the next one is due", async () => {
    scriptModel(answering("Here is what needs attention."));
    // Made on Monday morning; nothing wakes the Context again until Wednesday at 06:00.
    const context = newContext("2026-11-16T06:00:00.000Z");
    context.advance(2 * DAY);

    await wake(context);

    // Tuesday's Brief runs now, once; Monday's was dropped once Tuesday's was due.
    expect(await messages(context)).toMatchObject([
      { clock: { kind: "brief", taken: "2026-11-18T06:00:00.000Z" } },
    ]);
  });
});

/** A script that fails as unavailable while `down()` is true, and answers once it is not. */
function failingWhile(down: () => boolean): Script {
  const failed = failing(UNAVAILABLE);
  const answered = answering("Back again.");
  return (...args) => (down() ? failed(...args) : answered(...args));
}

describe("a Brief during an outage", () => {
  test("is tried again with a growing gap, Attention shows one line with the reason, and it leaves no Message until it runs", async () => {
    let down = true;
    const faux = scriptModel(failingWhile(() => down));
    const context = newContext("2026-11-16T06:59:00.000Z");
    context.advance(MINUTE);
    await wake(context);
    const asked = () => faux.state.callCount;
    const afterFirst = asked();
    const notices = value(await context.call(hand, "list_notices", {})).items;

    // Not again before the first gap of five minutes, then again once it has passed.
    context.advance(4 * MINUTE);
    await wake(context);
    const beforeGap = asked();
    context.advance(MINUTE);
    await wake(context);
    const afterGap = asked();
    // The next gap is longer: ten minutes.
    context.advance(9 * MINUTE);
    await wake(context);
    const beforeSecondGap = asked();
    down = false;
    context.advance(MINUTE);
    await wake(context);

    expect(notices).toEqual([
      {
        kind: "clock_failed",
        clock: "brief",
        failure: "model_unavailable",
        since: "2026-11-16T07:00:00.000Z",
      },
    ]);
    expect(beforeGap).toBe(afterFirst);
    expect(afterGap).toBeGreaterThan(beforeGap);
    expect(beforeSecondGap).toBe(afterGap);
    expect(await messages(context)).toMatchObject([
      { words: "Back again.", clock: { kind: "brief", taken: "2026-11-16T07:15:00.000Z" } },
    ]);
    expect(value(await context.call(hand, "list_notices", {})).items).toEqual([]);
  });
});

describe("a Brief due at the cap", () => {
  test("waits for the cap to be raised", async () => {
    // Each answer costs about five cents: the scripted model counts a token for every four
    // characters, and an output token is priced at 10 US dollars a million.
    scriptModel(answering("word ".repeat(4_000)));
    const deployment = newDeployment("2026-11-16T06:00:00.000Z");
    await deployment.call(hand, "set_spend_cap", { cap: 0.05 });
    const made = await deployment.call(hand, "create_context", {
      name: "Work",
      time_zone: "UTC",
      accent: "blue",
    });
    const context = deployment.context(value(made).record.id);
    value(await context.callAny(hand, "send_message", { words: marked("Past the cap") }));
    await context.runsEnded();
    deployment.advance(HOUR);
    await context.fireAlarm();
    await context.runsEnded();
    const atTheCap = await messages(context as unknown as Context);

    await deployment.call(hand, "set_spend_cap", { cap: 20 });
    deployment.advance(15 * MINUTE);
    await context.fireAlarm();
    await context.runsEnded();

    expect(atTheCap.filter((message) => message.from === "agent" && message.clock)).toEqual([]);
    expect(await messages(context as unknown as Context)).toMatchObject([
      { clock: { kind: "brief", taken: "2026-11-16T07:15:00.000Z" } },
      { from: "agent" },
      { from: "person" },
    ]);
  });
});

describe("without the Agent's key", () => {
  test("no Brief or Review is ever due", async () => {
    noModel();
    const context = newContext("2026-11-15T06:00:00.000Z");
    context.advance(12 * HOUR);

    await wake(context);

    expect(value(await context.callAny(hand, "list_messages", {}))).toMatchObject({
      items: [],
      agent: "no_key",
    });
    expect(value(await context.call(hand, "list_notices", {})).items).toEqual([]);
  });
});

describe("when a Brief was taken", () => {
  test("it says so, and says once Tasks it names have been finished since", async () => {
    const tasks: string[] = [];
    scriptModel(() =>
      fauxAssistantMessage(`Two Tasks are due.\n\n<tasks_named>${tasks.join(" ")}</tasks_named>`),
    );
    const context = newContext("2026-11-16T06:00:00.000Z");
    const { record: entry } = atOnce(
      await context.call(hand, "record_entry", {
        words: marked("Errands"),
        tasks: [{ title: marked("Post the letter") }, { title: marked("Buy stamps") }],
      }),
    );
    tasks.push(...entry.tasks.map((task) => task.id));
    context.advance(HOUR);
    await wake(context);
    const taken = await messages(context);

    context.advance(HOUR);
    value(await context.call(hand, "finish_task", { id: tasks[0] }));

    expect(taken).toMatchObject([
      {
        words: "Two Tasks are due.",
        clock: { taken: "2026-11-16T07:00:00.000Z", finished_since: 0 },
      },
    ]);
    expect(await messages(context)).toMatchObject([{ clock: { finished_since: 1 } }]);
  });
});

describe("set_brief_time and the clock", () => {
  test("a time already past today starts no Brief now; a later one comes today", async () => {
    const asked = { briefs: 0 };
    scriptModel(numbered(asked));
    // 08:00, after this morning's Brief.
    const context = newContext("2026-11-16T06:00:00.000Z");
    context.advance(HOUR);
    await wake(context);
    context.advance(HOUR);

    value(await context.call(hand, "set_brief_time", { time: "07:30" }));
    await wake(context);
    const afterEarlier = asked.briefs;
    value(await context.call(hand, "set_brief_time", { time: "09:00" }));
    context.advance(HOUR);
    await wake(context);

    expect(afterEarlier).toBe(1);
    expect(await messages(context)).toMatchObject([
      { words: "Brief 2.", clock: { taken: "2026-11-16T09:00:00.000Z" } },
    ]);
  });

  test("switched off, none comes, and the next it comes once switched on again", async () => {
    scriptModel(answering("Here is what needs attention."));
    const context = newContext("2026-11-16T06:00:00.000Z");
    value(await context.call(hand, "set_brief_time", { time: null }));
    context.advance(HOUR);
    await wake(context);
    const whileOff = await messages(context);

    value(await context.call(hand, "set_brief_time", { time: "07:00" }));
    await wake(context);
    const onAgain = await messages(context);
    context.advance(DAY);
    await wake(context);

    expect(whileOff).toEqual([]);
    expect(onAgain).toEqual([]);
    expect(await messages(context)).toMatchObject([
      { clock: { taken: "2026-11-17T07:00:00.000Z" } },
    ]);
  });
});

describe("the Brief's time", () => {
  test("is read in the Context's time zone, across a change of summer time", async () => {
    scriptModel(numbered());
    // New York leaves summer time on 1 November 2026: 07:00 is 11:00 UTC before, 12:00 after.
    const context = newContext("2026-10-31T10:00:00.000Z", {
      name: "Home",
      time_zone: "America/New_York",
    });
    context.advance(HOUR);
    await wake(context);
    const before = await messages(context);
    context.advance(DAY);
    await wake(context);
    const anHourEarly = await messages(context);
    context.advance(HOUR);

    await wake(context);

    expect(before).toMatchObject([{ clock: { taken: "2026-10-31T11:00:00.000Z" } }]);
    expect(anHourEarly).toEqual(before);
    expect(await messages(context)).toMatchObject([
      { words: "Brief 2.", clock: { taken: "2026-11-01T12:00:00.000Z" } },
    ]);
  });
});

describe("a Brief whose key the provider refuses", () => {
  test("is not tried again: it waits for the next one, and Attention says why", async () => {
    const faux = scriptModel(failing(KEY_REFUSED));
    const context = newContext("2026-11-16T06:59:00.000Z");
    context.advance(MINUTE);
    await wake(context);
    const asked = faux.state.callCount;

    context.advance(2 * HOUR);
    await wake(context);
    const later = faux.state.callCount;
    context.advance(DAY - 2 * HOUR);
    await wake(context);

    expect(later).toBe(asked);
    expect(faux.state.callCount).toBeGreaterThan(later);
    expect(value(await context.call(hand, "list_notices", {})).items).toContainEqual({
      kind: "clock_failed",
      clock: "brief",
      failure: "key_refused",
      since: "2026-11-16T07:00:00.000Z",
    });
  });
});

describe("a Review that answers it has nothing to raise as a Brief would", () => {
  test("still says so in one line", async () => {
    scriptModel(answering(NOTHING_TO_RAISE));
    const context = newContext("2026-11-15T16:59:00.000Z");
    context.advance(MINUTE);

    await wake(context);

    const [review, ...rest] = (await messages(context)) as AgentMessage[];
    expect(rest).toEqual([]);
    expect(review?.clock?.kind).toBe("review");
    expect(review?.words).not.toBe(NOTHING_TO_RAISE);
    expect(review?.words.split("\n")).toHaveLength(1);
  });
});

describe("set_time_zone and the clock", () => {
  test("a Brief time the new zone has already passed today starts no Brief now", async () => {
    scriptModel(answering("Here is what needs attention."));
    // Made at 04:00 in London; at 06:30 there, before its Brief, it is already 08:30 in Athens.
    const context = newContext("2026-11-16T04:00:00.000Z", {
      name: "Work",
      time_zone: "Europe/London",
    });
    context.advance(150 * MINUTE);

    value(await context.call(hand, "set_time_zone", { time_zone: "Europe/Athens" }));
    await wake(context);

    expect(await messages(context)).toEqual([]);
  });
});

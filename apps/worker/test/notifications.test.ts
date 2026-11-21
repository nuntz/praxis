import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { conversationAddress, type PushSubscription } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { NOTHING_TO_RAISE } from "../src/agent.ts";
import { topicOf } from "../src/push.ts";
import { marked } from "./markers.ts";
import { answering, failing, lastWords, scriptModel, UNAVAILABLE } from "./model-fake.ts";
import { received, setPushFailing, subscribe, unsubscribe } from "./push-fake.ts";
import { DAY, hand, newDeployment, value } from "./seam.ts";

// A Notification (section 8.7, ADR 0013) is sent by Web Push when the Agent leaves a Brief or a
// Review, to every Device with Notifications switched on, in a Context whose own switch is on.
// It is fixed wording naming the kind and the Context, and nothing else: the marker harness
// fails a test where a marker seeded in the Brief's words reaches one. What is pushed is read from
// the fake push service (test/push-fake.ts).

const HOUR = 60 * 60 * 1000;

/** A Monday, an hour before a new Context's 07:00 Brief. */
const BEFORE_THE_BRIEF = "2026-11-16T06:00:00.000Z";

type Deployment = ReturnType<typeof newDeployment>;

async function makeContext(deployment: Deployment, name: string): Promise<string> {
  const made = await deployment.call(hand, "create_context", {
    name,
    time_zone: "UTC",
    accent: "blue",
  });
  return value(made).record.id;
}

/** A Device with Notifications switched on, by the subscription its browser was given. */
async function deviceSwitchedOn(deployment: Deployment): Promise<PushSubscription> {
  const subscription = subscribe();
  value(
    await deployment.call(hand, "set_device_notifications", {
      id: crypto.randomUUID(),
      on: true,
      subscription,
      user_agent: "Mozilla/5.0 (iPhone) Version/18.1 Safari/604.1",
    }),
  );
  return subscription;
}

/** Fire the Context's alarm at the time set, and wait for every Run it started to end. */
async function wake(deployment: Deployment, id: string) {
  await deployment.context(id).fireAlarm();
  await deployment.context(id).runsEnded();
}

/** Move to the Brief's time, and let it run. */
async function brief(deployment: Deployment, id: string) {
  deployment.advance(HOUR);
  await wake(deployment, id);
}

describe("a Brief's Notification", () => {
  test("goes to every Device switched on, naming the kind and the Context and carrying nothing else", async () => {
    scriptModel(answering(marked("Two Tasks are due today, among 3 waiting.")));
    const deployment = newDeployment(BEFORE_THE_BRIEF);
    const work = await makeContext(deployment, "Work");
    const phone = await deviceSwitchedOn(deployment);
    const laptop = await deviceSwitchedOn(deployment);

    await wake(deployment, work);
    const before = [...received(phone)];
    await brief(deployment, work);

    const notification = {
      title: "Work: your Brief is ready",
      tag: `brief:${work}`,
      open: conversationAddress(work),
    };
    expect(before).toEqual([]);
    for (const device of [phone, laptop]) {
      expect(received(device)).toEqual([{ notification, topic: await topicOf(work, "brief") }]);
    }
  });

  test("a Brief with nothing to raise sends nothing, and nor does one that failed", async () => {
    // A Context keeps the model it was first asked with: one script, unreachable from the second.
    let reachable = true;
    const [nothing, unreachable] = [answering(NOTHING_TO_RAISE), failing(UNAVAILABLE)];
    scriptModel((...args) => (reachable ? nothing(...args) : unreachable(...args)));
    const deployment = newDeployment(BEFORE_THE_BRIEF);
    const work = await makeContext(deployment, "Work");
    const phone = await deviceSwitchedOn(deployment);

    await brief(deployment, work);
    reachable = false;
    await brief(deployment, work);
    deployment.advance(DAY);
    await wake(deployment, work);

    expect(received(phone)).toEqual([]);
    const runs = value(await deployment.context(work).call(hand, "list_runs", {})).items;
    expect(runs.map(({ ended }) => ended)).toContain("failed");
    expect(runs.map(({ ended }) => ended)).toContain("answered");
  });

  test("a Context with its switch off sends none, while another Context's still comes", async () => {
    scriptModel(answering("Something is due."));
    const deployment = newDeployment(BEFORE_THE_BRIEF);
    const work = await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");
    value(await deployment.context(work).call(hand, "set_notifications", { on: false }));
    const phone = await deviceSwitchedOn(deployment);

    deployment.advance(HOUR);
    await wake(deployment, work);
    await wake(deployment, home);

    expect(received(phone).map(({ notification }) => notification.title)).toEqual([
      "Home: your Brief is ready",
    ]);
  });

  test("a Device switched off or removed is sent none", async () => {
    scriptModel(answering("Something is due."));
    const deployment = newDeployment(BEFORE_THE_BRIEF);
    const work = await makeContext(deployment, "Work");
    const off = await deviceSwitchedOn(deployment);
    const removed = await deviceSwitchedOn(deployment);
    const [first, second] = value(await deployment.call(hand, "list_devices", {})).items;
    value(await deployment.call(hand, "set_device_notifications", { id: first?.id, on: false }));
    value(await deployment.call(hand, "remove_device", { id: second?.id }));

    await brief(deployment, work);

    expect([received(off), received(removed)]).toEqual([[], []]);
  });

  test("each new one replaces the last for that kind and Context on a Device: two Contexts give two", async () => {
    scriptModel((context) =>
      fauxAssistantMessage(/weekly Review/.test(lastWords(context)) ? "Stale." : "Due today."),
    );
    // Sunday, an hour before the Brief, with the Review at 17:00.
    const deployment = newDeployment("2026-11-15T06:00:00.000Z");
    const work = await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");
    const phone = await deviceSwitchedOn(deployment);

    deployment.advance(HOUR);
    await wake(deployment, work);
    await wake(deployment, home);
    deployment.advance(10 * HOUR);
    await wake(deployment, work);
    deployment.advance(14 * HOUR);
    await wake(deployment, work);

    const sent = received(phone).map(({ notification: { title, tag }, topic }) => ({
      title,
      tag,
      topic,
    }));
    expect(sent).toEqual([
      {
        title: "Work: your Brief is ready",
        tag: `brief:${work}`,
        topic: await topicOf(work, "brief"),
      },
      {
        title: "Home: your Brief is ready",
        tag: `brief:${home}`,
        topic: await topicOf(home, "brief"),
      },
      {
        title: "Work: your Review is ready",
        tag: `review:${work}`,
        topic: await topicOf(work, "review"),
      },
      {
        title: "Work: your Brief is ready",
        tag: `brief:${work}`,
        topic: await topicOf(work, "brief"),
      },
    ]);
    expect(new Set(sent.map(({ topic }) => topic)).size).toBe(3);
  });
});

describe("a Review's Notification", () => {
  test("a Review with nothing to raise leaves its one line and sends nothing", async () => {
    scriptModel(answering(NOTHING_TO_RAISE));
    const deployment = newDeployment("2026-11-15T16:00:00.000Z");
    const work = await makeContext(deployment, "Work");
    const phone = await deviceSwitchedOn(deployment);

    await brief(deployment, work);

    expect(received(phone)).toEqual([]);
  });
});

describe("a Device whose subscription is gone", () => {
  test("is switched off once the push service says so, and leaves the list", async () => {
    scriptModel(answering("Something is due."));
    const deployment = newDeployment(BEFORE_THE_BRIEF);
    const work = await makeContext(deployment, "Work");
    const kept = await deviceSwitchedOn(deployment);
    const given = await deviceSwitchedOn(deployment);
    const [listedKept] = value(await deployment.call(hand, "list_devices", {})).items;
    unsubscribe(given);

    await brief(deployment, work);

    expect(received(kept)).toHaveLength(1);
    expect(value(await deployment.call(hand, "list_devices", {})).items).toEqual([listedKept]);
  });
});

describe("a push service that fails", () => {
  test("costs only that Notification: the Device stays switched on for the next", async () => {
    scriptModel(answering("Something is due."));
    const deployment = newDeployment(BEFORE_THE_BRIEF);
    const work = await makeContext(deployment, "Work");
    const phone = await deviceSwitchedOn(deployment);
    const listed = value(await deployment.call(hand, "list_devices", {})).items;

    setPushFailing(true);
    await brief(deployment, work);
    setPushFailing(false);
    deployment.advance(DAY);
    await wake(deployment, work);

    expect(value(await deployment.call(hand, "list_devices", {})).items).toEqual(listed);
    expect(received(phone)).toHaveLength(1);
  });
});

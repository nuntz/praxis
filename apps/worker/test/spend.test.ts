import type { MessagesPage } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { answering, scriptModel } from "./model-fake.ts";
import { hand, newDeployment, value } from "./seam.ts";

// The spend cap (section 5.7, ADR 0017): one cap in money per calendar month for the whole
// Deployment, set by the person's hand. Each Context's object reports what its Runs spent to the
// Deployment object, which keeps the month's running total and answers whether a Run may start.

type Deployment = ReturnType<typeof newDeployment>;

/** A Context made by the hand in this Deployment, reached as the Worker reaches one. */
async function makeContext(deployment: Deployment, name = "Work") {
  const made = await deployment.call(hand, "create_context", {
    name,
    time_zone: "UTC",
    accent: "blue",
  });
  return deployment.context(value(made).record.id);
}

type Context = Awaited<ReturnType<typeof makeContext>>;

/** Send the person's Message and wait for its Run to end, for what the Run cost. */
async function runCosting(context: Context, words = "Hello"): Promise<number> {
  await context.callAny(hand, "send_message", { words });
  await context.runsEnded();
  const page = value(await context.callAny(hand, "list_messages", {})) as MessagesPage;
  const [answer] = page.items;
  if (answer?.from !== "agent" || answer.run.cost === null) throw new Error("No Run ended.");
  return answer.run.cost;
}

/**
 * A script whose every answer costs about `dollars`: the scripted model counts a token for every
 * four characters it writes, and an output token is priced at 10 US dollars a million.
 */
function answeringAtCost(dollars: number) {
  return answering("word ".repeat(Math.round((dollars / 10) * 1_000_000 * 0.8)));
}

describe("get_spend", () => {
  test("a new Deployment has a cap of 20 US dollars and has spent nothing this month", async () => {
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");

    const spend = value(await deployment.call(hand, "get_spend", {}));

    expect(spend).toEqual({ month: "2026-11", spent: 0, cap: 20, notice: null });
  });
});

describe("set_spend_cap", () => {
  test("sets the monthly cap, an Effect on the cap, and get_spend reads it back", async () => {
    const deployment = newDeployment();

    const set = value(await deployment.call(hand, "set_spend_cap", { cap: 35.5 }));

    expect(set).toEqual({
      record: { cap: 35.5 },
      effects: [
        {
          kind: "spend_cap",
          id: "spend_cap",
          what: "changed",
          summary: "35.50 US dollars a month",
          by: "call",
        },
      ],
      changed: true,
    });
    expect(value(await deployment.call(hand, "get_spend", {})).cap).toBe(35.5);
  });

  test("setting the cap it has changes nothing", async () => {
    const deployment = newDeployment();

    const set = value(await deployment.call(hand, "set_spend_cap", { cap: 20 }));

    expect(set).toEqual({ record: { cap: 20 }, effects: [], changed: false });
  });

  test("a cap of nothing, or not an amount, is invalid input", async () => {
    const deployment = newDeployment();

    for (const cap of [0, -5, "20"]) {
      const result = await deployment.call(hand, "set_spend_cap", { cap });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
  });
});

describe("get_spend counts what Runs spent", () => {
  test("a Run's cost, by its record, is in the month's spend once it ends", async () => {
    const deployment = newDeployment();
    const work = await makeContext(deployment);

    const cost = await runCosting(work);

    expect(cost).toBeGreaterThan(0);
    expect(value(await deployment.call(hand, "get_spend", {})).spent).toBeCloseTo(cost, 10);
  });

  test("the Runs of every Context count toward the one total", async () => {
    const deployment = newDeployment();
    const work = await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");

    const spent = (await runCosting(work)) + (await runCosting(home)) + (await runCosting(work));

    expect(value(await deployment.call(hand, "get_spend", {})).spent).toBeCloseTo(spent, 10);
  });

  test("a new calendar month starts from nothing, in UTC", async () => {
    const deployment = newDeployment("2026-11-30T23:00:00.000Z");
    const work = await makeContext(deployment);
    await runCosting(work);

    deployment.advance(2 * 60 * 60 * 1000);

    expect(value(await deployment.call(hand, "get_spend", {}))).toMatchObject({
      month: "2026-12",
      spent: 0,
    });
  });
});

describe("send_message at the cap", () => {
  test("starts no Run: the Message is refused with the cap in the way, kept nowhere, and get_spend says the cap is reached", async () => {
    scriptModel(answeringAtCost(0.05));
    const deployment = newDeployment();
    await deployment.call(hand, "set_spend_cap", { cap: 0.05 });
    const work = await makeContext(deployment);
    await runCosting(work, "Past the cap");

    const sent = await work.callAny(hand, "send_message", { words: "And again" });
    const page = value(await work.callAny(hand, "list_messages", {})) as MessagesPage;

    expect(sent).toMatchObject({
      ok: false,
      error: {
        code: "refused",
        in_the_way: [{ kind: "spend_cap", id: "spend_cap", summary: "0.05 US dollars a month" }],
      },
    });
    expect(page.items.filter((message) => message.from === "person")).toHaveLength(1);
    expect(value(await deployment.call(hand, "get_spend", {})).notice).toBe("cap_reached");
  });

  test("a Run going when the cap is reached finishes", async () => {
    scriptModel(answeringAtCost(0.05));
    const deployment = newDeployment();
    await deployment.call(hand, "set_spend_cap", { cap: 0.01 });
    const work = await makeContext(deployment);

    await work.callAny(hand, "send_message", { words: "Past the cap" });
    await work.runsEnded();

    const [answer] = (value(await work.callAny(hand, "list_messages", {})) as MessagesPage).items;
    expect(answer).toMatchObject({ from: "agent", run: { ended: "answered" } });
  });

  test("stops in every Context, since the cap is the Deployment's", async () => {
    scriptModel(answeringAtCost(0.05));
    const deployment = newDeployment();
    await deployment.call(hand, "set_spend_cap", { cap: 0.05 });
    await runCosting(await makeContext(deployment, "Work"));
    const home = await makeContext(deployment, "Home");

    const sent = await home.callAny(hand, "send_message", { words: "Hello" });

    expect(sent).toMatchObject({ ok: false, error: { code: "refused" } });
  });
});

describe("set_spend_cap past what was spent", () => {
  test("takes effect at once: a Run starts again", async () => {
    scriptModel(answeringAtCost(0.05));
    const deployment = newDeployment();
    await deployment.call(hand, "set_spend_cap", { cap: 0.05 });
    const work = await makeContext(deployment);
    await runCosting(work, "Past the cap");

    await deployment.call(hand, "set_spend_cap", { cap: 20 });
    const sent = await work.callAny(hand, "send_message", { words: "Raised" });
    await work.runsEnded();

    expect(sent).toMatchObject({ ok: true });
    const page = value(await work.callAny(hand, "list_messages", {})) as MessagesPage;
    expect(page.items[0]).toMatchObject({ from: "agent", run: { ended: "answered" } });
  });
});

describe("get_spend past 80% of the cap", () => {
  test("gives the warning that the cap is nearly reached, as a standing Notice", async () => {
    scriptModel(answeringAtCost(0.05));
    const deployment = newDeployment();
    const work = await makeContext(deployment);
    const cost = await runCosting(work);

    await deployment.call(hand, "set_spend_cap", { cap: Math.ceil((cost / 0.9) * 100) / 100 });

    expect(value(await deployment.call(hand, "get_spend", {})).notice).toBe("nearing_cap");
  });
});

describe("deleting a Context", () => {
  test("its spend stays in the month's count, and an Export gives it with no name attached", async () => {
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");
    scriptModel(answeringAtCost(0.5));
    const work = await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");
    const cost = await runCosting(work);
    await runCosting(home);
    const before = value(await deployment.call(hand, "get_spend", {}));
    const workId = value(await deployment.call(hand, "list_contexts", {})).items[0]?.id as string;
    value(await deployment.call(hand, "retire_context", { id: workId }));

    value(await deployment.call(hand, "delete_context", { id: workId, name: "Work" }));

    expect(value(await deployment.call(hand, "get_spend", {}))).toEqual(before);
    const exported = value(await deployment.call(hand, "make_export", {}));
    const file = exported.files[0]?.content as { deleted_contexts_spend: unknown };
    expect(file.deleted_contexts_spend).toEqual([{ month: "2026-11", dollars: cost }]);
    expect(JSON.stringify(file)).not.toContain("Work");
  });
});

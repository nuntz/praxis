import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import {
  answering,
  answeringAtCost,
  calling,
  failing,
  heldAnswer,
  scriptModel,
  UNAVAILABLE,
} from "./model-fake.ts";
import { contextIn, contextWithItsDeployment, DAY, hand, newContext, value } from "./seam.ts";

// What is kept of what the Agent did (section 5.8, ADR 0010): a Run record holds no words, and is
// read by the person's hand alone with list_runs and get_run.

describe("list_runs", () => {
  test("a Run's record says what started it, how it ended, what it cost and what it changed, in none of its words", async () => {
    const words = marked("Call the plumber");
    scriptModel(calling([() => ["record_entry", { words }]], marked("Recorded it")));
    const context = newContext();

    await context.callAny(hand, "send_message", { words: marked("Note the plumber") });
    await context.runsEnded();

    const [entry] = value(await context.call(hand, "list_entries", {})).items;
    const page = value(await context.call(hand, "list_runs", {}));
    expect(page.next_cursor).toBeNull();
    expect(page.items).toEqual([
      {
        id: expect.any(String),
        started_by: "message",
        at: "2026-11-15T09:00:00.000Z",
        model: expect.any(String),
        tokens: {
          input: expect.any(Number),
          output: expect.any(Number),
          cache_read: expect.any(Number),
          cache_write: expect.any(Number),
        },
        cost: expect.any(Number),
        ended: "answered",
        failure: null,
        changes: [
          {
            // The Agent's calls arrive by the object's own clock, moving on from the Message's time.
            at: expect.stringMatching(/^2026-11-15T09:00/),
            tool: "record_entry",
            changed: [{ kind: "entry", id: entry?.id, what: "made", by: "call" }],
          },
        ],
        changes_gone: 0,
      },
    ]);
    const [run] = page.items;
    expect(value(await context.call(hand, "get_run", { id: run?.id }))).toEqual(run);
  });

  test("a change older than the change log keeps is only counted, and the Run keeps its record", async () => {
    scriptModel(calling([() => ["record_entry", { words: marked("Long ago") }]]));
    const context = newContext();
    await context.callAny(hand, "send_message", { words: marked("Note it") });
    await context.runsEnded();

    context.advance(91 * DAY);
    await context.fireAlarm();

    // The alarm 91 days on starts a Brief and a Review too, which change nothing.
    const runs = value(await context.call(hand, "list_runs", {})).items;
    const asked = runs.find(({ started_by }) => started_by === "message");
    expect(asked).toMatchObject({ ended: "answered", changes: [], changes_gone: 1 });
  });

  test("a Run not started at the cap leaves a record, newest first, that spent nothing", async () => {
    scriptModel(answeringAtCost(0.05));
    const { deployment, context } = await contextWithItsDeployment();
    await deployment.call(hand, "set_spend_cap", { cap: 0.01 });
    await context.callAny(hand, "send_message", { words: "Past the cap" });
    await context.runsEnded();
    deployment.advance(1000);

    await context.callAny(hand, "send_message", { words: "And again" });

    const runs = value(await context.call(hand, "list_runs", {})).items;
    expect(runs.map(({ ended, cost }) => ({ ended, spent: cost > 0 }))).toEqual([
      { ended: "cap_reached", spent: false },
      { ended: "answered", spent: true },
    ]);
  });
});

describe("get_run", () => {
  test("of a Run there never was is not found", async () => {
    const result = await newContext().call(hand, "get_run", { id: "no-such-run" });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("save_run_transcript", () => {
  test("gives a file of one Run: the prompt, its Message as the model was shown it, its calls with their results and what it said", async () => {
    const [asked, words, answer] = [
      marked("Note the plumber"),
      marked("Call the plumber"),
      marked("Recorded it"),
    ];
    scriptModel(calling([() => ["record_entry", { words }]], answer));
    const { deployment, id, context } = await contextWithItsDeployment();
    await context.callAny(hand, "send_message", { words: asked });
    await context.runsEnded();
    const later = marked("And the electrician");
    await context.callAny(hand, "send_message", { words: later });
    await context.runsEnded();
    const [, run] = value(await context.call(hand, "list_runs", {})).items;

    const transcript = value(
      await deployment.call(hand, "save_run_transcript", { context_id: id, run_id: run?.id }),
    );

    expect(transcript).toMatchObject({
      kind: "run_transcript",
      made_at: "2026-11-15T09:00:00.000Z",
      context: { id, name: "Work" },
      run,
      prompt: expect.stringContaining("You are the Agent of Praxis"),
    });
    expect(transcript.tools).toContain("record_entry");
    // The runtime keeps the prompt as a message of its own whenever it sets it.
    const said = transcript.messages.filter(({ role }) => role !== "system");
    expect(said).toEqual([
      { role: "user", at: expect.any(String), text: expect.stringContaining(asked) },
      {
        role: "assistant",
        at: expect.any(String),
        text: "",
        calls: [{ id: expect.any(String), tool: "record_entry", input: { words } }],
        stop: "toolUse",
        error: null,
      },
      {
        role: "tool_result",
        at: expect.any(String),
        call: expect.any(String),
        tool: "record_entry",
        text: expect.stringContaining(words),
        error: false,
      },
      {
        role: "assistant",
        at: expect.any(String),
        text: answer,
        calls: [],
        stop: "stop",
        error: null,
      },
    ]);
    // One Run, and none of the next.
    expect(JSON.stringify(transcript)).not.toContain(later);
  });

  test("a Brief holds the clock's instructions in place of a Message, and was offered reads only", async () => {
    const said = marked("Two Tasks are due today");
    scriptModel(answering(said));
    // A Monday, an hour before the Brief's 07:00.
    const { deployment, id, context } = await contextWithItsDeployment("2026-11-16T06:00:00.000Z");
    deployment.advance(60 * 60 * 1000);
    await context.fireAlarm();
    await context.runsEnded();
    const [brief] = value(await context.call(hand, "list_runs", {})).items;
    expect(brief).toMatchObject({ started_by: "brief", ended: "answered" });

    const transcript = value(
      await deployment.call(hand, "save_run_transcript", { context_id: id, run_id: brief?.id }),
    );

    expect(transcript.tools).toContain("view_attention");
    expect(transcript.tools).not.toContain("record_entry");
    const shown = transcript.messages.filter(({ role }) => role !== "system");
    expect(shown.map(({ role }) => role)).toEqual(["user", "assistant"]);
    expect(shown[0]).toMatchObject({ text: expect.stringContaining("this Context's Brief") });
    expect(shown[1]).toMatchObject({ text: said, stop: "stop" });
  });

  test("a Run tried again holds its own tries, after the Message it answers", async () => {
    // A Context keeps the model it was first asked with: one script, unreachable until mended.
    const answer = marked("Here now");
    let reachable = false;
    const [unreachable, answers] = [failing(UNAVAILABLE), answering(answer)];
    scriptModel((...args) => (reachable ? answers(...args) : unreachable(...args)));
    const { deployment, id, context } = await contextWithItsDeployment();
    const asked = marked("Hello?");
    await context.callAny(hand, "send_message", { words: asked });
    await context.runsEnded();
    const [failed] = value(await context.call(hand, "list_runs", {})).items;
    reachable = true;
    value(await context.callAny(hand, "retry_run", { run: failed?.id }));
    await context.runsEnded();
    const [retried] = value(await context.call(hand, "list_runs", {})).items;

    const saved = async (run: string | undefined) =>
      value(
        await deployment.call(hand, "save_run_transcript", { context_id: id, run_id: run }),
      ).messages.filter(({ role }) => role !== "system");

    const tries = await saved(retried?.id);
    expect(tries.map(({ role }) => role)).toEqual(["user", "assistant"]);
    expect(tries[0]).toMatchObject({ text: expect.stringContaining(asked) });
    expect(tries[1]).toMatchObject({ text: answer, stop: "stop" });
    const first = await saved(failed?.id);
    expect(first[0]).toMatchObject({ role: "user", text: expect.stringContaining(asked) });
    expect(
      first.slice(1).every((message) => message.role === "assistant" && message.stop === "error"),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toContain(answer);
  });

  test("is refused for a Run whose Conversation was cleared, a Run still going and one never started", async () => {
    const { script, answer } = heldAnswer();
    scriptModel(script);
    const { deployment, id, context } = await contextWithItsDeployment();
    const save = (run: string | undefined) =>
      deployment.call(hand, "save_run_transcript", { context_id: id, run_id: run });
    await context.callAny(hand, "send_message", { words: marked("Hello") });
    const [going] = value(await context.call(hand, "list_runs", {})).items;
    expect(await save(going?.id)).toMatchObject({ ok: false, error: { code: "refused" } });
    answer();
    await context.runsEnded();

    value(await context.call(hand, "clear_conversation", {}));
    const cleared = await save(going?.id);
    expect(cleared).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(cleared.ok ? "" : cleared.error.message).toMatch(/cleared/);

    await deployment.call(hand, "set_spend_cap", { cap: 0.000001 });
    await context.callAny(hand, "send_message", { words: "Past the cap" });
    await context.runsEnded();
    deployment.advance(1000);
    await context.callAny(hand, "send_message", { words: "And again" });
    const [never] = value(await context.call(hand, "list_runs", {})).items;
    expect(never).toMatchObject({ ended: "cap_reached" });
    expect(await save(never?.id)).toMatchObject({ ok: false, error: { code: "refused" } });
  });

  test("is not found for a Run there never was, or in a Context retired or never made", async () => {
    const { deployment, id } = await contextWithItsDeployment();
    const save = (context: string) =>
      deployment.call(hand, "save_run_transcript", { context_id: context, run_id: "no-such-run" });

    expect(await save(id)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await save("no-such-context")).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    const { id: other } = await contextIn(deployment, "Old", { accent: "teal" });
    value(await deployment.call(hand, "retire_context", { id: other }));
    expect(await save(other)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

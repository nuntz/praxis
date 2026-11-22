import {
  type MessagesPage,
  type SearchHit,
  type SearchResults,
  summarizeWords,
} from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { seeded } from "../../../packages/domain/test/seeded.ts";
import { marked } from "./markers.ts";
import {
  embeddingHeld,
  heldEmbeddings,
  holdEmbedding,
  meanAlike,
  setMeaningFailing,
  setMeaningPresent,
} from "./meaning-fake.ts";
import { calling, type Script, scriptModel } from "./model-fake.ts";
import {
  agent,
  atOnce,
  contextIn,
  DAY,
  everyCaller,
  hand,
  newContext,
  newDeployment,
  value,
} from "./seam.ts";

// Search by meaning (section 9.4, ADR 0023): the Entries whose words mean what was searched for,
// in the one ranked list `search` gives every caller, from a meaning index outside the Context's
// object that lags its writes a little. The index is the fake (test/meaning-fake.ts), which says
// two texts are alike as far as they share words a test has said mean alike.

type Context = ReturnType<typeof newContext>;

/** A Context as reached in a Deployment of the test's or of its own, for calling its tools. */
type Called = Pick<Context, "call" | "callAny">;

/** What a search answered, each hit as its kind and id, best first, and why meaning was left out. */
async function searched(context: Context, input: Record<string, unknown>) {
  const results: SearchResults = value(await context.call(hand, "search", input));
  return {
    found: results.items.map(({ kind, id }) => `${kind}:${id}`),
    words_only: results.words_only,
  };
}

/** An Entry recorded by the person, with these words. */
async function anEntry(context: Called, words: string, input: Record<string, unknown> = {}) {
  return atOnce(await context.call(hand, "record_entry", { words, ...input })).record;
}

describe("search by meaning", () => {
  test("finds an Entry by what it means shortly after it is saved, though it shares no word with the search, the same for every caller", async () => {
    meanAlike("dentist", "molar", "teeth");
    const context = newContext("2026-11-15T09:00:00.000Z");
    const words = marked(
      "Booked the molar check for next week at last, the one I have kept putting off since the summer",
    );
    const entry = await anEntry(context, words);
    await anEntry(context, marked("Weeded the garden"));
    await context.meaningSettled();

    const hit: SearchHit = {
      kind: "entry",
      id: entry.id,
      summary: summarizeWords(words),
      at: "2026-11-15T09:00:00.000Z",
      author: { kind: "person" },
      // Its first words, as nothing in it matched the words given.
      excerpt: {
        text: `${words.split(" ").slice(0, 16).join(" ")}…`,
        matches: [],
      },
    };
    for (const caller of everyCaller) {
      expect(value(await context.call(caller, "search", { words: "dentist" }))).toEqual({
        items: [hit],
        next_cursor: null,
        words_only: null,
      });
    }
  });

  test("ranks words and meaning in one list: an Entry found by both comes first", async () => {
    meanAlike("dentist", "molar");
    const context = newContext();
    const meant = await anEntry(context, marked("The molar aches again"));
    const both = await anEntry(context, marked("Dentist about the molar on Friday"));
    const task = (
      await anEntry(context, marked("Errands"), { tasks: [{ title: "Ring the dentist" }] })
    ).tasks[0];
    await context.meaningSettled();

    const { found } = await searched(context, { words: "dentist" });

    expect(found[0]).toBe(`entry:${both.id}`);
    expect(found.slice(1).sort()).toEqual([`entry:${meant.id}`, `task:${task?.id}`].sort());
  });

  test("applies to Entries only: a Task, a Project or a Person is found by its words alone", async () => {
    meanAlike("dentist", "molar");
    const context = newContext();
    await anEntry(context, marked("Errands"), {
      tasks: [{ title: marked("Book the molar check") }],
    });
    atOnce(await context.call(hand, "create_project", { name: marked("Molar") }));
    atOnce(await context.call(hand, "create_person", { name: marked("Molar") }));
    await context.meaningSettled();

    expect(await searched(context, { words: "dentist" })).toEqual({ found: [], words_only: null });
  });

  test("narrows what it finds by meaning as it narrows what it finds by words", async () => {
    meanAlike("dentist", "molar");
    const context = newContext("2026-11-15T09:00:00.000Z");
    const early = await anEntry(context, marked("The molar aches"));
    context.advance(2 * DAY);
    const project = value(await context.call(hand, "create_project", { name: "Health" })).record;
    const late = await anEntry(context, marked("The molar again"), {
      links: [{ to: { kind: "project", id: project.id } }],
    });
    atOnce(await context.call(agent, "record_entry", { words: marked("A molar, said the Agent") }));
    await context.meaningSettled();

    expect((await searched(context, { words: "dentist", to: "2026-11-15" })).found).toEqual([
      `entry:${early.id}`,
    ]);
    expect((await searched(context, { words: "dentist", project_id: project.id })).found).toEqual([
      `entry:${late.id}`,
    ]);
    expect(
      (await searched(context, { words: "dentist", author: { kind: "person" } })).found.sort(),
    ).toEqual([`entry:${early.id}`, `entry:${late.id}`].sort());
  });

  test("follows an Entry's words as they change", async () => {
    meanAlike("dentist", "molar");
    const context = newContext();
    const entry = await anEntry(context, marked("The molar aches"));
    await context.meaningSettled();

    atOnce(
      await context.call(hand, "edit_entry", {
        id: entry.id,
        words: marked("The garden needs weeding"),
        version: entry.version,
      }),
    );
    await context.meaningSettled();

    expect((await searched(context, { words: "dentist" })).found).toEqual([]);
  });

  test("embeds an Entry's words again when they change while its earlier words are being embedded", async () => {
    meanAlike("dentist", "molar");
    const context = newContext();
    const release = holdEmbedding();
    const entry = await anEntry(context, marked("The molar aches"));

    // The words as saved are being embedded when they change.
    atOnce(
      await context.call(hand, "edit_entry", {
        id: entry.id,
        words: marked("The garden needs weeding"),
        version: entry.version,
      }),
    );
    release();
    await context.meaningSettled();

    expect((await searched(context, { words: "dentist" })).found).toEqual([]);
  });

  test("never finds what is in the Trash: a deleted Entry leaves at once and comes back on restore, and one removed for good leaves the index", async () => {
    meanAlike("dentist", "molar");
    const deployment = newDeployment();
    const { id, context } = await contextIn(deployment, "Personal");
    const entry = atOnce(
      await context.call(hand, "record_entry", { words: marked("The molar aches") }),
    ).record;
    await context.meaningSettled();
    const search = async () =>
      value(await context.call(hand, "search", { words: "dentist" })).items.map(({ id }) => id);

    atOnce(await context.call(hand, "delete_entry", { id: entry.id }));
    expect(await search()).toEqual([]);
    atOnce(await context.call(hand, "restore", { id: entry.id }));
    expect(await search()).toEqual([entry.id]);

    atOnce(await context.call(hand, "delete_entry", { id: entry.id }));
    atOnce(await context.call(hand, "remove_for_good", { id: entry.id }));
    await context.meaningSettled();
    expect([...heldEmbeddings(id).keys()]).toEqual([]);
  });

  test("keeps each Context's part of the index to itself", async () => {
    meanAlike("dentist", "molar");
    const one = newContext();
    const other = newContext();
    await anEntry(one, marked("The molar aches"));
    await one.meaningSettled();

    expect(await searched(other, { words: "dentist" })).toEqual({ found: [], words_only: null });
  });
});

describe("search from words alone, and saying so", () => {
  test("in a Deployment with no meaning index: missing", async () => {
    setMeaningPresent(false);
    const context = newContext();
    const entry = await anEntry(context, marked("A dentist on Friday"));

    expect(await searched(context, { words: "dentist" })).toEqual({
      found: [`entry:${entry.id}`],
      words_only: "missing",
    });
  });

  test("while the index does not answer: unreachable, and it catches up once it does", async () => {
    meanAlike("dentist", "molar");
    const context = newContext();
    setMeaningFailing(true);
    const entry = await anEntry(context, marked("The molar aches"));
    await context.meaningSettled();

    expect(await searched(context, { words: "dentist" })).toEqual({
      found: [],
      words_only: "unreachable",
    });

    setMeaningFailing(false);
    // A search takes up the queue the failure left, as a write or the alarm does.
    await searched(context, { words: "anything" });
    await context.meaningSettled();
    expect(await searched(context, { words: "dentist" })).toEqual({
      found: [`entry:${entry.id}`],
      words_only: null,
    });
  });

  test("at the cap: cap_reached, embedding stops, and it catches up once the cap is raised", async () => {
    meanAlike("dentist", "molar");
    const deployment = newDeployment();
    const { context } = await contextIn(deployment, "Personal");
    // A cap so small the first embedding reaches it.
    value(await deployment.call(hand, "set_spend_cap", { cap: 1e-9 }));
    const first = atOnce(
      await context.call(hand, "record_entry", { words: marked("The molar aches") }),
    ).record;
    await context.meaningSettled();
    const second = atOnce(
      await context.call(hand, "record_entry", { words: marked("Another molar") }),
    ).record;
    await context.meaningSettled();

    const capped = value(await context.call(hand, "search", { words: "dentist" }));
    expect(capped).toEqual({ items: [], next_cursor: null, words_only: "cap_reached" });
    expect(value(await deployment.call(hand, "get_spend", {})).notice).toBe("cap_reached");

    value(await deployment.call(hand, "set_spend_cap", { cap: 20 }));
    await context.call(hand, "search", { words: "anything" });
    await context.meaningSettled();
    const raised = value(await context.call(hand, "search", { words: "dentist" }));
    expect(raised.words_only).toBeNull();
    expect(raised.items.map(({ id }) => id).sort()).toEqual([first.id, second.id].sort());
  });
});

/**
 * A tool result's text as the JSON it holds, or as it is when it holds none: what the runtime
 * hands back for a tool that threw.
 */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * A script whose every Run searches for these words, once `held` settles, then answers: `handed`
 * holds each search's tool result as the model was handed it, parsed.
 */
function searching(words: string, held: Promise<void> = Promise.resolve()) {
  const handed: unknown[] = [];
  const script = calling([
    () => ["search", { words }],
    ([result]) => {
      handed.push(parsed(result ?? ""));
      return null;
    },
  ]);
  return {
    handed,
    script: (async (...args) => {
      await held;
      return script(...args);
    }) satisfies Script,
  };
}

/** An Entry recorded by the person about the boiler. */
function boiler(context: Called) {
  return anEntry(context, marked("The boiler is making a noise"));
}

/** The calls of each of the Agent's Messages in the Conversation, as their tool and result. */
async function callsMade(context: Called) {
  const page = value(await context.callAny(hand, "list_messages", {})) as MessagesPage;
  return page.items.flatMap((message) =>
    message.from === "agent" ? [message.run.calls.map(({ tool, result }) => [tool, result])] : [],
  );
}

describe("search in a Run, through the Agent's runtime", () => {
  test("hands the Agent the search's hits, by words and by meaning, as the hand is given them", async () => {
    meanAlike("boiler", "heating");
    const { handed, script } = searching("boiler");
    scriptModel(script);
    const context = newContext();
    await anEntry(context, marked("The boiler is making a noise"));
    await anEntry(context, marked("The heating is off again"));
    await anEntry(context, marked("Weeded the garden"));
    await context.meaningSettled();

    await context.callAny(hand, "send_message", { words: marked("What about the boiler?") });
    await context.runsEnded();

    const asHand = await context.call(hand, "search", { words: "boiler" });
    expect(value(asHand).items).toHaveLength(2);
    expect(handed).toEqual([asHand]);
    expect(await callsMade(context)).toEqual([[["search", "ok"]]]);
  });

  test("hands the clock the search's hits in a Brief", async () => {
    const { handed, script } = searching("boiler");
    scriptModel(script);
    // A Monday, a minute before the Brief's 07:00.
    const context = newContext("2026-11-16T06:59:00.000Z");
    meanAlike("boiler", "heating");
    await boiler(context);
    await anEntry(context, marked("The heating is off again"));
    await context.meaningSettled();
    context.advance(60_000);

    await context.fireAlarm();
    await context.runsEnded();

    const asHand = await context.call(hand, "search", { words: "boiler" });
    expect(value(asHand).items).toHaveLength(2);
    expect(handed).toEqual([asHand]);
    expect(await callsMade(context)).toEqual([[["search", "ok"]]]);
  });

  test("leaves out of the Run's changes what another caller wrote while its search waited", async () => {
    const { handed, script } = searching("boiler");
    scriptModel(script);
    const context = newContext();
    await boiler(context);
    await context.meaningSettled();
    const release = holdEmbedding();
    const waiting = embeddingHeld();

    await context.callAny(hand, "send_message", { words: marked("What about the boiler?") });
    await waiting;
    await anEntry(context, marked("Weeded the garden"));
    release();
    await context.runsEnded();

    expect(handed).toEqual([{ ok: true, value: expect.objectContaining({ words_only: null }) }]);
    const runs = value(await context.call(hand, "list_runs", {})).items;
    expect(runs).toMatchObject([{ started_by: "message", changes: [] }]);
  });

  test.each([
    {
      why: "missing",
      setUp: async () => {
        setMeaningPresent(false);
        const context = newContext();
        return { context, entry: await boiler(context), reached: async () => {} };
      },
    },
    {
      why: "unreachable",
      setUp: async () => {
        const context = newContext();
        setMeaningFailing(true);
        const entry = await boiler(context);
        await context.meaningSettled();
        return { context, entry, reached: async () => {} };
      },
    },
    {
      why: "stale",
      setUp: async () => {
        const context = newContext();
        const entry = await boiler(context);
        await context.meaningSettled();
        // The fake answers at once, so the rebuild is held up for the Run to find it under way.
        setMeaningFailing(true);
        value(await context.call(hand, "rebuild_search_index", {}));
        await context.meaningSettled();
        return { context, entry, reached: async () => {} };
      },
    },
    {
      why: "cap_reached",
      setUp: async () => {
        const deployment = newDeployment();
        const { context } = await contextIn(deployment, "Personal");
        const entry = await boiler(context);
        await context.meaningSettled();
        // Reached once the Run has started: the Entry's embedding has spent more than this.
        const reached = async () => {
          value(await deployment.call(hand, "set_spend_cap", { cap: 1e-12 }));
        };
        return { context, entry, reached };
      },
    },
  ] as const)(
    "answers from words when the meaning index is $why, and says so",
    async ({ why, setUp }) => {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { handed, script } = searching("boiler", held);
      scriptModel(script);
      const { context, entry, reached } = await setUp();

      await context.callAny(hand, "send_message", { words: marked("What about the boiler?") });
      await reached();
      release();
      await context.runsEnded();

      expect(handed).toEqual([
        {
          ok: true,
          value: {
            items: [expect.objectContaining({ id: entry.id })],
            next_cursor: null,
            words_only: why,
          },
        },
      ]);
      expect(await callsMade(context)).toEqual([[["search", "ok"]]]);
    },
  );
});

describe("rebuild_search_index", () => {
  test("embeds every Entry afresh: search answers from words, saying the index is stale, until it is done", async () => {
    meanAlike("dentist", "molar");
    const context = newContext();
    const entry = await anEntry(context, marked("The molar aches"));
    await anEntry(context, marked("Weeded the garden"));
    await context.meaningSettled();

    // The fake answers at once, so the rebuild is held up for the test to see it under way.
    setMeaningFailing(true);
    const rebuilt = await context.call(hand, "rebuild_search_index", {});
    expect(value(rebuilt)).toEqual({ meaning: "building", entries_to_embed: 2 });
    await context.meaningSettled();
    expect(await searched(context, { words: "molar" })).toEqual({
      found: [`entry:${entry.id}`],
      words_only: "stale",
    });

    setMeaningFailing(false);
    await searched(context, { words: "anything" });
    await context.meaningSettled();
    expect(await searched(context, { words: "dentist" })).toEqual({
      found: [`entry:${entry.id}`],
      words_only: null,
    });
  });

  test("a repeated key answers as the first call did", async () => {
    const context = newContext();
    await anEntry(context, marked("Weeded the garden"));
    const first = await context.call(hand, "rebuild_search_index", { key: "rebuild-1" });
    await context.meaningSettled();
    const again = await context.call(hand, "rebuild_search_index", { key: "rebuild-1" });

    expect(again).toEqual(first);
  });

  test("is refused in a Deployment with no meaning index, as there is nothing to rebuild", async () => {
    setMeaningPresent(false);
    const context = newContext();

    const result = await context.call(hand, "rebuild_search_index", {});

    expect(result).toMatchObject({ ok: false, error: { code: "refused" } });
  });
});

describe("embedding's spend", () => {
  test("counts toward the month's spend, with the Run records", async () => {
    const deployment = newDeployment();
    const { context } = await contextIn(deployment, "Personal");
    expect(value(await deployment.call(hand, "get_spend", {})).spent).toBe(0);

    atOnce(await context.call(hand, "record_entry", { words: marked("Weeded the garden") }));
    await context.meaningSettled();

    expect(value(await deployment.call(hand, "get_spend", {})).spent).toBeGreaterThan(0);
  });
});

describe("search by meaning over deletes, restores and edits undone", () => {
  test("over orderings drawn from a seeded source, with the index catching up or not between steps, undoing every step finds by meaning what was found before", async () => {
    meanAlike("dentist", "molar");
    const draw = seeded(58);
    const alike = ["The molar aches", "A molar again"];
    const unlike = ["Weeded the garden", "Painted the fence"];
    for (let run = 0; run < 8; run++) {
      const context = newContext();
      const entries = [];
      for (const words of [...alike, ...unlike])
        entries.push(await anEntry(context, marked(words)));
      await context.meaningSettled();
      const meant = async () => (await searched(context, { words: "dentist" })).found.sort();
      const before = await meant();
      expect(before).toHaveLength(alike.length);

      // Each step deletes, restores or edits an Entry drawn at random, its words to ones meaning
      // the other thing, and the meaning index catches up after some steps and not others.
      const undo: (() => Promise<unknown>)[] = [];
      const trashed = new Set<string>();
      for (let step = 0; step < 10; step++) {
        const entry = entries[Math.floor(draw() * entries.length)] as (typeof entries)[number];
        const pick = draw();
        if (trashed.has(entry.id)) {
          atOnce(await context.call(hand, "restore", { id: entry.id }));
          trashed.delete(entry.id);
          undo.push(async () => {
            atOnce(await context.call(hand, "delete_entry", { id: entry.id }));
            trashed.add(entry.id);
          });
        } else if (pick < 0.5) {
          atOnce(await context.call(hand, "delete_entry", { id: entry.id }));
          trashed.add(entry.id);
          undo.push(async () => {
            atOnce(await context.call(hand, "restore", { id: entry.id }));
            trashed.delete(entry.id);
          });
        } else {
          const read = value(await context.call(hand, "get_entry", { id: entry.id }));
          const other = marked(
            alike.some((words) => read.words.startsWith(words))
              ? "Mowed the lawn"
              : "Another molar",
          );
          atOnce(
            await context.call(hand, "edit_entry", {
              id: entry.id,
              words: other,
              version: read.version,
            }),
          );
          undo.push(async () => {
            const now = value(await context.call(hand, "get_entry", { id: entry.id }));
            atOnce(
              await context.call(hand, "edit_entry", {
                id: entry.id,
                words: read.words,
                version: now.version,
              }),
            );
          });
        }
        if (draw() < 0.5) await context.meaningSettled();
      }
      for (const step of undo.toReversed()) {
        await step();
        if (draw() < 0.5) await context.meaningSettled();
      }
      await context.meaningSettled();

      expect(await meant(), `run ${run} of seed 58`).toEqual(before);
    }
  });
});

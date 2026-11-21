import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { LiveMessage, MessagesPage, PersonMessage } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { HEARD } from "../src/agent.ts";
import { marked } from "./markers.ts";
import { answering, calling, lastWords, noModel, scriptModel, textOf } from "./model-fake.ts";
import { hand, newContext, newDeployment, value } from "./seam.ts";

describe("send_message starts a Run", () => {
  test("the person's Message is added and the Agent's answer is read back after it", async () => {
    scriptModel(answering(marked("Hello")));
    const context = newContext();

    const sent = value(
      await context.callAny(hand, "send_message", { words: marked("Hi there") }),
    ) as { message: PersonMessage };
    await context.runsEnded();
    const page = value(await context.callAny(hand, "list_messages", {})) as MessagesPage;

    expect(page.agent).toBe("available");
    expect(page.items.map((message) => message.from)).toEqual(["agent", "person"]);
    expect(page.items[1]).toEqual(sent.message);
    expect(page.items[0]).toMatchObject({ from: "agent", run: { ended: "answered", calls: [] } });
  });
});

describe("send_message with a key", () => {
  test("sent again with the same key, it returns the first Message and starts no second Run", async () => {
    const context = newContext();
    const input = { words: marked("Only once"), key: "send-1" };

    const first = await context.callAny(hand, "send_message", input);
    const again = await context.callAny(hand, "send_message", input);
    await context.runsEnded();

    expect(again).toEqual(first);
    const page = value(await context.callAny(hand, "list_messages", {})) as MessagesPage;
    expect(page.items.map((message) => message.from)).toEqual(["agent", "person"]);
  });
});

describe("send_message: the Agent acts at once", () => {
  test("an Entry it records is in the Journal, came through the Conversation, and folds under its Message", async () => {
    const words = marked("Call the plumber");
    scriptModel(calling([() => ["record_entry", { words }]]));
    const context = newContext();

    await context.callAny(hand, "send_message", {
      words: marked("Note that I must call the plumber"),
    });
    await context.runsEnded();

    const [entry] = value(await context.call(hand, "list_entries", {})).items;
    expect(entry).toMatchObject({ words, author: { kind: "agent" }, through_conversation: true });
    const changes = value(await context.call(hand, "list_changes", {})).items;
    expect(changes).toMatchObject([{ caller: { kind: "agent" }, tool: "record_entry" }]);
    const [answer] = (value(await context.callAny(hand, "list_messages", {})) as MessagesPage)
      .items;
    expect(answer).toMatchObject({
      from: "agent",
      run: {
        ended: "answered",
        calls: [
          {
            tool: "record_entry",
            result: "ok",
            effects: [{ kind: "entry", id: entry?.id, what: "made" }],
          },
        ],
      },
    });
  });

  test("an Entry of the person's words, filler and punctuation aside, has the person as its Author", async () => {
    const said = marked("Um, so I need to call the plumber, like, about the boiler on Friday");
    // The words the Agent keeps: the same words in the same order, some dropped, none added.
    const kept = said.replace("Um, so I", "I").replace(", like,", "").replace("Friday", "Friday.");
    scriptModel(calling([() => ["record_entry", { words: kept }]]));
    const context = newContext();

    await context.callAny(hand, "send_message", { words: said });
    await context.runsEnded();

    const [entry] = value(await context.call(hand, "list_entries", {})).items;
    expect(entry).toMatchObject({
      words: kept,
      author: { kind: "person" },
      through_conversation: true,
    });
  });

  test("an Entry the Agent composed, with a word the person never said, is the Agent's", async () => {
    const said = marked("Note that the boiler is broken");
    scriptModel(calling([() => ["record_entry", { words: `${said} again` }]]));
    const context = newContext();

    await context.callAny(hand, "send_message", { words: said });
    await context.runsEnded();

    const [entry] = value(await context.call(hand, "list_entries", {})).items;
    expect(entry?.author).toEqual({ kind: "agent" });
  });

  test("the person's words in another order are the Agent's: it rewrote them", async () => {
    const marker = marked("").trim();
    scriptModel(calling([() => ["record_entry", { words: `${marker} broken boiler the` }]]));
    const context = newContext();

    await context.callAny(hand, "send_message", { words: `${marker} the boiler broken` });
    await context.runsEnded();

    const [entry] = value(await context.call(hand, "list_entries", {})).items;
    expect(entry?.author).toEqual({ kind: "agent" });
  });

  test("the Agent's change to an Entry it recorded of the person's words is held for their tap", async () => {
    const said = marked("Pay the gas bill");
    let recorded: { id: string; version: number } | undefined;
    scriptModel(
      calling([
        () => ["record_entry", { words: said }],
        ([made = ""]) => {
          recorded = (JSON.parse(made) as { value: { record: { id: string; version: number } } })
            .value.record;
          return ["edit_entry", { id: recorded.id, version: recorded.version, words: "Paid" }];
        },
      ]),
    );
    const context = newContext();

    await context.callAny(hand, "send_message", { words: said });
    await context.runsEnded();

    const entry = value(await context.call(hand, "get_entry", { id: recorded?.id ?? "" }));
    expect(entry).toMatchObject({ words: said, author: { kind: "person" } });
    expect(value(await context.call(hand, "list_held_changes", {})).items).toHaveLength(1);
  });

  test("a call the Agent is not offered is refused, and changes nothing", async () => {
    scriptModel(calling([() => ["set_time_zone", { time_zone: "Europe/Paris" }]]));
    const context = newContext();

    await context.callAny(hand, "send_message", { words: "Move me to Paris time" });
    await context.runsEnded();

    expect(value(await context.call(hand, "get_settings", {})).time_zone).toBe("UTC");
    const [answer] = (value(await context.callAny(hand, "list_messages", {})) as MessagesPage)
      .items;
    expect(answer).toMatchObject({
      from: "agent",
      run: { calls: [{ tool: "set_time_zone", result: "not_offered", effects: [] }] },
    });
  });
});

describe("send_message: what the Agent is told at the start of a Run", () => {
  test("today's date in the Context, its name, and the other shown Contexts' names, nothing more", async () => {
    const seen: string[] = [];
    scriptModel((context) => {
      seen.push(textOf(context.messages.findLast((message) => message.role === "user")));
      return fauxAssistantMessage("Noted.");
    });
    const deployment = newDeployment("2026-11-15T23:30:00.000Z");
    const made = async (name: string, time_zone: string) =>
      value(await deployment.call(hand, "create_context", { name, time_zone, accent: "blue" }))
        .record.id;
    const work = await made("Work", "Pacific/Auckland");
    await made("Home", "UTC");
    const retired = await made("Old job", "UTC");
    await deployment.call(hand, "retire_context", { id: retired });
    const context = deployment.context(work);

    await context.callAny(hand, "send_message", { words: "What is on today?" });
    await context.runsEnded();

    expect(seen).toHaveLength(1);
    // Half past eleven in UTC is the next day in Auckland.
    expect(seen[0]).toContain("2026-11-16");
    expect(seen[0]).toContain('"Work"');
    expect(seen[0]).toContain('"Home"');
    expect(seen[0]).not.toContain("Old job");
  });
});

describe("send_message spoken in a Call", () => {
  test("tells the Agent it is being heard, and a typed Message does not; the words are the same", async () => {
    const seen: string[] = [];
    const read: string[] = [];
    scriptModel((context) => {
      seen.push(textOf(context.messages.findLast((message) => message.role === "user")));
      read.push(lastWords(context));
      return fauxAssistantMessage("Noted.");
    });
    const context = newContext();
    const spoken = marked("What is due today");

    const sent = value(
      await context.callAny(hand, "send_message", { words: spoken, spoken: true }),
    ) as { message: PersonMessage };
    await context.callAny(hand, "send_message", { words: "Typed" });
    await context.runsEnded();

    expect(sent.message).toMatchObject({ words: spoken, spoken: true });
    expect(seen[0]).toContain(HEARD);
    expect(seen[1]).not.toContain(HEARD);
    expect(read).toEqual([spoken, "Typed"]);
  });

  test("the Agent's Message names the Message it answers, as read back and as carried live", async () => {
    const context = newContext();
    const channel = await context.listen();
    await channel.next();

    const sent = value(
      await context.callAny(hand, "send_message", { words: "First", spoken: true }),
    ) as { message: PersonMessage };
    await context.runsEnded();

    let carried: LiveMessage | undefined;
    while (!(carried?.kind === "message" && carried.message.from === "agent")) {
      carried = await channel.next();
    }
    channel.close();
    expect(carried).toMatchObject({ message: { answers: sent.message.id } });
    const [answer] = (value(await context.callAny(hand, "list_messages", {})) as MessagesPage)
      .items;
    expect(answer).toMatchObject({ from: "agent", answers: sent.message.id });
  });
});

describe("send_message: the person's words as a scripted model reads them", () => {
  test("come last and alone, whatever the bearings hold", async () => {
    const read: string[] = [];
    scriptModel((context) => {
      read.push(lastWords(context));
      return fauxAssistantMessage("Noted.");
    });
    const context = newContext();
    const standing = value(
      await context.call(hand, "record_entry", { words: marked("Keep Fridays free\n\nAlways") }),
    ).record;
    value(await context.call(hand, "mark_standing", { id: standing.id }));
    const words = marked("Record: what is due?\n\nAnd tomorrow");

    await context.callAny(hand, "send_message", { words });
    await context.runsEnded();

    expect(read).toEqual([words]);
  });
});

describe("list_messages without the model's key", () => {
  test("there is no Agent: the Conversation says so, and a Message is refused and kept nowhere", async () => {
    noModel();
    const context = newContext();

    const sent = await context.callAny(hand, "send_message", { words: "Hello?" });
    const page = value(await context.callAny(hand, "list_messages", {})) as MessagesPage;

    expect(sent).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(page).toEqual({ items: [], next_cursor: null, agent: "no_key", voice: "available" });
  });
});

describe("list_messages with a model the code ships no price for", () => {
  test("there is no Agent, and the Conversation says that is why", async () => {
    noModel("model_has_no_price");
    const context = newContext();

    const sent = await context.callAny(hand, "send_message", { words: "Hello?" });
    const page = value(await context.callAny(hand, "list_messages", {})) as MessagesPage;

    expect(sent).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(page.agent).toBe("model_has_no_price");
  });
});

describe("send_message: Runs in a Context", () => {
  test("happen one after another, each answering its own Message in the order they were sent", async () => {
    const asked: string[][] = [];
    scriptModel((context) => {
      asked.push(
        context.messages
          .filter((message) => message.role === "user")
          .map((message) => textOf(message).split("\n").at(-1) ?? ""),
      );
      return fauxAssistantMessage("Noted.");
    });
    const context = newContext();

    await context.callAny(hand, "send_message", { words: "First" });
    await context.callAny(hand, "send_message", { words: "Second" });
    await context.runsEnded();

    // The second Run starts only once the first has answered, and sees that answer.
    expect(asked).toEqual([["First"], ["First", "Second"]]);
    const page = value(await context.callAny(hand, "list_messages", {})) as MessagesPage;
    expect(page.items.map((message) => [message.from, message.words])).toEqual([
      ["agent", "Noted."],
      ["person", "Second"],
      ["agent", "Noted."],
      ["person", "First"],
    ]);
  });

  test("an ended Run says what it cost, by the price shipped with the code", async () => {
    const context = newContext();

    await context.callAny(hand, "send_message", { words: "Hello" });
    await context.runsEnded();

    const [answer] = (value(await context.callAny(hand, "list_messages", {})) as MessagesPage)
      .items;
    expect(answer?.from === "agent" && answer.run.cost).toBeGreaterThan(0);
  });
});

describe("send_message on the live channel", () => {
  test("carries the answer as it is written, then the Message whole", async () => {
    scriptModel(answering("One two three four five six seven eight"), { wordsPerSecond: 10 });
    const context = newContext();
    const channel = await context.listen();
    await channel.next();

    await context.callAny(hand, "send_message", { words: "Count" });
    await context.runsEnded();

    const carried: LiveMessage[] = [];
    for (;;) {
      const message = await channel.next();
      carried.push(message);
      if (message.kind === "message" && message.message.from === "agent") break;
    }
    expect(carried[0]).toMatchObject({
      kind: "message",
      message: { from: "person", words: "Count" },
    });
    const written = carried.flatMap((message) =>
      message.kind === "answer" ? [message.words] : [],
    );
    const whole = "One two three four five six seven eight";
    expect(written.length).toBeGreaterThan(1);
    // Each carries all of the answer so far.
    written.forEach((words, at) => {
      expect(written[at + 1] ?? whole).toContain(words);
    });
    expect(carried.at(-1)).toMatchObject({ kind: "message", message: { words: whole } });
    channel.close();
  });
});

describe("send_message on the live channel, over rounds", () => {
  test("what an earlier round said stays in the answer while a later one is written", async () => {
    scriptModel(
      (context) =>
        context.messages.at(-1)?.role === "toolResult"
          ? fauxAssistantMessage("Nothing is due today.")
          : fauxAssistantMessage([fauxText("Let me look."), fauxToolCall("list_tasks", {})], {
              stopReason: "toolUse",
            }),
      { wordsPerSecond: 20 },
    );
    const context = newContext();
    const channel = await context.listen();
    await channel.next();

    await context.callAny(hand, "send_message", { words: "What is due?" });
    await context.runsEnded();

    let last = "";
    for (;;) {
      const message = await channel.next();
      if (message.kind === "answer") last = message.words;
      if (message.kind === "message" && message.message.from === "agent") break;
    }
    expect(last).toContain("Let me look.");
    expect(last).toContain("Nothing is due");
    channel.close();
  });
});

describe("send_message on the live channel, with Messages queued", () => {
  test("each Run's Message comes whole, in turn", async () => {
    const context = newContext();
    const channel = await context.listen();
    await channel.next();

    await context.callAny(hand, "send_message", { words: "First" });
    await context.callAny(hand, "send_message", { words: "Second" });
    await context.runsEnded();

    const whole: string[] = [];
    while (whole.length < 4) {
      const message = await channel.next();
      if (message.kind === "message") whole.push(message.message.from);
    }
    expect(whole.toSorted()).toEqual(["agent", "agent", "person", "person"]);
    channel.close();
  });
});

describe("list_messages", () => {
  test("reads the Conversation back to the start, a page at a time, newest first", async () => {
    const context = newContext();
    const sent = Array.from({ length: 30 }, (_, at) => `Message ${at + 1}`);
    for (const words of sent) await context.callAny(hand, "send_message", { words });
    await context.runsEnded();

    const read: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = value(
        await context.callAny(hand, "list_messages", cursor ? { cursor } : {}),
      ) as MessagesPage;
      read.push(...page.items.filter((m) => m.from === "person").map((m) => m.words));
      cursor = page.next_cursor;
      pages++;
    } while (cursor);

    expect(pages).toBeGreaterThan(1);
    expect(read).toEqual(sent.toReversed());
  });

  test("a cursor that is not one it gave is invalid input", async () => {
    const result = await newContext().callAny(hand, "list_messages", { cursor: "not-a-cursor" });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("the Agent's tool schemas", () => {
  test("keeps write keys private and rejects a missing required argument before a valid write", async () => {
    const words = marked("A valid note");
    let requests = 0;
    const calls = calling([() => ["record_entry", {}], () => ["record_entry", { words }]]);
    scriptModel((given, ...rest) => {
      requests++;
      const offered = given.messages.flatMap((message) =>
        message.role === "system" ? (message.toolsAdded ?? []) : [],
      );
      const record = offered.find(({ name }) => name === "record_entry");
      expect(record?.parameters).toMatchObject({
        type: "object",
        properties: { words: { type: "string" } },
        additionalProperties: false,
      });
      expect(record?.parameters).not.toHaveProperty("properties.key");
      return calls(given, ...rest);
    });
    const context = newContext();
    await context.callAny(hand, "send_message", { words: marked("Record my note") });
    await context.runsEnded();
    expect(requests).toBe(3);
    expect(
      value(await context.call(hand, "list_entries", {})).items.map(({ words }) => words),
    ).toEqual([words]);
    const runs = value(await context.call(hand, "list_runs", {})).items;
    expect(runs[0]).toMatchObject({ ended: "answered", failure: null });
    expect(runs[0]?.changes).toHaveLength(1);
  });
});

import { describe, expect, test } from "bun:test";
import {
  type Change,
  type ChangesPage,
  type LiveMessage,
  success,
  type ToolResult,
} from "@praxis/domain";
import { Live, type LiveOpener } from "../src/live.ts";

// The screen's end of the live channel (section 9.5), against a channel and a `list_changes` of
// the test's own. What the screen does with each change is the browser journey's to show.

/** A change by the hand, told apart by its tool. */
function change(tool: string): Change {
  return { at: "2026-11-16T09:00:00.000Z", caller: { kind: "hand" }, tool, effects: [] };
}

function message(cursor: string, ...tools: string[]): string {
  const sent: LiveMessage = { kind: "changes", items: tools.map(change), cursor };
  return JSON.stringify(sent);
}

/** A channel the test opens, carries messages down and closes, as the Context's object would. */
function fakeChannels() {
  const opened: { message(data: string): void; closed(): void; closedByScreen: boolean }[] = [];
  const open: LiveOpener = (on) => {
    const channel = { ...on, closedByScreen: false };
    opened.push(channel);
    return {
      close() {
        channel.closedByScreen = true;
      },
    };
  };
  return { open, opened, latest: () => opened.at(-1) ?? fail("No channel opened") };
}

/** `list_changes` answering from pages the test sets, by the cursor asked from. */
function fakeChangeLog(pages: Record<string, ChangesPage> = {}) {
  const asked: (string | undefined)[] = [];
  return {
    asked,
    listChanges: async (input: { cursor?: string }): Promise<ToolResult<ChangesPage>> => {
      asked.push(input.cursor);
      const page = pages[input.cursor ?? ""];
      if (!page) throw new Error(`No page from ${input.cursor}`);
      return success(page);
    },
  };
}

function page(cursor: string, tools: string[], more = false): ChangesPage {
  return { items: tools.map(change), cursor, more, read_afresh: false };
}

/** A pause the test ends when it chooses. */
function fakePauses() {
  const pending: { ms: number; end: () => void }[] = [];
  return {
    pending,
    wait: (ms: number) => new Promise<void>((end) => pending.push({ ms, end })),
  };
}

/** Let what is queued run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fail(why: string): never {
  throw new Error(why);
}

describe("the screen's live channel", () => {
  test("hands each change down to every listener, in order, one at a time", async () => {
    const channels = fakeChannels();
    const live = new Live({
      open: channels.open,
      listChanges: fakeChangeLog().listChanges,
      wait: fakePauses().wait,
    });
    const heard: string[] = [];
    let finishSlow = () => {};
    live.listen({
      changed: (seen) =>
        seen.tool === "slow"
          ? new Promise<void>((resolve) => {
              heard.push("slow started");
              finishSlow = () => {
                heard.push("slow done");
                resolve();
              };
            })
          : void heard.push(`first heard ${seen.tool}`),
      readAfresh: () => {},
    });
    live.listen({
      changed: (seen) => void heard.push(`second heard ${seen.tool}`),
      readAfresh: () => {},
    });

    channels.latest().message(message("c0"));
    channels.latest().message(message("c2", "slow", "record_entry"));
    channels.latest().message(message("c3", "finish_task"));
    await settle();
    expect(heard).toEqual(["slow started"]);

    finishSlow();
    await settle();
    expect(heard).toEqual([
      "slow started",
      "slow done",
      "second heard slow",
      "first heard record_entry",
      "second heard record_entry",
      "first heard finish_task",
      "second heard finish_task",
    ]);
    live.close();
  });

  test("once the channel drops, opens it again after a pause and catches up from list_changes", async () => {
    const channels = fakeChannels();
    const log = fakeChangeLog({
      c1: page("c51", ["missed 1"], true),
      c51: page("c52", ["missed 2"]),
    });
    const pauses = fakePauses();
    const live = new Live({ open: channels.open, listChanges: log.listChanges, wait: pauses.wait });
    const heard: string[] = [];
    live.listen({ changed: (seen) => void heard.push(seen.tool), readAfresh: () => {} });
    channels.latest().message(message("c0"));
    channels.latest().message(message("c1", "heard live"));

    channels.latest().closed();
    await settle();
    expect(channels.opened).toHaveLength(1);
    pauses.pending.shift()?.end();
    await settle();
    expect(channels.opened).toHaveLength(2);
    channels.latest().message(message("c52"));
    channels.latest().message(message("c53", "after"));
    await settle();

    expect(log.asked).toEqual(["c1", "c51"]);
    expect(heard).toEqual(["heard live", "missed 1", "missed 2", "after"]);
    live.close();
  });

  test("away longer than the log keeps, tells its listeners to read afresh and carries on", async () => {
    const channels = fakeChannels();
    const log = fakeChangeLog({
      c0: { items: [], cursor: "c900", more: false, read_afresh: true },
    });
    const pauses = fakePauses();
    const live = new Live({ open: channels.open, listChanges: log.listChanges, wait: pauses.wait });
    const heard: string[] = [];
    live.listen({
      changed: (seen) => void heard.push(seen.tool),
      readAfresh: () => void heard.push("read afresh"),
    });
    channels.latest().message(message("c0"));

    channels.latest().closed();
    await settle();
    pauses.pending.shift()?.end();
    await settle();
    channels.latest().message(message("c900"));
    channels.latest().message(message("c901", "after"));
    channels.latest().closed();
    await settle();
    pauses.pending.shift()?.end();
    await settle();

    expect(heard).toEqual(["read afresh", "after"]);
    expect(log.asked).toEqual(["c0"]);
    live.close();
  });

  test("a catch-up that cannot reach the Context drops the channel and is tried again", async () => {
    const channels = fakeChannels();
    const log = fakeChangeLog({ c0: page("c1", ["missed"]) });
    let reachable = false;
    const listChanges = (input: { cursor?: string }) =>
      reachable
        ? log.listChanges(input)
        : Promise.reject(new Error("Praxis could not be reached."));
    const pauses = fakePauses();
    const live = new Live({ open: channels.open, listChanges, wait: pauses.wait });
    const heard: string[] = [];
    live.listen({ changed: (seen) => void heard.push(seen.tool), readAfresh: () => {} });
    channels.latest().message(message("c0"));
    channels.latest().closed();
    await settle();
    pauses.pending.shift()?.end();
    await settle();

    channels.latest().message(message("c1"));
    await settle();
    expect(channels.latest().closedByScreen).toBe(true);
    // The channel the screen dropped closes as any would; it is opened again once only.
    channels.latest().closed();
    await settle();
    expect(pauses.pending).toHaveLength(1);

    reachable = true;
    pauses.pending.shift()?.end();
    await settle();
    channels.latest().message(message("c1"));
    channels.latest().message(message("c2", "after"));
    await settle();

    expect(channels.opened).toHaveLength(3);
    expect(heard).toEqual(["missed", "after"]);
    live.close();
  });

  test("the pause before opening again doubles to half a minute, and starts over once one opens", async () => {
    const channels = fakeChannels();
    const pauses = fakePauses();
    const live = new Live({
      open: channels.open,
      listChanges: fakeChangeLog().listChanges,
      wait: pauses.wait,
    });
    const waited: number[] = [];
    const dropAndWait = async () => {
      channels.latest().closed();
      await settle();
      const pause = pauses.pending.shift() ?? fail("No pause");
      waited.push(pause.ms);
      pause.end();
      await settle();
    };

    for (let n = 0; n < 7; n++) await dropAndWait();
    channels.latest().message(message("c0"));
    await settle();
    await dropAndWait();

    expect(waited).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 1000]);
    live.close();
  });

  test("woken, a dropped channel opens at once, and the pause then opens no other", async () => {
    const channels = fakeChannels();
    const pauses = fakePauses();
    const live = new Live({
      open: channels.open,
      listChanges: fakeChangeLog().listChanges,
      wait: pauses.wait,
    });
    live.wake();
    expect(channels.opened).toHaveLength(1);

    channels.latest().closed();
    await settle();
    live.wake();
    expect(channels.opened).toHaveLength(2);
    pauses.pending.shift()?.end();
    await settle();

    expect(channels.opened).toHaveLength(2);
    live.close();
  });

  test("is ready once the channel first says where the log stands, or first fails to", async () => {
    const said = fakeChannels();
    const failed = fakeChannels();
    const options = { listChanges: fakeChangeLog().listChanges, wait: fakePauses().wait };
    const lives = [
      new Live({ ...options, open: said.open }),
      new Live({ ...options, open: failed.open }),
    ];
    const ready = lives.map((live) => {
      const state = { ready: false };
      void live.ready.then(() => {
        state.ready = true;
      });
      return state;
    });
    await settle();
    expect(ready).toEqual([{ ready: false }, { ready: false }]);

    said.latest().message(message("c0"));
    failed.latest().closed();
    await settle();

    expect(ready).toEqual([{ ready: true }, { ready: true }]);
    for (const live of lives) live.close();
  });

  test("ready before the channel first opened, it has the screen read afresh once it does", async () => {
    const channels = fakeChannels();
    const pauses = fakePauses();
    let giveUp = () => {};
    const live = new Live({
      open: channels.open,
      listChanges: fakeChangeLog().listChanges,
      wait: pauses.wait,
      readyBy: new Promise<void>((resolve) => {
        giveUp = resolve;
      }),
    });
    const heard: string[] = [];
    live.listen({
      changed: (seen) => void heard.push(seen.tool),
      readAfresh: () => void heard.push("read afresh"),
    });
    let ready = false;
    void live.ready.then(() => {
      ready = true;
    });

    giveUp();
    await settle();
    expect(ready).toBe(true);
    channels.latest().message(message("c7"));
    channels.latest().message(message("c8", "after"));
    await settle();

    expect(heard).toEqual(["read afresh", "after"]);
    live.close();
  });

  test("closed, it opens no channel again", async () => {
    const channels = fakeChannels();
    const pauses = fakePauses();
    const live = new Live({
      open: channels.open,
      listChanges: fakeChangeLog().listChanges,
      wait: pauses.wait,
    });

    live.close();
    channels.latest().closed();
    live.wake();
    await settle();

    expect(channels.latest().closedByScreen).toBe(true);
    expect(channels.opened).toHaveLength(1);
    expect(pauses.pending).toHaveLength(0);
  });
});

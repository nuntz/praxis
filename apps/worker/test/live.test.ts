import { NOTHING_GOES_UP } from "@praxis/domain";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { agent, connection, hand, newContext, newDeployment, value } from "./seam.ts";

describe("the live channel", () => {
  test("on opening, it says where the change log stands", async () => {
    const context = newContext();
    value(await context.call(hand, "record_entry", { words: marked("Before it opened") }));
    const { cursor } = value(await context.call(hand, "list_changes", {}));

    const channel = await context.listen();

    expect(await channel.next()).toEqual({ kind: "changes", items: [], cursor });
  });

  test("carries each write's change to every channel open, as list_changes gives it", async () => {
    const context = newContext();
    const [phone, desktop] = [await context.listen(), await context.listen()];
    const { cursor: from } = await phone.next();
    await desktop.next();

    value(await context.call(hand, "record_entry", { words: marked("By hand") }));
    value(await context.call(connection, "record_entry", { words: marked("By a Connection") }));

    const listed = value(await context.call(hand, "list_changes", { cursor: from }));
    for (const channel of [phone, desktop]) {
      const first = await channel.next();
      const second = await channel.next();
      expect([...first.items, ...second.items]).toEqual(listed.items);
      expect(second.cursor).toBe(listed.cursor);
      const since = value(await context.call(hand, "list_changes", { cursor: first.cursor }));
      expect(since.items).toEqual(listed.items.slice(1));
    }
  });

  test("carries nothing for a read, a failure, a repeated key or a call that changes nothing", async () => {
    const context = newContext();
    const keyed = { words: marked("Keyed"), tasks: [{ title: marked("Call back") }], key: "k1" };
    const { record } = value(await context.call(hand, "record_entry", keyed));
    const task = record.tasks[0]?.id;
    value(await context.call(hand, "finish_task", { id: task }));
    const channel = await context.listen();
    await channel.next();

    await context.call(hand, "list_entries", {});
    await context.call(hand, "record_entry", { words: "" });
    await context.call(hand, "record_entry", keyed);
    value(await context.call(hand, "finish_task", { id: task }));
    const written = value(await context.call(agent, "record_entry", { words: marked("Then") }));

    expect((await channel.next()).items.map((change) => change.effects)).toEqual([written.effects]);
  });

  test("carries only its own Context's changes", async () => {
    const deployment = newDeployment();
    const made = async (name: string) =>
      value(
        await deployment.call(hand, "create_context", { name, time_zone: "UTC", accent: "blue" }),
      ).record.id;
    const [work, home] = [
      deployment.context(await made("Work")),
      deployment.context(await made("Home")),
    ];
    const channel = await work.listen();
    await channel.next();

    value(await home.call(hand, "record_entry", { words: marked("At home") }));
    const atWork = value(await work.call(hand, "record_entry", { words: marked("At work") }));

    expect((await channel.next()).items.map((change) => change.effects)).toEqual([atWork.effects]);
  });

  test("carries a rename of its Context, which the Deployment object makes", async () => {
    const deployment = newDeployment();
    const { record } = value(
      await deployment.call(hand, "create_context", {
        name: "Work",
        time_zone: "UTC",
        accent: "blue",
      }),
    );
    const channel = await deployment.context(record.id).listen();
    await channel.next();

    value(await deployment.call(hand, "rename_context", { id: record.id, name: "Day job" }));

    expect((await channel.next()).items).toEqual([
      expect.objectContaining({
        tool: "rename_context",
        effects: [expect.objectContaining({ kind: "context", id: record.id, summary: "Day job" })],
      }),
    ]);
  });

  test("anything sent up it closes it, since every send is a tool call", async () => {
    const context = newContext();
    const channel = await context.listen();
    await channel.next();

    channel.send(JSON.stringify({ tool: "record_entry", input: { words: marked("Sent up") } }));

    expect(await channel.closed).toEqual({
      code: NOTHING_GOES_UP,
      reason: "Nothing is sent up the live channel: call a tool.",
    });
    expect(value(await context.call(hand, "list_changes", {})).items).toEqual([]);
  });
});

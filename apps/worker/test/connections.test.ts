import { describe, expect, test } from "vitest";
import { hand, newDeployment, value } from "./seam.ts";

// A Connection is the person's standing permission for an outside agent to work in one Context
// (section 7.2, ADR 0009). The Deployment object keeps them; making, renaming, switching and
// ending one are Deployment tools, offered to the hand only (4.11). The oracle holds each write
// to changing exactly the Connections its Effects name. What a Connection reaches over MCP is in
// mcp.test.ts.

type Deployment = ReturnType<typeof newDeployment>;

async function makeContext(deployment: Deployment, name = "Work"): Promise<string> {
  const made = await deployment.call(hand, "create_context", {
    name,
    time_zone: "Europe/Paris",
    accent: "blue",
  });
  return value(made).record.id;
}

async function connect(deployment: Deployment, context_id: string, name = "Claude Code") {
  const made = await deployment.call(hand, "create_connection", {
    name,
    context_id,
    reading_only: false,
  });
  return value(made).record;
}

async function listed(deployment: Deployment) {
  return value(await deployment.call(hand, "list_connections", {})).items;
}

describe("create_connection", () => {
  test("makes a Connection to one Context, with an address under /mcp holding an opaque id", async () => {
    const deployment = newDeployment();
    const work = await makeContext(deployment);

    const made = value(
      await deployment.call(hand, "create_connection", {
        name: "Claude Code",
        context_id: work,
        reading_only: true,
      }),
    );

    const { id } = made.record;
    expect(made).toEqual({
      record: {
        id,
        name: "Claude Code",
        context_id: work,
        reading_only: true,
        address: `/mcp/${id}`,
        ended: false,
      },
      effects: [{ kind: "connection", id, what: "made", summary: "Claude Code", by: "call" }],
      changed: true,
    });
    expect(id).toMatch(/^[0-9A-Za-z_-]{20,}$/);
    expect(id).not.toContain(work);
    expect(await listed(deployment)).toEqual([made.record]);
  });

  test("each Connection has an address of its own, even under one name to one Context", async () => {
    const deployment = newDeployment();
    const work = await makeContext(deployment);

    const one = await connect(deployment, work);
    const two = await connect(deployment, work);

    expect(one.address).not.toBe(two.address);
    expect(await listed(deployment)).toEqual([one, two]);
  });

  test("reaches only a Context there is and that is not retired", async () => {
    const deployment = newDeployment();
    const work = await makeContext(deployment, "Work");
    await makeContext(deployment, "Home");
    value(await deployment.call(hand, "retire_context", { id: work }));

    for (const context_id of [work, "no-such-context"]) {
      const made = await deployment.call(hand, "create_connection", {
        name: "Claude Code",
        context_id,
        reading_only: false,
      });
      expect(made).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    expect(await listed(deployment)).toEqual([]);
  });

  test("a name is one line, and whether it reads only is said", async () => {
    const deployment = newDeployment();
    const work = await makeContext(deployment);
    const good = { name: "Claude Code", context_id: work, reading_only: false };

    for (const input of [
      { ...good, name: " " },
      { ...good, name: "Claude\nCode" },
      { ...good, reading_only: undefined },
      { ...good, context_id: undefined },
    ]) {
      expect(await deployment.call(hand, "create_connection", input)).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    }
    expect(await listed(deployment)).toEqual([]);
  });
});

describe("list_connections", () => {
  test("lists the Connections not ended, in the order they were made, with their Contexts", async () => {
    const deployment = newDeployment();
    const work = await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");
    const first = await connect(deployment, work, "Claude Code");
    const second = await connect(deployment, home, "ChatGPT");
    const third = await connect(deployment, work, "Claude");
    value(await deployment.call(hand, "end_connection", { id: second.id }));

    expect(await listed(deployment)).toEqual([first, third]);
  });
});

describe("rename_connection", () => {
  test("changes its name, and its address stays", async () => {
    const deployment = newDeployment();
    const made = await connect(deployment, await makeContext(deployment));

    const renamed = value(
      await deployment.call(hand, "rename_connection", { id: made.id, name: "Laptop" }),
    );

    expect(renamed).toEqual({
      record: { ...made, name: "Laptop" },
      effects: [
        { kind: "connection", id: made.id, what: "changed", summary: "Laptop", by: "call" },
      ],
      changed: true,
    });
    expect(await listed(deployment)).toEqual([renamed.record]);
  });

  test("to the name it has changes nothing", async () => {
    const deployment = newDeployment();
    const made = await connect(deployment, await makeContext(deployment));

    const same = value(
      await deployment.call(hand, "rename_connection", { id: made.id, name: made.name }),
    );

    expect(same).toEqual({ record: made, effects: [], changed: false });
  });
});

describe("set_connection_reading_only", () => {
  test("limits a Connection to reading, and lifts the limit", async () => {
    const deployment = newDeployment();
    const made = await connect(deployment, await makeContext(deployment));

    const limited = value(
      await deployment.call(hand, "set_connection_reading_only", {
        id: made.id,
        reading_only: true,
      }),
    );
    const lifted = value(
      await deployment.call(hand, "set_connection_reading_only", {
        id: made.id,
        reading_only: false,
      }),
    );

    expect(limited.record).toEqual({ ...made, reading_only: true });
    expect(limited.effects).toEqual([
      { kind: "connection", id: made.id, what: "changed", summary: made.name, by: "call" },
    ]);
    expect(lifted.record).toEqual(made);
  });

  test("to what it is already changes nothing", async () => {
    const deployment = newDeployment();
    const made = await connect(deployment, await makeContext(deployment));

    const same = await deployment.call(hand, "set_connection_reading_only", {
      id: made.id,
      reading_only: false,
    });

    expect(value(same)).toEqual({ record: made, effects: [], changed: false });
  });
});

describe("end_connection", () => {
  test("ends a Connection: it leaves the list and nothing more can change it", async () => {
    const deployment = newDeployment();
    const made = await connect(deployment, await makeContext(deployment));

    const ended = value(await deployment.call(hand, "end_connection", { id: made.id }));

    expect(ended).toEqual({
      record: { ...made, ended: true },
      effects: [
        { kind: "connection", id: made.id, what: "changed", summary: made.name, by: "call" },
      ],
      changed: true,
    });
    expect(await listed(deployment)).toEqual([]);
    for (const [tool, input] of [
      ["rename_connection", { id: made.id, name: "Again" }],
      ["set_connection_reading_only", { id: made.id, reading_only: true }],
    ] as const) {
      expect(await deployment.call(hand, tool, input)).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
  });

  test("ending one already ended changes nothing", async () => {
    const deployment = newDeployment();
    const made = await connect(deployment, await makeContext(deployment));
    value(await deployment.call(hand, "end_connection", { id: made.id }));

    const again = value(await deployment.call(hand, "end_connection", { id: made.id }));

    expect(again).toEqual({ record: { ...made, ended: true }, effects: [], changed: false });
  });

  test("a Connection there never was is not found", async () => {
    const deployment = newDeployment();

    for (const [tool, input] of [
      ["end_connection", { id: "no-such-connection" }],
      ["rename_connection", { id: "no-such-connection", name: "Laptop" }],
      ["set_connection_reading_only", { id: "no-such-connection", reading_only: true }],
    ] as const) {
      expect(await deployment.call(hand, tool, input)).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      });
    }
  });
});

describe("retiring a Context", () => {
  test("ends its Connections, each an Effect of the rule, and leaves another Context's be", async () => {
    const deployment = newDeployment();
    const work = await makeContext(deployment, "Work");
    const home = await makeContext(deployment, "Home");
    const atWork = await connect(deployment, work, "Claude Code");
    const atHome = await connect(deployment, home, "ChatGPT");

    const retired = value(await deployment.call(hand, "retire_context", { id: work }));

    expect(retired.effects).toEqual([
      { kind: "context", id: work, what: "changed", summary: "Work", by: "call" },
      { kind: "connection", id: atWork.id, what: "changed", summary: "Claude Code", by: "rule" },
    ]);
    expect(await listed(deployment)).toEqual([atHome]);
  });

  test("bringing it back does not restore them", async () => {
    const deployment = newDeployment();
    const work = await makeContext(deployment, "Work");
    await makeContext(deployment, "Home");
    const made = await connect(deployment, work);
    value(await deployment.call(hand, "retire_context", { id: work }));

    const back = value(await deployment.call(hand, "bring_back_context", { id: work }));

    expect(back.effects).toEqual([
      { kind: "context", id: work, what: "changed", summary: "Work", by: "call" },
    ]);
    expect(await listed(deployment)).toEqual([]);
    expect(
      await deployment.call(hand, "rename_connection", { id: made.id, name: "Again" }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

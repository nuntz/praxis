import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { marked } from "./markers.ts";
import { throughDeploymentOracle } from "./oracle.ts";
import { DAY, hand, newDeployment, value } from "./seam.ts";

// The oracle holds every write to its Effects only for the tables it knows, so it fails a call
// while an object holds one it does not, and holds every table to forgetting a record gone from
// the Context. Seeing either fail takes rows no code writes, so these are the harness tests that
// write to an object's tables themselves.

const at = "2026-11-15T09:00:00.000Z";

describe("the oracle, on the Deployment object's tables", () => {
  test("fails a call while the object holds a table it does not know", async () => {
    const deployment = env.DEPLOYMENT.get(env.DEPLOYMENT.newUniqueId());
    const contextOf = (id: string) => env.CONTEXT.get(env.CONTEXT.idFromString(id));
    const request = { caller: hand, tool: "list_contexts", input: {}, arrivedAt: Date.parse(at) };
    await throughDeploymentOracle(deployment, contextOf, request);
    await runInDurableObject(deployment, (_, state) => {
      state.storage.sql.exec(
        `CREATE TABLE no_code_makes (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
      );
    });

    await expect(throughDeploymentOracle(deployment, contextOf, request)).rejects.toThrow(
      /Every table of the Deployment object is known to the oracle/,
    );
  });
});

describe("the oracle, on what a Context's object forgets", () => {
  test("fails once a table still holds a removed record's summary 30 days on, when the object wakes", async () => {
    const deployment = newDeployment(at);
    const made = value(
      await deployment.call(hand, "create_context", {
        name: "Personal",
        time_zone: "UTC",
        accent: "blue",
      }),
    );
    const context = deployment.context(made.record.id);
    // Long enough that its summary is cut before the marker, so only the summary is left to find.
    const words = marked(
      "Repaint the hallway, the stairs and the landing, then every door, before the family comes in spring",
    );
    const recorded = value(await context.call(hand, "record_entry", { words }));
    const summary = recorded.effects[0]?.summary ?? "";
    // The fixture is as meant: the summary is the words cut short, with none of the marker.
    expect(words.startsWith(summary.slice(0, -1))).toBe(true);
    expect(summary).not.toContain("MARKER");
    value(await context.call(hand, "delete_entry", { id: recorded.record.id }));
    value(await context.call(hand, "remove_for_good", { id: recorded.record.id }));
    // A note of a move taken, quoting the Entry's summary as an Effect, dated so that no
    // forgetting reaches it: a table that copies words and forgets them by no code.
    await runInDurableObject(
      env.CONTEXT.get(env.CONTEXT.idFromString(made.record.id)),
      (_, state) => {
        state.storage.sql.exec(
          `INSERT INTO moves_in (id, effects, at) VALUES (?, ?, ?)`,
          crypto.randomUUID(),
          JSON.stringify([
            { kind: "entry", id: recorded.record.id, what: "made", summary, by: "call" },
          ]),
          Date.parse(at) + 365 * DAY,
        );
      },
    );

    deployment.advance(30 * DAY - 1);
    await context.fireAlarm();
    deployment.advance(1);

    await expect(context.fireAlarm()).rejects.toThrow(/none of its words in any table/);
  });
});

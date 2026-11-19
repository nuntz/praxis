import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { throughDeploymentOracle } from "./oracle.ts";
import { hand } from "./seam.ts";

// The oracle holds every write to its Effects only for the tables it knows, so it fails a call
// while an object holds one it does not. Seeing that takes a table no code makes, so this is the
// one harness test that writes to an object's tables itself.

const at = "2026-11-15T09:00:00.000Z";

describe("the oracle, on the Deployment object's tables", () => {
  test("fails a call while the object holds a table it does not know", async () => {
    const deployment = env.DEPLOYMENT.get(env.DEPLOYMENT.newUniqueId());
    const contextOf = (id: string) => env.CONTEXT.get(env.CONTEXT.idFromString(id));
    const request = { caller: hand, tool: "list_contexts", input: {}, arrivedAt: Date.parse(at) };
    await throughDeploymentOracle(deployment, contextOf, request);
    await runInDurableObject(deployment, (_, state) => {
      state.storage.sql.exec(`CREATE TABLE backups (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
    });

    await expect(throughDeploymentOracle(deployment, contextOf, request)).rejects.toThrow(
      /Every table of the Deployment object is known to the oracle/,
    );
  });
});

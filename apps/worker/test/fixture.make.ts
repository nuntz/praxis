import { env } from "cloudflare:workers";
import { inject, test } from "vitest";
import { dumpObject } from "./dump.ts";
import { fillFixture, fixtureName } from "./fixture-scenario.ts";

// Makes this release's fixture (section 13, ADR 0019), run by hand with `bun run fixture` in
// apps/worker, never in CI: the scenario fills a Deployment and a Context through the tools, and
// the objects' dumps and the Export they made are sent to the sink of vitest.fixture.config.ts,
// which saves them under test/fixtures/, named by the tops of the ladders.

test("makes this release's fixture", async () => {
  const { ids, made } = await fillFixture();
  const context = await dumpObject(env.CONTEXT.get(env.CONTEXT.idFromString(ids.context)));
  const deployment = await dumpObject(
    env.DEPLOYMENT.get(env.DEPLOYMENT.idFromString(ids.deployment)),
  );
  const sent = await fetch(inject("fixtureSink"), {
    method: "POST",
    body: JSON.stringify({
      name: fixtureName(),
      files: { "objects.json": { ids, context, deployment }, "export.json": made },
    }),
  });
  if (!sent.ok) throw new Error(`The fixture was not saved: ${await sent.text()}`);
});

import { expect, test } from "bun:test";
import wrangler from "../apps/worker/wrangler.jsonc";
import { JURISDICTIONS } from "./jurisdiction.ts";

/**
 * Pulumi runs index.ts on Node, which reaches no other workspace, and the wizard is a shell
 * script, so what they share with the Worker is written again there. This keeps each copy in step
 * with its source.
 */
const program = await Bun.file(new URL("index.ts", import.meta.url)).text();
const wizard = await Bun.file(new URL("../scripts/setup-deployment.sh", import.meta.url)).text();
const routing = await Bun.file(new URL("../apps/worker/src/routing.ts", import.meta.url)).text();

/** The jurisdictions the Worker keeps objects in, as routing.ts lists them. */
const WORKER_JURISDICTIONS = [
  ...(/const JURISDICTIONS: readonly string\[\] = \[([^\]]*)\]/
    .exec(routing)?.[1]
    ?.matchAll(/"([a-z]+)"/g) ?? []),
].map((match) => match[1] ?? "");

test("the Worker infra binds the hostname to is the one wrangler.jsonc deploys", () => {
  expect(/^const WORKER_NAME = "([^"]*)";$/m.exec(program)?.[1]).toBe(wrangler.name);
});

test("the bucket infra makes for the Backups is the one wrangler.jsonc binds", () => {
  const made = /^const BACKUP_BUCKET = "([^"]*)";$/m.exec(program)?.[1];
  expect(wrangler.r2_buckets.map((bucket: { bucket_name: string }) => bucket.bucket_name)).toEqual([
    made,
  ]);
});

test("every var infra gives the Worker is one wrangler.jsonc declares, so its type is Env's", () => {
  const given = /workerVars = [\s\S]*?\(\{([\s\S]*?)\}\)/.exec(program)?.[1] ?? "";
  const names = [...given.matchAll(/^\s*([A-Z_]+):/gm)].map((match) => match[1]);
  expect(names.sort()).toEqual(Object.keys(wrangler.vars).sort());
});

test("infra and the wizard offer the jurisdictions the Worker keeps objects in", () => {
  expect(WORKER_JURISDICTIONS).toEqual([...JURISDICTIONS]);
  const offered = /case "\$\{JURISDICTION:-\}" in ""\|([a-z|]+)\)/.exec(wizard)?.[1];
  expect(offered?.split("|")).toEqual([...WORKER_JURISDICTIONS]);
});

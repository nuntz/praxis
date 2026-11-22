import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import wrangler from "../apps/worker/wrangler.jsonc";
import { JURISDICTIONS } from "./jurisdiction.ts";
import { ONE_ADDRESS } from "./sign-in.ts";

/**
 * Pulumi runs index.ts on Node, which reaches no other workspace, and the wizard is a shell
 * script, so what they share with the Worker is written again there. This keeps each copy in step
 * with its source.
 */
const program = await Bun.file(new URL("index.ts", import.meta.url)).text();
const wizard = await Bun.file(new URL("../scripts/setup-deployment.sh", import.meta.url)).text();
const routing = await Bun.file(new URL("../apps/worker/src/routing.ts", import.meta.url)).text();
const meaning = await Bun.file(new URL("../apps/worker/src/meaning.ts", import.meta.url)).text();
const deploy = await Bun.file(new URL("../scripts/deploy-config.ts", import.meta.url)).text();
const workflow = await Bun.file(new URL("../.github/workflows/ci.yml", import.meta.url)).text();

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
  // The release is the commit CI deploys, which the deploy job names, not the configuration.
  const declared = Object.keys(wrangler.vars).filter((name) => name !== "RELEASE");
  expect(names.sort()).toEqual(declared.sort());
  expect(workflow).toContain(`vars=(--var "RELEASE:\${GITHUB_SHA::12}")`);
});

test("infra and the wizard offer the jurisdictions the Worker keeps objects in", () => {
  expect(WORKER_JURISDICTIONS).toEqual([...JURISDICTIONS]);
  const offered = /case "\$\{JURISDICTION:-\}" in ""\|([a-z|]+)\)/.exec(wizard)?.[1];
  expect(offered?.split("|")).toEqual([...WORKER_JURISDICTIONS]);
});

test("the meaning index infra makes is the one the deploy binds, as long as the model's embeddings", () => {
  const made = /^const MEANING_INDEX = "([^"]*)";$/m.exec(program)?.[1];
  expect(made).toBeDefined();
  expect(/^export const MEANING_INDEX = "([^"]*)";$/m.exec(deploy)?.[1]).toBe(made);
  const dimensions = /^const MEANING_DIMENSIONS = (\d+);$/m.exec(program)?.[1];
  expect(/^export const MEANING_DIMENSIONS = (\d+);$/m.exec(meaning)?.[1]).toBe(dimensions);
});

test("the wizard takes as one Google address what the deploy does", () => {
  const pattern = /^one_address='([^']*)'$/m.exec(wizard)?.[1];
  expect(pattern).toBeDefined();
  const samples = [
    "person@example.com",
    "first.last@mail.example.co.uk",
    "example.com",
    "@example.com",
    "person@",
    "person@example",
    "a@example.com, b@example.com",
    "a@example.com b@example.com",
    "a@b@example.com",
    "a,b@example.com",
  ];
  // bash reads its pattern as the wizard's `[[ =~ ]]` does, one sample per line.
  const read = spawnSync(
    "bash",
    [
      "-c",
      'while IFS= read -r sample; do [[ "$sample" =~ $1 ]] && echo yes || echo no; done',
      "copies",
      pattern ?? "",
    ],
    { input: `${samples.join("\n")}\n`, encoding: "utf8" },
  );

  expect(read.stdout.trim().split("\n")).toEqual(
    samples.map((sample) => (ONE_ADDRESS.test(sample) ? "yes" : "no")),
  );
});

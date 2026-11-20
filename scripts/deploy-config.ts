// The Worker's configuration as a Deployment deploys it: wrangler.jsonc, with the bindings only a
// deploy has. The Backups' bucket is bound in the jurisdiction the Deployment chose (section 9.2): a
// binding names its bucket's jurisdiction, and wrangler.jsonc serves every Deployment. Workers AI
// and the meaning index's Vectorize index (section 9.4) are bound here alone, since a binding to
// either reaches the account even in tests and on this machine, where the Worker has none and
// search answers from words. The deploy writes this copy beside wrangler.jsonc and deploys that
// (.github/workflows/ci.yml):
//
//   bun scripts/deploy-config.ts <jurisdiction, or "" for none>
//
// It writes apps/worker/wrangler.deploy.json, which is never committed.

type R2Binding = { binding: string; bucket_name: string; jurisdiction?: string };
type Config = { r2_buckets: R2Binding[] };

/** The Vectorize index infra makes for the meaning index (infra/index.ts). */
export const MEANING_INDEX = "praxis-meaning";

/** The bindings of the meaning index, as `workersAiMeaning` reads them (apps/worker/src/meaning.ts). */
const MEANING_BINDINGS = {
  ai: { binding: "AI" },
  vectorize: [{ binding: "MEANING", index_name: MEANING_INDEX }],
};

/** wrangler.jsonc as a Deployment in this jurisdiction deploys it. */
export function deployConfig<C extends Config>(
  config: C,
  jurisdiction: string,
): C & typeof MEANING_BINDINGS {
  return {
    ...config,
    ...MEANING_BINDINGS,
    r2_buckets: jurisdiction
      ? config.r2_buckets.map((bucket) => ({ ...bucket, jurisdiction }))
      : config.r2_buckets,
  };
}

if (import.meta.main) {
  const { default: wrangler } = await import("../apps/worker/wrangler.jsonc");
  const written = deployConfig(wrangler, process.argv[2] ?? "");
  await Bun.write(
    new URL("../apps/worker/wrangler.deploy.json", import.meta.url),
    `${JSON.stringify(written, null, 2)}\n`,
  );
}

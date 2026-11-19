// The Worker's configuration as a Deployment deploys it: wrangler.jsonc, with the Backups' bucket
// bound in the jurisdiction the Deployment chose (section 9.2). A binding names its bucket's
// jurisdiction, and wrangler.jsonc serves every Deployment, so the deploy writes this copy beside
// it and deploys that (.github/workflows/ci.yml):
//
//   bun scripts/deploy-config.ts <jurisdiction, or "" for none>
//
// It writes apps/worker/wrangler.deploy.json, which is never committed.

type R2Binding = { binding: string; bucket_name: string; jurisdiction?: string };
type Config = { r2_buckets: R2Binding[] };

/** wrangler.jsonc as a Deployment in this jurisdiction deploys it; with none, as it is. */
export function deployConfig<C extends Config>(config: C, jurisdiction: string): C {
  if (!jurisdiction) return config;
  return {
    ...config,
    r2_buckets: config.r2_buckets.map((bucket) => ({ ...bucket, jurisdiction })),
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

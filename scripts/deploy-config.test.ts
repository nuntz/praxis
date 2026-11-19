import { expect, test } from "bun:test";
import wrangler from "../apps/worker/wrangler.jsonc";
import { deployConfig } from "./deploy-config";

test("a Deployment with a jurisdiction binds the Backups' bucket in it", () => {
  for (const jurisdiction of ["eu", "us", "fedramp"]) {
    expect(deployConfig(wrangler, jurisdiction).r2_buckets).toEqual([
      { binding: "BACKUPS", bucket_name: "praxis-backups", jurisdiction },
    ]);
  }
});

test("a Deployment with none deploys wrangler.jsonc as it is", () => {
  expect(deployConfig(wrangler, "")).toEqual(wrangler);
});

test("everything else is wrangler.jsonc's", () => {
  const { r2_buckets: _, ...rest } = deployConfig(wrangler, "eu");
  const { r2_buckets: __, ...source } = wrangler;
  expect(rest).toEqual(source);
});

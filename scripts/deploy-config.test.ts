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

test("a Deployment with none binds the bucket as wrangler.jsonc does", () => {
  expect(deployConfig(wrangler, "").r2_buckets).toEqual(wrangler.r2_buckets);
});

test("every Deployment binds Workers AI and the meaning index, which wrangler.jsonc does not", () => {
  for (const jurisdiction of ["", "eu"]) {
    const config = deployConfig(wrangler, jurisdiction);
    expect(config.ai).toEqual({ binding: "AI" });
    expect(config.vectorize).toEqual([{ binding: "MEANING", index_name: "praxis-meaning" }]);
  }
  expect(wrangler).not.toHaveProperty("ai");
  expect(wrangler).not.toHaveProperty("vectorize");
});

test("everything else is wrangler.jsonc's", () => {
  const { r2_buckets: _, ai: __, vectorize: ___, ...rest } = deployConfig(wrangler, "eu");
  const { r2_buckets: ____, ...source } = wrangler;
  expect(rest).toEqual(source);
});

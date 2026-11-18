import { describe, expect, test } from "bun:test";
import { deployedJurisdiction, jurisdictionRefusal } from "./jurisdiction.ts";

// The settings the Cloudflare API answers for a deployed Worker, trimmed to what is read.
const deployedWith = (bindings: unknown[]) => ({ result: { bindings } });

describe("the jurisdiction a deployed Worker runs with", () => {
  test("is its JURISDICTION var", () => {
    const settings = deployedWith([
      { type: "durable_object_namespace", name: "CONTEXT", class_name: "ContextObject" },
      { type: "plain_text", name: "JURISDICTION", text: "eu" },
    ]);
    expect(deployedJurisdiction(settings)).toBe("eu");
  });

  test("is none when it has no such var, as a Worker deployed before the var had", () => {
    expect(deployedJurisdiction(deployedWith([]))).toBe("");
  });

  test("is unreadable from an answer with no bindings", () => {
    expect(() => deployedJurisdiction({ errors: [] })).toThrow();
  });
});

describe("a deploy's jurisdiction", () => {
  test("may be anything offered on the first deploy", () => {
    for (const offered of ["", "eu", "us", "fedramp"]) {
      expect(jurisdictionRefusal({ deployed: null, configured: offered })).toBeNull();
    }
  });

  test("is refused when it is none of those offered", () => {
    expect(jurisdictionRefusal({ deployed: null, configured: "EU" })).toContain("eu, us, fedramp");
  });

  test("may stay as it was", () => {
    expect(jurisdictionRefusal({ deployed: "eu", configured: "eu" })).toBeNull();
    expect(jurisdictionRefusal({ deployed: "", configured: "" })).toBeNull();
  });

  test("is refused once the objects are kept somewhere else, naming both and the way out", () => {
    const refusal = jurisdictionRefusal({ deployed: "", configured: "eu" });
    expect(refusal).toContain('"eu"');
    expect(refusal).toContain("none");
    expect(refusal).toContain("Export");
    expect(jurisdictionRefusal({ deployed: "eu", configured: "" })).not.toBeNull();
    expect(jurisdictionRefusal({ deployed: "eu", configured: "fedramp" })).not.toBeNull();
  });
});

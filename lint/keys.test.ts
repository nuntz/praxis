import { describe, expect, test } from "bun:test";
import { registries } from "../packages/domain/src/index.ts";

// The guard of ADR 0007's "every write accepts an optional key", over every registry the domain
// package lists: a write whose input has no `key` field fails here, whichever set it is in.

/** A registry as the guard reads it: each tool's kind, and its input's fields. */
type Registry = Record<string, { kind: "read" | "write"; input: unknown }>;

/** Each write in the registries whose input takes no key. */
function keyless(...registries: Registry[]): string[] {
  return registries.flatMap((registry) =>
    Object.entries(registry)
      .filter(([, tool]) => tool.kind === "write")
      .filter(([, tool]) => !("key" in ((tool.input as { shape?: object }).shape ?? {})))
      .map(([name]) => name),
  );
}

describe("the key guard", () => {
  test("every write, in every registry, accepts a key", () => {
    expect(keyless(...Object.values(registries))).toEqual([]);
  });

  test("names a write with no key, and passes over a read", () => {
    const registry: Registry = {
      keyed: { kind: "write", input: { shape: { id: {}, key: {} } } },
      keyless: { kind: "write", input: { shape: { id: {} } } },
      read: { kind: "read", input: { shape: {} } },
    };

    expect(keyless(registry)).toEqual(["keyless"]);
  });
});

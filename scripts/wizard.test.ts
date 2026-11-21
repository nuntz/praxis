import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// The setup wizard is run by hand, once per Deployment, and nothing else runs it: its syntax is
// checked here, as bash reads it before running a line of it, so an edit to it fails CI and not the
// person setting up.

describe("the setup wizard", () => {
  test("is a script bash reads whole", () => {
    const read = spawnSync("bash", ["-n", join(import.meta.dir, "setup-deployment.sh")], {
      encoding: "utf8",
    });

    expect(read.stderr).toBe("");
    expect(read.status).toBe(0);
  });
});

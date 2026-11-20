import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import type {} from "../test/provided.d.ts";

// Where test/fixture.make.ts sends a release's fixture, since a test in workerd writes no file: a
// server on this machine for the run, which saves it under test/fixtures/<name>/. A fixture once
// saved is a released one, so one of the same name is never written over.

const FIXTURES = join(import.meta.dirname, "../test/fixtures");

export default async function setup(project: TestProject) {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const { name, files } = JSON.parse(body) as { name: string; files: Record<string, unknown> };
      const folder = join(FIXTURES, name);
      if (existsSync(folder)) {
        response.statusCode = 409;
        response.end(`${folder} is a released fixture, never written over.`);
        return;
      }
      mkdirSync(folder, { recursive: true });
      for (const [file, content] of Object.entries(files)) {
        writeFileSync(join(folder, file), `${JSON.stringify(content, null, 1)}\n`);
      }
      console.log(`Saved the fixture ${folder}`);
      response.end("saved");
    });
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port for the sink");
  project.provide("fixtureSink", `http://127.0.0.1:${address.port}`);
  return () => new Promise<void>((closed) => server.close(() => closed()));
}

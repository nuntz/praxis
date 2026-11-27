import { expect, test } from "bun:test";
import {
  type Beat,
  FROZEN_AFTER_MS,
  HEARTBEAT,
  Pulse,
  replayed,
  withHeartbeat,
} from "./phone-loop";

test("the heartbeat is added to the page's head, and runs before the screen's own script", () => {
  // The screen's script is a module, run once the page is parsed, so the plain one added runs first.
  const page =
    '<html><head><script type="module" src="/assets/index-a.js"></script></head><body></body></html>';
  expect(withHeartbeat(page)).toBe(
    `<html><head><script type="module" src="/assets/index-a.js"></script><script src="${HEARTBEAT}.js"></script></head><body></body></html>`,
  );
  // What is no page is passed on as it came.
  expect(withHeartbeat("{}")).toBe("{}");
});

test("a Context's tool given a replay answers its first read, and nothing else is replayed", () => {
  const replays = new Map([["view_attention", '{"ok":true}']]);
  const tool = "/api/contexts/abc123/tools/view_attention";
  expect(replayed("POST", tool, "{}", replays)).toBe('{"ok":true}');
  expect(replayed("POST", tool, "", replays)).toBe('{"ok":true}');
  // A later page, the same tool from the Deployment, another tool, or a GET: the Deployment's own.
  expect(replayed("POST", tool, '{"cursor":"x"}', replays)).toBeNull();
  expect(replayed("POST", "/api/deployment/tools/view_attention", "{}", replays)).toBeNull();
  expect(replayed("POST", "/api/contexts/abc123/tools/list_entries", "{}", replays)).toBeNull();
  expect(replayed("GET", tool, "", replays)).toBeNull();
});

const beat = (over: Partial<Beat>): Beat => ({
  load: "l1",
  beat: 0,
  ms: 0,
  rows: 0,
  build: "index-a.js",
  state: "shown",
  ...over,
});

test("a load that drew its rows and goes on beating is told once, and never frozen", () => {
  const pulse = new Pulse();
  expect(pulse.heard(beat({}), 0)).toEqual([
    "load l1 index-a.js beat 0 at 0ms: started, 0 counted",
  ]);
  expect(pulse.heard(beat({ beat: 1, ms: 250, rows: 23 }), 250)).toEqual([
    "load l1 index-a.js beat 1 at 250ms: 23 counted",
  ]);
  expect(pulse.heard(beat({ beat: 2, ms: 500, rows: 23 }), 500)).toEqual([]);
  expect(pulse.verdicts(500 + FROZEN_AFTER_MS - 1)).toEqual([]);
});

test("a load shown that stops beating is frozen, told once; one hidden or left is not", () => {
  const pulse = new Pulse();
  pulse.heard(beat({ load: "frozen" }), 0);
  pulse.heard(beat({ load: "hidden" }), 0);
  pulse.heard(beat({ load: "hidden", beat: 1, ms: 250, state: "hidden" }), 250);
  pulse.heard(beat({ load: "left" }), 0);
  expect(pulse.heard(beat({ load: "left", beat: 1, ms: 250, state: "left" }), 250)).toEqual([
    "load left index-a.js beat 1 at 250ms: left, 0 counted",
  ]);
  expect(pulse.verdicts(FROZEN_AFTER_MS + 250)).toEqual([
    "load frozen index-a.js FROZEN, or closed unsaid: silent after beat 0 at 0ms, 0 counted",
  ]);
  expect(pulse.verdicts(FROZEN_AFTER_MS * 2)).toEqual([]);
});

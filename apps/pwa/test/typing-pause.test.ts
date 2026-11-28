import { describe, expect, test } from "bun:test";
import { askOnPause, type Timers } from "../src/typing-pause.ts";

// Search asks once typing pauses (section 8.4), since each `search` with words asks by meaning too,
// against the spend cap (section 9.4). A journey could only count the calls by timing the typing.

/** A clock of the test's own: what waits runs only as the test moves the time on. */
function testClock() {
  let now = 0;
  const waiting = new Map<number, { at: number; act: () => void }>();
  let handles = 0;
  const timers: Timers = {
    set(act, ms) {
      handles += 1;
      waiting.set(handles, { at: now + ms, act });
      return handles;
    },
    clear(handle) {
      waiting.delete(handle as number);
    },
  };
  function advance(ms: number) {
    now += ms;
    for (const [handle, { at, act }] of [...waiting].sort(([, a], [, b]) => a.at - b.at)) {
      if (at > now) continue;
      waiting.delete(handle);
      act();
    }
  }
  return { timers, advance };
}

describe("askOnPause", () => {
  test("typing “kitchen” a letter at a time asks once, for the whole word, once typing pauses", () => {
    const clock = testClock();
    const asked: string[] = [];
    const pause = askOnPause(clock.timers);
    let typed = "";
    for (const letter of "kitchen") {
      typed += letter;
      const words = typed;
      pause.later(() => asked.push(words));
      clock.advance(60);
    }
    expect(asked).toEqual([]);
    clock.advance(150);
    expect(asked).toEqual(["kitchen"]);
  });

  test("what acts at once, as a chip set, drops the words still waiting and asks now", () => {
    const clock = testClock();
    const asked: string[] = [];
    const pause = askOnPause(clock.timers);
    pause.later(() => asked.push("kitch"));
    pause.now(() => asked.push("kitch, in a Project"));
    clock.advance(500);
    expect(asked).toEqual(["kitch, in a Project"]);
  });

  test("put off, nothing waiting is asked", () => {
    const clock = testClock();
    const asked: string[] = [];
    const pause = askOnPause(clock.timers);
    pause.later(() => asked.push("kitchen"));
    pause.cancel();
    clock.advance(500);
    expect(asked).toEqual([]);
  });
});

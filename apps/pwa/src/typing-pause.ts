/**
 * How long typing pauses before search asks for the words (section 8.4): each `search` with words
 * asks by meaning too, which embeds them against the spend cap (section 9.4), so a word typed is
 * one call, not one a keystroke.
 */
export const TYPING_PAUSE = 150;

/** Timers to wait on: the Device's own, or a test's clock. */
export type Timers = {
  set: (act: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const deviceTimers: Timers = {
  set: (act, ms) => setTimeout(act, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * One thing asked at a time, once typing pauses: each `later` puts off what the one before it
 * waited to do, and `now`, for what acts at once (a chip, the clear button, Escape), drops it.
 */
export function askOnPause(timers: Timers = deviceTimers) {
  let waiting: unknown;
  function cancel() {
    if (waiting !== undefined) timers.clear(waiting);
    waiting = undefined;
  }
  return {
    /** Ask once nothing more is typed for the pause. */
    later(ask: () => void) {
      cancel();
      waiting = timers.set(() => {
        waiting = undefined;
        ask();
      }, TYPING_PAUSE);
    },
    /** Ask now, dropping what waited. */
    now(ask: () => void) {
      cancel();
      ask();
    },
    /** Drop what waited, asking nothing. */
    cancel,
  };
}

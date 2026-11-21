import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestInfo } from "@playwright/test";

// One Call at a time for the Deployment (section 6): starting one ends any other going, in any
// Context, and every journey shares one Deployment. So a journey that starts a Call holds this lock
// for the whole of it, across the Playwright workers and both widths, and no other journey's Call
// ends its own. It is a folder made in the system's temporary folder for the run, since making a
// folder that exists already fails: whoever made it holds it. A holder that died is found by its
// process id and the lock taken from it.

const LOCK = join(tmpdir(), `praxis-e2e-call-${process.env.PRAXIS_E2E_RUN ?? "local"}`);

/** How often a journey waiting for the lock tries it again. */
const TRY_EVERY = 50;

/** How long a lock made and not yet named is taken to be its maker's, still naming itself. */
const NAMING = 5_000;

/** Whether the process holding the lock still runs. */
function holderRuns(): boolean {
  let pid: number;
  try {
    pid = Number(readFileSync(join(LOCK, "holder"), "utf8"));
  } catch {
    // Made and not yet named: its maker runs, unless it died before naming itself.
    try {
      return Date.now() - statSync(LOCK).mtimeMs < NAMING;
    } catch {
      // Let go of meanwhile.
      return true;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Wait until no other journey holds a Call, and hold it: what is returned lets go. The journey's
 * time does not run while it waits, and its whole time runs from when it holds the Call, so one
 * waiting behind many others under load is not failed for it.
 */
export async function holdTheCall(testInfo: TestInfo): Promise<() => void> {
  const from = Date.now();
  const timeout = testInfo.timeout;
  testInfo.setTimeout(0);
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, "holder"), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!holderRuns()) rmSync(LOCK, { recursive: true, force: true });
      await new Promise((tried) => setTimeout(tried, TRY_EVERY));
    }
  }
  testInfo.setTimeout(timeout + (Date.now() - from));
  return () => rmSync(LOCK, { recursive: true, force: true });
}

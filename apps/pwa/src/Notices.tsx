import type { SpendNotice, StandingNotice } from "@praxis/domain";
import { createSignal, For } from "solid-js";
import { latestRead } from "./latest-read.ts";
import { type CallTool, unreachableMessage } from "./tools.ts";

/**
 * The standing Notices (section 8.3), as `list_notices` last gave them in the current Context:
 * Praxis telling the person about its own condition until its cause is gone. Attention shows them
 * above the Held Changes, and settings shows them too. They are not counted.
 */
const [notices, setNotices] = createSignal<StandingNotice[]>([]);

/** The current Context's tools, while a screen of it follows the Notices. */
let calling: CallTool | null = null;

/**
 * Read the standing Notices afresh: when the screen opens or comes back into view, after a Run
 * ends, since it may have found the key refused or taken, and after the cap is set. A read that
 * fails leaves what was shown.
 */
export const { read: readNotices } = latestRead(async (current) => {
  const callTool = calling;
  if (!callTool) return;
  try {
    const result = await callTool("list_notices", {});
    if (current() && result.ok) setNotices(result.value.items);
  } catch (error) {
    unreachableMessage(error);
  }
});

/** Follow the standing Notices through this Context's tools. Returns the stop. */
export function followNotices(callTool: CallTool): () => void {
  calling = callTool;
  void readNotices();
  const again = () => {
    if (document.visibilityState === "visible") void readNotices();
  };
  document.addEventListener("visibilitychange", again);
  return () => {
    document.removeEventListener("visibilitychange", again);
    if (calling === callTool) calling = null;
  };
}

/** Whether there are standing Notices to show. */
export function hasNotices(): boolean {
  return notices().length > 0;
}

/** Each standing Notice, as a line of its own. */
export function StandingNotices() {
  return (
    <For each={notices()}>
      {(notice) => (
        <p class="notice" role="status" data-testid="standing-notice">
          {noticeWords(notice)}
        </p>
      )}
    </For>
  );
}

export const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

/** What the month's spend says as a standing Notice: past 80% of the cap, or the cap reached. */
export function capWords(spend: { notice: SpendNotice; spent: number; cap: number }): string {
  return spend.notice === "cap_reached"
    ? `This month's spend has reached its cap of ${money.format(spend.cap)}: the Agent starts no new Run until the cap is raised or the month turns.`
    : `This month's spend, ${money.format(spend.spent)}, has passed 80% of its cap of ${money.format(spend.cap)}.`;
}

const sinceFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** What a standing Notice says. */
function noticeWords(notice: StandingNotice): string {
  switch (notice.kind) {
    case "key_refused":
      return `The model's provider has refused this Deployment's key since ${sinceFormat.format(new Date(notice.since))}: it may be wrong, out of credit or at the provider's own spend limit. The Agent answers nothing until a call succeeds. The key is set in the Deployment's configuration.`;
    case "cap_reached":
    case "nearing_cap":
      return capWords({ notice: notice.kind, spent: notice.spent, cap: notice.cap });
    case "clock_failed":
      return `The ${notice.clock === "brief" ? "Brief" : "Review"} could not run since ${sinceFormat.format(new Date(notice.since))}: ${notice.failure === "key_refused" ? "the model's provider refused this Deployment's key" : "the model could not be reached"}. It is tried again a little later each time, until it runs or the next one is due.`;
    case "no_backup":
      return notice.last_made === null
        ? "No Backup has been made yet, though Praxis has tried for three days. It tries again each day."
        : `No Backup has been made since ${sinceFormat.format(new Date(notice.last_made))}. Praxis tries again each day, and keeps the last one made until another is.`;
  }
}

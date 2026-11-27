import {
  mendedByWaiting,
  type RunFailure,
  type SpendNotice,
  type StandingNotice,
} from "@praxis/domain";
import Info from "lucide-solid/icons/info";
import { createUniqueId, For, type JSX } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { deviceTimeZone } from "./ContextSettings.tsx";
import { latestRead } from "./latest-read.ts";
import { CapLink, SettingsLink } from "./SettingsLink.tsx";
import { type CallTool, unreachableMessage } from "./tools.ts";

/**
 * The standing Notices (section 8.3), as `list_notices` last gave them in the current Context:
 * Praxis telling the person about its own condition until its cause is gone. Attention shows them
 * above the Held Changes, and nothing else does (section 8.6). They are not counted.
 * Each read is reconciled into them, a Notice matched by `noticeKey`, so one a read leaves as it
 * was keeps its card: drawn again, its status would be heard again each time.
 */
const [notices, setNotices] = createStore<{ items: (StandingNotice & { id: string })[] }>({
  items: [],
});

/**
 * What tells one standing Notice from another: its kind, with its clock for a Brief or Review that
 * could not run, and its Context's name for a stuck Context.
 */
function noticeKey(notice: StandingNotice): string {
  switch (notice.kind) {
    case "clock_failed":
      return `${notice.kind}-${notice.clock}`;
    case "context_stuck":
      return `${notice.kind}-${notice.context}`;
    default:
      return notice.kind;
  }
}

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
    if (!current() || !result.ok) return;
    const items = result.value.items.map((notice) => ({ ...notice, id: noticeKey(notice) }));
    setNotices("items", reconcile(items, { key: "id" }));
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

/**
 * Each standing Notice, as a card on `notice`: the information icon beside a bold title, its words
 * under the title, and the way to the section of Settings that deals with it, where there is one.
 * The card is a status named by its title, so the title is heard before the words.
 */
export function StandingNotices() {
  return <For each={notices.items}>{(notice) => <StandingNoticeCard notice={notice} />}</For>;
}

function StandingNoticeCard(props: { notice: StandingNotice }) {
  const title = createUniqueId();
  return (
    <div
      class="standing-notice"
      role="status"
      aria-labelledby={title}
      data-testid="standing-notice"
    >
      <Info class="standing-notice-icon" size={18} aria-hidden="true" />
      <div class="standing-notice-text">
        <p id={title} class="standing-notice-title" data-testid="standing-notice-title">
          {noticeTitle(props.notice)}
        </p>
        <p class="standing-notice-words" data-testid="standing-notice-words">
          {noticeWords(props.notice)}
        </p>
        {noticeLink(props.notice)}
      </div>
    </div>
  );
}

/** A standing Notice's title: what is wrong, in a few words, with its words under it to say more. */
function noticeTitle(notice: StandingNotice): string {
  switch (notice.kind) {
    case "key_refused":
      return "Model key refused";
    case "voice_key_refused":
      return "Voice key refused";
    case "cap_reached":
      return "Spend cap reached";
    case "nearing_cap":
      return "Spend near its cap";
    case "clock_failed":
      return notice.clock === "brief" ? "Brief not run" : "Review not run";
    case "no_backup":
      return "No recent Backup";
    case "context_stuck":
      return `${notice.context} stuck on an upgrade`;
  }
}

/**
 * Where a standing Notice leads (section 8.6): the cap to Spend, put in its field, and no good
 * Backup to Backups and Export. A refused key is set in the Deployment's configuration, and the
 * others have no section to deal with them either, so they lead nowhere.
 */
function noticeLink(notice: StandingNotice): JSX.Element {
  switch (notice.kind) {
    case "cap_reached":
    case "nearing_cap":
      return <CapLink />;
    case "no_backup":
      return <SettingsLink section="backups">See Backups and Export</SettingsLink>;
    case "key_refused":
    case "voice_key_refused":
    case "clock_failed":
    case "context_stuck":
      return null;
  }
}

export const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

/** What the month's spend says as a standing Notice: past 80% of the cap, or the cap reached. */
export function capWords(spend: { notice: SpendNotice; spent: number; cap: number }): string {
  return spend.notice === "cap_reached"
    ? `This month's spend has reached its cap of ${money.format(spend.cap)}: the Agent starts no new Run until the cap is raised or the month turns.`
    : `This month's spend, ${money.format(spend.spent)}, has passed 80% of its cap of ${money.format(spend.cap)}.`;
}

/** When a standing Notice began, on this Device: Notices are the Deployment's, across its Contexts. */
const sinceFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: deviceTimeZone(),
});

/** Why a Brief or Review could not run, as its standing Notice says. */
const CLOCK_FAILED: Record<RunFailure, string> = {
  model_unavailable: "the model could not be reached.",
  key_refused: "the model's provider refused this Deployment's key.",
  request_refused: "the model's provider refused Praxis's request.",
};

/**
 * What comes of a Brief or Review that could not run, as the clock does it (section 5.4): tried
 * again only when waiting mends its failure, and otherwise dropped for the next one.
 */
function clockFailedRetryWords(failure: RunFailure): string {
  return mendedByWaiting(failure)
    ? "It is tried again a little later each time, until it runs or the next one is due."
    : "It is not tried again: the next one runs at its time.";
}

/** What a standing Notice says. */
function noticeWords(notice: StandingNotice): string {
  switch (notice.kind) {
    case "key_refused":
      return `The model's provider has refused this Deployment's key since ${sinceFormat.format(new Date(notice.since))}: it may be wrong, out of credit or at the provider's own spend limit. The Agent answers nothing until a call succeeds. The key is set in the Deployment's configuration.`;
    case "voice_key_refused":
      return `The voice provider has refused this Deployment's voice key since ${sinceFormat.format(new Date(notice.since))}: it may be wrong, out of credit or at the provider's own spend limit. No Call starts until one is set up. The voice key is set in the Deployment's configuration.`;
    case "cap_reached":
    case "nearing_cap":
      return capWords({ notice: notice.kind, spent: notice.spent, cap: notice.cap });
    case "clock_failed":
      return `The ${notice.clock === "brief" ? "Brief" : "Review"} could not run since ${sinceFormat.format(new Date(notice.since))}: ${CLOCK_FAILED[notice.failure]} ${clockFailedRetryWords(notice.failure)}`;
    case "no_backup":
      return notice.last_made === null
        ? "No Backup has been made yet, though Praxis has tried for three days. It tries again each day."
        : `No Backup has been made since ${sinceFormat.format(new Date(notice.last_made))}. Praxis tries again each day, and keeps the last one made until another is.`;
    case "context_stuck":
      return `${notice.context} could not be upgraded under release ${notice.release}: it shows and changes nothing, and its Brief, Review and Trash wait, until a release that mends it is deployed. Nothing in it was lost. ${
        notice.backup_kept === null
          ? "No Backup holds it yet."
          : `The Backup made ${sinceFormat.format(new Date(notice.backup_kept))}, the last that holds it, is kept past its 30 days until it upgrades.`
      }`;
  }
}

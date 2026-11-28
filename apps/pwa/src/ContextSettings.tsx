import {
  FIRST_TIMES,
  type Message,
  namedZone,
  type Settings,
  type ToolResult,
  type Weekday,
  weekdays,
} from "@praxis/domain";
import { createSignal, createUniqueId, For, onCleanup, onMount, Show } from "solid-js";
import { SettingRow, SettingsGroup, SwitchInput } from "./design/SettingRows.tsx";
import { deviceTimeZone } from "./device.ts";
import { latestRead } from "./latest-read.ts";
import { MarkedLine, marksSentOnLeaving } from "./leaving.tsx";
import { useLive } from "./live-context.ts";
import { SettingsLink } from "./SettingsLink.tsx";
import { SettingsSection, sectionChanges } from "./SettingsSection.tsx";
import { SettlingField } from "./SettlingField.tsx";
import { TimeZonePicker } from "./TimeZonePicker.tsx";
import { useCallTool } from "./tools.ts";

/**
 * A change to the current Context's settings as it is sent, through the section's queue
 * (`sectionChanges`), showing the settings as it answered. Every tool that changes them answers as
 * `set_time_zone` does. Says whether it went through.
 */
function settingsChange(onChanged: (settings: Settings) => void) {
  const callTool = useCallTool();
  const changes = sectionChanges();
  async function change(
    at: string,
    send: () => Promise<ToolResult<{ record: Settings }>>,
    options?: { holds: boolean },
  ) {
    const changed = await changes.change(at, send, options);
    if (changed === null) return false;
    onChanged(changed.record);
    return true;
  }
  return { callTool, sending: changes.sending, problemAt: changes.problemAt, change };
}

/**
 * General, in Settings: the current Context's time zone, picked from the list of zones (section
 * 8.6). Travel changes nothing by itself: when this Device is in another time zone, both are shown
 * here with one tap to switch, and nowhere else is it raised.
 */
export function GeneralSettings(props: {
  settings: Settings;
  onChanged: (settings: Settings) => void;
}) {
  const { callTool, sending, problemAt, change } = settingsChange(props.onChanged);
  const device = deviceTimeZone();
  // Named as this browser names it, so one zone known by two names is not told apart.
  const differs = () => namedZone(props.settings.time_zone) !== device;

  const useDeviceZone = () =>
    change("time-zone", () => callTool("set_time_zone", { time_zone: device }));
  // A zone picked from the list holds nothing, so the field keeps the focus it was picked from.
  const pickZone = (zone: string) =>
    change("time-zone", () => callTool("set_time_zone", { time_zone: zone }), { holds: false });

  return (
    <SettingsSection
      note={
        <>Today, due dates and every time shown in {props.settings.name} are in its time zone.</>
      }
    >
      <SettingsGroup heading="Time zone" problem={problemAt("time-zone")}>
        <SettingRow
          title="This Context"
          labels
          control={(ids) => (
            <TimeZonePicker
              id={ids.id}
              describedBy={ids.describedBy}
              value={props.settings.time_zone}
              disabled={sending()}
              onPick={pickZone}
            />
          )}
        />
        <Show when={differs()}>
          <SettingRow
            title="This Device"
            description="Where this Device is now"
            control={() => (
              <>
                <span data-testid="device-time-zone">{device}</span>
                <button type="button" disabled={sending()} onClick={() => void useDeviceZone()}>
                  Use {device}
                </button>
              </>
            )}
          />
        </Show>
      </SettingsGroup>
    </SettingsSection>
  );
}

/**
 * Brief and Review, in Settings: when each comes, in the Context's time zone, or off, and the one
 * Notification switch for both (sections 5.4, 8.6 and 8.7).
 */
export function BriefAndReview(props: {
  settings: Settings;
  onChanged: (settings: Settings) => void;
}) {
  const { callTool, sending, problemAt, change } = settingsChange(props.onChanged);

  // The time each comes at, kept while it is off so switching it on brings it back.
  const [briefTime, setBriefTime] = createSignal(
    props.settings.brief_time ?? FIRST_TIMES.brief_time,
  );
  const [reviewTime, setReviewTime] = createSignal(
    props.settings.review_time ?? FIRST_TIMES.review_time,
  );
  const briefOn = () => props.settings.brief_time !== null;
  const reviewOn = () => props.settings.review_time !== null;

  const setBrief = (time: string | null, options?: { holds: boolean }) =>
    change("brief", () => callTool("set_brief_time", { time }), options);
  const setReview = (time: string | null, options?: { holds: boolean }) =>
    change("review", () => callTool("set_review_time", { time }), options);
  /** The Review's day, with its time as the changes before it leave it, a time just sent among them. */
  const setReviewDay = (day: Weekday) =>
    change("review", () => callTool("set_review_time", { day, time: props.settings.review_time }));

  return (
    <SettingsSection
      note={
        <>
          The Agent looks over {props.settings.name} on its own and leaves what it finds in the
          Conversation. Times are in {props.settings.time_zone}, this Context's time zone.
        </>
      }
    >
      <SettingsGroup heading="Brief, each day" problem={problemAt("brief")}>
        <SettingRow
          title="Daily Brief"
          description="What is due and what came up, each morning"
          labels
          control={(ids) => (
            <SwitchInput
              id={ids.id}
              aria-describedby={ids.describedBy}
              checked={briefOn()}
              disabled={sending()}
              onTurn={(on) => setBrief(on ? briefTime() : null)}
            />
          )}
        />
        <SettingRow
          title="Time"
          labels
          control={(ids) => (
            <SettlingField
              id={ids.id}
              type="time"
              value={props.settings.brief_time ?? briefTime()}
              disabled={sending() || !briefOn()}
              onSettle={async (time) => {
                if (time === "") return;
                setBriefTime(time);
                await setBrief(time, { holds: false });
              }}
            />
          )}
        />
      </SettingsGroup>
      <SettingsGroup heading="Review, each week" problem={problemAt("review")}>
        <SettingRow
          title="Weekly Review"
          description="What went quiet, and what to look at next week"
          labels
          control={(ids) => (
            <SwitchInput
              id={ids.id}
              aria-describedby={ids.describedBy}
              checked={reviewOn()}
              disabled={sending()}
              onTurn={(on) => setReview(on ? reviewTime() : null)}
            />
          )}
        />
        <SettingRow
          title="Day"
          labels
          control={(ids) => (
            <select
              id={ids.id}
              value={props.settings.review_day}
              disabled={sending()}
              onChange={(event) => void setReviewDay(event.currentTarget.value as Weekday)}
            >
              <For each={weekdays}>
                {(day) => <option value={day}>{weekdayName(day, "long")}</option>}
              </For>
            </select>
          )}
        />
        <SettingRow
          title="Time"
          labels
          control={(ids) => (
            <SettlingField
              id={ids.id}
              type="time"
              value={props.settings.review_time ?? reviewTime()}
              disabled={sending() || !reviewOn()}
              onSettle={async (time) => {
                if (time === "") return;
                setReviewTime(time);
                await setReview(time, { holds: false });
              }}
            />
          )}
        />
      </SettingsGroup>
      {/* One switch for both, beside their times (ADR 0013). A Device is sent one only while
        Notifications are switched on there too, in Devices. */}
      <SettingsGroup heading="Notifications" problem={problemAt("notifications")}>
        <SettingRow
          title="Tell my Devices when the Brief or the Review is ready"
          description={
            <>
              Each Device whose Notifications are on,{" "}
              <SettingsLink section="devices">in Devices</SettingsLink>
            </>
          }
          labels
          control={(ids) => (
            <SwitchInput
              id={ids.id}
              aria-describedby={ids.describedBy}
              checked={props.settings.notifications}
              disabled={sending()}
              onTurn={(on) => change("notifications", () => callTool("set_notifications", { on }))}
            />
          )}
        />
      </SettingsGroup>
    </SettingsSection>
  );
}

/** What the Conversation marked to be cleared says until the section is left (ADR 0028). */
const CLEARED_ON_LEAVING = "Cleared when you leave Conversation and search.";

/**
 * Conversation and search, in Settings: the rare, heavy actions on the current Context, clearing
 * its Conversation and rebuilding its search index (section 8.6). Clearing cannot be put back, so
 * Clear only marks it, and the Conversation is cleared as the section is left (ADR 0028), up to
 * the newest Message the screen had read when Clear was tapped: what came after stays.
 */
export function ConversationAndSearch(props: {
  contextName: string;
  /** Says what the screen must say once the section is no longer shown to say it. */
  onProblem: (message: string) => void;
}) {
  const callTool = useCallTool();
  const { change, sending, problemAt } = sectionChanges();
  const newest = newestMessage();
  // Marked by the time of the newest Message read as Clear was tapped.
  const clearing = marksSentOnLeaving<string>({
    sends: (marked) =>
      [...marked].map((upTo) => () => callTool("clear_conversation", { up_to: upTo })),
    unsent: {
      nothing: "Praxis could not be reached: the Conversation was not cleared.",
      notAll: "Praxis could not be reached: the Conversation was not cleared.",
    },
    onProblem: (message) => props.onProblem(message),
  });
  const [marked, setMarked] = createSignal<string | null>(null);
  const everyMessage = createUniqueId();
  let clearButton: HTMLButtonElement | undefined;
  let keepButton: HTMLButtonElement | undefined;

  function mark(upTo: string | null) {
    const was = marked();
    if (was !== null) clearing.mark(was, false);
    if (upTo !== null) clearing.mark(upTo, true);
    setMarked(upTo);
    (upTo === null ? clearButton : keepButton)?.focus();
  }

  // What the last rebuild of the meaning index said, until the screen is left.
  const [rebuilding, setRebuilding] = createSignal<string | null>(null);

  async function rebuild() {
    const rebuilt = await change("search", () => callTool("rebuild_search_index", {}));
    if (rebuilt === null) return;
    const count = rebuilt.entries_to_embed;
    setRebuilding(
      `Rebuilding from ${count} ${count === 1 ? "Entry" : "Entries"}. Search finds by words alone until it is done.`,
    );
  }

  return (
    <SettingsSection
      note={
        <>
          The Conversation with the Agent in {props.contextName}, and the index its search finds by
          meaning with.
        </>
      }
    >
      {/* The Conversation's text is kept until the person clears it, all at once (section 5.8). */}
      <SettingsGroup heading="Conversation">
        <SettingRow
          title={<span id={everyMessage}>Every Message</span>}
          description="Clearing drops every Message, and what the Agent quoted of records since removed for good with them. The Journal, its changes and the Run records stay as they are. It cannot be undone."
          control={() => (
            <Show
              when={marked() === null}
              fallback={
                <MarkedLine
                  says={CLEARED_ON_LEAVING}
                  of={everyMessage}
                  onKeep={() => mark(null)}
                  keepRef={(button) => {
                    keepButton = button;
                  }}
                />
              }
            >
              <button
                ref={clearButton}
                type="button"
                class="quiet"
                // Nothing to clear until a Message is read: none yet, or none read.
                disabled={newest.at() === null}
                onClick={() => mark(newest.at())}
              >
                Clear the Conversation
              </button>
            </Show>
          )}
        />
      </SettingsGroup>
      {/* The meaning index is derived and kept outside the Context, so it can always be thrown
        away and made again from the Journal (section 9.4). */}
      <SettingsGroup
        heading="Search by meaning"
        problem={problemAt("search")}
        below={
          <p class="settings-said" role="status">
            {rebuilding() ?? ""}
          </p>
        }
      >
        <SettingRow
          title="The index"
          description="Derived from the Journal, so it can always be made again from it"
          control={() => (
            <button type="button" class="quiet" disabled={sending()} onClick={() => void rebuild()}>
              Rebuild from the Journal
            </button>
          )}
        />
      </SettingsGroup>
    </SettingsSection>
  );
}

/**
 * The time of the newest Message the screen has read in the Conversation, as `clear_conversation`
 * takes it, so the Device's clock plays no part: a Message from the person when it was sent, a
 * Brief or a Review when it was taken. Read as the section opens and followed down the live
 * channel; null with none read.
 */
function newestMessage() {
  const callTool = useCallTool();
  const live = useLive();
  const [at, setAt] = createSignal<string | null>(null);
  const take = (messages: Message[]) => {
    const times = messages.flatMap((message) =>
      message.from === "person" ? [message.at] : message.clock ? [message.clock.taken] : [],
    );
    const now = at();
    const latest = [...times, ...(now === null ? [] : [now])].sort().at(-1);
    setAt(latest ?? null);
  };
  const newestPage = latestRead(async (current) => {
    try {
      const page = await callTool("list_messages", {});
      if (!current() || !page.ok) return;
      setAt(null);
      take(page.value.items);
    } catch {
      // Unread, there is nothing to clear up to.
    }
  });
  onMount(async () => {
    await live.ready;
    await newestPage.read();
  });
  onCleanup(
    live.listen({
      message: (message) => take([message]),
      cleared: () => newestPage.read(),
      rejoined: () => newestPage.read(),
    }),
  );
  return { at };
}

/** A day of the week as the Device's language names it, in full or shortened. */
export function weekdayName(day: Weekday, width: "long" | "short"): string {
  // 2026-11-16 was a Monday, and the days run from Monday.
  const monday = Date.UTC(2026, 10, 16);
  return new Intl.DateTimeFormat(undefined, { weekday: width, timeZone: "UTC" }).format(
    monday + weekdays.indexOf(day) * 24 * 60 * 60 * 1000,
  );
}

/** The Context's time zone by the place it is named for, as the phone's list of sections shows it. */
export function generalListed(settings: Settings): string {
  const zone = settings.time_zone;
  return (zone.split("/").at(-1) ?? zone).replaceAll("_", " ");
}

/**
 * When the Brief and the Review come, as in "7:00 AM · Sun", or that neither does, as the phone's
 * list of sections shows it.
 */
export function briefAndReviewListed(settings: Settings): string {
  const brief = settings.brief_time === null ? [] : [timeOfDay(settings.brief_time)];
  const review = settings.review_time === null ? [] : [weekdayName(settings.review_day, "short")];
  return [...brief, ...review].join(" · ") || "Off";
}

/** A time of day, "HH:MM", as the Device's language writes it. */
function timeOfDay(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(1970, 0, 1, hours, minutes));
}

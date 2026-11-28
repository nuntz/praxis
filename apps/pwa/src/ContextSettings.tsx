import {
  FIRST_TIMES,
  namedZone,
  type Settings,
  type ToolResult,
  type Weekday,
  weekdays,
} from "@praxis/domain";
import { createSignal, For, Show } from "solid-js";
import { SettingRow, SettingsGroup, SwitchInput } from "./design/SettingRows.tsx";
import { deviceTimeZone } from "./device.ts";
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

/**
 * Conversation and search, in Settings: the rare, heavy actions on the current Context, clearing
 * its Conversation and rebuilding its search index (section 8.6).
 */
export function ConversationAndSearch(props: { contextName: string }) {
  const callTool = useCallTool();
  const { change, sending, problemAt } = sectionChanges();

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

  // Whether the person has asked to clear the Conversation and is being asked to be sure, and what
  // the last clear said, until the screen is left.
  const [confirming, setConfirming] = createSignal(false);
  const [cleared, setCleared] = createSignal<string | null>(null);

  async function clear() {
    if ((await change("conversation", () => callTool("clear_conversation", {}))) === null) return;
    setConfirming(false);
    setCleared("The Conversation is cleared. The next Message starts it afresh.");
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
      <SettingsGroup
        heading="Conversation"
        problem={problemAt("conversation")}
        below={
          <p class="settings-said" role="status">
            {cleared() ?? ""}
          </p>
        }
      >
        <SettingRow
          title="Every Message"
          description="Clearing drops every Message, and what the Agent quoted of records since removed for good with them. The Journal, its changes and the Run records stay as they are. It cannot be undone."
          control={() => (
            <Show
              when={confirming()}
              fallback={
                <button
                  type="button"
                  disabled={sending()}
                  onClick={() => {
                    setCleared(null);
                    setConfirming(true);
                  }}
                >
                  Clear the Conversation
                </button>
              }
            >
              <div class="clear-conversation-actions">
                <button type="button" disabled={sending()} onClick={() => void clear()}>
                  Clear it for good
                </button>
                <button type="button" class="quiet" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </div>
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
            <button type="button" disabled={sending()} onClick={() => void rebuild()}>
              Rebuild from the Journal
            </button>
          )}
        />
      </SettingsGroup>
    </SettingsSection>
  );
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

import { FIRST_TIMES, namedZone, type Settings, type Weekday, weekdays } from "@praxis/domain";
import { createSignal, For, Show } from "solid-js";
import { SettingRow, SettingsGroup, SwitchInput } from "./design/SettingRows.tsx";
import { SettlingField } from "./SettlingField.tsx";
import { unreachableMessage, useCallTool } from "./tools.ts";

/** The time zone this Device is in, as its browser names it. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * A change to the current Context's settings as it is sent: whether one is out, what was refused,
 * and a way to send one, showing the settings as it answered. Every tool that changes them answers
 * as `set_time_zone` does.
 */
function settingsChange(onChanged: (settings: Settings) => void) {
  const callTool = useCallTool();
  const [holding, setHolding] = createSignal(0);
  const [problem, setProblem] = createSignal<string | null>(null);
  let queued: Promise<boolean> = Promise.resolve(true);

  /**
   * A change, sent once every change before it is answered, so they land in the order they were
   * made, and `send` reads the settings as the ones before it left them. One made by a control
   * holds the others while it is out (`holds`). A time sent as its field is left holds nothing: the
   * press that left it lands as meant, and its change waits behind the time's.
   */
  function change(send: () => ReturnType<typeof callTool<"set_time_zone">>, { holds = true } = {}) {
    if (holds) setHolding((count) => count + 1);
    const sent = queued
      .then(() => sendNow(send))
      .finally(() => {
        if (holds) setHolding((count) => count - 1);
      });
    queued = sent;
    return sent;
  }

  async function sendNow(send: () => ReturnType<typeof callTool<"set_time_zone">>) {
    try {
      const result = await send();
      if (!result.ok) {
        setProblem(result.error.message);
        return false;
      }
      setProblem(null);
      onChanged(result.value.record);
      return true;
    } catch (error) {
      setProblem(unreachableMessage(error));
      return false;
    }
  }
  const sending = () => holding() > 0;
  return { callTool, sending, problem, change };
}

/**
 * General, in Settings: the current Context's time zone (section 8.6). Travel changes nothing by
 * itself: when this Device is in another time zone, both are shown here with one tap to switch,
 * and nowhere else is it raised.
 */
export function GeneralSettings(props: {
  settings: Settings;
  onChanged: (settings: Settings) => void;
}) {
  const { callTool, sending, problem, change } = settingsChange(props.onChanged);
  const device = deviceTimeZone();
  // Named as this browser names it, so one zone known by two names is not told apart.
  const differs = () => namedZone(props.settings.time_zone) !== device;

  const useDeviceZone = () => change(() => callTool("set_time_zone", { time_zone: device }));

  return (
    <section id="general" class="settings" aria-labelledby="general-heading">
      <h2 id="general-heading" class="column-heading">
        General
      </h2>
      <p class="settings-note">
        Today, due dates and every time shown in {props.settings.name} are in its time zone.
      </p>
      <SettingsGroup heading="Time zone">
        <SettingRow
          title="This Context"
          control={() => <span data-testid="time-zone">{props.settings.time_zone}</span>}
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
      <Problem message={problem()} />
    </section>
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
  const { callTool, sending, problem, change } = settingsChange(props.onChanged);

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
    change(() => callTool("set_brief_time", { time }), options);
  const setReview = (time: string | null, options?: { holds: boolean }) =>
    change(() => callTool("set_review_time", { time }), options);
  /** The Review's day, with its time as the changes before it leave it, a time just sent among them. */
  const setReviewDay = (day: Weekday) =>
    change(() => callTool("set_review_time", { day, time: props.settings.review_time }));

  return (
    <section id="brief-and-review" class="settings" aria-labelledby="brief-and-review-heading">
      <h2 id="brief-and-review-heading" class="column-heading">
        Brief and Review
      </h2>
      <p class="settings-note">
        The Agent looks over {props.settings.name} on its own and leaves what it finds in the
        Conversation. Times are in {props.settings.time_zone}, this Context's time zone.
      </p>
      <SettingsGroup heading="Brief, each day">
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
      <SettingsGroup heading="Review, each week">
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
      <SettingsGroup heading="Notifications">
        <SettingRow
          title="Tell my Devices when the Brief or the Review is ready"
          description="Each Device whose Notifications are on, in Devices"
          labels
          control={(ids) => (
            <SwitchInput
              id={ids.id}
              aria-describedby={ids.describedBy}
              checked={props.settings.notifications}
              disabled={sending()}
              onTurn={(on) => change(() => callTool("set_notifications", { on }))}
            />
          )}
        />
      </SettingsGroup>
      <Problem message={problem()} />
    </section>
  );
}

/**
 * Conversation and search, in Settings: the rare, heavy actions on the current Context, clearing
 * its Conversation and rebuilding its search index (section 8.6).
 */
export function ConversationAndSearch(props: { contextName: string }) {
  const callTool = useCallTool();
  const [sending, setSending] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  // What the last rebuild of the meaning index said, until the screen is left.
  const [rebuilding, setRebuilding] = createSignal<string | null>(null);

  async function rebuild() {
    setSending(true);
    try {
      const result = await callTool("rebuild_search_index", {});
      if (!result.ok) return setProblem(result.error.message);
      setProblem(null);
      const count = result.value.entries_to_embed;
      setRebuilding(
        `Rebuilding from ${count} ${count === 1 ? "Entry" : "Entries"}. Search finds by words alone until it is done.`,
      );
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  // Whether the person has asked to clear the Conversation and is being asked to be sure, and what
  // the last clear said, until the screen is left.
  const [confirming, setConfirming] = createSignal(false);
  const [cleared, setCleared] = createSignal<string | null>(null);

  async function clear() {
    setSending(true);
    try {
      const result = await callTool("clear_conversation", {});
      if (!result.ok) return setProblem(result.error.message);
      setProblem(null);
      setConfirming(false);
      setCleared("The Conversation is cleared. The next Message starts it afresh.");
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      id="conversation-and-search"
      class="settings"
      aria-labelledby="conversation-and-search-heading"
    >
      <h2 id="conversation-and-search-heading" class="column-heading">
        Conversation and search
      </h2>
      <p class="settings-note">
        The Conversation with the Agent in {props.contextName}, and the index its search finds by
        meaning with.
      </p>
      {/* The Conversation's text is kept until the person clears it, all at once (section 5.8). */}
      <SettingsGroup heading="Conversation">
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
      <p class="setting-note" role="status">
        {cleared() ?? ""}
      </p>
      {/* The meaning index is derived and kept outside the Context, so it can always be thrown
        away and made again from the Journal (section 9.4). */}
      <SettingsGroup heading="Search by meaning">
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
      <p class="setting-note" role="status">
        {rebuilding() ?? ""}
      </p>
      <Problem message={problem()} />
    </section>
  );
}

function Problem(props: { message: string | null }) {
  return (
    <Show when={props.message}>
      {(message) => (
        <p class="problem" role="alert">
          {message()}
        </p>
      )}
    </Show>
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

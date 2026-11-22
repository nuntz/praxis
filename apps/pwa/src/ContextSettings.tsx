import { FIRST_TIMES, namedZone, type Settings, type Weekday, weekdays } from "@praxis/domain";
import { createSignal, For, Show } from "solid-js";
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
  const [sending, setSending] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  async function change(send: () => ReturnType<typeof callTool<"set_time_zone">>) {
    setSending(true);
    try {
      const result = await send();
      if (!result.ok) return setProblem(result.error.message);
      setProblem(null);
      onChanged(result.value.record);
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }
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
      <dl class="setting">
        <dt>Time zone</dt>
        <dd data-testid="time-zone">{props.settings.time_zone}</dd>
        <Show when={differs()}>
          <dt>This Device</dt>
          <dd data-testid="device-time-zone">{device}</dd>
        </Show>
      </dl>
      <Show when={differs()}>
        <button type="button" disabled={sending()} onClick={() => void useDeviceZone()}>
          Use {device}
        </button>
      </Show>
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

  const setBrief = (time: string | null) => change(() => callTool("set_brief_time", { time }));
  const setReview = (input: { day?: Weekday; time: string | null }) =>
    change(() => callTool("set_review_time", input));

  return (
    <section id="brief-and-review" class="settings" aria-labelledby="brief-and-review-heading">
      <h2 id="brief-and-review-heading" class="column-heading">
        Brief and Review
      </h2>
      <p class="settings-note">
        The Agent looks over {props.settings.name} on its own and leaves what it finds in the
        Conversation. Times are in {props.settings.time_zone}, this Context's time zone.
      </p>
      <fieldset class="clock-setting">
        <legend>Brief, each day</legend>
        <label>
          <input
            type="checkbox"
            checked={briefOn()}
            disabled={sending()}
            onChange={(event) => void setBrief(event.currentTarget.checked ? briefTime() : null)}
          />{" "}
          On
        </label>
        <label>
          Brief time{" "}
          <input
            type="time"
            value={props.settings.brief_time ?? briefTime()}
            disabled={sending() || !briefOn()}
            onChange={(event) => {
              const time = event.currentTarget.value;
              if (time === "") return;
              setBriefTime(time);
              void setBrief(time);
            }}
          />
        </label>
      </fieldset>
      <fieldset class="clock-setting">
        <legend>Review, each week</legend>
        <label>
          <input
            type="checkbox"
            checked={reviewOn()}
            disabled={sending()}
            onChange={(event) =>
              void setReview({ time: event.currentTarget.checked ? reviewTime() : null })
            }
          />{" "}
          On
        </label>
        <label>
          Review day{" "}
          <select
            value={props.settings.review_day}
            disabled={sending()}
            onChange={(event) =>
              void setReview({
                day: event.currentTarget.value as Weekday,
                time: props.settings.review_time,
              })
            }
          >
            <For each={weekdays}>{(day) => <option value={day}>{dayNamed(day)}</option>}</For>
          </select>
        </label>
        <label>
          Review time{" "}
          <input
            type="time"
            value={props.settings.review_time ?? reviewTime()}
            disabled={sending() || !reviewOn()}
            onChange={(event) => {
              const time = event.currentTarget.value;
              if (time === "") return;
              setReviewTime(time);
              void setReview({ time });
            }}
          />
        </label>
      </fieldset>
      {/* One switch for both, beside their times (ADR 0013). A Device is sent one only while
        Notifications are switched on there too, in the Deployment's settings. */}
      <fieldset class="clock-setting">
        <legend>Notifications</legend>
        <label>
          <input
            type="checkbox"
            checked={props.settings.notifications}
            disabled={sending()}
            onChange={(event) =>
              void change(() => callTool("set_notifications", { on: event.currentTarget.checked }))
            }
          />{" "}
          Tell my Devices when the Brief or the Review is ready
        </label>
      </fieldset>
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
      <fieldset class="clock-setting">
        <legend>Conversation</legend>
        <p class="setting-note">
          Clearing drops every Message, and what the Agent quoted of records since removed for good
          with them. The Journal, its changes and the Run records stay as they are. It cannot be
          undone.
        </p>
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
        <p class="setting-note" role="status">
          {cleared() ?? ""}
        </p>
      </fieldset>
      {/* The meaning index is derived and kept outside the Context, so it can always be thrown
        away and made again from the Journal (section 9.4). */}
      <fieldset class="clock-setting">
        <legend>Search by meaning</legend>
        <button type="button" disabled={sending()} onClick={() => void rebuild()}>
          Rebuild from the Journal
        </button>
        <p class="setting-note" role="status">
          {rebuilding() ?? ""}
        </p>
      </fieldset>
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

/** A day of the week as the Device's language names it. */
function dayNamed(day: Weekday): string {
  // 2026-11-16 was a Monday, and the days run from Monday.
  const monday = Date.UTC(2026, 10, 16);
  return new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" }).format(
    monday + weekdays.indexOf(day) * 24 * 60 * 60 * 1000,
  );
}

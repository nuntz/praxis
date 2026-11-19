import { FIRST_TIMES, namedZone, type Settings, type Weekday, weekdays } from "@praxis/domain";
import { createSignal, For, Show } from "solid-js";
import { unreachableMessage, useCallTool } from "./tools.ts";

/** The time zone this Device is in, as its browser names it. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The current Context's settings. Travel changes nothing by itself: when this Device is in another
 * time zone, both are shown here with one tap to switch, and nowhere else is it raised.
 */
export function ContextSettings(props: {
  settings: Settings;
  onChanged: (settings: Settings) => void;
}) {
  const callTool = useCallTool();
  const [sending, setSending] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const device = deviceTimeZone();
  // Named as this browser names it, so one zone known by two names is not told apart.
  const differs = () => namedZone(props.settings.time_zone) !== device;

  /** Send a change to the settings, and show them as it answered. */
  async function change(send: () => ReturnType<typeof callTool<"set_time_zone">>) {
    setSending(true);
    try {
      const result = await send();
      if (!result.ok) return setProblem(result.error.message);
      setProblem(null);
      props.onChanged(result.value.record);
    } catch (error) {
      setProblem(unreachableMessage(error));
    } finally {
      setSending(false);
    }
  }

  const useDeviceZone = () => change(() => callTool("set_time_zone", { time_zone: device }));

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
    <section id="context-settings" class="settings" aria-labelledby="settings-heading">
      <h2 id="settings-heading" class="column-heading">
        Settings for {props.settings.name}
      </h2>
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
      {/* The Brief and the Review: when each comes, in the Context's time zone, or off. */}
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
      <Show when={problem()}>
        {(message) => (
          <p class="problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </section>
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

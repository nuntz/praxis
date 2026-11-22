import { addDays, type Day, dayIn, utcMidnight } from "@praxis/domain";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";

/** A day older than yesterday as the Device's locale writes it: its weekday and its date. */
const dated = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** The same, for a day of another year than today's. */
const datedWithYear = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Today", "Yesterday", or the weekday and the date, against today. A day has no zone of its own. */
function dayLabel(day: Day, today: Day): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const format = day.slice(0, 4) === today.slice(0, 4) ? dated : datedWithYear;
  return format.format(utcMidnight(day));
}

/**
 * The days a column of the Journal or the Conversation is parted into (section 8.1): a caption
 * before the first item of each day, by the Context's time zone, the zone its times are shown in.
 * "Today" and "Yesterday" are against the Context's today, which moves on at its midnight. Until
 * the zone is known, nothing is parted.
 */
export function partIntoDays(timeZone: () => string | undefined) {
  const [now, setNow] = createSignal(Date.now());
  const ticking = setInterval(() => setNow(Date.now()), 60 * 1000);
  onCleanup(() => clearInterval(ticking));
  const today = createMemo(() => {
    const zone = timeZone();
    return zone === undefined ? undefined : dayIn(now(), zone);
  });

  function dayOf(at: string | number | undefined): Day | undefined {
    const zone = timeZone();
    if (zone === undefined || at === undefined) return undefined;
    return dayIn(new Date(at).getTime(), zone);
  }

  /**
   * The caption of the day an item made at `at` falls on, as an item of its list, where the one
   * before it, made at `before`, fell on another day or there is none. An item whose time is not
   * known starts no day.
   */
  function DayStart(props: {
    at: string | number | undefined;
    before: string | number | undefined;
  }) {
    const label = createMemo(() => {
      const day = dayOf(props.at);
      const against = today();
      if (day === undefined || against === undefined) return null;
      if (props.before !== undefined && dayOf(props.before) === day) return null;
      return dayLabel(day, against);
    });
    return (
      <Show when={label()}>
        {(shown) => (
          <li class="day">
            <h3 class="day-label">{shown()}</h3>
          </li>
        )}
      </Show>
    );
  }

  return { DayStart };
}

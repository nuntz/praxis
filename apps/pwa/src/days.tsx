import { addDays, type Day, dayIn, utcMidnight } from "@praxis/domain";
import { createMemo, createSignal, Show } from "solid-js";

/** How a day's weekday is written: in full in a caption, shortened beside a time. */
type Weekday = "long" | "short";

/**
 * A day older than yesterday as the Device's locale writes it, its weekday and its date, by how
 * its weekday is written and whether the day is of another year than today's. A Day is a date,
 * read at its midnight in UTC, so it has no zone of its own.
 */
const dated: Record<Weekday, Record<"thisYear" | "anotherYear", Intl.DateTimeFormat>> = {
  long: {
    thisYear: new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    anotherYear: new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }),
  },
  short: {
    thisYear: new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    anotherYear: new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }),
  },
};

/**
 * The time now by this Device's clock, moved on every minute, so that today, wherever the screen
 * reckons it, moves on at midnight with nothing else changing.
 */
const [now, setNow] = createSignal(Date.now());
setInterval(() => setNow(Date.now()), 60 * 1000);

/** Today in a time zone, the Context's, moving on at its midnight: one today for the screen. */
export function todayIn(zone: string): Day {
  return dayIn(now(), zone);
}

/** The year a day falls in. */
const yearOf = (day: Day) => new Date(utcMidnight(day)).getUTCFullYear();

/**
 * "Today", "Yesterday", or the weekday and the date, with a year only for another year than
 * today's, against today. A day has no zone of its own.
 */
function dayLabel(day: Day, today: Day, weekday: Weekday = "long"): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const format = dated[weekday][yearOf(day) === yearOf(today) ? "thisYear" : "anotherYear"];
  return format.format(utcMidnight(day));
}

/** A range of days as the Device's locale writes it, by whether either day is of another year. */
const ranged: Record<"thisYear" | "anotherYear", Intl.DateTimeFormat> = {
  thisYear: new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }),
  anotherYear: new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }),
};

/**
 * A range of days, both ends included, as the Device's locale writes it: "Nov 3 – 9", or one day
 * alone when both ends are the same, with a year only when either is of another year than today's.
 */
export function daysSaid(from: Day, to: Day, today: Day): string {
  const year = yearOf(today);
  const format = ranged[yearOf(from) === year && yearOf(to) === year ? "thisYear" : "anotherYear"];
  return format.formatRange(utcMidnight(from), utcMidnight(to));
}

/**
 * When something was made, where no day's caption is over it, as in what a search finds: its day
 * as the Journal's captions reckon it in a zone, the Context's, with the weekday shortened, then
 * the time of day there, "Today · 4:41 PM" or "Wed, Nov 18 · 7:55 PM". It moves on at midnight
 * there, as today does.
 */
export function dayAndTimeIn(zone: string): (at: string) => string {
  const timeOfDay = new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: zone });
  return (at) => {
    const instant = new Date(at).getTime();
    const day = dayLabel(dayIn(instant, zone), todayIn(zone), "short");
    return `${day} · ${timeOfDay.format(instant)}`;
  };
}

/**
 * The days a column of the Journal or the Conversation is parted into (section 8.1): a caption
 * before the first item of each day, by the Context's time zone, the zone its times are shown in.
 * "Today" and "Yesterday" are against the Context's today, which moves on at its midnight. Until
 * the zone is known, nothing is parted.
 */
export function partIntoDays(timeZone: () => string | undefined) {
  const today = createMemo(() => {
    const zone = timeZone();
    return zone === undefined ? undefined : todayIn(zone);
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

import { success, written } from "@praxis/domain";
import { restartSchedule } from "../clock-rows.ts";
import type { Handlers } from "../registry.ts";
import {
  contextEffect,
  readSettings,
  setBriefTime,
  setNotifications,
  setReviewTime,
  setTimeZone,
  timeZoneOf,
} from "../settings.ts";

export const settingsTools: Pick<
  Handlers,
  "get_settings" | "set_time_zone" | "set_brief_time" | "set_review_time" | "set_notifications"
> = {
  get_settings({ arrivedAt, sql }) {
    return success(readSettings(sql, arrivedAt));
  },

  set_time_zone({ input, arrivedAt, sql }) {
    // The schema gives the zone as the runtime names it, so one zone written two ways is one.
    if (input.time_zone === timeZoneOf(sql)) {
      return success(written(readSettings(sql, arrivedAt), []));
    }
    // A Due Date and a Defer Date are days, so nothing else moves: only today shifts.
    setTimeZone(sql, input.time_zone);
    // A Brief or Review whose time the new zone has already passed today starts none at once.
    const now = readSettings(sql, arrivedAt);
    restartSchedule(sql, "brief", arrivedAt, now.brief_time !== null);
    restartSchedule(sql, "review", arrivedAt, now.review_time !== null);
    return success(written(readSettings(sql, arrivedAt), [contextEffect(sql)]));
  },

  set_brief_time({ input, arrivedAt, sql }) {
    if (input.time === readSettings(sql, arrivedAt).brief_time) {
      return success(written(readSettings(sql, arrivedAt), []));
    }
    setBriefTime(sql, input.time);
    // Only a Brief that comes after the change is due: none comes at once for a time gone by.
    restartSchedule(sql, "brief", arrivedAt, input.time !== null);
    return success(written(readSettings(sql, arrivedAt), [contextEffect(sql)]));
  },

  set_review_time({ input, arrivedAt, sql }) {
    const now = readSettings(sql, arrivedAt);
    const day = input.day ?? now.review_day;
    if (day === now.review_day && input.time === now.review_time) {
      return success(written(now, []));
    }
    setReviewTime(sql, day, input.time);
    restartSchedule(sql, "review", arrivedAt, input.time !== null);
    return success(written(readSettings(sql, arrivedAt), [contextEffect(sql)]));
  },

  set_notifications({ input, arrivedAt, sql }) {
    if (input.on === readSettings(sql, arrivedAt).notifications) {
      return success(written(readSettings(sql, arrivedAt), []));
    }
    setNotifications(sql, input.on);
    return success(written(readSettings(sql, arrivedAt), [contextEffect(sql)]));
  },
};

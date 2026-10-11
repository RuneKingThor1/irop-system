import { IROP } from "./config.mjs";
import * as cal from "./rules/calendar.mjs";

/**
 * The calendar in Foundry (Johnald, 2026-10-08). The date is Foundry's own world time
 * (game.time.worldTime, in seconds), so effects, combat and other packages keep the same
 * clock; the calendar that reads it is the GM's, in a world setting, and is handed to
 * Foundry as its world calendar too. Apart from the Strategy Layer, but shown there (the
 * War Room bar, briefings, turn reports) while the GM leaves that on, and a turn can
 * move the date on.
 */

const SYSTEM = "irop";

let cached = null;

/** The calendar in force: the GM's, made whole, else the Gregorian calendar. */
export function getCalendar() {
  if ( cached ) return cached;
  let saved = {};
  try { saved = game.settings.get(SYSTEM, "calendar") ?? {}; }
  catch { saved = {}; }
  cached = cal.normalizeCalendar(saved);
  return cached;
}

/** Forget the calendar read, after the GM saved a new one. */
export function forgetCalendar() {
  cached = null;
}

/** A calendar setting, or its default before settings exist. */
function option(key, fallback) {
  try {
    const value = game.settings.get(SYSTEM, key);
    return (value === undefined) ? fallback : value;
  }
  catch {
    return fallback;
  }
}

/** Whether the date shows on the Strategy Layer: the War Room bar, briefings and turn reports. */
export function onStrategyLayer() {
  return option("calendarWarRoom", true) !== false;
}

/** Whether a small date bar shows on scenes that are not a War Room. */
export function dateBarShown() {
  return !!option("calendarDateBar", false);
}

/** How many days a turn moves the date on; 0 keeps the calendar apart from the turns. */
export function turnDays() {
  return Math.max(0, Math.min(366, Math.round(Number(option("calendarTurnDays", 7)) || 0)));
}

/* -------------------------------------------- */
/*  Today                                       */
/* -------------------------------------------- */

/** The world's time in seconds. */
export function worldTime() {
  return Number(globalThis.game?.time?.worldTime) || 0;
}

/**
 * A moment (now, by default) in words.
 * @returns {{components: object, long: string, short: string, date: string, season: string, time: string}}
 */
export function dateInfo(time = worldTime()) {
  const k = getCalendar();
  const c = cal.timeToComponents(k, time);
  return {
    components: c,
    long: cal.formatDate(k, c),
    short: cal.formatDate(k, c, { style: "short" }),
    date: cal.formatDate(k, c, { style: "date" }),
    season: cal.seasonName(k, c),
    time: cal.formatTime(c)
  };
}

/** The season the weather follows: the calendar's, from the date. */
export function weatherSeason(time = worldTime()) {
  const k = getCalendar();
  const c = cal.timeToComponents(k, time);
  return { wave: cal.warmth(k, c), name: cal.seasonName(k, c) };
}

/* -------------------------------------------- */
/*  Moving the date (GM only)                   */
/* -------------------------------------------- */

/** Set the world's time in seconds. GM only. */
export async function setWorldTime(seconds) {
  if ( !game.user?.isGM ) throw new Error("Only a GM can change the date.");
  const time = Math.max(0, Math.round(Number(seconds) || 0));
  if ( typeof game.time?.set === "function" ) return game.time.set(time);
  await game.settings.set("core", "time", time);
  return time;
}

/** Set the date (and time of day): {year, month, dayOfMonth, hour, minute}, counted from 0. GM only. */
export function setDate(parts) {
  return setWorldTime(cal.dateToTime(getCalendar(), parts));
}

/** Move the date on (or back, if negative) by whole days. GM only. Returns the new time. */
export async function advanceDays(days) {
  if ( !game.user?.isGM ) throw new Error("Only a GM can change the date.");
  const seconds = Math.round(Number(days) || 0) * cal.SECONDS_PER_DAY;
  if ( !seconds ) return worldTime();
  // Never before the calendar's first day.
  const to = Math.max(0, worldTime() + seconds);
  if ( typeof game.time?.advance === "function" ) {
    await game.time.advance(to - worldTime());
    return to;
  }
  return setWorldTime(to);
}

/**
 * A new world starts on the campaign's date, once (the calendar would otherwise open on
 * 1 January, year 0). Only where nothing has set the time yet. The active GM's client.
 */
export async function startCalendar() {
  if ( !game.user?.isGM || (game.users?.activeGM && (game.users.activeGM.id !== game.user.id)) ) return false;
  if ( option("calendarStarted", true) ) return false;
  if ( !worldTime() ) await setWorldTime(cal.dateToTime(getCalendar(), IROP.calendarStart));
  await game.settings.set(SYSTEM, "calendarStarted", true);
  return true;
}

/* -------------------------------------------- */
/*  Foundry's own calendar                      */
/* -------------------------------------------- */

/**
 * Foundry's calendar class, made to read dates the system's way: the Gregorian leap rule,
 * seasons by day, the GM's months and weekdays.
 * @param {typeof foundry.data.CalendarData} Base
 */
export function makeCalendarClass(Base) {
  return class IropCalendar extends Base {
    static iropCalendar = true;

    timeToComponents(time = 0) {
      return cal.timeToComponents(getCalendar(), time);
    }

    componentsToTime(components) {
      return cal.componentsToTime(getCalendar(), components ?? {});
    }

    isLeapYear(year) {
      return cal.isLeapYear(getCalendar(), year);
    }

    countLeapYears(year) {
      return cal.leapYearsBefore(getCalendar(), year);
    }
  };
}

/**
 * Hand the calendar to Foundry (CONFIG.time), at init and after the GM changes it. Foundry
 * builds its calendar from this as the game starts; a config it would refuse is never handed
 * over, so the game always loads.
 * @param {object} [options]
 * @param {boolean} [options.reinitialize]   Rebuild Foundry's calendar now (after a change)
 */
export function installCalendar({ reinitialize = false } = {}) {
  const time = globalThis.CONFIG?.time;
  if ( !time?.worldCalendarClass ) return false;
  try {
    if ( !time.worldCalendarClass.iropCalendar ) time.worldCalendarClass = makeCalendarClass(time.worldCalendarClass);
    const config = cal.toCoreConfig(getCalendar());
    new time.worldCalendarClass(foundry.utils.deepClone(config), { strict: true });
    time.worldCalendarConfig = config;
    if ( reinitialize ) game.time?.initializeCalendar?.();
    return true;
  }
  catch(err) {
    console.warn("irop | Foundry did not take the calendar; its own stays in place.", err);
    return false;
  }
}

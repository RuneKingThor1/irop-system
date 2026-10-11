/**
 * The calendar (Johnald, 2026-10-08): its own thing, apart from the Strategy Layer, though
 * it shows there when the GM turns that on. A GM can edit it (months, weekdays, leap years,
 * seasons, a word after the year) without going as far as the calendar modules do; it
 * starts as the Gregorian calendar.
 *
 * Foundry keeps the world's time as seconds (game.time.worldTime). This file turns those
 * seconds into a date and back. Time 0 is the first moment of 1 January, year 0, as Foundry
 * counts it, and a day is 24 hours. Kept apart from Foundry so it can be tested on its own.
 *
 * A calendar: {name, months [{name, abbr, days, leapDays}], weekdays [{name, abbr}],
 * leap {rule, every, start}, seasons [{name, month, day}], firstWeekday, era}. Months and
 * weekdays count from 0; a season starts on its month (from 0) and day (from 1) each year.
 */

export const SECONDS_PER_DAY = 86400;

/** How leap years fall. */
export const LEAP_RULES = {
  gregorian: "Gregorian: every 4th year, but not a century unless it divides by 400",
  every: "Every few years",
  none: "None"
};

const MONTHS = [
  ["January", 31], ["February", 28, 29], ["March", 31], ["April", 30], ["May", 31], ["June", 30],
  ["July", 31], ["August", 31], ["September", 30], ["October", 31], ["November", 30], ["December", 31]
];

/**
 * The standard Gregorian calendar, the week from Sunday. Seasons are the weather's
 * (meteorological) seasons, as Foundry's own calendar has them: spring from 1 March.
 * 1 January of year 0, counted back the Gregorian way, was a Saturday.
 */
export const GREGORIAN = Object.freeze({
  name: "Gregorian",
  months: MONTHS.map(([name, days, leapDays]) => Object.freeze({ name, abbr: name.slice(0, 3), days, leapDays: leapDays ?? null })),
  weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(name => Object.freeze({ name, abbr: name.slice(0, 3) })),
  leap: Object.freeze({ rule: "gregorian", every: 4, start: 0 }),
  seasons: [["Spring", 2], ["Summer", 5], ["Autumn", 8], ["Winter", 11]].map(([name, month]) => Object.freeze({ name, month, day: 1 })),
  firstWeekday: 6,
  era: ""
});

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const mod = (n, m) => ((n % m) + m) % m;

/** A list from the form (an object keyed 0, 1, 2...) or an array. */
function asList(value) {
  if ( Array.isArray(value) ) return value;
  if ( value && (typeof value === "object") ) {
    return Object.keys(value).sort((a, b) => Number(a) - Number(b)).map(k => value[k]);
  }
  return null;
}

/**
 * A calendar made whole and safe: anything missing comes from the Gregorian calendar,
 * numbers are whole and in range, and there is always a month and a weekday.
 * @param {object} [input]
 * @returns {object}
 */
export function normalizeCalendar(input = {}) {
  const src = (input && (typeof input === "object")) ? input : {};
  const text = (value, fallback) => String(value ?? "").trim() || fallback;
  const whole = (value, fallback, min, max) => {
    const n = Math.round(Number(value));
    return ((value === "") || (value === null) || !Number.isFinite(n)) ? fallback : clamp(n, min, max);
  };

  const monthsIn = asList(src.months);
  const months = (monthsIn?.length ? monthsIn : GREGORIAN.months).map((m, i) => {
    const name = text(m?.name, `Month ${i + 1}`);
    const days = whole(m?.days, 30, 1, 999);
    const leapDays = whole(m?.leapDays, null, 1, 999);
    return { name, abbr: text(m?.abbr, name.slice(0, 3)), days, leapDays: ((leapDays === null) || (leapDays === days)) ? null : leapDays };
  });

  const weekdaysIn = asList(src.weekdays);
  const weekdays = (weekdaysIn?.length ? weekdaysIn : GREGORIAN.weekdays).map((d, i) => {
    const name = text(d?.name, `Day ${i + 1}`);
    return { name, abbr: text(d?.abbr, name.slice(0, 3)) };
  });

  const leapIn = src.leap ?? GREGORIAN.leap;
  const leap = {
    rule: (leapIn?.rule in LEAP_RULES) ? leapIn.rule : "gregorian",
    every: whole(leapIn?.every, 4, 2, 1000),
    start: whole(leapIn?.start, 0, 0, 1000000)
  };

  // No seasons given at all: the Gregorian ones. An empty list: no seasons.
  const seasonsIn = asList(src.seasons) ?? GREGORIAN.seasons;
  const seasons = seasonsIn.map((s, i) => {
    const month = whole(s?.month, 0, 0, months.length - 1);
    return { name: text(s?.name, `Season ${i + 1}`), month, day: whole(s?.day, 1, 1, months[month].leapDays ?? months[month].days) };
  });

  return {
    name: text(src.name, monthsIn?.length ? "Calendar" : GREGORIAN.name),
    months,
    weekdays,
    leap,
    seasons,
    firstWeekday: mod(whole(src.firstWeekday, GREGORIAN.firstWeekday, -1e6, 1e6), weekdays.length),
    era: String(src.era ?? "").trim().slice(0, 24)
  };
}

/** Whether two calendars are the same in every rule (the Gregorian check in the editor). */
export function sameCalendar(a, b) {
  return JSON.stringify(normalizeCalendar(a)) === JSON.stringify(normalizeCalendar(b));
}

/* -------------------------------------------- */
/*  Years                                       */
/* -------------------------------------------- */

/** Whether a year is a leap year. */
export function isLeapYear(cal, year) {
  const y = Math.floor(Number(year) || 0);
  switch ( cal.leap?.rule ) {
    case "gregorian": return (mod(y, 4) === 0) && ((mod(y, 100) !== 0) || (mod(y, 400) === 0));
    case "every": return (y >= cal.leap.start) && (((y - cal.leap.start) % cal.leap.every) === 0);
    default: return false;
  }
}

/** How many leap years come before a year (from year 0). */
export function leapYearsBefore(cal, year) {
  const y = Math.max(0, Math.floor(Number(year) || 0));
  if ( !y ) return 0;
  switch ( cal.leap?.rule ) {
    case "gregorian": {
      const n = y - 1;
      return Math.floor(n / 4) - Math.floor(n / 100) + Math.floor(n / 400) + 1;
    }
    case "every": return (y <= cal.leap.start) ? 0 : Math.ceil((y - cal.leap.start) / cal.leap.every);
    default: return 0;
  }
}

/** The days in a month, in a leap year or not. */
export function monthDays(cal, month, leap = false) {
  const m = cal.months[month] ?? cal.months[0];
  return leap ? (m.leapDays ?? m.days) : m.days;
}

/** The days in a common year, and how many a leap year adds. */
function commonDays(cal) {
  return cal.months.reduce((n, m) => n + m.days, 0);
}
function leapExtra(cal) {
  return cal.months.reduce((n, m) => n + ((m.leapDays ?? m.days) - m.days), 0);
}

/** The days in a year. */
export function yearDays(cal, year) {
  return commonDays(cal) + (isLeapYear(cal, year) ? leapExtra(cal) : 0);
}

/** Days from time 0 to the first day of a year. */
export function daysBeforeYear(cal, year) {
  const y = Math.max(0, Math.floor(Number(year) || 0));
  return (y * commonDays(cal)) + (leapYearsBefore(cal, y) * leapExtra(cal));
}

/* -------------------------------------------- */
/*  Days, dates and seconds                     */
/* -------------------------------------------- */

/** A day count from time 0 as a date: {year, month, dayOfMonth, dayOfYear, leapYear}, all from 0. */
export function dayToDate(cal, total) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const rate = { gregorian: 0.2425, every: 1 / (cal.leap?.every || 4) }[cal.leap?.rule] ?? 0;
  const average = Math.max(1, commonDays(cal) + (leapExtra(cal) * rate));
  let year = Math.max(0, Math.floor(t / average));
  while ( (year > 0) && (daysBeforeYear(cal, year) > t) ) year--;
  while ( daysBeforeYear(cal, year + 1) <= t ) year++;
  const dayOfYear = t - daysBeforeYear(cal, year);
  const leapYear = isLeapYear(cal, year);
  let rest = dayOfYear;
  let month = 0;
  for ( ; month < cal.months.length - 1; month++ ) {
    const days = monthDays(cal, month, leapYear);
    if ( rest < days ) break;
    rest -= days;
  }
  return { year, month, dayOfMonth: rest, dayOfYear, leapYear };
}

/** A date as a day count from time 0. A day past the month's end is the month's last day. */
export function dateToDay(cal, { year = 0, month = 0, dayOfMonth = 0 } = {}) {
  const y = Math.max(0, Math.floor(Number(year) || 0));
  const leap = isLeapYear(cal, y);
  const m = clamp(Math.floor(Number(month) || 0), 0, cal.months.length - 1);
  let days = daysBeforeYear(cal, y);
  for ( let i = 0; i < m; i++ ) days += monthDays(cal, i, leap);
  return days + clamp(Math.floor(Number(dayOfMonth) || 0), 0, Math.max(0, monthDays(cal, m, leap) - 1));
}

/** A date and time of day as seconds from time 0. */
export function dateToTime(cal, { year = 0, month = 0, dayOfMonth = 0, hour = 0, minute = 0, second = 0 } = {}) {
  return (dateToDay(cal, { year, month, dayOfMonth }) * SECONDS_PER_DAY)
    + (clamp(Math.floor(Number(hour) || 0), 0, 23) * 3600)
    + (clamp(Math.floor(Number(minute) || 0), 0, 59) * 60)
    + clamp(Math.floor(Number(second) || 0), 0, 59);
}

/**
 * Seconds from time 0 as Foundry's time components: day is the day of the year, and
 * every count starts at 0.
 * @returns {{year: number, month: number, dayOfMonth: number, day: number, dayOfWeek: number,
 *   hour: number, minute: number, second: number, leapYear: boolean, season: number|undefined}}
 */
export function timeToComponents(cal, time = 0) {
  const t = Math.max(0, Number(time) || 0);
  const total = Math.floor(t / SECONDS_PER_DAY);
  let second = Math.floor(t - (total * SECONDS_PER_DAY));
  const hour = Math.floor(second / 3600);
  second -= hour * 3600;
  const minute = Math.floor(second / 60);
  second -= minute * 60;
  const date = dayToDate(cal, total);
  return {
    year: date.year, month: date.month, dayOfMonth: date.dayOfMonth, day: date.dayOfYear,
    dayOfWeek: mod(total + (cal.firstWeekday ?? 0), cal.weekdays.length),
    hour, minute, second, leapYear: date.leapYear,
    season: seasonIndex(cal, date.month, date.dayOfMonth) ?? undefined
  };
}

/**
 * Time components as seconds, as Foundry reads them: whole years from year 0, then day of
 * the year, hours, minutes and seconds (months are not read). Used for spans too, so a
 * negative year counts back.
 */
export function componentsToTime(cal, components = {}) {
  const year = Math.trunc(Number(components.year) || 0);
  const years = (year >= 0) ? daysBeforeYear(cal, year) : -daysBeforeYear(cal, -year);
  return ((years + (Number(components.day) || 0)) * SECONDS_PER_DAY) + ((Number(components.hour) || 0) * 3600)
    + ((Number(components.minute) || 0) * 60) + (Number(components.second) || 0);
}

/**
 * The same date (and time of day) in another calendar, so an edit to the calendar keeps
 * today as it reads: a month that is gone becomes the last month, a day past the end the
 * month's last day.
 */
export function carryDate(from, to, time) {
  const c = timeToComponents(from, time);
  return dateToTime(to, { ...c, month: Math.min(c.month, to.months.length - 1) });
}

/** The first weekday that puts a day (counted from time 0) on a given weekday. */
export function anchorWeekday(cal, total, weekday) {
  const n = cal.weekdays.length;
  return mod(clamp(Math.floor(Number(weekday) || 0), 0, n - 1) - Math.floor(Number(total) || 0), n);
}

/* -------------------------------------------- */
/*  Seasons                                     */
/* -------------------------------------------- */

/** Which season a date falls in: the last to start on or before it, else the year's last. */
export function seasonIndex(cal, month, dayOfMonth) {
  const seasons = cal.seasons ?? [];
  if ( !seasons.length ) return null;
  const key = (m, d) => (m * 1000) + d;
  const now = key(month, dayOfMonth + 1);
  const order = seasons.map((s, i) => ({ i, k: key(s.month, s.day) })).sort((a, b) => a.k - b.k);
  let found = order.at(-1).i;
  for ( const s of order ) if ( s.k <= now ) found = s.i;
  return found;
}

/** The season's name for some time components, or "". */
export function seasonName(cal, components) {
  return cal.seasons?.[components?.season]?.name ?? "";
}

/** Where a time sits in its year, 0 at the start, nearly 1 at the end. */
export function yearFraction(cal, c) {
  const into = ((c.hour ?? 0) * 3600) + ((c.minute ?? 0) * 60) + (c.second ?? 0);
  return ((c.day ?? 0) + (into / SECONDS_PER_DAY)) / Math.max(1, yearDays(cal, c.year ?? 0));
}

/** Where a month and day start in a common year, as a fraction. */
function fractionOf(cal, month, day) {
  let days = day - 1;
  for ( let i = 0; i < month; i++ ) days += cal.months[i].days;
  return days / Math.max(1, commonDays(cal));
}

/**
 * Where a time sits in the year's warmth, for the weather: 1 at the heart of summer, -1
 * at the heart of winter. Summer is the season named so, warmest at its middle; a
 * calendar without one is warmest at mid year.
 */
export function warmth(cal, c) {
  let peak = 0.5;
  const seasons = cal.seasons ?? [];
  const summer = seasons.find(s => /summer/i.test(s.name));
  if ( summer ) {
    const start = fractionOf(cal, summer.month, summer.day);
    const starts = seasons.map(s => fractionOf(cal, s.month, s.day)).sort((a, b) => a - b);
    const next = starts.find(s => s > start) ?? (starts[0] + 1);
    peak = start + ((next - start) / 2);
  }
  return Math.cos(2 * Math.PI * (yearFraction(cal, c) - peak));
}

/* -------------------------------------------- */
/*  Words and the month's page                  */
/* -------------------------------------------- */

/** The year as written: with the calendar's word after it, if it has one. */
export function yearText(cal, year) {
  return cal.era ? `${year} ${cal.era}` : `${year}`;
}

/**
 * A date in words. "long": Friday, 1 June 2040. "short": Fri 1 Jun 2040.
 * "date": 1 June 2040.
 */
export function formatDate(cal, c, { style = "long" } = {}) {
  const month = cal.months[c.month] ?? cal.months[0];
  const weekday = cal.weekdays[c.dayOfWeek] ?? cal.weekdays[0];
  const day = (c.dayOfMonth ?? 0) + 1;
  const year = yearText(cal, c.year ?? 0);
  if ( style === "short" ) return `${weekday.abbr} ${day} ${month.abbr} ${year}`;
  if ( style === "date" ) return `${day} ${month.name} ${year}`;
  return `${weekday.name}, ${day} ${month.name} ${year}`;
}

/** The time of day on a 24 hour clock: 08:30. */
export function formatTime(c) {
  const pad = n => String(n ?? 0).padStart(2, "0");
  return `${pad(c.hour)}:${pad(c.minute)}`;
}

/** A month and year moved on (or back) by some months. */
export function shiftMonth(cal, year, month, delta) {
  const n = cal.months.length;
  const index = (Math.max(0, Math.floor(year)) * n) + Math.floor(month) + Math.trunc(delta);
  if ( index < 0 ) return { year: 0, month: 0 };
  return { year: Math.floor(index / n), month: index % n };
}

/**
 * A month's page: its weeks as rows of days under the weekday names, blank before the
 * first and after the last. Marks today, a picked day, and the days seasons start.
 * @param {object} cal
 * @param {number} year
 * @param {number} month
 * @param {object} [options]
 * @param {object} [options.today]      Time components of today
 * @param {object} [options.selected]   {year, month, dayOfMonth} of a picked day
 */
export function monthGrid(cal, year, month, { today = null, selected = null } = {}) {
  const leap = isLeapYear(cal, year);
  const n = cal.weekdays.length;
  const first = dateToDay(cal, { year, month, dayOfMonth: 0 });
  const lead = mod(first + cal.firstWeekday, n);
  const days = monthDays(cal, month, leap);
  const starts = new Map((cal.seasons ?? []).filter(s => s.month === month).map(s => [s.day - 1, s.name]));
  const same = (c, d) => !!c && (c.year === year) && (c.month === month) && (c.dayOfMonth === d);
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i)];
  while ( cells.length % n ) cells.push(null);
  const weeks = [];
  for ( let i = 0; i < cells.length; i += n ) {
    weeks.push(cells.slice(i, i + n).map(d => ((d === null) ? { blank: true } : {
      day: d + 1, index: d, today: same(today, d), selected: same(selected, d), season: starts.get(d) ?? ""
    })));
  }
  return {
    year, month,
    title: `${cal.months[month]?.name ?? ""} ${yearText(cal, year)}`,
    weekdays: cal.weekdays.map(w => ({ abbr: w.abbr, name: w.name })),
    weeks
  };
}

/* -------------------------------------------- */
/*  Foundry's own calendar                      */
/* -------------------------------------------- */

/**
 * The calendar as Foundry's CalendarData expects it (CONFIG.time.worldCalendarConfig), so
 * Foundry and other packages name the same months and days. Foundry has no Gregorian leap
 * rule or season by day; the system's calendar class works those out itself.
 */
export function toCoreConfig(cal) {
  const common = commonDays(cal);
  const ordinal = s => Math.round(fractionOf(cal, s.month, s.day) * common) + 1;
  const sorted = [...cal.seasons].sort((a, b) => ordinal(a) - ordinal(b));
  return {
    name: cal.name,
    description: "Insurrection's calendar, set in the system's Calendar window.",
    years: {
      yearZero: 0,
      firstWeekday: cal.firstWeekday,
      leapYear: (cal.leap.rule === "none") ? null
        : { leapStart: (cal.leap.rule === "every") ? cal.leap.start : 0, leapInterval: (cal.leap.rule === "every") ? cal.leap.every : 4 }
    },
    months: {
      values: cal.months.map((m, i) => {
        const month = { name: m.name, abbreviation: m.abbr, ordinal: i + 1, days: m.days };
        if ( m.leapDays !== null ) month.leapDays = m.leapDays;
        return month;
      })
    },
    days: {
      values: cal.weekdays.map((d, i) => ({ name: d.name, abbreviation: d.abbr, ordinal: i + 1 })),
      daysPerYear: common,
      hoursPerDay: 24,
      minutesPerHour: 60,
      secondsPerMinute: 60
    },
    seasons: {
      values: sorted.map((s, i) => {
        const start = ordinal(s);
        const next = sorted[(i + 1) % sorted.length];
        const end = (sorted.length === 1) ? (start === 1 ? common : start - 1) : mod(ordinal(next) - 2, common) + 1;
        return { name: s.name, monthStart: null, monthEnd: null, dayStart: start, dayEnd: end };
      })
    }
  };
}

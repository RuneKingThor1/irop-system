import * as cal from "../rules/calendar.mjs";
import { getCalendar, dateInfo, worldTime, advanceDays, setWorldTime, turnDays, onStrategyLayer, dateBarShown } from "../calendar.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * The calendar's windows (Johnald, 2026-10-08): the Calendar everyone can open, the GM's
 * Calendar settings, and the small date bar for scenes that are not a War Room.
 */

/* -------------------------------------------- */
/*  The Calendar                                */
/* -------------------------------------------- */

/** Today and the month's page. Everyone can look; the GM moves the date. */
export class CalendarApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-calendar",
    classes: ["irop", "irop-calendar"],
    window: { title: "Calendar", icon: "fa-solid fa-calendar-days", resizable: false },
    position: { width: 420, height: "auto" },
    actions: {
      month: CalendarApp.#onMonth,
      toToday: CalendarApp.#onToToday,
      pick: CalendarApp.#onPick,
      step: CalendarApp.#onStep,
      setDate: CalendarApp.#onSetDate,
      edit: () => CalendarEditor.open()
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/calendar.hbs" }
  };

  static #instance = null;

  static open() {
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  static refresh() {
    if ( this.#instance?.rendered ) this.#instance.render();
  }

  /** The month on the page ({year, month}); today's until the pages are turned. */
  view = null;

  /** The day the GM picked ({year, month, dayOfMonth}), waiting for Set. */
  picked = null;

  /** Opened again, it opens on today. @inheritDoc */
  _onClose(options) {
    super._onClose?.(options);
    this.view = null;
    this.picked = null;
  }

  /** @override */
  async _prepareContext(options) {
    const k = getCalendar();
    const today = dateInfo();
    const c = today.components;
    const view = this.view ?? { year: c.year, month: c.month };
    const grid = cal.monthGrid(k, view.year, view.month, { today: c, selected: this.picked });
    const days = turnDays();
    return {
      today,
      grid,
      isGM: !!game.user?.isGM,
      showingToday: (view.year === c.year) && (view.month === c.month),
      picked: this.picked ? cal.formatDate(k, cal.timeToComponents(k, cal.dateToTime(k, this.picked))) : "",
      // A turn's worth of days, when turns move the date and that is not already a day or a week.
      turnStep: (days > 1) && (days !== 7) ? days : 0,
      perTurn: days
    };
  }

  static #onMonth(event, target) {
    const k = getCalendar();
    const c = dateInfo().components;
    const from = this.view ?? { year: c.year, month: c.month };
    this.view = cal.shiftMonth(k, from.year, from.month, Number(target.dataset.delta) || 0);
    return this.render();
  }

  static #onToToday() {
    this.view = null;
    return this.render();
  }

  /** The GM picks a day on the page; picking it again lets it go. */
  static #onPick(event, target) {
    if ( !game.user.isGM ) return null;
    const c = dateInfo().components;
    const view = this.view ?? { year: c.year, month: c.month };
    const day = { year: view.year, month: view.month, dayOfMonth: Number(target.dataset.day) || 0 };
    const same = this.picked && (this.picked.year === day.year) && (this.picked.month === day.month) && (this.picked.dayOfMonth === day.dayOfMonth);
    this.picked = same ? null : day;
    this.view = { year: view.year, month: view.month };
    return this.render();
  }

  /** Back or on by some days. */
  static async #onStep(event, target) {
    if ( !game.user.isGM ) return null;
    await advanceDays(Number(target.dataset.days) || 0);
    this.view = null;
    this.picked = null;
    return this.render();
  }

  /** The picked day (or today) at the time of day entered. */
  static async #onSetDate() {
    if ( !game.user.isGM ) return null;
    const k = getCalendar();
    const c = dateInfo().components;
    const day = this.picked ?? { year: c.year, month: c.month, dayOfMonth: c.dayOfMonth };
    const [hour, minute] = String(this.element.querySelector("[name=time]")?.value || cal.formatTime(c)).split(":").map(n => Number(n) || 0);
    await setWorldTime(cal.dateToTime(k, { ...day, hour, minute }));
    this.view = null;
    this.picked = null;
    return this.render();
  }
}

/* -------------------------------------------- */
/*  The GM's calendar settings                  */
/* -------------------------------------------- */

/** The rows each list keeps at least. */
const LEAST = { months: 1, weekdays: 1, seasons: 0 };

/**
 * Where the date shows, how far a turn moves it, and the calendar itself: months,
 * weekdays, leap years, seasons. GM only. Johnald, 2026-10-08: editable like the calendar
 * modules, "but not to that degree": no moons, notes or hours per day.
 */
export class CalendarEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-calendar-editor",
    tag: "form",
    classes: ["irop", "irop-calendar-editor"],
    window: { title: "Calendar settings", icon: "fa-solid fa-calendar-days", resizable: true },
    position: { width: 600, height: 720 },
    form: { handler: CalendarEditor.#onSubmit, closeOnSubmit: true },
    actions: {
      addRow: CalendarEditor.#onAddRow,
      removeRow: CalendarEditor.#onRemoveRow,
      moveRow: CalendarEditor.#onMoveRow,
      gregorian: CalendarEditor.#onGregorian
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/calendar-editor.hbs", scrollable: [".ce-body"] }
  };

  static #instance = null;

  static open() {
    if ( !game.user?.isGM ) return null;
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  /**
   * The form as it stands, not yet saved: {calendar, anchor, show {strategy, dateBar},
   * turnDays}. The anchor is the weekday today falls on, so changing the months never
   * moves it.
   */
  draft = null;

  /** Closed without saving, the edits go. @inheritDoc */
  _onClose(options) {
    super._onClose?.(options);
    this.draft = null;
  }

  /** The draft as the settings have it now. */
  static fresh() {
    return {
      calendar: foundry.utils.deepClone(getCalendar()),
      anchor: dateInfo().components.dayOfWeek,
      show: { strategy: onStrategyLayer(), dateBar: dateBarShown() },
      turnDays: turnDays()
    };
  }

  /** Read the form into the draft. */
  #readForm() {
    if ( !this.element ) return this.draft;
    const data = {};
    for ( const el of this.element?.querySelectorAll?.("[name]") ?? [] ) {
      foundry.utils.setProperty(data, el.name, (el.type === "checkbox") ? el.checked : el.value);
    }
    const list = value => (value ? Object.keys(value).sort((a, b) => Number(a) - Number(b)).map(k => value[k]) : []);
    const calendar = cal.normalizeCalendar({
      ...this.draft.calendar,
      name: data.name ?? this.draft.calendar.name,
      era: data.era ?? this.draft.calendar.era,
      leap: { ...this.draft.calendar.leap, ...(data.leap ?? {}) },
      months: data.months ? list(data.months) : this.draft.calendar.months,
      weekdays: data.weekdays ? list(data.weekdays) : this.draft.calendar.weekdays,
      seasons: data.seasons ? list(data.seasons) : []
    });
    this.draft = {
      calendar,
      anchor: Math.min(calendar.weekdays.length - 1, Math.max(0, Math.round(Number(data.anchor ?? this.draft.anchor)) || 0)),
      show: { strategy: !!data.show?.strategy, dateBar: !!data.show?.dateBar },
      turnDays: Math.max(0, Math.min(366, Math.round(Number(data.turnDays)) || 0))
    };
    return this.draft;
  }

  /** @override */
  async _prepareContext(options) {
    this.draft ??= CalendarEditor.fresh();
    const { calendar: k, anchor, show } = this.draft;
    // Today in the draft calendar, as saving would keep it.
    const time = cal.carryDate(getCalendar(), k, worldTime());
    const today = cal.timeToComponents(k, time);
    const common = k.months.reduce((n, m) => n + m.days, 0);
    const leapYear = k.months.reduce((n, m) => n + (m.leapDays ?? m.days), 0);
    const rows = (list, key) => list.map((row, i) => ({
      ...row, i, first: i === 0, last: i === list.length - 1, lone: list.length <= LEAST[key]
    }));
    return {
      calendar: k,
      months: rows(k.months, "months"),
      weekdays: rows(k.weekdays, "weekdays"),
      seasons: rows(k.seasons, "seasons").map(s => ({ ...s, monthKey: String(s.month) })),
      monthOptions: Object.fromEntries(k.months.map((m, i) => [String(i), m.name])),
      weekdayOptions: Object.fromEntries(k.weekdays.map((d, i) => [String(i), d.name])),
      anchor: String(anchor),
      leapRules: cal.LEAP_RULES,
      every: k.leap.rule === "every",
      show,
      turnDays: this.draft.turnDays,
      gregorian: cal.sameCalendar({ ...k, firstWeekday: cal.GREGORIAN.firstWeekday }, cal.GREGORIAN),
      todayDate: cal.formatDate(k, today, { style: "date" }),
      yearDays: common,
      leapYearDays: (leapYear !== common) && (k.leap.rule !== "none") ? leapYear : 0
    };
  }

  /** A change to the leap rule shows or hides its numbers. @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector('[name="leap.rule"]')?.addEventListener("change", () => {
      this.#readForm();
      this.render();
    });
  }

  static #onAddRow(event, target) {
    const draft = this.#readForm();
    const key = target.dataset.list;
    const k = draft.calendar;
    if ( key === "months" ) k.months.push({ name: `Month ${k.months.length + 1}`, abbr: "", days: 30, leapDays: null });
    else if ( key === "weekdays" ) k.weekdays.push({ name: `Day ${k.weekdays.length + 1}`, abbr: "" });
    else if ( key === "seasons" ) k.seasons.push({ name: `Season ${k.seasons.length + 1}`, month: 0, day: 1 });
    draft.calendar = cal.normalizeCalendar(k);
    return this.render();
  }

  static #onRemoveRow(event, target) {
    const draft = this.#readForm();
    const key = target.dataset.list;
    const i = Number(target.dataset.index);
    const list = draft.calendar[key];
    if ( !list || (list.length <= LEAST[key]) ) return null;
    list.splice(i, 1);
    // Today keeps its weekday when another day goes; if today's goes, the first takes it.
    if ( key === "weekdays" ) draft.anchor = (draft.anchor === i) ? 0 : (draft.anchor > i ? draft.anchor - 1 : draft.anchor);
    // Seasons follow their month when another month goes.
    if ( key === "months" ) {
      for ( const s of draft.calendar.seasons ) if ( s.month > i ) s.month -= 1;
    }
    draft.calendar = cal.normalizeCalendar(draft.calendar);
    return this.render();
  }

  static #onMoveRow(event, target) {
    const draft = this.#readForm();
    const key = target.dataset.list;
    const i = Number(target.dataset.index);
    const j = i + ((target.dataset.dir === "up") ? -1 : 1);
    const list = draft.calendar[key];
    if ( !list || (j < 0) || (j >= list.length) ) return null;
    [list[i], list[j]] = [list[j], list[i]];
    // Today keeps its weekday, wherever that day moves to.
    if ( key === "weekdays" ) draft.anchor = (draft.anchor === i) ? j : ((draft.anchor === j) ? i : draft.anchor);
    // Seasons keep their month.
    if ( key === "months" ) {
      for ( const s of draft.calendar.seasons ) s.month = (s.month === i) ? j : ((s.month === j) ? i : s.month);
    }
    draft.calendar = cal.normalizeCalendar(draft.calendar);
    return this.render();
  }

  /** Back to the standard Gregorian calendar (not saved until Save), today on its true weekday. */
  static async #onGregorian() {
    const draft = this.#readForm();
    if ( cal.sameCalendar({ ...draft.calendar, firstWeekday: cal.GREGORIAN.firstWeekday }, cal.GREGORIAN) ) return null;
    const ok = await DialogV2.confirm({
      window: { title: "Gregorian calendar" },
      content: "<p>Put the months, weekdays, leap years and seasons back to the standard Gregorian calendar? Nothing is saved until you press Save.</p>"
    });
    if ( !ok ) return null;
    const g = cal.normalizeCalendar(cal.GREGORIAN);
    draft.calendar = g;
    draft.anchor = cal.timeToComponents(g, cal.carryDate(getCalendar(), g, worldTime())).dayOfWeek;
    return this.render();
  }

  /** Save: today keeps its date (and weekday) as it reads. */
  static async #onSubmit() {
    if ( !game.user.isGM ) return;
    const draft = this.#readForm();
    const before = getCalendar();
    const time = worldTime();
    const next = cal.normalizeCalendar(draft.calendar);
    const moved = cal.carryDate(before, next, time);
    next.firstWeekday = cal.anchorWeekday(next, Math.floor(moved / cal.SECONDS_PER_DAY), draft.anchor);
    await game.settings.set("irop", "calendar", next);
    await game.settings.set("irop", "calendarWarRoom", draft.show.strategy);
    await game.settings.set("irop", "calendarDateBar", draft.show.dateBar);
    await game.settings.set("irop", "calendarTurnDays", draft.turnDays);
    if ( moved !== time ) await setWorldTime(moved);
    this.draft = null;
  }
}

/* -------------------------------------------- */
/*  The date bar                                */
/* -------------------------------------------- */

/** How far a press must move before it is a drag rather than a click, in pixels. */
const DRAG_START = 4;

/** A position held on the screen, the whole bar in view. */
export function clampToScreen({ left = 0, top = 0 } = {}, { width = 200, height = 34 } = {}, screen = { width: 1920, height: 1080 }) {
  const fit = (n, size, room) => Math.round(Math.max(0, Math.min(Math.max(0, room - size), Number(n) || 0)));
  return { left: fit(left, width, screen.width), top: fit(top, height, screen.height) };
}

/** Where this user put the date bar, or null for the top centre. A client setting: each user's own. */
function savedBarPosition() {
  try {
    const p = game.settings.get("irop", "dateBarPosition");
    return (Number.isFinite(p?.left) && Number.isFinite(p?.top)) ? p : null;
  }
  catch {
    return null;
  }
}

/**
 * The date in a small bar along the top, on scenes that are not a War Room (the GM's choice).
 * Johnald, 2026-10-09: it can be dragged anywhere; each user's spot is remembered, and a
 * right click puts it back at the top centre. A click that does not move still opens the calendar.
 */
export class DateBar extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-date-bar",
    classes: ["irop", "irop-date-bar"],
    window: { frame: false, positioned: true },
    position: { top: 70, width: "auto", height: "auto" },
    actions: { open: DateBar.#onOpen }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/date-bar.hbs" }
  };

  static #instance = null;

  /**
   * Show or hide the bar for the scene now viewed.
   * @param {boolean} warRoom   Whether the scene is a War Room (its own bar shows the date)
   */
  static sync(warRoom = false) {
    if ( dateBarShown() && !warRoom ) {
      this.#instance ??= new this();
      return this.#instance.render({ force: true });
    }
    if ( this.#instance?.rendered ) this.#instance.close({ animate: false });
    return null;
  }

  static refresh() {
    if ( this.#instance?.rendered ) this.#instance.render();
  }

  /** @override */
  async _prepareContext(options) {
    return { date: dateInfo() };
  }

  /** The drag under way: where it started, and whether it has moved far enough to count. */
  drag = null;

  /** A drag just ended, so the click that follows it does not open the calendar. */
  dragged = false;

  /** The bar's size on screen. */
  get size() {
    return { width: this.element?.offsetWidth || 200, height: this.element?.offsetHeight || 34 };
  }

  /** The screen's size. */
  static get screen() {
    return { width: globalThis.window?.innerWidth || 1920, height: globalThis.window?.innerHeight || 1080 };
  }

  /** Where this user put it, kept on the screen; else centred along the top, as the War Room bar is. @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const saved = savedBarPosition();
    const { width } = this.size;
    this.setPosition(saved ? clampToScreen(saved, this.size, DateBar.screen)
      : { left: Math.max(10, Math.round((DateBar.screen.width - width) / 2)), top: 70 });
    const bar = this.element.querySelector(".date-bar");
    if ( !bar ) return;
    bar.addEventListener("pointerdown", event => {
      if ( event.button !== 0 ) return;
      this.dragStart(event.clientX, event.clientY);
      bar.setPointerCapture?.(event.pointerId);
    });
    bar.addEventListener("pointermove", event => this.dragMove(event.clientX, event.clientY));
    bar.addEventListener("pointerup", event => {
      bar.releasePointerCapture?.(event.pointerId);
      this.dragEnd();
    });
    bar.addEventListener("contextmenu", event => {
      event.preventDefault();
      this.putBack();
    });
  }

  /** A press on the bar: a drag, if it moves. */
  dragStart(x, y) {
    const left = Number(this.position?.left) || 0;
    const top = Number(this.position?.top) || 0;
    this.drag = { x, y, left, top, moving: false };
  }

  /** The press moves: past a few pixels, the bar follows it. */
  dragMove(x, y) {
    const d = this.drag;
    if ( !d ) return;
    if ( !d.moving && (Math.hypot(x - d.x, y - d.y) < DRAG_START) ) return;
    d.moving = true;
    this.setPosition(clampToScreen({ left: d.left + (x - d.x), top: d.top + (y - d.y) }, this.size, DateBar.screen));
  }

  /** Let go: a drag remembers where the bar now is. */
  async dragEnd() {
    const d = this.drag;
    this.drag = null;
    if ( !d?.moving ) return;
    this.dragged = true;
    setTimeout(() => { this.dragged = false; }, 250);
    const { left, top } = this.position;
    try { await game.settings.set("irop", "dateBarPosition", { left: Math.round(left), top: Math.round(top) }); }
    catch { /* settings not ready */ }
  }

  /** Back to the top centre. */
  async putBack() {
    try { await game.settings.set("irop", "dateBarPosition", {}); }
    catch { /* settings not ready */ }
    this.setPosition({ left: Math.max(10, Math.round((DateBar.screen.width - this.size.width) / 2)), top: 70 });
  }

  /** A click opens the calendar, unless it ended a drag. */
  static #onOpen() {
    if ( this.dragged ) return null;
    return CalendarApp.open();
  }
}

/* -------------------------------------------- */

/** A Calendar button among the Journal Notes tools, for everyone (Foundry 13 and 14). */
export function addCalendarControl(controls) {
  const notes = controls?.notes;
  if ( !notes?.tools || Array.isArray(controls) ) return;
  notes.tools.iropCalendar = {
    name: "iropCalendar",
    order: 50,
    title: "Calendar",
    icon: "fa-solid fa-calendar-days",
    button: true,
    visible: true,
    onChange: () => CalendarApp.open()
  };
}

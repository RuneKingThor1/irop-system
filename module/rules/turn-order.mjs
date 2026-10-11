import { IROP } from "../config.mjs";

/**
 * The turn order ribbon's rules (Johnald, 2026-10-11): who shows where, what a viewer may read
 * of each combatant, and the words for a hostile's condition. Pure: no Foundry here, so the
 * ribbon's window (apps/turn-ribbon.mjs) gathers the combat and this decides what it shows.
 */

/** Token dispositions, as Foundry numbers them (CONST.TOKEN_DISPOSITIONS). */
const DISPOSITION = { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 };

/** A share of a maximum as a whole percent, 0 to 100; 0 when there is no maximum. */
export function percent(value, max) {
  const v = Number(value) || 0;
  const m = Number(max) || 0;
  if ( m <= 0 ) return 0;
  return Math.max(0, Math.min(100, Math.round((v / m) * 100)));
}

/**
 * A combatant's condition in a word, from the health it has left: what players read of a
 * hostile instead of its numbers.
 * @returns {string|null}  null when there is no maximum to measure against.
 */
export function conditionWord(value, max, condition = IROP.turnOrder.condition) {
  const m = Number(max) || 0;
  if ( m <= 0 ) return null;
  const share = (Number(value) || 0) / m;
  if ( share >= 1 ) return condition.full;
  for ( const band of condition.bands ) {
    if ( share > band.above ) return band.label;
  }
  return condition.none;
}

/**
 * Which side a combatant fights on: an operative (a player character), or by its token's
 * disposition an ally, a neutral or a hostile. A secret disposition reads as neutral.
 */
export function sideOf({ type, disposition } = {}) {
  if ( type === "operative" ) return "operative";
  if ( disposition === DISPOSITION.FRIENDLY ) return "ally";
  if ( disposition === DISPOSITION.HOSTILE ) return "hostile";
  return "neutral";
}

/** Whether a viewer reads a combatant's numbers: the GM, anyone for an operative, and any observer of the actor. */
export function seesNumbers({ isGM = false, type, observer = false } = {}) {
  return !!(isGM || (type === "operative") || observer);
}

/**
 * The vital bars a card shows: Health always, Armor and Barrier when the combatant has any.
 * @param {object} vitals  An actor's system.vitals
 */
export function vitalBars(vitals = {}) {
  const rows = [
    { key: "hp", label: "Health", short: "H" },
    { key: "armor", label: "Armor", short: "A" },
    { key: "barrier", label: "Barrier", short: "B" }
  ];
  const bars = [];
  for ( const row of rows ) {
    const pool = vitals?.[row.key];
    if ( !pool ) continue;
    const value = Number(pool.value) || 0;
    const max = Number(pool.max) || 0;
    if ( (row.key !== "hp") && (max <= 0) ) continue;
    bars.push({ ...row, value, max, pct: percent(value, max) });
  }
  return bars;
}

/**
 * Dodge pips: one per dodge, filled for those left. Past the most drawn, none; the count is
 * shown as a number instead.
 * @returns {{pips: boolean[], value: number, max: number}|null}  null with no dodges at all.
 */
export function dodgePips(dodges, maxPips = IROP.turnOrder.maxPips) {
  const max = Math.max(0, Number(dodges?.max) || 0);
  if ( !max ) return null;
  const value = Math.max(0, Math.min(max, Number(dodges?.value) || 0));
  const pips = (max <= maxPips) ? Array.from({ length: max }, (_, i) => i < value) : [];
  return { pips, value, max };
}

/**
 * How many cards are out of sight off each end of a line too long for the screen: a card counts
 * once more than half of it is past the edge.
 * @param {{left: number, width: number}[]} boxes  Each card's place along the line, in pixels
 * @param {{scrollLeft: number, width: number}} view  How far the line is scrolled, and how much shows
 * @returns {{left: number, right: number}}
 */
export function offscreen(boxes = [], { scrollLeft = 0, width = 0 } = {}) {
  let left = 0;
  let right = 0;
  for ( const box of boxes ) {
    const middle = box.left + (box.width / 2);
    if ( middle < scrollLeft ) left++;
    else if ( middle > (scrollLeft + width) ) right++;
  }
  return { left, right };
}

/**
 * The ribbon's cards in order, with who acts, who is next, and who has acted this round.
 *
 * Two orders, the GM's choice: "fixed" keeps initiative order, the cards that have acted this
 * round dimmed; "actingFirst" turns the line so whoever acts leads it, those who have acted
 * following behind a marker for the next round. Either way the defeated shrink to a stub: in
 * place in a fixed line, at the end of a turning one.
 *
 * Cards a viewer may not see (a hidden combatant, to players) are left out after the order is
 * worked out, so "next" stays true: when a hidden combatant is next, no visible card says so.
 *
 * @param {object[]} entries  The combat's turns in initiative order: { id, defeated, visible }
 * @param {object} [options]
 * @param {string|null} [options.activeId]  The combatant whose turn it is; none before the combat starts
 * @param {string|null} [options.nextId]    The combatant up next, as Foundry reckons it
 * @param {string} [options.mode]           "actingFirst" or "fixed"
 * @param {number} [options.round]          The round now, for the marker's tooltip
 * @returns {{cards: object[], position: number|null, count: number}}  The cards (each entry with
 *   active, next, acted and down set, and { marker: true, round } between rounds); the acting card's
 *   place among the standing cards shown, from 1, and how many stand.
 */
export function ribbonOrder(entries = [], { activeId = null, nextId = null, mode = "actingFirst", round = 0 } = {}) {
  const standing = entries.filter(e => !e.defeated);
  const at = standing.findIndex(e => e.id === activeId);
  const mark = (e, acted = false) => ({ ...e, active: e.id === activeId, next: !!nextId && (e.id === nextId) && (e.id !== activeId),
    acted, down: !!e.defeated });

  let cards;
  if ( mode === "fixed" ) {
    cards = entries.map(e => {
      const i = standing.indexOf(e);
      return mark(e, (at >= 0) && (i >= 0) && (i < at));
    });
  }
  else {
    const ahead = (at >= 0) ? standing.slice(at) : standing;
    const behind = (at >= 0) ? standing.slice(0, at) : [];
    const down = entries.filter(e => e.defeated);
    cards = ahead.map(e => mark(e));
    const shownBehind = behind.filter(e => e.visible !== false);
    if ( shownBehind.length ) cards.push({ marker: true, round: round + 1 });
    cards.push(...behind.map(e => mark(e)), ...down.map(e => mark(e)));
  }

  cards = cards.filter(c => c.marker || (c.visible !== false));
  const shownStanding = cards.filter(c => !c.marker && !c.down);
  const place = shownStanding.findIndex(c => c.active);
  return { cards, position: (place >= 0) ? place + 1 : null, count: shownStanding.length };
}

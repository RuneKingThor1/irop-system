import { IROP } from "../config.mjs";
import { resourceTotals } from "./resources.mjs";

/**
 * The Strategy Layer's state and rules (2026-10-08). Kept apart from Foundry so it
 * can be tested on its own: the settings hold what a world saved, and these
 * functions fill in what it did not.
 */

/**
 * The War Room's running state when a world has none yet. `tactical` is this week's
 * Tactical Action once chosen (step 5): {key, label, territory, rewards, heat, status
 * chosen|briefed|done, by, revealed}.
 */
export const WAR_ROOM_DEFAULTS = Object.freeze({ week: 1, phase: "odr", logistics: 0, intel: 0, tactical: null });

/** The turn's phases, in order (doc: GENESIS Phase, Event Phase, ODR Phase, repeat). */
export const PHASES = {
  genesis: "GENESIS",
  event: "Event",
  odr: "ODR"
};

/**
 * The rules in force: the defaults (IROP.strategyRules) with a world's own
 * changes laid over them. Anything a world never set, or set to something that
 * is not a number, keeps its default.
 * @param {object} [saved]   What the world saved
 */
export function strategyRules(saved = {}) {
  const merge = (base, over) => Object.fromEntries(Object.entries(base).map(([key, value]) => {
    const mine = over?.[key];
    if ( (value !== null) && (typeof value === "object") ) return [key, merge(value, mine)];
    const n = Number(mine);
    return [key, ((mine !== undefined) && (mine !== null) && (mine !== "") && Number.isFinite(n)) ? n : value];
  }));
  return merge(IROP.strategyRules, saved ?? {});
}

/**
 * The War Room state, with defaults for anything missing. Given the ledger (step 3),
 * Logistics and Intel are its sums, whatever was saved.
 * @param {object} [saved]
 * @param {object[]} [ledger]
 */
export function warRoomState(saved = {}, ledger = null) {
  const state = { ...WAR_ROOM_DEFAULTS, ...(saved ?? {}) };
  if ( !PHASES[state.phase] ) state.phase = WAR_ROOM_DEFAULTS.phase;
  if ( ledger ) Object.assign(state, resourceTotals(ledger));
  for ( const key of ["week", "logistics", "intel"] ) state[key] = Math.max(key === "week" ? 1 : 0, Math.round(Number(state[key]) || 0));
  if ( !state.tactical || (typeof state.tactical !== "object") || !state.tactical.label ) state.tactical = null;
  return state;
}

/**
 * Strength and Heat from the Lore journal's older tracks (2026-10-08): each was five
 * tiers of five boxes ("Tier 3, 5 of 5"). Strength is the share of the 25 boxes on
 * the new 0 to strengthMax scale; Heat is the vigilance tier less one (Tier 1 None,
 * Tier 2 Low, Tier 3 Medium). Starting values only; the GM sets the real ones.
 * @param {string} track   "Tier 2, 3 of 5"
 * @returns {{tier: number, boxes: number}|null}
 */
export function readTrack(track) {
  const m = String(track ?? "").match(/tier\s*(\d+)\s*,\s*(\d+)\s*of\s*5/i);
  if ( !m ) return null;
  const tier = Number(m[1]);
  return { tier, boxes: ((tier - 1) * 5) + Number(m[2]) };
}

export function strengthFromTrack(track, strengthMax = IROP.strategyRules.strengthMax) {
  const t = readTrack(track);
  return t ? Math.round((t.boxes / 25) * strengthMax) : 0;
}

export function heatFromTrack(track) {
  const t = readTrack(track);
  return t ? Math.max(0, Math.min(4, t.tier - 1)) : 0;
}

/**
 * Neighbour lists with a link added or taken out, both ways: adjacency is mutual.
 * @param {Record<string, string[]>} lists   Territory id to its neighbour ids
 * @returns {Record<string, string[]>}       Only the lists that changed
 */
export function linkNeighbors(lists, a, b, linked = true) {
  if ( !a || !b || (a === b) ) return {};
  const out = {};
  for ( const [self, other] of [[a, b], [b, a]] ) {
    const now = lists[self] ?? [];
    const next = linked ? (now.includes(other) ? now : [...now, other]) : now.filter(id => id !== other);
    if ( next.join() !== now.join() ) out[self] = next;
  }
  return out;
}

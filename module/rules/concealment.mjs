import { IROP } from "../config.mjs";

/**
 * Concealment of carried gear (Johnald, 2026-10-10): "Concealment works based off a total % of
 * carried weight. Its pass or fail no skill checks but if caught there is a chance to surrender
 * items to continue mission. Slums baseline 50% carried for concealment. Megacities baseline 25%
 * carried for concealment. Some items and gear do not count towards effecting concealment with
 * mods or innate properties."
 *
 * What shows is the carried weight of everything not hidden: an item hidden by nature (ticked
 * Concealable), or by a mod fitted to it that conceals its host, and whatever is part of such an
 * item (its fitted mods, the ammunition or grenades loaded in it). Stowed things are not carried,
 * as for the Carried bar. It passes at a place while it is no more than that place's share of
 * the operative's carry capacity (IROP.concealment).
 */

const round = n => Math.round((Number(n) || 0) * 10) / 10;

/** An item's own carried weight: weight times how many, and anything loaded in it. */
function ownWeight(item) {
  const s = item.system ?? {};
  let w = (Number(s.weight) || 0) * (s.quantity ?? 1);
  for ( const shot of (Array.isArray(s.loaded) ? s.loaded : []) ) w += Number(shot?.system?.weight) || 0;
  return w;
}

/** The item another is part of: the weapon or armor a mod is fitted to, the weapon ammunition is loaded in. */
function hostOf(item, byId) {
  const s = item.system ?? {};
  if ( (item.type === "mod") && s.installedOn ) return byId.get(s.installedOn) ?? null;
  if ( (item.type === "gear") && s.loadedIn ) return byId.get(s.loadedIn) ?? null;
  return null;
}

/**
 * Which of a character's items are hidden from a concealment check.
 * @param {Item[]} items
 * @returns {Set<string>}  Their ids
 */
export function hiddenItems(items) {
  const list = [...(items ?? [])];
  const byId = new Map(list.map(i => [i.id, i]));
  // Hosts a fitted mod conceals.
  const veiled = new Set(list.filter(i => (i.type === "mod") && i.system?.concealsHost && i.system?.installedOn).map(i => i.system.installedOn));
  const hiddenItself = item => !!item?.system?.concealable || veiled.has(item?.id);
  const hidden = new Set();
  for ( const item of list ) {
    const host = hostOf(item, byId);
    if ( hiddenItself(item) || (host && hiddenItself(host)) ) hidden.add(item.id);
  }
  return hidden;
}

/**
 * How much of a character's carried weight shows, against their carry capacity.
 * @param {Item[]} items
 * @param {number} capacity   The Carried bar's maximum
 * @returns {{visible: number, hidden: number, capacity: number, pct: number}}
 */
export function concealmentLoad(items, capacity) {
  const hidden = hiddenItems(items);
  let shown = 0;
  let veiled = 0;
  for ( const item of items ?? [] ) {
    const s = item.system ?? {};
    if ( (s.weight === undefined) || s.stowed ) continue;
    if ( hidden.has(item.id) ) veiled += ownWeight(item);
    else shown += ownWeight(item);
  }
  const cap = Math.max(0, Number(capacity) || 0);
  return { visible: round(shown), hidden: round(veiled), capacity: cap, pct: cap ? Math.round((shown / cap) * 100) : (shown ? Infinity : 0) };
}

/**
 * Whether a character's load passes at a place: the place's share of capacity, plus any bonus the
 * character has (a Human's 10, and effects'), plus any bonus at that place only (2026-10-11).
 * @param {{visible: number, capacity: number, bonus?: number, bonusAt?: object}} load
 * @param {string} place   A key of IROP.concealment.places
 * @returns {{place: string, label: string, base: number, limit: number, allowed: number, visible: number, pass: boolean, over: number}}
 */
export function placeCheck(load, place) {
  const p = IROP.concealment.places[place];
  const base = p?.limit ?? 0;
  const limit = Math.max(0, base + (Number(load.bonus) || 0) + (Number(load.bonusAt?.[place]) || 0));
  const allowed = round(((Number(load.capacity) || 0) * limit) / 100);
  const visible = round(load.visible);
  return { place, label: p?.label ?? place, base, limit, allowed, visible, pass: visible <= allowed, over: round(Math.max(0, visible - allowed)) };
}

/**
 * What a caught character can hand over: each carried thing that shows, with what goes with it
 * (the mods fitted to it, the ammunition loaded in it). Things part of another go with it, not
 * on their own.
 * @param {Item[]} items
 * @returns {{id: string, name: string, img: string, quantity: number, stack: boolean, unitWeight: number, attached: string[]}[]}
 */
export function surrenderables(items) {
  const list = [...(items ?? [])];
  const byId = new Map(list.map(i => [i.id, i]));
  const hidden = hiddenItems(list);
  const out = [];
  for ( const item of list ) {
    const s = item.system ?? {};
    if ( (s.weight === undefined) || s.stowed || hidden.has(item.id) || hostOf(item, byId) ) continue;
    const attached = list.filter(i => hostOf(i, byId)?.id === item.id);
    const quantity = Math.max(1, Math.floor(Number(s.quantity) || 1));
    const stack = quantity > 1;
    const extra = attached.reduce((w, i) => w + ownWeight(i), 0);
    const unitWeight = stack ? (Number(s.weight) || 0) : round(ownWeight(item) + extra);
    if ( !unitWeight ) continue;
    out.push({ id: item.id, name: item.name, img: item.img, quantity, stack, unitWeight: round(unitWeight), attached: stack ? [] : attached.map(i => i.id) });
  }
  return out;
}

import { IROP } from "../config.mjs";

/**
 * The Resistance's Logistics and Intel (Strategy Layer step 3, 2026-10-08). The stock
 * is never stored on its own: it is the sum of a ledger, one entry for each gain or
 * spend, so every number can be explained and any entry undone. Kept apart from
 * Foundry so it can be tested on its own.
 */

/** Each resource's stock: the sum of its ledger entries. */
export function resourceTotals(ledger = []) {
  const totals = Object.fromEntries(Object.keys(IROP.resources).map(key => [key, 0]));
  for ( const e of ledger ?? [] ) {
    if ( e && (e.resource in totals) ) totals[e.resource] += Math.round(Number(e.amount) || 0);
  }
  return totals;
}

/**
 * The ledger with one more entry, or why not. Spending more than the stock is
 * refused, unless `clamp`, when a loss takes only what is left (a Reprisal cannot
 * take Logistics the Resistance does not have).
 * @param {object[]} ledger
 * @param {{resource: string, amount: number, reason?: string, week?: number, by?: string, id?: string, time?: number}} change
 * @param {{clamp?: boolean}} [options]
 * @returns {{ok: boolean, ledger?: object[], entry?: object, clamped?: boolean, reason?: string}}
 */
export function addEntry(ledger = [], change = {}, { clamp = false } = {}) {
  const res = IROP.resources[change.resource];
  if ( !res ) return { ok: false, reason: "Logistics or Intel?" };
  const asked = Math.round(Number(change.amount) || 0);
  if ( !asked ) return { ok: false, reason: "Enter an amount." };
  const stock = resourceTotals(ledger)[change.resource];
  let amount = asked;
  if ( stock + amount < 0 ) {
    if ( !clamp ) return { ok: false, reason: `That needs ${-amount} ${res.label}; ${stock} in stock.` };
    if ( !stock ) return { ok: false, reason: `No ${res.label} left to lose.` };
    amount = -stock;
  }
  const entry = {
    id: change.id ?? "",
    week: Math.max(1, Math.round(Number(change.week) || 1)),
    resource: change.resource,
    amount,
    reason: String(change.reason ?? "").trim() || ((amount > 0) ? "Gained" : "Spent"),
    by: change.by ?? "",
    time: change.time ?? 0
  };
  return { ok: true, ledger: [...(ledger ?? []), entry], entry, clamped: amount !== asked };
}

/**
 * The ledger without one entry, which reverses it. Refused when that would leave
 * a stock below zero: what was bought with it has to be undone first.
 */
export function removeEntry(ledger = [], id) {
  const entry = (ledger ?? []).find(e => e.id === id);
  if ( !entry ) return { ok: false, reason: "That entry is no longer in the ledger." };
  const rest = ledger.filter(e => e !== entry);
  const left = resourceTotals(rest)[entry.resource];
  const label = IROP.resources[entry.resource]?.label ?? entry.resource;
  if ( left < 0 ) return { ok: false, reason: `Undoing this would leave ${left} ${label}. Undo what was spent after it first.` };
  return { ok: true, ledger: rest, entry };
}

/** An amount as the ledger shows it: "+10", "-30". */
export function signed(n) {
  const v = Math.round(Number(n) || 0);
  return `${v > 0 ? "+" : (v < 0 ? "-" : "")}${Math.abs(v)}`;
}

/**
 * The ledger as the window shows it: a block per week, the newest week first and the
 * newest entry first within it, each week with what it netted.
 * @returns {{week: number, net: {key: string, label: string, amount: string, gain: boolean}[], lines: object[]}[]}
 */
export function ledgerWeeks(ledger = []) {
  const weeks = new Map();
  (ledger ?? []).forEach((e, order) => {
    if ( !IROP.resources[e?.resource] ) return;
    const week = Math.max(1, Math.round(Number(e.week) || 1));
    if ( !weeks.has(week) ) weeks.set(week, []);
    weeks.get(week).push({ ...e, order });
  });
  return [...weeks.entries()].sort((a, b) => b[0] - a[0]).map(([week, entries]) => {
    const totals = resourceTotals(entries);
    return {
      week,
      net: Object.entries(totals).filter(([, n]) => n).map(([key, n]) => ({ key, label: IROP.resources[key].label, amount: signed(n), gain: n > 0 })),
      lines: entries.sort((a, b) => b.order - a.order).map(e => ({
        id: e.id, resource: e.resource, label: IROP.resources[e.resource].label, icon: IROP.resources[e.resource].icon,
        reason: e.reason, by: e.by, amount: signed(e.amount), gain: e.amount > 0
      }))
    };
  });
}

/* -------------------------------------------- */
/*  Support                                     */
/* -------------------------------------------- */

/**
 * What a Support option costs under the rules in force. An Inside Job is a range:
 * an amount asked is held inside it, and nothing asked costs the least.
 * @param {string} key
 * @param {object} rules       The Strategy Layer rules in force
 * @param {number} [asked]     For an Inside Job, the amount asked
 * @returns {number|null}
 */
export function supportCost(key, rules = IROP.strategyRules, asked) {
  const option = IROP.supportOptions[key];
  if ( !option ) return null;
  const s = rules?.support ?? IROP.strategyRules.support;
  const min = Math.max(0, Math.round(Number(s[option.cost]) || 0));
  if ( !option.most ) return min;
  const max = Math.max(min, Math.round(Number(s[option.most]) || 0));
  const n = Math.round(Number(asked));
  return ((asked === undefined) || (asked === null) || (asked === "") || !Number.isFinite(n)) ? min : Math.max(min, Math.min(max, n));
}

/** The most a Support option can cost: its range's top, or its one price. */
export function supportMost(key, rules = IROP.strategyRules) {
  const option = IROP.supportOptions[key];
  if ( !option?.most ) return supportCost(key, rules);
  return supportCost(key, rules, Number.MAX_SAFE_INTEGER);
}

/**
 * Every Support option with its price and whether the stock covers it.
 * @param {object} rules
 * @param {number} stock      Logistics in stock
 */
export function supportOptions(rules = IROP.strategyRules, stock = 0) {
  return Object.entries(IROP.supportOptions).map(([key, o]) => {
    const min = supportCost(key, rules);
    const max = supportMost(key, rules);
    return {
      key, label: o.label, icon: o.icon, effect: o.effect, min, max,
      costLabel: (max > min) ? `${min} to ${max}` : `${min}`,
      affordable: stock >= min,
      short: (stock < min) ? `Needs ${min} Logistics; ${stock} in stock.` : ""
    };
  });
}

/**
 * The Mortar Strike's three strikes from their d100s: a roll of `scatterOn` or more
 * scatters (doc: "any roll of 75+ causes that strike to scatter 1d4 tiles").
 * @param {number[]} rolls
 * @returns {{n: number, roll: number, scatters: boolean}[]}
 */
export function mortarStrikes(rolls = [], scatterOn = IROP.mortarStrike.scatterOn) {
  return rolls.map((roll, i) => ({ n: i + 1, roll, scatters: roll >= scatterOn }));
}

/**
 * Whether two strikes' areas overlap (doc: "Designate three non-overlapping areas"). Each is a
 * circle, its center and radius in the same units; circles that only touch do not overlap.
 * @param {{x: number, y: number, radius: number}} a
 * @param {{x: number, y: number, radius: number}} b
 */
export function strikesOverlap(a, b) {
  const apart = Math.hypot((Number(a?.x) || 0) - (Number(b?.x) || 0), (Number(a?.y) || 0) - (Number(b?.y) || 0));
  return apart < ((Number(a?.radius) || 0) + (Number(b?.radius) || 0) - 0.5);
}

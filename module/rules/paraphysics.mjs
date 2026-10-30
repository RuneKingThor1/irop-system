import { IROP } from "../config.mjs";

/**
 * Paraphysics, the Progression Framework Draft 0.6 (Johnald, 2026-10-18 and 19; docs/paraphysics).
 * Three currencies: psycrystals unlock a power (Rank 1), evolve it (Rank 5) and awaken a person (2);
 * XP buys discipline ranks and power Ranks 2 to 4; Energy casts. Kept apart from Foundry so it can
 * be tested.
 *
 * Discipline rank is breadth and economy: which tiers you reach, how many powers you hold, and
 * cheaper casting of the tiers you have outgrown. Power rank is how good one power is: its two
 * tracks step at Ranks 2 and 4, Rank 3 is its one choice node, Rank 5 its evolution.
 */

const P = () => IROP.paraphysics;

/** Is this discipline open to players yet? Wave two is hidden for now (2026-10-18). */
export function disciplineOpen(key) {
  return (IROP.disciplineInfo[key]?.wave ?? 99) <= P().openWave;
}

/**
 * A species' paraphysics: what it casts on, how many schools a person can hold, and any rank it
 * grants in a school (a granted rank also raises that school's cap). Humans when none is set.
 * @param {object|null} species  The species item's system data
 */
export function speciesParaphysics(species) {
  const p = species?.paraphysics ?? {};
  const bonus = {};
  for ( const key of Object.keys(IROP.disciplines) ) {
    const n = Math.max(0, Number(p.bonus?.[key]) || 0);
    if ( n ) bonus[key] = n;
  }
  return {
    attribute: (p.attribute && (p.attribute in IROP.attributes)) ? p.attribute : P().attribute,
    schools: ((p.schools === undefined) || (p.schools === null)) ? P().schools : Math.max(0, Number(p.schools) || 0),
    bonus
  };
}

/**
 * Every discipline as a character holds it: ranks bought, ranks the species grants, the total, and
 * the cap (5 plus the species' grant). `held` is how many schools have any rank.
 * @param {object} bought   system.paraphysics: ranks bought, by key
 * @param {object} species  speciesParaphysics()
 */
export function disciplineStates(bought = {}, species = speciesParaphysics(null)) {
  const out = {};
  for ( const key of Object.keys(IROP.disciplines) ) {
    const own = Math.max(0, Number(bought?.[key]) || 0);
    const bonus = species.bonus?.[key] ?? 0;
    out[key] = { bought: own, bonus, rank: own + bonus, cap: P().rankMax + bonus };
  }
  return out;
}

/** How many schools a character holds: any rank, bought or granted. */
export function schoolsHeld(states) {
  return Object.values(states).filter(d => d.rank > 0).length;
}

/** How many powers a discipline holds at a rank: two per rank (2026-10-19). */
export function powerSlots(rank) {
  return Math.max(0, Number(rank) || 0) * P().slotsPerRank;
}

/** The XP cost of discipline rank `n` (the n-th rank bought): 50, 75, 100, 125, 150. */
export function disciplineRankCost(n) {
  return P().disciplineXp[n - 1] ?? null;
}

/**
 * Can the next rank of a discipline be bought?
 * @param {object} o
 * @param {string} o.key
 * @param {{bought, bonus, rank, cap}} o.state   This discipline, from disciplineStates()
 * @param {number} o.n          The rank to reach (bought ranks plus the species' grant)
 * @param {number} o.unspent
 * @param {number} o.held       Schools held already
 * @param {number} o.schools    The species' limit
 * @param {boolean} o.enabled   Can this character use paraphysics at all
 * @returns {{ok: boolean, cost?: number, reason?: string}}
 */
export function checkDisciplinePurchase({ key, state, n, unspent, held, schools, enabled }) {
  const label = IROP.disciplines[key] ?? key;
  if ( !enabled ) return { ok: false, reason: "Only a paraphysical character can buy discipline ranks. Awaken first." };
  if ( !disciplineOpen(key) ) return { ok: false, reason: `${label} is not open yet.` };
  if ( n !== state.rank + 1 ) return { ok: false, reason: "Ranks are bought one at a time, the next one up." };
  if ( n > state.cap ) return { ok: false, reason: `${label} is already at its top rank.` };
  if ( (state.rank === 0) && (held >= schools) ) return { ok: false, reason: `Your species can hold ${schools} disciplines at most.` };
  const cost = disciplineRankCost(state.bought + 1);
  if ( unspent < cost ) return { ok: false, cost, reason: `${label} rank ${n} costs ${cost} XP; ${unspent} unspent.` };
  return { ok: true, cost };
}

/* -------------------------------------------- */
/*  Powers                                      */
/* -------------------------------------------- */

/** A power's two tracks, without blanks or repeats. */
export function powerTracks(p) {
  return [...new Set([p?.trackA, p?.trackB].filter(t => t && (t in IROP.powerTracks)))];
}

/** What one track gives at a power rank: its Rank 2 step, plus its Rank 4 step from Rank 4. */
export function trackValue(track, rank) {
  const t = IROP.powerTracks[track];
  if ( !t || (t.rank2 === null) ) return 0;
  return ((rank >= 2) ? t.rank2 : 0) + ((rank >= 4) ? t.rank4 : 0);
}

/** The number fields a rank, a choice or an evolution can change (Johnald, 2026-10-19). */
export const POWER_FIELDS = ["accuracy", "potency", "energy", "range", "duration", "area", "barrier", "defense", "shred", "armorHp"];

/**
 * A Rank 2 or Rank 4 step's value for one field: what the GM typed, or, left blank, the default
 * its tracks give (Accuracy -10 then -15, Potency +4 then +6). Tracks are only defaults
 * (2026-10-19): a GM overwrites any of it per power.
 */
export function stepValue(p, step, field) {
  const typed = p?.[`rank${step}`]?.[field];
  if ( (typed !== null) && (typed !== undefined) && (typed !== "") ) return Number(typed) || 0;
  if ( !["accuracy", "potency"].includes(field) || !powerTracks(p).includes(field) ) return 0;
  const t = IROP.powerTracks[field];
  return (step === 2 ? t.rank2 : t.rank4) ?? 0;
}

/** Damage parts as "+ 1d4", "+ 1": blank and "0" give nothing. */
function damagePart(text) {
  const t = String(text ?? "").trim().replace(/^\+\s*/, "");
  return (t && (t !== "0")) ? t : "";
}

/**
 * The Rank 5 evolution taken (2026-10-29): one of the power's evolutions, by id. A power written
 * before the pick (one `evolution`, not a list) has that one.
 */
export function chosenEvolution(p) {
  if ( Array.isArray(p?.evolutions) ) return p.evolutions.find(e => e.id === p.evolved) ?? null;
  return (p?.evolution && (typeof p.evolution === "object")) ? { ...p.evolution, rename: !!p.evolution.name } : null;
}

/**
 * Everything a power's ranks add up to at its rank (2026-10-19): Ranks 2 and 4 (their typed values
 * or the track defaults), the Rank 3 option taken, and the Rank 5 evolution. Rank 1 is the power's
 * own fields. `lines` reads each piece out for the card.
 */
export function powerTotals(p) {
  const rank = Number(p?.rank) || 0;
  const out = { accuracy: 0, potency: 0, energy: 0, range: 0, duration: 0, area: 0, barrier: Number(p?.barrier) || 0, armorHp: Number(p?.armorHp) || 0, defense: 0, shred: 0, damage: [], damageType: "",
    concentration: !!p?.concentration, steadfast: false, evolvedName: "", option: null, evolution: null, lines: [] };
  const add = (src, label) => {
    for ( const f of POWER_FIELDS ) out[f] += Number(src[f]) || 0;
    const d = damagePart(src.damage);
    if ( d ) out.damage.push(d);
    if ( src.text ) out.lines.push(`${label}: ${String(src.text).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}`);
  };
  for ( const step of [2, 4] ) {
    if ( rank < step ) continue;
    const s = p?.[`rank${step}`] ?? {};
    add({ ...Object.fromEntries(POWER_FIELDS.map(f => [f, stepValue(p, step, f)])), damage: s.damage, text: s.text }, `Rank ${step}`);
  }
  if ( rank >= 3 ) {
    const option = (p?.options ?? []).find(o => o.id === p.choice) ?? null;
    if ( option ) {
      out.option = option;
      add(option, option.label || "Rank 3");
      if ( option.anchored ) out.concentration = false;
      if ( option.steadfast ) out.steadfast = true;
    }
  }
  const e = (rank >= 5) ? chosenEvolution(p) : null;
  if ( e ) {
    out.evolution = e;
    // Its name is the power's only when it renames it; otherwise it is the evolution's label.
    out.evolvedName = e.rename ? (e.name ?? "") : "";
    add(e, e.name ? `Evolved, ${e.name}` : "Evolved");
    if ( e.damageType ) out.damageType = e.damageType;
    if ( e.concentration === "remove" ) out.concentration = false;
    if ( e.concentration === "add" ) out.concentration = true;
  }
  return out;
}

/**
 * The accuracy a power's ranks and a focus give, as a D.M. (minus is better). Whatever its ranks,
 * choice and evolution add, the power stops at the -25 ceiling, and the focus shares it
 * (2026-10-19): it carries a fledgling power and is redundant at Rank 4.
 * @returns {{track: number, focus: number, total: number}}
 */
export function powerAccuracy(p, { focus = false } = {}) {
  const ceiling = P().accuracyCeiling;
  const track = Math.max(ceiling, Math.min(0, powerTotals(p).accuracy));
  const total = focus ? Math.max(ceiling, Math.min(track, track + P().focus)) : track;
  return { track, focus: total - track, total };
}

/** The D.M. a save power puts on the target's roll: casting modifier plus what its ranks add to Potency. */
export function powerSaveDm(p, castingMod) {
  return (Number(castingMod) || 0) + powerTotals(p).potency;
}

/**
 * A power's Energy cost as its caster pays it (2026-10-19): -1 for each discipline rank above the
 * power's tier, for powers of base 4 or more; what its ranks, choice (Efficient: -1) and evolution
 * add or take; never below half the base cost, rounded up, whatever else reduces it. `other` is any
 * change from elsewhere (the role perks), applied before the floor.
 * @returns {{base: number, cost: number, discount: number, own: number}}
 */
export function powerEnergy(p, disciplineRank, other = 0) {
  const base = Math.max(0, Number(p?.energy ?? p?.base) || 0);
  const tier = Math.max(1, Number(p?.tier) || 1);
  const discount = (base >= P().discountFrom) ? Math.max(0, (Number(disciplineRank) || 0) - tier) : 0;
  const own = powerTotals(p).energy;
  const floor = Math.ceil(base / 2);
  const cost = Math.max(floor, base - discount + own + (Number(other) || 0));
  return { base, cost, discount, own };
}

/** Does a power need Concentration? An Anchored choice or its evolution can take it away, or add it. */
export function needsConcentration(p) {
  return powerTotals(p).concentration;
}

/**
 * The parts of a power whose extra Energy is paid or not at each cast (2026-10-29): the Rank 3 option
 * and the Rank 5 evolution taken, when flagged. Each with what it adds to the cost, and whether it
 * is Adaptive (the caster picks the save).
 * @returns {{kind: "option"|"evolution", id: string, label: string, energy: number, adaptive: boolean}[]}
 */
export function optionalNodes(p) {
  const t = powerTotals(p);
  const out = [];
  if ( t.option?.optionalEnergy ) out.push({ kind: "option", id: t.option.id, label: t.option.label || "Rank 3",
    energy: Number(t.option.energy) || 0, adaptive: !!t.option.adaptive });
  if ( t.evolution?.optionalEnergy ) out.push({ kind: "evolution", id: t.evolution.id ?? "", label: t.evolution.name || "Evolution",
    energy: Number(t.evolution.energy) || 0, adaptive: false });
  return out;
}

/**
 * A power as it is cast this time (2026-10-29): an optional part not paid for is left off, so the
 * power goes off as its standard version; a paid Adaptive option sets the attribute saved on.
 * @param {object} p                    system.paraphysics
 * @param {object} [paid]
 * @param {boolean} [paid.option=true]     the Rank 3 option's extra Energy paid
 * @param {boolean} [paid.evolution=true]  the evolution's extra Energy paid
 * @param {string} [paid.save]             the attribute an Adaptive option makes the target save on
 * @returns {object} a copy of p
 */
export function castPower(p, { option = true, evolution = true, save = "" } = {}) {
  const out = { ...p };
  const t = powerTotals(p);
  if ( t.option?.optionalEnergy && !option ) out.choice = "";
  if ( t.evolution?.optionalEnergy && !evolution ) {
    if ( Array.isArray(p.evolutions) ) out.evolved = "";
    else out.evolution = null;
  }
  if ( t.option?.adaptive && option && save && (save in IROP.attributes) ) out.save = save;
  return out;
}

/** The evolutions a power offers at Rank 5, as {key, label, text}. */
export function evolutionChoices(p) {
  const plain = h => String(h ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return (Array.isArray(p?.evolutions) ? p.evolutions : []).map(e => ({ key: e.id, label: e.name || "Unnamed evolution", text: plain(e.text) }));
}

/**
 * A damage formula gathered up for reading (2026-10-29): "2d4 + 6 + 1 + 1d4" is "3d4 + 7". Only a plain
 * sum of dice and whole numbers is gathered; anything else comes back as it was.
 */
export function simplifyFormula(formula) {
  // Half a modifier (Mend, 2026-10-30) reads as its number once the modifier is filled in.
  const f = String(formula ?? "").trim().replace(/floor\(\s*(-?\d+)\s*\/\s*(\d+)\s*\)/g, (m, a, b) => String(Math.floor(Number(a) / Number(b))));
  if ( !f ) return "";
  const terms = f.split("+").map(t => t.trim());
  if ( !terms.every(t => /^(\d*d\d+|\d+)$/i.test(t)) ) return f;
  const dice = new Map();
  let flat = 0;
  for ( const t of terms ) {
    const m = /^(\d*)d(\d+)$/i.exec(t);
    if ( m ) dice.set(Number(m[2]), (dice.get(Number(m[2])) ?? 0) + (Number(m[1]) || 1));
    else flat += Number(t);
  }
  const parts = [...dice.entries()].sort((a, b) => b[0] - a[0]).map(([size, n]) => `${n}d${size}`);
  if ( flat ) parts.push(String(flat));
  return parts.join(" + ") || "0";
}

/** What raising a power to rank `n` costs: a psycrystal at 1 and 5, XP between. */
export function powerRankCost(n) {
  if ( P().crystalRanks.includes(n) ) return { crystals: 1, xp: 0 };
  const xp = P().powerXp[n];
  return (xp === undefined) ? null : { crystals: 0, xp };
}

/**
 * Can a character learn this power (Rank 1)? Its discipline must be at the power's tier, a power
 * slot free in that discipline (two per rank), and a psycrystal to spend, unless awakening left a
 * free one.
 * @returns {{ok: boolean, crystals?: number, reason?: string}}
 */
export function checkPowerUnlock({ name, tier, discipline, state, inDiscipline, crystals, free = false, enabled, learnable = true, rival = "" }) {
  const label = IROP.disciplines[discipline] ?? discipline;
  // A power only NPCs have (2026-10-20).
  if ( learnable === false ) return { ok: false, reason: `${name} is not a power players can learn.` };
  if ( !enabled ) return { ok: false, reason: "Only a paraphysical character can learn powers. Awaken first." };
  if ( !discipline || !state ) return { ok: false, reason: `${name} has no discipline.` };
  if ( !disciplineOpen(discipline) ) return { ok: false, reason: `${label} is not open yet.` };
  // A pick one group, such as a discipline's two Tier 5 powers (2026-10-29): one of them, for good.
  if ( rival ) return { ok: false, reason: `${name} and ${rival} are pick one: you already hold ${rival}.` };
  if ( state.rank < tier ) return { ok: false, reason: `${name} is a tier ${tier} power: it needs ${label} rank ${tier}; you have ${state.rank}.` };
  const slots = powerSlots(state.rank);
  if ( inDiscipline >= slots ) return { ok: false, reason: `${label} rank ${state.rank} holds ${slots} power${slots === 1 ? "" : "s"}, and all are taken.` };
  const cost = free ? 0 : 1;
  if ( crystals < cost ) return { ok: false, crystals: cost, reason: `Learning ${name} takes a psycrystal; you have none.` };
  return { ok: true, crystals: cost };
}

/**
 * Can a power go up to rank `n`? One at a time; XP at 2 to 4, a psycrystal at 5; Rank 4 waits on the
 * Rank 3 choice.
 * @returns {{ok: boolean, xp?: number, crystals?: number, reason?: string}}
 */
export function checkPowerRank({ name, current, n, unspent, crystals, choice }) {
  if ( n !== current + 1 ) return { ok: false, reason: "Power ranks are bought one at a time, the next one up." };
  if ( n > P().powerMax ) return { ok: false, reason: `${name} is already at its final form.` };
  if ( (n >= 4) && (current >= 3) && !choice ) return { ok: false, reason: `Choose ${name}'s Rank 3 modification first.` };
  const cost = powerRankCost(n);
  if ( cost.crystals && (crystals < cost.crystals) ) return { ok: false, ...cost, reason: `${name}'s Rank ${n} evolution takes a psycrystal; you have none.` };
  if ( cost.xp && (unspent < cost.xp) ) return { ok: false, ...cost, reason: `${name} rank ${n} costs ${cost.xp} XP; ${unspent} unspent.` };
  return { ok: true, ...cost };
}

/** Can this character be awakened? Not if already able, and only with the crystals. */
export function checkAwaken({ enabled, crystals, barred = false }) {
  if ( barred ) return { ok: false, reason: "This species cannot be paraphysically enabled by any means." };
  if ( enabled ) return { ok: false, reason: "Already paraphysical." };
  const cost = P().awakenCost;
  if ( crystals < cost ) return { ok: false, crystals: cost, reason: `Awakening takes ${cost} psycrystals; you have ${crystals}.` };
  return { ok: true, crystals: cost };
}

/** The options a power offers at Rank 3 (its own copies, from the library or custom), as {key, label, text}. */
export function powerChoices(p) {
  return (p?.options ?? []).map(o => ({ key: o.id, label: o.label || "Unnamed option", text: o.text ?? "" }));
}

/** A Rank 3 option copied from the library archetype, ready to edit per power (2026-10-19). */
export function optionFromArchetype(key, id) {
  const a = IROP.powerArchetypes[key];
  if ( !a ) return null;
  return { id, archetype: key, label: a.label, text: a.text, accuracy: 0, potency: 0, damage: "", energy: 0, range: 0,
    duration: 0, area: 0, defense: 0, shred: 0, anchored: false, steadfast: false, optionalEnergy: false, adaptive: false, ...(a.changes ?? {}) };
}

/** What a power's ranks add, in words: "Accuracy -10, Damage + 1d4, Range +4". */
export function trackText(p) {
  const t = powerTotals(p);
  const sign = n => (n > 0 ? `+${n}` : `${n}`);
  return [
    t.accuracy ? `Accuracy ${sign(Math.max(P().accuracyCeiling, t.accuracy))}` : "",
    t.potency ? `Potency ${sign(t.potency)}` : "",
    t.damage.length ? `Damage + ${t.damage.join(" + ")}` : "",
    t.range ? `Range ${sign(t.range)}` : "",
    t.area ? `Area ${sign(t.area)}` : "",
    t.duration ? `Duration ${sign(t.duration)}` : "",
    t.barrier ? `Barrier ${t.barrier}` : "",
    t.armorHp ? `Armor HP ${t.armorHp}` : "",
    t.defense ? `Defense ${sign(t.defense)}` : "",
    t.shred ? `Shred ${t.shred}` : ""
  ].filter(Boolean).join(", ");
}

/**
 * A paraphysical barrier on a character (2026-10-20): like temporary HP, it lifts the Barrier pool to
 * that much and never adds to it. Returns the pool's new value and granted, or null if it already
 * holds that much or more.
 */
export function barrierGrant(pool, amount) {
  const n = Math.max(0, Number(amount) || 0);
  const now = Math.max(0, Number(pool?.value) || 0);
  if ( !n || (now >= n) ) return null;
  return { value: n, granted: n };
}

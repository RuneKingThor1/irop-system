import { IROP } from "../config.mjs";

/**
 * The weather on a territory's card (Johnald, 2026-10-08: "something fun"). It is random,
 * but the same for everyone and for the whole turn: each territory's weather is rolled from
 * a seed of its id, the turn and the GM's reroll count, so it only changes when the turn
 * advances or the GM rolls again. The territory's climate sets the range and the odds; the
 * calendar's date sets the season (2026-10-08). Without a calendar the turn does: turn 1 is
 * the start of spring, 52 turns a year. Kept apart from Foundry so it can be tested on its own.
 */

/** A string's hash (FNV-1a), for a seed. */
export function hashString(text) {
  let h = 2166136261;
  for ( const ch of String(text) ) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A small seeded generator (mulberry32): the same seed gives the same numbers on every client. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];
const YEAR = 52;

/** The season a turn falls in: 13 turns each, spring first. */
export function seasonOf(turn) {
  const t = (Math.max(1, Math.round(Number(turn) || 1)) - 1) % YEAR;
  return SEASONS[Math.floor(t / 13)];
}

/** Where a turn sits in the year's warmth: 0 at the start of spring, 1 midsummer, -1 midwinter. */
export function seasonalWave(turn) {
  const t = (Math.max(1, Math.round(Number(turn) || 1)) - 1) % YEAR;
  return Math.sin((2 * Math.PI * t) / YEAR);
}

const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Pick a key by weight. */
function pick(weights, rand) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((n, [, w]) => n + w, 0);
  if ( !total ) return "clear";
  let roll = rand() * total;
  for ( const [key, w] of entries ) {
    roll -= w;
    if ( roll < 0 ) return key;
  }
  return entries.at(-1)[0];
}

/**
 * What a territory's weather is drawn from: its climate's numbers, with smog for a
 * Megacity and paraphysical storms where the territory is tagged with them; or, once the
 * GM has customized it, the territory's own numbers as they are (Johnald, 2026-10-08).
 * Temperatures in degrees F; every condition has a chance, zero where it cannot happen.
 * @param {object} input
 * @param {string} [input.climate]    A key of IROP.climates
 * @param {boolean} [input.megacity]
 * @param {string} [input.modifiers]
 * @param {object} [input.custom]     The territory's own weather: {custom, base, swing, spread, weights}
 * @returns {{base: number, swing: number, spread: number, weights: Record<string, number>, custom: boolean}}
 */
export function weatherProfile({ climate = "temperate", megacity = false, modifiers = "", custom = null } = {}) {
  const all = w => Object.fromEntries(Object.keys(IROP.weatherConditions).map(k => [k, Math.max(0, Math.round(Number(w?.[k]) || 0))]));
  if ( custom?.custom ) {
    const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    return { base: n(custom.base, 57), swing: Math.max(0, n(custom.swing, 0)), spread: Math.max(0, n(custom.spread, 0)), weights: all(custom.weights), custom: true };
  }
  const c = IROP.climates[climate] ?? IROP.climates.temperate;
  // The climate's own order first, so the same seed draws the same weather as it always has.
  const weights = { ...c.weights };
  for ( const key of Object.keys(IROP.weatherConditions) ) weights[key] ??= 0;
  if ( megacity ) weights.smog += 12;
  if ( /paraphysical storm/i.test(modifiers) ) weights.paraStorm = 22;
  return { base: c.base, swing: c.swing, spread: c.spread, weights, custom: false };
}

/** A territory's weather this turn, from its system data; the season from the calendar, if given. */
export function territoryWeather(id, system = {}, turn = 1, season = null) {
  return weatherFor({
    id, turn, salt: system.weatherSalt ?? 0, climate: system.climate, megacity: system.kind === "megacity",
    modifiers: system.modifiers ?? "", custom: system.weather, season
  });
}

/**
 * A territory's weather this turn.
 * @param {object} input
 * @param {string} input.id           The territory's id
 * @param {number} input.turn
 * @param {string} [input.climate]    A key of IROP.climates
 * @param {boolean} [input.megacity]  Megacities get smog
 * @param {string} [input.modifiers]  "Paraphysical Storms" brings its own weather
 * @param {object} [input.custom]     The territory's own weather, once the GM customized it
 * @param {number} [input.salt]       The GM's rerolls
 * @param {{wave: number, name: string}} [input.season]  The calendar's season: its warmth (1
 *   high summer, -1 deep winter) and name. Without it, the turn sets the season.
 * @returns {{key: string, label: string, icon: string, tempF: number, tempC: number, wind: number, direction: string, season: string}}
 */
export function weatherFor({ id = "", turn = 1, climate = "temperate", megacity = false, modifiers = "", custom = null, salt = 0, season = null } = {}) {
  const c = weatherProfile({ climate, megacity, modifiers, custom });
  const rand = seeded(hashString(`${id}|${turn}|${salt}`));
  const wave = Number.isFinite(season?.wave) ? season.wave : seasonalWave(turn);
  let tempF = c.base + (c.swing * wave) + (((rand() * 2) - 1) * c.spread);

  const weights = { ...c.weights };
  if ( tempF <= 33 ) {
    // Freezing: rain falls as snow, and thunder and haze are out.
    weights.snow = (weights.snow ?? 0) + (weights.rain ?? 0) + ((weights.storm ?? 0) / 2);
    delete weights.rain;
    delete weights.storm;
  }
  else delete weights.snow;
  if ( tempF < 88 ) delete weights.haze;

  const key = pick(weights, rand);
  const cond = IROP.weatherConditions[key] ?? IROP.weatherConditions.clear;
  tempF += cond.temp ?? 0;
  if ( key === "snow" ) tempF = Math.min(tempF, 33);
  const [low, high] = cond.wind ?? [0, 14];
  const wind = Math.round(low + (rand() * (high - low)));
  const direction = DIRECTIONS[Math.floor(rand() * DIRECTIONS.length)];
  const f = Math.round(tempF);
  return {
    key, label: cond.label, icon: cond.icon, tempF: f, tempC: Math.round(((f - 32) * 5) / 9),
    wind, direction, season: season ? (season.name ?? "") : seasonOf(turn)
  };
}

/* -------------------------------------------- */
/*  Celsius or Fahrenheit (Johnald, 2026-10-08) */
/* -------------------------------------------- */

/** A temperature in degrees F, in a unit: "F" or "C". */
export function tempIn(f, unit = "F") {
  return (unit === "C") ? Math.round(((Number(f) - 32) * 5) / 9) : Math.round(Number(f));
}

/** A temperature difference in degrees F (a season's swing), in a unit. */
export function spanIn(f, unit = "F") {
  return (unit === "C") ? Math.round((Number(f) * 5) / 9) : Math.round(Number(f));
}

/** Back to degrees F from a unit, for a temperature or (span) a difference. */
export function toF(value, unit = "F", { span = false } = {}) {
  const v = Number(value) || 0;
  if ( unit !== "C" ) return v;
  return span ? (v * 9) / 5 : ((v * 9) / 5) + 32;
}

/** The weather in a line, for a mission briefing: "Rain, 48°F (9°C), wind 12 mph SW". */
export function weatherLine(w, unit = "F") {
  const temps = (unit === "C") ? `${w.tempC}°C (${w.tempF}°F)` : `${w.tempF}°F (${w.tempC}°C)`;
  return `${w.label}, ${temps}, wind ${w.wind} mph ${w.direction}`;
}

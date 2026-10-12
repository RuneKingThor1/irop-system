import { IROP } from "../config.mjs";

/**
 * Reputation (RULED 2026-10-11, Johnald): nine levels, four up from Neutral and four down,
 * each holding a bar of points like Strength's. Gains and losses move the points. When the
 * bar fills the level rises, when it empties the level falls, and either way the new level
 * starts at the middle of its bar with the overflow thrown away, so one change moves one
 * level at most. Hard to move, easy to hold. At the top and bottom levels the bar only
 * fills or empties. A territory's Reputation and a faction's standing both run on this.
 *
 * A state: {level, points}. level -levels to +levels; points 0 to points.
 */

const int = v => Math.round(Number(v) || 0);

/** A level held to the scale. */
export function clampLevel(level, scale = IROP.reputationScale) {
  return Math.max(-scale.levels, Math.min(scale.levels, int(level)));
}

/** A state held to the scale; points missing are the middle of the bar. */
export function repState(level, points, scale = IROP.reputationScale) {
  const p = ((points === undefined) || (points === null) || (points === "")) ? scale.entry : int(points);
  return { level: clampLevel(level, scale), points: Math.max(0, Math.min(scale.points, p)) };
}

/**
 * Move a state by a number of points.
 * @returns {{level: number, points: number, moved: -1|0|1, from: {level: number, points: number}}}
 */
export function moveReputation(state, delta, scale = IROP.reputationScale) {
  const from = repState(state?.level, state?.points, scale);
  const d = int(delta);
  let { level, points } = from;
  let moved = 0;
  const next = points + d;
  if ( d > 0 && (next >= scale.points) && (level < scale.levels) ) {
    level += 1;
    points = scale.entry;
    moved = 1;
  }
  else if ( d < 0 && (next <= 0) && (level > -scale.levels) ) {
    level -= 1;
    points = scale.entry;
    moved = -1;
  }
  else points = Math.max(0, Math.min(scale.points, next));
  return { level, points, moved, from };
}

/** Whether two states are the same. */
export function sameState(a, b) {
  return (a.level === b.level) && (a.points === b.points);
}

/** "+2", "0", "-3". */
export function signedLevel(level) {
  return `${level > 0 ? "+" : ""}${int(level)}`;
}

/** A level's name on a ladder (IROP.reputationLevels, or IROP.factionLevels with {label}). */
export function levelLabel(level, ladder = IROP.reputationLevels) {
  const entry = ladder[String(clampLevel(level))];
  return (typeof entry === "object") ? (entry?.label ?? "") : (entry ?? "");
}

/** "+2 Friendly". */
export function levelText(level, ladder = IROP.reputationLevels) {
  return `${signedLevel(clampLevel(level))} ${levelLabel(level, ladder)}`;
}

/** "Friendly, 7 of 10". */
export function stateText(state, ladder = IROP.reputationLevels, scale = IROP.reputationScale) {
  const s = repState(state?.level, state?.points, scale);
  return `${levelLabel(s.level, ladder)}, ${s.points} of ${scale.points}`;
}

/**
 * A change in words, after the points: "+2: Friendly, 7 of 10", "+3: up to Supportive",
 * "-2: down to Wary". Empty if nothing moved.
 */
export function changeText(delta, from, to, ladder = IROP.reputationLevels, scale = IROP.reputationScale) {
  const a = repState(from?.level, from?.points, scale);
  const b = repState(to?.level, to?.points, scale);
  if ( sameState(a, b) ) return "";
  const pts = `${delta > 0 ? "+" : ""}${int(delta)}`;
  if ( b.level > a.level ) return `${pts}: up to ${levelLabel(b.level, ladder)}`;
  if ( b.level < a.level ) return `${pts}: down to ${levelLabel(b.level, ladder)}`;
  return `${pts}: ${stateText(b, ladder, scale)}`;
}

/** The bar's boxes, filled up to the points. */
export function repPips(points, scale = IROP.reputationScale) {
  const p = Math.max(0, Math.min(scale.points, int(points)));
  return Array.from({ length: scale.points }, (_, i) => i < p);
}

/** A level's color family: hostile, unfriendly, neutral, friendly or allied. */
export function levelTone(level) {
  const l = int(level);
  if ( l <= -3 ) return "hostile";
  if ( l < 0 ) return "unfriendly";
  if ( l === 0 ) return "neutral";
  return (l >= 3) ? "allied" : "friendly";
}

/** One number for sorting: higher levels first, then fuller bars. */
export function repRank(state, scale = IROP.reputationScale) {
  const s = repState(state?.level, state?.points, scale);
  return (s.level * (scale.points + 1)) + s.points;
}

import { IROP } from "../config.mjs";

/**
 * Free starting skills, RULED 2026-10-08 (Johnald). When a role or background is
 * first taken, the player picks its starting skills, free:
 *   - a role lists three, "Awareness, Athletics or Survivalism": the first comes
 *     free, and the player picks one of the other two;
 *   - a background lists six: the player picks three (the Field Manual's
 *     "Starting Skills, Pick Three"; the number is on the background).
 * Each skill picked goes up one rank, so a skill both give comes out at rank 2
 * (HANDOFF: "If a background grants a skill you already have, raise that skill
 * by one rank instead").
 */

/** Names the old material uses for skills, beside each skill's own label. */
const ALIASES = {
  investigate: "investigation",
  survival: "survival",
  survivalism: "survival",
  lockpicking: "lockpicking",
  "lock picking": "lockpicking",
  atheltics: "athletics",
  xenotech: "xenotech",
  xenotechnology: "xenotech"
};

/** The skill key a written name means, or null. */
export function skillKeyOf(name) {
  const n = String(name ?? "").trim().toLowerCase();
  if ( !n ) return null;
  if ( ALIASES[n] ) return ALIASES[n];
  return Object.entries(IROP.skills).find(([key, s]) => (key === n) || (s.label.toLowerCase() === n))?.[0] ?? null;
}

/**
 * Read a written list of skills ("Survivalism, Athletics or Coercion"). A part with
 * trailing words ("Deception Starting Boon: Minor Powers Unlocked") is matched by its
 * longest skill name at the start; anything else is returned as unknown.
 * @returns {{keys: string[], unknown: string[]}}
 */
export function parseSkillNames(text) {
  const parts = String(text ?? "").split(/,|\bor\b|\band\b/i).map(p => p.trim()).filter(Boolean);
  const keys = [];
  const unknown = [];
  for ( const part of parts ) {
    let key = skillKeyOf(part);
    // "Pick three: Survival": the skill is after the colon.
    if ( !key && part.includes(":") ) key = skillKeyOf(part.split(":").pop());
    if ( !key ) {
      const words = part.split(/\s+/);
      for ( let i = Math.min(words.length, 3); (i > 0) && !key; i-- ) key = skillKeyOf(words.slice(0, i).join(" "));
    }
    if ( key && !keys.includes(key) ) keys.push(key);
    else if ( !key ) unknown.push(part);
  }
  return { keys, unknown };
}

/**
 * What a role or background offers.
 * @returns {{source: string, granted: string[], pick: number, options: string[], unknown: string[]}}
 */
export function startingSkillPlan(item) {
  const { keys, unknown } = parseSkillNames(item?.system?.startingSkills);
  if ( item?.type === "role" ) {
    return { source: "role", granted: keys.slice(0, 1), pick: keys.length > 1 ? 1 : 0, options: keys.slice(1), unknown };
  }
  const pick = Math.min(Number(item?.system?.skillPicks ?? 3) || 0, keys.length);
  return { source: "background", granted: [], pick, options: keys, unknown };
}

/**
 * The rank updates for the skills taken: each one up a rank, capped at the top.
 * @param {Record<string, number>} ranks    Current rank by skill key
 * @param {string[]} taken                  Skills taken, in order (a key may repeat)
 * @returns {{update: Record<string, number>, capped: string[]}}
 */
export function startingSkillRanks(ranks, taken) {
  const next = { ...ranks };
  const capped = [];
  for ( const key of taken ) {
    if ( (next[key] ?? 0) >= IROP.skillRanks.max ) { capped.push(key); continue; }
    next[key] = (next[key] ?? 0) + 1;
  }
  const update = {};
  for ( const [key, rank] of Object.entries(next) ) if ( rank !== ranks[key] ) update[`system.skills.${key}.rank`] = rank;
  return { update, capped };
}

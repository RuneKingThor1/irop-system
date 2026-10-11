import { IROP } from "../config.mjs";
import { skillKeyOf } from "./starting-skills.mjs";

/**
 * Perk requirements written on an ability's Prerequisites line (2026-10-08), as the
 * Generalist perks have them: "Resilience (2), Toughness 55", "Perception -or-
 * Strength 45", "Athletics Rank 2". The tree already knows which perk comes before
 * which, so perk names here are left to it; what this reads is attributes and skill
 * ranks, which the Training tab then holds a character to (Edit mode aside).
 */

/** An attribute's key from its name or abbreviation ("Toughness", "TGH"), or null. */
function attributeKey(name) {
  const n = String(name ?? "").trim().toLowerCase();
  return Object.entries(IROP.attributes).find(([key, a]) => (a.label.toLowerCase() === n) || (a.abbr.toLowerCase() === n) || (key === n))?.[0] ?? null;
}

/**
 * The attribute and skill requirements in a Prerequisites line.
 * @param {string} text
 * @returns {{kind: "attribute"|"skill", keys: string[], min: number}[]}
 *   An attribute requirement with several keys is met by any one of them.
 */
export function parseRequirements(text) {
  const out = [];
  for ( const raw of String(text ?? "").split(/[,;]/) ) {
    const part = raw.trim();
    if ( !part ) continue;
    // "Athletics Rank 2": a skill at that rank or better.
    let m = part.match(/^(.+?)\s+rank\s+(\d+)$/i);
    if ( m ) {
      const key = skillKeyOf(m[1]);
      if ( key ) out.push({ kind: "skill", keys: [key], min: Number(m[2]) });
      continue;
    }
    // "Toughness 45", "Perception -or- Strength 45": an attribute at that score or better.
    m = part.match(/^(.+?)\s+(\d+)$/);
    if ( !m ) continue;
    const keys = m[1].split(/\s*(?:-or-|\bor\b|\/)\s*/i).map(attributeKey);
    if ( keys.length && keys.every(Boolean) ) out.push({ kind: "attribute", keys, min: Number(m[2]) });
  }
  return out;
}

/** A requirement as the sheet says it: "Toughness 45", "Perception or Strength 45", "Athletics rank 2". */
export function requirementLabel(req) {
  if ( req.kind === "skill" ) return `${IROP.skills[req.keys[0]]?.label ?? req.keys[0]} rank ${req.min}`;
  return `${req.keys.map(k => IROP.attributes[k]?.label ?? k).join(" or ")} ${req.min}`;
}

/**
 * The requirements a character does not meet.
 * @param {object[]} reqs        From parseRequirements
 * @param {object} system        The character's system data: attributes[key].value, skills[key].rank
 * @returns {string[]}           Each unmet one, as the sheet says it
 */
export function unmetRequirements(reqs, system) {
  return reqs.filter(req => {
    if ( req.kind === "skill" ) return (system?.skills?.[req.keys[0]]?.rank ?? 0) < req.min;
    return !req.keys.some(k => (system?.attributes?.[k]?.value ?? 0) >= req.min);
  }).map(requirementLabel);
}

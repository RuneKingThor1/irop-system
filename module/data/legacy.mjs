import { parseSkillNames } from "../rules/starting-skills.mjs";

/**
 * Special weapons saved before 2026-10-08 carry no feed, so they read as plain
 * magazine weapons. This gives them theirs by name, the way the Sandbox converter
 * does: the LAW is single use, the launchers load grenades or rockets, and a
 * chemthrower burns fuel (a Flame one forcing Ignited (3) on a failed save, as its
 * text says). Only a whole weapon with a name and no saved feed is touched, so
 * anything set by hand, and every update, is left alone.
 * @param {object} source    An Item's source data
 * @returns {object}
 */
export function legacyWeaponFeed(source) {
  if ( (source?.type !== "weapon") || (typeof source.name !== "string") ) return source;
  const system = source.system;
  if ( !system || (typeof system !== "object") || ("feed" in system) ) return source;
  const n = source.name.toLowerCase();
  if ( /\blaw\b/.test(n) ) system.feed = "singleUse";
  else if ( /grenade launcher/.test(n) ) system.feed = "grenades";
  else if ( /rocket launcher/.test(n) ) system.feed = "rockets";
  else if ( /chem ?thrower|flame ?thrower/.test(n) ) {
    system.feed = "fuel";
    system.weaponClass = "chemthrower";
    if ( !system.burn && /flame/.test(n) ) system.burn = { save: "agi", status: "ignited", statusValue: 3 };
    return source;
  }
  else return source;
  system.weaponClass = "launcher";
  return source;
}

/**
 * RULED 2026-10-08 (Johnald): the first starting skill on a role is the free one, and
 * the Marauder's is Awareness, the Warmachine's Athletics. Role items saved with the
 * old order (from the Sandbox game and the handoff) read in the new one. The skills
 * are compared, not the wording, since older items spell Survivalism "Survival";
 * only those three skills in exactly the old order are touched, so a GM's own
 * choice stands.
 */
const ROLE_SKILL_ORDER = {
  marauder: { old: "athletics,awareness,survival", now: "Awareness, Athletics or Survivalism" },
  warmachine: { old: "survival,athletics,coercion", now: "Athletics, Survivalism or Coercion" }
};

/**
 * @param {object} source    An Item's source data
 * @returns {object}
 */
export function legacyRoleSkillOrder(source) {
  if ( (source?.type !== "role") || !source.system || (typeof source.system !== "object") ) return source;
  const fix = ROLE_SKILL_ORDER[source.system.role];
  if ( !fix || (typeof source.system.startingSkills !== "string") ) return source;
  const { keys, unknown } = parseSkillNames(source.system.startingSkills);
  if ( !unknown.length && (keys.join() === fix.old) ) source.system.startingSkills = fix.now;
  return source;
}

/**
 * Backgrounds saved before the Paraphysical tag existed (2026-10-08) have none, so
 * an Awakened operative would lose the Paraphysics panel. A background whose text
 * calls the character "paraphysically enabled", as the Awakened's does, gets the
 * tag, once, when no value was saved.
 * @param {object} source    An Item's source data
 * @returns {object}
 */
export function legacyParaphysicalTag(source) {
  if ( !source?.system || (typeof source.system !== "object") || ("paraphysical" in source.system) ) return source;
  // RULED 2026-10-08 (Johnald): Reticulons are all paraphysical.
  if ( source.type === "species" ) {
    if ( /^reticulon$/i.test(String(source.name ?? "").trim()) ) source.system.paraphysical = true;
    return source;
  }
  if ( source.type !== "background" ) return source;
  // The text is HTML: allow a non breaking space or a tag between the two words.
  if ( /paraphysically(?:\s|&nbsp;|<[^>]*>)+enabled/i.test(String(source.system.description ?? "")) ) source.system.paraphysical = true;
  return source;
}

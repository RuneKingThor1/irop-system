/**
 * A full reset of an operative (Johnald, 2026-10-08): back to a new operative in one go,
 * after a confirm. Kept apart from Foundry so it can be tested on its own.
 *
 * Always reset: attributes, skills, vitals, bonuses, DR, paraphysics, banks, XP, the
 * starting skills taken, every role, species, background, ability and perk, boon and
 * mutation, and the operative's own effects. Always kept: the name, portrait, token and
 * owners (they are not system data). Kept on request: who they are (callsign, Personnel
 * Record, biography, notes), their gear (weapons, armor, gear, mods, and their wealth),
 * and the XP earned, with everything spent refunded.
 */

/** The item types that are gear, kept with the gear. */
export const GEAR_TYPES = ["weapon", "armor", "gear", "mod"];

const clone = value => JSON.parse(JSON.stringify(value ?? null));

/**
 * The operative's system data after the reset.
 * @param {object} blank      A new operative's system data
 * @param {object} current    The operative's system data now (source)
 * @param {object} [keep]
 * @param {boolean} [keep.identity]   Callsign, Personnel Record, biography, notes
 * @param {boolean} [keep.gear]       Wealth (the items are kept by resetItems)
 * @param {boolean} [keep.xp]         XP earned, with its awards kept on the ledger and every spend refunded
 * @returns {object}
 */
export function resetSystem(blank, current = {}, { identity = false, gear = false, xp = false } = {}) {
  const system = clone(blank);
  if ( identity && current.details ) {
    for ( const key of ["callsign", "biography", "notes", "record"] ) {
      if ( key in current.details ) system.details[key] = clone(current.details[key]);
    }
  }
  if ( gear && current.wealth ) system.wealth = clone(current.wealth);
  if ( xp && current.xp ) {
    system.xp = {
      earned: Number(current.xp.earned) || 0,
      log: clone((current.xp.log ?? []).filter(e => e.kind === "award"))
    };
  }
  return system;
}

/** The ids of the items the reset removes: everything, or everything but the gear. */
export function resetItems(items = [], { gear = false } = {}) {
  return items.filter(i => !(gear && GEAR_TYPES.includes(i.type))).map(i => i.id);
}

/** What the reset keeps, in words for the GM's note: "their identity and gear". */
export function keptWords({ identity = false, gear = false, xp = false } = {}) {
  const parts = [identity ? "who they are" : "", gear ? "their gear" : "", xp ? "the XP earned" : ""].filter(Boolean);
  if ( !parts.length ) return "Nothing was kept.";
  const list = (parts.length === 1) ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Kept ${list}.`;
}

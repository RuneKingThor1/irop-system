import { IROP } from "../config.mjs";

/**
 * Background perks (Johnald, 2026-10-10: "each one will not only give the option of the 3 out of
 * 5 skills, but also a selection of background perks they can choose one of. GMs should be able
 * to edit these perks within the game"). The perks are abilities, so a GM writes and changes them
 * as any item, effects and all. A background keeps its list the way a perk tree keeps its nodes:
 * each entry points at its ability by uuid, with the name and picture as last seen. The one a new
 * character takes is copied onto the operative, marked flags.irop.backgroundPerk.
 */

/**
 * A background's perk list as the GM keeps it now: the Items sidebar's background of that name,
 * whose list a GM edits in the game, else the copy given (a character's own, say).
 */
export function liveBackground(background) {
  return globalThis.game?.items?.find?.(i => (i.type === "background") && (i.name === background.name)) ?? background;
}

/** What kind of perk it is, in a line: "Passive", or "Single action, 3 EN". */
export function perkMeta(system) {
  const s = system ?? {};
  return [(s.kind === "active") ? (IROP.actionTypes[s.actionType] ?? "Active") : "Passive",
    s.energyCost ? `${s.energyCost} EN` : null].filter(Boolean).join(", ");
}

/** A background's perk list with an ability added; null if it is on the list already. */
export function withPerk(perks, ability, id) {
  if ( !ability?.uuid || perks.some(p => p.uuid === ability.uuid) ) return null;
  return [...perks, { id, uuid: ability.uuid, name: ability.name ?? "", img: ability.img ?? "" }];
}

/** A background's perk list without one entry. */
export function withoutPerk(perks, id) {
  return perks.filter(p => p.id !== id);
}

/** Whether an item is a perk taken from a background. */
export function isBackgroundPerk(item) {
  return !!item?.flags?.irop?.backgroundPerk;
}

/** The perk an operative took from the background of that name, if any. */
export function takenPerk(items, backgroundName) {
  for ( const item of items ?? [] ) {
    if ( (item.type === "ability") && (item.flags?.irop?.backgroundPerk?.background === backgroundName) ) return item;
  }
  return null;
}

/**
 * The operative's copy of a perk: the ability's data as it stands, filed under Background on
 * the Abilities tab and marked with where it came from.
 * @param {object} data        The ability's data (toObject)
 * @param {string} background  The background's name
 * @param {object} perk        The background's entry for it
 */
export function perkCopy(data, background, perk) {
  const copy = structuredClone(data);
  for ( const key of ["_id", "folder", "sort", "ownership"] ) delete copy[key];
  copy.system = { ...(copy.system ?? {}), source: "background", tree: background };
  copy.flags = { ...(copy.flags ?? {}), irop: { ...(copy.flags?.irop ?? {}), backgroundPerk: { background, perk: perk.id, uuid: perk.uuid } } };
  return copy;
}

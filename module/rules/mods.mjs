import { IROP } from "../config.mjs";

/**
 * Mods on a weapon's range bands (Johnald, 2026-10-17): a fitted mod's Range D.M. adds to the band's
 * own, so a Reflex Sight (-5 at Medium) makes medium range shots easier. Kept apart from Foundry so it
 * can be tested.
 */

/**
 * A weapon's range bands with its fitted mods' D.M. added, each band noting which mods changed it.
 * @param {object} ranges    The weapon's system.range: {band: {tiles, dm}}
 * @param {object[]} mods    Its fitted mods: {name, system: {rangeDm}}
 * @returns {object}         {band: {tiles, dm, mods: [{name, dm}]}}
 */
export function rangesWithMods(ranges, mods = []) {
  const out = {};
  for ( const band of Object.keys(IROP.rangeBands) ) {
    const own = ranges?.[band] ?? { tiles: 0, dm: 0 };
    const from = mods.map(m => ({ name: m.name, dm: Number(m.system?.rangeDm?.[band]) || 0 })).filter(m => m.dm);
    out[band] = { ...own, dm: (Number(own.dm) || 0) + from.reduce((s, m) => s + m.dm, 0), mods: from };
  }
  return out;
}

/** A mod's range D.M. in a line: "Medium -5". Blank when it has none. */
export function rangeDmText(rangeDm = {}) {
  return Object.entries(IROP.rangeBands).filter(([k]) => Number(rangeDm[k]))
    .map(([k, label]) => `${label} ${(rangeDm[k] > 0) ? "+" : ""}${rangeDm[k]}`).join(", ");
}

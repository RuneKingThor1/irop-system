import { blastRegionData, canPlaceBlast } from "./blast.mjs";

/**
 * Auras (Johnald, 2026-10-29): a power whose area is centered on the caster (Umbral Veil, Sanctuary
 * of the Aurora, Aura of Weightlessness) draws its area on the map around the caster's token,
 * attached to it so it moves with them. Its radius is the power's Area at its rank, counted from
 * the token's edge. It lasts as long as the power: when its Concentration or timer ends, the aura
 * goes with it.
 */

/** Does this cast make an aura: no attack, no range of its own, and an area. */
export function makesAura({ attack = false, range = 0, area = 0 } = {}) {
  return !attack && !(Number(range) > 0) && (Number(area) > 0);
}

/** The aura's radius in tiles from the token's center: its Area past the token's own edge. */
export function auraRadius(area, tokenSize = 1) {
  return (Number(area) || 0) + Math.max(1, Number(tokenSize) || 1) / 2;
}

/** The caster's token on the scene being viewed. */
function casterToken(actor) {
  return actor?.getActiveTokens?.(false, true)?.find(t => t.parent === canvas.scene) ?? null;
}

/**
 * Draw a power's aura around the caster, and tie it to the effect that times the power.
 * @param {Actor} actor
 * @param {object} o
 * @param {string} o.name           The power, as cast
 * @param {number} o.area           Its Area at this cast, in tiles
 * @param {ActiveEffect} o.effect   Its Concentration or timer
 * @param {Item} [o.item]
 * @returns {Promise<RegionDocument|null>}
 */
export async function startAura(actor, { name, area, effect, item = null }) {
  if ( !effect || !canPlaceBlast() ) return null;
  // An aura the effect still carries, from a power it held before, goes first.
  await removeAura(effect);
  const token = casterToken(actor);
  if ( !token ) {
    ui.notifications?.info(`${name}: ${actor.name} has no token on this scene, so no aura is drawn.`);
    return null;
  }
  const grid = canvas.dimensions?.size ?? canvas.grid?.size ?? 100;
  const size = Math.max(Number(token.width) || 1, Number(token.height) || 1);
  const data = blastRegionData({ name, radius: auraRadius(area, size), gridSize: grid, user: game.user,
    level: canvas.level?.id ?? null, item: item?.uuid ?? "", actor: actor.uuid });
  const center = token.object?.center ?? { x: token.x + (size * grid) / 2, y: token.y + (size * grid) / 2 };
  data.name = `${name}: aura`;
  data.shapes[0].x = center.x;
  data.shapes[0].y = center.y;
  data.attachment = { token: token.id };
  data.flags = { irop: { aura: { actor: actor.uuid, item: item?.uuid ?? "", area } } };
  try {
    const [region] = await canvas.scene.createEmbeddedDocuments("Region", [data]);
    if ( region ) await effect.update({ "flags.irop.auraRegion": region.uuid });
    return region ?? null;
  }
  catch(err) {
    console.warn("irop | The aura could not be drawn.", err);
    ui.notifications?.warn(`${name}: the aura could not be drawn (${err.message}).`);
    return null;
  }
}

/** Take away the aura an effect carries, if any. */
export async function removeAura(effect) {
  const uuid = effect?.flags?.irop?.auraRegion;
  if ( !uuid ) return;
  const region = foundry.utils.fromUuidSync(uuid);
  try { await region?.delete(); }
  catch(err) { console.warn("irop | The aura could not be removed.", err); }
  if ( effect.id && effect.parent?.effects?.has?.(effect.id) ) await effect.update({ "flags.irop.auraRegion": null });
}

/** When a power's Concentration or timer ends, its aura goes: removed by the active GM, else by whoever ended it. */
export function registerAuras() {
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    const uuid = effect.flags?.irop?.auraRegion;
    if ( !uuid ) return;
    const gm = game.users?.activeGM;
    if ( gm ? !gm.isSelf : (userId !== game.user?.id) ) return;
    const region = foundry.utils.fromUuidSync(uuid);
    region?.delete().catch(err => console.warn("irop | The aura could not be removed.", err));
  });
}

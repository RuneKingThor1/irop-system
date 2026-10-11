import { IROP } from "../config.mjs";
import { scatterOffset } from "../rules/combat.mjs";

/**
 * Blast markers (Johnald, 2026-10-09). Anything with a blast radius (grenades thrown or
 * launched, rockets, the LAW, charges and mines) is set down on the map as a circle of its
 * radius before the attack window opens; if the attack misses, Scatter moves the circle where
 * the blast lands, so nobody has to count squares.
 *
 * The marker is a Region, placed with Foundry's own placement: the circle follows the cursor, a
 * left click sets it down, a right click or Escape backs out. With no scene on screen the attack
 * goes ahead without a marker.
 */

/** Whether a blast marker can be set down now: a scene on screen. */
export function canPlaceBlast() {
  const c = globalThis.canvas;
  return !!(c?.ready && c.scene && c.regions);
}

/**
 * A blast's shape on the map (Johnald, 2026-10-09): the item's template, drawn as the true
 * shape rather than the grid squares it covers. Blast is the circle's radius, half the
 * square's side, or the length of a cone or line. At 0, 0 until placed.
 */
export function blastShape(template = "circle", radius = 1, gridSize = 100) {
  const r = radius * gridSize;
  switch ( template ) {
    case "square": return { type: "rectangle", x: 0, y: 0, width: 2 * r, height: 2 * r, anchorX: 0.5, anchorY: 0.5, rotation: 0, gridBased: false };
    case "cone": return { type: "cone", x: 0, y: 0, radius: r, angle: IROP.blastShape.coneAngle, rotation: 0, gridBased: false };
    case "line": return { type: "line", x: 0, y: 0, length: r, width: IROP.blastShape.lineWidth * gridSize, rotation: 0, gridBased: false };
    default: return { type: "circle", x: 0, y: 0, radius: r, gridBased: false };
  }
}

/** The Region data for a blast marker of some radius (in tiles), at 0, 0 until placed. */
export function blastRegionData({ name = "Blast", radius = 1, template = "circle", gridSize = 100, user = null, level = null, item = "", actor = "" } = {}) {
  const color = user?.color?.css ?? (typeof user?.color === "string" ? user.color : "#d64f4f");
  return {
    name: `${name}: blast`,
    color,
    shapes: [blastShape(template, radius, gridSize)],
    restriction: { enabled: false },
    levels: level ? [level] : [],
    highlightMode: "shapes",
    displayMeasurements: true,
    visibility: globalThis.CONST?.REGION_VISIBILITY?.ALWAYS ?? 2,
    ownership: user?.id ? { [user.id]: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3 } : {},
    flags: { irop: { blast: { radius, item, actor, scattered: false } } }
  };
}

/**
 * The player sets the blast down.
 * @param {object} input
 * @param {string} input.name       What is going off
 * @param {number} input.radius     The blast radius in tiles
 * @param {string} [input.template]  circle, square, cone, line, or none for no marker
 * @param {Actor} [input.actor]
 * @param {Item} [input.item]
 * @returns {Promise<RegionDocument|null|undefined>}   The marker; null if the player backed
 *   out (the attack is called off); undefined if no marker can be placed here (the attack goes on).
 */
export async function placeBlast({ name, radius, template = "circle", actor = null, item = null } = {}) {
  if ( !(Number(radius) > 0) || (template === "none") || !canPlaceBlast() ) return undefined;
  const data = blastRegionData({
    name, radius: Number(radius), template, gridSize: canvas.dimensions?.size ?? canvas.grid?.size ?? 100, user: game.user,
    level: canvas.level?.id ?? null, item: item?.uuid ?? "", actor: actor?.uuid ?? ""
  });
  const turns = ["cone", "line"].includes(template);
  ui.notifications?.info(`Set down where the ${name} lands: left click to place it${turns ? ", the mouse wheel to turn it" : ""}, right click to call it off.`);
  try {
    return (await canvas.regions.placeRegion(data, { allowRotation: turns })) ?? null;
  }
  catch(err) {
    console.warn("irop | The blast marker could not be placed.", err);
    ui.notifications?.warn(`The blast marker could not be placed (${err.message}). The attack goes ahead without it.`);
    return undefined;
  }
}

/**
 * Clear a marker from the map, from the damage card (Johnald, 2026-10-09). Its owner or a GM.
 * @returns {Promise<"cleared"|"gone"|"permission">}
 */
export async function clearBlast(uuid) {
  const marker = uuid ? await foundry.utils.fromUuid(uuid) : null;
  if ( !marker ) return "gone";
  if ( !(game.user.isGM || marker.isOwner) ) return "permission";
  await marker.delete();
  return "cleared";
}

/** Take a marker away, quietly (the attack it was for was called off). */
export async function removeBlast(marker) {
  try { await marker?.delete?.(); }
  catch { /* already gone */ }
}

/**
 * Move a marker where its blast scattered: some tiles in one of the eight directions.
 * Only once, and only by its owner or a GM.
 * @param {string} uuid
 * @param {number} direction   1 to 8, North first, clockwise
 * @param {number} distance    Tiles
 * @returns {Promise<{moved: boolean, reason?: "gone"|"already"|"permission"}>}
 */
export async function scatterBlast(uuid, direction, distance) {
  const marker = uuid ? await foundry.utils.fromUuid(uuid) : null;
  if ( !marker ) return { moved: false, reason: "gone" };
  if ( marker.getFlag?.("irop", "blast")?.scattered ) return { moved: false, reason: "already" };
  if ( !(game.user.isGM || marker.isOwner) ) return { moved: false, reason: "permission" };
  const grid = marker.parent?.grid ?? {};
  const size = Number(grid.size) || 100;
  const square = [0, 1].includes(grid.type);
  const { dx, dy } = scatterOffset(direction, distance, { square });
  const shapes = marker.toObject().shapes.map(s => ((typeof s.x === "number") && (typeof s.y === "number")
    ? { ...s, x: Math.round(s.x + (dx * size)), y: Math.round(s.y + (dy * size)) } : s));
  await marker.update({ shapes, "flags.irop.blast.scattered": true });
  return { moved: true };
}

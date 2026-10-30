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
export function blastShape(template = "circle", radius = 1, gridSize = 100, width = 0) {
  const r = radius * gridSize;
  switch ( template ) {
    case "square": return { type: "rectangle", x: 0, y: 0, width: 2 * r, height: 2 * r, anchorX: 0.5, anchorY: 0.5, rotation: 0, gridBased: false };
    case "cone": return { type: "cone", x: 0, y: 0, radius: r, angle: IROP.blastShape.coneAngle, rotation: 0, gridBased: false };
    case "line": return { type: "line", x: 0, y: 0, length: r, width: ((Number(width) > 0) ? Number(width) : IROP.blastShape.lineWidth) * gridSize, rotation: 0, gridBased: false };
    default: return { type: "circle", x: 0, y: 0, radius: r, gridBased: false };
  }
}

/** The Region data for a blast marker of some radius (in tiles), at 0, 0 until placed. */
export function blastRegionData({ name = "Blast", radius = 1, template = "circle", width = 0, gridSize = 100, user = null, level = null, item = "", actor = "" } = {}) {
  const color = user?.color?.css ?? (typeof user?.color === "string" ? user.color : "#d64f4f");
  return {
    name: `${name}: blast`,
    color,
    shapes: [blastShape(template, radius, gridSize, width)],
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
export async function placeBlast({ name, radius, template = "circle", width = 0, actor = null, item = null } = {}) {
  if ( !(Number(radius) > 0) || (template === "none") || !canPlaceBlast() ) return undefined;
  const data = blastRegionData({
    name, radius: Number(radius), template, width, gridSize: canvas.dimensions?.size ?? canvas.grid?.size ?? 100, user: game.user,
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

/**
 * Bend a line marker once (Johnald, 2026-10-29: Pulsar Lance's Bent Light): the caster picks the tile
 * it turns at, the side, and the angle, up to a right angle. The marker becomes two segments, the
 * second starting where the first ends; its total length is unchanged.
 * @param {RegionDocument} region   A placed line marker
 * @returns {Promise<RegionDocument|null>}   The bent marker, or null if left straight
 */
export async function bendLine(region, { maxTurn = 90 } = {}) {
  const shape = region?.toObject?.().shapes?.[0];
  if ( !shape || (shape.type !== "line") ) return null;
  const grid = canvas.dimensions?.size ?? canvas.grid?.size ?? 100;
  const tiles = Math.round(shape.length / grid);
  if ( tiles < 2 ) return null;
  const at = Array.from({ length: tiles - 1 }, (_, i) => `<option value="${i + 1}" ${(i + 1) === Math.ceil(tiles / 2) ? "selected" : ""}>after tile ${i + 1}</option>`).join("");
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: `${region.name.replace(/: blast$/, "")}: bend the line` },
    classes: ["irop", "irop-roll-dialog"],
    content: `<p>The line may turn once, up to a right angle. Leave it straight to skip.</p>
      <label class="irop-choose"><span>Bend</span><select name="at"><option value="0">Keep it straight</option>${at}</select></label>
      <label class="irop-choose"><span>Turn</span><select name="side"><option value="1">Right</option><option value="-1">Left</option></select></label>
      <label class="irop-choose"><span>Angle</span><input type="number" name="angle" value="${maxTurn}" min="0" max="${maxTurn}" step="15"></label>`,
    ok: { label: "Bend", icon: "fa-solid fa-route" }
  });
  const k = Math.round(Number(data?.at) || 0);
  const angle = Math.min(maxTurn, Math.max(0, Number(data?.angle) || 0));
  if ( !k || !angle ) return null;
  const split = bentSegments(shape, k * grid, angle * (Number(data.side) < 0 ? -1 : 1));
  await region.update({ shapes: split });
  return region;
}

/** A line shape cut at `at` pixels along it, the rest turned by `turn` degrees from there. Pure. */
export function bentSegments(shape, at, turn) {
  const rad = (shape.rotation ?? 0) * Math.PI / 180;
  const end = { x: shape.x + Math.cos(rad) * at, y: shape.y + Math.sin(rad) * at };
  return [
    { ...shape, length: at },
    { ...shape, x: end.x, y: end.y, length: shape.length - at, rotation: ((shape.rotation ?? 0) + turn + 360) % 360 }
  ];
}

import { IROP } from "../config.mjs";

/**
 * The War Room map (Strategy Layer step 2, 2026-10-08), the parts that need no
 * canvas: what colour each territory wears in each overlay, which scene region is
 * which territory, a test layout, and which regions border each other.
 */

/** The overlays a viewer can switch between, as the mockup's chips. */
export const LAYERS = {
  heat: "Heat",
  strength: "Strength",
  reputation: "Reputation",
  control: "Control"
};

const HEAT = [0x888780, 0xF09595, 0xE24B4A, 0xA32D2D, 0x791F1F];
const REPUTATION = { "-2": 0xD64F4F, "-1": 0xE08A3C, "0": 0x888780, "1": 0x5FB85F, "2": 0x3FB8B0 };
const CONTROL = { genesis: 0xC4121C, contested: 0xD9B234, liberated: 0x42ABF2 };

/**
 * How a territory looks in an overlay: a fill colour and strength, and the line
 * under its name.
 * @param {string} layer             A key of LAYERS
 * @param {object} t                 The territory's system data
 * @param {number} [strengthMax]     From the rules
 * @returns {{color: number, alpha: number, text: string}}
 */
export function overlayStyle(layer, t, strengthMax = IROP.strategyRules.strengthMax) {
  switch ( layer ) {
    case "strength": {
      const share = Math.max(0, Math.min(1, (Number(t.strength) || 0) / (strengthMax || 10)));
      return { color: 0x7F77DD, alpha: 0.12 + (share * 0.5), text: `Strength ${t.strength}` };
    }
    case "reputation": {
      const r = Math.max(-2, Math.min(2, Number(t.reputation) || 0));
      return { color: REPUTATION[String(r)], alpha: 0.4, text: IROP.reputationLevels[String(r)] };
    }
    case "control":
      return { color: CONTROL[t.control] ?? CONTROL.genesis, alpha: 0.4, text: IROP.territoryControl[t.control] ?? "" };
    default: {
      const h = Math.max(0, Math.min(4, Number(t.heat) || 0));
      return { color: HEAT[h], alpha: h ? 0.3 + (h * 0.08) : 0.15, text: `Heat ${IROP.heatLevels[h].label}` };
    }
  }
}

/** A name compared loosely: case and punctuation ignored. */
export function placeKey(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A territory's facilities as the card shows them (Johnald, 2026-10-08): each side's own
 * list, the Rebellion's with the upgrades built there, GENESIS's with a Megacity's three
 * objectives (struck through once taken). Hidden ones only for the GM; blank names skipped.
 * @param {object} system          The territory's system data
 * @param {object} [options]
 * @param {string[]} [options.upgrades]   Regional upgrades built here, by name
 * @param {boolean} [options.gm]
 * @returns {{rebellion: object[], genesis: object[]}}
 */
export function quickFacilities(system = {}, { upgrades = [], gm = false } = {}) {
  const own = side => (system.facilities?.[side] ?? [])
    .filter(f => String(f.name ?? "").trim() && (gm || !f.hidden))
    .map(f => ({ name: f.name.trim(), note: f.note ?? "", down: !!f.down, hidden: !!f.hidden, auto: false }));
  const objectives = (system.kind === "megacity")
    ? Object.entries(IROP.megacityObjectives).map(([key, name]) => ({ name, note: "Objective", down: !!system.objectives?.[key], hidden: false, auto: true }))
    : [];
  return {
    rebellion: [...upgrades.map(name => ({ name, note: "Built", down: false, hidden: false, auto: true })), ...own("rebellion")],
    genesis: [...objectives, ...own("genesis")]
  };
}

/**
 * The journal a territory's card shows (Johnald, 2026-10-08): the one linked on its
 * sheet; else a journal page named like the territory (the old Lore journal kept a page
 * a region); else a journal entry named like it. Journals as plain data.
 * @param {{name: string, system: {journal?: string}}} territory
 * @param {{uuid: string, name: string, pages: {uuid: string, name: string}[]}[]} journals
 * @returns {{uuid: string, how: "linked"|"name"}|null}
 */
export function findJournal(territory, journals = []) {
  const linked = territory?.system?.journal;
  if ( linked ) return { uuid: linked, how: "linked" };
  const key = placeKey(territory?.name);
  if ( !key ) return null;
  for ( const j of journals ) {
    const page = (j.pages ?? []).find(p => placeKey(p.name) === key);
    if ( page ) return { uuid: page.uuid, how: "name" };
  }
  const entry = journals.find(j => placeKey(j.name) === key);
  return entry ? { uuid: entry.uuid, how: "name" } : null;
}

/**
 * Which territory each region is. A territory linked to a region (its system.region
 * holds the region's UUID) is that region; otherwise a region named like a
 * territory is that territory. Each territory takes at most one region.
 * @param {{id: string, uuid: string, name: string}[]} regions
 * @param {{id: string, name: string, system: {region: string}}[]} territories
 * @returns {Map<string, {territory: object, how: "linked"|"name"}>}  region id to its territory
 */
export function matchRegions(regions, territories) {
  const out = new Map();
  const used = new Set();
  for ( const r of regions ) {
    const t = territories.find(x => x.system.region && (x.system.region === r.uuid));
    if ( t ) { out.set(r.id, { territory: t, how: "linked" }); used.add(t.id); }
  }
  for ( const r of regions ) {
    if ( out.has(r.id) ) continue;
    const t = territories.find(x => !used.has(x.id) && !x.system.region && (placeKey(x.name) === placeKey(r.name)));
    if ( t ) { out.set(r.id, { territory: t, how: "name" }); used.add(t.id); }
  }
  return out;
}

/**
 * The territories a War Room map shows: the whole campaign, or those inside one
 * territory (a Megacity's own map shows its districts).
 */
export function territoriesShown(territories, parent = "") {
  return territories.filter(t => (parent ? t.system.parent === parent : true));
}

/* -------------------------------------------- */
/*  A test layout                               */
/* -------------------------------------------- */

/**
 * A rough board for testing without the real map (2026-10-08): the sixteen vault
 * regions on a four by four grid, west to east and north to south as near as the
 * names allow. Corners are shared and nudged, so the regions tile with no gaps and
 * neighbours share an edge. Not the campaign's geography; replace it with the real
 * map, whose regions link by name.
 */
export const TEST_LAYOUT = [
  ["Old Victoria", "Neo Seattle", "Spokane Subsector", "Malmstrom"],
  ["Eight Forests", "Portlandia", "Eclipse Headquarters", "Black Hills"],
  ["Redwood Havens", "Blackrock Desert", "Reno Subsector", "SLC Subsector"],
  ["Neo LA", "No Man's Land", "The Glasslands", "Neo Denver"]
];

/**
 * The test layout's polygons inside a rectangle (the scene's own area).
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @returns {{name: string, points: number[]}[]}
 */
export function testLayout(rect) {
  const rows = TEST_LAYOUT.length;
  const cols = TEST_LAYOUT[0].length;
  const margin = Math.min(rect.width, rect.height) * 0.04;
  const w = (rect.width - (2 * margin)) / cols;
  const h = (rect.height - (2 * margin)) / rows;
  // A fixed nudge per inner corner, so the board is the same every time.
  const nudge = (i, j, axis) => {
    if ( (i === 0) || (j === 0) || (i === rows) || (j === cols) ) return 0;
    const s = Math.sin((i * 12.9898) + (j * 78.233) + (axis * 37.719)) * 43758.5453;
    return (s - Math.floor(s) - 0.5) * 0.35 * (axis ? h : w);
  };
  const corner = (i, j) => [
    Math.round(rect.x + margin + (j * w) + nudge(i, j, 0)),
    Math.round(rect.y + margin + (i * h) + nudge(i, j, 1))
  ];
  const out = [];
  TEST_LAYOUT.forEach((row, i) => row.forEach((name, j) => {
    out.push({ name, points: [...corner(i, j), ...corner(i, j + 1), ...corner(i + 1, j + 1), ...corner(i + 1, j)] });
  }));
  return out;
}

/* -------------------------------------------- */
/*  Neighbours from the map                     */
/* -------------------------------------------- */

/** The shortest distance from a point to a segment. */
function pointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = (dx * dx) + (dy * dy);
  const t = len ? Math.max(0, Math.min(1, (((px - ax) * dx) + ((py - ay) * dy)) / len)) : 0;
  return Math.hypot(px - (ax + (t * dx)), py - (ay + (t * dy)));
}

/** A polygon's edges as segments [ax, ay, bx, by]. */
function edges(points) {
  const out = [];
  for ( let i = 0; i < points.length; i += 2 ) {
    const j = (i + 2) % points.length;
    out.push([points[i], points[i + 1], points[j], points[j + 1]]);
  }
  return out;
}

/** How much of A's outline runs within `tolerance` of B's, sampled every `step` units. */
function sharedLength(a, b, tolerance, step) {
  const bEdges = b.flatMap(edges);
  let shared = 0;
  for ( const [ax, ay, bx, by] of a.flatMap(edges) ) {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / step));
    for ( let k = 0; k < n; k++ ) {
      const t = (k + 0.5) / n;
      const x = ax + ((bx - ax) * t);
      const y = ay + ((by - ay) * t);
      if ( bEdges.some(e => pointToSegment(x, y, ...e) <= tolerance) ) shared += len / n;
    }
  }
  return shared;
}

/**
 * Regions that border each other: their outlines run together for at least
 * twice the tolerance (so a shared corner, or a near miss at one point, is not a
 * border). The tolerance forgives hand drawn gaps and overlaps.
 * @param {{id: string, polygons: number[][]}[]} shapes   Each region's outlines, flat points
 * @param {number} tolerance                               In scene units (half a grid square suits)
 * @returns {[string, string][]}                           Pairs of region ids
 */
export function touchingPairs(shapes, tolerance) {
  const pairs = [];
  const step = Math.max(1, tolerance / 2);
  for ( let i = 0; i < shapes.length; i++ ) {
    for ( let j = i + 1; j < shapes.length; j++ ) {
      const a = shapes[i];
      const b = shapes[j];
      const along = Math.max(sharedLength(a.polygons, b.polygons, tolerance, step), sharedLength(b.polygons, a.polygons, tolerance, step));
      if ( along >= tolerance * 2 ) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

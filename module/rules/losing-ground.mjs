import { IROP } from "../config.mjs";

/**
 * Losing Ground (Strategy Layer step 7, 2026-10-08), kept apart from Foundry so it can
 * be tested on its own. Doc, Retaking Earth: a Megacity's three objectives taken, "the
 * Megacity and surrounding regions are considered liberated". Doc, Losing Ground: "When
 * a region is liberated, nearby Megacities and their surrounding regions spike in Heat,
 * and Strength begins to concentrate there. Once an adjacent region reaches a certain
 * amount of Strength, GENESIS launches an Incursion to retake the liberated region. This
 * prompts a high-priority mission to kneecap the Incursion."
 *
 * Strength concentrating needs nothing new: the GENESIS phase already moves Strength
 * toward hotter territories, and the spike makes the ones near the liberation hottest.
 */

const clampHeat = h => Math.max(0, Math.min(4, h));

/** Whether a Megacity has all three objectives taken. */
export function objectivesTaken(system) {
  return Object.keys(IROP.megacityObjectives).filter(k => system?.objectives?.[k]).length;
}

/**
 * What a Megacity's liberation frees: the Megacity, and the neighbours around it that are
 * not Megacities themselves (each of those must be taken on its own) and not already free.
 * @param {object} megacity       {id, name, system}
 * @param {object[]} territories  Every territory
 */
export function liberationArea(megacity, territories = []) {
  const byId = new Map(territories.map(t => [t.id, t]));
  const near = (megacity?.system?.neighbors ?? []).map(id => byId.get(id))
    .filter(t => t && (t.system.kind !== "megacity") && (t.system.control !== "liberated"));
  return [megacity, ...near];
}

/**
 * Territories within `reach` borders of an area and not liberated, nearest first.
 * @returns {{territory: object, distance: number}[]}
 */
export function nearby(areaIds = [], territories = [], reach = 1) {
  const byId = new Map(territories.map(t => [t.id, t]));
  const seen = new Set(areaIds);
  const out = [];
  let frontier = areaIds.map(id => byId.get(id)).filter(Boolean);
  for ( let distance = 1; distance <= reach; distance++ ) {
    const next = [];
    for ( const t of frontier ) {
      for ( const id of t.system.neighbors ?? [] ) {
        if ( seen.has(id) || !byId.has(id) ) continue;
        seen.add(id);
        const n = byId.get(id);
        next.push(n);
        if ( n.system.control !== "liberated" ) out.push({ territory: n, distance });
      }
    }
    frontier = next;
  }
  return out;
}

/** The Heat spike a liberation brings to the territories near it. */
export function liberationSpike(areaIds = [], territories = [], rules = IROP.strategyRules) {
  const amount = Math.max(0, Math.round(Number(rules.liberationHeat) || 0));
  const reach = Math.max(0, Math.round(Number(rules.liberationReach) || 0));
  return nearby(areaIds, territories, reach).map(({ territory: t, distance }) => {
    const from = Number(t.system.heat) || 0;
    return { id: t.id, name: t.name, distance, from, to: clampHeat(from + amount) };
  }).filter(s => s.to !== s.from);
}

/**
 * A liberation's updates: the freed territories liberated with GENESIS's Strength there
 * gone (ASSUMPTION: shattered, as the doc puts it), and the Heat spike around them.
 */
export function liberationUpdates(areaIds = [], spike = []) {
  return [
    ...areaIds.map(id => ({ _id: id, "system.control": "liberated", "system.strength": 0, "system.heatPending": 0, "system.active": false })),
    ...spike.map(s => ({ _id: s.id, "system.heat": s.to }))
  ];
}

/** Megacities liberated, of all of them. Doc: liberate every Megacity in the area to win. */
export function megacityCount(territories = []) {
  const all = territories.filter(t => t.system?.kind === "megacity");
  return { liberated: all.filter(t => t.system.control === "liberated").length, total: all.length };
}

/**
 * The Incursions a turn launches and lands (doc: Losing Ground), as turn plan lines
 * without ids. One launches against a liberated territory when a neighbour not liberated
 * has reached incursionStrength (the strongest, if several), unless one is already
 * under way there. One under way lands incursionWeeks after it launched: the territory
 * falls to Contested, GENESIS brings incursionMoves Strength in from where it massed,
 * and a Megacity's objectives are lost with it (ASSUMPTION).
 * @param {object} input
 * @param {number} input.next
 * @param {object[]} input.territories       Every territory
 * @param {(id: string) => number} input.strengthOf   Strength after this turn's moves
 * @param {object[]} input.incursions        {id, target, source, week}
 * @param {object} input.rules
 */
export function planIncursions({ next, territories = [], strengthOf = () => 0, incursions = [], rules = IROP.strategyRules } = {}) {
  const lines = [];
  const byId = new Map(territories.map(t => [t.id, t]));
  const max = Math.max(1, Number(rules.strengthMax) || 10);
  const at = Math.max(1, Math.round(Number(rules.incursionStrength) || 1));
  const weeks = Math.max(1, Math.round(Number(rules.incursionWeeks) || 1));
  const moves = Math.max(0, Math.round(Number(rules.incursionMoves) || 0));
  const underWay = new Set(incursions.map(i => i.target));

  // Under way: land, or drop if the territory is no longer liberated, or where GENESIS
  // massed has been liberated since.
  for ( const i of incursions ) {
    const target = byId.get(i.target);
    const source = byId.get(i.source);
    if ( !target || (target.system.control !== "liberated") || (source?.system.control === "liberated") ) {
      lines.push({ section: "losing", hidden: true, text: "An Incursion with nothing left to retake", ops: [], incursion: { op: "drop", id: i.id } });
      continue;
    }
    if ( (Number(i.week) || 0) + weeks > next ) continue;
    const ops = [
      { id: target.id, path: "system.control", set: "contested" },
      { id: target.id, path: "system.strength", delta: moves, min: 0, max }
    ];
    if ( source ) ops.push({ id: source.id, path: "system.strength", delta: -moves, min: 0, max });
    const megacity = target.system.kind === "megacity";
    if ( megacity ) ops.push({ id: target.id, path: "system.objectives", set: Object.fromEntries(Object.keys(IROP.megacityObjectives).map(k => [k, false])) });
    lines.push({
      section: "losing", tone: "up",
      text: `${target.name} falls: the Incursion${source ? ` from ${source.name}` : ""} lands`,
      detail: `${target.name} is Contested again${moves ? `, with ${moves} GENESIS Strength` : ""}.${megacity ? " Its objectives must be taken again." : ""}`,
      ops, incursion: { op: "land", id: i.id }
    });
  }

  // New: a liberated territory with a strong enough neighbour not liberated.
  for ( const target of territories.filter(t => t.system.control === "liberated") ) {
    if ( underWay.has(target.id) ) continue;
    const threats = (target.system.neighbors ?? []).map(id => byId.get(id))
      .filter(n => n && (n.system.control !== "liberated") && (strengthOf(n.id) >= at))
      .sort((a, b) => (strengthOf(b.id) - strengthOf(a.id)) || a.name.localeCompare(b.name));
    const source = threats[0];
    if ( !source ) continue;
    lines.push({
      section: "losing", tone: "up",
      text: `Incursion: GENESIS masses in ${source.name} to retake ${target.name}`,
      detail: `${source.name} is at Strength ${strengthOf(source.id)}. A high-priority Tactical Action opens to stop it; left alone, it lands as turn ${next + weeks} starts.`,
      ops: [], incursion: { op: "open", target: target.id, source: source.id }
    });
  }
  return lines;
}

/** An Incursion as a Tactical Action: high priority, where GENESIS masses. */
export function incursionChoice(incursion, nameOf = id => id, rules = IROP.strategyRules) {
  const weeks = Math.max(1, Math.round(Number(rules.incursionWeeks) || 1));
  return {
    id: `incursion:${incursion.id}`,
    label: `Stop the Incursion into ${nameOf(incursion.target)}`,
    territory: incursion.source,
    rewards: `High priority. Left alone or failed, it lands as turn ${(Number(incursion.week) || 0) + weeks} starts and ${nameOf(incursion.target)} falls.`,
    heat: "major",
    priority: true
  };
}

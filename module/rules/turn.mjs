import { IROP } from "../config.mjs";
import { weeklyProgress, progressBreakdown, addProgress } from "./projects.mjs";
import { planCards, effectOps, effectLedger } from "./events.mjs";
import { planIncursions } from "./losing-ground.mjs";
import { planFactionLines } from "./factions.mjs";
import { moveReputation } from "./reputation.mjs";

/**
 * The turn engine (Strategy Layer step 4, 2026-10-08). Advance week plans the new
 * week before anything changes: the GENESIS phase as the doc orders it (Megacity
 * growth every 8 turns, Strength moving toward hotter neighbours, Heat rising from
 * last week's actions or cooling after quiet weeks), the Event and Dark Event draws
 * that are due, and the ODR projects' progress from the week just ended (step 5).
 *
 * The plan is a list of lines. Each line says what happens in words and carries the
 * operations that do it. The report shows the lines, the GM unticks any that should
 * not happen, and resolvePlan turns the ticked ones into document updates. An
 * unticked line does not happen at all this week.
 *
 * A line: {id, section, text, detail?, tone: "up"|"down"|"done"|"info", ops, hidden?, completes?}
 * An op:  {id: document id, path: "system.strength", delta?: number, set?: any, min?: number, max?: number}
 *         or {id, path: "system.reputation", rep: points}: Reputation through its bar (2026-10-11),
 *         moving system.reputation and system.reputationPoints together
 * Hidden lines are bookkeeping (quiet week counts, this week's activity clearing):
 * always applied, never shown.
 *
 * ASSUMPTION: a liberated territory sits out the GENESIS phase entirely (doc:
 * GENESIS ground forces cannot move through it; Losing Ground, step 7, will say more).
 */

/** The report's sections, in turn order: the GENESIS phase, the Event phase, the ODR's projects. */
export const SECTIONS = {
  growth: "Megacities grow",
  strength: "Strength moves",
  heat: "Heat",
  losing: "Losing Ground",
  dark: "Dark Events",
  cards: "Cards leaving play",
  events: "Event phase",
  world: "World Events",
  projects: "ODR projects",
  factions: "Faction tasks"
};

const clamp = (v, min, max) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));

/**
 * Plan the turn that starts week `week + 1`.
 * @param {object} input
 * @param {number} input.week                 The week now ending
 * @param {object[]} input.territories        {id, name, system}
 * @param {object[]} [input.projects]         {id, name, system}
 * @param {Function} [input.soldierOf]        Actor id to {name, system}
 * @param {object} input.rules                The Strategy Layer rules in force
 * @param {object|null} [input.tactical]      This week's Tactical Action, if one was chosen
 * @param {object[]} [input.factions]         The factions (2026-10-11), for their tasks' lines
 * @param {object[]} [input.tasks]            Their tasks
 * @returns {{week: number, lines: object[], due: string[], warnings: string[]}}
 */
export function planTurn({ week = 1, territories = [], projects = [], soldierOf = () => null, rules = IROP.strategyRules, tactical = null,
  cards = null, incursions = [], factions = [], tasks = [], random = Math.random } = {}) {
  const next = Math.max(1, Math.round(Number(week) || 1)) + 1;
  const max = Math.max(1, Number(rules.strengthMax) || 10);
  const lines = [];
  let n = 0;
  const line = data => lines.push({ id: `l${++n}`, tone: "info", ops: [], ...data });
  const heatName = h => IROP.heatLevels[h]?.label ?? String(h);

  // The working state, so each step sees the one before it.
  const live = territories.filter(t => t.system?.control !== "liberated");
  const state = new Map(live.map(t => [t.id, { strength: Number(t.system.strength) || 0, heat: Number(t.system.heat) || 0 }]));
  const byId = new Map(live.map(t => [t.id, t]));

  // 1. Every megacityGrowthEvery turns, each Megacity gains Strength.
  const every = Math.max(1, Math.round(Number(rules.megacityGrowthEvery) || 1));
  if ( next % every === 0 ) {
    for ( const t of live.filter(t => t.system.kind === "megacity") ) {
      const s = state.get(t.id);
      const gain = Math.min(Number(rules.megacityGrowth) || 0, max - s.strength);
      if ( gain <= 0 ) continue;
      line({
        section: "growth", tone: "up",
        text: `${t.name} grows: Strength ${s.strength} to ${s.strength + gain}`,
        ops: [{ id: t.id, path: "system.strength", delta: gain, min: 0, max }]
      });
      s.strength += gain;
    }
  }

  // 2. Strength moves: each territory pulls from one cooler neighbour, rural and wildland
  // first, then slums, then Megacities; among those, the coolest, then the strongest.
  const moves = Math.max(0, Math.round(Number(rules.strengthMoves) || 0));
  const drain = t => IROP.territoryKinds[t.system.kind]?.drain ?? 1;
  const pullers = [...live].sort((a, b) => (state.get(b.id).heat - state.get(a.id).heat) || a.name.localeCompare(b.name));
  for ( const hot of moves ? pullers : [] ) {
    const h = state.get(hot.id);
    if ( h.strength >= max ) continue;
    const candidates = (hot.system.neighbors ?? []).map(id => byId.get(id)).filter(c => c && (state.get(c.id).heat < h.heat) && (state.get(c.id).strength > 0));
    if ( !candidates.length ) continue;
    candidates.sort((a, b) => (drain(a) - drain(b)) || (state.get(a.id).heat - state.get(b.id).heat)
      || (state.get(b.id).strength - state.get(a.id).strength) || a.name.localeCompare(b.name));
    const cool = candidates[0];
    const c = state.get(cool.id);
    const amount = Math.min(moves, c.strength, max - h.strength);
    if ( amount <= 0 ) continue;
    line({
      section: "strength", tone: "up",
      text: `${hot.name} pulls ${amount} Strength from ${cool.name}`,
      detail: `${hot.name} ${h.strength} to ${h.strength + amount}, ${cool.name} ${c.strength} to ${c.strength - amount}. ${hot.name} runs hotter (Heat ${heatName(h.heat)} to ${heatName(c.heat)}).`,
      ops: [
        { id: cool.id, path: "system.strength", delta: -amount, min: 0, max },
        { id: hot.id, path: "system.strength", delta: amount, min: 0, max }
      ]
    });
    h.strength += amount;
    c.strength -= amount;
  }

  // 3. Heat: last week's actions land now; two quiet weeks cool a territory.
  const quietNeeded = Math.max(1, Math.round(Number(rules.heatQuietWeeks) || 1));
  const fall = Math.max(0, Math.round(Number(rules.heatFall) || 0));
  for ( const t of live ) {
    const s = t.system;
    const heat = state.get(t.id).heat;
    const pending = Math.round(Number(s.heatPending) || 0);
    if ( pending ) {
      const to = clamp(heat + pending, 0, 4);
      const ops = [
        { id: t.id, path: "system.heat", delta: pending, min: 0, max: 4 },
        { id: t.id, path: "system.heatPending", set: 0 },
        { id: t.id, path: "system.quietWeeks", set: 0 }
      ];
      if ( to !== heat ) {
        line({ section: "heat", tone: (to > heat) ? "up" : "down",
          text: `${t.name}: Heat ${heatName(heat)} to ${heatName(to)}`, detail: `${pending > 0 ? "+" : ""}${pending} from last turn's actions.`, ops });
      }
      else line({ section: "heat", hidden: true, text: `${t.name}: Heat already at ${heatName(heat)}`, ops });
    }
    else if ( s.active ) {
      line({ section: "heat", hidden: true, text: `${t.name} saw action this turn`, ops: [{ id: t.id, path: "system.quietWeeks", set: 0 }] });
    }
    else {
      const quiet = (Math.round(Number(s.quietWeeks) || 0)) + 1;
      if ( (quiet >= quietNeeded) && (heat > 0) && fall ) {
        const to = clamp(heat - fall, 0, 4);
        line({ section: "heat", tone: "down",
          text: `${t.name}: Heat ${heatName(heat)} to ${heatName(to)}`, detail: `Quiet for ${quiet} turns.`,
          ops: [{ id: t.id, path: "system.heat", delta: -fall, min: 0, max: 4 }, { id: t.id, path: "system.quietWeeks", set: 0 }] });
      }
      else {
        line({ section: "heat", hidden: true, text: `${t.name}: quiet ${quiet} of ${quietNeeded}`,
          ops: [{ id: t.id, path: "system.quietWeeks", set: Math.min(quiet, quietNeeded) }] });
      }
    }
    if ( s.active ) line({ section: "heat", hidden: true, text: `${t.name}: a new turn`, ops: [{ id: t.id, path: "system.active", set: false }] });
  }

  // Losing Ground (step 7): Incursions against liberated territories launch and land, read
  // from Strength after this turn's moves.
  const strengthOf = id => state.get(id)?.strength ?? (Number(territories.find(t => t.id === id)?.system.strength) || 0);
  for ( const l of planIncursions({ next, territories, strengthOf, incursions, rules }) ) line(l);

  // The cards (step 6): Dark Events drawn, persistent cards leaving, the Event phase's draw.
  // Without decks, the draws are reminders, as in step 4.
  // Regional upgrades a Reprisal leaving play can destroy (step 7).
  const upgrades = projects.filter(p => (p.system?.kind === "engineering") && (p.system.builds === "regional") && (p.system.status === "complete") && p.system.territory)
    .map(p => ({ id: p.id, name: p.name, territory: p.system.territory }));
  const dealt = planCards({ next, rules, territories, random, inPlay: cards?.inPlay ?? [], held: cards?.held ?? [],
    eventDeck: cards ? cards.eventDeck : null, darkDeck: cards ? cards.darkDeck : null, worldDeck: cards?.worldDeck ?? null, upgrades });
  const order = ["dark", "cards", "events", "world"];
  for ( const section of order ) for ( const l of dealt.lines.filter(x => x.section === section) ) line(l);

  // The ODR projects: the week just ended's progress (step 5).
  for ( const p of projects.filter(p => p.system?.status === "active") ) {
    const s = p.system;
    const kind = IROP.projectKinds[s.kind]?.label ?? "Project";
    const weekly = weeklyProgress(s, soldierOf, rules);
    if ( !(s.cost > 0) ) {
      line({ section: "projects", text: `${kind}: ${p.name} has no cost yet, so it cannot progress.` });
      continue;
    }
    const after = addProgress(s, weekly.total);
    if ( !after.added ) continue;
    const unit = IROP.resources[IROP.projectKinds[s.kind]?.resource]?.label ?? "";
    const ops = [{ id: p.id, path: "system.progress", delta: after.added, min: 0, max: s.cost }];
    if ( after.complete ) ops.push({ id: p.id, path: "system.status", set: "complete" }, { id: p.id, path: "system.assigned", set: [] });
    line({
      section: "projects", tone: after.complete ? "done" : "up",
      text: `${kind}: ${p.name}, ${s.progress} to ${after.progress} of ${s.cost}${after.complete ? ". Complete" : ""}`,
      detail: `+${after.added} ${unit}: ${progressBreakdown(weekly)}.`,
      ops, completes: after.complete ? p.id : null
    });
  }

  // Faction tasks (2026-10-11): what was taken and not done in time fails; what was never taken lapses.
  for ( const l of planFactionLines({ week: next - 1, factions, tasks, rules }) ) line(l);

  // Due this week: only the draws with no deck to draw from (step 6).
  const due = dealt.due;

  const warnings = [...dealt.warnings];
  if ( !tactical ) warnings.push("No Tactical Action was taken this turn.");
  else if ( tactical.status !== "done" ) warnings.push(`This turn's Tactical Action, ${tactical.label}, was never debriefed.`);

  return { week: next, lines, due, warnings };
}

/**
 * Turn the ticked lines of a plan into updates. Hidden lines always apply.
 * Operations run in plan order on each document's current values, held to their
 * limits, so an unticked line simply drops out.
 * @param {object} plan
 * @param {Set<string>} ticked              Line ids the GM kept
 * @param {Map<string, object>} documents   Id to the document's current data ({system})
 * @returns {{updates: object[], before: object[], completes: string[]}}
 */
export function resolvePlan(plan, ticked, documents, { choices = new Map(), rules = IROP.strategyRules } = {}) {
  const values = new Map();
  const read = (id, path) => {
    const key = `${id}|${path}`;
    if ( !values.has(key) ) values.set(key, { id, path, before: getPath(documents.get(id), path) });
    return values.get(key);
  };
  const completes = [];
  const cardOps = [];
  const ledger = [];
  const incursionOps = [];
  const factionOps = [];
  for ( const l of plan.lines ) {
    let ops = l.ops;
    // A Dark Event drawn: used where the GM chose, or discarded unused (step 6).
    if ( l.card?.op === "dark" ) {
      const used = ticked.has(l.id);
      const territory = choices.get(l.id) ?? "";
      cardOps.push({ ...l.card, op: used ? "use" : "skip", territory });
      if ( !used || l.card.discretionary ) continue;
      ops = effectOps(l.card.effect, territory, rules);
      ledger.push(...effectLedger(l.card.effect, `Dark Event: ${l.card.name}`));
    }
    else if ( !l.hidden && !ticked.has(l.id) ) continue;
    else {
      if ( l.card ) cardOps.push(l.card);
      if ( l.ledger?.length ) ledger.push(...l.ledger);
      if ( l.incursion ) incursionOps.push(l.incursion);
      if ( l.factionOp ) factionOps.push(l.factionOp);
    }
    for ( const op of ops ) {
      if ( !documents.has(op.id) ) continue;
      if ( "rep" in op ) {
        const lv = read(op.id, "system.reputation");
        const pt = read(op.id, "system.reputationPoints");
        const now = v => (("value" in v) ? v.value : v.before);
        const next = moveReputation({ level: now(lv), points: now(pt) }, op.rep);
        lv.value = next.level;
        pt.value = next.points;
        continue;
      }
      const v = read(op.id, op.path);
      const now = ("value" in v) ? v.value : v.before;
      v.value = ("set" in op) ? op.set : clamp((Number(now) || 0) + op.delta, op.min, op.max);
    }
    if ( l.completes ) completes.push(l.completes);
  }
  const updates = new Map();
  const before = new Map();
  for ( const v of values.values() ) {
    if ( !("value" in v) || (JSON.stringify(v.value) === JSON.stringify(v.before)) ) continue;
    if ( !updates.has(v.id) ) { updates.set(v.id, { _id: v.id }); before.set(v.id, { _id: v.id }); }
    updates.get(v.id)[v.path] = v.value;
    before.get(v.id)[v.path] = v.before;
  }
  return { updates: [...updates.values()], before: [...before.values()], completes, cardOps, ledger, incursionOps, factionOps };
}

function getPath(obj, path) {
  const value = path.split(".").reduce((o, k) => o?.[k], obj);
  return (value && (typeof value === "object")) ? JSON.parse(JSON.stringify(value)) : value;
}

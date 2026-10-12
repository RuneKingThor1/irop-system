import { IROP } from "../config.mjs";
import { repState, moveReputation, sameState, levelText, levelLabel, levelTone, stateText } from "./reputation.mjs";

/**
 * Factions (2026-10-11): the ODR's standing with the other groups on the board, and
 * the tasks they offer from turn to turn. Kept apart from Foundry so it can be tested
 * on its own. The world keeps three lists (settings.mjs): the factions, their tasks,
 * and a log of every standing change with its reason.
 *
 * A faction: {id, name, tier: "major"|"minor", standing, points, stance, img, notes, home, hidden}
 *   standing   its level, -4 (At War) to +4 (Allied), on IROP.factionLevels; points, the points
 *              in that level's bar. RULED 2026-10-11: the Reputation engine, rules/reputation.mjs
 *   stance     the nuance a number cannot carry: "Dangerous ally", "Business only"
 *   home       a territory id, or ""
 *   hidden     not yet known to the players
 *
 * A task: {id, faction, title, brief, status, term, week, due, standing, failure, logistics,
 *          intel, reward, rival, rivalLoss, operatives, by, outcome, result, resolvedWeek}
 *   status     draft (the GM's), offered, accepted (taken), resolved, lapsed
 *   week, due  the turn it was offered and the last turn it can be done in
 *   standing   points doing it earns with the faction; failure the points failing it costs
 *   rival      a faction it works against, which loses rivalLoss when it is done
 *   reward     anything else it brings, in words ("a crate of rifles")
 *   result     what the resolve actually gave: {standing, rival, logistics, intel, notes}
 */

const int = v => Math.round(Number(v) || 0);
const text = v => String(v ?? "").trim();

/** A faction's level on its ladder: {key: its color family, label, text}. */
export function factionLevel(level) {
  const entry = IROP.factionLevels[String(repState(level).level)] ?? IROP.factionLevels["0"];
  return { key: levelTone(level), label: entry.label, text: entry.text };
}

/** "+2 Friendly", "0 Neutral", "-3 Hostile". */
export function standingText(level) {
  return levelText(level, IROP.factionLevels);
}

/** "Friendly, 7 of 10". */
export function standingState(faction) {
  return stateText({ level: faction.standing, points: faction.points }, IROP.factionLevels);
}

/** A signed change: "+2", "-1". */
export function signed(n) {
  return `${n > 0 ? "+" : ""}${int(n)}`;
}

/** A faction as saved, with defaults for anything missing: a new faction sits mid bar. */
export function normalizeFaction(raw = {}) {
  const state = repState(raw.standing, raw.points);
  return {
    id: text(raw.id),
    name: text(raw.name) || "Unnamed faction",
    tier: IROP.factionTiers[raw.tier] ? raw.tier : "minor",
    standing: state.level,
    points: state.points,
    stance: text(raw.stance),
    img: text(raw.img),
    notes: text(raw.notes),
    home: text(raw.home),
    hidden: !!raw.hidden
  };
}

/** A task as saved, with defaults from the rules for anything missing. */
export function normalizeTask(raw = {}, rules = IROP.strategyRules) {
  const f = rules.factions ?? IROP.strategyRules.factions;
  const has = key => (raw[key] !== undefined) && (raw[key] !== null) && (raw[key] !== "");
  const status = IROP.factionTaskStatus[raw.status] ? raw.status : "draft";
  return {
    id: text(raw.id),
    faction: text(raw.faction),
    title: text(raw.title) || "Untitled task",
    brief: text(raw.brief),
    status,
    term: Math.max(1, int(has("term") ? raw.term : f.taskTurns)),
    week: has("week") ? Math.max(1, int(raw.week)) : null,
    due: has("due") ? Math.max(1, int(raw.due)) : null,
    standing: Math.max(0, int(has("standing") ? raw.standing : f.taskStanding)),
    failure: Math.max(0, int(has("failure") ? raw.failure : f.taskFailure)),
    logistics: Math.max(0, int(raw.logistics)),
    intel: Math.max(0, int(raw.intel)),
    reward: text(raw.reward),
    rival: text(raw.rival),
    rivalLoss: Math.max(0, int(has("rivalLoss") ? raw.rivalLoss : f.rivalLoss)),
    operatives: [...new Set((raw.operatives ?? []).map(text).filter(Boolean))],
    by: text(raw.by),
    outcome: IROP.missionOutcomes[raw.outcome] ? raw.outcome : "",
    result: raw.result ?? null,
    resolvedWeek: has("resolvedWeek") ? int(raw.resolvedWeek) : null
  };
}

/** Whether a task is still to be done: offered or taken. */
export function isOpen(task) {
  return (task.status === "offered") || (task.status === "accepted");
}

/** When a task is due, in words, seen from turn `week`. */
export function dueText(task, week) {
  if ( !task.due ) return `Runs ${task.term} turn${task.term === 1 ? "" : "s"} once offered`;
  const left = task.due - week;
  if ( left < 0 ) return `Overdue since turn ${task.due}`;
  if ( left === 0 ) return "Due this turn";
  return `Due by turn ${task.due}, ${left + 1} turns left`;
}

/** What a task offers, in words: "+1 standing, +20 Logistics, a crate of rifles". */
export function rewardText(task) {
  const parts = [];
  if ( task.standing ) parts.push(`${signed(task.standing)} standing points`);
  if ( task.logistics ) parts.push(`+${task.logistics} Logistics`);
  if ( task.intel ) parts.push(`+${task.intel} Intel`);
  if ( task.reward ) parts.push(task.reward);
  return parts.join(", ");
}

/**
 * What resolving a task gives, by outcome, for the GM to change before it is saved.
 * A success earns it all; a partial success the rules' share, rounded down; a failure
 * costs the task's failure standing and brings nothing. A rival loses standing whenever
 * the work was done at all.
 */
export function taskResults(task, outcome, rules = IROP.strategyRules) {
  const f = rules.factions ?? IROP.strategyRules.factions;
  const t = normalizeTask(task, rules);
  if ( outcome === "failure" ) return { standing: -t.failure, rival: 0, logistics: 0, intel: 0 };
  const share = (outcome === "partial") ? Math.max(0, Math.min(100, Number(f.partialPercent) || 0)) / 100 : 1;
  const part = n => Math.floor(n * share);
  return { standing: part(t.standing), rival: t.rival ? -t.rivalLoss : 0, logistics: part(t.logistics), intel: part(t.intel) };
}

/**
 * Move a faction's standing by points, through its bar (rules/reputation.mjs).
 * @returns {{factions: object[], changed: boolean, moved: number, from: {level, points}, to: {level, points}}|null}
 *   null if no such faction
 */
export function changeStanding(factions, id, delta) {
  const i = factions.findIndex(f => f.id === id);
  if ( i < 0 ) return null;
  const from = repState(factions[i].standing, factions[i].points);
  const r = moveReputation(from, delta);
  const to = { level: r.level, points: r.points };
  const next = [...factions];
  next[i] = { ...factions[i], standing: to.level, points: to.points };
  return { factions: next, changed: !sameState(from, to), moved: r.moved, from, to };
}

/** What a change of standing does, in words: "Friendly, 7 of 10" or "down to Wary". */
export function standingChange(from, to) {
  if ( to.level > from.level ) return `up to ${levelLabel(to.level, IROP.factionLevels)}`;
  if ( to.level < from.level ) return `down to ${levelLabel(to.level, IROP.factionLevels)}`;
  return stateText(to, IROP.factionLevels);
}

/** What a loss would do to a faction, for the turn report: "Trusted, 5 to 3 of 10", "Friendly, 1 of 10, down to Cordial". */
function lossText(faction, loss) {
  const from = repState(faction.standing, faction.points);
  const r = moveReputation(from, -loss);
  if ( r.level === from.level ) return `${levelLabel(from.level, IROP.factionLevels)}, ${from.points} to ${r.points} of ${IROP.reputationScale.points}`;
  return `${stateText(from, IROP.factionLevels)}, ${standingChange(from, r)}`;
}

/**
 * The Advance turn report's faction lines: at the end of turn `week`, a task that was
 * taken and is due is failed (not done in time), and one offered but never taken lapses.
 * Each line carries a factionOp for applyFactionOps; an unticked line leaves the task
 * as it is, still open.
 * @param {{week: number, factions: object[], tasks: object[], rules?: object}} input
 * @returns {object[]}   Lines {section: "factions", text, detail, tone, factionOp}
 */
export function planFactionLines({ week = 1, factions = [], tasks = [], rules = IROP.strategyRules } = {}) {
  const f = rules.factions ?? IROP.strategyRules.factions;
  const byId = new Map(factions.map(x => [x.id, x]));
  const lines = [];
  for ( const raw of tasks ) {
    const task = normalizeTask(raw, rules);
    if ( !isOpen(task) || !task.due || (task.due > week) ) continue;
    const faction = byId.get(task.faction);
    const who = faction?.name ?? "An unknown faction";
    if ( task.status === "accepted" ) {
      const loss = task.failure;
      lines.push({
        section: "factions", tone: "down",
        text: `${who}: ${task.title} was not done in time${loss ? `. Standing -${loss}` : ""}`,
        detail: (faction && loss) ? `${lossText(faction, loss)}. Counts as a failure.` : "Counts as a failure.",
        factionOp: { task: task.id, status: "resolved", outcome: "failure", changes: loss ? [{ faction: task.faction, delta: -loss }] : [], reason: `Task failed, not done in time: ${task.title}` }
      });
    }
    else {
      const loss = Math.max(0, int(f.lapseLoss));
      lines.push({
        section: "factions", tone: loss ? "down" : "info",
        text: `${who}: ${task.title} lapses, never taken${loss ? `. Standing -${loss}` : ""}`,
        detail: (loss && faction) ? `${lossText(faction, loss)}.` : "",
        factionOp: { task: task.id, status: "lapsed", outcome: "", changes: loss ? [{ faction: task.faction, delta: -loss }] : [], reason: `Task turned down: ${task.title}` }
      });
    }
  }
  return lines;
}

/**
 * Apply faction ops (from the turn report, or a resolve): tasks change status and
 * standings move, each change logged. Pure: returns new lists.
 * @param {{factions: object[], tasks: object[]}} state
 * @param {object[]} ops      {task, status, outcome, changes: [{faction, delta}], reason, result?}
 * @param {{week: number, id?: () => string, time?: number}} options
 * @returns {{factions: object[], tasks: object[], log: object[]}}   log: the new entries only, each
 *   {id, week, faction, name, delta, from: {level, points}, to: {level, points}, moved, reason, task, time}
 */
export function applyFactionOps({ factions = [], tasks = [] } = {}, ops = [], { week = 1, id = () => Math.random().toString(36).slice(2, 18), time = Date.now() } = {}) {
  let fs = [...factions];
  const ts = [...tasks];
  const log = [];
  for ( const op of ops ) {
    const i = ts.findIndex(t => t.id === op.task);
    if ( op.task && (i >= 0) ) {
      ts[i] = { ...ts[i], status: op.status ?? ts[i].status, outcome: op.outcome ?? ts[i].outcome ?? "", resolvedWeek: week };
      if ( op.result ) ts[i].result = op.result;
    }
    for ( const c of op.changes ?? [] ) {
      const change = changeStanding(fs, c.faction, c.delta);
      if ( !change || !change.changed ) continue;
      fs = change.factions;
      const name = fs.find(f => f.id === c.faction)?.name ?? "";
      log.push({ id: id(), week, faction: c.faction, name, delta: int(c.delta), from: change.from, to: change.to, moved: change.moved,
        reason: c.reason ?? op.reason ?? "", task: op.task ?? "", time });
    }
  }
  return { factions: fs, tasks: ts, log };
}

/** An operative goes on one open task at a time: taken off any other, put on this one. */
export function assignToTask(tasks, taskId, actorId) {
  return tasks.map(t => {
    const others = (t.operatives ?? []).filter(a => a !== actorId);
    if ( t.id === taskId ) return { ...t, operatives: [...others, actorId] };
    return (others.length !== (t.operatives ?? []).length) && isOpen(t) ? { ...t, operatives: others } : t;
  });
}

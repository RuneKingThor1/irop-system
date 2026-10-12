import { IROP } from "../config.mjs";
import {
  normalizeFaction, normalizeTask, applyFactionOps, assignToTask, taskResults, isOpen, standingChange, signed, rewardText
} from "../rules/factions.mjs";
import { repState, sameState, repRank } from "../rules/reputation.mjs";
import { getWarRoom, getStrategyRules, recordResource, getList, setList } from "../settings.mjs";
import { registerAction } from "../socket.mjs";
import { displayName } from "./odr.mjs";

/**
 * Factions on the Strategy Layer (2026-10-11): the ODR's standing with each group, and
 * the tasks they offer. The GM keeps the factions and writes the tasks; the players, who
 * drive the ODR phase, take tasks and put their own operatives on them through the
 * socket; the GM resolves each one, or Advance turn fails or lapses what ran out of time.
 */

/** Standing changes kept in the log. */
export const LOG_KEPT = 300;

const CARDS = "systems/irop/templates/chat";
const render = (file, data) => foundry.applications.handlebars.renderTemplate(`${CARDS}/${file}`, data);
const newId = () => foundry.utils.randomID();

/** The world's factions. */
export function getFactions() {
  return getList("factions").map(f => normalizeFaction(f));
}

/** The world's faction tasks, every status. */
export function getTasks(rules = getStrategyRules()) {
  return getList("factionTasks").map(t => normalizeTask(t, rules));
}

/** Every standing change, oldest first. */
export function getFactionLog() {
  return getList("factionLog");
}

/** A faction's name, or a stand in once it is gone. */
export function factionName(id, factions = getFactions()) {
  return factions.find(f => f.id === id)?.name ?? "A faction since removed";
}

/** Save the factions, the tasks and the log after a change: only what changed is written. */
async function save({ factions, tasks, log = [] }) {
  if ( factions ) await setList("factions", factions);
  if ( tasks ) await setList("factionTasks", tasks);
  if ( log.length ) await setList("factionLog", [...getFactionLog(), ...log].slice(-LOG_KEPT));
}

/** Apply ops this turn (a resolve, a GM's change): standings move and are logged. */
async function apply(ops) {
  const out = applyFactionOps({ factions: getFactions(), tasks: getTasks() }, ops, { week: getWarRoom().week, id: newId });
  await save(out);
  return out;
}

/* -------------------------------------------- */
/*  The GM's: factions                          */
/* -------------------------------------------- */

/**
 * Save a faction: a new one without an id. A standing set here (its level and points) is
 * logged as the GM's. GM only.
 */
export async function saveFaction(data = {}) {
  if ( !game.user.isGM ) return null;
  const list = getFactions();
  const i = data.id ? list.findIndex(f => f.id === data.id) : -1;
  const faction = normalizeFaction({ ...(list[i] ?? {}), ...data, id: data.id || newId() });
  if ( i < 0 ) {
    await setList("factions", [...list, faction]);
    return faction;
  }
  const next = [...list];
  next[i] = faction;
  await setList("factions", next);
  const from = repState(list[i].standing, list[i].points);
  const to = repState(faction.standing, faction.points);
  if ( !sameState(from, to) ) {
    const moved = Math.sign(to.level - from.level);
    await save({ log: [{ id: newId(), week: getWarRoom().week, faction: faction.id, name: faction.name, delta: null, from, to, moved,
      reason: "Set by the GM", task: "", time: Date.now() }] });
  }
  return faction;
}

/** Remove a faction and every task of theirs. Their log lines stay, under the name they had. GM only. */
export async function deleteFaction(id) {
  if ( !game.user.isGM ) return null;
  await setList("factions", getFactions().filter(f => f.id !== id));
  await setList("factionTasks", getTasks().filter(t => t.faction !== id));
  return true;
}

/** Raise or lower a faction's standing by points, through its bar, logged with the reason. GM only. */
export async function adjustStanding(id, delta, reason = "Set by the GM") {
  if ( !game.user.isGM || !Math.round(Number(delta) || 0) ) return null;
  return apply([{ changes: [{ faction: id, delta: Math.round(Number(delta)), reason }] }]);
}

/** Show a faction to the players, or hide it. GM only. */
export async function setFactionHidden(id, hidden) {
  if ( !game.user.isGM ) return null;
  return setList("factions", getFactions().map(f => (f.id === id ? { ...f, hidden: !!hidden } : f)));
}

/* -------------------------------------------- */
/*  The GM's: tasks                             */
/* -------------------------------------------- */

/**
 * Save a task: a new one, a draft, without an id. Changing the turns an open task runs
 * moves its deadline from the turn it was offered. GM only.
 */
export async function saveTask(data = {}) {
  if ( !game.user.isGM ) return null;
  const rules = getStrategyRules();
  const list = getTasks(rules);
  const i = data.id ? list.findIndex(t => t.id === data.id) : -1;
  const task = normalizeTask({ ...(list[i] ?? { status: "draft" }), ...data, id: data.id || newId() }, rules);
  if ( isOpen(task) && task.week ) task.due = task.week + task.term - 1;
  const next = [...list];
  if ( i < 0 ) next.push(task);
  else next[i] = task;
  await setList("factionTasks", next);
  return task;
}

/** Offer a draft: due by the end of its last turn, and the table is told. GM only. */
export async function offerTask(id, { announce = true } = {}) {
  if ( !game.user.isGM ) return null;
  const list = getTasks();
  const task = list.find(t => t.id === id);
  if ( !task || (task.status !== "draft") ) return null;
  const week = getWarRoom().week;
  const offered = { ...task, status: "offered", week, due: week + task.term - 1, operatives: [], by: "" };
  await setList("factionTasks", list.map(t => (t.id === id ? offered : t)));
  if ( announce ) await announceTask(offered, "offered");
  return offered;
}

/** Take a task back off the table, to the drafts: no standing changes. GM only. */
export async function withdrawTask(id) {
  if ( !game.user.isGM ) return null;
  return setList("factionTasks", getTasks().map(t => (t.id === id && isOpen(t)
    ? { ...t, status: "draft", week: null, due: null, operatives: [], by: "" } : t)));
}

/** Delete a task outright. GM only. */
export async function deleteTask(id) {
  if ( !game.user.isGM ) return null;
  return setList("factionTasks", getTasks().filter(t => t.id !== id));
}

/** What the resolve dialog starts from. */
export function resolveDefaults(task, rules = getStrategyRules()) {
  return {
    outcome: "success",
    ...taskResults(task, "success", rules),
    resultsFor: Object.fromEntries(Object.keys(IROP.missionOutcomes).map(o => [o, taskResults(task, o, rules)]))
  };
}

/**
 * Resolve a task as the GM saw it go. Logistics and Intel go to the ledger; the faction's
 * standing moves, and the rival's; the table gets a card. GM only.
 * @param {string} id
 * @param {{outcome: string, standing: number, rival: number, logistics: number, intel: number, notes: string}} data
 */
export async function resolveTask(id, data = {}) {
  if ( !game.user.isGM ) return null;
  const task = getTasks().find(t => t.id === id);
  if ( !task || !isOpen(task) ) return null;
  const outcome = IROP.missionOutcomes[data.outcome] ? data.outcome : "success";
  const n = v => Math.round(Number(v) || 0);
  const result = {
    standing: n(data.standing), rival: task.rival ? Math.min(0, n(data.rival)) : 0,
    logistics: Math.max(0, n(data.logistics)), intel: Math.max(0, n(data.intel)), notes: String(data.notes ?? "").trim()
  };
  const factions = getFactions();
  const reason = `Task: ${task.title} (${factionName(task.faction, factions)})`;
  if ( result.logistics ) await recordResource({ resource: "logistics", amount: result.logistics, reason });
  if ( result.intel ) await recordResource({ resource: "intel", amount: result.intel, reason });
  const said = `Task ${IROP.missionOutcomes[outcome].toLowerCase()}: ${task.title}`;
  const changes = [];
  if ( result.standing ) changes.push({ faction: task.faction, delta: result.standing, reason: said });
  if ( result.rival ) changes.push({ faction: task.rival, delta: result.rival, reason: `Worked against them: ${task.title}, for ${factionName(task.faction, factions)}` });
  const out = await apply([{ task: id, status: "resolved", outcome, result, changes }]);
  const done = out.tasks.find(t => t.id === id);
  await announceTask(done, "resolved", { factions: out.factions, log: out.log });
  return done;
}

/** Post a task to chat: offered, or resolved with what it gave. */
async function announceTask(task, kind, { factions = getFactions(), log = [] } = {}) {
  return ChatMessage.implementation.create({
    speaker: { alias: "ODR Command" },
    content: await render("faction-task.hbs", taskCardContext(task, kind, { factions, log }))
  });
}

/** What a task's chat card says. */
export function taskCardContext(task, kind, { factions = getFactions(), log = [] } = {}) {
  const faction = factions.find(f => f.id === task.faction);
  const tier = IROP.factionTiers[faction?.tier] ?? IROP.factionTiers.minor;
  const r = task.result ?? {};
  return {
    kind,
    resolved: kind === "resolved",
    title: task.title,
    brief: task.brief,
    faction: faction?.name ?? factionName(task.faction, factions),
    img: faction?.img ?? "",
    icon: tier.icon,
    week: task.resolvedWeek ?? task.week,
    due: task.due,
    offers: rewardText(task),
    failure: task.failure,
    rival: task.rival ? factionName(task.rival, factions) : "",
    rivalLoss: task.rivalLoss,
    outcome: task.outcome,
    outcomeLabel: IROP.missionOutcomes[task.outcome] ?? "",
    gains: [r.logistics ? `+${r.logistics} Logistics` : "", r.intel ? `+${r.intel} Intel` : ""].filter(Boolean),
    standings: log.map(l => ({ text: `${l.name}: ${signed(l.delta)}, ${standingChange(l.from, l.to)}`, up: repRank(l.to) >= repRank(l.from) })),
    by: task.by,
    notes: r.notes ?? ""
  };
}

/* -------------------------------------------- */
/*  Players: taking tasks                       */
/* -------------------------------------------- */

/** An open task the user can see: offered or taken, from a faction the players know. */
function visibleTask(id, user) {
  const task = getTasks().find(t => t.id === id);
  if ( !task || !isOpen(task) ) return null;
  if ( !user.isGM && getFactions().find(f => f.id === task.faction)?.hidden ) return null;
  return task;
}

/** Can this user put this operative on a task? */
function operativeFor(actorId, user) {
  const actor = game.actors?.get(actorId);
  if ( actor?.type !== "operative" ) return { error: "Only operatives take faction tasks." };
  if ( !user.isGM && !actor.testUserPermission(user, "OWNER") ) return { error: `${actor.name} is not yours to send.` };
  return { actor };
}

/** Take an offered task, signed with the player's character; an operative may go on it at once. */
async function acceptTask({ id, actor }, user) {
  const task = visibleTask(id, user);
  if ( !task ) return { error: "That task is no longer open." };
  if ( task.status === "accepted" ) return { error: `${task.title} is already taken, by ${task.by || "the ODR"}.` };
  let tasks = getTasks().map(t => (t.id === id ? { ...t, status: "accepted", by: displayName(user) } : t));
  let who = "";
  if ( actor ) {
    const op = operativeFor(actor, user);
    if ( op.error ) return op;
    tasks = assignToTask(tasks, id, op.actor.id);
    who = `, sending ${op.actor.name}`;
  }
  await setList("factionTasks", tasks);
  return { notice: `took ${task.title} for ${factionName(task.faction)}${who}` };
}

/** Put a taken task back on offer, its operatives free. */
async function releaseTask({ id }, user) {
  const task = visibleTask(id, user);
  if ( !task || (task.status !== "accepted") ) return { error: "That task is not taken." };
  await setList("factionTasks", getTasks().map(t => (t.id === id ? { ...t, status: "offered", by: "", operatives: [] } : t)));
  return { notice: `put back ${task.title}` };
}

/** Send an operative on a taken task: one open task each, so they leave any other. */
async function assignTask({ id, actor }, user) {
  const task = visibleTask(id, user);
  if ( !task || (task.status !== "accepted") ) return { error: "Take the task before sending anyone on it." };
  const op = operativeFor(actor, user);
  if ( op.error ) return op;
  await setList("factionTasks", assignToTask(getTasks(), id, op.actor.id));
  return { notice: `${op.actor.name} goes on ${task.title}` };
}

/** Bring an operative back off a task. */
async function unassignTask({ id, actor }, user) {
  const task = visibleTask(id, user);
  if ( !task ) return { error: "That task is no longer open." };
  const a = game.actors?.get(actor);
  if ( !user.isGM && a && !a.testUserPermission(user, "OWNER") ) return { error: `${a.name} is not yours to move.` };
  await setList("factionTasks", getTasks().map(t => (t.id === id ? { ...t, operatives: t.operatives.filter(x => x !== actor) } : t)));
  return { notice: `${a?.name ?? "An operative"} comes off ${task.title}` };
}

/* -------------------------------------------- */
/*  Advance turn                                */
/* -------------------------------------------- */

/** The factions, tasks and log as they are, kept so Undo can put them back. */
export function factionSnapshot() {
  return { factions: getList("factions"), tasks: getList("factionTasks"), log: getList("factionLog") };
}

/** Put the factions back as a snapshot had them. GM only. */
export async function restoreFactions(snapshot) {
  if ( !game.user.isGM || !snapshot ) return null;
  await setList("factions", snapshot.factions ?? []);
  await setList("factionTasks", snapshot.tasks ?? []);
  await setList("factionLog", snapshot.log ?? []);
  return true;
}

/** The turn report's ticked faction lines: tasks failed or lapsed at the end of turn `week`. GM only. */
export async function applyFactionTurn(ops, week) {
  if ( !game.user.isGM || !ops?.length ) return null;
  const out = applyFactionOps({ factions: getFactions(), tasks: getTasks() }, ops, { week, id: newId });
  await save(out);
  return out;
}

/** The actions a player can ask the GM's client to run. Called once, at init. */
export function registerFactionActions() {
  registerAction("faction.accept", acceptTask);
  registerAction("faction.release", releaseTask);
  registerAction("faction.assign", assignTask);
  registerAction("faction.unassign", unassignTask);
}

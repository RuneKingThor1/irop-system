import { IROP } from "../config.mjs";
import {
  canStart, bestSkill, assignSoldier, addProgress, salvageProgress, skillLabel, qualifyingSkills,
  tacticalChoices, debriefTerritory, strengthBand, reputationEffect, defaultReputation, perkRewards
} from "../rules/projects.mjs";
import { getWarRoom, setWarRoom, getStrategyRules, recordResource, getList, setList, temperatureUnit, getSquad } from "../settings.mjs";
import { registerAction } from "../socket.mjs";
import { responseChoices, discardInPlay } from "./events.mjs";
import { incursionChoices, breakIncursion } from "./losing-ground.mjs";
import { objectivesTaken } from "../rules/losing-ground.mjs";
import { territoryWeather, weatherLine } from "../rules/weather.mjs";
import { dateInfo, onStrategyLayer, weatherSeason } from "../calendar.mjs";
import { repState, levelText, changeText } from "../rules/reputation.mjs";

/**
 * The ODR phase (Strategy Layer step 5, 2026-10-08): Research, Engineering and
 * Intelligence projects, and the week's Tactical Action with its briefing and
 * debrief. Every change here runs on a GM's client: players reach it through the
 * socket (socket.mjs), and each action checks what that player may do.
 */

const CARDS = "systems/irop/templates/chat";
const render = (file, data) => foundry.applications.handlebars.renderTemplate(`${CARDS}/${file}`, data);

/** The world's projects. */
export function worldProjects() {
  return game.items?.filter(i => i.type === "project") ?? [];
}

/** A project as the rules functions take it. */
export function plainProject(item) {
  const s = item.system;
  return {
    id: item.id, name: item.name, kind: s.kind, status: s.status, cost: s.cost, progress: s.progress,
    specialization: [...(s.specialization ?? [])], term: s.term, builds: s.builds, territory: s.territory,
    reveals: s.reveals, salvage: s.salvage, assigned: (s.assigned ?? []).map(a => ({ actor: a.actor, skill: a.skill }))
  };
}

/**
 * The deployed squad as perkRewards takes it: each operative with the names of the perks that add to
 * a mission's rewards (their effects raise system.bonuses.strategy.mission).
 */
export function squadForPerks(squad = getSquad()) {
  const adds = effect => (effect.system?.changes ?? effect.changes ?? []).some(c => String(c.key ?? "").startsWith("system.bonuses.strategy.mission"));
  return squad.map(actor => ({
    name: actor.name,
    system: actor.system,
    perks: [...new Set([...(actor.appliedEffects ?? [])].filter(adds).map(e => e.name))]
  }));
}

/** An operative as the rules functions take it. */
export function soldierOf(id) {
  const actor = game.actors?.get(id);
  return (actor?.type === "operative") ? { name: actor.name, system: actor.system } : null;
}

/** How a user signs what they did: their character, else their name. */
export function displayName(user) {
  return user?.character?.name ?? user?.name ?? "Someone";
}

function project(id) {
  const item = game.items?.get(id);
  return (item?.type === "project") ? item : null;
}

const kindLabel = item => IROP.projectKinds[item.system.kind]?.label ?? "Project";

/* -------------------------------------------- */
/*  Projects                                    */
/* -------------------------------------------- */

/**
 * Start a project. Research switches: the one under way goes back to the list with
 * its progress, and its soldiers move over if they can work the new one.
 */
async function startProject({ id }, user) {
  const item = project(id);
  if ( !item ) return { error: "That project is gone." };
  const all = worldProjects().map(plainProject);
  const check = canStart(plainProject(item), all, getStrategyRules());
  if ( !check.ok ) return { error: check.reason };
  const moving = [];
  const updates = check.replaces.map(rid => {
    const old = all.find(p => p.id === rid);
    for ( const a of old?.assigned ?? [] ) {
      const best = bestSkill(plainProject(item), soldierOf(a.actor)?.system);
      if ( best ) moving.push({ actor: a.actor, skill: best.skill });
    }
    return { _id: rid, "system.status": "available", "system.assigned": [] };
  });
  updates.push({ _id: item.id, "system.status": "active", "system.assigned": [...plainProject(item).assigned, ...moving] });
  await Item.updateDocuments(updates);
  return { notice: `started ${kindLabel(item)}: ${item.name}` };
}

/** Stop a project: back to the list, progress kept, its soldiers free. */
async function stopProject({ id }, user) {
  const item = project(id);
  if ( !item ) return { error: "That project is gone." };
  if ( item.system.status !== "active" ) return { error: `${item.name} is not under way.` };
  await item.update({ "system.status": "available", "system.assigned": [] });
  return { notice: `stopped ${kindLabel(item)}: ${item.name}` };
}

/** Put an operative on a project, with the skill that adds most. Players assign only their own. */
async function assign({ id, actor: actorId }, user) {
  const item = project(id);
  const actor = game.actors?.get(actorId);
  if ( !item || !actor ) return { error: "That project or operative is gone." };
  if ( actor.type !== "operative" ) return { error: "Only operatives work on projects." };
  if ( !user.isGM && !actor.testUserPermission(user, "OWNER") ) return { error: `${actor.name} is not yours to assign.` };
  if ( item.system.status !== "active" ) return { error: `${item.name} is not under way. Start it first.` };
  const best = bestSkill(plainProject(item), actor.system);
  if ( !best ) {
    const needs = qualifyingSkills(plainProject(item)).map(skillLabel).join(", ") || "skills the GM has not set";
    return { error: `${actor.name} has none of the skills ${item.name} takes (${needs}), at a rank or more.` };
  }
  const changes = assignSoldier(worldProjects().map(plainProject), item.id, actor.id, best.skill);
  const updates = Object.entries(changes).map(([pid, assigned]) => ({ _id: pid, "system.assigned": assigned }));
  if ( updates.length ) await Item.updateDocuments(updates);
  return { notice: `${actor.name} works on ${item.name} (${skillLabel(best.skill)}, +${best.amount} a turn)` };
}

/** Take an operative off a project. */
async function unassign({ id, actor: actorId }, user) {
  const item = project(id);
  if ( !item ) return { error: "That project is gone." };
  const actor = game.actors?.get(actorId);
  if ( !user.isGM && actor && !actor.testUserPermission(user, "OWNER") ) return { error: `${actor.name} is not yours to move.` };
  await item.update({ "system.assigned": item.system.assigned.filter(a => a.actor !== actorId).map(a => ({ actor: a.actor, skill: a.skill })) });
  return { notice: `${actor?.name ?? "A soldier"} comes off ${item.name}` };
}

/**
 * Spend Logistics (or Intel, on Intelligence) to push a project along (doc: the
 * intended way to finish research quickly). Never more than is left to pay.
 */
async function spend({ id, amount }, user) {
  const item = project(id);
  if ( !item ) return { error: "That project is gone." };
  if ( item.system.status !== "active" ) return { error: `${item.name} is not under way.` };
  const asked = Math.round(Number(amount) || 0);
  if ( asked <= 0 ) return { error: "Enter how much to spend." };
  const pay = Math.min(asked, item.system.remaining);
  if ( pay <= 0 ) return { error: `${item.name} is paid in full.` };
  const resource = item.system.resource;
  const label = IROP.resources[resource].label;
  const by = user.isGM ? "" : ` (${displayName(user)})`;
  const result = await recordResource({ resource, amount: -pay, reason: `${kindLabel(item)}: ${item.name}${by}` });
  if ( !result.ok ) return { error: result.reason };
  const after = addProgress(item.system, pay);
  await item.update({ "system.progress": after.progress });
  if ( after.complete ) await completeProject(item);
  return { notice: `spent ${pay} ${label} on ${item.name}` };
}

/** Doc: each recovered salvage adds 30% of a research project's cost. GM only. */
export async function addSalvage(item, count = 1) {
  if ( !game.user.isGM || (item?.system.kind !== "research") ) return null;
  const n = Math.max(1, Math.round(Number(count) || 1));
  const after = addProgress(item.system, salvageProgress(item.system.cost, getStrategyRules()) * n);
  await item.update({ "system.progress": after.progress, "system.salvage": item.system.salvage + n });
  if ( after.complete ) await completeProject(item);
  return after;
}

/** Show a hidden project to the players, or hide it again. GM only. */
export async function setShown(item, shown) {
  if ( !game.user.isGM || !item ) return null;
  if ( item.system.status === "active" || item.system.status === "complete" ) return null;
  return item.update({ "system.status": shown ? "available" : "hidden" });
}

/** What a completion card says. */
export function completionContext(item) {
  const s = item.system;
  const kind = IROP.projectKinds[s.kind] ?? {};
  const where = s.territory ? (game.items?.get(s.territory)?.name ?? "") : "";
  return {
    name: item.name,
    kind: kind.label ?? "Project",
    icon: kind.icon ?? "fa-solid fa-flag-checkered",
    unlocks: (s.kind === "research") ? s.unlocks : "",
    builds: (s.kind === "engineering") ? `${IROP.engineeringBuilds[s.builds] ?? ""}${where ? `, ${where}` : ""}` : "",
    reveals: (s.kind === "intelligence") ? s.reveals : "",
    where: (s.kind === "intelligence") ? where : ""
  };
}

/**
 * A project is complete: mark it (unless already saved, as Advance week does),
 * free its soldiers, open any Tactical Action it reveals, and tell the table.
 */
export async function completeProject(item, { alreadySaved = false } = {}) {
  if ( !alreadySaved ) await item.update({ "system.status": "complete", "system.progress": item.system.cost, "system.assigned": [] });
  const s = item.system;
  if ( (s.kind === "intelligence") && s.reveals.trim() ) {
    await setList("revealedActions", [...getList("revealedActions"), {
      id: foundry.utils.randomID(), label: s.reveals.trim(), territory: s.territory,
      rewards: `Revealed by ${item.name}.`, heat: "major", from: item.id
    }]);
  }
  return ChatMessage.implementation.create({
    speaker: { alias: "ODR Command" },
    content: await render("project-complete.hbs", completionContext(item))
  });
}

/* -------------------------------------------- */
/*  Tactical Actions and missions               */
/* -------------------------------------------- */

/** Choose the week's Tactical Action and where. Open to players until it is briefed. */
async function chooseTactical({ key, territory }, user) {
  const now = getWarRoom().tactical;
  if ( now && (now.status !== "chosen") ) return { error: `This turn's Tactical Action, ${now.label}, is already under way.` };
  const choice = tacticalChoices(getList("revealedActions"), responseChoices(), incursionChoices()).find(c => c.key === key);
  if ( !choice ) return { error: "That Tactical Action is no longer open." };
  const where = game.items?.get(choice.territory || territory);
  if ( where?.type !== "territory" ) return { error: "Pick the territory it happens in." };
  if ( where.system.control === "liberated" ) return { error: `${where.name} is liberated; GENESIS has nothing there to hit.` };
  // Step 7: an objective assault is at a Megacity with an objective still to take.
  if ( choice.megacity ) {
    if ( where.system.kind !== "megacity" ) return { error: `${choice.label} needs a Megacity. ${where.name} is ${IROP.territoryKinds[where.system.kind]?.label ?? "not one"}.` };
    if ( objectivesTaken(where.system) >= 3 ) return { error: `${where.name}'s three objectives are taken. The GM liberates it from its card.` };
  }
  await setWarRoom({ tactical: {
    key: choice.key, label: choice.label, rewards: choice.rewards, heat: choice.heat, revealed: choice.revealed,
    response: !!choice.response, incursion: choice.incursion ?? "", megacity: !!choice.megacity, priority: !!choice.priority,
    territory: where.id, status: "chosen", by: displayName(user)
  } });
  return { notice: `chose ${choice.label} in ${where.name}` };
}

/** Put the choice back. Players can until the mission is briefed; the GM until it is debriefed. */
async function clearTactical(payload, user) {
  const now = getWarRoom().tactical;
  if ( !now ) return null;
  if ( (now.status === "done") || (!user.isGM && (now.status !== "chosen")) ) {
    return { error: `${now.label} is already ${now.status === "done" ? "done" : "briefed"}.` };
  }
  await setWarRoom({ tactical: null });
  return { notice: `put back ${now.label}` };
}

/** What the briefing card says: the doc's Heat, Strength and Reputation for that territory. */
export function briefingContext(tactical, territory, { rules = getStrategyRules(), week = 1 } = {}) {
  const s = territory?.system ?? {};
  const band = strengthBand(s.strength ?? 0, rules.strengthMax);
  const rep = repState(s.reputation, s.reputationPoints);
  return {
    label: tactical.label,
    week,
    territory: territory?.name ?? "Unknown",
    kind: IROP.territoryKinds[s.kind]?.label ?? "",
    control: IROP.territoryControl[s.control] ?? "",
    heat: IROP.heatLevels[s.heat]?.label ?? "None",
    heatResponse: IROP.heatLevels[s.heat]?.response ?? "",
    strength: s.strength ?? 0,
    strengthMax: rules.strengthMax,
    band: band.label,
    bandText: band.text,
    reputation: `${levelText(rep.level)}, ${rep.points} of ${IROP.reputationScale.points}`,
    reputationEffect: reputationEffect(rep.level),
    modifiers: s.modifiers ?? "",
    rewards: tactical.rewards ?? "",
    weather: territory ? weatherLine(territoryWeather(territory.id, s, week, weatherSeason()), temperatureUnit()) : "",
    // The calendar's date (2026-10-08), while the GM shows it on the Strategy Layer.
    date: onStrategyLayer() ? dateInfo().long : "",
    heatClass: IROP.heatClasses[tactical.heat] ?? "",
    by: tactical.by ?? ""
  };
}

/** Brief the mission: the generated mission goes to chat and the choice is locked in. GM only. */
export async function briefMission() {
  if ( !game.user.isGM ) return null;
  const state = getWarRoom();
  const tactical = state.tactical;
  if ( !tactical ) return ui.notifications.warn("Choose this turn's Tactical Action first.");
  if ( tactical.status === "done" ) return ui.notifications.warn(`${tactical.label} is already debriefed.`);
  const territory = game.items?.get(tactical.territory);
  await ChatMessage.implementation.create({
    speaker: { alias: "ODR Command" },
    content: await render("mission-brief.hbs", briefingContext(tactical, territory, { week: state.week }))
  });
  if ( tactical.status === "chosen" ) await setWarRoom({ tactical: { ...tactical, status: "briefed" } });
  return true;
}

/** What the debrief dialog starts from. */
export function debriefDefaults(tactical, rules = getStrategyRules()) {
  return {
    outcome: "success",
    heat: tactical?.heat ?? "minor",
    reputation: defaultReputation("success", rules),
    reputationFor: Object.fromEntries(Object.keys(IROP.missionOutcomes).map(o => [o, defaultReputation(o, rules)])),
    // A response to a card in play (step 6): a success counters it.
    response: !!tactical?.response,
    // Step 7: the objective an assault took; whether this stops an Incursion.
    objectives: objectiveChoices(tactical),
    incursion: !!tactical?.incursion
  };
}

/** The objectives a Megacity assault could have taken: the ones still standing. */
function objectiveChoices(tactical) {
  if ( !tactical?.megacity ) return [];
  const t = game.items?.get(tactical.territory);
  return Object.entries(IROP.megacityObjectives).filter(([k]) => !t?.system.objectives?.[k]).map(([key, label]) => ({ key, label }));
}

/**
 * Debrief the mission (RULED 2026-10-08: rewards are entered at the debrief). Logistics
 * and Intel go to the ledger, the territory takes the Heat (next week) and the
 * Reputation, salvage goes to the research under way, and the mission is logged.
 * A response to a card in play that succeeds can counter it: the card leaves play
 * without its discard effect (step 6).
 * @param {{outcome: string, logistics: number, intel: number, heat: string, reputation: number, salvage: number, notes: string, countered?: boolean}} data
 */
export async function debriefMission(data = {}) {
  if ( !game.user.isGM ) return null;
  const state = getWarRoom();
  const tactical = state.tactical;
  if ( !tactical || (tactical.status === "done") ) return ui.notifications.warn("There is no mission to debrief this turn.");
  const rules = getStrategyRules();
  const territory = game.items?.get(tactical.territory) ?? null;
  const where = territory?.name ?? "an unknown territory";
  const num = v => Math.max(0, Math.round(Number(v) || 0));
  const outcome = IROP.missionOutcomes[data.outcome] ? data.outcome : "success";
  const heat = IROP.heatClasses[data.heat] ? data.heat : "none";
  // Reputation in points (RULED 2026-10-11), through the territory's bar.
  const reputation = Math.max(-20, Math.min(20, Math.round(Number(data.reputation) || 0)));
  const logistics = num(data.logistics);
  const intel = num(data.intel);
  const salvage = num(data.salvage);
  const reason = `Mission: ${tactical.label}, ${where}`;
  if ( logistics ) await recordResource({ resource: "logistics", amount: logistics, reason });
  if ( intel ) await recordResource({ resource: "intel", amount: intel, reason });
  // The deployed squad's background perks (2026-10-11): on a success, their own ledger lines.
  const perks = perkRewards(squadForPerks(), territory?.system?.kind, outcome);
  const perkReason = `Background perks: ${tactical.label}`;
  if ( perks.logistics ) await recordResource({ resource: "logistics", amount: perks.logistics, reason: perkReason });
  if ( perks.intel ) await recordResource({ resource: "intel", amount: perks.intel, reason: perkReason });
  let reputationResult = "";
  if ( territory ) {
    const from = repState(territory.system.reputation, territory.system.reputationPoints);
    const change = debriefTerritory(territory.system, { heat, reputation: reputation + perks.reputation }, rules);
    await territory.update(change);
    reputationResult = changeText(reputation + perks.reputation, from, { level: change["system.reputation"], points: change["system.reputationPoints"] });
  }
  let salvageNote = "";
  if ( salvage ) {
    const research = worldProjects().find(p => (p.system.kind === "research") && (p.system.status === "active"));
    if ( research ) {
      await addSalvage(research, salvage);
      salvageNote = `to ${research.name}`;
    }
    else salvageNote = "with no research under way to take it";
  }
  let countered = "";
  if ( tactical.response && data.countered && String(tactical.key).startsWith("card:") ) {
    const card = await discardInPlay(tactical.key.slice(5), { apply: false });
    if ( card ) countered = card.name;
  }
  // Step 7: a Megacity objective taken; three taken and the Megacity is ready to liberate.
  let objective = "";
  let liberates = false;
  if ( tactical.megacity && territory && IROP.megacityObjectives[data.objective] && !territory.system.objectives[data.objective] ) {
    await territory.update({ [`system.objectives.${data.objective}`]: true });
    objective = IROP.megacityObjectives[data.objective];
    liberates = objectivesTaken(territory.system) >= 3;
  }
  // Step 7: an Incursion stopped by a success; otherwise it goes on, and lands in its time.
  let incursion = "";
  if ( tactical.incursion ) incursion = ((outcome === "success") && (await breakIncursion(tactical.incursion))) ? "broken" : "goes on";
  const entry = {
    id: foundry.utils.randomID(), week: state.week, label: tactical.label, territory: where, outcome,
    logistics, intel, heat, reputation, reputationResult, salvage, notes: String(data.notes ?? "").trim(), countered,
    objective, liberates, incursion, perks: perks.lines, time: Date.now()
  };
  await setList("missionLog", [...getList("missionLog"), entry]);
  if ( tactical.revealed ) await setList("revealedActions", getList("revealedActions").filter(r => r.id !== tactical.key));
  await setWarRoom({ tactical: { ...tactical, status: "done" } });
  await ChatMessage.implementation.create({
    speaker: { alias: "ODR Command" },
    content: await render("mission-debrief.hbs", debriefContext(entry, { salvageNote, rules }))
  });
  return entry;
}

/** What the debrief card, and the mission log, say about one mission. */
export function debriefContext(entry, { salvageNote = "", rules = getStrategyRules() } = {}) {
  const rise = Number(rules.heatRise?.[entry.heat]) || 0;
  return {
    ...entry,
    outcomeLabel: IROP.missionOutcomes[entry.outcome] ?? entry.outcome,
    heatLabel: (entry.heat === "none") ? "" : `${IROP.heatClasses[entry.heat]}, +${rise} next turn`,
    reputationLabel: entry.reputationResult || (entry.reputation ? `${entry.reputation > 0 ? "+" : ""}${entry.reputation}` : ""),
    salvageNote,
    counteredNote: entry.countered ? `${entry.countered} countered` : "",
    objectiveNote: entry.objective ? `${entry.objective} taken${entry.liberates ? ". All three: the Megacity can be liberated" : ""}` : "",
    incursionNote: { broken: "The Incursion is broken", "goes on": "The Incursion goes on" }[entry.incursion] ?? ""
  };
}

/* -------------------------------------------- */

/** The actions a player can ask the GM's client to run. Called once, at init. */
export function registerOdrActions() {
  registerAction("project.start", startProject);
  registerAction("project.stop", stopProject);
  registerAction("project.assign", assign);
  registerAction("project.unassign", unassign);
  registerAction("project.spend", spend);
  registerAction("tactical.choose", chooseTactical);
  registerAction("tactical.clear", clearTactical);
}

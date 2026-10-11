import { IROP } from "../config.mjs";

/**
 * The ODR phase's projects (Strategy Layer step 5, 2026-10-08): Research,
 * Engineering and Intelligence Actions, as the doc runs them. Kept apart from
 * Foundry so it can be tested on its own. A project here is its system data plus
 * an id and a name: {id, name, kind, status, cost, progress, specialization, term,
 * assigned}. A soldier is an operative's system data: {attributes, skills}.
 */

/** The resource a project is paid and progressed in: Intel for Intelligence, else Logistics. */
export function projectResource(kind) {
  return IROP.projectKinds[kind]?.resource ?? "logistics";
}

/** Can this skill work this project? Intelligence takes any Social skill, Stealth, Hacking or Lock Picking. */
export function skillQualifies(project, skill) {
  if ( project?.kind === "intelligence" ) return (IROP.skills[skill]?.group === "social") || IROP.intelSkills.includes(skill);
  return (project?.specialization ?? []).includes(skill);
}

/** The skills that could work a project, in the skill list's order. */
export function qualifyingSkills(project) {
  return Object.keys(IROP.skills).filter(k => skillQualifies(project, k));
}

/**
 * What a soldier adds to a project each turn with one skill (doc):
 * Research, and Engineering specialists: Intelligence bonus + 5 per rank in the skill.
 * Engineering labor: Strength bonus. Intelligence: the skill's attribute modifier + 5 per rank.
 * A skill needs at least one rank. Never below zero.
 * @param {object} project
 * @param {object} soldier   {attributes: {int: {mod}}, skills: {key: {rank}}}
 * @param {string} skill     A skill key, or "labor"
 */
export function contribution(project, soldier, skill) {
  const attrs = soldier?.attributes ?? {};
  if ( skill === "labor" ) return (project?.kind === "engineering") ? Math.max(0, Math.round(Number(attrs.str?.mod) || 0)) : 0;
  if ( !skillQualifies(project, skill) ) return 0;
  const rank = Number(soldier?.skills?.[skill]?.rank) || 0;
  if ( rank < 1 ) return 0;
  const attr = (project.kind === "intelligence") ? IROP.skills[skill]?.attribute : "int";
  return Math.max(0, Math.round((Number(attrs[attr]?.mod) || 0) + (5 * rank)));
}

/**
 * A soldier's best way to work a project: the skill that adds most, or labor on an
 * Engineering project when that adds more. Null when the soldier cannot work it.
 * @returns {{skill: string, amount: number}|null}
 */
export function bestSkill(project, soldier) {
  let best = null;
  for ( const skill of qualifyingSkills(project) ) {
    if ( (Number(soldier?.skills?.[skill]?.rank) || 0) < 1 ) continue;
    const amount = contribution(project, soldier, skill);
    if ( !best || (amount > best.amount) ) best = { skill, amount };
  }
  if ( project?.kind === "engineering" ) {
    const amount = contribution(project, soldier, "labor");
    if ( !best || (amount > best.amount) ) best = { skill: "labor", amount };
  }
  return best;
}

/** A skill as a project shows it. */
export function skillLabel(skill) {
  return (skill === "labor") ? "Labor" : (IROP.skills[skill]?.label ?? skill);
}

/** The passive progress a project of this kind makes each turn. */
export function passiveProgress(kind, rules = IROP.strategyRules) {
  const key = { research: "researchPassive", engineering: "engineeringPassive", intelligence: "intelPassive" }[kind];
  return Math.max(0, Math.round(Number(rules?.[key]) || 0));
}

/**
 * What an active project gains next turn: the passive progress and each assigned
 * soldier's share. A soldier no longer there, or no longer able, adds nothing.
 * @param {object} project
 * @param {(id: string) => ({name: string, system: object}|null)} soldierOf
 * @param {object} rules
 * @returns {{passive: number, soldiers: {actor: string, name: string, skill: string, label: string, amount: number}[], total: number}}
 */
export function weeklyProgress(project, soldierOf = () => null, rules = IROP.strategyRules) {
  const passive = passiveProgress(project?.kind, rules);
  const soldiers = (project?.assigned ?? []).map(a => {
    const soldier = soldierOf(a.actor);
    return {
      actor: a.actor, name: soldier?.name ?? "A soldier no longer here", skill: a.skill, label: skillLabel(a.skill),
      amount: soldier ? contribution(project, soldier.system, a.skill) : 0
    };
  });
  return { passive, soldiers, total: passive + soldiers.reduce((sum, s) => sum + s.amount, 0) };
}

/** A weekly gain in words: "Passive 10, Kael (Tactics) 14". */
export function progressBreakdown(weekly) {
  return [`Passive ${weekly.passive}`, ...weekly.soldiers.map(s => `${s.name} (${s.label}) ${s.amount}`)].join(", ");
}

/** What is left to pay on a project. */
export function remainingCost(project) {
  return Math.max(0, (Number(project?.cost) || 0) - (Number(project?.progress) || 0));
}

/**
 * Progress after adding some, never past the cost.
 * @returns {{progress: number, added: number, complete: boolean}}
 */
export function addProgress(project, amount) {
  const cost = Math.max(0, Number(project?.cost) || 0);
  const before = Math.max(0, Number(project?.progress) || 0);
  const progress = Math.min(cost, before + Math.max(0, Math.round(Number(amount) || 0)));
  return { progress, added: progress - before, complete: (cost > 0) && (progress >= cost) };
}

/** Doc: each recovered salvage adds progress equal to 30% of the research project's cost. */
export function salvageProgress(cost, rules = IROP.strategyRules) {
  return Math.round((Math.max(0, Number(cost) || 0) * (Number(rules?.salvagePercent) || 0)) / 100);
}

/**
 * Whether a project can start, and what it pushes aside. Doc: only one Research
 * project at a time, and switching costs nothing (the old one keeps its progress);
 * up to engineeringSlots Engineering Actions; one Short Term and one Long Term
 * Intelligence Action. A project with no cost waits for the GM to set one.
 * @param {object} project
 * @param {object[]} all       Every project
 * @param {object} rules
 * @returns {{ok: boolean, reason?: string, replaces: string[]}}
 */
export function canStart(project, all = [], rules = IROP.strategyRules) {
  const no = reason => ({ ok: false, reason, replaces: [] });
  if ( !project ) return no("That project is gone.");
  if ( project.status === "complete" ) return no(`${project.name} is already complete.`);
  if ( project.status === "active" ) return no(`${project.name} is already under way.`);
  if ( project.status === "hidden" ) return no(`${project.name} is not open yet.`);
  if ( !(Number(project.cost) > 0) ) return no(`${project.name} has no cost yet. The GM sets it on the project.`);
  const running = all.filter(p => (p.id !== project.id) && (p.status === "active") && (p.kind === project.kind));
  if ( project.kind === "research" ) return { ok: true, replaces: running.map(p => p.id) };
  if ( project.kind === "engineering" ) {
    const slots = Math.max(1, Math.round(Number(rules?.engineeringSlots) || 1));
    if ( running.length >= slots ) return no(`All ${slots} Engineering slots are in use. Stop one first.`);
    return { ok: true, replaces: [] };
  }
  const same = running.find(p => p.term === project.term);
  if ( same ) return no(`A ${IROP.intelTerms[project.term]?.toLowerCase() ?? ""} Intelligence Action is already under way: ${same.name}. Stop it first.`);
  return { ok: true, replaces: [] };
}

/**
 * Put a soldier on a project. Doc: a soldier works one project at a time, so they
 * come off any other. Returns only the assignment lists that change, by project id.
 * @param {object[]} projects
 * @param {string} projectId
 * @param {string} actorId
 * @param {string} skill
 * @returns {Record<string, {actor: string, skill: string}[]>}
 */
export function assignSoldier(projects, projectId, actorId, skill) {
  const out = {};
  for ( const p of projects ) {
    const list = p.assigned ?? [];
    if ( p.id === projectId ) {
      const next = [...list.filter(a => a.actor !== actorId), { actor: actorId, skill }];
      if ( JSON.stringify(next) !== JSON.stringify(list) ) out[p.id] = next;
    }
    else if ( list.some(a => a.actor === actorId) ) out[p.id] = list.filter(a => a.actor !== actorId);
  }
  return out;
}

/** The project a soldier is working, if any. */
export function assignmentOf(projects, actorId) {
  return projects.find(p => (p.status === "active") && (p.assigned ?? []).some(a => a.actor === actorId)) ?? null;
}

/* -------------------------------------------- */
/*  Tactical Actions and missions               */
/* -------------------------------------------- */

/** What a territory's Strength means for a mission, by share of the highest Strength. */
export function strengthBand(strength, max = IROP.strategyRules.strengthMax) {
  const share = max ? (Math.max(0, Number(strength) || 0) / max) : 0;
  return IROP.strengthBands.find(b => share <= b.upTo) ?? IROP.strengthBands.at(-1);
}

/** What Reputation means on a mission: high, low or nothing either way. */
export function reputationEffect(reputation) {
  if ( reputation > 0 ) return IROP.reputationEffects.high;
  if ( reputation < 0 ) return IROP.reputationEffects.low;
  return "";
}

/**
 * The Tactical Actions open this week: the always available ones, then any an
 * Intelligence Action revealed, then a response to each card in play that can be
 * answered (step 6; doc: Respond to Events and Dark Events).
 * Step 7: Incursions come first, as the doc's high-priority missions.
 * @param {object[]} revealed    {id, label, territory, rewards, heat}
 * @param {object[]} responses   {id: "card:...", label, territory, rewards, heat}
 * @param {object[]} incursions  {id: "incursion:...", label, territory, rewards, heat}
 */
export function tacticalChoices(revealed = [], responses = [], incursions = []) {
  const always = Object.entries(IROP.tacticalActions).map(([key, a]) => ({
    key, label: a.label, rewards: a.rewards, heat: a.heat, revealed: false, territory: "", megacity: !!a.megacity
  }));
  const open = (r, response) => ({
    key: r.id, label: r.label, rewards: r.rewards ?? "", heat: r.heat ?? (response ? "minor" : "major"),
    revealed: !response, response, territory: r.territory ?? ""
  });
  const urgent = incursions.map(r => ({
    key: r.id, label: r.label, rewards: r.rewards ?? "", heat: r.heat ?? "major", revealed: false, response: false,
    priority: true, incursion: String(r.id).replace(/^incursion:/, ""), territory: r.territory ?? ""
  }));
  return [...urgent, ...always, ...revealed.map(r => open(r, false)), ...responses.map(r => open(r, true))];
}

/**
 * What a debrief does to the territory (doc): Heat rises by the action's class at the
 * start of next turn, the territory counts as active this week, and Reputation moves
 * by the outcome, held to -2 to +2.
 * @param {object} territory   Its system data
 * @param {{heat: string, reputation: number}} debrief
 * @returns {object}   Item update paths and values
 */
export function debriefTerritory(territory, { heat = "none", reputation = 0 } = {}, rules = IROP.strategyRules) {
  const rise = Math.round(Number(rules?.heatRise?.[heat]) || 0);
  const rep = Math.max(-2, Math.min(2, (Number(territory?.reputation) || 0) + (Math.round(Number(reputation)) || 0)));
  return {
    "system.heatPending": (Number(territory?.heatPending) || 0) + rise,
    "system.active": true,
    "system.reputation": rep
  };
}

/** The Reputation change a debrief starts from, by outcome. */
export function defaultReputation(outcome, rules = IROP.strategyRules) {
  if ( outcome === "success" ) return Math.round(Number(rules?.missionReputation?.success) || 0);
  if ( outcome === "failure" ) return Math.round(Number(rules?.missionReputation?.failure) || 0);
  return 0;
}

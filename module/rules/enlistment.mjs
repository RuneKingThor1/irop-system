import { IROP } from "../config.mjs";
import { startingSkillPlan, startingSkillRanks } from "./starting-skills.mjs";
import { perkCopy } from "./backgrounds.mjs";
import { treeNodes, nodeStates } from "./skill-trees.mjs";

/**
 * Enlistment (Johnald, 2026-10-12: mockup A, the enlistment terminal): a new operative made in
 * six steps, species, role, background, skills and perk, identity, review. The same rules the
 * sheet applies when a species, role or background is dropped on it, run once, up front:
 * the species sets the base attributes, the role's first skill comes free with one more picked,
 * the background gives its picks of skills and one perk. Kept apart from Foundry so it can be
 * tested; strategy-free, it reads plain item data.
 *
 * Choices: {species, role, background (item ids), roleSkill (a skill key), backgroundSkills
 * (skill keys), perk (the background's perk entry id), firstName, lastName, callsign, img, owner,
 * mutations (the rolls, below), boons (attribute keys), training (the first XP, at the end)}
 *
 * Boons (Johnald, 2026-10-16): a species that grants them (Human) gets a Boons step. Handoff: the
 * human species bonus is two Attribute boons, each raising a chosen attribute by +10, no attribute
 * twice.
 *
 * Mutations (Johnald, 2026-10-16): a species that carries them (Mutant) gets a Mutations step. The
 * Playable Mutants rules: roll twice on the Positive table, rerolling duplicates, and once on the
 * Negative, which may be rerolled once (Controlled Mutation) for the second outcome. A table is a
 * list of {lo, hi, id, name}; the rolls kept are {positive: [entry], negative: entry, rerolled,
 * log: [{table, n, name, note}]}, an entry being {n, id, name}.
 */

/** The steps, in order. */
export const STEPS = [
  { key: "species", label: "Species", prompt: "Select species" },
  { key: "role", label: "Role", prompt: "Select doctrine" },
  { key: "background", label: "Background", prompt: "Select background" },
  { key: "skills", label: "Skills and perk", prompt: "Assign starting skills" },
  { key: "boons", label: "Boons", prompt: "Assign species boons" },
  { key: "mutations", label: "Mutations", prompt: "Sequence mutations" },
  { key: "training", label: "Training", prompt: "Allocate training XP" },
  { key: "identity", label: "Identity", prompt: "Identify recruit" },
  { key: "review", label: "Review", prompt: "Confirm enlistment" }
];

/** The steps for a species: Boons only when it grants them, Mutations only when it carries them. */
export function stepsFor(species) {
  return STEPS.filter(s => ((s.key !== "mutations") || !!species?.system?.mutations) && ((s.key !== "boons") || !!species?.system?.boons));
}

/** How many boons a species that grants them gives (handoff: two). */
export const BOON_PICKS = 2;

/** The boons picked: real attribute keys, no attribute twice, no more than BOON_PICKS. */
export function boonPicks(choices) {
  return [...new Set((choices?.boons ?? []).filter(k => IROP.attributes[k]))].slice(0, BOON_PICKS);
}

/** The table entry a roll lands on, or null. */
export function entryAt(table, n) {
  const e = (table ?? []).find(x => (n >= x.lo) && (n <= x.hi));
  return e ? { n, id: e.id, name: e.name } : null;
}

/** The die a table rolls: its highest number. */
export function dieOf(table) {
  return Math.max(0, ...(table ?? []).map(x => x.hi));
}

/**
 * Roll a Baron's mutations: two different Positives (duplicates rerolled) and one Negative.
 * @param {{positive: object[], negative: object[]}} tables
 * @param {(faces: number) => number} roll   A die: 1 to faces
 */
export function rollMutations(tables, roll) {
  const log = [];
  const positive = [];
  const pDie = dieOf(tables.positive);
  for ( let tries = 0; (positive.length < 2) && (tries < 60) && pDie; tries++ ) {
    const hit = entryAt(tables.positive, roll(pDie));
    if ( !hit ) continue;
    const dup = positive.some(p => p.id === hit.id);
    log.push({ table: "positive", n: hit.n, name: hit.name, note: dup ? "duplicate, rerolled" : "" });
    if ( !dup ) positive.push(hit);
  }
  const nDie = dieOf(tables.negative);
  let negative = null;
  for ( let tries = 0; !negative && (tries < 60) && nDie; tries++ ) negative = entryAt(tables.negative, roll(nDie));
  if ( negative ) log.push({ table: "negative", n: negative.n, name: negative.name, note: "" });
  return { positive, negative, rerolled: false, log };
}

/** Controlled Mutation: the Negative rolled once more, the second outcome taken. Only once. */
export function rerollNegative(state, tables, roll) {
  if ( !state?.negative || state.rerolled ) return state;
  const nDie = dieOf(tables.negative);
  let negative = null;
  for ( let tries = 0; !negative && (tries < 60) && nDie; tries++ ) negative = entryAt(tables.negative, roll(nDie));
  if ( !negative ) return state;
  return { ...state, negative, rerolled: true,
    log: [...state.log, { table: "negative", n: negative.n, name: negative.name, note: `rerolled, replacing ${state.negative.name}` }] };
}

/** Whether the rolls are complete: two Positives and a Negative. */
export function mutationsRolled(state) {
  return !!state && ((state.positive?.length ?? 0) >= 2) && !!state.negative;
}

/** The mutation item ids the rolls give, Positives first. */
export function mutationIds(state) {
  return mutationsRolled(state) ? [...state.positive.map(p => p.id), state.negative.id] : [];
}

/** The default picture for a new operative. */
export const DEFAULT_IMG = "icons/svg/mystery-man.svg";

/** Plain text from HTML, and its first sentence or two, up to about `max` characters. */
export function blurb(html, max = 150) {
  const text = String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  if ( text.length <= max ) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let out = "";
  for ( const s of sentences ) {
    if ( (out + s).trim().length > max ) break;
    out += s;
  }
  return (out.trim() || `${text.slice(0, max).replace(/\s+\S*$/, "")}...`).trim();
}

/** A species' attributes against the baseline: [{key, abbr, value, diff}]. */
export function speciesAttributes(system) {
  return Object.entries(IROP.attributes).map(([key, a]) => {
    const value = Math.round(Number(system?.attributes?.[key] ?? IROP.attributeDefaults[key]) || 0);
    return { key, abbr: a.abbr, value, diff: value - IROP.attributeDefaults[key] };
  });
}

/** What a role offers at the start: the free skill, the ones to pick from, and how many. */
export function rolePlan(role) {
  return startingSkillPlan(role ? { type: "role", system: role.system } : null);
}

/** What a background offers at the start. */
export function backgroundPlan(background) {
  return startingSkillPlan(background ? { type: "background", system: background.system } : null);
}

/** Every skill taken, in order (a skill taken twice appears twice), from the choices. */
export function skillsTaken(choices, role, background) {
  const rp = rolePlan(role);
  const bp = backgroundPlan(background);
  const fromRole = [...rp.granted, ...(rp.options.includes(choices.roleSkill) ? [choices.roleSkill] : [])];
  const fromBackground = (choices.backgroundSkills ?? []).filter(k => bp.options.includes(k)).slice(0, bp.pick);
  return [...fromRole, ...fromBackground];
}

/** The ranks the skills taken come to, from nothing: {key: rank}. */
export function startingRanks(taken) {
  const zero = Object.fromEntries(Object.keys(IROP.skills).map(k => [k, 0]));
  const { update } = startingSkillRanks(zero, taken);
  return Object.fromEntries(Object.entries(update).map(([path, rank]) => [path.split(".")[2], rank]));
}

/** The name on the sheet and the token: the callsign, else the full name. */
export function operativeName(choices) {
  const full = [choices.firstName, choices.lastName].map(s => String(s ?? "").trim()).filter(Boolean).join(" ");
  return String(choices.callsign ?? "").trim() || full;
}

/**
 * What is still missing at each step, in words, or "" when the step is complete.
 * @param {object} choices
 * @param {{species?: object, role?: object, background?: object}} items   The chosen items
 * @returns {Record<string, string>}   By step key
 */
export function stepIssues(choices, { species = null, role = null, background = null, mutationsReady = true } = {}) {
  const rp = rolePlan(role);
  const bp = backgroundPlan(background);
  const picked = (choices.backgroundSkills ?? []).filter(k => bp.options.includes(k)).length;
  const perks = background?.system?.perks ?? [];
  const skills = [];
  if ( !role || !background ) skills.push("Choose a role and a background first.");
  else {
    if ( rp.pick && !rp.options.includes(choices.roleSkill) ) skills.push(`Pick ${rp.pick} of ${role.name}'s skills.`);
    if ( picked !== bp.pick ) skills.push(`Pick ${bp.pick} of ${background.name}'s skills (${picked} picked).`);
    if ( perks.length && !perks.some(p => p.id === choices.perk) ) skills.push(`Pick one of ${background.name}'s perks.`);
  }
  const out = {
    species: species ? "" : "Choose a species.",
    role: role ? "" : "Choose a role.",
    background: background ? "" : "Choose a background.",
    skills: skills.join(" "),
    boons: (species?.system?.boons && (boonPicks(choices).length < BOON_PICKS)) ? `Pick ${BOON_PICKS} attributes for your boons (${boonPicks(choices).length} picked).` : "",
    // A species that carries mutations rolls them, once the world has the tables to roll on.
    mutations: (species?.system?.mutations && mutationsReady && !mutationsRolled(choices.mutations)) ? "Roll your mutations." : "",
    identity: operativeName(choices) ? "" : "Give a callsign or a name.",
    review: ""
  };
  out.review = Object.values(out).filter(Boolean).length ? "Finish the steps marked above." : "";
  return out;
}

/**
 * The new operative, ready to create: the actor's data with its species, role, background and
 * the perk taken among its items. Abilities are plain item data (toObject).
 * @param {object} choices
 * @param {{species: object, role: object, background: object, perkAbility?: object}} items
 *   Item data (toObject) for each, and the ability of the perk taken
 * @param {{owner?: string, date?: string, request?: string}} [options]
 * @returns {object}   Actor creation data
 */
export function operativeData(choices, { species, role, background, perkAbility = null, mutations = [], boons = [], training = null, trainingPerks = [] }, { owner = "", date = "", request = "" } = {}) {
  const strip = data => {
    const copy = structuredClone(data);
    for ( const key of ["_id", "folder", "sort", "ownership", "_stats"] ) delete copy[key];
    return copy;
  };
  const name = operativeName(choices);
  const img = String(choices.img ?? "").trim() || DEFAULT_IMG;
  const taken = skillsTaken(choices, role, background);
  const ranks = startingRanks(taken);
  const attributes = Object.fromEntries(Object.keys(IROP.attributes).map(k => [k, { base: Number(species.system?.attributes?.[k] ?? IROP.attributeDefaults[k]) }]));
  const skills = Object.fromEntries(Object.entries(ranks).map(([k, rank]) => [k, { rank }]));
  // Training (2026-10-16): the pips bought, and their lines on the ledger, dated the day enlisted.
  for ( const a of training?.attributes ?? [] ) if ( a.pips ) attributes[a.key].advances = a.pips;
  for ( const s of training?.skills ?? [] ) if ( s.pips ) skills[s.key] = { rank: s.rank };
  const log = (training?.entries ?? []).map(({ kind, label, xp, ref, rank }) => ({ kind, label, xp, ref, rank, date }));
  const items = [strip(species), strip(role), strip(background)];
  const entry = (background.system?.perks ?? []).find(p => p.id === choices.perk);
  if ( entry && perkAbility ) items.push(perkCopy(strip(perkAbility), background.name, entry));
  // The mutations rolled, for a species that carries them.
  if ( species.system?.mutations ) for ( const m of mutations ) items.push(strip(m));
  // The species' boons, for a species that grants them.
  if ( species.system?.boons ) for ( const b of boons ) items.push(strip(b));
  // The perks trained, each marked with its tree and node as the Training tab marks a perk bought.
  for ( const p of trainingPerks ) {
    const copy = strip(p.data);
    copy.flags = { ...(copy.flags ?? {}), irop: { ...(copy.flags?.irop ?? {}), perk: { tree: p.tree, node: p.node, xp: p.xp } } };
    items.push(copy);
  }
  const record = {
    firstName: String(choices.firstName ?? "").trim(),
    lastName: String(choices.lastName ?? "").trim(),
    enlisted: date,
    timeline: date ? [{ date, entry: "Enlisted with Eclipse." }] : []
  };
  return {
    name, type: "operative", img,
    ownership: owner ? { default: 0, [owner]: 3 } : { default: 0 },
    prototypeToken: { name, texture: { src: img } },
    system: {
      attributes, skills,
      ...(log.length ? { xp: { earned: training.budget, log } } : {}),
      details: { callsign: String(choices.callsign ?? "").trim(), startingSkills: { role: role.name, background: background.name }, record }
    },
    flags: { irop: { enlistment: { request, by: owner, species: species.name, role: role.name, background: background.name } } },
    items
  };
}

/* -------------------------------------------- */

/**
 * Training (Johnald, 2026-10-16): the first XP spent in the terminal, on the same things the
 * Training tab sells: attribute pips, skill pips and perks from the role's Primary tree and the
 * General trees (specializations open later, with XP earned). Nothing is spent until Enlist: the
 * plan is tried out, undone and reset freely, then goes on the ledger as ordinary purchases.
 * Whatever is left stays unspent.
 *
 * The plan: {attributes: {key: pips bought}, skills: {key: ranks bought over the starting ones},
 * perks: [node id]}, in choices.training.
 */

/** A plan with nothing bought. */
export function emptyTraining() {
  return { attributes: {}, skills: {}, perks: [] };
}

/** What pips `from + 1` to `from + count` of an attribute or a skill cost together. */
export function pipsCost(kind, from, count) {
  const table = (kind === "attribute") ? IROP.attributeAdvance.xpCost : IROP.skillRanks.xpCost;
  let sum = 0;
  for ( let n = from + 1; n <= from + count; n++ ) sum += table[n - 1] ?? 0;
  return sum;
}

/**
 * The plan worked out against the recruit: what each attribute and skill comes to, what each
 * perk can do, what it all costs, and the ledger lines it writes at Enlist. Perks the plan no
 * longer allows (a pip they needed taken off, a tier above emptied, a rival in a Pick one tier)
 * fall out, and are named in `dropped`.
 * @param {object} training           choices.training
 * @param {object} recruit
 * @param {Record<string, number>} recruit.attributes   Each attribute before training (species and boons)
 * @param {Record<string, number>} recruit.ranks        Each skill's starting rank
 * @param {object[]} [recruit.trees]  The perk trees offered: {id, name, system}
 * @param {(node: object) => string} [recruit.nameOf]
 * @param {(node: object) => object[]} [recruit.requirementsOf]   A node's parsed requirements
 * @param {(reqs: object[], system: object) => string[]} [recruit.unmet]   From rules/requirements.mjs
 * @param {number} [recruit.budget]   The XP to spend
 */
export function trainingPlan(training, { attributes, ranks, trees = [], nameOf = n => n.name, requirementsOf = () => [], unmet = () => [], budget = IROP.startingXP } = {}) {
  const t = training ?? emptyTraining();
  const perRank = IROP.attributeAdvance.perRank;
  const attr = Object.keys(IROP.attributes).map(key => {
    const pips = Math.max(0, Math.min(IROP.attributeAdvance.maxRanks, Math.floor(Number(t.attributes?.[key]) || 0)));
    return { key, base: Number(attributes?.[key]) || 0, pips, value: (Number(attributes?.[key]) || 0) + (pips * perRank), cost: pipsCost("attribute", 0, pips) };
  });
  const skills = Object.keys(IROP.skills).map(key => {
    const start = Number(ranks?.[key]) || 0;
    const pips = Math.max(0, Math.min(IROP.skillRanks.max - start, Math.floor(Number(t.skills?.[key]) || 0)));
    return { key, start, pips, rank: start + pips, cost: pipsCost("skill", start, pips) };
  });
  // The recruit as the requirements read them.
  const system = {
    attributes: Object.fromEntries(attr.map(a => [a.key, { value: a.value }])),
    skills: Object.fromEntries(skills.map(s => [s.key, { rank: s.rank }]))
  };
  const check = node => unmet(requirementsOf(node), system);
  const nodes = new Map();
  for ( const tree of trees ) for ( const node of treeNodes(tree.system) ) nodes.set(node.id, { tree, node });

  // Keep each perk planned only while the rest of the plan still opens it, until nothing changes.
  let owned = new Set((t.perks ?? []).filter(id => nodes.has(id)));
  const dropped = [];
  for ( let changed = true; changed; ) {
    changed = false;
    // Latest first, so of two rivals in a Pick one tier the first taken stays.
    for ( const id of [...owned].reverse() ) {
      const { tree } = nodes.get(id);
      const without = new Set([...owned].filter(x => x !== id));
      const st = nodeStates(tree.system, { owned: without, unspent: Infinity, nameOf, unmet: check }).get(id);
      if ( st?.state !== "open" ) {
        owned = without;
        dropped.push({ id, name: nameOf(nodes.get(id).node), reason: st?.reason ?? "" });
        changed = true;
      }
    }
  }
  const perkCost = [...owned].reduce((sum, id) => sum + Math.max(0, Number(nodes.get(id).node.xp) || 0), 0);
  const spent = attr.reduce((s, a) => s + a.cost, 0) + skills.reduce((s, k) => s + k.cost, 0) + perkCost;
  const left = budget - spent;

  // Each tree's perks, as the plan leaves them.
  const perkTrees = trees.map(tree => {
    const states = nodeStates(tree.system, { owned, unspent: Math.max(0, left), nameOf, unmet: check });
    return { tree, states };
  });

  // The ledger lines, in the order the sheet would have written them: attributes, skills, perks.
  const entries = [];
  for ( const a of attr ) for ( let n = 1; n <= a.pips; n++ ) {
    entries.push({ kind: "attribute", label: `${IROP.attributes[a.key].label} rank ${n}`, xp: IROP.attributeAdvance.xpCost[n - 1], ref: a.key, rank: n });
  }
  for ( const s of skills ) for ( let n = s.start + 1; n <= s.rank; n++ ) {
    entries.push({ kind: "skill", label: `${IROP.skills[s.key].label} rank ${n}`, xp: IROP.skillRanks.xpCost[n - 1], ref: s.key, rank: n });
  }
  for ( const id of owned ) {
    const { tree, node } = nodes.get(id);
    entries.push({ kind: "perk", label: `${nameOf(node)} (${tree.system.tabLabel ?? tree.name})`, xp: Math.max(0, Number(node.xp) || 0), ref: id, rank: 0, tree: tree.id });
  }
  return {
    attributes: attr, skills, perks: [...owned], perkTrees, dropped, spent, left, budget, entries,
    // What the next pip of each costs, and whether the plan can pay for it.
    nextAttribute: key => {
      const a = attr.find(x => x.key === key);
      if ( !a || (a.pips >= IROP.attributeAdvance.maxRanks) ) return null;
      const cost = IROP.attributeAdvance.xpCost[a.pips];
      return { cost, affordable: cost <= left };
    },
    nextSkill: key => {
      const s = skills.find(x => x.key === key);
      if ( !s || (s.rank >= IROP.skillRanks.max) ) return null;
      const cost = IROP.skillRanks.xpCost[s.rank];
      return { cost, affordable: cost <= left };
    }
  };
}

/** The plan with only what it allows: perks dropped as trainingPlan drops them. */
export function cleanTraining(training, plan) {
  return {
    attributes: Object.fromEntries(plan.attributes.filter(a => a.pips).map(a => [a.key, a.pips])),
    skills: Object.fromEntries(plan.skills.filter(s => s.pips).map(s => [s.key, s.pips])),
    perks: [...plan.perks]
  };
}

/** Each attribute before training: the species' score and its boons. */
export function recruitAttributes(species, boons = []) {
  const out = Object.fromEntries(speciesAttributes(species?.system ?? {}).map(a => [a.key, a.value]));
  for ( const b of boons ) if ( b?.system?.attribute in out ) out[b.system.attribute] += Number(b.system.amount) || 0;
  return out;
}

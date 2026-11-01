import { IROP, rankLocked } from "../config.mjs";
import { startingSkillPlan, startingSkillRanks } from "./starting-skills.mjs";
import { perkCopy, speciesPerkCopy } from "./backgrounds.mjs";
import { treeNodes, nodeStates } from "./skill-trees.mjs";
import { disciplineOpen, disciplineStates, disciplineRankCost, schoolsHeld } from "./paraphysics.mjs";

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
/** The species a background is open to, folded for matching: [] for any. */
export function backgroundSpecies(background) {
  return String(background?.system?.species ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** Is this background open to this species? Any background, before a species is picked. */
export function backgroundFits(background, species) {
  const list = backgroundSpecies(background);
  if ( !list.length || !species ) return true;
  return list.includes(String(species.name ?? "").trim().toLowerCase());
}

/** Has the recruit picked their role and background skills? Training's skill pips wait on it (Johnald, 2026-11-01). */
export function startingSkillsPicked(choices, role, background) {
  if ( !role || !background ) return false;
  const rp = rolePlan(role);
  const bp = backgroundPlan(background);
  if ( rp.pick && !rp.options.includes(choices.roleSkill) ) return false;
  return (choices.backgroundSkills ?? []).filter(k => bp.options.includes(k)).length === bp.pick;
}

export function stepIssues(choices, { species = null, role = null, background = null, mutationsReady = true, mutationChoices = [] } = {}) {
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
    background: !background ? "Choose a background."
      : (backgroundFits(background, species) ? "" : `${background.name} is not open to ${species.name}. Choose another background.`),
    skills: skills.join(" "),
    boons: (species?.system?.boons && (boonPicks(choices).length < BOON_PICKS)) ? `Pick ${BOON_PICKS} attributes for your boons (${boonPicks(choices).length} picked).` : "",
    // A species that carries mutations rolls them, once the world has the tables to roll on.
    mutations: (species?.system?.mutations && mutationsReady && !mutationsRolled(choices.mutations)) ? "Roll your mutations."
      : (species?.system?.mutations ? mutationChoices.join(" ") : ""),
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
export function operativeData(choices, { species, role, background, perkAbility = null, mutations = [], boons = [], training = null, trainingPerks = [], trainingPower = null, speciesPerks = [] }, { owner = "", date = "", request = "" } = {}) {
  const strip = data => {
    const copy = structuredClone(data);
    for ( const key of ["_id", "folder", "sort", "ownership", "_stats"] ) delete copy[key];
    return copy;
  };
  const name = operativeName(choices);
  const img = String(choices.img ?? "").trim() || DEFAULT_IMG;
  const taken = skillsTaken(choices, role, background);
  // A mutation's skill rank (2026-10-17) counts from the start, like the starting skills.
  const needs = species.system?.mutations ? mutationNeeds(mutations) : [];
  const picked = mutationAdjust(choices.mutationPicks, needs, startingRanks(taken));
  const ranks = withMutationRanks(startingRanks(taken), picked);
  const attributes = Object.fromEntries(Object.keys(IROP.attributes).map(k => [k, { base: Number(species.system?.attributes?.[k] ?? IROP.attributeDefaults[k]) }]));
  const skills = Object.fromEntries(Object.entries(ranks).map(([k, rank]) => [k, { rank }]));
  // Training (2026-10-16): the pips bought, and their lines on the ledger, dated the day enlisted.
  for ( const a of training?.attributes ?? [] ) if ( a.pips ) attributes[a.key].advances = a.pips;
  for ( const s of training?.skills ?? [] ) if ( s.pips ) skills[s.key] = { rank: s.rank };
  const log = (training?.entries ?? []).map(({ kind, label, xp, ref, rank }) => ({ kind, label, xp, ref, rank, date }));
  const items = [strip(species), strip(role), strip(background)];
  // Every perk the species grants (2026-10-20): {data, perk} each, the ability and its list entry.
  for ( const sp of speciesPerks ) items.push(speciesPerkCopy(strip(sp.data), species.name, sp.perk));
  const entry = (background.system?.perks ?? []).find(p => p.id === choices.perk);
  if ( entry && perkAbility ) items.push(perkCopy(strip(perkAbility), background.name, entry));
  // The mutations rolled, for a species that carries them.
  if ( species.system?.mutations ) for ( const m of mutations ) {
    const copy = strip(m);
    const pick = picked.picks[m._id ?? m.id];
    if ( pick ) copy.system = { ...copy.system, chosen: { attribute: pick.attribute ?? "", skill: pick.skill ?? "" } };
    items.push(copy);
  }
  // The species' boons, for a species that grants them.
  if ( species.system?.boons ) for ( const b of boons ) items.push(strip(b));
  // The perks trained, each marked with its tree and node as the Training tab marks a perk bought.
  for ( const p of trainingPerks ) {
    const copy = strip(p.data);
    copy.flags = { ...(copy.flags ?? {}), irop: { ...(copy.flags?.irop ?? {}), perk: { tree: p.tree, node: p.node, xp: p.xp } } };
    items.push(copy);
  }
  // A paraphysical recruit's discipline and free power (2026-10-20), at Rank 1, nothing chosen yet.
  const psi = training?.psi;
  const paraphysics = (psi?.discipline) ? { [psi.discipline]: 1 + (psi.extra || 0) } : null;
  if ( psi?.power && trainingPower ) {
    const copy = strip(trainingPower);
    copy.system = { ...copy.system, paraphysics: { ...(copy.system?.paraphysics ?? {}), rank: 1, choice: "" } };
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
      ...(paraphysics ? { paraphysics } : {}),
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
  return { attributes: {}, skills: {}, perks: [], psi: emptyPsi() };
}

/** No paraphysics picked. */
export function emptyPsi() {
  return { discipline: "", extra: 0, power: "" };
}

/**
 * A paraphysical recruit's paraphysics (Johnald, 2026-10-20), as awakening starts a caster: rank 1
 * in a discipline of their choice, free; a second rank bought from the training XP if they like
 * (rank 2 is the most at creation); and one power, free, from a discipline they hold at a tier
 * they reach. A species' granted ranks count (a Telestoi's Telepathy).
 * @param {object} psi            choices.training.psi
 * @param {object} recruit
 * @param {boolean} recruit.enabled   Species or background paraphysical
 * @param {object} recruit.species    speciesParaphysics()
 * @param {object[]} [recruit.powers] The world's powers: {id, name, system}
 * @returns {{enabled, discipline, extra, power, cost, nextCost, rank, states, offered, entries, clean}}
 */
export function psiTraining(psi, { enabled = false, species, powers = [] } = {}) {
  const none = { enabled, discipline: "", extra: 0, power: null, cost: 0, nextCost: null, rank: 0, states: disciplineStates({}, species), offered: [], entries: [], clean: emptyPsi() };
  if ( !enabled ) return none;
  const base = disciplineStates({}, species);
  const held = schoolsHeld(base);
  let key = String(psi?.discipline ?? "");
  // A discipline still open, and one more school the species can hold (or one it already grants).
  if ( key && (!(key in IROP.disciplines) || !disciplineOpen(key) || (!(base[key].rank > 0) && (held >= species.schools))) ) key = "";
  if ( !key ) return { ...none, offered: [] };
  const cap = IROP.paraphysics.creationMax;
  // Rank 1 free; a second rank only while the creation cap allows it.
  const room = Math.max(0, cap - (base[key].bonus + 1));
  const extra = Math.max(0, Math.min(room, Math.floor(Number(psi?.extra) || 0)));
  const bought = 1 + extra;
  const states = disciplineStates({ [key]: bought }, species);
  const cost = extra ? disciplineRankCost(2) : 0;
  const nextCost = (extra < room) ? disciplineRankCost(bought + 1) : null;
  // The power: any open discipline the recruit holds, at a tier its rank reaches. Each name once
  // (Johnald, 2026-10-20: a world holding two copies of a power listed it twice).
  const seen = new Set();
  const offered = powers.filter(p => {
    const d = p.system?.paraphysics?.discipline;
    if ( !d || !disciplineOpen(d) || !(states[d]?.rank > 0) || ((Number(p.system.paraphysics.tier) || 1) > states[d].rank) ) return false;
    // An NPC's power is never offered (2026-10-20).
    if ( p.system.paraphysics.learnable === false ) return false;
    const key = String(p.name ?? "").trim().toLowerCase();
    if ( seen.has(key) ) return false;
    seen.add(key);
    return true;
  });
  const power = offered.find(p => p.id === psi?.power) ?? null;
  const label = IROP.disciplines[key];
  const entries = [{ kind: "discipline", label: `${label} rank ${base[key].bonus + 1}, free at enlistment`, xp: 0, ref: key, rank: base[key].bonus + 1 }];
  if ( extra ) entries.push({ kind: "discipline", label: `${label} rank ${base[key].bonus + 2}`, xp: cost, ref: key, rank: base[key].bonus + 2 });
  if ( power ) entries.push({ kind: "awakenPower", label: `${power.name} learned, free at enlistment`, xp: 0, ref: power.id, rank: 1 });
  return { enabled, discipline: key, extra, power, cost, nextCost, rank: states[key].rank, states, offered, entries,
    clean: { discipline: key, extra, power: power?.id ?? "" } };
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
export function trainingPlan(training, { attributes, ranks, trees = [], nameOf = n => n.name, requirementsOf = () => [], unmet = () => [], budget = IROP.startingXP, psi = null } = {}) {
  const t = training ?? emptyTraining();
  const perRank = IROP.attributeAdvance.perRank;
  const attr = Object.keys(IROP.attributes).map(key => {
    // Luck is never trained (RULED 2026-10-17).
    const pips = rankLocked(key) ? 0 : Math.max(0, Math.min(IROP.attributeAdvance.maxRanks, Math.floor(Number(t.attributes?.[key]) || 0)));
    return { key, locked: rankLocked(key), base: Number(attributes?.[key]) || 0, pips, value: (Number(attributes?.[key]) || 0) + (pips * perRank), cost: pipsCost("attribute", 0, pips) };
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
  // A paraphysical recruit's second discipline rank (2026-10-20); rank 1 and the power are free.
  const spent = attr.reduce((s, a) => s + a.cost, 0) + skills.reduce((s, k) => s + k.cost, 0) + perkCost + (psi?.cost ?? 0);
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
  // Then the paraphysics: the free rank, any bought, the free power.
  for ( const e of psi?.entries ?? [] ) entries.push(e);
  return {
    attributes: attr, skills, perks: [...owned], perkTrees, dropped, spent, left, budget, entries, psi,
    // What the next pip of each costs, and whether the plan can pay for it.
    nextAttribute: key => {
      const a = attr.find(x => x.key === key);
      if ( !a || a.locked || (a.pips >= IROP.attributeAdvance.maxRanks) ) return null;
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
    perks: [...plan.perks],
    psi: plan.psi?.clean ?? emptyPsi()
  };
}

/** Each attribute before training: the species' score and its boons. */
export function recruitAttributes(species, boons = []) {
  const out = Object.fromEntries(speciesAttributes(species?.system ?? {}).map(a => [a.key, a.value]));
  for ( const b of boons ) if ( b?.system?.attribute in out ) out[b.system.attribute] += Number(b.system.amount) || 0;
  return out;
}

/* -------------------------------------------- */

/**
 * Mutations that ask for a choice (Johnald, 2026-10-17): Aberrant Potential (+5 to an attribute and
 * a rank in a skill, which at creation cannot pass rank 2) and Genetic Degradation (-5 to an
 * attribute, Luck excluded). The picks are kept in choices.mutationPicks, by mutation item id:
 * {attribute, skill}.
 */

/** No skill passes this rank at creation (Playable Mutants: "Skill Rank cannot exceed 2 upon character creation"). */
export const CREATION_SKILL_CAP = 2;

/** What the rolled mutations ask for: [{id, name, attribute (the amount), skill (ranks), noLuck}]. */
export function mutationNeeds(docs = []) {
  return docs.filter(m => m?.system?.choice && (m.system.choice.attribute || m.system.choice.skill)).map(m => ({
    id: m.id ?? m._id, name: m.name, attribute: Number(m.system.choice.attribute) || 0,
    skill: Number(m.system.choice.skill) || 0, noLuck: !!m.system.choice.noLuck
  }));
}

/**
 * The picks that stand, and what they add: a real attribute (not Luck where it is excluded), a real
 * skill that the ranks would not lift past CREATION_SKILL_CAP.
 * @param {object} picks          choices.mutationPicks
 * @param {object[]} needs        From mutationNeeds
 * @param {Record<string, number>} ranks   Each skill's starting rank
 * @returns {{picks: object, attributes: Record<string, number>, skills: Record<string, number>, missing: string[]}}
 */
export function mutationAdjust(picks = {}, needs = [], ranks = {}) {
  const out = { picks: {}, attributes: {}, skills: {}, missing: [] };
  for ( const need of needs ) {
    const pick = picks?.[need.id] ?? {};
    const kept = {};
    if ( need.attribute ) {
      const ok = IROP.attributes[pick.attribute] && !(need.noLuck && (pick.attribute === "lck"));
      if ( ok ) {
        kept.attribute = pick.attribute;
        out.attributes[pick.attribute] = (out.attributes[pick.attribute] ?? 0) + need.attribute;
      }
      else out.missing.push(`Choose an attribute for ${need.name}.`);
    }
    if ( need.skill ) {
      const ok = IROP.skills[pick.skill] && (((Number(ranks[pick.skill]) || 0) + (out.skills[pick.skill] ?? 0) + need.skill) <= CREATION_SKILL_CAP);
      if ( ok ) {
        kept.skill = pick.skill;
        out.skills[pick.skill] = (out.skills[pick.skill] ?? 0) + need.skill;
      }
      else out.missing.push(`Choose a skill for ${need.name}.`);
    }
    out.picks[need.id] = kept;
  }
  return out;
}

/** Starting ranks with what the mutations add. */
export function withMutationRanks(ranks, adjust) {
  const out = { ...ranks };
  for ( const [k, n] of Object.entries(adjust?.skills ?? {}) ) out[k] = Math.min(IROP.skillRanks.max, (out[k] ?? 0) + n);
  return out;
}

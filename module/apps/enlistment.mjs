import { IROP } from "../config.mjs";
import {
  STEPS, DEFAULT_IMG, blurb, speciesAttributes, rolePlan, backgroundPlan, skillsTaken, startingRanks, operativeName, stepIssues, operativeData,
  stepsFor, rollMutations, rerollNegative, mutationsRolled, mutationIds, BOON_PICKS, boonPicks,
  emptyTraining, trainingPlan, cleanTraining, recruitAttributes, mutationNeeds, mutationAdjust, withMutationRanks, CREATION_SKILL_CAP,
  psiTraining, emptyPsi, backgroundFits
} from "../rules/enlistment.mjs";
import { speciesParaphysics, disciplineOpen, trackText } from "../rules/paraphysics.mjs";
import { perkMeta, liveBackground } from "../rules/backgrounds.mjs";
import { treesFor } from "../rules/skill-trees.mjs";
import { parseRequirements, unmetRequirements } from "../rules/requirements.mjs";
import { isPhysical, walletOf } from "../rules/store.mjs";
import { asGM, registerAction } from "../socket.mjs";
import { RoleTreesViewer } from "./role-trees.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The enlistment terminal (Johnald, 2026-10-12, mockup A): a guided creator for a new operative.
 * Steps down the left like a console booting, big cards for each choice in the middle, and the
 * draft Personnel Record filling in on the right. It ends by printing the record and stamping it.
 * Species, roles and backgrounds come from the world's items, so whatever the GM edits or
 * imports shows here. The operative is made at the end: by the GM's own client for a player,
 * through the system socket, so players need no permission to create actors.
 */

/** Two letters for each doctrine's badge. */
const ROLE_ABBR = { legionary: "LG", marauder: "MR", specialist: "SP", outrider: "OR", warmachine: "WM", vanguard: "VG" };

const byName = (a, b) => a.name.localeCompare(b.name);
const skillLabel = key => IROP.skills[key]?.label ?? key;
const reducedMotion = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Requests sent to the GM's client, waiting for the operative to appear: request id to the app. */
const PENDING = new Map();

/** The species a player can pick, the roles in doctrine order, and the backgrounds. */
export function enlistmentItems(items = game.items ?? []) {
  const order = Object.keys(IROP.roles);
  return {
    species: items.filter(i => (i.type === "species") && (i.system.playable !== false)).sort(byName),
    // Roles and backgrounds the GM unticked "Offered at enlistment" for stay out (2026-10-16).
    roles: items.filter(i => (i.type === "role") && (i.system.enlist !== false)).sort((a, b) => (order.indexOf(a.system.role) - order.indexOf(b.system.role)) || byName(a, b)),
    backgrounds: items.filter(i => (i.type === "background") && (i.system.enlist !== false)).sort(byName)
  };
}

/**
 * The player mutation tables (2026-10-16): the world's "Positive mutations (d20)" and "Negative
 * mutations (d20)" roll tables when there (dev/player-mutations-macro.js makes them), whose results
 * point at Mutation items; otherwise every Mutation item of that polarity, flat odds, leaving out
 * the test kit's placeholders.
 * @returns {{positive: object[], negative: object[], fromTables: boolean, ready: boolean}}
 */
export function mutationTables({ tables = game.tables, items = game.items } = {}) {
  const out = { fromTables: false };
  for ( const polarity of ["positive", "negative"] ) {
    const label = (polarity === "positive") ? "Positive" : "Negative";
    const table = tables?.find?.(t => t.name === `${label} mutations (d20)`);
    let rows = Array.from(table?.results ?? []).map(r => {
      const doc = r.documentUuid ? foundry.utils.fromUuidSync(r.documentUuid) : null;
      return (doc?.type === "mutation") ? { lo: r.range[0], hi: r.range[1], id: doc.id, name: doc.name } : null;
    }).filter(Boolean);
    if ( rows.length ) out.fromTables = true;
    else {
      rows = (items?.filter?.(i => (i.type === "mutation") && (i.system.polarity === polarity) && !/\(test\)\s*$/i.test(i.name)) ?? [])
        .sort(byName).map((m, i) => ({ lo: i + 1, hi: i + 1, id: m.id, name: m.name }));
    }
    out[polarity] = rows;
  }
  out.ready = (new Set(out.positive.map(r => r.id)).size >= 2) && (out.negative.length >= 1);
  return out;
}

/**
 * A boon for an attribute (2026-10-16): the world's Boon item for it when there is one, else one made
 * to the rules (+IROP.boonAmount), so a world without boon items can still enlist a Human.
 */
export function boonFor(attribute, items = game.items) {
  const item = (items?.filter?.(i => (i.type === "boon") && (i.system.attribute === attribute)) ?? []).sort(byName)[0];
  if ( item ) return item;
  const label = IROP.attributes[attribute]?.label ?? attribute;
  return { name: `${label} Boon`, type: "boon", img: "icons/svg/upgrade.svg",
    system: { attribute, amount: IROP.boonAmount, description: `<p>The species bonus: +${IROP.boonAmount} ${label}.</p>` },
    toObject() { return { name: this.name, type: this.type, img: this.img, system: { ...this.system } }; } };
}

/** A document by UUID, or null, never throwing. */
function fromUuidQuiet(uuid) {
  if ( !uuid ) return null;
  try { return foundry.utils.fromUuidSync(uuid) ?? null; }
  catch { return null; }
}

/** A tree node's name: its ability's current name, or the one stored with the node. */
const nodeName = node => fromUuidQuiet(node.uuid)?.name ?? node.name;

/** How far down its role's own tree a recruit may train (Johnald, 2026-10-16): the first three tiers. */
export const ENLIST_ROLE_TIERS = 3;

/**
 * The perk trees a recruit trains in (2026-10-16): the role's Primary and the General trees, as
 * the Training tab shows them. Specializations open later, with XP earned. A role's own tree
 * offers only its first ENLIST_ROLE_TIERS tiers here; the rest open on the sheet.
 */
export function enlistmentTrees(roleKey, items = game.items) {
  const all = items?.filter?.(i => i.type === "skillTree") ?? [];
  return treesFor(all, { role: roleKey ?? "" }).filter(t => t.system.kind !== "specialization").map(t => {
    if ( !t.system.role ) return t;
    const { tabLabel, gated, kind, role } = t.system;
    return { id: t.id, name: t.name, system: { tabLabel, gated, kind, role, tiers: t.system.tiers.slice(0, ENLIST_ROLE_TIERS) } };
  });
}

/**
 * The recruit's training plan worked out (see rules/enlistment.mjs trainingPlan): against the
 * species, its boons, the starting skills, and the role's trees.
 */
export function planFor(choices, { species, role, background }, items = game.items) {
  const boons = species?.system?.boons ? boonPicks(choices).map(k => boonFor(k, items)) : [];
  const adjust = mutationsPicked(choices, { species, role, background }, items);
  const attributes = recruitAttributes(species, boons);
  for ( const [k, n] of Object.entries(adjust.attributes) ) attributes[k] += n;
  // A paraphysical recruit (2026-10-20): species or background, a free rank and a free power.
  const enabled = !!(species?.system?.paraphysical || background?.system?.paraphysical);
  const powers = items?.filter?.(i => (i.type === "ability") && i.system?.paraphysics?.discipline) ?? [];
  const psi = psiTraining(choices.training?.psi, { enabled, species: speciesParaphysics(species?.system ?? null), powers });
  return trainingPlan(choices.training, {
    psi,
    attributes,
    ranks: withMutationRanks(startingRanks(skillsTaken(choices, role, background)), adjust),
    trees: role ? enlistmentTrees(role.system.role, items) : [],
    nameOf: nodeName,
    requirementsOf: node => parseRequirements(fromUuidQuiet(node.uuid)?.system?.prerequisites),
    unmet: unmetRequirements,
    budget: IROP.startingXP
  });
}

/** The rolled mutations' choices, worked out (2026-10-17): see rules/enlistment.mjs mutationAdjust. */
export function mutationsPicked(choices, { species, role, background }, items = game.items) {
  const docs = species?.system?.mutations ? mutationIds(choices.mutations).map(id => items?.get?.(id)).filter(Boolean) : [];
  return { ...mutationAdjust(choices.mutationPicks, mutationNeeds(docs), startingRanks(skillsTaken(choices, role, background))), needs: mutationNeeds(docs) };
}

/**
 * The stores the GM opened at enlistment (2026-10-16: "Open at enlistment" on the store), by name,
 * each with whether this user can open it.
 */
export function enlistmentStores(user = game.user, actors = game.actors) {
  return (actors?.filter?.(a => (a.type === "store") && a.system.enlist) ?? [])
    .sort(byName)
    .map(store => ({ store, open: !!user?.isGM || !!store.testUserPermission?.(user, "LIMITED") }));
}

/** A die from 1 to faces, on Foundry's own random numbers. */
function rollDie(faces) {
  const u = globalThis.CONFIG?.Dice?.randomUniform?.() ?? Math.random();
  return Math.min(faces, Math.max(1, Math.ceil(u * faces)));
}

/** The ability a background's perk entry points at, if it is in this world. */
function perkAbility(entry) {
  const doc = entry?.uuid ? foundry.utils.fromUuidSync(entry.uuid) : null;
  return (doc?.type === "ability") ? doc : null;
}

/** Today's date on the campaign calendar, for the record; blank if there is none. */
async function today() {
  try {
    const { dateInfo } = await import("../calendar.mjs");
    return dateInfo().date ?? "";
  }
  catch {
    return "";
  }
}

/**
 * Make the operative from the choices. Runs on a GM's client (or for a player allowed to make
 * actors): checks every step, copies the species, role, background and the perk taken, and
 * gives the player the operative, as their character if they have none yet.
 * @returns {Promise<{error?: string, notice?: string, actor?: Actor}>}
 */
export async function createOperative(choices = {}, user = game.user, request = "") {
  const species = game.items.get(choices.species);
  const role = game.items.get(choices.role);
  const background = game.items.get(choices.background);
  const tables = mutationTables();
  const mutationChoices = mutationsPicked(choices, { species, role, background }).missing;
  const issues = Object.values(stepIssues(choices, { species, role, background, mutationsReady: tables.ready, mutationChoices })).filter(Boolean);
  if ( issues.length ) return { error: issues[0] };
  if ( (species.type !== "species") || (role.type !== "role") || (background.type !== "background") ) return { error: "Those choices are not a species, role and background." };
  // The mutations rolled: two Positive and one Negative, all this world's Mutation items.
  let mutations = [];
  if ( species.system.mutations && tables.ready ) {
    const docs = mutationIds(choices.mutations).map(id => game.items.get(id));
    const count = polarity => docs.filter(d => (d?.type === "mutation") && (d.system.polarity === polarity)).length;
    if ( (docs.length !== 3) || (new Set(docs.map(d => d?.id)).size !== 3) || (count("positive") !== 2) || (count("negative") !== 1) ) {
      return { error: "The mutations rolled are not two different Positives and one Negative from this world. Roll them again." };
    }
    mutations = docs.map(d => d.toObject());
  }
  // The species' boons: two attributes, none twice (stepIssues checked the count).
  const boons = species.system.boons ? boonPicks(choices).map(k => boonFor(k).toObject()) : [];
  // Training: worked out again here, on the world's own trees; nothing that does not fit is filed.
  const plan = planFor(choices, { species, role, background });
  if ( plan.dropped.length ) return { error: `Your training no longer allows ${plan.dropped.map(d => d.name).join(", ")}. Check the Training step.` };
  if ( plan.left < 0 ) return { error: `Your training costs ${plan.spent} XP, more than the ${plan.budget} you start with.` };
  const trainingPerks = [];
  for ( const e of plan.entries.filter(x => x.kind === "perk") ) {
    const tree = game.items.get(e.tree);
    const node = tree?.system?.findNode?.(e.ref)?.node ?? null;
    const ability = node?.uuid ? await foundry.utils.fromUuid(node.uuid) : null;
    if ( ability?.type !== "ability" ) return { error: `${e.label} is missing its ability in this world. Ask the GM to fix the tree.` };
    trainingPerks.push({ data: ability.toObject(), tree: e.tree, node: e.ref, xp: e.xp });
  }
  // The free power, from this world (2026-10-20).
  let trainingPower = null;
  if ( plan.psi?.power ) {
    const power = game.items.get(plan.psi.power.id);
    if ( power?.type !== "ability" ) return { error: `${plan.psi.power.name} is not in this world any more. Pick another power in the Training step.` };
    trainingPower = power.toObject();
  }
  const live = liveBackground(background);
  const entry = (live.system?.perks ?? []).find(p => p.id === choices.perk);
  const ability = entry?.uuid ? await foundry.utils.fromUuid(entry.uuid) : null;
  // A GM may enlist for a player; a player always enlists for themselves.
  const owner = user.isGM ? (game.users.get(choices.owner)?.id ?? user.id) : user.id;
  const data = operativeData(choices, {
    species: species.toObject(), role: role.toObject(), background: live.toObject?.() ?? background.toObject(),
    perkAbility: (ability?.type === "ability") ? ability.toObject() : null, mutations, boons, training: plan, trainingPerks, trainingPower
  }, { owner, date: await today(), request });
  const actor = await Actor.implementation.create(data);
  if ( !actor ) return { error: "The operative could not be made." };
  const player = game.users.get(owner);
  if ( player && !player.isGM && !player.character ) await player.update({ character: actor.id });
  return { notice: `enlisted ${actor.name}`, actor };
}

/* -------------------------------------------- */

export class EnlistmentApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-enlistment",
    classes: ["irop", "irop-enlistment"],
    window: { title: "ODR enlistment", icon: "fa-solid fa-id-card", resizable: true },
    position: { width: 1140, height: 740 },
    actions: {
      goStep: EnlistmentApp.#onStep,
      next: EnlistmentApp.#onNext,
      back: EnlistmentApp.#onBack,
      pick: EnlistmentApp.#onPick,
      roleSkill: EnlistmentApp.#onRoleSkill,
      backgroundSkill: EnlistmentApp.#onBackgroundSkill,
      perk: EnlistmentApp.#onPerk,
      boon: EnlistmentApp.#onBoon,
      rollMutations: EnlistmentApp.#onRollMutations,
      trainAttribute: EnlistmentApp.#onTrainAttribute,
      trainSkill: EnlistmentApp.#onTrainSkill,
      trainPerk: EnlistmentApp.#onTrainPerk,
      trainDiscipline: EnlistmentApp.#onTrainDiscipline,
      trainDisciplineRank: EnlistmentApp.#onTrainDisciplineRank,
      trainPower: EnlistmentApp.#onTrainPower,
      perkTab: EnlistmentApp.#onPerkTab,
      resetTraining: EnlistmentApp.#onResetTraining,
      requisition: EnlistmentApp.#onRequisition,
      record: EnlistmentApp.#onRecord,
      openStore: EnlistmentApp.#onOpenStore,
      rerollNegative: EnlistmentApp.#onRerollNegative,
      enlist: EnlistmentApp.#onEnlist,
      openSheet: EnlistmentApp.#onOpenSheet,
      restamp: EnlistmentApp.#onRestamp,
      again: EnlistmentApp.#onAgain
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/enlistment.hbs", scrollable: [".en-pane"] }
  };

  static #instance = null;

  /** Open the terminal (one at a time). */
  static open() {
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  /** Where the recruit is: the step, the choices, and the operative once made. */
  step = 0;

  choices = EnlistmentApp.freshChoices();

  /** A recruit with nothing chosen yet. */
  static freshChoices() {
    return { species: "", role: "", background: "", roleSkill: "", backgroundSkills: [], perk: "", firstName: "", lastName: "", callsign: "", img: DEFAULT_IMG, owner: "", mutations: null, mutationPicks: {}, boons: [], training: emptyTraining() };
  }

  /** The operative made, the request waiting on the GM's client, and the steps visited, by key. */
  result = null;
  waiting = "";
  visited = new Set(["species"]);
  #typed = -1;
  #typer = null;
  /** The perk tree on show in Training, by id. */
  perkTab = "";

  /** After enlisting: the stamped record, or the Requisition stores. */
  phase = "record";
  /** Hooks that redraw Requisition as the new operative's purse and kit change. */
  #hooks = [];
  /** The step last shown: the pane slides in only when the step changes, not on every pick. */
  #shown = -1;

  /** The steps for the species chosen: Mutations only for one that carries them. */
  get steps() {
    return stepsFor(this.picked.species);
  }

  /** The chosen species, role and background items. */
  get picked() {
    const get = id => (id ? game.items?.get(id) ?? null : null);
    return { species: get(this.choices.species), role: get(this.choices.role), background: get(this.choices.background) };
  }

  /** @override */
  async _prepareContext(options) {
    const c = this.choices;
    const { species, role, background } = this.picked;
    const list = enlistmentItems();
    const tables = mutationTables();
    const picked = mutationsPicked(c, { species, role, background });
    const issues = stepIssues(c, { species, role, background, mutationsReady: tables.ready, mutationChoices: picked.missing });
    const steps = this.steps;
    if ( this.step >= steps.length ) this.step = steps.length - 1;
    const roleColor = role ? (IROP.roles[role.system.role]?.color ?? "#42abf2") : "";
    const rp = rolePlan(role);
    const bp = backgroundPlan(background);
    const bgLive = background ? liveBackground(background) : null;
    const taken = skillsTaken(c, role, background);
    const ranks = startingRanks(taken);
    const perkEntry = (bgLive?.system?.perks ?? []).find(p => p.id === c.perk);
    const key = steps[this.step].key;
    const mutationItems = (species?.system?.mutations ? mutationIds(c.mutations) : []).map(id => game.items?.get(id)).filter(Boolean);
    // Boons, for a species that grants them: the attribute and what it adds.
    const boonList = species?.system?.boons ? boonPicks(c).map(k => ({ key: k, boon: boonFor(k) })) : [];
    const boonAdd = Object.fromEntries(boonList.map(b => [b.key, Number(b.boon.system.amount) || 0]));
    const boonText = boonList.map(b => `${IROP.attributes[b.key].label} +${boonAdd[b.key]}`).join(", ");
    // Training: the plan, kept to what it allows as the choices above it change.
    const plan = planFor(c, { species, role, background });
    if ( !this.result ) c.training = cleanTraining(c.training, plan);
    const trainedRanks = Object.fromEntries(plan.skills.map(sk => [sk.key, sk.rank]));
    const trainedText = trainingText(plan);

    // The cards on each step.
    const speciesCards = list.species.map(s => ({
      id: s.id, name: s.name, img: s.img, on: s.id === c.species, blurb: blurb(s.system.description),
      health: s.system.health, energy: s.system.energy, attributes: speciesAttributes(s.system),
      tags: [s.system.boons ? "Takes boons" : "", s.system.mutations ? "Carries mutations" : "", s.system.paraphysical ? "Paraphysical" : ""].filter(Boolean)
    }));
    const roleCards = list.roles.map(r => {
      const plan = rolePlan(r);
      return {
        id: r.id, name: r.name, on: r.id === c.role, color: IROP.roles[r.system.role]?.color ?? "#42abf2",
        abbr: ROLE_ABBR[r.system.role] ?? r.name.slice(0, 2).toUpperCase(), blurb: blurb(r.system.description),
        free: plan.granted.map(skillLabel).join(", "), options: plan.options.map(skillLabel).join(" or "), weapons: r.system.weaponSpecialties
      };
    });
    // Only the backgrounds open to the species picked (2026-10-20).
    const backgroundCards = list.backgrounds.filter(b => backgroundFits(b, species)).map(b => {
      const plan = backgroundPlan(b);
      return {
        id: b.id, name: b.name, img: b.img, on: b.id === c.background, blurb: blurb(b.system.description, 110),
        skills: plan.options.map(skillLabel).join(", "), pick: plan.pick, paraphysical: !!b.system.paraphysical,
        perks: (liveBackground(b).system?.perks ?? []).map(p => perkAbility(p)?.name ?? p.name).filter(Boolean)
      };
    });

    // Skills and perk.
    const skills = (key === "skills") && role && background ? {
      role: { name: role.name, free: rp.granted.map(k => ({ key: k, label: skillLabel(k) })), pick: rp.pick,
        options: rp.options.map(k => ({ key: k, label: skillLabel(k), on: c.roleSkill === k })) },
      background: { name: background.name, pick: bp.pick, count: c.backgroundSkills.filter(k => bp.options.includes(k)).length,
        options: bp.options.map(k => ({ key: k, label: skillLabel(k), on: c.backgroundSkills.includes(k) })) },
      perks: await Promise.all((bgLive?.system?.perks ?? []).map(async p => {
        const a = perkAbility(p);
        return {
          id: p.id, name: a?.name ?? p.name, img: a?.img ?? p.img, on: p.id === c.perk, missing: !a,
          meta: a ? perkMeta(a.system) : "", description: a ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(a.system.description ?? "", { relativeTo: a }) : ""
        };
      }))
    } : null;

    const boons = (key === "boons") ? {
      amount: IROP.boonAmount, picks: BOON_PICKS, count: boonList.length,
      options: speciesAttributes(species?.system ?? {}).map(a => {
        const boon = boonFor(a.key);
        const amount = Number(boon.system.amount) || 0;
        return { key: a.key, abbr: a.abbr, label: IROP.attributes[a.key].label, value: a.value, after: a.value + amount, amount,
          on: boonList.some(b => b.key === a.key), item: boon.id ? boon.name : "" };
      })
    } : null;

    const training = (key === "training") ? await trainingContext(plan, this.perkTab) : null;
    if ( training ) this.perkTab = training.tab;

    // Mutations, for a species that carries them.
    const pad = n => String(n).padStart(2, "0");
    const mutations = (key === "mutations") ? {
      ready: tables.ready, fromTables: tables.fromTables, rolled: mutationsRolled(c.mutations), canReroll: mutationsRolled(c.mutations) && !c.mutations.rerolled,
      rerolled: !!c.mutations?.rerolled,
      chosen: await Promise.all(mutationItems.map(async (m, i) => ({
        id: m.id, pick: mutationPickers(m, picked, startingRanks(taken)),
        name: m.name, img: m.img, polarity: m.system.polarity, label: (m.system.polarity === "negative") ? "Negative" : "Positive",
        n: pad(i < 2 ? c.mutations.positive[i].n : c.mutations.negative.n),
        description: await foundry.applications.ux.TextEditor.implementation.enrichHTML(m.system.description ?? "", { relativeTo: m })
      }))),
      log: (c.mutations?.log ?? []).map(l => `${(l.table === "negative") ? "Negative" : "Positive"} ${pad(l.n)}: ${l.name}${l.note ? `, ${l.note}` : ""}`)
    } : null;

    const isGM = !!game.user?.isGM;
    const name = operativeName(c);
    const s = species?.system;
    return {
      step: this.step, stepNo: this.step + 1, stepCount: steps.length, key, is: { [key]: true }, slide: this.#shown !== this.step, prompt: steps[this.step].prompt, isGM,
      steps: steps.map((st, i) => ({
        n: `0${i + 1}`, index: i, label: st.label, on: (i === this.step) && !(this.result && (this.phase === "requisition")),
        done: !issues[st.key] && (i < this.step || this.visited.has(st.key)) && (st.key !== "review"),
        warn: !!issues[st.key] && this.visited.has(st.key) && (i !== this.step),
        value: {
          species: species?.name, role: role?.name, background: background?.name,
          skills: taken.length ? `${taken.length} skills${perkEntry ? ", a perk" : ""}` : "",
          mutations: mutationItems.length ? `${mutationItems.length} rolled` : "", boons: boonList.length ? `${boonList.length} picked` : "", identity: name,
          training: plan.spent ? `${plan.spent} of ${plan.budget} XP` : ""
        }[st.key] ?? ""
      })),
      mutations, boons, training,
      issue: issues[key], first: this.step === 0, last: key === "review",
      species: speciesCards, roles: roleCards, backgrounds: backgroundCards, skills,
      identity: {
        firstName: c.firstName, lastName: c.lastName, callsign: c.callsign, img: c.img,
        owners: isGM ? [{ id: "", name: `${game.user.name} (you)`, on: !c.owner },
          ...(game.users?.filter(u => !u.isGM) ?? []).map(u => ({ id: u.id, name: u.name, on: u.id === c.owner }))] : []
      },
      review: Object.entries(issues).filter(([k, v]) => v && (k !== "review")).map(([k, v]) => ({ step: STEPS.find(x => x.key === k).label, text: v })),
      // The draft record on the right.
      dossier: {
        name: name || "Unidentified recruit", img: c.img || DEFAULT_IMG, color: roleColor,
        species: species?.name ?? "", role: role?.name ?? "", background: background?.name ?? "",
        perk: perkEntry ? (perkAbility(perkEntry)?.name ?? perkEntry.name) : "",
        skills: rankText(trainedRanks),
        carriesMutations: !!s?.mutations, mutations: mutationItems.map(m => m.name).join(", "),
        grantsBoons: !!s?.boons, boons: boonText,
        training: trainedText, xp: (this.visited.has("training") || plan.spent) ? `${plan.spent} spent, ${plan.left} left` : "",
        health: s?.health ?? "", energy: s?.energy ?? "",
        // The bars show the boons on top of the species' attributes.
        bars: s ? speciesAttributes(s).map(a => {
          const pips = plan.attributes.find(x => x.key === a.key)?.pips ?? 0;
          const mutated = picked.attributes[a.key] ?? 0;
          const value = a.value + (boonAdd[a.key] ?? 0) + (pips * IROP.attributeAdvance.perRank) + mutated;
          return { ...a, value, boosted: !!boonAdd[a.key] || !!pips || (mutated > 0), lowered: mutated < 0, pct: Math.min(100, Math.round((value / 70) * 100)) };
        }) : []
      },
      waiting: !!this.waiting,
      result: this.result ? {
        name: this.result.name, img: this.result.img, color: roleColor, callsign: this.result.system?.details?.callsign ?? "",
        first: c.firstName, last: c.lastName, species: species?.name ?? "", role: role?.name ?? "", background: background?.name ?? "",
        perk: perkEntry ? (perkAbility(perkEntry)?.name ?? perkEntry.name) : "",
        enlisted: this.result.system?.details?.record?.enlisted ?? "",
        mutations: mutationItems.map(m => m.name).join(", "), boons: boonText, training: trainedText,
        skills: rankText(trainedRanks)
      } : null,
      // After enlisting: the stores the GM opened for it.
      requisition: this.result ? requisitionContext(this.result, this.phase) : null,
      phase: this.phase,
      // The Requisition step on the rail, after the others, once a store is open to this user.
      hasStores: enlistmentStores().some(x => x.open), reqNo: `0${steps.length + 1}`
    };
  }

  /** The step's line types itself out; the identity fields keep the record in step as you type. @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#shown = this.step;
    const prompt = this.element.querySelector(".en-prompt-text");
    if ( prompt ) {
      const text = `> ${context.prompt.toUpperCase()}`;
      clearInterval(this.#typer);
      if ( (this.#typed === this.step) || reducedMotion() ) prompt.textContent = text;
      else {
        let i = 0;
        prompt.textContent = "";
        this.#typer = setInterval(() => {
          prompt.textContent = text.slice(0, ++i);
          if ( i >= text.length ) clearInterval(this.#typer);
        }, 26);
      }
      this.#typed = this.step;
    }
    // A mutation's choice (2026-10-17): its attribute and its skill.
    for ( const select of this.element.querySelectorAll("[data-mutation-pick]") ) {
      select.addEventListener("change", () => {
        const picks = this.choices.mutationPicks ??= {};
        const id = select.dataset.mutationPick;
        picks[id] = { ...(picks[id] ?? {}), [select.dataset.part]: select.value };
        this.render();
      });
    }
    for ( const input of this.element.querySelectorAll("[data-field]") ) {
      input.addEventListener("input", () => {
        this.choices[input.dataset.field] = input.value;
        const name = this.element.querySelector(".en-ds-name");
        if ( name ) name.textContent = operativeName(this.choices) || "Unidentified recruit";
      });
      input.addEventListener("change", () => this.render());
    }
    if ( this.result && (this.phase === "record") && !reducedMotion() ) this.element.querySelector(".en-stamp")?.classList.add("hit");
    if ( this.result && !this.#hooks.length ) this.#watch(this.result.id);
    // A middle click on a role shows its perk trees (Johnald, 2026-10-17); no autoscroll in the way.
    for ( const card of this.element.querySelectorAll('[data-kind="role"]') ) {
      card.addEventListener("mousedown", e => { if ( e.button === 1 ) e.preventDefault(); });
      card.addEventListener("auxclick", e => {
        if ( e.button !== 1 ) return;
        e.preventDefault();
        const role = game.items?.get(card.dataset.id);
        if ( role ) RoleTreesViewer.show(role);
      });
    }
    // The perks are role="button" blocks (their descriptions hold paragraphs): Enter and Space press them.
    for ( const el of this.element.querySelectorAll('[role="button"]') ) {
      el.addEventListener("keydown", e => {
        if ( (e.key === "Enter") || (e.key === " ") ) { e.preventDefault(); el.click(); }
      });
    }
  }

  /** @override */
  _onClose(options) {
    clearInterval(this.#typer);
    this.#unwatch();
    for ( const [request, app] of PENDING ) if ( app === this ) PENDING.delete(request);
    return super._onClose(options);
  }

  /** Go to a step; the card grid starts at the top. */
  #goTo(i) {
    const steps = this.steps;
    this.step = Math.max(0, Math.min(steps.length - 1, i));
    this.visited.add(steps[this.step].key);
    return this.render();
  }

  static #onStep(event, target) {
    return this.#goTo(Number(target.dataset.index));
  }

  static #onNext() {
    return this.#goTo(this.step + 1);
  }

  static #onBack() {
    return this.#goTo(this.step - 1);
  }

  /** A species, role or background card. A new role or background clears the picks it offered. */
  static #onPick(event, target) {
    const kind = target.dataset.kind;
    const id = target.dataset.id;
    if ( !["species", "role", "background"].includes(kind) ) return null;
    if ( this.choices[kind] !== id ) {
      this.choices[kind] = id;
      if ( kind === "role" ) this.choices.roleSkill = "";
      if ( kind === "background" ) Object.assign(this.choices, { backgroundSkills: [], perk: "" });
      // A new species closes a background not open to it (2026-10-20: Awakened is for Humans and Mutants).
      if ( kind === "species" ) {
        const bg = game.items?.get(this.choices.background);
        const sp = game.items?.get(id);
        if ( bg && !backgroundFits(bg, sp) ) {
          Object.assign(this.choices, { background: "", backgroundSkills: [], perk: "" });
          ui.notifications.info(`${bg.name} is not open to ${sp.name}, so it came off. Choose another background.`);
        }
      }
    }
    return this.render();
  }

  static #onRoleSkill(event, target) {
    this.choices.roleSkill = target.dataset.skill;
    return this.render();
  }

  /** A background skill on or off, never past the number it allows. */
  static #onBackgroundSkill(event, target) {
    const key = target.dataset.skill;
    const plan = backgroundPlan(this.picked.background);
    const list = this.choices.backgroundSkills.filter(k => plan.options.includes(k));
    if ( list.includes(key) ) this.choices.backgroundSkills = list.filter(k => k !== key);
    else if ( list.length < plan.pick ) this.choices.backgroundSkills = [...list, key];
    else return ui.notifications.info(`${this.picked.background.name} gives ${plan.pick}. Take one off to pick another.`);
    return this.render();
  }

  static #onPerk(event, target) {
    this.choices.perk = target.dataset.perk;
    return this.render();
  }

  /** A boon's attribute on or off: two at most, never the same one twice. */
  static #onBoon(event, target) {
    const key = target.dataset.attribute;
    if ( !IROP.attributes[key] ) return null;
    const picks = boonPicks(this.choices);
    if ( picks.includes(key) ) this.choices.boons = picks.filter(k => k !== key);
    else if ( picks.length < BOON_PICKS ) this.choices.boons = [...picks, key];
    else return ui.notifications.info(`${BOON_PICKS} boons, no attribute twice. Take one off to pick another.`);
    return this.render();
  }

  /** The plan for the choices as they stand. */
  #plan() {
    return planFor(this.choices, this.picked);
  }

  /** Keep the plan to what it allows, and say what fell out (a perk whose need was taken off). */
  #settle(before) {
    const plan = this.#plan();
    this.choices.training = cleanTraining(this.choices.training, plan);
    const lost = before.filter(id => !plan.perks.includes(id));
    if ( lost.length ) {
      const names = plan.dropped.filter(d => lost.includes(d.id)).map(d => d.name);
      ui.notifications.info(`${names.join(", ")} came off: the plan no longer allows ${(names.length === 1) ? "it" : "them"}.`);
    }
    return this.render();
  }

  /** Training: an attribute pip on (data-delta 1) or off (-1). */
  static #onTrainAttribute(event, target) {
    return this.#trainPip("attributes", target);
  }

  /** Training: a skill pip on or off, over the starting ranks. */
  static #onTrainSkill(event, target) {
    return this.#trainPip("skills", target);
  }

  #trainPip(group, target) {
    const key = target.dataset.key;
    const up = Number(target.dataset.delta) > 0;
    const plan = this.#plan();
    const t = this.choices.training ??= emptyTraining();
    const before = [...plan.perks];
    const have = Number(t[group][key]) || 0;
    if ( up ) {
      const next = (group === "attributes") ? plan.nextAttribute(key) : plan.nextSkill(key);
      const label = (group === "attributes") ? IROP.attributes[key]?.label : IROP.skills[key]?.label;
      if ( !next ) return ui.notifications.info((group === "attributes") && plan.attributes.find(a => a.key === key)?.locked ? `${label} cannot be raised.` : `${label} is at its top rank.`);
      if ( !next.affordable ) return ui.notifications.info(`The next ${label} rank costs ${next.cost} XP; ${plan.left} left.`);
      t[group][key] = have + 1;
    }
    else if ( have > 0 ) t[group][key] = have - 1;
    else return null;
    return this.#settle(before);
  }

  /** Training: a perk in or out of the plan; one it cannot take says why. */
  static #onTrainPerk(event, target) {
    const id = target.dataset.node;
    const plan = this.#plan();
    const t = this.choices.training ??= emptyTraining();
    if ( plan.perks.includes(id) ) {
      t.perks = plan.perks.filter(x => x !== id);
      return this.#settle(plan.perks);
    }
    const st = plan.perkTrees.map(p => p.states.get(id)).find(Boolean);
    if ( !st ) return null;
    if ( !st.canBuy ) return ui.notifications.info(st.reason);
    t.perks = [...plan.perks, id];
    return this.#settle(plan.perks);
  }

  /** Training: the paraphysical recruit's discipline, rank 1 free (2026-10-20). A new one starts over. */
  static #onTrainDiscipline(event, target) {
    const t = this.choices.training ??= emptyTraining();
    const key = target.dataset.key;
    const now = t.psi ?? emptyPsi();
    t.psi = (now.discipline === key) ? now : { discipline: key, extra: 0, power: "" };
    return this.#settle(this.#plan().perks);
  }

  /** Training: a second discipline rank on (data-delta 1) or off, from the training XP. */
  static #onTrainDisciplineRank(event, target) {
    const t = this.choices.training ??= emptyTraining();
    const plan = this.#plan();
    const psi = plan.psi;
    if ( !psi?.discipline ) return null;
    if ( Number(target.dataset.delta) > 0 ) {
      if ( psi.nextCost === null ) return ui.notifications.info(`Rank ${psi.rank} is the most a recruit starts with.`);
      if ( psi.nextCost > plan.left ) return ui.notifications.info(`The next ${IROP.disciplines[psi.discipline]} rank costs ${psi.nextCost} XP; ${plan.left} left.`);
      t.psi = { ...psi.clean, extra: psi.extra + 1 };
    }
    else if ( psi.extra > 0 ) t.psi = { ...psi.clean, extra: psi.extra - 1 };
    else return null;
    return this.#settle(plan.perks);
  }

  /** Training: the free power, picked or put back. */
  static #onTrainPower(event, target) {
    const t = this.choices.training ??= emptyTraining();
    const plan = this.#plan();
    if ( !plan.psi?.discipline ) return null;
    const id = target.dataset.id;
    t.psi = { ...plan.psi.clean, power: (plan.psi.power?.id === id) ? "" : id };
    return this.#settle(plan.perks);
  }

  /** Training: show another tree's perks. */
  static #onPerkTab(event, target) {
    this.perkTab = target.dataset.tree;
    return this.render();
  }

  /** Training: start the plan over. */
  static #onResetTraining() {
    this.choices.training = emptyTraining();
    return this.render();
  }

  /** After enlisting: the stores, and back to the record. */
  static #onRequisition() {
    if ( !this.result ) return null;
    this.phase = "requisition";
    return this.render();
  }

  static #onRecord() {
    this.phase = "record";
    return this.render();
  }

  /** Open a store's own window, buying for the operative just enlisted. */
  static #onOpenStore(event, target) {
    const store = game.actors?.get(target.dataset.id);
    if ( !store || !this.result ) return null;
    const sheet = store.sheet;
    sheet?.setBuyer?.(this.result.id);
    return sheet?.render({ force: true });
  }

  /** Redraw Requisition as the operative's purse and kit change. */
  #watch(actorId) {
    let timer = null;
    const redraw = () => {
      if ( this.phase !== "requisition" ) return;
      clearTimeout(timer);
      timer = setTimeout(() => this.render(), 80);
    };
    const mine = doc => (doc?.id === actorId) || (doc?.parent?.id === actorId);
    for ( const hook of ["updateActor", "createItem", "updateItem", "deleteItem"] ) {
      const id = Hooks.on(hook, doc => { if ( mine(doc) ) redraw(); });
      this.#hooks.push([hook, id]);
    }
  }

  #unwatch() {
    for ( const [hook, id] of this.#hooks ) Hooks.off(hook, id);
    this.#hooks = [];
  }

  /** Roll the mutations, once: two Positives (duplicates rerolled) and a Negative, posted to chat. */
  static async #onRollMutations() {
    if ( mutationsRolled(this.choices.mutations) ) return null;
    const tables = mutationTables();
    if ( !tables.ready ) return ui.notifications.warn("This world has no player mutation tables yet. The GM runs the player mutations macro.");
    this.choices.mutations = rollMutations(tables, rollDie);
    await this.#announce(this.choices.mutations.log);
    return this.render();
  }

  /** Controlled Mutation: the Negative rolled once more, posted to chat. */
  static async #onRerollNegative() {
    const before = this.choices.mutations;
    if ( !mutationsRolled(before) || before.rerolled ) return null;
    this.choices.mutations = rerollNegative(before, mutationTables(), rollDie);
    await this.#announce(this.choices.mutations.log.slice(before.log.length));
    return this.render();
  }

  /** The rolls in chat, for the table to see. */
  async #announce(lines) {
    if ( !lines?.length ) return null;
    const who = foundry.utils.escapeHTML(operativeName(this.choices) || `${game.user.name}'s recruit`);
    const pad = n => String(n).padStart(2, "0");
    const rows = lines.map(l => `<li>${(l.table === "negative") ? "Negative" : "Positive"} <strong>${pad(l.n)}</strong>: ${foundry.utils.escapeHTML(l.name)}${l.note ? ` <em>(${foundry.utils.escapeHTML(l.note)})</em>` : ""}</li>`);
    return globalThis.ChatMessage?.implementation?.create?.({
      speaker: { alias: "ODR enlistment" },
      content: `<div class="irop-card"><header class="card-head"><span class="card-sub">Mutations, d20</span><h3>${who}</h3></header><ul class="debrief-lines">${rows.join("")}</ul></div>`
    });
  }

  /** Pick a portrait. */
  /** Enlist: made here by a GM, or by the active GM's client for a player. */
  static async #onEnlist() {
    const issues = Object.values(stepIssues(this.choices, { ...this.picked, mutationsReady: mutationTables().ready })).filter(Boolean);
    if ( issues.length ) return ui.notifications.warn(issues[0]);
    if ( game.user.isGM ) {
      const done = await createOperative(this.choices, game.user);
      if ( done?.error ) return ui.notifications.warn(done.error);
      this.result = done.actor;
      return this.render();
    }
    if ( !game.users.activeGM ) return ui.notifications.warn("No GM is connected. Enlisting needs one online to file your record.");
    const request = foundry.utils.randomID();
    PENDING.set(request, this);
    this.waiting = request;
    await asGM("enlist.create", { choices: this.choices, request });
    await this.render();
    setTimeout(() => {
      if ( this.waiting !== request ) return;
      PENDING.delete(request);
      this.waiting = "";
      ui.notifications.warn("The GM's client did not answer. Try Enlist again in a moment.");
      this.render();
    }, 20000);
    return null;
  }

  /** The operative made for this client's request has appeared. */
  static received(actor) {
    const request = actor?.flags?.irop?.enlistment?.request;
    const app = request ? PENDING.get(request) : null;
    if ( !app ) return;
    PENDING.delete(request);
    app.waiting = "";
    app.result = actor;
    app.render();
  }

  static #onOpenSheet() {
    const actor = this.result ? game.actors.get(this.result.id) : null;
    actor?.sheet?.render({ force: true });
    return this.close();
  }

  static #onRestamp() {
    const stamp = this.element.querySelector(".en-stamp");
    if ( !stamp ) return;
    stamp.classList.remove("hit");
    void stamp.offsetWidth;
    stamp.classList.add("hit");
  }

  /** Start a fresh recruit. */
  static #onAgain() {
    this.step = 0;
    this.visited = new Set(["species"]);
    this.result = null;
    this.phase = "record";
    this.#unwatch();
    this.choices = EnlistmentApp.freshChoices();
    return this.render();
  }
}

/* -------------------------------------------- */

/** The players' enlistment, done by the GM's client. Called once, at init. */
export function registerEnlistment() {
  registerAction("enlist.create", async ({ choices, request }, user) => {
    const done = await createOperative(choices ?? {}, user, request ?? "");
    return done?.error ? { error: done.error } : { notice: done.notice };
  });
  // A player's client hears its operative arrive and shows the stamped record.
  Hooks.on("createActor", actor => EnlistmentApp.received(actor));
}

/** The Enlist button in the Actors sidebar, for everyone. */
export function addEnlistButton(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const actions = root?.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".irop-enlist-button") ) return;
  const button = root.ownerDocument.createElement("button");
  button.type = "button";
  button.className = "irop-enlist-button";
  button.innerHTML = `<i class="fa-solid fa-id-card"></i> Enlist`;
  button.dataset.tooltip = "Make a new operative, step by step";
  button.addEventListener("click", () => EnlistmentApp.open());
  actions.prepend(button);
}

/* -------------------------------------------- */

/** Skills at their ranks, as the record lists them: "Athletics 2, Insight". */
function rankText(ranks) {
  return Object.entries(ranks).filter(([, r]) => r > 0).map(([k, r]) => (r > 1 ? `${skillLabel(k)} ${r}` : skillLabel(k))).join(", ");
}

/** What the training bought, in a line: "Toughness +1, Athletics 2, Strong Back (1)". */
function trainingText(plan) {
  const parts = [
    ...plan.attributes.filter(a => a.pips).map(a => `${IROP.attributes[a.key].label} +${a.pips}`),
    ...plan.skills.filter(s => s.pips).map(s => `${skillLabel(s.key)} ${s.rank}`),
    ...plan.entries.filter(e => e.kind === "perk").map(e => e.label.replace(/\s*\([^)]*\)$/, "")),
    // Paraphysics (2026-10-20): "Astrokinesis 1, Gravbolt".
    ...(plan.psi?.discipline ? [`${IROP.disciplines[plan.psi.discipline]} ${plan.psi.rank}`] : []),
    ...(plan.psi?.power ? [plan.psi.power.name] : [])
  ];
  return parts.join(", ");
}

/** The Training step: the XP meter, attribute and skill pips, and the trees' perks. */
async function trainingContext(plan, tab = "") {
  const pips = (max, start, bought) => Array.from({ length: max }, (_, i) => ({ start: i < start, bought: (i >= start) && (i < start + bought) }));
  const attributes = plan.attributes.map(a => {
    const next = plan.nextAttribute(a.key);
    return { key: a.key, abbr: IROP.attributes[a.key].abbr, label: IROP.attributes[a.key].label, base: a.base, value: a.value, pips: pips(IROP.attributeAdvance.maxRanks, 0, a.pips),
      next: next?.cost ?? null, canAdd: !!next?.affordable, canDrop: a.pips > 0, bought: a.pips > 0, locked: a.locked };
  });
  const skills = plan.skills.map(s => {
    const next = plan.nextSkill(s.key);
    return { key: s.key, label: skillLabel(s.key), rank: s.rank, pips: pips(IROP.skillRanks.max, s.start, s.pips),
      next: next?.cost ?? null, canAdd: !!next?.affordable, canDrop: s.pips > 0, bought: s.pips > 0, has: s.rank > 0 };
  });
  const trees = [];
  for ( const { tree, states } of plan.perkTrees ) {
    const tiers = [];
    for ( const [index, tier] of tree.system.tiers.entries() ) {
      if ( !tier.nodes.length ) continue;
      const nodes = [];
      for ( const node of tier.nodes ) {
        const st = states.get(node.id);
        const source = fromUuidQuiet(node.uuid);
        nodes.push({
          id: node.id, name: nodeName(node), img: source?.img || node.img || "icons/svg/item-bag.svg", cost: st.cost,
          on: st.state === "owned", state: st.state, canBuy: st.canBuy, reason: st.reason,
          meta: source ? perkMeta(source.system) : "", blurb: blurb(source?.system?.description, 140)
        });
      }
      tiers.push({ number: index + 1, exclusive: tier.exclusive && (tier.nodes.length > 1), gated: !!tree.system.gated, nodes });
    }
    if ( tiers.length ) {
      const taken = tree.system.tiers.flatMap(t => t.nodes).filter(n => states.get(n.id)?.state === "owned").length;
      trees.push({ id: tree.id, label: tree.system.tabLabel || tree.name, tiers, taken, limited: !!tree.system.role });
    }
  }
  // Each tree on its own tab (2026-10-16), the one picked shown, else the first.
  const active = trees.find(t => t.id === tab) ?? trees[0] ?? null;
  for ( const t of trees ) t.on = t === active;
  // A paraphysical recruit's block (2026-10-20): the disciplines to start in, a second rank, the free power.
  const p = plan.psi;
  const psi = p?.enabled ? {
    disciplines: Object.entries(IROP.disciplines).filter(([k]) => disciplineOpen(k)).map(([key, label]) => ({
      key, label, on: p.discipline === key, owns: IROP.disciplineInfo[key]?.owns ?? "",
      granted: p.states[key]?.bonus ? `+${p.states[key].bonus} from species` : ""
    })),
    chosen: p.discipline ? IROP.disciplines[p.discipline] : "",
    rank: p.rank, extra: p.extra,
    canAdd: (p.nextCost !== null) && (p.nextCost <= plan.left), canDrop: p.extra > 0, next: p.nextCost,
    powers: p.offered.map(w => ({ id: w.id, name: w.name, img: w.img || "icons/svg/aura.svg", on: p.power?.id === w.id,
      discipline: IROP.disciplines[w.system.paraphysics.discipline], tier: w.system.paraphysics.tier,
      tracks: trackText({ ...w.system.paraphysics, rank: 1 }), energy: Number(w.system.energyCost) || 0, blurb: blurb(w.system.description, 120) })),
    picked: p.power?.name ?? ""
  } : null;
  return {
    psi,
    budget: plan.budget, spent: plan.spent, left: plan.left, pct: plan.budget ? Math.round((plan.spent / plan.budget) * 100) : 0,
    attributes, skills, trees, active, tab: active?.id ?? "", roleTiers: ENLIST_ROLE_TIERS, perRank: IROP.attributeAdvance.perRank, any: plan.spent > 0
  };
}

/** Requisition: the operative's purse and kit, and the stores open to them. */
function requisitionContext(result, phase) {
  const actor = game.actors?.get(result.id) ?? result;
  const stores = enlistmentStores();
  const kit = (actor.items?.filter?.(i => isPhysical(i)) ?? []).sort(byName)
    .map(i => ({ name: i.name, img: i.img, qty: Number(i.system?.quantity) || 1 }));
  return {
    on: phase === "requisition",
    any: stores.length > 0,
    wallet: Object.entries(IROP.currencies).map(([k, cur]) => ({ key: k, label: cur.label, value: walletOf(actor, k) })),
    stores: stores.filter(s => s.open).map(({ store }) => ({
      id: store.id, name: store.name, img: store.img, blurb: blurb(store.system.description, 140),
      count: store.items.filter(i => !i.flags?.irop?.shelf?.hidden).length
    })),
    // A store the GM opened that players cannot see yet.
    closed: game.user?.isGM ? stores.filter(s => !(game.users?.some?.(u => !u.isGM && s.store.testUserPermission?.(u, "LIMITED")))).map(s => s.store.name) : [],
    kit, name: actor.name
  };
}

/**
 * A rolled mutation's pickers, when it asks for a choice (2026-10-17): the attributes it may go to
 * and the skills it may raise (none that would pass rank 2 at creation), with the picks lit.
 */
function mutationPickers(m, picked, ranks) {
  const need = picked.needs.find(n => n.id === m.id);
  if ( !need ) return null;
  const pick = picked.picks[m.id] ?? {};
  const sign = need.attribute > 0 ? `+${need.attribute}` : `${need.attribute}`;
  return {
    attributeAmount: need.attribute ? sign : "",
    attributes: need.attribute ? Object.entries(IROP.attributes).filter(([k]) => !(need.noLuck && (k === "lck")))
      .map(([k, a]) => ({ key: k, label: a.label, on: pick.attribute === k })) : null,
    skillRanks: need.skill,
    skills: need.skill ? Object.entries(IROP.skills).filter(([k]) => ((Number(ranks[k]) || 0) + need.skill) <= CREATION_SKILL_CAP)
      .map(([k, sk]) => ({ key: k, label: sk.label, on: pick.skill === k, rank: Number(ranks[k]) || 0 })) : null
  };
}

import { IROP } from "../config.mjs";
import {
  STEPS, DEFAULT_IMG, blurb, speciesAttributes, rolePlan, backgroundPlan, skillsTaken, startingRanks, operativeName, stepIssues, operativeData,
  stepsFor, rollMutations, rerollNegative, mutationsRolled, mutationIds
} from "../rules/enlistment.mjs";
import { perkMeta, liveBackground } from "../rules/backgrounds.mjs";
import { asGM, registerAction } from "../socket.mjs";

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
  const issues = Object.values(stepIssues(choices, { species, role, background, mutationsReady: tables.ready })).filter(Boolean);
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
  const live = liveBackground(background);
  const entry = (live.system?.perks ?? []).find(p => p.id === choices.perk);
  const ability = entry?.uuid ? await foundry.utils.fromUuid(entry.uuid) : null;
  // A GM may enlist for a player; a player always enlists for themselves.
  const owner = user.isGM ? (game.users.get(choices.owner)?.id ?? user.id) : user.id;
  const data = operativeData(choices, {
    species: species.toObject(), role: role.toObject(), background: live.toObject?.() ?? background.toObject(),
    perkAbility: (ability?.type === "ability") ? ability.toObject() : null, mutations
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
      rollMutations: EnlistmentApp.#onRollMutations,
      rerollNegative: EnlistmentApp.#onRerollNegative,
      browse: EnlistmentApp.#onBrowse,
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
    return { species: "", role: "", background: "", roleSkill: "", backgroundSkills: [], perk: "", firstName: "", lastName: "", callsign: "", img: DEFAULT_IMG, owner: "", mutations: null };
  }

  /** The operative made, the request waiting on the GM's client, and the steps visited, by key. */
  result = null;
  waiting = "";
  visited = new Set(["species"]);
  #typed = -1;
  #typer = null;
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
    const issues = stepIssues(c, { species, role, background, mutationsReady: tables.ready });
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
    const backgroundCards = list.backgrounds.map(b => {
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

    // Mutations, for a species that carries them.
    const pad = n => String(n).padStart(2, "0");
    const mutations = (key === "mutations") ? {
      ready: tables.ready, fromTables: tables.fromTables, rolled: mutationsRolled(c.mutations), canReroll: mutationsRolled(c.mutations) && !c.mutations.rerolled,
      rerolled: !!c.mutations?.rerolled,
      chosen: await Promise.all(mutationItems.map(async (m, i) => ({
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
        n: `0${i + 1}`, index: i, label: st.label, on: i === this.step,
        done: !issues[st.key] && (i < this.step || this.visited.has(st.key)) && (st.key !== "review"),
        warn: !!issues[st.key] && this.visited.has(st.key) && (i !== this.step),
        value: {
          species: species?.name, role: role?.name, background: background?.name,
          skills: taken.length ? `${taken.length} skills${perkEntry ? ", a perk" : ""}` : "",
          mutations: mutationItems.length ? `${mutationItems.length} rolled` : "", identity: name
        }[st.key] ?? ""
      })),
      mutations,
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
        skills: Object.entries(ranks).map(([k, r]) => (r > 1 ? `${skillLabel(k)} ${r}` : skillLabel(k))).join(", "),
        carriesMutations: !!s?.mutations, mutations: mutationItems.map(m => m.name).join(", "),
        health: s?.health ?? "", energy: s?.energy ?? "",
        bars: s ? speciesAttributes(s).map(a => ({ ...a, pct: Math.min(100, Math.round((a.value / 70) * 100)) })) : []
      },
      waiting: !!this.waiting,
      result: this.result ? {
        name: this.result.name, img: this.result.img, color: roleColor, callsign: this.result.system?.details?.callsign ?? "",
        first: c.firstName, last: c.lastName, species: species?.name ?? "", role: role?.name ?? "", background: background?.name ?? "",
        perk: perkEntry ? (perkAbility(perkEntry)?.name ?? perkEntry.name) : "",
        enlisted: this.result.system?.details?.record?.enlisted ?? "",
        mutations: mutationItems.map(m => m.name).join(", "),
        skills: Object.entries(ranks).map(([k, r]) => (r > 1 ? `${skillLabel(k)} ${r}` : skillLabel(k))).join(", ")
      } : null
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
    for ( const input of this.element.querySelectorAll("[data-field]") ) {
      input.addEventListener("input", () => {
        this.choices[input.dataset.field] = input.value;
        const name = this.element.querySelector(".en-ds-name");
        if ( name ) name.textContent = operativeName(this.choices) || "Unidentified recruit";
      });
      input.addEventListener("change", () => this.render());
    }
    if ( this.result && !reducedMotion() ) this.element.querySelector(".en-stamp")?.classList.add("hit");
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
  static #onBrowse() {
    const Picker = foundry.applications.apps.FilePicker.implementation;
    return new Picker({ type: "image", current: this.choices.img, callback: path => { this.choices.img = path; this.render(); } }).render({ force: true });
  }

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

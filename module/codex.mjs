import { IROP } from "./config.mjs";
import { CODEX_SECTIONS, CODEX_LISTS, codexSnapshot, codexProgress, codexNumber } from "./rules/codex.mjs";
import { itemStats } from "./sheets/store-sheet.mjs";
import { plainText } from "./sheets/actor-sheet.mjs";
import { perkMeta } from "./rules/backgrounds.mjs";

/**
 * The Threat Codex (Johnald, 2026-10-17): see rules/codex.mjs. The page sheet, what an enemy's file
 * holds, the GM's reveals, and keeping the players' copy in step with the enemy.
 */

// A page sheet's base; a plain stand in where Foundry's is missing (the Node test harness).
const JournalEntryPageHandlebarsSheet = foundry.applications.sheets?.journal?.JournalEntryPageHandlebarsSheet
  ?? class { static EDIT_PARTS = { header: {}, footer: {} }; };

/** The journal the NPC sheet's Codex button files pages in, made the first time. */
export const CODEX_JOURNAL = "Threat Codex";

const signed = n => ((Number(n) > 0) ? `+${n}` : `${n}`);

/**
 * Everything about an enemy, as its file shows it.
 * @param {Actor} actor   An NPC (or any combatant)
 */
export function actorFacts(actor) {
  if ( !actor?.system ) return null;
  const s = actor.system;
  const items = actor.items?.contents ?? actor.items ?? [];
  const species = items.find(i => i.type === "species");
  const classification = [
    ["Threat", IROP.npcThreats?.[s.details?.threat] ?? ""],
    ["Species", species?.name ?? ""],
    ["Caste", s.details?.caste ? (IROP.castes?.[s.details.caste] ?? s.details.caste) : ""],
    ["Faction", s.details?.faction ?? ""]
  ].filter(([, v]) => v).map(([label, value]) => ({ label, value }));
  const v = s.vitals ?? {};
  const pools = [["Health", v.hp], ["Energy", v.energy], ["Armor", v.armor], ["Barrier", v.barrier]]
    .filter(([, p]) => p).map(([label, p]) => ({ label, value: Number(p.max) || 0 }));
  if ( v.dodges ) pools.push({ label: "Dodges", value: Number(v.dodges.max) || 0 });
  const dr = Object.entries(s.drTotal ?? s.dr ?? {}).filter(([, n]) => Number(n)).map(([k, n]) => ({ label: IROP.damageTypes[k]?.label ?? k, value: signed(n) }));
  const move = Object.entries(s.movement ?? {}).map(([k, n]) => ({ label: IROP.speeds[k] ?? k, value: n }));
  const disciplines = Object.entries(s.paraphysics ?? {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => ({ label: IROP.disciplines[k] ?? k, value: n }));
  const entry = (i, extra = {}) => ({ id: i.id, name: i.name, img: i.img || "", ...extra });
  return {
    classification: classification.length ? classification : [{ label: "Threat", value: "Unclassified" }],
    attributes: Object.entries(s.attributes ?? {}).map(([k, a]) => ({ key: k, label: IROP.attributes[k]?.label ?? k, abbr: IROP.attributes[k]?.abbr ?? k, value: a.value ?? a.base ?? 0 })),
    vitals: pools,
    defenses: { defense: Number(s.defense) || 0, critical: Number(s.critical) || 0, dr, movement: move },
    paraphysics: { has: disciplines.length > 0, disciplines },
    weapons: items.filter(i => i.type === "weapon").map(i => entry(i, { stats: itemStats(i), text: plainText(i.system.description, 320) })),
    abilities: items.filter(i => i.type === "ability").map(i => entry(i, { meta: perkMeta(i.system), text: plainText(i.system.description, 420) })),
    mutations: items.filter(i => i.type === "mutation").map(i => entry(i, { meta: IROP.mutationPolarity?.[i.system.polarity] ?? "", text: plainText(i.system.description, 320) }))
  };
}

/** The players' copy for a page, from its enemy as it is now. */
export function knownFor(page, actor = codexActor(page)) {
  const facts = actorFacts(actor);
  const r = page.system.reveal;
  const known = facts ? codexSnapshot(facts, r, page.system.items) : {};
  if ( r.lore && page.system.lore ) known.lore = page.system.lore;
  known.progress = facts ? codexProgress(facts, r, page.system.items) : 0;
  return known;
}

/** The art players see: the GM's pick, else the enemy's portrait. */
export function codexArt(page, actor = codexActor(page)) {
  return page.system.img || actor?.img || "icons/svg/mystery-man.svg";
}

/** The enemy a page is about. */
export function codexActor(page) {
  const uuid = page?.system?.actor;
  if ( !uuid ) return null;
  try { return foundry.utils.fromUuidSync(uuid) ?? null; }
  catch { return null; }
}

/** Rewrite a page's players' copy from its enemy, if it changed. GM only. */
export async function refreshCodexPage(page, extra = {}) {
  if ( !game.user?.isGM ) return null;
  // The page as it will be once `extra` lands, to work the copy out from.
  const system = page.system.toObject();
  for ( const [key, value] of Object.entries(extra) ) if ( key.startsWith("system.") ) foundry.utils.setProperty(system, key.slice(7), value);
  const probe = { system };
  const actor = codexActor(probe);
  const known = knownFor(probe, actor);
  const art = codexArt(probe, actor);
  const changes = { ...extra };
  if ( JSON.stringify(known) !== JSON.stringify(page.system.known ?? {}) ) changes["system.known"] = known;
  if ( art !== page.system.art ) changes["system.art"] = art;
  return Object.keys(changes).length ? page.update(changes) : null;
}

/* -------------------------------------------- */

/**
 * The page's sheet. Players read only the copy of what was revealed; the GM reads the whole file,
 * live, each section and entry with an eye to show or hide it, and edits the link, the art and the
 * field notes in Edit mode.
 */
export class CodexPageSheet extends JournalEntryPageHandlebarsSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["irop", "irop-codex-page"],
    window: { icon: "fa-solid fa-skull" }
  };

  /** @override */
  static EDIT_PARTS = {
    header: super.EDIT_PARTS.header,
    content: { template: "systems/irop/templates/journal/codex-edit.hbs", classes: ["standard-form"] },
    footer: super.EDIT_PARTS.footer
  };

  /** @override */
  static VIEW_PARTS = {
    content: { template: "systems/irop/templates/journal/codex-view.hbs", root: true }
  };

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const file = codexContext(this.page, { gm: !!game.user?.isGM });
    return Object.assign(context, file, {
      npcs: (game.actors?.filter?.(a => a.type === "npc") ?? []).sort((a, b) => a.name.localeCompare(b.name))
        .map(a => ({ uuid: a.uuid, name: a.name, on: a.uuid === this.page.system.actor })),
      // The notes as this viewer may read them: a player's from the revealed copy only.
      loreHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(file.lore ?? "", { relativeTo: this.page }),
      system: this.page.system
    });
  }

  /** The GM's eyes, and a dropped actor in Edit mode, wired by hand: a page shown inside a journal is not its own window. @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if ( !game.user?.isGM ) return;
    for ( const el of root.querySelectorAll("[data-codex-reveal]") ) {
      el.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); revealSection(this.page, el.dataset.codexReveal); });
    }
    for ( const el of root.querySelectorAll("[data-codex-item]") ) {
      el.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); revealItem(this.page, el.dataset.codexItem); });
    }
    for ( const el of root.querySelectorAll("[data-codex-all]") ) {
      el.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); revealList(this.page, el.dataset.codexAll); });
    }
    root.querySelector("[data-codex-open-actor]")?.addEventListener("click", event => {
      event.preventDefault();
      codexActor(this.page)?.sheet?.render({ force: true });
    });
    if ( !this.isView ) {
      root.addEventListener("drop", event => this.#onDropActor(event));
      root.addEventListener("dragover", event => event.preventDefault());
      root.querySelector("[data-codex-art]")?.addEventListener("click", () => {
        const Picker = foundry.applications.apps.FilePicker.implementation;
        new Picker({ type: "image", current: this.page.system.img, callback: path => refreshCodexPage(this.page, { "system.img": path }) }).render({ force: true });
      });
      root.querySelector("[data-codex-art-clear]")?.addEventListener("click", () => refreshCodexPage(this.page, { "system.img": "" }));
    }
  }

  /** An NPC dropped on the page in Edit mode links it, and names the page after it if it has no name of its own. */
  async #onDropActor(event) {
    let data;
    try { data = JSON.parse(event.dataTransfer?.getData("text/plain") ?? ""); }
    catch { return null; }
    if ( data?.type !== "Actor" || !data.uuid ) return null;
    event.preventDefault();
    const actor = await foundry.utils.fromUuid(data.uuid);
    if ( !actor ) return null;
    return linkActor(this.page, actor);
  }

  /** Linking an actor from the picker in Edit mode: the same as a drop. @inheritDoc */
  _prepareSubmitData(event, form, formData, updateData) {
    const submit = super._prepareSubmitData(event, form, formData, updateData);
    const next = foundry.utils.getProperty(submit, "system.actor");
    if ( (next !== undefined) && (next !== this.page.system.actor) ) {
      const actor = next ? foundry.utils.fromUuidSync(next) : null;
      if ( actor && (!this.page.name || /^(new page|page\b)/i.test(this.page.name)) ) submit.name = actor.name;
    }
    return submit;
  }

  /** After a save, the players' copy follows (the link, the art or the field notes may have changed). @inheritDoc */
  async _processSubmitData(event, form, submitData, options) {
    await super._processSubmitData(event, form, submitData, options);
    return refreshCodexPage(this.page);
  }
}

/** The page's context: the file as this viewer may see it. */
export function codexContext(page, { gm = false } = {}) {
  const s = page.system;
  const actor = gm ? codexActor(page) : null;
  const facts = gm ? actorFacts(actor) : null;
  const known = s.known ?? {};
  const src = gm ? (facts ?? {}) : known;
  const items = new Set(s.items ?? []);
  const sections = CODEX_SECTIONS.map(({ key, label }) => {
    const revealed = !!s.reveal?.[key];
    const data = src[key] ?? null;
    return { key, label, revealed, shown: !!data && (gm || revealed), data, [`is_${key}`]: true };
  });
  const lists = CODEX_LISTS.map(({ key, label }) => {
    const entries = (src[key] ?? []).map(e => ({ ...e, revealed: items.has(e.id) }));
    return { key, label, entries, shown: entries.length > 0, allRevealed: entries.length > 0 && entries.every(e => e.revealed) };
  });
  const lore = gm ? s.lore : (known.lore ?? "");
  return {
    gm, linked: !!actor || !gm, missing: gm && !!s.actor && !actor, unlinked: gm && !s.actor,
    number: codexNumber(page.id), art: gm ? codexArt(page, actor) : (s.art || "icons/svg/mystery-man.svg"),
    progress: gm ? (facts ? codexProgress(facts, s.reveal, s.items) : 0) : (known.progress ?? 0),
    sections, lists, lore, loreRevealed: !!s.reveal?.lore, loreShown: gm ? !!s.lore : !!known.lore,
    actorName: actor?.name ?? ""
  };
}

/* -------------------------------------------- */

/** GM: a section shown or hidden. */
export function revealSection(page, key) {
  if ( !game.user?.isGM || !(key in page.system.reveal) ) return null;
  return refreshCodexPage(page, { [`system.reveal.${key}`]: !page.system.reveal[key] });
}

/** GM: one weapon, perk or mutation shown or hidden. */
export function revealItem(page, id) {
  if ( !game.user?.isGM || !id ) return null;
  const items = new Set(page.system.items);
  if ( items.has(id) ) items.delete(id);
  else items.add(id);
  return refreshCodexPage(page, { "system.items": [...items] });
}

/** GM: every entry of a list shown, or all hidden when they all were. */
export function revealList(page, key) {
  if ( !game.user?.isGM ) return null;
  const facts = actorFacts(codexActor(page));
  const ids = (facts?.[key] ?? []).map(e => e.id);
  const items = new Set(page.system.items);
  const all = ids.length && ids.every(id => items.has(id));
  for ( const id of ids ) all ? items.delete(id) : items.add(id);
  return refreshCodexPage(page, { "system.items": [...items] });
}

/** Link a page to an enemy; a page with no name of its own takes the enemy's. */
export function linkActor(page, actor) {
  const extra = { "system.actor": actor.uuid };
  if ( !page.name || /^(new page|page\b)/i.test(page.name) ) extra.name = actor.name;
  return refreshCodexPage(page, extra);
}

/** Every codex page about an actor. */
export function codexPagesFor(actor) {
  return (game.journal?.contents ?? []).flatMap(j => j.pages.filter(p => (p.type === "codex") && (p.system.actor === actor.uuid)));
}

/**
 * Open an enemy's file from its sheet (GM): its page in the Threat Codex journal, made if there is
 * none, the journal too, which players may read.
 */
export async function openCodexFor(actor) {
  if ( !game.user?.isGM || !actor ) return null;
  let page = codexPagesFor(actor)[0];
  if ( !page ) {
    let journal = game.journal.getName(CODEX_JOURNAL);
    journal ??= await JournalEntry.implementation.create({ name: CODEX_JOURNAL, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
    [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{ name: actor.name, type: "codex", title: { show: false }, system: { actor: actor.uuid } }]);
    await refreshCodexPage(page);
  }
  return page.parent.sheet.render({ force: true, pageId: page.id });
}

/**
 * Keep the players' copies in step (GM's client): when an enemy or anything it carries changes, its
 * pages' revealed facts are written again. A short wait gathers a burst of changes into one write.
 */
export function registerCodexSync() {
  const waiting = new Map();
  const later = actor => {
    if ( !actor || (game.users?.activeGM?.id !== game.user?.id) ) return;
    clearTimeout(waiting.get(actor.uuid));
    waiting.set(actor.uuid, setTimeout(() => {
      waiting.delete(actor.uuid);
      for ( const page of codexPagesFor(actor) ) refreshCodexPage(page);
    }, 400));
  };
  Hooks.on("updateActor", actor => later(actor));
  for ( const hook of ["createItem", "updateItem", "deleteItem"] ) Hooks.on(hook, item => later(item.parent));
}

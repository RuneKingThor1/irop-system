import { IROP } from "../config.mjs";
import {
  disciplineOpen, disciplineRankCost, checkDisciplinePurchase, checkPowerUnlock, checkPowerRank, checkAwaken,
  powerRankCost, powerChoices, trackText, powerSlots, powerTotals
} from "../rules/paraphysics.mjs";
import { abilityCost } from "./actor-sheet.mjs";
import { concentrationOn, endConcentration } from "../concentration.mjs";

/**
 * The Paraphysics tab (Paraphysics Framework Draft 0.6, Johnald, 2026-10-18 and 19): psycrystals,
 * the disciplines with their ranks and power slots, and each power with its own five ranks. In Play
 * mode a player spends XP and psycrystals; Edit mode stays free for a GM's setup and corrections,
 * as the attribute and skill pips are. Every purchase goes on the XP ledger, crystals included.
 */

const DialogV2 = () => foundry.applications.api.DialogV2;
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const date = () => new Date().toISOString().slice(0, 10);
const entry = (kind, label, xp, ref, rank) => ({ kind, label, xp, ref, rank, date: date() });

/** Psycrystals a character can spend: the carried ones and any held back. */
export function crystalsOf(actor) {
  return actor?.system?.crystals?.total ?? (Number(actor?.system?.psi?.crystals) || 0);
}

/**
 * Spend psycrystals (2026-10-20): any held back on the character first, then the Psycrystal items
 * carried. Returns the actor update for the held back count; the items are changed here.
 */
export async function spendCrystals(actor, n) {
  let left = n;
  const banked = Math.max(0, Number(actor.system.psi?.crystals) || 0);
  const fromBank = Math.min(banked, left);
  left -= fromBank;
  for ( const item of actor.items.filter(i => (i.type === "gear") && (i.system?.kind === "psycrystal")) ) {
    if ( left <= 0 ) break;
    const qty = Math.max(0, Number(item.system.quantity) || 0);
    const take = Math.min(qty, left);
    left -= take;
    if ( take >= qty ) await item.delete();
    else await item.update({ "system.quantity": qty - take });
  }
  return fromBank ? { "system.psi.crystals": banked - fromBank } : {};
}

/** The character's powers: abilities with a discipline. */
export function powersOf(actor) {
  return actor.items.filter(i => (i.type === "ability") && i.system.paraphysics?.discipline);
}

/** The tab's context. */
export function psiContext(sheet) {
  const actor = sheet.actor;
  const system = actor.system;
  const states = system.disciplines ?? {};
  const gm = !!game.user?.isGM;
  // An NPC's ranks are the GM's to set straight from the pips, in either mode (2026-10-20).
  const npc = actor.type !== "operative";
  const edit = sheet.isEditMode || (npc && gm);
  const canBuy = (actor.type === "operative") && !edit && sheet.isEditable;
  const enabled = !!system.isParaphysical;
  const abilities = actor.items.filter(i => i.type === "ability");
  const byDiscipline = {};
  for ( const p of powersOf(actor) ) (byDiscipline[p.system.paraphysics.discipline] ??= []).push(p);

  const disciplines = Object.entries(IROP.disciplines)
    .filter(([key]) => disciplineOpen(key) || (states[key]?.rank > 0) || byDiscipline[key]?.length || (edit && gm))
    .map(([key, label]) => {
      const st = states[key] ?? { bought: 0, bonus: 0, rank: 0, cap: IROP.paraphysics.rankMax };
      const held = byDiscipline[key]?.length ?? 0;
      const next = st.rank + 1;
      const nextCost = (next <= st.cap) ? disciplineRankCost(st.bought + 1) : null;
      return {
        key, label, owns: IROP.disciplineInfo[key]?.owns ?? "", open: disciplineOpen(key), rank: st.rank,
        bonusText: st.bonus ? `+${st.bonus} from species` : "",
        pips: Array.from({ length: st.cap }, (_, i) => {
          const n = i + 1;
          return { n, filled: n <= st.rank, granted: n <= st.bonus, buyable: canBuy && enabled && (n === next) && disciplineOpen(key), cost: (n === next) ? nextCost : null };
        }),
        slots: `${held} of ${powerSlots(st.rank)}`, full: held >= powerSlots(st.rank),
        powers: (byDiscipline[key] ?? []).map(p => powerRow(p, abilities, { canBuy, edit }))
      };
    });

  // Layout B (Johnald, 2026-10-19): disciplines down the left, the picked one's powers on the right.
  // The pick is kept on the sheet; by default the first discipline held, else the first shown.
  const picked = disciplines.find(d => d.key === sheet._psiDiscipline) ?? disciplines.find(d => d.rank > 0) ?? disciplines[0] ?? null;
  for ( const d of disciplines ) d.selected = (d === picked);

  const attr = system.casting?.attribute ?? IROP.paraphysics.attribute;
  return {
    selected: picked,
    enabled, gm, edit, npc,
    casting: `${IROP.attributes[attr]?.label ?? attr} ${system.casting?.value ?? 0}`,
    castingMod: system.casting?.mod ?? 0,
    crystals: crystalsOf(actor),
    crystalsTip: `${system.crystals?.carried ?? 0} carried${system.crystals?.banked ? `, ${system.crystals.banked} held back` : ""}`,
    schools: `${system.casting?.held ?? 0} of ${system.casting?.schools ?? IROP.paraphysics.schools}`,
    freePower: !!system.psi?.freePower,
    // The power held in Concentration, if any (2026-10-20).
    concentrating: concentrationOn(actor)?.name ?? "",
    canAwaken: !enabled && (actor.type === "operative"),
    awakenCost: IROP.paraphysics.awakenCost,
    disciplines,
    noPowers: !powersOf(actor).length
  };
}

/** One power's row. */
function powerRow(item, abilities, { canBuy, edit }) {
  const p = item.system.paraphysics;
  const choices = powerChoices(p);
  const totals = powerTotals(p);
  const chosen = totals.option;
  return {
    id: item.id, img: item.img, tier: p.tier, rank: p.rank,
    // Its evolved name, once it has evolved (2026-10-19), with the old one under it.
    name: totals.evolvedName || item.name, formerly: totals.evolvedName ? item.name : "",
    attack: !!p.attack,
    pips: Array.from({ length: IROP.paraphysics.powerMax }, (_, i) => {
      const n = i + 1;
      const cost = powerRankCost(n);
      const next = n === p.rank + 1;
      return {
        n, filled: n <= p.rank, crystal: !!cost?.crystals,
        buyable: canBuy && next,
        tip: next ? (cost.crystals ? `Rank ${n}${n === 5 ? ", its evolution" : ""}: 1 psycrystal` : `Rank ${n}${n === 3 ? ", its choice" : ""}: ${cost.xp} XP`)
          : `Rank ${n}${n === 3 ? ": choice" : (n === 5 ? ": evolution" : "")}`,
        editable: edit
      };
    }),
    tracks: trackText(p),
    ...abilityCost(item, abilities),
    concentration: totals.concentration,
    save: p.save ? (IROP.attributes[p.save]?.abbr ?? p.save) : "",
    // The Rank 3 choice: offered once Rank 3 is reached and none is taken.
    choosing: (p.rank >= 3) && !p.choice && choices.length ? choices : null,
    choice: chosen ? `${chosen.label}${chosen.text ? `: ${chosen.text}` : ""}` : "",
    noChoices: (p.rank >= 3) && !p.choice && !choices.length,
    evolution: (p.rank >= 5) ? String(p.evolution?.text ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : ""
  };
}

/* -------------------------------------------- */
/*  Actions, called with the sheet as this      */
/* -------------------------------------------- */

/** A GM on an NPC sets ranks outright, no XP or crystals, as in Edit mode (2026-10-20). */
function freeHand(actor) {
  return (actor?.type !== "operative") && !!game.user?.isGM;
}

async function confirm(title, html) {
  return DialogV2().confirm({ window: { title }, content: html });
}

/** Let go of Concentration, from the tab. */
export async function onEndConcentration() {
  return endConcentration(this.actor);
}

/** Pick the discipline whose powers show on the right. */
export function onSelectDiscipline(event, target) {
  if ( event?.target?.closest?.("[data-action=\"buyDiscipline\"]") ) return null;
  this._psiDiscipline = target.dataset.discipline;
  return this.render({ parts: ["paraphysics"] });
}

/** A discipline pip: Play mode buys the next rank; Edit mode sets the bought ranks. */
export async function onBuyDiscipline(event, target) {
  const actor = this.actor;
  const key = target.dataset.discipline;
  const n = Number(target.dataset.rank);
  const st = actor.system.disciplines?.[key];
  if ( !st ) return null;
  const label = IROP.disciplines[key] ?? key;
  if ( this.isEditMode || freeHand(actor) ) {
    if ( n <= st.bonus ) return ui.notifications.info(`${label} rank ${n} is granted by the species.`);
    const bought = (n === st.rank) ? n - 1 - st.bonus : n - st.bonus;
    return actor.update({ [`system.paraphysics.${key}`]: Math.max(0, bought) });
  }
  if ( actor.type !== "operative" ) return null;
  const check = checkDisciplinePurchase({ key, state: st, n, unspent: actor.system.xp.unspent,
    held: actor.system.casting?.held ?? 0, schools: actor.system.casting?.schools ?? 5, enabled: actor.system.isParaphysical });
  if ( !check.ok ) return (n === st.rank + 1) ? ui.notifications.warn(check.reason) : null;
  if ( !await confirm("Spend XP", `<p>Buy ${esc(label)} rank ${n} for <strong>${check.cost} XP</strong>? You have ${actor.system.xp.unspent} unspent.</p>`) ) return null;
  const log = [...actor.system._source.xp.log, entry("discipline", `${label} rank ${n}`, check.cost, key, n)];
  return actor.update({ [`system.paraphysics.${key}`]: st.bought + 1, "system.xp.log": log });
}

/** A power pip: Play mode buys the next rank (XP at 2 to 4, a psycrystal at 5); Edit mode sets it. */
export async function onBuyPowerRank(event, target) {
  const actor = this.actor;
  const item = actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  if ( !item ) return null;
  const p = item.system.paraphysics;
  const n = Number(target.dataset.rank);
  if ( this.isEditMode || freeHand(actor) ) {
    const rank = (n === p.rank) ? n - 1 : n;
    return item.update({ "system.paraphysics.rank": Math.max(1, rank), ...((rank < 3) ? { "system.paraphysics.choice": "" } : {}) });
  }
  if ( actor.type !== "operative" ) return null;
  const check = checkPowerRank({ name: item.name, current: p.rank, n, unspent: actor.system.xp.unspent,
    crystals: crystalsOf(actor), choice: p.choice });
  if ( !check.ok ) return (n === p.rank + 1) ? ui.notifications.warn(check.reason) : null;
  const price = check.crystals ? "<strong>1 psycrystal</strong>" : `<strong>${check.xp} XP</strong>`;
  const what = (n === 5) ? `evolve ${esc(item.name)} to its final form` : `raise ${esc(item.name)} to rank ${n}`;
  if ( !await confirm(check.crystals ? "Spend a psycrystal" : "Spend XP", `<p>${what[0].toUpperCase()}${what.slice(1)} for ${price}?</p>`) ) return null;
  const log = [...actor.system._source.xp.log, check.crystals
    ? entry("crystal", `${item.name} evolved (rank ${n})`, 0, item.id, n)
    : entry("power", `${item.name} rank ${n}`, check.xp, item.id, n)];
  await actor.update({ "system.xp.log": log, ...(check.crystals ? await spendCrystals(actor, check.crystals) : {}) });
  return item.update({ "system.paraphysics.rank": n });
}

/** Take a power's Rank 3 modification. */
export async function onChoosePower(event, target) {
  const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  const key = target.dataset.choice;
  const a = item?.system.paraphysics.options.find(o => o.id === key);
  if ( !item || !a ) return null;
  if ( !this.isEditMode && !await confirm("Choose a modification", `<p>Take <strong>${esc(a.label)}</strong> for ${esc(item.name)}? ${esc(a.text)} This choice is permanent.</p>`) ) return null;
  return item.update({ "system.paraphysics.choice": key });
}

/** Awaken (2 psycrystals): paraphysical for good, rank 1 in a discipline, and one power free. */
export async function onAwaken() {
  const actor = this.actor;
  const check = checkAwaken({ enabled: actor.system.isParaphysical, crystals: crystalsOf(actor) });
  if ( !check.ok ) return ui.notifications.warn(check.reason);
  const open = Object.entries(IROP.disciplines).filter(([k]) => disciplineOpen(k));
  const data = await DialogV2().input({
    window: { title: `Awaken ${actor.name}` },
    classes: ["irop", "irop-roll-dialog"],
    content: `<p>Spend <strong>${check.crystals} psycrystals</strong>: ${esc(actor.name)} becomes paraphysical for good, gains rank 1 in a discipline, and may learn one power in it without a crystal.</p>
      <label class="irop-choose"><span>Discipline</span><select name="discipline">${open.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>`,
    ok: { label: "Awaken", icon: "fa-solid fa-atom" }
  });
  if ( !data?.discipline ) return null;
  const key = data.discipline;
  const st = actor.system.disciplines[key];
  const label = IROP.disciplines[key];
  const log = [...actor.system._source.xp.log, entry("awaken", `Awakened: ${label} rank 1`, 0, key, 1)];
  return actor.update({
    ...(await spendCrystals(actor, check.crystals)), "system.psi.awakened": true, "system.psi.freePower": true,
    [`system.paraphysics.${key}`]: Math.max(st.bought, 1), "system.xp.log": log
  });
}

/**
 * A power dropped on an operative in Play mode is learned (Rank 1): its discipline at its tier, a
 * slot free, and a psycrystal, or the awakening's free one. Returns the created item, or null.
 */
export async function learnPower(sheet, source, create) {
  const actor = sheet.actor;
  const p = source.system.paraphysics;
  const states = actor.system.disciplines ?? {};
  const inDiscipline = powersOf(actor).filter(i => i.system.paraphysics.discipline === p.discipline).length;
  const free = !!actor.system.psi?.freePower;
  if ( powersOf(actor).some(i => i.name === source.name) ) {
    ui.notifications.warn(`${actor.name} already knows ${source.name}.`);
    return null;
  }
  const check = checkPowerUnlock({ name: source.name, tier: p.tier, discipline: p.discipline, state: states[p.discipline],
    inDiscipline, crystals: crystalsOf(actor), free, enabled: actor.system.isParaphysical, learnable: p.learnable });
  if ( !check.ok ) {
    ui.notifications.warn(check.reason);
    return null;
  }
  const price = check.crystals ? "<strong>1 psycrystal</strong>" : "the free power from awakening";
  if ( !await confirm("Learn a power", `<p>Learn <strong>${esc(source.name)}</strong> (${esc(IROP.disciplines[p.discipline])}, tier ${p.tier}) for ${price}?</p>`) ) return null;
  const created = await create();
  const item = Array.isArray(created) ? created[0] : created;
  if ( !item ) return null;
  await item.update({ "system.paraphysics.rank": 1, "system.paraphysics.choice": "" });
  const log = [...actor.system._source.xp.log, check.crystals
    ? entry("crystal", `${item.name} learned`, 0, item.id, 1)
    : entry("awakenPower", `${item.name} learned, free from awakening`, 0, item.id, 1)];
  await actor.update({ "system.xp.log": log,
    ...(check.crystals ? await spendCrystals(actor, 1) : { "system.psi.freePower": false }) });
  return item;
}

/**
 * Undoing a paraphysics ledger line (GM): the XP or crystals come back and, if it is still the top
 * rank, the rank comes off. Adds to `update` and returns any items to delete.
 */
export function refundPsi(actor, e, update) {
  const remove = [];
  const items = [];
  if ( e.kind === "discipline" ) {
    const st = actor.system.disciplines?.[e.ref];
    if ( st && (st.rank === e.rank) ) update[`system.paraphysics.${e.ref}`] = Math.max(0, st.bought - 1);
  }
  else if ( e.kind === "power" ) {
    const item = actor.items.get(e.ref);
    if ( item && (item.system.paraphysics.rank === e.rank) ) items.push({ item, change: { "system.paraphysics.rank": e.rank - 1, ...((e.rank === 3) ? { "system.paraphysics.choice": "" } : {}) } });
  }
  else if ( e.kind === "crystal" ) {
    update["system.psi.crystals"] = (actor.system.psi.crystals ?? 0) + 1;
    const item = actor.items.get(e.ref);
    if ( item && (e.rank === 1) ) remove.push(item.id);
    else if ( item && (item.system.paraphysics.rank === e.rank) ) items.push({ item, change: { "system.paraphysics.rank": e.rank - 1 } });
  }
  else if ( e.kind === "awakenPower" ) {
    if ( actor.items.get(e.ref) ) remove.push(e.ref);
    update["system.psi.freePower"] = true;
  }
  else if ( e.kind === "awaken" ) {
    update["system.psi.crystals"] = (actor.system.psi.crystals ?? 0) + IROP.paraphysics.awakenCost;
    update["system.psi.awakened"] = false;
    update["system.psi.freePower"] = false;
    const st = actor.system.disciplines?.[e.ref];
    if ( st && (st.rank === 1) ) update[`system.paraphysics.${e.ref}`] = 0;
  }
  return { remove, items };
}

/** The ledger's amount for a crystal line: "1 psycrystal", "2 psycrystals", "free". */
export function crystalAmount(e) {
  if ( e.kind === "awakenPower" ) return "free";
  const n = (e.kind === "awaken") ? IROP.paraphysics.awakenCost : 1;
  return `${n} psycrystal${n === 1 ? "" : "s"}`;
}

import { IROP } from "../config.mjs";
import { ledgerWeeks, supportOptions, supportCost, supportMost, mortarStrikes, strikesOverlap } from "../rules/resources.mjs";
import { SCATTER } from "../rules/combat.mjs";
import { placeBlast, removeBlast, scatterBlast } from "../canvas/blast.mjs";
import { getWarRoom, getLedger, recordResource, undoResource, getStrategyRules } from "../settings.mjs";
import { rollDamage } from "../rolls.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const SUPPORT_CARD = "systems/irop/templates/chat/support-card.hbs";
const MORTAR_CARD = "systems/irop/templates/chat/mortar-card.hbs";

/**
 * The Resistance's Logistics and Intel (Strategy Layer step 3, 2026-10-08): the
 * ledger window, and Support in tactical battles. Players ask for Support and the
 * GM approves it in chat, since only a GM can spend from the world's stock, and the
 * doc leaves some of it (an Inside Job's price) to GM discretion.
 */

const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** Who is asking: the player's character, else the player. */
function requesterName(user = game.user) {
  return user?.character?.name ?? user?.name ?? "Someone";
}

/* -------------------------------------------- */
/*  The ledger window                           */
/* -------------------------------------------- */

/** The stock of Logistics and Intel, and every gain and spend that made it, week by week. */
export class ResourceLedger extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-resource-ledger",
    classes: ["irop", "irop-resource-ledger"],
    window: { title: "Logistics and Intel", icon: "fa-solid fa-boxes-stacked", resizable: true },
    // 80px wider for the larger text (Johnald, 2026-10-10).
    position: { width: 580, height: "auto" },
    actions: {
      record: ResourceLedger.#onRecord,
      undo: ResourceLedger.#onUndo,
      support: () => SupportApp.open()
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/resource-ledger.hbs", scrollable: [".rl-weeks"] }
  };

  static #instance = null;

  static open() {
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  static refresh() {
    if ( this.#instance?.rendered ) this.#instance.render();
  }

  /** @override */
  async _prepareContext(options) {
    const state = getWarRoom();
    return {
      week: state.week,
      stocks: Object.entries(IROP.resources).map(([key, r]) => ({ key, label: r.label, icon: r.icon, value: state[key] })),
      resources: Object.fromEntries(Object.entries(IROP.resources).map(([key, r]) => [key, r.label])),
      weeks: ledgerWeeks(getLedger()),
      isGM: !!game.user?.isGM
    };
  }

  /** Gain or spend what the GM entered. A spend past the stock offers to take what is left. */
  static async #onRecord(event, target) {
    const row = this.element.querySelector(".rl-entry");
    const resource = row.querySelector("[name=resource]").value;
    const amount = Math.abs(Math.round(Number(row.querySelector("[name=amount]").value) || 0));
    const reason = row.querySelector("[name=reason]").value;
    if ( !amount ) return ui.notifications.warn("Enter an amount.");
    const sign = (target.dataset.sign === "-") ? -1 : 1;
    let result = await recordResource({ resource, amount: sign * amount, reason });
    const stock = getWarRoom()[resource];
    if ( !result.ok && (sign < 0) && (stock > 0) ) {
      const label = IROP.resources[resource].label;
      const all = await DialogV2.confirm({
        window: { title: `Not enough ${label}` },
        content: `<p>Only ${stock} ${label} in stock. Spend all ${stock}?</p>`,
        rejectClose: false
      });
      if ( !all ) return null;
      result = await recordResource({ resource, amount: -amount, reason }, { clamp: true });
    }
    if ( !result.ok ) return ui.notifications.warn(result.reason);
    return result;
  }

  /** Take an entry out of the ledger, after a confirm. */
  static async #onUndo(event, target) {
    const id = target.closest("[data-entry-id]")?.dataset.entryId;
    const entry = getLedger().find(e => e.id === id);
    if ( !entry ) return null;
    const label = IROP.resources[entry.resource]?.label ?? "";
    const effect = (entry.amount < 0) ? `The ${-entry.amount} ${label} come back.` : `The ${entry.amount} ${label} come off the stock.`;
    const ok = await DialogV2.confirm({
      window: { title: "Undo this entry?" },
      content: `<p>Undo <strong>${escape(entry.reason)}</strong>? ${effect}</p>`,
      rejectClose: false
    });
    if ( !ok ) return null;
    const result = await undoResource(id);
    if ( !result.ok ) ui.notifications.warn(result.reason);
    return result;
  }
}

/* -------------------------------------------- */
/*  The Support window                          */
/* -------------------------------------------- */

/** Support in tactical battles: the five options, their price, and whether the stock covers it. */
export class SupportApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-support",
    classes: ["irop", "irop-support"],
    window: { title: "Support", icon: "fa-solid fa-tower-broadcast", resizable: true },
    // 80px wider for the larger text (Johnald, 2026-10-10).
    position: { width: 580, height: "auto" },
    actions: {
      call: SupportApp.#onCall,
      ledger: () => ResourceLedger.open()
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/support.hbs", scrollable: [".support-list"] }
  };

  static #instance = null;

  static open() {
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  static refresh() {
    if ( this.#instance?.rendered ) this.#instance.render();
  }

  /** @override */
  async _prepareContext(options) {
    const stock = getWarRoom().logistics;
    return { stock, options: supportOptions(getStrategyRules(), stock), isGM: !!game.user?.isGM };
  }

  static #onCall(event, target) {
    return callSupport(target.closest("[data-support]")?.dataset.support);
  }
}

/* -------------------------------------------- */
/*  Support in chat                             */
/* -------------------------------------------- */

/** What the Support card shows, from the message's flag. */
export function supportCardContext(support = {}) {
  const option = IROP.supportOptions[support.key] ?? {};
  const status = ["pending", "approved", "declined"].includes(support.status) ? support.status : "pending";
  const mortar = support.key === "mortarStrike";
  return {
    label: option.label ?? "Support",
    icon: option.icon ?? "fa-solid fa-tower-broadcast",
    effect: option.effect ?? "",
    cost: support.cost ?? 0,
    note: support.note ?? "",
    by: support.by ?? "",
    gm: !!support.gm,
    status,
    pending: status === "pending",
    approved: status === "approved",
    declined: status === "declined",
    left: support.left ?? 0,
    canFire: mortar && (status === "approved") && !support.fired,
    fired: mortar && !!support.fired
  };
}

function supportCardHTML(support) {
  return foundry.applications.handlebars.renderTemplate(SUPPORT_CARD, supportCardContext(support));
}

/** Spend a Support option's Logistics, with a ledger line saying what for and for whom. */
function spendOn(support) {
  const option = IROP.supportOptions[support.key];
  const reason = `${option.label}${support.note ? `: ${support.note}` : ""} (${support.by})`;
  return recordResource({ resource: "logistics", amount: -support.cost, reason });
}

/** The amount an Inside Job costs, asked in a dialog. Null if dismissed. */
async function askCost(option, { least, most, cost, title, lede = "", note = null, okLabel, okIcon }) {
  const noteField = (note === null) ? ""
    : `<label class="wide-field"><span>What is asked for</span><input type="text" name="note" value="${escape(note)}" placeholder="An unlocked door, a delayed response"></label>`;
  const data = await DialogV2.input({
    window: { title },
    classes: ["irop", "irop-support-dialog"],
    content: `${lede}${noteField}<label class="wide-field"><span>Logistics, ${least} to ${most}</span>
      <input type="number" name="cost" value="${cost}" min="${least}" max="${most}"></label>`,
    ok: { label: okLabel, icon: okIcon },
    rejectClose: false
  });
  return data ?? null;
}

/**
 * Call in Support. A GM spends the Logistics at once and posts the card as called
 * in; a player posts a request the GM approves or declines in chat.
 * @param {string} key    A key of IROP.supportOptions
 */
export async function callSupport(key) {
  const option = IROP.supportOptions[key];
  if ( !option ) return null;
  const rules = getStrategyRules();
  const isGM = !!game.user.isGM;
  let cost = supportCost(key, rules);
  const most = supportMost(key, rules);
  let note = "";
  if ( most > cost ) {
    const data = await askCost(option, {
      least: cost, most, cost, title: option.label, note: "",
      lede: `<p class="hint">${option.effect}</p>`,
      okLabel: isGM ? "Call it in" : "Request it", okIcon: option.icon
    });
    if ( !data ) return null;
    cost = supportCost(key, rules, data.cost);
    note = String(data.note ?? "").trim();
  }
  else if ( isGM ) {
    const ok = await DialogV2.confirm({
      window: { title: option.label },
      content: `<p>Call in ${option.label} for ${cost} Logistics?</p>`,
      rejectClose: false
    });
    if ( !ok ) return null;
  }
  const stock = getWarRoom().logistics;
  if ( stock < cost ) return ui.notifications.warn(`${option.label} needs ${cost} Logistics; ${stock} in stock.`);

  let support = { key, cost, note, by: requesterName(), status: "pending", gm: isGM };
  if ( isGM ) {
    const result = await spendOn(support);
    if ( !result.ok ) return ui.notifications.warn(result.reason);
    support = { ...support, status: "approved", left: result.totals.logistics, entryId: result.entry.id };
  }
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker(),
    content: await supportCardHTML(support),
    flags: { irop: { support } }
  });
}

/** The GM approves a request: the Logistics are spent and the card says so. An Inside Job's price is set here. */
export async function approveSupport(message) {
  if ( !game.user.isGM ) return null;
  const support = message.getFlag("irop", "support");
  if ( support?.status !== "pending" ) return null;
  const option = IROP.supportOptions[support.key];
  if ( !option ) return null;
  const rules = getStrategyRules();
  let cost = supportCost(support.key, rules, support.cost);
  const least = supportCost(support.key, rules);
  const most = supportMost(support.key, rules);
  if ( most > least ) {
    const data = await askCost(option, {
      least, most, cost, title: `Approve ${option.label}`,
      lede: support.note ? `<p>${escape(support.by)} asks for: <strong>${escape(support.note)}</strong></p>` : "",
      okLabel: "Approve", okIcon: "fa-solid fa-check"
    });
    if ( !data ) return null;
    cost = supportCost(support.key, rules, data.cost);
  }
  const result = await spendOn({ ...support, cost });
  if ( !result.ok ) return ui.notifications.warn(result.reason);
  const next = { ...support, cost, status: "approved", left: result.totals.logistics, entryId: result.entry.id };
  return message.update({ content: await supportCardHTML(next), "flags.irop.support": next });
}

/** The GM turns a request down; nothing is spent. */
export async function declineSupport(message) {
  if ( !game.user.isGM ) return null;
  const support = message.getFlag("irop", "support");
  if ( support?.status !== "pending" ) return null;
  const next = { ...support, status: "declined" };
  return message.update({ content: await supportCardHTML(next), "flags.irop.support": next });
}

/** What a Mortar Strike card says about its blast markers, if it set any down. */
function markerNote(strikes = []) {
  if ( !strikes.some(s => s.blast) ) return "";
  const stuck = strikes.filter(s => s.scatters && s.blast && (s.marker !== "moved")).map(s => `Strike ${s.n}`);
  const moved = strikes.some(s => s.marker === "moved");
  let note = moved ? "The blast markers are on the map; the strikes that scattered have moved where they land."
    : "The blast markers are on the map.";
  if ( stuck.length ) note += ` ${stuck.join(" and ")} could not move its marker: place that blast by hand.`;
  return note;
}

/** What the Mortar Strike card shows. */
export function mortarCardContext(strikes) {
  const m = IROP.mortarStrike;
  return {
    strikes,
    markerNote: markerNote(strikes),
    damage: m.damage,
    damageType: IROP.damageTypes[m.damageType]?.label ?? m.damageType,
    radius: m.radius,
    destruction: m.destruction,
    scatterOn: m.scatterOn,
    scatter: m.scatter
  };
}

/** Mortar Strikes being set down on the map right now, by message id: a second press waits. */
const firing = new Set();

/** A marker's circle, its center and radius, for the overlap check. */
function markerCircle(marker) {
  const shape = (marker?.toObject?.().shapes ?? marker?.shapes ?? [])[0] ?? {};
  return { x: Number(shape.x) || 0, y: Number(shape.y) || 0, radius: Number(shape.radius) || 0 };
}

/**
 * Set the strikes down on the map (Johnald, 2026-10-10: blast markers for the mortars), one at
 * a time, each a circle of the strike's radius. The doc wants three areas that do not overlap,
 * so one set down over another is taken up again to be placed anew. Backing out of any calls
 * the whole strike off, and takes up those already down.
 * @returns {Promise<(RegionDocument|null)[]|null>}  A marker per strike (null where none can be
 *   placed, with no scene on screen); null if the strike was called off.
 */
export async function placeMortarStrikes(count = IROP.mortarStrike.strikes) {
  const m = IROP.mortarStrike;
  const markers = [];
  for ( let n = 1; n <= count; n++ ) {
    let marker;
    for ( ;; ) {
      marker = await placeBlast({ name: `Mortar Strike ${n}`, radius: m.radius, template: "circle" });
      if ( !marker ) break;
      const over = markers.findIndex(o => o && strikesOverlap(markerCircle(o), markerCircle(marker)));
      if ( over < 0 ) break;
      await removeBlast(marker);
      ui.notifications?.warn(`Strike ${n} overlaps Strike ${over + 1}: the three areas must not overlap. Set it down again.`);
    }
    if ( marker === null ) {
      for ( const o of markers ) await removeBlast(o);
      return null;
    }
    markers.push(marker ?? null);
  }
  return markers;
}

/**
 * Fire an approved Mortar Strike (doc): three d100s, and any of 75 or more scatters
 * 1d4 tiles, in a direction from the canon 1d8. Each strike gets its own Damage button.
 * The strikes are set down on the map first, and a strike that scatters moves its marker
 * where it lands (2026-10-10).
 */
export async function fireMortar(message) {
  const support = message.getFlag("irop", "support");
  if ( (support?.key !== "mortarStrike") || (support.status !== "approved") || support.fired ) return null;
  if ( firing.has(message.id) ) return null;
  firing.add(message.id);
  try {
    const markers = await placeMortarStrikes();
    if ( !markers ) {
      ui.notifications?.info("Mortar Strike called off: nothing fired. Fire the strikes again when ready.");
      return null;
    }
    // Fired by someone else while these were being set down.
    if ( message.getFlag("irop", "support")?.fired ) {
      for ( const o of markers ) await removeBlast(o);
      return null;
    }
    const m = IROP.mortarStrike;
    const Roll = foundry.dice.Roll;
    const rolls = [];
    for ( let i = 0; i < m.strikes; i++ ) rolls.push(await new Roll("1d100").evaluate());
    const strikes = mortarStrikes(rolls.map(r => r.total), m.scatterOn);
    for ( const s of strikes ) {
      if ( markers[s.n - 1] ) s.blast = markers[s.n - 1].uuid;
      if ( !s.scatters ) continue;
      const dir = await new Roll("1d8").evaluate();
      const dist = await new Roll(m.scatter).evaluate();
      rolls.push(dir, dist);
      Object.assign(s, { direction: SCATTER.directions[dir.total - 1], distance: dist.total, tiles: (dist.total === 1) ? "tile" : "tiles" });
      if ( s.blast ) {
        const result = await scatterBlast(s.blast, dir.total, dist.total);
        s.marker = result.moved ? "moved" : result.reason;
      }
    }
    const fired = { ...support, fired: true };
    await message.update({ content: await supportCardHTML(fired), "flags.irop.support": fired });
    return ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker(),
      content: await foundry.applications.handlebars.renderTemplate(MORTAR_CARD, mortarCardContext(strikes)),
      rolls,
      flags: { irop: { mortar: { strikes } } }
    });
  }
  finally {
    firing.delete(message.id);
  }
}

/**
 * One strike's attack, as an explosive with the doc's Destructive 6, carrying its blast marker
 * (from the Mortar Strike card's flag) so the damage card can clear it.
 */
export function mortarAttack(n, message = null) {
  const m = IROP.mortarStrike;
  const strike = (message?.getFlag?.("irop", "mortar")?.strikes ?? []).find(s => s.n === n);
  return {
    actorUuid: null,
    itemName: `Mortar Strike ${n}`,
    damage: { formula: m.damage, type: m.damageType, destruction: m.destruction },
    blast: strike?.blast ? { uuid: strike.blast } : null
  };
}

/** One strike's damage. */
export function mortarDamage(n, message = null) {
  return rollDamage(mortarAttack(n, message));
}

/* -------------------------------------------- */

/** A Support button in the Actors sidebar header, beside Banks: it is called in mid mission. */
export function addSupportButton(app, html) {
  const root = html?.querySelector ? html : html?.[0];
  const actions = root?.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".irop-support-button") ) return;
  const button = root.ownerDocument.createElement("button");
  button.type = "button";
  button.className = "irop-support-button";
  button.innerHTML = `<i class="fa-solid fa-tower-broadcast"></i> Support`;
  button.addEventListener("click", () => SupportApp.open());
  actions.append(button);
}

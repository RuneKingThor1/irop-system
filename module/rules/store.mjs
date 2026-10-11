import { IROP } from "../config.mjs";
import { isStackable } from "./stacks.mjs";

/**
 * Stores (Johnald, 2026-10-10): what an item costs there, whether a purchase or a sale can
 * go ahead, and what a bought item looks like on the buyer's sheet. Kept apart from Foundry
 * so it can be tested on its own.
 */

/** Items a store can sell, and buy back: the carried kinds. */
export const PHYSICAL_TYPES = ["weapon", "armor", "gear", "mod"];

/** The currencies, keyed as in an operative's system.wealth. */
export const CURRENCY_KEYS = ["credits", "valuables", "alloys"];

/** Whether an item is a carried thing a store deals in. */
export function isPhysical(item) {
  return PHYSICAL_TYPES.includes(item?.type);
}

/** An item's own price in a currency (before any markup); 0 when it has none there. */
export function priceIn(item, currency) {
  return Math.max(0, Math.floor(Number(item?.system?.prices?.[currency]) || 0));
}

/**
 * Whether a currency may buy an item (Johnald, 2026-10-10): ticked on the item, and priced in
 * it. A currency left at 0 is no price, so items are not free in the currencies nobody set.
 */
export function accepts(item, currency) {
  return CURRENCY_KEYS.includes(currency) && (item?.system?.accepts?.[currency] !== false) && (priceIn(item, currency) > 0);
}

/** The currencies that may buy an item, in the sheet's order. */
export function acceptedCurrencies(item) {
  return CURRENCY_KEYS.filter(c => accepts(item, c));
}

/**
 * The currency a purchase is paid in: the one the player chose, if the item takes it; else the
 * store's preferred; else the first the item takes. Null when nothing buys it.
 */
export function payCurrency(item, preferred = "credits", chosen = null) {
  const ok = acceptedCurrencies(item);
  if ( chosen && ok.includes(chosen) ) return chosen;
  if ( ok.includes(preferred) ) return preferred;
  return ok[0] ?? null;
}

/**
 * The currency a store pays in when it buys an item back: its preferred, if the item has a price
 * in it; else the first the item has one in. The ticks are about buying, not selling.
 */
export function sellCurrency(item, preferred = "credits") {
  if ( priceIn(item, preferred) > 0 ) return preferred;
  return CURRENCY_KEYS.find(c => priceIn(item, c) > 0) ?? null;
}

/** Where a currency sits on an operative. */
export function walletPath(currency) {
  return `system.wealth.${CURRENCY_KEYS.includes(currency) ? currency : "credits"}`;
}

/** How much of a currency an operative holds. */
export function walletOf(actor, currency) {
  return Math.max(0, Number(actor?.system?.wealth?.[CURRENCY_KEYS.includes(currency) ? currency : "credits"]) || 0);
}

/**
 * The shelf facts kept on an item in a store: whether its stock is limited, how many are
 * left, and whether it is hidden from players.
 * @returns {{limited: boolean, stock: number, hidden: boolean}}
 */
export function shelfOf(item) {
  const s = item?.flags?.irop?.shelf ?? {};
  return { limited: !!s.limited, stock: Math.max(0, Math.floor(Number(s.stock) || 0)), hidden: !!s.hidden };
}

/** A store's price for an item: its own price with the store's markup, rounded, never below 0. */
export function storePrice(price, markup = 0) {
  const base = Math.max(0, Number(price) || 0);
  return Math.max(0, Math.round((base * (100 + (Number(markup) || 0))) / 100));
}

/** What a store pays for one of an item: its price times the buy back share, rounded down. */
export function buyBackPrice(price, sellBack = 0) {
  const share = Math.max(0, Math.min(100, Number(sellBack) || 0));
  return Math.max(0, Math.floor((Math.max(0, Number(price) || 0) * share) / 100));
}

/** A price as it reads: "25 cr", "4 Valuables", "2 Alloys". */
export function priceText(amount, currency = "credits") {
  const c = IROP.currencies[currency] ?? IROP.currencies.credits;
  return `${amount} ${c.short}`;
}

/** A whole number of at least one, from what was typed. */
function count(qty) {
  return Math.floor(Number(qty) || 0);
}

/**
 * Whether a purchase can go ahead, and what it costs in all.
 * @param {object} input
 * @param {number} input.unitPrice     The store's price for one
 * @param {number} input.qty           How many
 * @param {number} input.wallet        What the buyer holds of the price's currency
 * @param {object} input.shelf         From shelfOf
 * @param {boolean} [input.isGM]       A GM may buy what is hidden
 * @param {string} [input.name]        The item's name, for the message
 * @param {string} [input.currency]
 * @returns {{ok: boolean, total: number, error?: string}}
 */
export function checkPurchase({ unitPrice, qty, wallet, shelf, isGM = false, name = "That", currency = "credits" }) {
  const n = count(qty);
  if ( n < 1 ) return { ok: false, total: 0, error: "Buy at least one." };
  if ( shelf?.hidden && !isGM ) return { ok: false, total: 0, error: `${name} is not for sale.` };
  if ( shelf?.limited && (shelf.stock < n) ) {
    return { ok: false, total: 0, error: shelf.stock ? `Only ${shelf.stock} ${name} left.` : `${name} is sold out.` };
  }
  const total = Math.max(0, Number(unitPrice) || 0) * n;
  const held = Math.max(0, Number(wallet) || 0);
  if ( held < total ) {
    const label = (IROP.currencies[currency] ?? IROP.currencies.credits).label;
    return { ok: false, total, error: `Not enough ${label}: ${total} needed, ${held} on hand.` };
  }
  return { ok: true, total };
}

/**
 * Why an item cannot be sold, if it cannot: not a carried thing, worth nothing, or fitted to
 * or loaded in something else.
 * @returns {string}   Empty when it can be sold
 */
export function unsellable(item) {
  if ( !isPhysical(item) ) return "Only weapons, armor, gear and mods can be sold.";
  const s = item.system ?? {};
  if ( !CURRENCY_KEYS.some(c => priceIn(item, c) > 0) ) return `${item.name} has no price, so no store will pay for it.`;
  if ( (item.type === "mod") && s.installedOn ) return `${item.name} is fitted to a weapon or armor. Take it off first.`;
  if ( (item.type === "gear") && s.loadedIn ) return `${item.name} is loaded in a weapon. Unload it first.`;
  return "";
}

/**
 * Whether a sale can go ahead, and what the store pays, in which currency (its preferred, if
 * the item has a price in it).
 * @returns {{ok: boolean, unit: number, total: number, currency: string|null, error?: string}}
 */
export function checkSale({ item, qty, sellBack, preferred = "credits" }) {
  const no = error => ({ ok: false, unit: 0, total: 0, currency: null, error });
  if ( !(Number(sellBack) > 0) ) return no("This store does not buy.");
  const why = unsellable(item);
  if ( why ) return no(why);
  const n = count(qty);
  const held = Math.max(0, Math.floor(Number(item.system.quantity) || 0));
  if ( n < 1 ) return no("Sell at least one.");
  if ( n > held ) return no(`${item.name}: only ${held} to sell.`);
  const currency = sellCurrency(item, preferred);
  const unit = buyBackPrice(priceIn(item, currency), sellBack);
  if ( unit < 1 ) return { ...no(`${item.name} is worth nothing here.`), unit };
  return { ok: true, unit, total: unit * n, currency };
}

/**
 * An item as it goes onto a shelf: one of it, not worn or stowed, nothing fitted or loaded,
 * unlimited and on show until the GM says otherwise.
 * @param {object} data   The item's data (toObject)
 */
export function shelfData(data) {
  const out = structuredClone(data);
  delete out._id;
  out.system ??= {};
  // The store has as many as were put on it (bug, Johnald, 2026-10-10: "multiples purchased when a
  // shop might not have that many items"): a stack of three grenades is three in stock, a rifle one.
  // The GM can still make it unlimited, for what the store never runs out of.
  const stock = Math.max(1, Math.floor(Number(out.system.quantity) || 1));
  Object.assign(out.system, { quantity: 1, equipped: false, stowed: false });
  if ( out.type === "mod" ) out.system.installedOn = "";
  if ( out.type === "gear" ) out.system.loadedIn = "";
  if ( Array.isArray(out.system.loaded) ) out.system.loaded = [];
  out.flags ??= {};
  out.flags.irop = { ...(out.flags.irop ?? {}), shelf: { limited: true, stock, hidden: false } };
  return out;
}

/**
 * What a purchase puts on the buyer's sheet: the shelf item without its shelf facts. Things
 * counted (gear, grenades, rockets, explosives, the LAW) come as one item of that many, to join
 * a stack of the same name; anything else comes as that many items, one each.
 * @param {object} data   The shelf item's data (toObject)
 * @param {number} qty
 * @returns {{stackable: boolean, items: object[]}}
 */
export function purchaseData(data, qty) {
  const n = Math.max(1, count(qty));
  const base = structuredClone(data);
  delete base._id;
  if ( base.flags?.irop ) {
    delete base.flags.irop.shelf;
    if ( !Object.keys(base.flags.irop).length ) delete base.flags.irop;
  }
  base.system ??= {};
  Object.assign(base.system, { equipped: false, stowed: false });
  const stackable = isStackable(base);
  if ( stackable ) return { stackable, items: [{ ...base, system: { ...base.system, quantity: n } }] };
  return { stackable, items: Array.from({ length: n }, () => structuredClone({ ...base, system: { ...base.system, quantity: 1 } })) };
}

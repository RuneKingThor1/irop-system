import { IROP } from "./config.mjs";
import { registerAction, asGM } from "./socket.mjs";
import { isStackable, stackFor } from "./rules/stacks.mjs";
import {
  shelfOf, storePrice, priceIn, payCurrency, walletOf, walletPath, priceText,
  checkPurchase, checkSale, shelfData, purchaseData
} from "./rules/store.mjs";

/**
 * Stores (Johnald, 2026-10-10): buying is at once, and the price comes off the buyer's sheet.
 * An item in unlimited supply is bought by the buyer's own client, which may write its own
 * character; one with limited stock is bought on the active GM's client, the only one that
 * may count the store's stock down, so two players cannot both get the last one. Selling
 * back touches only the seller's sheet, so it is always done where it is asked.
 */

const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** Deals run one after another on a client, so two for the last one cannot both get it. */
let queue = Promise.resolve();
function inTurn(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => null);
  return run;
}

/** Whether a user may spend an operative's money: its owner, or a GM. */
function mayAct(user, actor) {
  return !!user?.isGM || !!actor?.testUserPermission?.(user, "OWNER");
}

/** Put an item on a store's shelf: one of it, unlimited and on show until the GM says otherwise. */
export function stockShelf(store, data) {
  return store.createEmbeddedDocuments("Item", [shelfData(data)]);
}

/**
 * Buy from a store, from the shelf item's row.
 * @param {object} input
 * @param {Actor} input.store
 * @param {Item} input.item         The shelf item
 * @param {Actor} input.buyer       The operative paying
 * @param {number} [input.qty]
 * @param {string} [input.currency]  What the player pays with; the store's preferred if not said
 */
export async function buyFromStore({ store, item, buyer, qty = 1, currency = null }) {
  const payload = { storeUuid: store.uuid, itemId: item.id, buyerUuid: buyer?.uuid ?? "", qty: Math.floor(Number(qty) || 0), currency };
  if ( shelfOf(item).limited && !game.user.isGM ) {
    return asGM("storeBuy", payload, { offline: "No GM is connected. Items in limited stock need one online to count them down." });
  }
  const result = await performPurchase(payload, game.user);
  if ( result?.error ) ui.notifications.warn(result.error);
  return result;
}

/**
 * Carry out a purchase: check it, take the price from the buyer, give them the goods, count
 * the stock down if it is limited, and say so in chat. Runs on the buyer's client, or on the
 * GM's for limited stock.
 * @param {{storeUuid: string, itemId: string, buyerUuid: string, qty: number}} payload
 * @param {User} user   Who asked
 * @returns {Promise<{error?: string, notice?: string}>}
 */
export function performPurchase({ storeUuid, itemId, buyerUuid, qty, currency: chosen = null }, user) {
  return inTurn(async () => {
    const store = foundry.utils.fromUuidSync(storeUuid);
    if ( store?.type !== "store" ) return { error: "That store is gone." };
    const item = store.items.get(itemId);
    if ( !item ) return { error: "That is no longer on the shelf." };
    const buyer = buyerUuid ? foundry.utils.fromUuidSync(buyerUuid) : null;
    if ( buyer?.type !== "operative" ) return { error: "Choose a character to buy with." };
    if ( !mayAct(user, buyer) ) return { error: `${user.name} cannot spend ${buyer.name}'s money.` };
    const shelf = shelfOf(item);
    // Paid in what the player chose, if the item takes it; else the store's preferred (2026-10-10).
    const currency = payCurrency(item, store.system.preferred, chosen);
    if ( !currency ) return { error: `${item.name} has no price here.` };
    if ( chosen && (currency !== chosen) ) return { error: `${item.name} cannot be bought with ${IROP.currencies[chosen]?.label ?? chosen}.` };
    const unit = storePrice(priceIn(item, currency), store.system.markup);
    const held = walletOf(buyer, currency);
    const check = checkPurchase({ unitPrice: unit, qty, wallet: held, shelf, isGM: !!user.isGM, name: item.name, currency });
    if ( !check.ok ) return { error: check.error };
    const n = Math.floor(Number(qty));
    await buyer.update({ [walletPath(currency)]: held - check.total });
    const given = await giveItems(buyer, item, n);
    // The stock last: the store's sheet redraws on it, by then showing the buyer's new purse.
    if ( shelf.limited ) await item.update({ "flags.irop.shelf.stock": shelf.stock - n });
    await postDeal({ kind: "buy", who: buyer, store, name: item.name, img: item.img, qty: n, total: check.total, currency,
      undo: { shelfItemId: item.id, limited: !!shelf.limited, given } });
    return { notice: `bought ${n} ${item.name} from ${store.name}.` };
  });
}

/**
 * Give a bought item to the buyer: counted things join a stack of the same name, anything else
 * comes as that many items.
 * @returns {Promise<{id: string, count: number, after: number}[]>}  What was given where, and how many
 *   each then held, so it can be refunded while none of it has been used
 */
export async function giveItems(buyer, shelfItem, n) {
  const { stackable, items } = purchaseData(shelfItem.toObject(), n);
  if ( stackable ) {
    const stack = stackFor(buyer.items, items[0]);
    if ( stack ) {
      const after = (Number(stack.system.quantity) || 0) + n;
      await stack.update({ "system.quantity": after });
      return [{ id: stack.id, count: n, after }];
    }
  }
  const created = await buyer.createEmbeddedDocuments("Item", items);
  return (created ?? []).map(i => {
    const count = Number(i.system?.quantity) || 1;
    return { id: i.id ?? i._id ?? "", count, after: count };
  });
}

/**
 * Sell an item from an operative's sheet to a store, for the store's share of its price, paid
 * in the store's preferred currency (or the item's first priced one, if it has no price there).
 * @param {object} input
 * @param {Actor} input.store
 * @param {Item} input.item      The seller's item
 * @param {Actor} input.seller
 * @param {number} [input.qty]
 */
export function sellToStore({ store, item, seller, qty = 1 }) {
  return inTurn(async () => {
    if ( !mayAct(game.user, seller) ) {
      ui.notifications.warn(`You cannot sell ${seller?.name ?? "that character"}'s things.`);
      return null;
    }
    const check = checkSale({ item, qty, sellBack: store.system.sellBack, preferred: store.system.preferred });
    if ( !check.ok ) {
      ui.notifications.warn(check.error);
      return null;
    }
    const n = Math.floor(Number(qty));
    const currency = check.currency;
    const { name, img } = item;
    // What was sold, as it was, so it can be bought back (2026-10-10).
    const itemData = item.toObject();
    for ( const key of ["_id", "folder", "sort"] ) delete itemData[key];
    foundry.utils.setProperty(itemData, "system.quantity", n);
    await seller.update({ [walletPath(currency)]: walletOf(seller, currency) + check.total });
    const left = (Number(item.system.quantity) || 0) - n;
    if ( left > 0 ) await item.update({ "system.quantity": left });
    else await item.delete();
    await postDeal({ kind: "sell", who: seller, store, name, img, qty: n, total: check.total, currency, undo: { itemData } });
    return check;
  });
}

/** The chat line for a deal, in the operative's name, with its undo button: Refund, or Buy back. */
export function dealHTML({ kind, who, store, name, img, qty, total, currency }) {
  const buying = kind === "buy";
  const what = `${qty} &times; ${escape(name)}`;
  const line = buying
    ? `<strong>${escape(who.name)}</strong> bought <strong>${what}</strong> for <strong>${priceText(total, currency)}</strong>.`
    : `<strong>${escape(who.name)}</strong> sold <strong>${what}</strong> for <strong>${priceText(total, currency)}</strong>.`;
  const undo = buying
    ? `<button type="button" data-irop-action="storeUndo" data-tooltip="Bought by mistake? Give it back for everything paid"><i class="fa-solid fa-rotate-left"></i> Refund</button>`
    : `<button type="button" data-irop-action="storeUndo" data-tooltip="Sold by mistake? Pay back what the store paid to have it again"><i class="fa-solid fa-rotate-left"></i> Buy back</button>`;
  return `<div class="irop-card store-card ${buying ? "buy" : "sell"}">
    <header class="card-head"><h3><i class="fa-solid ${buying ? "fa-cart-shopping" : "fa-hand-holding-dollar"}"></i> ${buying ? "Purchase" : "Sale"}</h3><span class="card-sub">${escape(store.name)}</span></header>
    <p class="store-deal">${img ? `<img src="${escape(img)}" alt="">` : ""}<span>${line}</span></p>
    <div class="card-buttons">${undo}</div></div>`;
}

/**
 * Post a deal's card. Its flags hold what it takes to undo it (Johnald, 2026-10-10: "a refund or
 * buyback option incase someone does something by accident").
 */
function postDeal(deal) {
  const { kind, who, store, qty, total, currency, undo = {} } = deal;
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: who }),
    content: dealHTML(deal),
    flags: { irop: { storeDeal: { kind, whoUuid: who.uuid, storeUuid: store.uuid, name: deal.name, qty, total, currency, ...undo } } }
  });
}

/**
 * Undo a deal from its card, after a word to be sure: a purchase refunded in full (the goods
 * back, every coin returned, limited stock counted back up), or a sale bought back for what the
 * store paid. Only the character's player or a GM, once, and only while the goods are still
 * carried in full (so nothing used can be refunded) or the money is still on hand. Done on the
 * GM's client when it touches the store's stock or a card the player did not post.
 * @param {ChatMessage} message
 */
export async function undoDeal(message) {
  const deal = message.flags?.irop?.storeDeal;
  if ( !deal || deal.undone ) return null;
  const who = foundry.utils.fromUuidSync(deal.whoUuid);
  const buying = deal.kind === "buy";
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: buying ? "Refund" : "Buy back" },
    content: buying
      ? `<p>Give back ${deal.qty} &times; ${escape(deal.name)} from ${escape(who?.name ?? "the buyer")}, for the ${priceText(deal.total, deal.currency)} paid?</p>`
      : `<p>Buy back ${deal.qty} &times; ${escape(deal.name)} for ${escape(who?.name ?? "the seller")}, paying the ${priceText(deal.total, deal.currency)} the store gave?</p>`
  });
  if ( !ok ) return null;
  if ( !game.user.isGM && ((buying && deal.limited) || !message.isAuthor) ) {
    return asGM("storeUndo", { messageId: message.id }, { offline: "No GM is connected. Undoing this deal needs one online." });
  }
  const result = await performUndo(message, game.user);
  if ( result?.error ) ui.notifications.warn(result.error);
  return result;
}

/** Carry out an undo (see undoDeal), on whichever client may write all it touches. */
export function performUndo(message, user) {
  return inTurn(async () => {
    const deal = message?.flags?.irop?.storeDeal;
    if ( !deal ) return { error: "That deal is gone." };
    if ( deal.undone ) return { error: "That deal has been undone already." };
    const who = foundry.utils.fromUuidSync(deal.whoUuid);
    if ( !who ) return { error: "That character is gone." };
    if ( !mayAct(user, who) ) return { error: `${user.name} cannot undo ${who.name}'s deal.` };
    if ( deal.kind === "buy" ) {
      // Every one still there: a stack it joined holds at least what it held just after (a counted
      // thing is all alike, so any used since, old or new, stops the refund).
      const parts = (deal.given ?? []).map(g => ({ g, item: who.items.get(g.id) }));
      if ( !parts.length || parts.some(({ g, item }) => !item || ((Number(item.system?.quantity) || 1) < (g.after ?? g.count))) ) {
        return { error: `${who.name} no longer carries all of the ${deal.name} bought, so it cannot be refunded.` };
      }
      for ( const { g, item } of parts ) {
        const left = (Number(item.system?.quantity) || 1) - g.count;
        if ( left > 0 ) await item.update({ "system.quantity": left });
        else await item.delete();
      }
      await who.update({ [walletPath(deal.currency)]: walletOf(who, deal.currency) + deal.total });
      if ( deal.limited ) {
        const shelfItem = foundry.utils.fromUuidSync(deal.storeUuid)?.items?.get(deal.shelfItemId);
        if ( shelfItem ) await shelfItem.update({ "flags.irop.shelf.stock": shelfOf(shelfItem).stock + deal.qty });
      }
    }
    else {
      const held = walletOf(who, deal.currency);
      if ( held < deal.total ) return { error: `${who.name} needs ${priceText(deal.total, deal.currency)} to buy the ${deal.name} back.` };
      if ( !deal.itemData ) return { error: "What was sold is not on the card, so it cannot be bought back." };
      await who.update({ [walletPath(deal.currency)]: held - deal.total });
      const stack = isStackable(deal.itemData) ? stackFor(who.items, deal.itemData) : null;
      if ( stack ) await stack.update({ "system.quantity": (Number(stack.system.quantity) || 0) + deal.qty });
      else await who.createEmbeddedDocuments("Item", [deal.itemData]);
    }
    await message.update({ "flags.irop.storeDeal.undone": true });
    return { notice: (deal.kind === "buy") ? `refunded ${deal.qty} ${deal.name}.` : `bought back ${deal.qty} ${deal.name}.` };
  });
}

/**
 * What players may ask the GM's client to do at a store: buy what is in limited stock, and undo
 * a deal that touches the store's stock or a card they did not post. Called once, at init.
 */
export function registerStoreActions() {
  registerAction("storeBuy", (payload, user) => performPurchase(payload, user));
  registerAction("storeUndo", (payload, user) => performUndo(game.messages?.get(payload.messageId), user));
}

/** The labels for a store's purse line. */
export function walletRows(actor) {
  return Object.entries(IROP.currencies).map(([key, c]) => ({ key, label: c.label, value: walletOf(actor, key) }));
}

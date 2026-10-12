import { IROP } from "../config.mjs";
import { cardRules, effectOps, effectLedger, describeEffects, inPlayLabel, spreadOps } from "../rules/events.mjs";
import { resolvePlan } from "../rules/turn.mjs";
import { getWarRoom, getStrategyRules, recordResource } from "../settings.mjs";

/**
 * Event and Dark Event cards in Foundry's own card stacks (Strategy Layer step 6,
 * 2026-10-08): two decks, the cards in play, the GENESIS hand and a discard pile, each
 * found by its flag. Advance week deals from them (strategy/turn.mjs); the Events
 * window plays, discards and reshuffles. Everything here is the GM's.
 */

const CARDS = "systems/irop/templates/chat";

/** One of the War Room's card stacks, by role (IROP.cardStacks). */
export function stack(role) {
  return game.cards?.find?.(c => c.getFlag?.("irop", "stack") === role) ?? null;
}

/** Whether every stack exists. */
export function decksReady() {
  return Object.keys(IROP.cardStacks).every(role => !!stack(role));
}

/** The stacks the turn cannot run without; the World Event deck came later and is optional. */
const CORE = ["eventDeck", "darkDeck", "inPlay", "darkHand", "discard"];

/** A kind's deck, by role. */
export function deckRole(kind) {
  return { event: "eventDeck", dark: "darkDeck", world: "worldDeck" }[kind] ?? "eventDeck";
}

/**
 * Whether Foundry knows the Event card type. It learns a new type only when the world is
 * launched, so straight after an update it may not yet (seen 2026-10-08).
 */
export function cardTypeReady() {
  const types = game.documentTypes?.Card;
  return !Array.isArray(types) || types.includes("event");
}

function needCardType() {
  if ( cardTypeReady() ) return true;
  ui.notifications.error("Foundry has not loaded the Event card type yet. Return to Setup and launch the world again, then try once more.", { permanent: true });
  return false;
}

/** A card as the rules take it, with where and when it landed. */
export function plainCard(card) {
  return {
    id: card.id, name: card.name, img: card.faces?.[0]?.img || card.img, system: card.system,
    territory: card.getFlag?.("irop", "territory") ?? "", week: card.getFlag?.("irop", "week") ?? 0,
    description: card.description ?? ""
  };
}

/** The stacks' cards for the turn plan; null decks when there are none. */
export function cardsForPlan() {
  if ( !CORE.every(role => !!stack(role)) ) return null;
  return {
    inPlay: stack("inPlay").cards.contents.map(plainCard),
    held: stack("darkHand").cards.contents.map(plainCard),
    eventDeck: stack("eventDeck").availableCards.map(plainCard),
    darkDeck: stack("darkDeck").availableCards.map(plainCard),
    worldDeck: stack("worldDeck")?.availableCards.map(plainCard) ?? null
  };
}

/** The cards in play on a territory. */
export function cardsOn(territoryId) {
  return (stack("inPlay")?.cards.contents ?? []).filter(c => c.getFlag("irop", "territory") === territoryId);
}

/** Cards in play the players can answer with a Tactical Action (doc: Respond to Events and Dark Events). */
export function responseChoices() {
  return (stack("inPlay")?.cards.contents ?? []).filter(c => cardRules(c).respond).map(c => ({
    id: `card:${c.id}`, label: `Respond: ${c.name}`, territory: c.getFlag("irop", "territory") ?? "",
    rewards: "Answer it before it leaves play; a success counters it.", heat: "minor"
  }));
}

/** Whether a Reprisal is in play. Doc: only one at a time. */
export function reprisalInPlay() {
  return (stack("inPlay")?.cards.contents ?? []).some(c => cardRules(c).reprisal);
}

/* -------------------------------------------- */
/*  Setting up                                  */
/* -------------------------------------------- */

/**
 * Make any missing stack: the two decks and the GENESIS hand are the GM's; the cards
 * in play and the discard pile can be seen by everyone.
 */
export async function setupDecks() {
  if ( !game.user.isGM ) return null;
  const made = [];
  const Cards = CONFIG.Cards.documentClass;
  for ( const [role, def] of Object.entries(IROP.cardStacks) ) {
    if ( stack(role) ) continue;
    const open = ["inPlay", "discard"].includes(role);
    made.push(await Cards.create({
      name: def.name, type: def.type,
      img: def.kind ? IROP.cardKinds[def.kind].back : "icons/svg/card-hand.svg",
      ownership: { default: open ? CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER : CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: { irop: { stack: role } }
    }));
  }
  if ( made.length ) ui.notifications.info(`Made the card stacks: ${made.map(m => m.name).join(", ")}. They are in the Cards sidebar.`);
  return made;
}

/** A new card in a deck, its sheet opened to write it. */
export async function newCard(kind = "event") {
  if ( !game.user.isGM || !needCardType() ) return null;
  await setupDecks();
  const deck = stack(deckRole(kind));
  const back = IROP.cardKinds[kind].back;
  const label = IROP.cardKinds[kind].label;
  const [card] = await deck.createEmbeddedDocuments("Card", [{
    name: `New ${label.toLowerCase()}`, type: "event", system: { kind },
    faces: [{ name: `New ${label.toLowerCase()}`, img: back, text: "" }], face: null, back: { img: back }
  }]);
  card?.sheet?.render({ force: true });
  return card;
}

/**
 * Shuffle a deck's discards back in (doc: a deck runs out; the GM reshuffles). Cards
 * still in play or in the GENESIS hand stay where they are.
 */
export async function reshuffle(kind = "event") {
  if ( !game.user.isGM ) return null;
  const deck = stack(deckRole(kind));
  const pile = stack("discard");
  if ( !deck || !pile ) return null;
  const ids = pile.cards.contents.filter(c => c.origin?.id === deck.id).map(c => c.id);
  if ( ids.length ) await pile.pass(deck, ids, { action: "pass", chatNotification: false });
  await deck.shuffle({ chatNotification: false });
  return ids.length;
}

/* -------------------------------------------- */
/*  Moving cards                                */
/* -------------------------------------------- */

async function move(fromRole, toRole, id, updateData = {}) {
  const from = stack(fromRole);
  const to = stack(toRole);
  if ( !from || !to || !from.cards.get(id) ) return null;
  try {
    return await from.pass(to, [id], { updateData, chatNotification: false });
  }
  catch(err) {
    console.error("irop | a card could not move", err);
    ui.notifications.warn(`A card could not move from ${from.name} to ${to.name}: ${err.message}`);
    return null;
  }
}

const landed = (territory, week, kind) => ({ face: 0, flags: { irop: { territory, week, kind } } });

/**
 * Carry out a turn's card moves (from resolvePlan): discards, the Event phase's draws,
 * the Dark Events used and the ones not.
 * @param {object[]} ops
 * @param {number} week     The week starting
 */
export async function applyCardOps(ops, week) {
  for ( const op of ops ) {
    switch ( op.op ) {
      case "discard":
        await move(op.from, "discard", op.id, { face: 0 });
        break;
      case "draw": {
        const from = op.from ?? "eventDeck";
        const kind = op.kind ?? "event";
        if ( op.place ) await move(from, "inPlay", op.id, landed(op.territory, week, kind));
        else await move(from, "discard", op.id, landed(op.territory, week, kind));
        break;
      }
      case "use":
        if ( op.discretionary ) await move("darkDeck", "darkHand", op.id, landed("", week, "dark"));
        else if ( op.persistent ) await move("darkDeck", "inPlay", op.id, landed(op.territory, week, "dark"));
        else await move("darkDeck", "discard", op.id, landed(op.territory, week, "dark"));
        break;
      case "skip":
        await move("darkDeck", "discard", op.id, { face: 0 });
        break;
    }
  }
}

/** Territory operations done now, held to their limits, as Advance week would do them. */
export async function applyOpsNow(ops) {
  if ( !ops.length ) return [];
  const docs = new Map();
  for ( const op of ops ) {
    const item = game.items?.get(op.id);
    if ( item ) docs.set(op.id, { system: item.system.toObject() });
  }
  const { updates } = resolvePlan({ lines: [{ id: "now", hidden: true, ops }] }, new Set(), docs);
  if ( updates.length ) await Item.updateDocuments(updates);
  return updates;
}

/** Logistics and Intel from a card, through the ledger; a loss takes only what is there. */
async function applyLedger(entries) {
  const ids = [];
  for ( const e of entries ) {
    const result = await recordResource(e, { clamp: true });
    if ( result?.ok ) ids.push(result.entry.id);
  }
  return ids;
}

/** What a played card's chat card says. */
export function eventCardContext(card, { territory = null, action = "revealed", week = getWarRoom().week } = {}) {
  const r = cardRules(card, card.system?.kind);
  const kind = IROP.cardKinds[r.kind];
  return {
    name: card.name,
    img: card.faces?.[0]?.img || card.img,
    kind: kind.label,
    kindKey: r.kind,
    dark: r.kind === "dark",
    action,
    where: territory?.name ?? "",
    text: card.description ?? "",
    effects: describeEffects(action === "discarded" ? r.discard : r.effect, getStrategyRules()),
    discardText: (action === "discarded") ? r.discardText : "",
    until: r.persistent && (action !== "discarded") ? `Stays until turn ${week + 2} starts.` : ""
  };
}

/**
 * Play a Dark Event from the GENESIS hand (doc: the GM may play discretionary cards).
 * Its numbers land on the territory chosen; a persistent one stays in play there.
 */
export async function playHeld(cardId, territoryId = "") {
  if ( !game.user.isGM ) return null;
  const card = stack("darkHand")?.cards.get(cardId);
  if ( !card ) return null;
  const r = cardRules(card, "dark");
  if ( r.reprisal && reprisalInPlay() ) return ui.notifications.warn("Only one Reprisal can be used at a time. Discard the one in play first.");
  const territory = game.items?.get(territoryId) ?? null;
  if ( (r.persistent || ["strength", "heat", "reputation"].some(k => r.effect[k])) && !territory ) {
    return ui.notifications.warn(`Choose where ${card.name} hits.`);
  }
  // Never in (2026-10-08): not on a territory the card lists.
  if ( territory && r.excluded.includes(territory.id) ) return ui.notifications.warn(`${card.name} never happens in ${territory.name}.`);
  const week = getWarRoom().week;
  const reason = `Dark Event: ${card.name}${territory ? `, ${territory.name}` : ""}`;
  await applyOpsNow(effectOps(r.effect, territory?.id, getStrategyRules()));
  await applyLedger(effectLedger(r.effect, reason));
  await move("darkHand", r.persistent ? "inPlay" : "discard", card.id, landed(territory?.id ?? "", week, "dark"));
  return ChatMessage.implementation.create({
    speaker: { alias: "GENESIS" },
    content: await foundry.applications.handlebars.renderTemplate(`${CARDS}/event-card.hbs`, eventCardContext(card, { territory, action: "played", week }))
  });
}

/**
 * Take a card out of play. With its discard effect (it ran its course), or without
 * (countered, as a successful response mission does).
 */
export async function discardInPlay(cardId, { apply = true } = {}) {
  if ( !game.user.isGM ) return null;
  const card = stack("inPlay")?.cards.get(cardId);
  if ( !card ) return null;
  const r = cardRules(card, card.system?.kind);
  const territory = game.items?.get(card.getFlag("irop", "territory")) ?? null;
  if ( apply ) {
    const rules = getStrategyRules();
    const territories = game.items?.filter(i => i.type === "territory") ?? [];
    await applyOpsNow(r.worldwide ? spreadOps(r.discard, territories, rules, r.negative, r.excluded) : effectOps(r.discard, territory?.id, rules));
    // Step 7: a Reprisal that ran its course destroys a regional upgrade where it hit.
    if ( r.reprisal && territory ) {
      const lost = game.items?.find(i => (i.type === "project") && (i.system.kind === "engineering") && (i.system.builds === "regional")
        && (i.system.status === "complete") && (i.system.territory === territory.id));
      if ( lost ) {
        await lost.update({ "system.status": "available", "system.progress": 0 });
        ui.notifications.info(`The ${lost.name} in ${territory.name} is destroyed. It is back on the Engineering list to rebuild.`);
      }
    }
    await applyLedger(effectLedger(r.discard, `${IROP.cardKinds[r.kind].label} discarded: ${card.name}`));
  }
  await move("inPlay", "discard", card.id, { face: 0 });
  if ( apply && (describeEffects(r.discard, getStrategyRules()) || r.discardText) ) {
    await ChatMessage.implementation.create({
      speaker: { alias: r.kind === "dark" ? "GENESIS" : "ODR Command" },
      content: await foundry.applications.handlebars.renderTemplate(`${CARDS}/event-card.hbs`, eventCardContext(card, { territory, action: "discarded" }))
    });
  }
  return card;
}

/* -------------------------------------------- */
/*  Undo                                        */
/* -------------------------------------------- */

/** The stacks as they are: which deck cards are out, and every card in the piles and hand. */
export function snapshotStacks() {
  if ( !decksReady() ) return null;
  const snap = { decks: {}, piles: {} };
  for ( const role of ["eventDeck", "darkDeck", "worldDeck"] ) {
    const deck = stack(role);
    if ( deck ) snap.decks[role] = Object.fromEntries(deck.cards.contents.map(c => [c.id, !!c.drawn]));
  }
  for ( const role of ["inPlay", "darkHand", "discard"] ) snap.piles[role] = stack(role).cards.contents.map(c => c.toObject());
  return snap;
}

/** Put the stacks back as a snapshot had them. */
export async function restoreStacks(snap) {
  if ( !snap || !decksReady() ) return;
  for ( const [role, cards] of Object.entries(snap.piles ?? {}) ) {
    const pile = stack(role);
    const now = pile.cards.contents.map(c => c.id);
    if ( now.length ) await pile.deleteEmbeddedDocuments("Card", now);
    if ( cards.length ) await pile.createEmbeddedDocuments("Card", cards, { keepId: true });
  }
  for ( const [role, drawn] of Object.entries(snap.decks ?? {}) ) {
    const deck = stack(role);
    if ( !deck ) continue;
    const updates = deck.cards.contents.filter(c => (c.id in drawn) && (!!c.drawn !== drawn[c.id])).map(c => ({ _id: c.id, drawn: drawn[c.id] }));
    if ( updates.length ) await deck.updateEmbeddedDocuments("Card", updates);
  }
}

/* -------------------------------------------- */
/*  Example cards                               */
/* -------------------------------------------- */

/**
 * GM: put a few EXAMPLE cards in the decks to try the system with (2026-10-08). The rules
 * doc names Propaganda, Reprisals and distress calls but writes no cards; these are mine,
 * marked as examples, for Johnald to replace with his own.
 */
export async function importEventCards({ confirm = true } = {}) {
  if ( !game.user.isGM || !needCardType() ) return null;
  if ( confirm ) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Example event cards" },
      content: "<p>Add eight example cards, three Events, three Dark Events and two World Events, to try the decks with? They are placeholders to replace with your own.</p>"
    });
    if ( !ok ) return null;
  }
  await setupDecks();
  const response = await fetch("systems/irop/assets/data/event-cards.json");
  if ( !response.ok ) return ui.notifications.error("The example cards are missing from the system.");
  const list = await response.json();
  let made = 0;
  for ( const kind of Object.keys(IROP.cardKinds) ) {
    const deck = stack(deckRole(kind));
    const have = new Set(deck.cards.contents.map(c => c.name));
    const back = IROP.cardKinds[kind].back;
    const data = list.filter(c => (c.system.kind === kind) && !have.has(c.name)).map(({ img, ...c }) => ({
      ...c, type: "event", face: null, back: { img: back }, faces: [{ name: c.name, img: img ?? back, text: "" }]
    }));
    if ( data.length ) made += (await deck.createEmbeddedDocuments("Card", data)).length;
    await deck.shuffle({ chatNotification: false });
  }
  ui.notifications.info(`Added ${made} example cards to the decks.`);
  return made;
}

export { inPlayLabel, applyLedger };

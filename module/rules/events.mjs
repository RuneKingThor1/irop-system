import { IROP } from "../config.mjs";

/**
 * Event and Dark Event cards (Strategy Layer step 6, 2026-10-08), kept apart from
 * Foundry so they can be tested on their own. A card here is {id, name, img, system}
 * with its rules read through cardRules; a card in play also carries the territory it
 * landed on and the week it landed.
 *
 * Doc, Event Phase: clear old persistent cards (applying any discard effect), draw 3,
 * place them at random, no more than one a territory, reveal, apply. Instantaneous
 * cards apply and are discarded; persistent ones stay on their territory until the end
 * of the next turn. GENESIS Phase: every 4 turns draw 3 Dark Events and use 2, the
 * same turn unless the card says otherwise; only one Reprisal at a time. Liberated
 * territories: negative events are handled by the Resistance.
 *
 * Never in (Johnald, 2026-10-08): a card can list territories it never lands on or is
 * played on. Placing at random works round them, and a card with nowhere left to land
 * stays in its deck while another is drawn.
 */

/** A persistent card placed in week W leaves as week W + 2 starts: the end of the next turn. */
export const PERSIST_WEEKS = 2;

const ZERO = () => Object.fromEntries(Object.keys(IROP.cardEffects).map(k => [k, 0]));

/** A card's rules, with defaults for a plain card (no system data) from the deck it came from. */
export function cardRules(card, kind = "event") {
  const s = card?.system ?? {};
  const nums = from => Object.fromEntries(Object.keys(IROP.cardEffects).map(k => [k, Math.round(Number(from?.[k]) || 0)]));
  return {
    kind: IROP.cardKinds[s.kind] ? s.kind : kind,
    persistent: !!s.persistent,
    discretionary: !!s.discretionary,
    holdable: !!s.holdable,
    reprisal: !!s.reprisal,
    negative: !!s.negative,
    respond: !!s.respond,
    worldwide: !!s.worldwide,
    excluded: Array.from(s.excluded ?? []).filter(Boolean),
    effect: s.effect ? nums(s.effect) : ZERO(),
    discard: s.discard ? nums(s.discard) : ZERO(),
    discardText: s.discardText ?? ""
  };
}

/** Whether any of a card's numbers land on a territory, so it needs one. */
export function touchesTerritory(effect = {}) {
  return ["strength", "heat", "reputation"].some(k => effect[k]);
}

/** A card's numbers in words: "+10 Logistics, Strength +1, Heat +1 next turn". */
export function describeEffects(effect = {}) {
  const sign = n => `${n > 0 ? "+" : ""}${n}`;
  const out = [];
  if ( effect.logistics ) out.push(`${sign(effect.logistics)} Logistics`);
  if ( effect.intel ) out.push(`${sign(effect.intel)} Intel`);
  if ( effect.strength ) out.push(`Strength ${sign(effect.strength)}`);
  if ( effect.heat ) out.push(`Heat ${sign(effect.heat)} next turn`);
  if ( effect.reputation ) out.push(`Reputation ${sign(effect.reputation)}`);
  return out.join(", ");
}

/**
 * A card's numbers as operations on its territory, in the turn plan's form: Strength
 * at once (held to 0 and the top), Heat waiting for next week, Reputation held to -2..+2.
 */
export function effectOps(effect = {}, territoryId, rules = IROP.strategyRules) {
  if ( !territoryId ) return [];
  const ops = [];
  if ( effect.strength ) ops.push({ id: territoryId, path: "system.strength", delta: effect.strength, min: 0, max: rules.strengthMax ?? 10 });
  if ( effect.heat ) ops.push({ id: territoryId, path: "system.heatPending", delta: effect.heat });
  if ( effect.reputation ) ops.push({ id: territoryId, path: "system.reputation", delta: effect.reputation, min: -2, max: 2 });
  return ops;
}

/**
 * A worldwide card's numbers, on every territory; a negative one skips the liberated
 * ones, where the Resistance handles it, and any card skips those it is never in.
 */
export function spreadOps(effect = {}, territories = [], rules = IROP.strategyRules, negative = false, excluded = []) {
  return territories.filter(t => !(negative && (t.system?.control === "liberated")) && !excluded.includes(t.id))
    .flatMap(t => effectOps(effect, t.id, rules));
}

/** Whether a card may land on, or be played on, a territory (its Never in list). */
export function canLand(card, territoryId, kind = "event") {
  return !cardRules(card, kind).excluded.includes(territoryId);
}

/** The territories a card may land on. */
export function placesFor(card, territories = [], kind = "event") {
  const excluded = cardRules(card, kind).excluded;
  return territories.filter(t => !excluded.includes(t.id));
}

/**
 * Event cards placed at random, no more than one a territory, each only where it may
 * land. Without any Never in list this is the plain draw and placement it always was.
 * With them, the cards drawn are matched to territories (a card that can only go one
 * place gets it), and a card with nowhere to go stays in the deck while the next is drawn.
 * @returns {{pairs: Array<[object, object]>, unplaced: object[]}}   Cards and where they land;
 *   the cards drawn first that could not land
 */
export function placeCards(deck = [], territories = [], want = 0, random = Math.random) {
  const cards = pickDistinct(deck, want, random);
  if ( !cards.some(c => cardRules(c).excluded.length) ) {
    const spots = pickDistinct(territories, cards.length, random);
    return { pairs: cards.slice(0, spots.length).map((c, i) => [c, spots[i]]), unplaced: [] };
  }
  // The drawn cards first, then the rest of the deck in a random order, as replacements.
  const queue = [...cards, ...pickDistinct(deck.filter(c => !cards.includes(c)), deck.length, random)];
  const options = queue.map(c => pickDistinct(placesFor(c, territories), territories.length, random));
  const holder = new Map();
  const tryCard = (i, seen) => {
    for ( const t of options[i] ) {
      if ( seen.has(t.id) ) continue;
      seen.add(t.id);
      if ( !holder.has(t.id) || tryCard(holder.get(t.id), seen) ) {
        holder.set(t.id, i);
        return true;
      }
    }
    return false;
  };
  const failed = [];
  for ( let i = 0; (i < queue.length) && (holder.size < want); i++ ) {
    if ( !tryCard(i, new Set()) && (i < cards.length) ) failed.push(queue[i]);
  }
  const placed = [...holder.entries()].sort((a, b) => a[1] - b[1]);
  return {
    pairs: placed.map(([id, i]) => [queue[i], territories.find(t => t.id === id)]),
    unplaced: failed
  };
}

/** A card's Logistics and Intel as ledger entries. */
export function effectLedger(effect = {}, reason = "") {
  return ["logistics", "intel"].filter(k => effect[k]).map(k => ({ resource: k, amount: effect[k], reason }));
}

/** Pick up to n distinct items at random. */
export function pickDistinct(list = [], n = 0, random = Math.random) {
  const pool = [...list];
  const out = [];
  while ( pool.length && (out.length < n) ) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return out;
}

/**
 * The cards' part of a turn plan, for the week starting `next`.
 * @param {object} input
 * @param {number} input.next                The week starting
 * @param {object} input.rules
 * @param {object[]} input.territories       {id, name, system}
 * @param {object[]} input.inPlay            {id, name, img, system, territory, week}
 * @param {object[]} input.held              Dark Events in the GENESIS hand: {id, name, img, system, week}
 * @param {object[]|null} input.eventDeck    Cards left to draw, or null with no deck
 * @param {object[]|null} input.darkDeck
 * @param {object[]|null} [input.worldDeck]   The neutral World Event deck (2026-10-08)
 * @param {object[]} [input.upgrades]          Regional upgrades built: {id, name, territory} (step 7)
 * @param {Function} [input.random]
 * @returns {{lines: object[], warnings: string[], due: string[]}}
 */
export function planCards({ next, rules = IROP.strategyRules, territories = [], inPlay = [], held = [], eventDeck = null, darkDeck = null,
  worldDeck = null, upgrades = [], random = Math.random } = {}) {
  const lines = [];
  const warnings = [];
  const due = [];
  const name = id => territories.find(t => t.id === id)?.name ?? "";

  // Persistent cards whose time is up leave, with their discard effect.
  for ( const c of inPlay ) {
    const r = cardRules(c, c.system?.kind);
    if ( !r.persistent || ((Number(c.week) || 0) + PERSIST_WEEKS > next) ) continue;
    const where = r.worldwide ? "every territory" : name(c.territory);
    const reason = `${IROP.cardKinds[r.kind].label} discarded: ${c.name}${where ? `, ${where}` : ""}`;
    const words = [describeEffects(r.discard), r.discardText].filter(Boolean).join(". ");
    // Doc: Engineering upgrades can be destroyed in GENESIS Reprisals. One left uncountered
    // takes a regional upgrade where it hit, which goes back on the list to rebuild (step 7).
    const lost = (r.reprisal && c.territory) ? upgrades.find(u => u.territory === c.territory) : null;
    const lostOps = lost ? [{ id: lost.id, path: "system.status", set: "available" }, { id: lost.id, path: "system.progress", set: 0 }] : [];
    lines.push({
      section: "cards", tone: "down", text: `${c.name} leaves ${where || "play"}`,
      detail: [words ? `On discard: ${words}.` : "No discard effect.", lost ? `The ${lost.name} there is destroyed.` : ""].filter(Boolean).join(" "),
      ops: [...(r.worldwide ? spreadOps(r.discard, territories, rules, r.negative, r.excluded) : effectOps(r.discard, c.territory, rules)), ...lostOps],
      ledger: effectLedger(r.discard, reason),
      card: { op: "discard", id: c.id, from: "inPlay", name: c.name, img: c.img, kind: r.kind }
    });
  }
  // Dark Events held past their turn go, unless the card says they keep.
  for ( const c of held ) {
    const r = cardRules(c, "dark");
    if ( r.holdable || ((Number(c.week) || 0) >= next) ) continue;
    lines.push({
      section: "cards", tone: "info", text: `Unused Dark Event discarded: ${c.name}`, detail: "Dark Events are used the turn they are drawn.",
      ops: [], ledger: [], card: { op: "discard", id: c.id, from: "darkHand", name: c.name, img: c.img, kind: "dark" }
    });
  }

  // Dark Events, every darkEventEvery turns: draw, the GM picks which to use and where.
  if ( next % Math.max(1, Math.round(Number(rules.darkEventEvery) || 1)) === 0 ) {
    const want = Math.max(0, Math.round(Number(rules.darkEventDraw) || 0));
    const keep = Math.max(0, Math.round(Number(rules.darkEventKeep) || 0));
    if ( !darkDeck ) due.push(`Dark Events: draw ${want} and use ${keep} this turn. Set up the decks in the Events window to draw them here.`);
    else {
      if ( darkDeck.length < want ) warnings.push(`The Dark Event deck has ${darkDeck.length} of the ${want} cards to draw. Reshuffle the discards in the Events window.`);
      for ( const c of pickDistinct(darkDeck, want, random) ) {
        const r = cardRules(c, "dark");
        const notes = [
          r.discretionary ? "Discretionary: held in the GENESIS hand to play this turn" : describeEffects(r.effect),
          r.persistent && !r.discretionary ? `stays until turn ${next + PERSIST_WEEKS} starts` : "",
          r.reprisal ? "Reprisal" : ""
        ].filter(Boolean);
        lines.push({
          section: "dark", tone: "up", text: c.name, detail: notes.join(". ") || "No numbers change.",
          ops: [], ledger: [],
          card: {
            op: "dark", id: c.id, from: "darkDeck", name: c.name, img: c.img, kind: "dark", effect: r.effect,
            persistent: r.persistent, discretionary: r.discretionary, reprisal: r.reprisal, excluded: r.excluded,
            needsTerritory: !r.discretionary && (r.persistent || touchesTerritory(r.effect))
          }
        });
      }
    }
  }
  // The Event phase, every eventEvery turns: draw, place at random, one a territory.
  if ( next % Math.max(1, Math.round(Number(rules.eventEvery) || 1)) === 0 ) {
    const want = Math.max(0, Math.round(Number(rules.eventDraw) || 0));
    if ( !eventDeck ) due.push(`Event phase: draw ${want} Event cards and place them on territories, no more than one each. Set up the decks in the Events window to draw them here.`);
    else {
      if ( eventDeck.length < want ) warnings.push(`The Event deck has ${eventDeck.length} of the ${want} cards to draw. Reshuffle the discards in the Events window.`);
      const { pairs, unplaced } = placeCards(eventDeck, territories, want, random);
      for ( const c of unplaced ) warnings.push(`${c.name} has nowhere it may land this turn (its Never in list), so it stays in the deck.`);
      if ( (pairs.length < want) && (pairs.length < eventDeck.length) ) {
        warnings.push(territories.length < want ? "There are fewer territories than Event cards to place."
          : `Only ${pairs.length} of the ${want} Event cards could be placed, with the territories their Never in lists leave.`);
      }
      pairs.forEach(([c, t]) => {
        const r = cardRules(c, "event");
        const handled = r.negative && (t.system?.control === "liberated");
        const reason = `Event: ${c.name}, ${t.name}`;
        const words = describeEffects(r.effect);
        lines.push({
          section: "events", tone: handled ? "info" : (r.negative ? "up" : "down"),
          text: `${c.name} lands on ${t.name}`,
          detail: handled ? "Handled by the Resistance: the territory is liberated."
            : [words, r.persistent ? `Stays until turn ${next + PERSIST_WEEKS} starts` : ""].filter(Boolean).join(". ") || "No numbers change.",
          ops: handled ? [] : effectOps(r.effect, t.id, rules),
          ledger: handled ? [] : effectLedger(r.effect, reason),
          card: { op: "draw", id: c.id, from: "eventDeck", name: c.name, img: c.img, kind: "event", territory: t.id, place: r.persistent && !handled }
        });
      });
    }
  }

  // World Events (Johnald, 2026-10-08): a neutral deck, every worldEventEvery turns. Each lands
  // on a territory the Event phase left alone if it can, or on every territory if worldwide.
  const worldWant = Math.max(0, Math.round(Number(rules.worldEventDraw) || 0));
  if ( worldWant && (next % Math.max(1, Math.round(Number(rules.worldEventEvery) || 1)) === 0) ) {
    if ( !worldDeck ) {
      if ( eventDeck ) warnings.push("There is no World Event deck yet. Set up the decks again in the Events window to add it.");
    }
    else {
      if ( worldDeck.length < worldWant ) warnings.push(`The World Event deck has ${worldDeck.length} of the ${worldWant} cards to draw. Reshuffle the discards in the Events window.`);
      const taken = new Set(lines.filter(l => l.section === "events").map(l => l.card.territory));
      const drawn = pickDistinct(worldDeck, worldWant, random);
      const used = new Set(drawn);
      for ( let n = 0; n < drawn.length; n++ ) {
        const c = drawn[n];
        const r = cardRules(c, "world");
        const words = describeEffects(r.effect);
        const until = r.persistent ? `Stays until turn ${next + PERSIST_WEEKS} starts` : "";
        if ( r.worldwide ) {
          lines.push({
            section: "world", tone: r.negative ? "up" : "info", text: `${c.name}: every territory`,
            detail: [words ? `${words}, everywhere` : "", until].filter(Boolean).join(". ") || "No numbers change.",
            ops: spreadOps(r.effect, territories, rules, r.negative, r.excluded), ledger: effectLedger(r.effect, `World Event: ${c.name}`),
            card: { op: "draw", id: c.id, from: "worldDeck", name: c.name, img: c.img, kind: "world", territory: "", place: r.persistent }
          });
          continue;
        }
        const allowed = placesFor(c, territories, "world");
        const open = allowed.filter(t => !taken.has(t.id));
        const [t] = pickDistinct(open.length ? open : allowed, 1, random);
        if ( !t ) {
          if ( !territories.length ) {
            warnings.push(`There is no territory for ${c.name} to land on.`);
            continue;
          }
          // Never in everywhere: it stays in the deck, and the next card is drawn instead.
          warnings.push(`${c.name} has nowhere it may land (its Never in list), so it stays in the deck.`);
          const [spare] = pickDistinct(worldDeck.filter(d => !used.has(d)), 1, random);
          if ( spare ) {
            used.add(spare);
            drawn.push(spare);
          }
          continue;
        }
        taken.add(t.id);
        const handled = r.negative && (t.system?.control === "liberated");
        lines.push({
          section: "world", tone: handled ? "info" : (r.negative ? "up" : "info"), text: `${c.name} lands on ${t.name}`,
          detail: handled ? "Handled by the Resistance: the territory is liberated." : [words, until].filter(Boolean).join(". ") || "No numbers change.",
          ops: handled ? [] : effectOps(r.effect, t.id, rules),
          ledger: handled ? [] : effectLedger(r.effect, `World Event: ${c.name}, ${t.name}`),
          card: { op: "draw", id: c.id, from: "worldDeck", name: c.name, img: c.img, kind: "world", territory: t.id, place: r.persistent && !handled }
        });
      }
    }
  }

  return { lines, warnings, due };
}

/**
 * Check the Dark Events the GM is using this turn (doc): no more than darkEventKeep, at
 * most one Reprisal counting any in play, a territory for each that needs one, and none
 * on a territory its card is never in.
 * @param {object[]} used          The ticked dark lines, each {card, territory}
 * @param {object} rules
 * @param {boolean} reprisalInPlay
 * @returns {string|null}   Why not, or null when fine
 */
export function checkDarkChoice(used = [], rules = IROP.strategyRules, reprisalInPlay = false) {
  const keep = Math.max(0, Math.round(Number(rules.darkEventKeep) || 0));
  if ( used.length > keep ) return `Use ${keep} of the Dark Events drawn, not ${used.length}.`;
  const reprisals = used.filter(u => u.card.reprisal).length;
  if ( reprisals && (reprisalInPlay || (reprisals > 1)) ) return "Only one Reprisal can be used at a time.";
  const lost = used.find(u => u.card.needsTerritory && !u.territory);
  if ( lost ) return `Choose where ${lost.card.name} hits.`;
  const barred = used.find(u => u.territory && (u.card.excluded ?? []).includes(u.territory));
  if ( barred ) return `${barred.card.name} never happens there. Choose another territory.`;
  return null;
}

/** Where a card in play stands, for the Events window and the territory card. */
export function inPlayLabel(card, rules) {
  const r = cardRules(card, card.system?.kind);
  return r.persistent ? `until turn ${(Number(card.week) || 0) + PERSIST_WEEKS} starts` : "this turn";
}

import { IROP } from "../config.mjs";
import { cardRules, describeEffects, touchesTerritory, inPlayLabel } from "../rules/events.mjs";
import { getWarRoom, getStrategyRules } from "../settings.mjs";
import {
  stack, decksReady, setupDecks, newCard, reshuffle, playHeld, discardInPlay, importEventCards, deckRole, cardTypeReady
} from "../strategy/events.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * The Events window (Strategy Layer step 6, 2026-10-08): the cards in play on the map,
 * the GENESIS hand the GM plays from, and the two decks. Everyone sees what is in play;
 * the hand and the decks are the GM's.
 */
export class EventsApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-events",
    classes: ["irop", "irop-events"],
    window: { title: "Events", icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      setup: () => setupDecks(),
      examples: () => importEventCards(),
      newCard: (event, target) => newCard(target.dataset.kind),
      reshuffle: EventsApp.#onReshuffle,
      openDeck: (event, target) => stack(deckRole(target.dataset.kind))?.sheet?.render({ force: true }),
      openCard: EventsApp.#onOpenCard,
      play: EventsApp.#onPlay,
      discard: EventsApp.#onDiscard
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/events.hbs", scrollable: [".ev-body"] }
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
    const isGM = !!game.user?.isGM;
    const week = getWarRoom().week;
    const enrich = html => foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { secrets: isGM });
    const name = id => (id ? (game.items?.get(id)?.name ?? "") : "");
    const sorted = (game.items?.filter(i => i.type === "territory") ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const view = async (card, kind) => {
      const r = cardRules(card, kind);
      const k = IROP.cardKinds[r.kind];
      const landed = { week: card.getFlag?.("irop", "week") ?? week, system: card.system };
      return {
        id: card.id, name: card.name, img: card.faces?.[0]?.img || card.img, kind: k.label, kindIcon: k.icon, dark: r.kind === "dark",
        kindKey: r.kind, worldwide: r.worldwide,
        where: r.worldwide ? "Every territory" : name(card.getFlag?.("irop", "territory")), until: inPlayLabel(landed),
        text: await enrich(card.description), effects: describeEffects(r.effect, getStrategyRules()),
        discard: [describeEffects(r.discard, getStrategyRules()), r.discardText].filter(Boolean).join(". "),
        respond: r.respond, reprisal: r.reprisal, persistent: r.persistent,
        needsTerritory: !r.worldwide && (r.persistent || touchesTerritory(r.effect)),
        // Never in (2026-10-08): the territories it may be played on.
        places: Object.fromEntries(sorted.filter(t => !r.excluded.includes(t.id)).map(t => [t.id, t.name]))
      };
    };
    const inPlay = await Promise.all((stack("inPlay")?.cards.contents ?? []).map(c => view(c, c.system?.kind)));
    const hand = isGM ? await Promise.all((stack("darkHand")?.cards.contents ?? []).map(c => view(c, "dark"))) : [];
    const decks = isGM ? Object.entries(IROP.cardKinds).map(([kind, k]) => {
      const deck = stack(deckRole(kind));
      const discards = (stack("discard")?.cards.contents ?? []).filter(c => c.origin?.id === deck?.id).length;
      return { kind, label: k.label, back: k.back, total: deck?.cards.size ?? 0, left: deck?.availableCards.length ?? 0, discards };
    }) : [];
    const territories = Object.fromEntries((game.items?.filter(i => i.type === "territory") ?? [])
      .sort((a, b) => a.name.localeCompare(b.name)).map(t => [t.id, t.name]));
    return { isGM, ready: decksReady(), typeReady: cardTypeReady(), week, inPlay, hand, decks, territories, empty: !decks.some(d => d.total) };
  }

  static #idOf(target) {
    return target.closest("[data-card-id]")?.dataset.cardId;
  }

  static async #onReshuffle(event, target) {
    const n = await reshuffle(target.dataset.kind);
    if ( n !== null ) ui.notifications.info(`${n} discarded ${n === 1 ? "card goes" : "cards go"} back into the ${IROP.cardKinds[target.dataset.kind].label} deck, shuffled.`);
  }

  static #onOpenCard(event, target) {
    if ( !game.user.isGM ) return null;
    const id = EventsApp.#idOf(target);
    for ( const role of ["inPlay", "darkHand", "eventDeck", "darkDeck"] ) {
      const card = stack(role)?.cards.get(id);
      if ( card ) return card.sheet?.render({ force: true });
    }
    return null;
  }

  static #onPlay(event, target) {
    const row = target.closest("[data-card-id]");
    return playHeld(row.dataset.cardId, row.querySelector("select[data-where]")?.value ?? "");
  }

  /** Discard a card in play: with its discard effect, or countered without it. */
  static async #onDiscard(event, target) {
    const id = EventsApp.#idOf(target);
    const card = stack("inPlay")?.cards.get(id);
    if ( !card ) return null;
    const r = cardRules(card, card.system?.kind);
    const words = [describeEffects(r.discard, getStrategyRules()), r.discardText].filter(Boolean).join(". ");
    const choice = await DialogV2.wait({
      window: { title: `Discard ${card.name}` },
      content: `<p>${words ? `On discard: ${words}.` : "It has no discard effect."}</p>`,
      buttons: [
        { action: "apply", label: "Discard", icon: "fa-solid fa-check", default: true },
        { action: "counter", label: "Countered: no effect", icon: "fa-solid fa-shield-halved" },
        { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    if ( (choice !== "apply") && (choice !== "counter") ) return null;
    return discardInPlay(id, { apply: choice === "apply" });
  }
}

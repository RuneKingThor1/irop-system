import { IROP } from "../config.mjs";
import { ribbonOrder, conditionWord, sideOf, seesNumbers, vitalBars, dodgePips, offscreen } from "../rules/turn-order.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The turn order ribbon (Johnald, 2026-10-11): the combat in view as a slanted strip of cards
 * along the top of the screen. The acting card opens out with a large portrait; the rest show a
 * portrait, a name, a Health line, dodge pips and status icons. Built on Foundry's own combat
 * (its turns, rounds and combatants); the rules for what shows are in rules/turn-order.mjs.
 *
 * A click on a card pans to its token (and takes control of it for its owner), a double click
 * opens the sheet for those who may see it, and hovering highlights the token as Foundry's
 * tracker does. The acting combatant's owner and the GM can end the turn from its card; the GM
 * can end the combat from the round (Johnald, 2026-10-11). A line longer than the screen shows
 * a "+3" tab at each end with cards out of sight, which scrolls to them.
 */

/** Whether this user shows the ribbon: each person's own choice. */
function ribbonShown() {
  try {
    return game.settings.get("irop", "turnRibbonShown") !== false;
  }
  catch {
    return true;
  }
}

/** The GM's order for the ribbon: "actingFirst" (the line turns) or "fixed". */
export function ribbonMode() {
  try {
    return (game.settings.get("irop", "turnRibbonOrder") === "fixed") ? "fixed" : "actingFirst";
  }
  catch {
    return "actingFirst";
  }
}

/** A card's portrait: the actor's art, unless it is Foundry's blank figure; then the token's. */
export function portraitFor(combatant) {
  const blank = globalThis.CONST?.DEFAULT_TOKEN ?? "icons/svg/mystery-man.svg";
  const actorImg = combatant.actor?.img;
  if ( actorImg && (actorImg !== blank) ) return actorImg;
  return combatant.token?.texture?.src || combatant.img || actorImg || blank;
}

/**
 * The status effects a combatant's token shows, the way Foundry decides it: an effect set to
 * always show its icon, or to show it while temporary and temporary now. Each with its X.
 */
export function statusesFor(actor) {
  const SHOW = globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON ?? { NEVER: 0, CONDITIONAL: 1, ALWAYS: 2 };
  const out = [];
  for ( const effect of actor?.appliedEffects ?? [] ) {
    const shown = (effect.showIcon === SHOW.ALWAYS) || ((effect.showIcon === SHOW.CONDITIONAL) && effect.isTemporary);
    if ( !shown || !effect.img ) continue;
    out.push({ img: effect.img, name: effect.name, counter: Number(effect.flags?.irop?.counter) || 0 });
  }
  return out;
}

/** One combatant as a card, as this user may see it. */
export function cardFor(combatant, user = game.user) {
  const actor = combatant.actor;
  const system = actor?.system ?? {};
  const isGM = !!user?.isGM;
  const disposition = combatant.token?.disposition ?? actor?.prototypeToken?.disposition ?? 0;
  const side = sideOf({ type: actor?.type, disposition });
  const numbers = seesNumbers({ isGM, type: actor?.type, observer: !!actor?.testUserPermission?.(user, "OBSERVER") });
  const sideDef = IROP.turnOrder.sides[side];
  const color = (side === "operative") ? (system.accent ?? sideDef.color) : sideDef.color;
  const label = (side === "operative") ? (IROP.roles[system.roleKey]?.label ?? sideDef.label)
    : (system.details?.faction || sideDef.label);
  const hp = system.vitals?.hp;
  const initiative = Number.isFinite(combatant.initiative) ? combatant.initiative : null;
  const owner = !!combatant.isOwner;
  return {
    id: combatant.id,
    name: combatant.name,
    img: portraitFor(combatant),
    side,
    color,
    label,
    init: (initiative === null) ? "" : String(initiative),
    canRoll: (initiative === null) && owner,
    numbers,
    bars: numbers ? vitalBars(system.vitals) : [],
    dodges: numbers ? dodgePips(system.vitals?.dodges) : null,
    condition: numbers ? null : conditionWord(hp?.value, hp?.max),
    statuses: (numbers || IROP.turnOrder.statusesShown) ? statusesFor(actor) : [],
    owner,
    hidden: !!combatant.hidden,
    defeated: !!combatant.isDefeated,
    visible: isGM || !!combatant.visible
  };
}

/**
 * What the ribbon shows of a combat to a user: its cards in order, the round, and the controls
 * this user has.
 * @returns {object|null}  null with no combat, or nothing in it this user may see.
 */
export function ribbonContext(combat, user = game.user, mode = ribbonMode()) {
  if ( !combat ) return null;
  const isGM = !!user?.isGM;
  const entries = (combat.turns ?? []).map(c => cardFor(c, user));
  const started = !!combat.started;
  const activeId = started ? (combat.combatant?.id ?? null) : null;
  const nextId = started ? (combat.nextCombatant?.id ?? null) : (entries.find(e => !e.defeated)?.id ?? null);
  const { cards, position, count } = ribbonOrder(entries, { activeId, nextId, mode, round: combat.round });
  if ( !cards.some(c => !c.marker) ) return null;
  for ( const card of cards ) {
    if ( card.active ) card.canEndTurn = isGM || card.owner;
  }
  return { cards, position, count, started, round: combat.round, mode, isGM };
}

/* -------------------------------------------- */

export class TurnRibbon extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-turn-ribbon",
    classes: ["irop", "irop-turn-ribbon"],
    window: { frame: false, positioned: false },
    actions: {
      endTurn: TurnRibbon.#onEndTurn,
      previousTurn: TurnRibbon.#onPreviousTurn,
      nextTurn: TurnRibbon.#onNextTurn,
      beginCombat: TurnRibbon.#onBeginCombat,
      endCombat: TurnRibbon.#onEndCombat,
      rollInitiative: TurnRibbon.#onRollInitiative,
      scrollMore: TurnRibbon.#onScrollMore
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/turn-ribbon.hbs" }
  };

  static #instance = null;

  /** Whether the ribbon was on screen at the last sync, so the date bar moves only when that changes. */
  static #shown = false;

  /** The combat in view. */
  static get combat() {
    return game.combat ?? null;
  }

  /** Show, redraw or put away the ribbon for the combat in view. */
  static sync() {
    const context = ribbonShown() ? ribbonContext(this.combat) : null;
    if ( context ) {
      this.#instance ??= new this();
      return this.#instance.render({ force: true });
    }
    if ( this.#instance?.rendered ) {
      return this.#instance.close({ animate: false }).then(() => this.#announce(false));
    }
    this.#announce(false);
    return null;
  }

  /** Redraw soon: combats, actors and effects change several at a time. */
  static refresh = foundry.utils.debounce(() => TurnRibbon.sync(), 60);

  /** Tell the date bar when the ribbon comes or goes, so it can move out of the way. */
  static #announce(shown) {
    if ( shown === TurnRibbon.#shown ) return;
    TurnRibbon.#shown = shown;
    Hooks.callAll("irop.turnRibbonShown", shown);
  }

  /** @override */
  async _prepareContext(options) {
    return ribbonContext(TurnRibbon.combat) ?? { cards: [], count: 0 };
  }

  /** In Foundry's top area, between the left and right controls, rather than loose on the page. @override */
  _insertElement(element) {
    const existing = document.getElementById(element.id);
    if ( existing ) return existing.replaceWith(element);
    (document.getElementById("ui-top") ?? document.body).append(element);
  }

  /** Where the line was scrolled to, kept across a redraw. */
  #scroll = 0;

  /** The token highlighted by hovering over its card. */
  #highlighted = null;

  /** @override */
  async _preRender(context, options) {
    await super._preRender(context, options);
    this.#scroll = this.element?.querySelector(".rb-line")?.scrollLeft ?? 0;
  }

  /** Clicks, double clicks and hovering on the cards, once for the window. @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("click", this.#onClick.bind(this));
    this.element.addEventListener("dblclick", this.#onDoubleClick.bind(this));
    this.element.addEventListener("pointerover", this.#onHoverIn.bind(this), { passive: true });
    this.element.addEventListener("pointerout", this.#onHoverOut.bind(this), { passive: true });
    window.addEventListener("resize", this.#onResize);
  }

  /** The window resized: the tabs at the ends may change. */
  #onResize = foundry.utils.debounce(() => this.#updateOverflow(), 100);

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    TurnRibbon.#announce(true);
    const line = this.element.querySelector(".rb-line");
    if ( !line ) return;
    // A mouse wheel scrolls a long line sideways; the tabs at its ends follow.
    line.addEventListener("wheel", event => {
      if ( line.scrollWidth <= line.clientWidth ) return;
      event.preventDefault();
      event.stopPropagation();
      line.scrollLeft += event.deltaY || event.deltaX;
    }, { passive: false });
    line.addEventListener("scroll", () => this.#updateOverflow(), { passive: true });
    // Keep the line where it was, with the acting card in view.
    line.scrollLeft = this.#scroll;
    const active = line.querySelector(".rb-card.active");
    const margin = 40;
    if ( active && (active.offsetLeft < line.scrollLeft) ) line.scrollLeft = Math.max(0, active.offsetLeft - margin);
    else if ( active && ((active.offsetLeft + active.offsetWidth) > (line.scrollLeft + line.clientWidth)) ) {
      line.scrollLeft = active.offsetLeft + active.offsetWidth - line.clientWidth + margin;
    }
    this.#updateOverflow();
  }

  /**
   * Show the tab at each end of the line with how many cards are out of sight that way, and fade
   * the line's edge there; hide them when everything shows.
   */
  #updateOverflow() {
    const line = this.element?.querySelector(".rb-line");
    if ( !line ) return;
    const boxes = [...line.querySelectorAll(".rb-card")].map(el => ({ left: el.offsetLeft, width: el.offsetWidth }));
    const counts = offscreen(boxes, { scrollLeft: line.scrollLeft, width: line.clientWidth });
    for ( const side of ["left", "right"] ) {
      const tab = this.element.querySelector(`.rb-more.${side}`);
      const n = counts[side];
      line.classList.toggle(`fade-${side}`, n > 0);
      if ( !tab ) continue;
      tab.hidden = !n;
      tab.querySelector(".rb-more-n").textContent = `+${n}`;
      tab.dataset.tooltip = `${n} more ${(n === 1) ? "card" : "cards"} this way`;
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    window.removeEventListener("resize", this.#onResize);
    this.#highlighted = null;
  }

  /* -------------------------------------------- */

  /** The combatant whose card an event happened on. */
  #combatantAt(event) {
    const id = event.target.closest?.("[data-combatant-id]")?.dataset.combatantId;
    return id ? (TurnRibbon.combat?.combatants.get(id) ?? null) : null;
  }

  /** The token on the scene in view for a combatant, if this user can see it. */
  #tokenFor(combatant) {
    const token = combatant?.token?.object;
    if ( !token || !globalThis.canvas?.ready || (combatant.token.parent?.id !== canvas.scene?.id) ) return null;
    return token.visible ? token : null;
  }

  /** A click pans to the token, and takes control of it for its owner. */
  #onClick(event) {
    if ( event.target.closest("button") ) return;
    const token = this.#tokenFor(this.#combatantAt(event));
    if ( !token ) return;
    if ( token.isOwner ) token.control({ releaseOthers: true });
    canvas.animatePan({ x: token.center.x, y: token.center.y });
  }

  /** A double click opens the sheet, for anyone who may observe the actor. */
  #onDoubleClick(event) {
    if ( event.target.closest("button") ) return;
    const actor = this.#combatantAt(event)?.actor;
    if ( actor?.testUserPermission(game.user, "OBSERVER") ) actor.sheet.render(true);
  }

  /** Hovering over a card highlights its token, as Foundry's tracker does. */
  #onHoverIn(event) {
    const token = this.#tokenFor(this.#combatantAt(event));
    if ( !token || (token === this.#highlighted) || !token._canHover?.(game.user, event) ) return;
    this.#highlighted?._onHoverOut?.(event);
    token._onHoverIn(event, { hoverOutOthers: true });
    this.#highlighted = token;
  }

  #onHoverOut(event) {
    if ( event.relatedTarget && this.element.contains(event.relatedTarget)
      && (event.relatedTarget.closest("[data-combatant-id]") === event.target.closest("[data-combatant-id]")) ) return;
    this.#highlighted?._onHoverOut?.(event);
    this.#highlighted = null;
  }

  /* -------------------------------------------- */

  /** End the turn: the acting combatant's owner, or the GM. */
  static #onEndTurn() {
    const combat = TurnRibbon.combat;
    if ( combat && (game.user.isGM || combat.combatant?.isOwner) ) return combat.nextTurn();
    return null;
  }

  /** The GM steps the turn back. */
  static #onPreviousTurn() {
    if ( game.user.isGM ) return TurnRibbon.combat?.previousTurn() ?? null;
    return null;
  }

  /** The GM moves the turn on. */
  static #onNextTurn() {
    if ( game.user.isGM ) return TurnRibbon.combat?.nextTurn() ?? null;
    return null;
  }

  /** The GM starts the fight. */
  static #onBeginCombat() {
    if ( game.user.isGM ) return TurnRibbon.combat?.startCombat() ?? null;
    return null;
  }

  /** The GM ends the combat, after Foundry's own confirm. */
  static #onEndCombat() {
    if ( game.user.isGM ) return TurnRibbon.combat?.endCombat() ?? null;
    return null;
  }

  /** A tab at an end of the line scrolls most of a screen that way. */
  static #onScrollMore(event, target) {
    const line = this.element.querySelector(".rb-line");
    const dir = (target.dataset.dir === "left") ? -1 : 1;
    line?.scrollBy({ left: dir * Math.max(120, line.clientWidth * 0.8), behavior: "smooth" });
  }

  /** Roll initiative for a combatant this user owns that has none yet. */
  static #onRollInitiative(event, target) {
    const combat = TurnRibbon.combat;
    const id = target.closest("[data-combatant-id]")?.dataset.combatantId;
    const combatant = id ? combat?.combatants.get(id) : null;
    if ( combatant?.isOwner && (combatant.initiative === null) ) return combat.rollInitiative([id]);
    return null;
  }
}

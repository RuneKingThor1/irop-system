import { IROP } from "../config.mjs";
import { buyFromStore, sellToStore, stockShelf, walletRows } from "../store.mjs";
import { formulaInWords } from "./actor-sheet.mjs";
import { isStackable } from "../rules/stacks.mjs";
import {
  shelfOf, storePrice, priceIn, acceptedCurrencies, sellCurrency, walletOf, priceText, buyBackPrice, isPhysical, unsellable
} from "../rules/store.mjs";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

/** How each kind of item reads on a shelf, one and many. */
const TYPE_LABELS = { weapon: "Weapon", armor: "Armor", gear: "Gear", mod: "Mod" };

/**
 * The shop's sections, in order (Johnald, 2026-10-16): weapons by their Combat tab section, gear by
 * its kind. Each item sits in one; the shop's tabs and the shelf's headings follow this list.
 */
/** How many category tabs show at once. */
const CAT_TABS = 6;

export const SHOP_SECTIONS = [
  { key: "melee", label: "Melee" },
  { key: "ranged", label: "Ranged" },
  { key: "special", label: "Special" },
  { key: "explosives", label: "Explosives" },
  { key: "deployable", label: "Deployables" },
  { key: "armor", label: "Armor" },
  { key: "plating", label: "Armor Plating" },
  { key: "mod", label: "Mods" },
  { key: "ammunition", label: "Ammunition" },
  { key: "medical", label: "Medical" },
  { key: "consumable", label: "Consumables" },
  { key: "general", label: "Gear" }
];

/** The shop section an item sits in. */
export function shopSection(item) {
  const s = item?.system ?? {};
  if ( item?.type === "weapon" ) {
    if ( IROP.weaponGroups[s.section] ) return s.section;
    // Plain data (a copy, not a live item) has no section getter: the Combat tab's rule, RULED 2026-10-08.
    if ( IROP.weaponGroups[s.sheetSection] ) return s.sheetSection;
    if ( ["launcher", "chemthrower"].includes(s.weaponClass) ) return "special";
    if ( s.category === "melee" ) return "melee";
    return ["thrown", "explosive"].includes(s.category) ? "explosives" : "ranged";
  }
  if ( item?.type === "gear" ) return SHOP_SECTIONS.some(x => x.key === s.kind) ? s.kind : "general";
  return item?.type === "armor" ? "armor" : "mod";
}
const sectionIndex = item => SHOP_SECTIONS.findIndex(x => x.key === shopSection(item));

const signed = n => (n > 0 ? `+${n}` : `${n}`);

/** An item's kind in a line, for the shop's detail panel: "Rifles, Ranged". */
export function typeLine(item) {
  const s = item.system ?? {};
  switch ( item.type ) {
    case "weapon": return [IROP.weaponClasses[s.weaponClass], IROP.weaponCategories[s.category]?.label].filter(Boolean).join(", ");
    case "armor": return `${IROP.armorClasses[s.armorClass] ?? ""} armor`.trim();
    case "gear": return IROP.gearKinds[s.kind] ?? "Gear";
    case "mod": return `Mod for ${(IROP.modTargets[s.target] ?? "gear").toLowerCase()}`;
    default: return TYPE_LABELS[item.type] ?? item.type;
  }
}

/**
 * What a shopper needs to know about an item before buying it (Johnald, 2026-10-10: the shop
 * as a list beside a detail panel), as label and value pairs. Formulas read in words, since a
 * shelf item has no character's numbers to fill in: "1d6 + STR mod".
 */
export function itemStats(item) {
  const s = item.system ?? {};
  const out = [];
  const add = (label, value) => { if ( value !== "" && value !== null && value !== undefined ) out.push({ label, value: String(value) }); };
  if ( item.type === "weapon" ) {
    const attacks = !!IROP.weaponCategories[s.category]?.attribute;
    if ( attacks ) add("Accuracy", signed(-(s.accuracy ?? 0)));
    if ( s.damage?.formula ) add("Damage", `${formulaInWords(s.damage.formula)} ${IROP.damageTypes[s.damage.type]?.label ?? ""}`.trim());
    else if ( IROP.weaponFeeds[s.feed]?.slots ) add("Damage", `From the ${IROP.weaponFeeds[s.feed].noun} loaded`);
    if ( s.critical?.chance || s.critical?.damage ) add("Critical", `${signed(-(s.critical.chance ?? 0))} chance, +${s.critical.damage ?? 0} damage`);
    if ( s.category === "ranged" ) {
      const bands = Object.entries(IROP.rangeBands).filter(([k]) => s.range?.[k]?.tiles || s.range?.[k]?.dm)
        .map(([k, label]) => `${label} ${s.range[k].tiles} (${signed(s.range[k].dm)})`);
      if ( bands.length ) add("Range", bands.join(", "));
    }
    const armorFx = [["Shred", s.shred], ["Penetration", s.penetration], ["Destruction", s.destruction]].filter(([, n]) => n).map(([l, n]) => `${l} ${n}`);
    if ( armorFx.length ) add("Against armor", armorFx.join(", "));
    if ( s.blast ) add("Blast", `${s.blast} ${s.blast === 1 ? "tile" : "tiles"}`);
    if ( (s.feed === "magazine") && s.ammo?.max ) add("Magazine", s.ammo.max);
    else if ( s.feed && (s.feed !== "magazine") ) add("Feed", IROP.weaponFeeds[s.feed]?.label ?? s.feed);
  }
  if ( item.type === "armor" ) {
    add("Defense", s.defense ?? 0);
    add("Armor", s.points ?? 0);
    if ( s.barrier ) add("Barrier", s.barrier);
    const dr = Object.entries(s.dr ?? {}).filter(([, n]) => n).map(([k, n]) => `${IROP.damageTypes[k]?.label ?? k} ${n}`);
    if ( dr.length ) add("Damage reduction", dr.join(", "));
    const move = Object.entries(s.mobility ?? {}).filter(([, n]) => n).map(([k, n]) => `${signed(n)} ${IROP.speeds[k] ?? k}`);
    if ( move.length ) add("Mobility", move.join(", "));
    if ( s.dodges ) add("Dodges", signed(s.dodges));
  }
  if ( item.type === "gear" ) {
    if ( s.formula ) add("Effect", formulaInWords(s.formula));
    if ( (s.kind === "ammunition") && s.ammo?.damageType ) add("Ammunition", `${IROP.damageTypes[s.ammo.damageType]?.label ?? s.ammo.damageType} rounds`);
    if ( s.consumable ) add("Use", "Used up when used");
  }
  if ( item.type === "mod" ) add("Fits", IROP.modTargets[s.target] ?? "");
  // What it does for concealment (Johnald, 2026-10-10).
  if ( s.concealable ) add("Concealment", "Hidden by nature: does not count");
  else if ( (item.type === "mod") && s.concealsHost ) add("Concealment", "Hides what it is fitted to");
  if ( s.weight ) add("Weight", s.weight);
  return out;
}

/**
 * A store's sheet (Johnald, 2026-10-10). Whoever runs it (the GM, or a player the GM made
 * its owner) stocks the shelf by dragging items onto it, and sets each item's price, its
 * currency, a stock limit and whether players can see it, plus the store's markup and what it
 * buys back at. Players who can see the store buy from it at once, the price off their
 * character's sheet, and sell their own things back to it.
 */
export class StoreSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["irop", "store-sheet"],
    // Room for the list beside its detail panel, the tabs and the larger text with no scrolling (Johnald, 2026-10-16).
    position: { width: 900, height: 860 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      buy: StoreSheet.#onBuy,
      showImage: StoreSheet.#onShowImage,
      sell: StoreSheet.#onSell,
      switchView: StoreSheet.#onSwitchView,
      category: StoreSheet.#onCategory,
      catScroll: StoreSheet.#onCatScroll,
      pick: StoreSheet.#onPick,
      editItem: StoreSheet.#onEditItem,
      removeItem: StoreSheet.#onRemoveItem,
      toggleHidden: StoreSheet.#onToggleHidden,
      toggleLimited: StoreSheet.#onToggleLimited
    }
  };

  /** @override */
  static PARTS = {
    store: { template: "systems/irop/templates/actor/store.hbs", scrollable: [".store-sheet-body", ".shop-list", ".shop-detail"] }
  };

  /** Only the GM, who runs the store, saves its fields as they change; a shopper's form saves nothing. @inheritDoc */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    if ( options.document && (!options.document.isOwner || !game.user?.isGM) ) options.form = { ...(options.form ?? {}), submitOnChange: false };
    // Never taller than the screen it opens on.
    const room = globalThis.window?.innerHeight;
    if ( room && (options.position?.height > room - 40) ) options.position = { ...options.position, height: Math.max(500, room - 40) };
    return options;
  }

  /**
   * Running a store (its shelf, prices, stock, limits, markup) is the GM's alone: a player sees the
   * shop, even one given Owner of the store (bug, Johnald, 2026-10-10: "Players seem capable of
   * editing how much of an item a store has in stock").
   * @override
   */
  get isEditable() {
    return super.isEditable && !!game.user?.isGM;
  }

  /** The operative picked to buy with, by id. */
  #buyerId = null;

  /** Whoever runs the store sees Manage (the shelf to edit) or Shop (as players see it). */
  #view = "manage";

  /** The shop's category, and the item picked in it. */
  #category = "all";
  /** The first category tab on show: six at a time, with arrows (Johnald, 2026-10-16). */
  #catStart = 0;
  /** Set when a tab is picked, so the strip brings it into view once; the arrows then move freely. */
  #reveal = false;
  #selected = null;

  /** Whether this sheet shows the shop: always for a shopper; for whoever runs it, when chosen. */
  get shopView() {
    return !this.isEditable || (this.#view === "shop");
  }

  /** Hooks that redraw the sheet when the buyer's purse or kit changes. */
  #hooks = [];

  /** The store's picture full size, for detailed art (Johnald, 2026-10-16). */
  static #onShowImage() {
    const Popout = foundry.applications.apps.ImagePopout;
    return new Popout({ src: this.actor.img, uuid: this.actor.uuid, window: { title: this.actor.name } }).render({ force: true });
  }

  /** Buy for this operative (the enlistment terminal opens a store for the recruit it just made). */
  setBuyer(id) {
    this.#buyerId = id;
  }

  /** The operatives this user can buy for: their own, or any for a GM. */
  get buyers() {
    return (game.actors?.filter(a => (a.type === "operative") && (game.user.isGM || a.isOwner)) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Who is buying: the one picked, else the user's own character, else the first they can. */
  get buyer() {
    const list = this.buyers;
    return list.find(a => a.id === this.#buyerId) ?? list.find(a => a.id === game.user.character?.id) ?? list[0] ?? null;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const store = this.actor;
    const manage = this.isEditable;
    const buyer = this.buyer;
    const { markup, sellBack, preferred } = store.system;
    const items = store.items.filter(i => manage || !shelfOf(i).hidden)
      .sort((a, b) => (sectionIndex(a) - sectionIndex(b)) || a.name.localeCompare(b.name));
    const shelf = items.map((item, i) => {
      const s = shelfOf(item);
      const soldOut = s.limited && (s.stock < 1);
      // What it costs in each currency it takes; the player pays with the store's preferred
      // unless they pick another (2026-10-10). One they cannot afford cannot be picked.
      const options = acceptedCurrencies(item).map(currency => {
        const unit = storePrice(priceIn(item, currency), markup);
        return { currency, unit, text: priceText(unit, currency), affordable: !!buyer && (walletOf(buyer, currency) >= unit) };
      });
      const pick = options.find(o => (o.currency === preferred) && o.affordable) ?? options.find(o => o.affordable)
        ?? options.find(o => o.currency === preferred) ?? options[0] ?? null;
      for ( const o of options ) o.selected = o === pick;
      const affordable = options.some(o => o.affordable);
      const short = options.map(o => IROP.currencies[o.currency].label).join(" or ");
      return {
        id: item.id, name: item.name, img: item.img, typeLabel: typeLine(item) || (TYPE_LABELS[item.type] ?? item.type),
        section: shopSection(item), sectionLabel: SHOP_SECTIONS[sectionIndex(item)]?.label ?? "",
        heading: (i === 0) || (shopSection(items[i - 1]) !== shopSection(item)),
        options, pickPay: options.length > 1, pay: pick?.currency ?? "", priceText: pick?.text ?? "No price",
        prices: Object.entries(IROP.currencies).map(([key, c]) => ({
          key, label: c.label, price: priceIn(item, key), accepted: item.system.accepts?.[key] !== false
        })),
        limited: s.limited, stock: s.stock, hidden: s.hidden, soldOut, unpriced: !options.length, stackable: isStackable(item),
        canBuy: !!buyer && !soldOut && affordable,
        why: !options.length ? "No price set" : (!buyer ? "Choose a character to buy with"
          : (soldOut ? "Sold out" : (affordable ? "" : `Not enough ${short}`)))
      };
    });
    // Bought back in the store's preferred currency, if the item has a price in it.
    const sellable = (buyer && (sellBack > 0)) ? buyer.items.filter(i => isPhysical(i) && !unsellable(i))
      .map(i => {
        const currency = sellCurrency(i, preferred);
        return { item: i, currency, unit: buyBackPrice(priceIn(i, currency), sellBack) };
      })
      .filter(r => r.unit > 0)
      .sort((a, b) => a.item.name.localeCompare(b.item.name))
      .map(({ item, unit, currency }) => ({
        id: item.id, name: item.name, img: item.img, quantity: Number(item.system.quantity) || 0,
        many: (Number(item.system.quantity) || 0) > 1, priceText: priceText(unit, currency)
      })) : [];
    // The shop (Johnald, 2026-10-10): categories along the top, a list of what is on show, and
    // the picked item in full beside it. Selling is its own category.
    const shopView = this.shopView;
    const onShow = shelf.filter(r => !r.hidden);
    const categories = [{ key: "all", label: "All", count: onShow.length }]
      .concat(SHOP_SECTIONS.map(x => ({ key: x.key, label: x.label, count: onShow.filter(r => r.section === x.key).length }))
        .filter(c => c.count));
    const sellTab = (buyer && (sellBack > 0)) ? { key: "sell", label: "Sell", count: sellable.length, sell: true } : null;
    const category = (categories.some(c => c.key === this.#category) || (sellTab && (this.#category === "sell"))) ? this.#category : "all";
    for ( const c of [...categories, ...(sellTab ? [sellTab] : [])] ) c.active = c.key === category;
    // Six tabs on show at a time, the chosen one kept in view; Sell always shows, apart, on the right.
    const maxStart = Math.max(0, categories.length - CAT_TABS);
    const at = categories.findIndex(c => c.active);
    if ( (at >= 0) && this.#reveal ) {
      if ( at < this.#catStart ) this.#catStart = at;
      if ( at >= this.#catStart + CAT_TABS ) this.#catStart = at - CAT_TABS + 1;
    }
    this.#reveal = false;
    this.#catStart = Math.min(Math.max(0, this.#catStart), maxStart);
    const catNav = { tabs: categories.slice(this.#catStart, this.#catStart + CAT_TABS), back: this.#catStart > 0, more: this.#catStart < maxStart,
      scrolls: categories.length > CAT_TABS, sell: sellTab };
    const selling = category === "sell";
    const list = (selling ? sellable : onShow.filter(r => (category === "all") || (r.section === category)))
      .map((r, i, all) => ({ ...r, heading: !selling && (category === "all") && ((i === 0) || (all[i - 1].section !== r.section)) }));
    const picked = list.find(r => r.id === this.#selected) ?? list[0] ?? null;
    for ( const r of list ) r.picked = r === picked;
    const detail = (shopView && picked) ? await this.#detailFor(picked, { selling, buyer }) : null;

    const buyers = this.buyers;
    return Object.assign(context, {
      store, system: store.system, manage, isGM: !!game.user.isGM,
      shopView, categories, catNav, list, detail, selling,
      // The store's own fields to edit: whoever runs it, in Manage.
      editing: manage && !shopView,
      descriptionHTML: await TextEditor.enrichHTML(store.system.description ?? "", { relativeTo: store }),
      buyers: buyers.map(a => ({ id: a.id, name: a.name, selected: a.id === buyer?.id })),
      pickBuyer: buyers.length > 1,
      buyer: buyer ? { id: buyer.id, name: buyer.name, wallet: walletRows(buyer) } : null,
      shelf, sellable, markup, sellBack,
      markupText: markup ? `${markup > 0 ? "+" : ""}${markup}%` : "",
      currencies: IROP.currencyLabels,
      preferredLabel: IROP.currencies[preferred]?.label ?? "Credits"
    });
  }

  /** The picked item in full, for the shop's detail panel. */
  async #detailFor(row, { selling, buyer }) {
    const item = selling ? buyer?.items.get(row.id) : this.actor.items.get(row.id);
    if ( !item ) return null;
    const carried = buyer ? buyer.items.filter(i => (i.type === item.type) && (i.name === item.name))
      .reduce((n, i) => n + (Number(i.system.quantity) || 1), 0) : 0;
    return {
      ...row,
      selling,
      typeLine: typeLine(item),
      stats: itemStats(item),
      descriptionHTML: await TextEditor.enrichHTML(item.system.description ?? "", { relativeTo: item }),
      carried
    };
  }

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const mine = actor => actor && (actor.id === this.buyer?.id);
    const redraw = () => this.rendered && this.render();
    this.#hooks = [
      ["updateActor", Hooks.on("updateActor", actor => { if ( mine(actor) ) redraw(); })],
      ...["createItem", "updateItem", "deleteItem"].map(name => [name, Hooks.on(name, item => { if ( mine(item.parent) ) redraw(); })])
    ];
  }

  /** @inheritDoc */
  _onClose(options) {
    for ( const [name, id] of this.#hooks ) Hooks.off(name, id);
    this.#hooks = [];
    super._onClose(options);
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    // A shopper's sheet is read only, which Foundry shows by disabling every control. The
    // shopping ones (marked data-shop) are theirs to use.
    for ( const el of root.querySelectorAll("[data-shop]") ) el.disabled = false;
    // Picking who buys, and how many, changes nothing on the store.
    root.querySelector("select[data-buyer]")?.addEventListener("change", event => {
      event.stopPropagation();
      this.#buyerId = event.target.value;
      this.render();
    });
    for ( const el of root.querySelectorAll("[data-shop-qty], [data-pay]") ) el.addEventListener("change", event => event.stopPropagation());
    // How many to buy never above what is left, nor below one (Johnald, 2026-10-10); selling, never
    // above what is carried. The purchase itself checks the stock again.
    for ( const input of root.querySelectorAll("[data-shop-qty]") ) {
      const keep = () => {
        const max = input.hasAttribute("max") ? Math.floor(Number(input.getAttribute("max"))) : Infinity;
        const n = Math.floor(Number(input.value) || 1);
        const clamped = Math.max(1, Math.min(n, Math.max(1, max)));
        if ( String(clamped) !== input.value ) input.value = String(clamped);
      };
      input.addEventListener("input", keep);
      input.addEventListener("change", keep);
    }
    if ( !this.isEditable ) return;
    // The shelf's own fields (prices, which currencies buy it, stock) write the shelf item, not the store.
    for ( const input of root.querySelectorAll("[data-shelf-field]") ) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const item = this.actor.items.get(input.closest("[data-item-id]")?.dataset.itemId);
        if ( !item ) return;
        let value = input.value;
        if ( input.type === "checkbox" ) value = input.checked;
        else if ( input.type === "number" ) value = Math.max(0, Math.round(Number(input.value) || 0));
        item.update({ [input.dataset.shelfField]: value });
      });
    }
  }

  /* -------------------------------------------- */
  /*  Stocking the shelf                          */
  /* -------------------------------------------- */

  /**
   * An item dropped on the store goes on its shelf, as many in stock as were dropped; one of the
   * same name already there gets that much more stock, unless it is unlimited.
   * @override
   */
  async _onDropItem(event, item) {
    if ( !this.isEditable || !item ) return null;
    if ( item.parent?.uuid === this.actor.uuid ) return null;
    if ( !isPhysical(item) ) {
      ui.notifications.info("A store sells weapons, armor, gear and mods.");
      return null;
    }
    const same = this.actor.items.find(i => (i.type === item.type) && (i.name === item.name));
    if ( same ) {
      const s = shelfOf(same);
      if ( s.limited ) return same.update({ "flags.irop.shelf.stock": s.stock + Math.max(1, Math.floor(Number(item.system.quantity) || 1)) });
      ui.notifications.info(`${item.name} is already on the shelf.`);
      return null;
    }
    return stockShelf(this.actor, item.toObject());
  }

  /** The shelf item a control belongs to. */
  #shelfItem(target) {
    return this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId) ?? null;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** Manage or Shop, for whoever runs the store. */
  static #onSwitchView(event, target) {
    this.#view = target.dataset.view === "shop" ? "shop" : "manage";
    return this.render();
  }

  /** A shop category: its first item is picked. */
  /** The category arrows: one tab along either way. */
  static #onCatScroll(event, target) {
    this.#catStart += (target.dataset.dir === "back") ? -1 : 1;
    return this.render();
  }

  static #onCategory(event, target) {
    this.#category = target.dataset.category ?? "all";
    this.#reveal = true;
    this.#selected = null;
    return this.render();
  }

  /** An item picked in the shop's list, shown in full beside it. */
  static #onPick(event, target) {
    this.#selected = target.closest("[data-pick]")?.dataset.pick ?? null;
    return this.render();
  }

  static async #onBuy(event, target) {
    const item = this.#shelfItem(target);
    if ( !item ) return null;
    const buyer = this.buyer;
    if ( !buyer ) return ui.notifications.warn("Choose a character to buy with.");
    const row = target.closest("[data-item-id]");
    const qty = Number(row?.querySelector("[data-shop-qty]")?.value) || 1;
    // What the player pays with: the currency picked on the row, else the one it shows.
    const currency = row?.querySelector("select[data-pay]")?.value || row?.dataset.payCurrency || null;
    await buyFromStore({ store: this.actor, item, buyer, qty, currency });
    return this.render();
  }

  static async #onSell(event, target) {
    const buyer = this.buyer;
    const row = target.closest("[data-sell-id]");
    const item = buyer?.items.get(row?.dataset.sellId);
    if ( !item ) return null;
    const qty = Number(row.querySelector("[data-shop-qty]")?.value) || 1;
    await sellToStore({ store: this.actor, item, seller: buyer, qty });
    return this.render();
  }

  static #onEditItem(event, target) {
    return this.#shelfItem(target)?.sheet?.render(true) ?? null;
  }

  static async #onRemoveItem(event, target) {
    const item = this.#shelfItem(target);
    if ( !item || !this.isEditable ) return null;
    const ok = event?.shiftKey || await DialogV2.confirm({
      window: { title: "Take off the shelf" },
      content: `<p>Take <strong>${item.name}</strong> off ${this.actor.name}'s shelf?</p>`
    });
    return ok ? item.delete() : null;
  }

  static #onToggleHidden(event, target) {
    const item = this.#shelfItem(target);
    if ( !item || !this.isEditable ) return null;
    return item.update({ "flags.irop.shelf.hidden": !shelfOf(item).hidden });
  }

  static #onToggleLimited(event, target) {
    const item = this.#shelfItem(target);
    if ( !item || !this.isEditable ) return null;
    const s = shelfOf(item);
    return item.update({ "flags.irop.shelf.limited": !s.limited, "flags.irop.shelf.stock": s.limited ? s.stock : Math.max(1, s.stock) });
  }
}

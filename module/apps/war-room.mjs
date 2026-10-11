import { IROP } from "../config.mjs";
import { LAYERS } from "../rules/war-room-map.mjs";
import { PHASES } from "../rules/strategy.mjs";
import { getWarRoom, getStrategyRules, getStrategyScale, temperatureUnit } from "../settings.mjs";
import { ResourceLedger } from "./resources.mjs";
import { OdrBoard, TurnReport, confirmUndo } from "./odr.mjs";
import { lastTurn } from "../strategy/turn.mjs";
import { builtIn } from "../sheets/item-sheet.mjs";
import { EventsApp } from "./events.mjs";
import { cardsOn } from "../strategy/events.mjs";
import { inPlayLabel } from "../rules/events.mjs";
import { incursionAgainst, incursions, confirmLiberation } from "../strategy/losing-ground.mjs";
import { objectivesTaken } from "../rules/losing-ground.mjs";
import { territoryIntel, openJournal } from "../strategy/intel.mjs";
import { quickFacilities } from "../rules/war-room-map.mjs";
import { territoryWeather } from "../rules/weather.mjs";
import { dateInfo, onStrategyLayer, weatherSeason } from "../calendar.mjs";
import { CalendarApp } from "./calendar.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The War Room's windows (Strategy Layer step 2, 2026-10-08), Johnald's "Style A":
 * the Command Console with the map full width under a slim top bar, and a
 * territory card that floats over the map when a territory is clicked. The map
 * and its overlays are the scene itself (canvas/war-room.mjs).
 */

/** This user's overlay, Heat by default; a client setting, so each viewer picks their own. */
export function currentLayer() {
  try {
    const layer = game.settings.get("irop", "warRoomLayer");
    return LAYERS[layer] ? layer : "heat";
  }
  catch {
    return "heat";
  }
}

/* -------------------------------------------- */

/** The slim bar along the top of a War Room scene: the week, the Resistance's stock, the overlays. */
export class WarRoomBar extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-war-room-bar",
    classes: ["irop", "irop-war-room-bar"],
    window: { frame: false, positioned: true },
    position: { top: 70, width: "auto", height: "auto" },
    actions: {
      layer: WarRoomBar.#onLayer,
      testMap: WarRoomBar.#onTestMap,
      neighbours: WarRoomBar.#onNeighbours,
      settings: WarRoomBar.#onSettings,
      ledger: () => ResourceLedger.open(),
      odr: () => OdrBoard.open(),
      events: () => EventsApp.open(),
      incursion: () => OdrBoard.open("tactical"),
      advance: () => TurnReport.open(),
      undo: () => confirmUndo(),
      calendar: () => CalendarApp.open()
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/war-room-bar.hbs" }
  };

  /** Functions the canvas module hands in: the map's counts and the GM tools. */
  static tools = { mapCounts: () => ({ linked: 0, total: 0, regions: 0 }), testMap: () => null, neighbours: () => null };

  static #instance = null;

  /** Show the bar, or bring it up to date. */
  static show() {
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  /** Take the bar away (the scene is not a War Room). */
  static hide() {
    if ( this.#instance?.rendered ) this.#instance.close({ animate: false });
  }

  static refresh() {
    if ( this.#instance?.rendered ) this.#instance.render();
  }

  /** @override */
  async _prepareContext(options) {
    const state = getWarRoom();
    const layer = currentLayer();
    const counts = WarRoomBar.tools.mapCounts();
    return {
      state,
      phase: PHASES[state.phase] ?? state.phase,
      layers: Object.entries(LAYERS).map(([key, label]) => ({ key, label, active: key === layer })),
      isGM: !!game.user?.isGM,
      counts,
      // Only while setting up: once every territory is on the map, the note goes (step 5 made the bar longer).
      mapIncomplete: counts.linked < counts.total,
      unit: getStrategyScale().unit.toLowerCase(),
      undoWeek: game.user?.isGM ? (lastTurn()?.to ?? null) : null,
      // Step 7: Incursions under way, for everyone to see.
      incursions: incursions().length,
      // The calendar's date (2026-10-08), while the GM shows it on the Strategy Layer.
      date: onStrategyLayer() ? dateInfo() : null
    };
  }

  /** Centre the bar along the top of the screen. @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const width = this.element.offsetWidth || 600;
    this.setPosition({ left: Math.max(10, Math.round((window.innerWidth - width) / 2)) });
  }

  static async #onLayer(event, target) {
    await game.settings.set("irop", "warRoomLayer", target.dataset.layer);
  }

  static #onTestMap() {
    return WarRoomBar.tools.testMap();
  }

  static #onNeighbours() {
    return WarRoomBar.tools.neighbours();
  }

  static #onSettings() {
    return game.irop?.strategy?.openRules?.();
  }
}

/* -------------------------------------------- */

/**
 * A territory's card, floating over the map (Style A). It opens on the side of
 * the screen away from the territory clicked, so it never covers it.
 */
export class TerritoryCard extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-territory-card",
    classes: ["irop", "irop-territory-card"],
    window: { title: "Territory", icon: "fa-solid fa-map-location-dot", resizable: false },
    // 600 wide (Johnald, 2026-10-08: half as wide again), the numbers and the facilities side by side.
    position: { width: 600, height: "auto" },
    actions: {
      openSheet: TerritoryCard.#onOpenSheet, plan: TerritoryCard.#onPlan, liberate: TerritoryCard.#onLiberate,
      editArt: TerritoryCard.#onEditArt, openJournal: (event, target) => openJournal(target.dataset.uuid),
      rerollWeather: TerritoryCard.#onRerollWeather,
      neighbour: TerritoryCard.#onNeighbour
    }
  };

  /** What the canvas module hands in: marking a territory selected on the map. */
  static tools = { select: () => null };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/territory-card.hbs" }
  };

  static #instance = null;

  /** The territory shown. */
  territory = null;

  /**
   * Show a territory's card.
   * @param {Item} territory
   * @param {object} [options]
   * @param {"left"|"right"} [options.side]   Which side of the screen it opens on
   */
  static show(territory, { side = "right" } = {}) {
    this.#instance ??= new this();
    const card = this.#instance;
    card.territory = territory;
    const width = this.DEFAULT_OPTIONS.position.width;
    const left = (side === "left") ? 110 : Math.max(10, window.innerWidth - width - 330);
    // The name is on the card's header; the frame says what kind of place it is (Johnald, 2026-10-08).
    return card.render({ force: true, position: { left, top: 110 }, window: { title: getStrategyScale().unit } });
  }

  static hide() {
    if ( this.#instance?.rendered ) this.#instance.close({ animate: false });
  }

  /** The territory now shown, if the card is open. */
  static get showing() {
    return this.#instance?.rendered ? this.#instance.territory : null;
  }

  static refresh() {
    const card = this.#instance;
    if ( !card?.rendered || !card.territory ) return;
    const fresh = game.items?.get(card.territory.id);
    if ( !fresh ) return card.close({ animate: false });
    card.territory = fresh;
    card.render();
  }

  /** @override */
  async _prepareContext(options) {
    const t = this.territory;
    const s = t?.system ?? {};
    const rules = getStrategyRules();
    const max = rules.strengthMax || 10;
    return {
      name: t?.name ?? "",
      // The header (Johnald, 2026-10-08): the GM's image, else a banner in the holder's colour.
      art: s.art ?? "",
      controlKey: s.control ?? "genesis",
      canEditArt: !!game.user?.isGM && !!t?.update,
      kind: IROP.territoryKinds[s.kind]?.label ?? "",
      control: IROP.territoryControl[s.control] ?? "",
      // This turn's weather there (Johnald, 2026-10-08), the same for everyone until the turn moves on.
      weather: t ? (() => {
        const w = territoryWeather(t.id, s, getWarRoom().week, weatherSeason());
        const c = temperatureUnit() === "C";
        return { ...w, temp: c ? w.tempC : w.tempF, unit: c ? "C" : "F", other: c ? `${w.tempF}°F` : `${w.tempC}°C` };
      })() : null,
      canReroll: !!game.user?.isGM && !!t?.update,
      // Its journal, or the lore on its sheet, as far as this user may see it.
      intel: await territoryIntel(t),
      heatLabel: IROP.heatLevels[s.heat]?.label ?? "",
      heatResponse: IROP.heatLevels[s.heat]?.response ?? "",
      heatPips: [0, 1, 2, 3, 4].map(i => i < (s.heat ?? 0)),
      strength: s.strength ?? 0,
      strengthMax: max,
      strengthPct: Math.max(0, Math.min(100, Math.round(((s.strength ?? 0) / max) * 100))),
      reputation: `${(s.reputation ?? 0) > 0 ? "+" : ""}${s.reputation ?? 0} ${IROP.reputationLevels[String(s.reputation ?? 0)] ?? ""}`,
      megacity: s.kind === "megacity",
      objectives: s.kind === "megacity" ? Object.values(s.objectives ?? {}).filter(Boolean).length : 0,
      modifiers: s.modifiers ?? "",
      // Its sheet is the GM's (Johnald, 2026-10-10: no point to it for players; the card shows what they need).
      canOpen: !!game.user?.isGM && !!t,
      // The territories bordering it (Johnald, 2026-10-10), each opening its own card.
      neighbours: (s.neighbors ?? []).map(id => game.items?.get(id)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(n => ({ id: n.id, name: n.name, control: n.system?.control ?? "genesis", label: IROP.territoryControl[n.system?.control] ?? "" })),
      units: `${getStrategyScale().unit.toLowerCase()}s`,
      // Steps 4 and 5: Heat waiting for next week, upgrades built here, a mission planned here.
      pending: s.heatPending ? `${s.heatPending > 0 ? "+" : ""}${s.heatPending} next turn` : "",
      // What each side has here (Johnald, 2026-10-08), with the upgrades built here among the Rebellion's.
      facilities: quickFacilities(s, { upgrades: t?.id ? builtIn(t.id) : [], gm: !!game.user?.isGM }),
      sides: IROP.facilitySides,
      // Losing Ground (step 7): an Incursion coming, a Megacity ready to liberate or liberated.
      incursion: (() => {
        const i = t?.id ? incursionAgainst(t.id) : null;
        if ( !i ) return "";
        const weeks = Math.max(1, Math.round(Number(rules.incursionWeeks) || 1));
        return `Incursion from ${game.items?.get(i.source)?.name ?? "GENESIS"}: lands as turn ${i.week + weeks} starts`;
      })(),
      canLiberate: !!game.user?.isGM && (s.kind === "megacity") && (s.control !== "liberated") && (objectivesTaken(s) >= 3),
      base: (s.kind === "megacity") && (s.control === "liberated"),
      landmark: (s.kind === "megacity") ? (s.landmark ?? "") : "",
      landmarkBonus: (s.kind === "megacity") ? (s.landmarkBonus ?? "") : "",
      // Cards in play here (step 6).
      cards: t?.id ? cardsOn(t.id).map(c => ({ name: c.name, until: inPlayLabel({ week: c.getFlag("irop", "week"), system: c.system }) })) : [],
      canPlan: !!t?.id && (s.control !== "liberated") && !getWarRoom().tactical
    };
  }

  /** A missing art file falls back to the banner. @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector(".tc-art")?.addEventListener("error", event => {
      event.currentTarget.closest(".tc-header")?.classList.remove("with-art");
      event.currentTarget.remove();
    });
  }

  /** The GM rolls new weather for this territory, for everyone. */
  static #onRerollWeather(event) {
    event?.stopPropagation?.();
    const t = this.territory;
    if ( !game.user.isGM || !t?.update ) return null;
    return t.update({ "system.weatherSalt": (Number(t.system.weatherSalt) || 0) + 1 });
  }

  /** The GM picks the header image straight from the card. */
  static #onEditArt() {
    const t = this.territory;
    if ( !game.user.isGM || !t?.update ) return null;
    const Picker = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    return new Picker({ type: "image", current: t.system.art, callback: path => t.update({ "system.art": path }) }).render({ force: true });
  }

  /** A neighbour's name: its card, in place of this one, and its outline on the map. */
  static #onNeighbour(event, target) {
    const next = game.items?.get(target.dataset.id);
    if ( !next ) return null;
    this.territory = next;
    TerritoryCard.tools.select(next.id);
    return this.render({ window: { title: getStrategyScale().unit } });
  }

  static #onOpenSheet() {
    return this.territory?.sheet?.render({ force: true });
  }

  static #onPlan() {
    return OdrBoard.open("tactical", { territory: this.territory?.id });
  }

  static #onLiberate() {
    return confirmLiberation(this.territory);
  }
}

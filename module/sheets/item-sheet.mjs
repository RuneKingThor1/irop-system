import { IROP } from "../config.mjs";
import { effectChanges, describeChange } from "../rules/effects.mjs";
import { defaultNodeCost, moveNode, moveTier, removeNode, removeTier, treesFor } from "../rules/skill-trees.mjs";
import { linkNeighbors } from "../rules/strategy.mjs";
import { getStrategyRules, temperatureUnit, specializationRules } from "../settings.mjs";
import { salvageProgress, skillLabel } from "../rules/projects.mjs";
import { journalLink, openJournal } from "../strategy/intel.mjs";
import { quickFacilities } from "../rules/war-room-map.mjs";
import { weatherProfile, tempIn, spanIn, toF } from "../rules/weather.mjs";
import { liveBackground, perkMeta, takenPerk, withPerk, withoutPerk } from "../rules/backgrounds.mjs";
import { startingSkillPlan } from "../rules/starting-skills.mjs";
import { itemStats, typeLine } from "./store-sheet.mjs";
import { formulaInWords } from "./actor-sheet.mjs";
import { weaponPerkSummary } from "../rules/perks.mjs";
import { perkContext } from "../rolls.mjs";
import { stepValue, optionFromArchetype } from "../rules/paraphysics.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

const T = "systems/irop/templates/item";

/** Item types with no Effects tab. */
const NO_EFFECTS = ["skillTree", "territory", "project"];

/**
 * Item types whose Description tab shows players what the Details tab holds (a background's skills
 * and perks, the others' stats or dossier), so players get no Details tab at all (Johnald,
 * 2026-10-10: backgrounds first, then "the same for items, gear, weapons, and armor", "for the Roles
 * and Species too", "for boons and mutations as well as the perks themselves"). A perk tree, a
 * territory or a project keeps its Details tab for players, read only like every item sheet.
 */
const GM_WRITES = ["background", "weapon", "armor", "gear", "mod", "role", "species", "ability", "boon", "mutation"];

/** Item types whose stats show on the Description tab, as the shop shows them. */
const PHYSICAL = ["weapon", "armor", "gear", "mod"];

/** One sheet for every item type; the Details tab swaps its template by type. */
export class IropItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["irop", "item-sheet"],
    position: { width: 560, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      createEffect: IropItemSheet.#onCreateEffect,
      editEffect: IropItemSheet.#onEditEffect,
      deleteEffect: IropItemSheet.#onDeleteEffect,
      toggleEffect: IropItemSheet.#onToggleEffect,
      addTier: IropItemSheet.#onAddTier,
      addPhase: IropItemSheet.#onAddPhase,
      deletePhase: IropItemSheet.#onDeletePhase,
      moveTier: IropItemSheet.#onMoveTier,
      deleteTier: IropItemSheet.#onDeleteTier,
      deleteNode: IropItemSheet.#onDeleteNode,
      openNode: IropItemSheet.#onOpenNode,
      removeNeighbor: IropItemSheet.#onRemoveNeighbor,
      openTerritory: IropItemSheet.#onOpenTerritory,
      toggleSkill: IropItemSheet.#onToggleSkill,
      openJournal: IropItemSheet.#onOpenJournal,
      unlinkJournal: IropItemSheet.#onUnlinkJournal,
      addFacility: IropItemSheet.#onAddFacility,
      removeFacility: IropItemSheet.#onRemoveFacility,
      customizeWeather: IropItemSheet.#onCustomizeWeather,
      resetWeather: IropItemSheet.#onResetWeather,
      openPerk: IropItemSheet.#onOpenPerk,
      roleTree: IropItemSheet.#onRoleTree,
      openTreePerk: IropItemSheet.#onOpenTreePerk,
      openTree: IropItemSheet.#onOpenTree,
      deletePerk: IropItemSheet.#onDeletePerk,
      newPerk: IropItemSheet.#onNewPerk,
      // A power's Rank 3 options (2026-10-19).
      addPowerOption: IropItemSheet.#onAddPowerOption,
      removePowerOption: IropItemSheet.#onRemovePowerOption,
      addPowerEvolution: IropItemSheet.#onAddPowerEvolution,
      removePowerEvolution: IropItemSheet.#onRemovePowerEvolution
    }
  };

  /** A perk tree opens wider, to fit its tiers. @inheritDoc */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    if ( options.document?.type === "skillTree" ) Object.assign(options.position, { width: 760, height: 760 });
    return options;
  }

  /** @override */
  static PARTS = {
    header: { template: `${T}/header.hbs` },
    tabs: { template: "systems/irop/templates/actor/tabs.hbs" },
    description: { template: `${T}/description.hbs`, scrollable: [""] },
    details: { template: `${T}/details-weapon.hbs`, scrollable: [""] },
    // A power's five ranks, each the GM's to write (Johnald, 2026-10-19).
    ranks: { template: `${T}/power-ranks.hbs`, scrollable: [""] },
    // A role's perk trees, to read (Johnald, 2026-10-17).
    trees: { template: `${T}/role-trees.hbs`, scrollable: [""] },
    effects: { template: `${T}/effects.hbs`, scrollable: [""] }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "description", label: "Description", icon: "fa-solid fa-align-left" },
        { id: "details", label: "Details", icon: "fa-solid fa-sliders" },
        { id: "ranks", label: "Ranks", icon: "fa-solid fa-layer-group" },
        { id: "trees", label: "Perk trees", icon: "fa-solid fa-sitemap" },
        { id: "effects", label: "Effects", icon: "fa-solid fa-wand-sparkles" }
      ],
      initial: "details"
    }
  };

  /**
   * Players never change an item (Johnald, 2026-10-10: "I dont want players editing any items"):
   * every item sheet is read only for them, their own character's copies included. Foundry then
   * disables every field and button on it (DocumentSheetV2#_toggleDisabled). What they change in
   * play (ammo, fuel, counts, equipping, stowing, uses left) is on the character sheet.
   * Two allowances, same day ("I will allow players to rename weapons and armor on their sheet.
   * They are also allowed to create simple items in gear"): gear a player made themselves is
   * theirs to name, picture and describe (its stats stay the GM's, its Details tab hidden); and
   * their weapons and armor they may rename (canRename), nothing more.
   * @override
   */
  get isEditable() {
    if ( !this.#permitted ) return false;
    return !!game.user?.isGM || this.isHomebrew;
  }

  /** Whether Foundry's own rules let this user change the item: they own it, it is not in a locked compendium. */
  get #permitted() {
    return super.isEditable;
  }

  /** A paraphysical power: an ability with a discipline. */
  get isPower() {
    return (this.item?.type === "ability") && !!this.item.system?.paraphysics?.discipline;
  }

  /**
   * A power's Rank 3 options come back from the form keyed by their place in the list; they go back
   * to the item as the list (2026-10-19).
   * @inheritDoc
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    // A weapon's phases come back keyed by index; they are a list (2026-10-23).
    const phases = foundry.utils.getProperty(data, "system.phases");
    if ( phases && !Array.isArray(phases) ) {
      foundry.utils.setProperty(data, "system.phases", Object.keys(phases).sort((a, b) => Number(a) - Number(b)).map(k => phases[k]));
    }
    // A power's Rank 3 options and Rank 5 evolutions come back keyed by index; they are lists.
    for ( const key of ["options", "evolutions"] ) {
      const list = foundry.utils.getProperty(data, `system.paraphysics.${key}`);
      if ( list && !Array.isArray(list) ) {
        foundry.utils.setProperty(data, `system.paraphysics.${key}`, Object.keys(list).sort((a, b) => Number(a) - Number(b)).map(k => list[k]));
      }
    }
    return data;
  }

  /** Gear a player made on their own sheet, from the Gear tab: a trinket of their own. */
  get isHomebrew() {
    return (this.item.type === "gear") && !!this.item.flags?.irop?.homebrew;
  }

  /** A player's own weapon or armor: theirs to rename, not to change. */
  get canRename() {
    return !this.isEditable && this.#permitted && ["weapon", "armor"].includes(this.item.type);
  }

  /**
   * The Effects tab. A perk tree, a territory or a project carries no effects of its own. On the
   * rest it is the GM's: players never see it on an item sheet (Johnald, 2026-10-10, following
   * the character sheet; item sheets have no Edit mode to show it in).
   */
  get showsEffects() {
    return !NO_EFFECTS.includes(this.item.type) && !!game.user?.isGM;
  }

  /**
   * The Details tab. A background's, a weapon's, armor's, gear's or mod's is the GM's: not for a
   * player to change, even on the copy their character owns (Johnald, 2026-10-10: "players cannot
   * access the details tab of backgrounds", then the same for the rest). Players read them on the
   * Description tab: a background's skills and perks, the others' stats.
   */
  get showsDetails() {
    return !GM_WRITES.includes(this.item.type) || !!game.user?.isGM;
  }

  /** Without its Details tab, the sheet opens on its Description. @inheritDoc */
  _getTabsConfig(group) {
    let config = super._getTabsConfig(group);
    if ( (group !== "primary") || !config ) return config;
    // Perk trees only on a role (2026-10-17).
    if ( this.item.type !== "role" ) config = { ...config, tabs: config.tabs.filter(t => t.id !== "trees") };
    // Ranks only on a power: an ability with a discipline (2026-10-19).
    if ( !this.isPower ) config = { ...config, tabs: config.tabs.filter(t => t.id !== "ranks") };
    if ( this.showsDetails ) return config;
    return { ...config, tabs: config.tabs.filter(t => t.id !== "details"), initial: "description" };
  }

  /**
   * Foundry starts a sheet on its TABS initial tab, set when the sheet is made, so a player opening a
   * background would land on the Details tab they no longer get, with nothing showing (Johnald,
   * 2026-10-10: "opening it for a player defaults to having opened the Description Tab"). A tab
   * this viewer does not get falls back to their first: the Description.
   * @inheritDoc
   */
  _prepareTabs(group) {
    const config = this._getTabsConfig(group);
    if ( config?.tabs?.length && !config.tabs.some(t => t.id === this.tabGroups[group]) ) {
      this.tabGroups[group] = config.initial ?? config.tabs[0].id;
    }
    return super._prepareTabs(group);
  }

  /** Point the Details part at this item type's template. */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.details.template = `${T}/details-${this.item.type}.hbs`;
    if ( !this.showsDetails ) delete parts.details;
    if ( !this.showsEffects ) delete parts.effects;
    if ( this.item.type !== "role" ) delete parts.trees;
    if ( !this.isPower ) delete parts.ranks;
    return parts;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const system = item.system;
    // A background's Description tab (Johnald, 2026-10-10): its starting skills, then its perks as banners.
    const skillChoices = (item.type === "background") ? backgroundSkillChoices(item) : null;
    const perkBanners = ["background", "species"].includes(item.type) ? await backgroundPerkBanners(item) : null;
    // What the hidden Details tab held, read only, under the description (2026-10-10).
    const itemFacts = itemFactsFor(item);
    const attributes = Object.fromEntries(Object.entries(IROP.attributes).map(([k, a]) => [k, a.label]));
    if ( !this.showsEffects && context.tabs ) delete context.tabs.effects;
    return Object.assign(context, {
      item,
      system,
      systemSource: system._source,
      config: IROP,
      attributes,
      editable: this.isEditable,
      canRename: this.canRename,
      // On a store's shelf, how many the store has is its stock there, not a quantity (2026-10-10).
      onShelf: item.parent?.type === "store",
      isGM: !!game.user?.isGM,
      typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
      accent: IROP.roles[system.source ?? system.role]?.color ?? null,
      descriptionHTML: await TextEditor.enrichHTML(system.description ?? "", {
        relativeTo: item, rollData: item.getRollData(), secrets: item.isOwner
      }),
      damageTypes: Object.fromEntries(Object.entries(IROP.damageTypes).map(([k, t]) => [k, t.label])),
      // Paraphysics (Framework Draft 0.6, 2026-10-19): a power's tracks and Rank 3 archetypes, a species' casting.
      powerTrackOptions: Object.fromEntries(Object.entries(IROP.powerTracks).map(([k, t]) => [k, t.label])),
      // A power's Ranks tab (2026-10-19).
      powerRanks: this.isPower ? powerRanksContext(system.paraphysics) : null,
      attributeOptions: Object.fromEntries(Object.entries(IROP.attributes).map(([k, a]) => [k, a.label])),

      speciesBonuses: (item.type === "species") ? Object.entries(IROP.disciplines).map(([key, label]) => ({ key, label,
        value: item.system.paraphysics?.bonus?.[key] ?? 0 })) : [],
      // Special ammo effects, on ammunition gear only (Johnald, 2026-10-08).
      isAmmo: (item.type === "gear") && (system.kind === "ammunition"),
      // Chemthrower fuel and burn settings, on fuel fed weapons only (2026-10-08).
      isFuel: (item.type === "weapon") && (system.feed === "fuel"),
      burnStatuses: { "": "None", ...Object.fromEntries(IROP.statusEffects.map(e => [e.id, e.name])) },
      ammoDamageTypes: { "": "Weapon's own", ...Object.fromEntries(Object.entries(IROP.damageTypes).map(([k, t]) => [k, t.label])) },
      ammoStatuses: { "": "None", ...Object.fromEntries(IROP.statusEffects.map(e => [e.id, e.name])) },
      // A weapon's phases (2026-10-23), each with its own range table.
      phaseRows: (item.type === "weapon") ? (system.phases ?? []).map((ph, i) => ({ ...ph, i,
        bands: Object.entries(IROP.rangeBands).map(([key, label]) => ({ key, label, tiles: ph.range?.[key]?.tiles, dm: ph.range?.[key]?.dm })) })) : null,
      phaseSaves: { "": "None", ...Object.fromEntries(Object.entries(IROP.attributes).map(([k, a]) => [k, a.label])) },
      rangeBands: Object.entries(IROP.rangeBands).map(([key, label]) => ({
        key, label, tiles: system.range?.[key]?.tiles, dm: system.range?.[key]?.dm
      })),
      drRows: system.dr && (item.type === "armor")
        ? Object.entries(IROP.damageTypes).map(([key, t]) => ({ key, label: t.label, value: system.dr[key] }))
        : null,
      mobilityRows: item.type === "armor"
        ? Object.entries(IROP.speeds).map(([key, label]) => ({ key, label, value: system.mobility[key] }))
        : null,
      speciesAttributes: item.type === "species"
        ? Object.entries(IROP.attributes).map(([key, a]) => ({ key, label: a.label, abbr: a.abbr, value: system.attributes[key] }))
        : null,
      // The perk tree editor (2026-10-08).
      treeTiers: item.type === "skillTree" ? treeEditorTiers(system) : null,
      // A role's perk trees, to read (2026-10-17).
      roleTrees: item.type === "role" ? roleTreesContext(item, this.#roleTree) : null,
      // Background perks (2026-10-10): the list, which only a GM changes.
      backgroundPerks: ["background", "species"].includes(item.type) ? backgroundPerkRows(system) : null,
      // The same perks as banners under the description, for everyone, below the starting skills.
      skillChoices,
      perkBanners, perkBannersTitle: (item.type === "species") ? "Species perks" : "Background perks",
      itemFacts,
      // Anything under it: the description is as tall as its text.
      hasExtras: !!(skillChoices?.skills.length || perkBanners?.length || itemFacts?.stats.length),
      // Descriptions are the GM's to write: players read them, with no editor at all, even on their
      // own character's copy (Johnald, 2026-10-10).
      readOnlyDescription: !this.isEditable,
      canEditPerks: ["background", "species"].includes(item.type) && this.isEditable && !!game.user?.isGM,
      // The territory sheet (2026-10-08).
      territory: item.type === "territory" ? territoryContext(item) : null,
      // The project sheet (step 5, 2026-10-08).
      project: item.type === "project" ? projectContext(item) : null,
      defaultSlots: system.slots ?? null,
      fitted: (system.mods ?? []).map(m => m.name).join(", "),
      effects: item.effects.map(e => ({
        id: e.id, name: e.name, img: e.img, disabled: e.disabled,
        changes: effectChanges(e).map(describeChange).join("; ")
      }))
    });
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.tab = context.tabs?.[partId];
    return context;
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if ( context.accent ) this.element.style.setProperty("--irop-accent", context.accent);
    if ( this.canRename ) this.#activateRename();
    if ( this.item.type === "skillTree" ) this.#activateTreeEditor();
    if ( ["background", "species"].includes(this.item.type) ) this.#activatePerkDrop();
    if ( this.item.type === "territory" ) {
      this.#activateNeighbors();
      this.#activateJournal();
      this.#activateFacilities();
      this.#activateWeather();
    }
  }

  /* -------------------------------------------- */
  /*  Territories (2026-10-08)                    */
  /* -------------------------------------------- */

  /** Territories dropped on the Neighbours box border this one, both ways. */
  #activateNeighbors() {
    const zone = this.element.querySelector("[data-neighbor-drop]");
    if ( !zone || !this.isEditable ) return;
    zone.addEventListener("dragover", event => {
      event.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async event => {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.remove("drag-over");
      let data;
      try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
      catch(err) { return; }
      if ( data?.type !== "Item" ) return;
      const other = await foundry.utils.fromUuid(data.uuid);
      if ( (other?.type !== "territory") || other.parent || other.pack ) {
        ui.notifications.warn("Drop a territory from the Items sidebar.");
        return;
      }
      await setNeighbors(this.item, other, true);
    });
  }

  /** A journal entry or page dropped on the Journal box is the one the territory's card shows. */
  #activateJournal() {
    const zone = this.element.querySelector("[data-journal-drop]");
    if ( !zone || !this.isEditable ) return;
    zone.addEventListener("dragover", event => {
      event.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async event => {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.remove("drag-over");
      let data;
      try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
      catch(err) { return; }
      if ( !["JournalEntry", "JournalEntryPage"].includes(data?.type) || !data.uuid ) {
        ui.notifications.warn("Drop a journal entry or a journal page.");
        return;
      }
      if ( String(data.uuid).startsWith("Compendium.") ) {
        ui.notifications.warn("Import the journal into the world first, so players can be given permission to see it.");
        return;
      }
      await this.item.update({ "system.journal": data.uuid });
    });
  }

  /** A facility row's field changed: the whole list is saved, as the Personnel Record's log is. */
  #activateFacilities() {
    if ( !this.isEditable ) return;
    for ( const input of this.element.querySelectorAll("[data-facility-field]") ) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const side = input.closest("[data-facility-side]")?.dataset.facilitySide;
        const index = Number(input.closest("[data-facility-index]")?.dataset.facilityIndex);
        const list = foundry.utils.deepClone(this.item.system._source.facilities?.[side] ?? []);
        if ( !list[index] ) return;
        const field = input.dataset.facilityField;
        list[index][field] = (input.type === "checkbox") ? input.checked : input.value;
        this.item.update({ [`system.facilities.${side}`]: list });
      });
    }
  }

  /** The custom weather's temperatures, typed in this user's unit and kept in degrees F. */
  #activateWeather() {
    if ( !this.isEditable ) return;
    for ( const input of this.element.querySelectorAll("[data-weather-temp]") ) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const field = input.dataset.weatherTemp;
        const f = toF(input.value, temperatureUnit(), { span: field !== "base" });
        this.item.update({ [`system.weather.${field}`]: (field === "base") ? f : Math.max(0, f) });
      });
    }
  }

  /** Start the territory's own weather from its climate's numbers. */
  static #onCustomizeWeather() {
    const s = this.item.system;
    const p = weatherProfile({ climate: s.climate, megacity: s.kind === "megacity", modifiers: s.modifiers });
    return this.item.update({ "system.weather": { custom: true, base: p.base, swing: p.swing, spread: p.spread, weights: p.weights } });
  }

  static #onResetWeather() {
    return this.item.update({ "system.weather.custom": false });
  }

  static #onAddFacility(event, target) {
    const side = target.dataset.side;
    if ( !IROP.facilitySides[side] ) return null;
    const list = foundry.utils.deepClone(this.item.system._source.facilities?.[side] ?? []);
    list.push({ name: "", note: "", down: false, hidden: false });
    return this.item.update({ [`system.facilities.${side}`]: list });
  }

  static #onRemoveFacility(event, target) {
    const side = target.closest("[data-facility-side]")?.dataset.facilitySide;
    const index = Number(target.closest("[data-facility-index]")?.dataset.facilityIndex);
    const list = foundry.utils.deepClone(this.item.system._source.facilities?.[side] ?? []);
    list.splice(index, 1);
    return this.item.update({ [`system.facilities.${side}`]: list });
  }

  static #onOpenJournal() {
    return openJournal(journalLink(this.item).uuid);
  }

  static #onUnlinkJournal() {
    return this.item.update({ "system.journal": "" });
  }

  static #territoryOf(target) {
    return game.items?.get(target.closest("[data-territory-id]")?.dataset.territoryId) ?? null;
  }

  static #onRemoveNeighbor(event, target) {
    const other = IropItemSheet.#territoryOf(target);
    const id = target.closest("[data-territory-id]")?.dataset.territoryId;
    if ( other ) return setNeighbors(this.item, other, false);
    // A neighbour that no longer exists: just drop the dangling id.
    return this.item.update({ "system.neighbors": this.item.system.neighbors.filter(n => n !== id) });
  }

  static #onOpenTerritory(event, target) {
    return IropItemSheet.#territoryOf(target)?.sheet.render({ force: true });
  }

  /** A project's specialization: a click adds or takes away a skill. */
  static #onToggleSkill(event, target) {
    if ( !this.isEditable ) return null;
    const skill = target.dataset.skill;
    const now = [...this.item.system.specialization];
    const next = now.includes(skill) ? now.filter(k => k !== skill) : [...now, skill];
    return this.item.update({ "system.specialization": next });
  }

  /**
   * A player's own weapon or armor: the name field alone is open (Foundry disabled every field of
   * the read only sheet), and saves itself, the sheet's own form being closed to them.
   */
  #activateRename() {
    const input = this.element.querySelector('input[name="name"]');
    if ( !input ) return;
    input.disabled = false;
    input.addEventListener("change", event => {
      event.stopPropagation();
      const name = input.value.trim();
      if ( !name ) {
        input.value = this.item.name;
        return;
      }
      if ( name !== this.item.name ) this.item.update({ name });
    });
  }

  /* -------------------------------------------- */
  /*  Background perks (2026-10-10)               */
  /* -------------------------------------------- */

  /** A GM drops abilities on the list to offer them as this background's perks. */
  #activatePerkDrop() {
    const zone = this.element.querySelector("[data-perk-drop]");
    if ( !zone ) return;
    zone.addEventListener("dragover", event => {
      event.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async event => {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.remove("drag-over");
      let data;
      try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
      catch(err) { return; }
      if ( data?.type !== "Item" ) return;
      const ability = await foundry.utils.fromUuid(data.uuid);
      if ( ability?.type !== "ability" ) return ui.notifications.warn(`Only abilities can be a ${this.item.type}'s perks.`);
      if ( ability.parent ) return ui.notifications.warn("Drag the ability from the Items sidebar or a compendium, not from a character.");
      return this.#addPerk(ability);
    });
  }

  /** Put an ability on this background's perk list. */
  #addPerk(ability) {
    const perks = withPerk(foundry.utils.deepClone(this.item.system._source.perks ?? []), ability, foundry.utils.randomID());
    if ( !perks ) return ui.notifications.warn(`${ability.name} is already one of ${this.item.name}'s perks.`);
    return this.item.update({ "system.perks": perks });
  }

  /** The role's tree on show in its Perk trees tab. */
  #roleTree = "";

  /** Perk trees tab: show another tree, without a re-render. */
  static #onRoleTree(event, target) {
    this.#roleTree = target.dataset.treeId;
    const panel = target.closest(".role-trees");
    for ( const el of panel?.querySelectorAll("[data-tree-id]") ?? [] ) el.classList.toggle("active", el.dataset.treeId === this.#roleTree);
  }

  /** Perk trees tab: a perk's ability, to read. */
  static async #onOpenTreePerk(event, target) {
    const ability = target.dataset.uuid ? await foundry.utils.fromUuid(target.dataset.uuid) : null;
    if ( !ability ) return ui.notifications.warn("That perk's ability is missing from the world. The GM can fix the tree.");
    return ability.sheet.render({ force: true });
  }

  /** Perk trees tab, GM: open the tree itself, to edit. */
  static #onOpenTree(event, target) {
    if ( !game.user.isGM ) return null;
    return game.items?.get(target.dataset.treeId)?.sheet.render({ force: true });
  }

  static async #onOpenPerk(event, target) {
    const perk = this.item.system.perks.find(p => p.id === target.closest("[data-perk-id]")?.dataset.perkId);
    const ability = perk?.uuid ? await foundry.utils.fromUuid(perk.uuid) : null;
    if ( !ability ) return ui.notifications.warn("That ability is missing from the world. Take it off the list, or drop it in again.");
    return ability.sheet.render({ force: true });
  }

  static #onDeletePerk(event, target) {
    if ( !game.user.isGM ) return null;
    const id = target.closest("[data-perk-id]")?.dataset.perkId;
    return this.item.update({ "system.perks": withoutPerk(foundry.utils.deepClone(this.item.system._source.perks ?? []), id) });
  }

  /**
   * A new perk, written from here: a passive ability in the Items sidebar's Background Perks
   * folder, put on the list and opened to be filled in.
   */
  /** Add a Rank 3 option: a copy of a library archetype (picked beside the button), or a blank custom one. */
  static async #onAddPowerOption(event, target) {
    const p = this.item.system.paraphysics;
    const options = foundry.utils.deepClone(this.item.system._source.paraphysics.options ?? []);
    const id = foundry.utils.randomID();
    if ( target.dataset.kind === "library" ) {
      const key = this.element.querySelector("select.power-library-pick")?.value;
      const option = optionFromArchetype(key, id);
      if ( !option ) return null;
      options.push(option);
    }
    else options.push({ id, archetype: "", label: "New option", text: "" });
    return this.item.update({ "system.paraphysics.options": options, ...(p.choice && !options.some(o => o.id === p.choice) ? { "system.paraphysics.choice": "" } : {}) });
  }

  /** Remove a Rank 3 option; if it was the one taken, the choice opens again. */
  static async #onRemovePowerOption(event, target) {
    const p = this.item.system.paraphysics;
    const id = target.closest("[data-option-id]")?.dataset.optionId;
    const options = (this.item.system._source.paraphysics.options ?? []).filter(o => o.id !== id);
    return this.item.update({ "system.paraphysics.options": options, ...((p.choice === id) ? { "system.paraphysics.choice": "" } : {}) });
  }

  /** Add a Rank 5 evolution (2026-10-29): a power offers two, the player picks one. */
  static async #onAddPowerEvolution() {
    const evolutions = foundry.utils.deepClone(this.item.system._source.paraphysics.evolutions ?? []);
    evolutions.push({ id: foundry.utils.randomID(), name: "New evolution", text: "" });
    return this.item.update({ "system.paraphysics.evolutions": evolutions });
  }

  /** Remove a Rank 5 evolution; if it was the one taken, the pick opens again. */
  static async #onRemovePowerEvolution(event, target) {
    const p = this.item.system.paraphysics;
    const id = target.closest("[data-evolution-id]")?.dataset.evolutionId;
    const evolutions = (this.item.system._source.paraphysics.evolutions ?? []).filter(e => e.id !== id);
    return this.item.update({ "system.paraphysics.evolutions": evolutions, ...((p.evolved === id) ? { "system.paraphysics.evolved": "" } : {}) });
  }

  static async #onNewPerk() {
    if ( !game.user.isGM ) return null;
    // A species' perks go in their own folder, filed as Species abilities (2026-10-20).
    const species = this.item.type === "species";
    const folderName = species ? "Species Perks" : "Background Perks";
    const folder = game.folders?.find(f => (f.type === "Item") && (f.name === folderName))
      ?? await CONFIG.Folder.documentClass.create({ name: folderName, type: "Item" });
    const ability = await CONFIG.Item.documentClass.create({
      name: "New Perk", type: "ability", folder: folder?.id ?? null,
      system: { kind: "passive", source: species ? "species" : "background", tree: this.item.name }
    });
    if ( !ability ) return null;
    await this.#addPerk(ability);
    return ability.sheet.render({ force: true });
  }

  /* -------------------------------------------- */
  /*  Perk tree editor (2026-10-08)              */
  /* -------------------------------------------- */

  /**
   * Tier and node fields edit the tiers array as a whole, outside the form; drop
   * zones take abilities and perks dragged between tiers.
   */
  #activateTreeEditor() {
    const root = this.element;
    for ( const input of root.querySelectorAll("[data-tree-field]") ) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const field = input.dataset.treeField;
        const nodeId = input.closest("[data-node-id]")?.dataset.nodeId;
        const tierIndex = Number(input.closest("[data-tier]")?.dataset.tier);
        this.#editTiers(tiers => {
          if ( field === "exclusive" ) tiers[tierIndex].exclusive = input.checked;
          else {
            const node = tiers.flatMap(t => t.nodes).find(n => n.id === nodeId);
            if ( !node ) return tiers;
            node[field] = (field === "xp") ? Math.max(0, Math.round(Number(input.value) || 0)) : input.value;
          }
          return tiers;
        });
      });
    }
    if ( !this.isEditable ) return;
    for ( const node of root.querySelectorAll(".tree-node-edit[draggable]") ) {
      node.addEventListener("dragstart", event => {
        event.stopPropagation();
        event.dataTransfer.setData("text/plain", JSON.stringify({
          type: "IropTreeNode", tree: this.item.uuid, node: node.dataset.nodeId
        }));
      });
    }
    for ( const zone of root.querySelectorAll(".tree-drop") ) {
      zone.addEventListener("dragover", event => {
        event.preventDefault();
        zone.classList.add("drag-over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", event => this.#onTreeDrop(event, zone));
    }
  }

  /** Change the tiers: `fn` gets a copy and returns the new list. */
  #editTiers(fn) {
    const tiers = fn(foundry.utils.deepClone(this.item.system._source.tiers));
    return this.item.update({ "system.tiers": tiers });
  }

  /** An ability dropped on a tier joins it; a perk dragged from another tier moves. */
  async #onTreeDrop(event, zone) {
    event.preventDefault();
    event.stopPropagation();
    zone.classList.remove("drag-over");
    let data;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
    catch(err) { return null; }
    const tiers = foundry.utils.deepClone(this.item.system._source.tiers);
    const fresh = zone.dataset.tier === "new";
    const to = fresh ? tiers.length : Number(zone.dataset.tier);
    if ( fresh ) tiers.push({ exclusive: false, nodes: [] });

    if ( data?.type === "IropTreeNode" ) {
      if ( data.tree !== this.item.uuid ) return null;
      return this.item.update({ "system.tiers": moveNode(tiers, data.node, to) });
    }
    if ( data?.type !== "Item" ) return null;
    const ability = await foundry.utils.fromUuid(data.uuid);
    if ( ability?.type !== "ability" ) {
      ui.notifications.warn("Only abilities go in a perk tree.");
      return null;
    }
    if ( ability.parent ) {
      ui.notifications.warn("Drag the ability from the Items sidebar or a compendium, not from a character.");
      return null;
    }
    if ( tiers.some(t => t.nodes.some(n => n.uuid === ability.uuid)) ) {
      ui.notifications.warn(`${ability.name} is already in this tree.`);
      return null;
    }
    tiers[to].nodes.push({
      id: foundry.utils.randomID(), uuid: ability.uuid, name: ability.name, img: ability.img,
      xp: defaultNodeCost(tiers, to), requires: ""
    });
    return this.item.update({ "system.tiers": tiers });
  }

  static #tierOf(target) {
    return Number(target.closest("[data-tier]")?.dataset.tier);
  }

  /** A weapon's phases: add one, starting from the weapon's own numbers (2026-10-23). */
  static async #onAddPhase() {
    const phases = foundry.utils.deepClone(this.item.system._source.phases ?? []);
    phases.push({ id: foundry.utils.randomID(), label: `Phase ${phases.length + 1}` });
    return this.item.update({ "system.phases": phases });
  }

  static async #onDeletePhase(event, target) {
    const i = Number(target.dataset.index);
    const phases = foundry.utils.deepClone(this.item.system._source.phases ?? []).filter((_, n) => n !== i);
    return this.item.update({ "system.phases": phases });
  }

  static #onAddTier() {
    return this.#editTiers(tiers => [...tiers, { exclusive: false, nodes: [] }]);
  }

  static #onMoveTier(event, target) {
    const index = IropItemSheet.#tierOf(target);
    return this.#editTiers(tiers => moveTier(tiers, index, Number(target.dataset.delta)));
  }

  static async #onDeleteTier(event, target) {
    const index = IropItemSheet.#tierOf(target);
    const count = this.item.system.tiers[index]?.nodes.length ?? 0;
    if ( count ) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Delete tier" },
        content: `<p>Delete Tier ${index + 1} and the ${count} perk${count === 1 ? "" : "s"} in it? The abilities themselves are not touched.</p>`
      });
      if ( !ok ) return null;
    }
    return this.#editTiers(tiers => removeTier(tiers, index));
  }

  static #onDeleteNode(event, target) {
    const nodeId = target.closest("[data-node-id]")?.dataset.nodeId;
    return this.#editTiers(tiers => removeNode(tiers, nodeId));
  }

  static async #onOpenNode(event, target) {
    const found = this.item.system.findNode(target.closest("[data-node-id]")?.dataset.nodeId);
    const ability = found?.node.uuid ? await foundry.utils.fromUuid(found.node.uuid) : null;
    if ( !ability ) return ui.notifications.warn("That ability is missing. Drop it into the tree again.");
    return ability.sheet.render({ force: true });
  }

  /* -------------------------------------------- */

  static async #onCreateEffect() {
    const [effect] = await this.item.createEmbeddedDocuments("ActiveEffect", [{
      name: this.item.name, img: this.item.img, origin: this.item.uuid, transfer: true
    }]);
    return effect?.sheet.render({ force: true });
  }

  static #effect(target) {
    return this.item.effects.get(target.closest("[data-effect-id]")?.dataset.effectId);
  }

  static #onEditEffect(event, target) {
    return IropItemSheet.#effect.call(this, target)?.sheet.render({ force: true });
  }

  static #onDeleteEffect(event, target) {
    return IropItemSheet.#effect.call(this, target)?.deleteDialog();
  }

  static #onToggleEffect(event, target) {
    const effect = IropItemSheet.#effect.call(this, target);
    return effect?.update({ disabled: !effect.disabled });
  }
}

/* -------------------------------------------- */

/** The ability a node points at, if this client can see it without waiting. */
export function nodeSource(uuid) {
  if ( !uuid ) return null;
  try { return foundry.utils.fromUuidSync?.(uuid) ?? null; }
  catch(err) { return null; }
}

/**
 * What players read in place of a Details tab they do not get (Johnald, 2026-10-10): a weapon's,
 * armor's, gear's or mod's stats as the shop shows them; a role's dossier, as the field guide sets
 * one out; a species' stats. Null for other items (a background has its own skills and perks).
 * @returns {{title: string, stats: {label: string, value: string}[]}|null}
 */
export function itemFactsFor(item) {
  const keep = list => list.filter(st => (st.value !== "") && (st.value !== null) && (st.value !== undefined));
  if ( PHYSICAL.includes(item.type) ) {
    // An owned weapon's perks (2026-10-18): Shredder's shred, a Specialist's range bonus.
    const perks = ((item.type === "weapon") && item.actor) ? weaponPerkSummary(item.actor.items.filter(i => i.type === "ability"), item, perkContext(item.actor)).lines : [];
    return { title: "Stats", stats: keep([{ label: "Type", value: typeLine(item) }, ...itemStats(item), { label: "Perks", value: perks.join("; ") }]) };
  }
  if ( item.type === "role" ) return { title: "Dossier", stats: keep(roleFacts(item)) };
  if ( item.type === "species" ) return { title: "Stats", stats: keep(speciesFacts(item)) };
  if ( item.type === "ability" ) return { title: "Stats", stats: keep(abilityFacts(item)) };
  if ( item.type === "boon" ) {
    const s = item.system;
    return { title: "Stats", stats: keep([{ label: "Raises", value: `${IROP.attributes[s.attribute]?.label ?? s.attribute} ${signed(s.amount)}` }]) };
  }
  if ( item.type === "mutation" ) {
    return { title: "Stats", stats: keep([{ label: "Polarity", value: IROP.mutationPolarity[item.system.polarity] ?? "" }]) };
  }
  return null;
}

const signed = n => ((Number(n) > 0) ? `+${n}` : `${n}`);

/**
 * A perk's (an ability's) stats, as its Details tab sets them: what it is and where it comes from,
 * what it costs and reaches, and for a paraphysical attack its accuracy (as the D.M. it puts on the
 * roll: minus is easier) and damage, with formulas in words. Uses left are the character sheet's.
 */
export function abilityFacts(item) {
  const s = item.system;
  const p = s.paraphysics ?? {};
  const tiles = n => `${n} ${(n === 1) ? "tile" : "tiles"}`;
  const discipline = IROP.disciplines[p.discipline] ?? "";
  return [
    { label: "Kind", value: (s.kind === "active") ? "Active" : "Passive" },
    { label: "Source", value: [IROP.abilitySources[s.source], s.tree].filter(Boolean).join(", ") },
    { label: "Tier", value: s.tree ? s.tier : "" },
    { label: "Action", value: (s.kind === "active") ? (IROP.actionTypes[s.actionType] ?? "") : "" },
    { label: "Energy", value: s.energyCost ? `${s.energyCost} EN` : "" },
    { label: "Range", value: s.range ? tiles(s.range) : "" },
    { label: "Area", value: s.area ? tiles(s.area) : "" },
    { label: "Uses", value: s.uses?.max ? `${s.uses.max}` : "" },
    { label: "Prerequisites", value: s.prerequisites },
    { label: "Paraphysics", value: discipline ? `${discipline}${s.rank ? `, rank ${s.rank}` : ""}` : "" },
    { label: "Accuracy", value: (discipline && p.attack) ? signed(-(p.accuracy ?? 0)) : "" },
    { label: "Damage", value: (discipline && p.attack && p.damage?.formula)
      ? `${formulaInWords(p.damage.formula)} ${IROP.damageTypes[p.damage.type]?.label ?? ""}`.trim() : "" }
  ];
}

/**
 * A role's dossier lines, as the field guide's Role Dossier lists them. Its starting skills read as
 * the sheet offers them: the first free, then one of the rest.
 */
export function roleFacts(item) {
  const s = item.system;
  const plan = startingSkillPlan(item);
  const label = key => IROP.skills[key]?.label ?? key;
  const skills = plan.granted.length
    ? `${label(plan.granted[0])} free${plan.options.length ? `, then one of ${plan.options.map(label).join(" or ")}` : ""}`
    : (s.startingSkills ?? "");
  return [
    { label: "Doctrine", value: IROP.roles[s.role]?.label ?? "" },
    { label: "Starting skills", value: skills },
    { label: "Preferred attributes", value: s.preferredAttributes },
    { label: "Weapon specialties", value: s.weaponSpecialties },
    { label: "Role abilities", value: s.roleAbilities },
    { label: "Specializations", value: s.specializations }
  ];
}

/**
 * A species' stats: its health and energy with what they add (IROP.derived), its starting
 * attributes, and what it brings to a character. Whether it is Paraphysical stays the GM's to see,
 * as on a background.
 */
export function speciesFacts(item) {
  const s = item.system;
  const concealment = Number(IROP.concealment.speciesBonus?.[item.name]) || 0;
  const traits = [s.boons ? "Takes attribute boons" : "", s.mutations ? "Carries mutations" : "",
    concealment ? `+${concealment}% concealment in the slums and megacities` : "", s.playable ? "" : "Not playable"]
    .filter(Boolean).join(", ");
  return [
    { label: "Health", value: `${s.health} + TGH mod` },
    { label: "Energy", value: `${s.energy} + CHA mod + INT mod` },
    { label: "Attributes", value: Object.entries(IROP.attributes).map(([key, a]) => `${a.abbr} ${s.attributes?.[key] ?? 0}`).join(", ") },
    { label: "Traits", value: traits }
  ];
}

/**
 * A background's starting skills as its Description tab shows them, read as the character sheet
 * reads them when a player picks: the skills by name, and any entry that is not one.
 */
export function backgroundSkillChoices(item) {
  const plan = startingSkillPlan(item);
  return { skills: plan.options.map(key => IROP.skills[key]?.label ?? key), unknown: plan.unknown };
}

/**
 * A background's perks as banners on its Description tab (Johnald, 2026-10-10: "I'd like the
 * background perks to show up a bit like banners on their description"): each perk's ability as
 * it stands, from the list the character would be offered. On a character's own copy of the
 * background, the perk they took is marked.
 */
export async function backgroundPerkBanners(item) {
  // A species grants all its perks, so none is "taken"; its list is the world's species of that name (2026-10-20).
  const species = item.type === "species";
  const taken = (item.actor && !species) ? takenPerk(item.actor.items, item.name) : null;
  const live = species ? (globalThis.game?.items?.find?.(i => (i.type === "species") && (i.name === item.name)) ?? item) : liveBackground(item);
  const banners = [];
  for ( const perk of live.system?.perks ?? [] ) {
    const source = perk.uuid ? await foundry.utils.fromUuid(perk.uuid) : null;
    if ( source?.type !== "ability" ) continue;
    banners.push({
      id: perk.id, name: source.name, img: source.img, meta: perkMeta(source.system),
      descriptionHTML: await TextEditor.enrichHTML(source.system.description ?? "", { relativeTo: source }),
      taken: !!taken && (taken.flags?.irop?.backgroundPerk?.uuid === perk.uuid)
    });
  }
  return banners;
}

/** A background's perks for its sheet, each with its ability's name and picture as they are now. */
export function backgroundPerkRows(system) {
  return (system.perks ?? []).map(p => {
    const source = nodeSource(p.uuid);
    return { ...p, name: source?.name ?? (p.name || "Unnamed perk"), img: source?.img ?? (p.img || "icons/svg/book.svg"), missing: !source };
  });
}

/**
 * The tree editor's tiers: each node with its current name and image (the stored
 * ones if the ability is gone), and the other perks it could require.
 */
export function treeEditorTiers(system) {
  const tiers = system.tiers ?? [];
  const named = tiers.flatMap(t => t.nodes).map(n => {
    const source = nodeSource(n.uuid);
    return { ...n, name: source?.name ?? n.name, img: source?.img ?? n.img, missing: !source };
  });
  const byId = new Map(named.map(n => [n.id, n]));
  return tiers.map((t, index) => ({
    index,
    number: index + 1,
    // A tree without tier gating, like the Generalist perks, has lines, not tiers (2026-10-08).
    label: system.gated ? "Tier" : "Line",
    first: index === 0,
    last: index === tiers.length - 1,
    exclusive: t.exclusive,
    nodes: t.nodes.map(raw => {
      const n = byId.get(raw.id);
      return {
        ...n,
        img: n.img || "icons/svg/item-bag.svg",
        requiresChoices: Object.fromEntries(named.filter(o => o.id !== n.id).map(o => [o.id, o.name]))
      };
    })
  }));
}

/* -------------------------------------------- */

/** The world's territories other than this one, by id. */
function otherTerritories(item) {
  return (game.items?.filter?.(i => (i.type === "territory") && (i.id !== item.id)) ?? []);
}

/** Regional upgrades built in a territory (step 5): finished Engineering projects placed there. */
export function builtIn(territoryId) {
  return (game.items?.filter?.(i => (i.type === "project") && (i.system.kind === "engineering") && (i.system.builds === "regional")
    && (i.system.status === "complete") && (i.system.territory === territoryId)) ?? []).map(i => i.name).sort();
}

/** The territory sheet's Weather section, in this user's unit (Johnald, 2026-10-08). */
export function weatherContext(s) {
  const unit = temperatureUnit();
  const p = weatherProfile({ climate: s.climate, megacity: s.kind === "megacity", modifiers: s.modifiers, custom: s.weather });
  const total = Object.values(p.weights).reduce((n, w) => n + w, 0) || 1;
  const climate = IROP.climates[s.climate] ?? IROP.climates.temperate;
  const likely = Object.entries(p.weights).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, w]) => `${IROP.weatherConditions[k].label.toLowerCase()} ${Math.round((w / total) * 100)}%`);
  return {
    custom: p.custom, unit,
    base: tempIn(p.base, unit), swing: spanIn(p.swing, unit), spread: spanIn(p.spread, unit),
    hazeAt: (unit === "C") ? "31°C" : "88°F",
    chances: Object.entries(IROP.weatherConditions).map(([key, c]) => ({
      key, label: c.label, icon: c.icon, weight: p.weights[key] ?? 0, share: Math.round(((p.weights[key] ?? 0) / total) * 100)
    })),
    summary: `${climate.label}: about ${tempIn(p.base, unit)}°${unit} on average, ${spanIn(p.swing, unit)}° either way with the seasons. Most likely ${likely.join(", ")}.`
  };
}

/** The territory sheet's lists and labels (2026-10-08). */
export function territoryContext(item) {
  const s = item.system;
  const rules = getStrategyRules();
  const named = id => game.items?.get(id) ?? null;
  // The regions of every War Room map, to link this territory to by hand (2026-10-08).
  const regionChoices = {};
  let byName = "";
  const key = n => String(n ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for ( const scene of game.scenes?.filter?.(sc => sc.flags?.irop?.warRoom?.map) ?? [] ) {
    for ( const r of scene.regions?.contents ?? [] ) {
      regionChoices[r.uuid] = `${scene.name}: ${r.name}`;
      if ( !byName && (key(r.name) === key(item.name)) ) byName = `${scene.name}: ${r.name}`;
    }
  }
  if ( s.region && !regionChoices[s.region] ) regionChoices[s.region] = "A region no longer on a War Room map";
  return {
    kinds: Object.fromEntries(Object.entries(IROP.territoryKinds).map(([k, v]) => [k, v.label])),
    climates: Object.fromEntries(Object.entries(IROP.climates).map(([k, v]) => [k, v.label])),
    weather: weatherContext(s),
    heatLevels: Object.fromEntries(IROP.heatLevels.map((h, i) => [i, h.label])),
    heatResponse: IROP.heatLevels[s.heat]?.response ?? "",
    reputationLevels: Object.fromEntries(Object.entries(IROP.reputationLevels).map(([k, v]) => [k, `${Number(k) > 0 ? "+" : ""}${k} ${v}`])),
    strengthMax: rules.strengthMax,
    parents: Object.fromEntries(otherTerritories(item).map(t => [t.id, t.name])),
    isMegacity: s.kind === "megacity",
    objectivesTaken: Object.values(s.objectives).filter(Boolean).length,
    objectives: [
      { key: "citadel", label: "Military citadel" },
      { key: "motorPool", label: "Motor pool" },
      { key: "government", label: "Center of government" }
    ].map(o => ({ ...o, taken: !!s.objectives[o.key] })),
    neighbors: s.neighbors.map(id => {
      const t = named(id);
      return { id, name: t?.name ?? "Missing territory", img: t?.img ?? "icons/svg/hazard.svg" };
    }),
    regionChoices,
    regionBlank: byName ? `Matched by name: ${byName}` : "Not on a War Room map yet",
    journal: journalLink(item),
    // Each side's facilities, with what the card adds by itself shown above the GM's own rows.
    facilities: Object.entries(IROP.facilitySides).map(([key, side]) => {
      const auto = quickFacilities(s, { upgrades: builtIn(item.id), gm: true })[key].filter(f => f.auto);
      return { key, ...side, auto, rows: (s.facilities?.[key] ?? []).map((f, index) => ({ ...f, index })) };
    }),
    upgrades: builtIn(item.id)
  };
}

/** Link or unlink two territories as neighbours, both ways. GM only, since both are written. */
export async function setNeighbors(a, b, linked) {
  const changes = linkNeighbors({ [a.id]: [...a.system.neighbors], [b.id]: [...b.system.neighbors] }, a.id, b.id, linked);
  for ( const [id, neighbors] of Object.entries(changes) ) {
    const doc = (id === a.id) ? a : b;
    await doc.update({ "system.neighbors": neighbors });
  }
}

/** The project sheet's lists and labels (Strategy Layer step 5, 2026-10-08). */
export function projectContext(item) {
  const s = item.system;
  const territories = (game.items?.filter?.(i => i.type === "territory") ?? []).sort((a, b) => a.name.localeCompare(b.name));
  const intel = s.kind === "intelligence";
  return {
    kinds: Object.fromEntries(Object.entries(IROP.projectKinds).map(([k, v]) => [k, v.label])),
    statuses: IROP.projectStatus,
    terms: IROP.intelTerms,
    builds: IROP.engineeringBuilds,
    resource: IROP.resources[s.resource]?.label ?? "",
    isResearch: s.kind === "research",
    isEngineering: s.kind === "engineering",
    isIntelligence: intel,
    hasPlace: intel || ((s.kind === "engineering") && (s.builds === "regional")),
    placeLabel: intel ? "Where it looks" : "Built in",
    territories: Object.fromEntries(territories.map(t => [t.id, t.name])),
    skills: Object.entries(IROP.skills).map(([key, k]) => ({ key, label: k.label, on: s.specialization.includes(key) })),
    salvageAmount: salvageProgress(s.cost, getStrategyRules()),
    pct: s.percent,
    assigned: s.assigned.map(a => ({ name: game.actors?.get(a.actor)?.name ?? "A soldier no longer here", skill: skillLabel(a.skill) }))
  };
}

/* -------------------------------------------- */

/**
 * A role's perk trees, to read on the role's own sheet (Johnald, 2026-10-17): its Primary, then its
 * specializations, in the order the Training tab shows them, each tier's perks with their XP, what
 * they need, and a Pick one tier's choice. A click opens a perk's ability; a GM can open the tree.
 * The General trees belong to every role, so they are left out.
 */
export function roleTreesContext(item, active = "", items = game.items) {
  const role = item.system.role;
  const all = items?.filter?.(i => (i.type === "skillTree") && role && (i.system.role === role)) ?? [];
  const trees = treesFor(all, { role });
  const unlock = specializationRules().unlockXP;
  const name = node => nodeSource(node.uuid)?.name ?? node.name;
  const shown = trees.find(t => t.id === active) ?? trees[0] ?? null;
  return trees.map(tree => {
    const s = tree.system;
    const spec = s.kind === "specialization";
    const opens = spec ? (unlock.length ? `Opens at ${unlock[0]} XP earned${unlock[1] ? `, a second specialization at ${unlock[1]}` : ""}` : "This table plays without specializations") : "";
    const byId = new Map(s.tiers.flatMap(t => t.nodes).map(n => [n.id, n]));
    const node = (n, i, tier) => {
      const source = nodeSource(n.uuid);
      const needs = [n.requires && byId.get(n.requires) ? `Needs ${name(byId.get(n.requires))} first` : "", source?.system?.prerequisites ? `Needs ${source.system.prerequisites}` : ""].filter(Boolean);
      return {
        id: n.id, uuid: n.uuid, name: name(n), img: source?.img || n.img || "icons/svg/item-bag.svg",
        sub: [`${Math.max(0, Number(n.xp) || 0)} XP`, source ? perkMeta(source.system) : "Missing ability"].filter(Boolean).join(", "),
        reason: needs.join(". "), missing: !source,
        or: tier.exclusive && (i > 0),
        chained: !tier.exclusive && (i > 0) && (n.requires === tier.nodes[i - 1].id)
      };
    };
    const tiers = s.tiers.map((tier, index) => ({
      number: index + 1, exclusive: tier.exclusive && (tier.nodes.length > 1),
      nodes: tier.nodes.map((n, i) => node(n, i, tier))
    })).filter(t => t.nodes.length);
    return {
      id: tree.id, label: s.tabLabel, kind: IROP.treeKinds[s.kind] ?? "", active: tree === shown, opens,
      freeForm: !s.gated,
      lines: !s.gated ? tiers.filter(t => t.nodes.length > 1) : [],
      singles: !s.gated ? tiers.filter(t => t.nodes.length === 1).flatMap(t => t.nodes) : [],
      tiers
    };
  });
}

/**
 * A power's Ranks tab (Johnald, 2026-10-19): Rank 1 is the power's own fields; Ranks 2 and 4 each a
 * line and their numbers, a blank Accuracy or Potency showing the track's default; Rank 3 the options
 * a player picks one of; Rank 5 its evolution.
 */
export function powerRanksContext(p) {
  const NUMBERS = [["accuracy", "Accuracy D.M.", "Minus makes it easier to hit"], ["potency", "Potency", "Added to a save power's D.M. on its target"],
    ["energy", "Energy", "Added to its cost"], ["range", "Range", "Tiles added"], ["area", "Area", "Tiles of radius added"],
    ["duration", "Duration", "Rounds added"], ["barrier", "Barrier", "Barrier points it grants, added to its own: lifts a target's barrier to at least this, never on top"],
    ["defense", "Defense", "Added to the caster's Defense while the power lasts"], ["shred", "Shred", "Shred on its damage: bypasses that much DR and strips it from armor"]];
  const fields = (path, src, defaults = {}) => [
    ...NUMBERS.map(([key, label, tip]) => ({ name: `${path}.${key}`, label, tip, value: src?.[key] ?? "", placeholder: defaults[key] ?? 0, number: true })),
    { name: `${path}.damage`, label: "Damage", tip: "Added to its damage: 1d4, +2", value: src?.damage ?? "", placeholder: "none" }
  ];
  const step = n => {
    const src = p[`rank${n}`] ?? {};
    const defaults = { accuracy: stepValue({ ...p, [`rank${n}`]: {} }, n, "accuracy"), potency: stepValue({ ...p, [`rank${n}`]: {} }, n, "potency") };
    const xp = IROP.paraphysics.powerXp[n];
    return { n, cost: `${xp} XP`, textName: `system.paraphysics.rank${n}.text`, text: src.text ?? "", fields: fields(`system.paraphysics.rank${n}`, src, defaults) };
  };
  const taken = new Set((p.options ?? []).map(o => o.archetype).filter(Boolean));
  return {
    steps: [step(2), step(4)],
    options: (p.options ?? []).map((o, i) => ({
      i, id: o.id, archetype: o.archetype, label: o.label, text: o.text, anchored: o.anchored, taken: o.id === p.choice,
      optionalEnergy: o.optionalEnergy, adaptive: o.adaptive, steadfast: o.steadfast,
      from: o.archetype ? `From the library: ${IROP.powerArchetypes[o.archetype]?.label ?? o.archetype}` : "Custom",
      fields: fields(`system.paraphysics.options.${i}`, o)
    })),
    library: Object.entries(IROP.powerArchetypes).filter(([k]) => !taken.has(k)).map(([key, a]) => ({ key, label: a.label })),
    // Rank 5: two evolutions, one picked (2026-10-29).
    evolutions: (p.evolutions ?? []).map((e, i) => ({ ...e, i, taken: e.id === p.evolved, fields: fields(`system.paraphysics.evolutions.${i}`, e) })),
    damageTypes: Object.fromEntries(Object.entries(IROP.damageTypes).map(([k, t]) => [k, t.label])),
    concentrationChoices: { "": "Unchanged", remove: "No longer needs it", add: "Now needs it" }
  };
}

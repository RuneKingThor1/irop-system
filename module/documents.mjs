import * as rolls from "./rolls.mjs";
import { legacyWeaponFeed, legacyParaphysicalTag, legacyRoleSkillOrder } from "./data/legacy.mjs";
import { itemEffectsSuppressed } from "./rules/effects.mjs";
import { IROP } from "./config.mjs";
import { isWorn, armorPoints, armorChange, nextArmorValue, wornArmorMax } from "./rules/armor.mjs";

/** A full suit of armor (light, medium or heavy): only one is worn at a time (Johnald, 2026-10-09). */
export function isSuit(item) {
  return (item?.type === "armor") && IROP.bodyArmorClasses.includes(item.system?.armorClass);
}

/** Write the armor pool's new value, if it moved. */
export function updateArmorPool(actor, change, max) {
  const pool = actor?.system?.vitals?.armor;
  if ( !pool || (!change.removed && !change.added) ) return null;
  const value = nextArmorValue(pool.value, change, max + (Number(pool.granted) || 0));
  if ( value === pool.value ) return null;
  return actor.update({ "system.vitals.armor.value": value });
}

/** Insurrection actors: operatives, NPCs, and stores. */
export class IropActor extends Actor {

  /** A store's picture is a heap of coins until the GM gives it one. @override */
  static getDefaultArtwork(actorData) {
    if ( actorData?.type === "store" ) return { img: "icons/svg/coins.svg", texture: { src: "icons/svg/coins.svg" } };
    return super.getDefaultArtwork(actorData);
  }

  /** Flat roll data for formulas, from the data model. */
  getRollData() {
    return this.system.getRollData?.() ?? super.getRollData();
  }

  /** @inheritDoc */
  async _preCreate(data, options, user) {
    if ( (await super._preCreate(data, options, user)) === false ) return false;
    // A store (2026-10-10): one of it, no bars, on neither side; players can open it unless
    // the GM sets its ownership otherwise.
    if ( this.type === "store" ) {
      const token = {
        actorLink: true,
        disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
        displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
        bar1: { attribute: null },
        bar2: { attribute: null }
      };
      const update = { prototypeToken: foundry.utils.mergeObject(token, data.prototypeToken ?? {}) };
      if ( data.ownership?.default === undefined ) {
        update.ownership = { ...(this._source.ownership ?? {}), default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
      }
      this.updateSource(update);
      return;
    }
    const operative = this.type === "operative";
    const token = {
      actorLink: operative,
      disposition: operative ? CONST.TOKEN_DISPOSITIONS.FRIENDLY : CONST.TOKEN_DISPOSITIONS.HOSTILE,
      displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
      bar1: { attribute: "vitals.hp" },
      bar2: { attribute: "vitals.energy" }
    };
    if ( operative ) token.sight = { enabled: true };
    this.updateSource({ prototypeToken: foundry.utils.mergeObject(token, data.prototypeToken ?? {}) });
  }

  rollAttribute(key) { return rolls.rollAttributeCheck(this, key); }
  rollSkill(key) { return rolls.rollSkill(this, key); }
  rollDodge() { return rolls.rollDodge(this); }
  rollPool() { return rolls.rollFreePool(this); }

  /** Restore dodges at the start of a round. */
  async resetDodges() {
    return this.update({ "system.vitals.dodges.value": this.system.vitals.dodges.max });
  }
}

/* -------------------------------------------- */

/**
 * Effects carried by items apply only while the item is in use: a mod while it
 * is fitted, a weapon or armor while it is equipped, gear while it is not
 * stowed. Perks, species, boons and the rest always apply.
 */
export class IropActiveEffect extends ActiveEffect {

  /** @override */
  get isSuppressed() {
    const item = this.parent;
    if ( !(item instanceof Item) || !item.actor ) return super.isSuppressed;
    // Mods follow their host: off unless fitted to worn armor or an equipped weapon (2026-10-08).
    return itemEffectsSuppressed(item) ?? super.isSuppressed;
  }
}

/* -------------------------------------------- */

const DEFAULT_ICONS = {
  weapon: "icons/svg/sword.svg",
  armor: "icons/svg/shield.svg",
  gear: "icons/svg/item-bag.svg",
  mod: "icons/svg/clockwork.svg",
  ability: "icons/svg/aura.svg",
  species: "icons/svg/mystery-man.svg",
  role: "icons/svg/tower-flag.svg",
  background: "icons/svg/book.svg",
  boon: "icons/svg/upgrade.svg",
  mutation: "icons/svg/biohazard.svg",
  skillTree: "icons/svg/oak.svg",
  territory: "icons/svg/village.svg",
  project: "icons/svg/book.svg"
};

/** Insurrection items. */
export class IropItem extends Item {

  /**
   * Weapons saved before feeds existed (2026-10-08) have none, so they would read as
   * plain magazine weapons. Give the special weapons theirs by name, once, on load.
   * Likewise the Awakened background gets the Paraphysical tag.
   * @override
   */
  static migrateData(source) {
    legacyWeaponFeed(source);
    legacyParaphysicalTag(source);
    legacyRoleSkillOrder(source);
    return super.migrateData(source);
  }

  /** @override */
  static getDefaultArtwork(itemData) {
    return { img: DEFAULT_ICONS[itemData?.type] ?? this.DEFAULT_ICON };
  }

  /** Item formulas can reach the owner's numbers: "1d6 + @str.mod". */
  getRollData() {
    const data = this.actor?.getRollData() ?? {};
    data.item = { ...this.system };
    return data;
  }

  /** @inheritDoc */
  async _preCreate(data, options, user) {
    if ( (await super._preCreate(data, options, user)) === false ) return false;
    // A mod arrives loose: whatever it was fitted to belonged to its old owner.
    if ( (this.type === "mod") && this.system.installedOn ) this.updateSource({ "system.installedOn": "" });
    // A suit of armor arrives off if one is already worn (Johnald, 2026-10-09).
    if ( isSuit(this) && this.system.equipped && this.actor?.items.some(i => isSuit(i) && i.system.equipped) ) {
      this.updateSource({ "system.equipped": false });
    }
  }

  /** Armor remembers whether it was worn, and its points, for the pool to follow the change. @inheritDoc */
  async _preUpdate(changed, options, user) {
    if ( (await super._preUpdate?.(changed, options, user)) === false ) return false;
    if ( (this.type === "armor") && this.actor ) {
      options.iropArmorBefore ??= {};
      options.iropArmorBefore[this.id] = { worn: isWorn(this), points: armorPoints(this) };
    }
  }

  /** @inheritDoc */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if ( (userId !== game.user.id) || !this.actor || (this.type !== "armor") ) return;
    const actor = this.actor;
    // One suit of armor at a time (Johnald, 2026-10-09): putting one on takes the other off.
    const putOn = foundry.utils.getProperty(changed, "system.equipped") === true;
    const takenOff = (putOn && isSuit(this)) ? actor.items.filter(i => (i.id !== this.id) && isSuit(i) && i.system.equipped) : [];
    // The armor pool follows what is worn (2026-10-10): a swap takes the old suit off first.
    const before = options.iropArmorBefore?.[this.id];
    if ( before && !options.iropArmorSwap ) {
      const change = armorChange(before, { worn: isWorn(this), points: armorPoints(this) });
      change.removed += takenOff.filter(isWorn).reduce((n, i) => n + armorPoints(i), 0);
      updateArmorPool(actor, change, wornArmorMax(actor, { without: takenOff.map(i => i.id) }));
    }
    if ( !takenOff.length ) return;
    actor.updateEmbeddedDocuments("Item", takenOff.map(i => ({ _id: i.id, "system.equipped": false })), { iropArmorSwap: true });
    ui.notifications?.info(`${actor.name} takes off ${takenOff.map(i => i.name).join(" and ")} to wear ${this.name}.`);
  }

  /** Armor that arrives already worn adds its points to the pool. @inheritDoc */
  _onCreate(data, options, userId) {
    super._onCreate?.(data, options, userId);
    if ( (userId !== game.user.id) || !this.actor || !isWorn(this) ) return;
    updateArmorPool(this.actor, { removed: 0, added: armorPoints(this) }, wornArmorMax(this.actor));
  }

  /** @inheritDoc */
  _onDelete(options, userId) {
    super._onDelete(options, userId);
    // Worn armor thrown away takes its points from the pool (2026-10-10).
    if ( (userId === game.user.id) && this.actor && isWorn(this) ) {
      updateArmorPool(this.actor, { removed: armorPoints(this), added: 0 }, wornArmorMax(this.actor, { without: [this.id] }));
    }
    // Unfit any mods that were fitted to a deleted weapon or armor.
    if ( (userId !== game.user.id) || !this.actor || !["weapon", "armor"].includes(this.type) ) return;
    const updates = this.actor.items.filter(i => (i.type === "mod") && (i.system.installedOn === this.id))
      .map(i => ({ _id: i.id, "system.installedOn": "" }));
    if ( updates.length ) this.actor.updateEmbeddedDocuments("Item", updates);
  }

  /**
   * The one button on an item row: attack with weapons, use abilities and
   * gear, otherwise post the card.
   */
  async use() {
    const actor = this.actor;
    if ( !actor ) return rolls.postItemCard(null, this);
    switch ( this.type ) {
      case "weapon": return rolls.rollAttack(actor, this);
      case "ability": return rolls.useAbility(actor, this);
      case "gear": return rolls.useGear(actor, this);
      default: return rolls.postItemCard(actor, this);
    }
  }
}

import { IROP } from "../config.mjs";
import { slotPerks } from "../rules/perks.mjs";
import { optionFromArchetype } from "../rules/paraphysics.mjs";

const fields = foundry.data.fields;

function int(initial = 0, options = {}) {
  return new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...options });
}

function text(initial = "") {
  return new fields.StringField({ required: true, blank: true, initial });
}

function choice(choices, initial) {
  return new fields.StringField({ required: true, initial, choices: () => choices() });
}

function description() {
  return new fields.HTMLField({ required: true, blank: true });
}

/** A territory's facilities on one side: name, a short note, down, hidden from players. */
function facilityList() {
  return new fields.ArrayField(new fields.SchemaField({
    name: text(""),
    note: text(""),
    down: new fields.BooleanField({ initial: false }),
    hidden: new fields.BooleanField({ initial: false })
  }));
}

/** One field per currency (Credits, Valuables, Alien Alloys), from a field maker. */
function perCurrency(make) {
  return new fields.SchemaField(Object.fromEntries(Object.keys(IROP.currencies).map(key => [key, make()])));
}

/** Fields every carried object shares. */
function physical() {
  return {
    quantity: int(1, { min: 0 }),
    weight: new fields.NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
    // Its price in each currency, set by hand, 0 for none; and whether each may be used to
    // buy it (Johnald, 2026-10-10). A currency buys it only when ticked and priced.
    prices: perCurrency(() => int(0, { min: 0 })),
    accepts: perCurrency(() => new fields.BooleanField({ initial: true })),
    equipped: new fields.BooleanField({ initial: false }),
    stowed: new fields.BooleanField({ initial: false }),
    // Hidden by nature: does not count toward concealment (Johnald, 2026-10-10).
    concealable: new fields.BooleanField({ initial: false })
  };
}

/**
 * An item saved with one price (and, for a day, the currency it was in) gets a price per
 * currency: the old price goes to that currency, Credits unless said otherwise (2026-10-10).
 */
export function migratePrices(source) {
  if ( !source || (typeof source !== "object") || ("prices" in source) || !("price" in source) ) return source;
  const key = (source.currency in IROP.currencies) ? source.currency : "credits";
  source.prices = Object.fromEntries(Object.keys(IROP.currencies).map(k => [k, 0]));
  source.prices[key] = Math.max(0, Math.floor(Number(source.price) || 0));
  return source;
}

/** A damage roll: a formula and a damage type. */
/** What a rank, a choice or an evolution changes: numbers added, and damage added ("1d4", "+2"). */
function changeFields() {
  return {
    accuracy: int(0), potency: int(0), damage: text(""), energy: int(0),
    range: int(0), duration: int(0), area: int(0), barrier: int(0)
  };
}

/** A Rank 2 or Rank 4 step: its text, and its numbers. Accuracy and Potency left blank take the track's default. */
function powerStep() {
  const nullable = () => new fields.NumberField({ required: true, nullable: true, integer: true, initial: null });
  return new fields.SchemaField({
    text: text(""),
    ...changeFields(),
    accuracy: nullable(),
    potency: nullable()
  });
}

/** The power tracks, for a choice field. */
function trackChoices() {
  return Object.fromEntries(Object.entries(IROP.powerTracks).map(([k, t]) => [k, t.label]));
}

function damage(type = "ballistic") {
  return new fields.SchemaField({
    formula: text(""),
    type: choice(() => IROP.damageTypes, type)
  });
}

/* -------------------------------------------- */

export class WeaponData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    const band = () => new fields.SchemaField({ tiles: int(0, { min: 0 }), dm: int(0) });
    return {
      description: description(),
      category: choice(() => IROP.weaponCategories, "ranged"),
      weaponClass: choice(() => IROP.weaponClasses, "smallArms"),
      // What it is, for the role perks (Johnald, 2026-10-18): an SMG, a Pistol, a SAW. Blank is untyped.
      weaponType: new fields.StringField({ required: true, blank: true, initial: "", choices: () => IROP.weaponTypes }),
      // Which Combat tab section it sits in; "auto" follows the category (see IROP.weaponGroups).
      sheetSection: choice(() => IROP.weaponGroupChoices, "auto"),
      tier: int(1, { min: 0, max: 9 }),
      handling: choice(() => IROP.weaponHandling, "standard"),
      // Accuracy as the weapon sheet reads it: +20 means the attack is 20 easier.
      accuracy: int(0),
      damage: damage("ballistic"),
      critical: new fields.SchemaField({ chance: int(0), damage: int(0) }),
      shred: int(0, { min: 0 }),
      penetration: int(0, { min: 0 }),
      // LIVE weapon tables list Destruction beside Shred and Penetration.
      destruction: int(0, { min: 0 }),
      range: new fields.SchemaField({ short: band(), medium: band(), long: band(), extreme: band() }),
      blast: int(0, { min: 0 }),
      // The shape set down on the map for the blast (2026-10-09).
      template: choice(() => IROP.blastTemplates, "circle"),
      ammo: new fields.SchemaField({ value: int(0, { min: 0 }), max: int(0, { min: 0 }) }),
      // How it is fed (see IROP.weaponFeeds, RULED 2026-10-08).
      feed: choice(() => IROP.weaponFeedChoices, "magazine"),
      // Fuel feed: a tank out of 100. Each burn costs `cost` (10; the Fuel Efficiency perk
      // makes it 5), and one attack can burn up to `maxBurns` times; every burn past the
      // first adds a damage die.
      fuel: new fields.SchemaField({
        value: int(100, { min: 0 }), max: int(100, { min: 1 }), cost: int(10, { min: 1 }), maxBurns: int(5, { min: 1 })
      }),
      // A fuel weapon's attack is a save, not a roll: the target saves against `save`; a
      // failure takes full damage and the status, a success half damage and no status.
      burn: new fields.SchemaField({
        save: choice(() => Object.fromEntries(Object.entries(IROP.attributes).map(([k, a]) => [k, a.label])), "agi"),
        status: new fields.StringField({ required: true, blank: true, initial: "",
          choices: () => ({ "": "None", ...Object.fromEntries(IROP.statusEffects.map(e => [e.id, e.name])) }) }),
        statusValue: int(0, { min: 0 })
      }),
      // Grenades or rockets loaded into a launcher, each a copy of the item it came from.
      loaded: new fields.ArrayField(new fields.SchemaField({
        name: text(""), img: text(""), system: new fields.ObjectField()
      })),
      // Null means the default for the category, from IROP.modSlots.
      modSlots: new fields.NumberField({ required: true, nullable: true, integer: true, min: 0, initial: null }),
      properties: text(""),
      ...physical()
    };
  }

  /** The attribute an attack with this weapon rolls against, or null. */
  get attackAttribute() {
    return IROP.weaponCategories[this.category]?.attribute ?? null;
  }

  get usesAmmo() {
    return (this.feed === "magazine") && (this.ammo.max > 0);
  }

  /** How many grenades or rockets a launcher holds, 0 for every other feed. */
  get projectileSlots() {
    return IROP.weaponFeeds[this.feed]?.slots ?? 0;
  }

  /**
   * Classes were consolidated on 2026-10-08: an item saved with an old class key
   * reads as its new class (pistol as Small Arms, rocketLauncher as Launchers).
   * A class the ruling did not place follows the weapon's category.
   * @override
   */
  static migrateData(source) {
    migratePrices(source);
    const old = source.weaponClass;
    if ( (typeof old === "string") && !(old in IROP.weaponClasses) ) {
      source.weaponClass = IROP.weaponClassMigrationByCategory[source.category]?.[old]
        ?? IROP.weaponClassMigration[old] ?? IROP.weaponClassByCategory[source.category] ?? "smallArms";
    }
    return super.migrateData(source);
  }

  /** The Combat tab section: as chosen, or by category and class. */
  get section() {
    if ( this.sheetSection !== "auto" ) return this.sheetSection;
    // RULED 2026-10-08: Special is the launchers (LAW, Rocket Launcher, Grenade Launcher)
    // and the chemthrowers. The RPG is a rocket, so it sits in Explosives.
    if ( ["launcher", "chemthrower"].includes(this.weaponClass) ) return "special";
    if ( this.category === "melee" ) return "melee";
    if ( (this.category === "thrown") || (this.category === "explosive") ) return "explosives";
    return "ranged";
  }

  /** Ranged weapons take one load of special ammo, beside their mods (Johnald, 2026-10-08). */
  get takesSpecialAmmo() {
    return (this.feed === "magazine") && (this.category === "ranged") && (this.weaponClass !== "natural");
  }

  /** The special ammunition loaded into this weapon, if any. */
  get specialAmmo() {
    const actor = this.parent.actor;
    if ( !actor || !this.takesSpecialAmmo ) return null;
    return actor.items.find(i => (i.type === "gear") && (i.system.kind === "ammunition")
      && (i.system.loadedIn === this.parent.id)) ?? null;
  }

  get slots() {
    // Natural weapons take no mods unless a slot count is set by hand (2026-10-08).
    if ( (this.modSlots === null) && (this.weaponClass === "natural") ) return 0;
    if ( (this.modSlots === null) && ["launcher", "chemthrower"].includes(this.weaponClass) ) return IROP.modSlots.special;
    return (this.modSlots ?? IROP.modSlots.weapon[this.category] ?? 0) + this.perkSlots;
  }

  /** Extra slots from the owner's role perks (Munnr, Go Low, Go Loud; 2026-10-18). */
  get perkSlots() {
    const actor = this.parent?.actor;
    return actor ? slotPerks(actor.items.filter(i => i.type === "ability"), this.parent) : 0;
  }

  /** Mods fitted to this weapon, if it is owned. */
  get mods() {
    const actor = this.parent.actor;
    if ( !actor ) return [];
    return actor.items.filter(i => (i.type === "mod") && (i.system.installedOn === this.parent.id));
  }
}

/* -------------------------------------------- */

export class ArmorData extends foundry.abstract.TypeDataModel {
  /** Old single prices become a price per currency. @override */
  static migrateData(source) {
    migratePrices(source);
    return super.migrateData(source);
  }

  /** @override */
  static defineSchema() {
    const dr = {};
    for ( const key of Object.keys(IROP.damageTypes) ) dr[key] = int(0);
    return {
      description: description(),
      armorClass: choice(() => IROP.armorClasses, "light"),
      // Its tier, as weapons have (2026-10-18): Light Armor Specialist and Heavy Armor Paragon scale by it.
      tier: int(1, { min: 0, max: 9 }),
      // Armor HP: the Field Manual's Adaptive Armor, the live sheet's HP Bonus.
      // RULED 2026-10-07 (Johnald, correcting 2026-10-06): this is NOT the Armor Bonus.
      points: int(0, { min: 0 }),
      // Defense: the Field Manual's Defense Value and the live sheet's Armor Bonus,
      // "how defensive is this armor against attacks? Add this number to the difficulty
      // of shots against you." RULED 2026-10-07: worn Defense is added to every attack
      // roll against the wearer, paraphysical ones included ("all attacks", Field Manual).
      defense: int(0, { min: 0 }),
      // Barrier (Johnald, 2026-10-13: some armor provides it): added to the wearer's Barrier maximum while worn.
      barrier: int(0, { min: 0 }),
      dr: new fields.SchemaField(dr),
      // Flat bonus per speed, which varies from armor to armor. Usually +1 Run and +1 Sprint.
      mobility: new fields.SchemaField(Object.fromEntries(Object.keys(IROP.speeds).map(k => [k, int(0)]))),
      dodges: int(0),
      modSlots: new fields.NumberField({ required: true, nullable: true, integer: true, min: 0, initial: null }),
      ...physical()
    };
  }

  get slots() {
    const actor = this.parent?.actor;
    // Medium Armor Mastery II's extra slot (2026-10-18).
    const perk = actor ? slotPerks(actor.items.filter(i => i.type === "ability"), this.parent) : 0;
    return (this.modSlots ?? IROP.modSlots.armor[this.armorClass] ?? 0) + perk;
  }

  get mods() {
    const actor = this.parent.actor;
    if ( !actor ) return [];
    return actor.items.filter(i => (i.type === "mod") && (i.system.installedOn === this.parent.id));
  }
}

/* -------------------------------------------- */

export class GearData extends foundry.abstract.TypeDataModel {
  /** Old single prices become a price per currency. @override */
  static migrateData(source) {
    migratePrices(source);
    return super.migrateData(source);
  }

  /** @override */
  static defineSchema() {
    return {
      description: description(),
      kind: choice(() => IROP.gearKinds, "general"),
      // A roll the item makes when used, such as a Medkit's "1d4 + @int.mod".
      formula: text(""),
      consumable: new fields.BooleanField({ initial: false }),
      // Uses spent from the one in hand, for a consumable a perk gives more uses (Field Medic's medikits, 2026-10-18).
      used: int(0, { min: 0 }),
      // Special ammunition loaded into a ranged weapon: that weapon's item id, blank if
      // not loaded (Johnald, 2026-10-08). Loaded ammo sits in the weapon's ammo slot.
      loadedIn: text(""),
      // What special ammunition does while loaded. RULED 2026-10-08 (Johnald): anyone can
      // build custom ammo from these, so each is optional; blank or 0 changes nothing.
      // The quantity of an ammunition item counts magazines: loading one is a reload, and
      // reloading again spends it. D.M.s are as printed: minus is the bonus.
      ammo: new fields.SchemaField({
        damageType: new fields.StringField({ required: true, blank: true, initial: "",
          choices: () => ({ "": "Weapon's own", ...Object.fromEntries(Object.entries(IROP.damageTypes).map(([k, t]) => [k, t.label])) }) }),
        damageBonus: text(""),
        accuracy: int(0),
        critical: int(0),
        drBypass: int(0, { min: 0 }),
        shred: int(0, { min: 0 }),
        penetration: int(0, { min: 0 }),
        ignoreDefense: new fields.BooleanField({ initial: false }),
        status: new fields.StringField({ required: true, blank: true, initial: "",
          choices: () => ({ "": "None", ...Object.fromEntries(IROP.statusEffects.map(e => [e.id, e.name])) }) }),
        statusValue: int(0, { min: 0 })
      }),
      ...physical()
    };
  }

  /** The ranged weapon this special ammo is loaded into, if it still exists. */
  get loadedHost() {
    if ( (this.kind !== "ammunition") || !this.loadedIn ) return null;
    return this.parent.actor?.items.get(this.loadedIn) ?? null;
  }
}

/* -------------------------------------------- */

export class ModData extends foundry.abstract.TypeDataModel {
  /** Old single prices become a price per currency. @override */
  static migrateData(source) {
    migratePrices(source);
    return super.migrateData(source);
  }

  /** @override */
  static defineSchema() {
    return {
      description: description(),
      target: choice(() => IROP.modTargets, "ranged"),
      // The id of the owned weapon or armor this mod is fitted to, blank if loose.
      installedOn: text(""),
      // Fitted, it hides what it is fitted to from concealment checks (Johnald, 2026-10-10).
      concealsHost: new fields.BooleanField({ initial: false }),
      // Fitted to a ranged weapon, the D.M. it adds to attacks in each range band (Johnald, 2026-10-17:
      // the Reflex Sight is -5 at Medium). Minus is easier, as on the weapon's own bands.
      rangeDm: new fields.SchemaField(Object.fromEntries(Object.keys(IROP.rangeBands).map(k => [k, int(0, { min: -50, max: 50 })]))),
      ...physical()
    };
  }

  /** The owned item this mod is fitted to, if any. */
  get host() {
    return this.installedOn ? (this.parent.actor?.items.get(this.installedOn) ?? null) : null;
  }
}

/* -------------------------------------------- */

export class AbilityData extends foundry.abstract.TypeDataModel {
  /** The Sandbox era "Energy" discipline is Astrokinesis now (2026-10-18). @override */
  static migrateData(source) {
    const p = source.paraphysics;
    if ( p && (typeof p === "object") ) {
      const moved = { energy: "astrokinesis", form: "vitakinesis", cosmic: "astrokinesis" }[p.discipline];
      if ( moved ) p.discipline = moved;
      // Rank 3 offered as library keys, and the evolution as plain text, before each rank was the
      // GM's to write (2026-10-19): the keys become editable copies, the text the evolution's text.
      if ( Array.isArray(p.choices) && !Array.isArray(p.options) ) {
        p.options = p.choices.map(key => optionFromArchetype(key, key)).filter(Boolean);
      }
      delete p.choices;
      if ( typeof p.evolution === "string" ) p.evolution = { text: p.evolution };
    }
    return super.migrateData(source);
  }

  /** @override */
  static defineSchema() {
    return {
      description: description(),
      kind: choice(() => ({ active: "Active", passive: "Passive" }), "active"),
      source: choice(() => IROP.abilitySources, "generalist"),
      tree: text(""),
      tier: int(1, { min: 0, max: 9 }),
      rank: int(1, { min: 0, max: 9 }),
      energyCost: int(0, { min: 0 }),
      actionType: choice(() => IROP.actionTypes, "single"),
      range: int(0, { min: 0 }),
      area: int(0, { min: 0 }),
      prerequisites: text(""),
      uses: new fields.SchemaField({ value: int(0, { min: 0 }), max: int(0, { min: 0 }) }),
      paraphysics: new fields.SchemaField({
        discipline: new fields.StringField({ required: true, blank: true, initial: "", choices: () => IROP.disciplines }),
        attack: new fields.BooleanField({ initial: false }),
        accuracy: int(0),
        damage: damage("psychic"),
        // As a power (Paraphysics Framework Draft 0.6, 2026-10-19): its tier (the discipline rank it
        // needs), its own rank 1 to 5, the two tracks it advances, the archetypes it offers at Rank 3
        // and the one taken, its Rank 5 evolution, and whether it needs Concentration. Energy is the
        // ability's Energy cost, its base at the rank that unlocks it.
        tier: int(1, { min: 1, max: 5 }),
        rank: int(1, { min: 0, max: 5 }),
        // The tracks are defaults only (2026-10-19): they fill Rank 2 and 4 where the GM leaves a field blank.
        trackA: new fields.StringField({ required: true, blank: true, initial: "", choices: () => trackChoices() }),
        trackB: new fields.StringField({ required: true, blank: true, initial: "", choices: () => trackChoices() }),
        // Rank 1 is the power itself: its Energy cost, range and area, damage, this many rounds, and
        // the Barrier it grants (2026-10-20).
        duration: int(0, { min: 0 }),
        barrier: int(0, { min: 0 }),
        // Each rank the GM's to write (Johnald, 2026-10-19): Ranks 2 and 4 are steps, Rank 3 the options
        // the player picks one of (copied from the library or custom), Rank 5 the power's own evolution.
        rank2: powerStep(),
        rank4: powerStep(),
        options: new fields.ArrayField(new fields.SchemaField({
          id: new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
          archetype: text(""),
          label: text(""),
          text: text(""),
          ...changeFields(),
          anchored: new fields.BooleanField({ initial: false })
        })),
        // The option taken, by its id.
        choice: text(""),
        evolution: new fields.SchemaField({
          name: text(""),
          text: new fields.HTMLField({ required: true, blank: true }),
          ...changeFields(),
          damageType: new fields.StringField({ required: true, blank: true, initial: "",
            choices: () => ({ "": "Unchanged", ...Object.fromEntries(Object.entries(IROP.damageTypes).map(([k, t]) => [k, t.label])) }) }),
          concentration: new fields.StringField({ required: true, blank: true, initial: "",
            choices: () => ({ "": "Unchanged", remove: "No longer needs it", add: "Now needs it" }) })
        }),
        concentration: new fields.BooleanField({ initial: false }),
        // Players can learn it (Johnald, 2026-10-20). Untick for a power only NPCs have, such as the
        // Reticulons': kept out of enlistment and refused when dropped on an operative in play.
        learnable: new fields.BooleanField({ initial: true }),
        // The attribute a save power's target rolls under; blank for none.
        save: new fields.StringField({ required: true, blank: true, initial: "",
          choices: () => Object.fromEntries(Object.entries(IROP.attributes).map(([k, a]) => [k, a.label])) })
      })
    };
  }

  get isParaphysical() {
    return !!this.paraphysics.discipline;
  }
}

/* -------------------------------------------- */

export class SpeciesData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    const attributes = {};
    for ( const key of Object.keys(IROP.attributes) ) attributes[key] = int(IROP.attributeDefaults[key], { min: 0 });
    return {
      description: description(),
      health: int(IROP.defaultSpecies.health, { min: 0 }),
      energy: int(IROP.defaultSpecies.energy, { min: 0 }),
      attributes: new fields.SchemaField(attributes),
      playable: new fields.BooleanField({ initial: true }),
      // RULED 2026-10-06: only Mutants have mutations, and only Humans take boons.
      mutations: new fields.BooleanField({ initial: false }),
      boons: new fields.BooleanField({ initial: false }),
      // RULED 2026-10-08: grants the Paraphysical tag, which shows the Paraphysics panel.
      paraphysical: new fields.BooleanField({ initial: false }),
      // Paraphysics (2026-10-19): the attribute it casts on (Humans and Telestoi Charisma,
      // Reticulons Intelligence), how many disciplines one of them can hold (Humans 5, Reticulons
      // 4, Telestoi 3), and ranks it grants in a discipline, which also raise that discipline's cap.
      paraphysics: new fields.SchemaField({
        attribute: new fields.StringField({ required: true, initial: "cha",
          choices: () => Object.fromEntries(Object.entries(IROP.attributes).map(([k, a]) => [k, a.label])) }),
        schools: int(5, { min: 0, max: 12 }),
        bonus: new fields.SchemaField(Object.fromEntries(Object.keys(IROP.disciplines).map(k => [k, int(0, { min: 0, max: 5 })])))
      }),
      // Species perks (Johnald, 2026-10-20): every character of the species gets all of them, at
      // enlistment and when the species is dropped on a sheet. Each points at its ability.
      perks: new fields.ArrayField(new fields.SchemaField({
        id: new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
        uuid: text(""),
        name: text(""),
        img: text("")
      }))
    };
  }
}

/* -------------------------------------------- */

export class RoleData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    return {
      description: description(),
      role: choice(() => IROP.roles, "legionary"),
      startingSkills: text(""),
      preferredAttributes: text(""),
      weaponSpecialties: text(""),
      roleAbilities: text(""),
      specializations: text(""),
      // Offered in the enlistment terminal (Johnald, 2026-10-16): untick to keep it out of character creation.
      enlist: new fields.BooleanField({ initial: true }),
    };
  }
}

/* -------------------------------------------- */

export class BackgroundData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    return {
      description: description(),
      startingSkills: text(""),
      // How many of the listed starting skills a new character picks (Field Manual: three).
      skillPicks: int(3, { min: 0 }),
      // RULED 2026-10-08: grants the Paraphysical tag (the Awakened background does).
      paraphysical: new fields.BooleanField({ initial: false }),
      // Offered in the enlistment terminal (Johnald, 2026-10-16): untick to keep it out of character creation.
      enlist: new fields.BooleanField({ initial: true }),
      // The species it is open to, by name, comma separated; blank for any (Johnald, 2026-10-20:
      // Awakened only for Humans and Mutants, the species not born to paraphysics).
      species: text(""),
      // Background perks (Johnald, 2026-10-10): a new character takes one. Each points at its
      // ability, with the name and picture as last seen (rules/backgrounds.mjs).
      perks: new fields.ArrayField(new fields.SchemaField({
        id: new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
        uuid: text(""),
        name: text(""),
        img: text("")
      }))
    };
  }
}

/* -------------------------------------------- */

export class BoonData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    return {
      description: description(),
      attribute: choice(() => Object.fromEntries(Object.entries(IROP.attributes).map(([k, v]) => [k, v.label])), "str"),
      amount: int(IROP.boonAmount)
    };
  }
}

/* -------------------------------------------- */

export class MutationData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    return {
      description: description(),
      polarity: choice(() => IROP.mutationPolarity, "positive"),
      // A mutation that asks for a choice when taken (Johnald, 2026-10-17): Aberrant Potential is +5 to
      // an attribute and a rank in a skill; Genetic Degradation is -5 to an attribute, Luck excluded.
      choice: new fields.SchemaField({
        attribute: int(0, { min: -20, max: 20 }),
        skill: int(0, { min: 0, max: 2 }),
        noLuck: new fields.BooleanField({ initial: false })
      }),
      // What its carrier chose: an attribute key and a skill key.
      chosen: new fields.SchemaField({ attribute: text(""), skill: text("") })
    };
  }

  /** Whether it asks for an attribute or a skill that has not been chosen yet. */
  get awaitsChoice() {
    return (!!this.choice.attribute && !this.chosen.attribute) || (!!this.choice.skill && !this.chosen.skill);
  }
}

/* -------------------------------------------- */

/**
 * A perk tree (RULED 2026-10-08): a GM editable item whose sheet is a tier editor.
 * Each node points at an ability item by UUID, with an XP cost; the name and image
 * are kept as a fallback in case that ability goes missing. See rules/skill-trees.mjs.
 */
export class SkillTreeData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    const node = new fields.SchemaField({
      id: new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
      uuid: text(""),
      name: text(""),
      img: text(""),
      xp: int(10, { min: 0 }),
      // Another node of this tree that must be owned first.
      requires: text("")
    });
    return {
      description: description(),
      // Blank is Everyone: the tree shows for every role.
      role: new fields.StringField({ required: true, blank: true, initial: "", choices: () => IROP.treeRoles }),
      kind: choice(() => IROP.treeKinds, "primary"),
      // The tab's name on the Dossier; blank uses the item's name.
      tab: text(""),
      order: int(0),
      // Light gating: a tier opens once a perk in the tier above is owned.
      gated: new fields.BooleanField({ initial: true }),
      tiers: new fields.ArrayField(new fields.SchemaField({
        // Pick one: taking a perk here rules out the rest of the tier.
        exclusive: new fields.BooleanField({ initial: false }),
        nodes: new fields.ArrayField(node)
      }))
    };
  }

  /** The tab's name on the Dossier. */
  get tabLabel() {
    return this.tab || this.parent?.name || "Tree";
  }

  /** A node of this tree, by id. */
  findNode(id) {
    for ( const [tier, t] of this.tiers.entries() ) {
      const node = t.nodes.find(n => n.id === id);
      if ( node ) return { node, tier, exclusive: t.exclusive };
    }
    return null;
  }
}

/* -------------------------------------------- */

/**
 * A territory on the Strategy Layer (2026-10-08): a region, district or super
 * region, whatever unit the campaign plays at (IROP.strategyScales). Its stats
 * follow the rules doc: Strength and Heat for GENESIS, Reputation for the
 * Resistance, and for a Megacity its three objectives. Neighbours and the scene
 * region it is drawn as are links by id, so the map and the turn engine can find them.
 */
export class TerritoryData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    const id = () => new fields.StringField({ required: true, blank: true, initial: "" });
    return {
      description: description(),
      kind: choice(() => Object.fromEntries(Object.entries(IROP.territoryKinds).map(([k, v]) => [k, v.label])), "rural"),
      control: choice(() => IROP.territoryControl, "genesis"),
      strength: int(0, { min: 0, max: 99 }),
      // Heat, 0 (None) to 4 (Maximum). A change waits in heatPending until the next turn starts.
      heat: int(0, { min: 0, max: 4 }),
      heatPending: int(0),
      // Turns in a row with no tactical action or relevant event here; two lower the Heat.
      quietWeeks: int(0, { min: 0 }),
      // A tactical action or relevant event here this week (step 4): the Heat does not cool.
      active: new fields.BooleanField({ initial: false }),
      // Reputation (RULED 2026-10-11): a level, -4 to +4, and the points in its bar (rules/reputation.mjs).
      reputation: int(0, { min: -4, max: 4 }),
      reputationPoints: int(5, { min: 0, max: 10 }),
      // Descriptive tags carried over from the Lore journal ("Havens, Megafauna").
      modifiers: text(""),
      objectives: new fields.SchemaField({
        citadel: new fields.BooleanField({ initial: false }),
        motorPool: new fields.BooleanField({ initial: false }),
        government: new fields.BooleanField({ initial: false })
      }),
      // Other territories, by item id. Adjacency runs both ways; the sheet keeps it so.
      neighbors: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
      // The larger territory this one sits in, for a campaign that drills down (blank: none).
      parent: id(),
      // The Scene Region this territory is drawn as on the strategy map (a UUID; blank: not linked).
      region: id(),
      // Its climate, for the weather on its card, and the GM's rerolls of it (2026-10-08).
      climate: choice(() => Object.fromEntries(Object.entries(IROP.climates).map(([k, v]) => [k, v.label])), "temperate"),
      weatherSalt: int(0, { min: 0 }),
      // The GM's own weather for it (Johnald, 2026-10-08): off, the climate's; on, these numbers.
      // Temperatures in degrees F (the sheet shows each user's unit); chances are relative weights.
      weather: new fields.SchemaField({
        custom: new fields.BooleanField({ initial: false }),
        base: new fields.NumberField({ required: true, nullable: false, initial: 57 }),
        swing: new fields.NumberField({ required: true, nullable: false, min: 0, initial: 18 }),
        spread: new fields.NumberField({ required: true, nullable: false, min: 0, initial: 8 }),
        weights: new fields.SchemaField(Object.fromEntries(Object.keys(IROP.weatherConditions).map(k => [k, int(0, { min: 0 })])))
      }),
      // The header image on the territory card, set by the GM (Johnald, 2026-10-08).
      art: text(""),
      // The journal entry or page the card shows (a UUID; blank: one named like the territory, if any).
      journal: id(),
      // What each side has here, for the card's quick view (Johnald, 2026-10-08). Down: a GENESIS
      // facility destroyed or a Rebellion one lost. Hidden: the GM's alone, until the players learn of it.
      facilities: new fields.SchemaField({
        rebellion: facilityList(),
        genesis: facilityList()
      }),
      // Doc: each Megacity has a unique landmark that can provide bonuses once liberated (step 7).
      landmark: text(""),
      landmarkBonus: text("")
    };
  }

  get isMegacity() {
    return this.kind === "megacity";
  }

  /** Megacity objectives taken, of three. */
  get objectivesTaken() {
    return Object.values(this.objectives).filter(Boolean).length;
  }

  get heatLabel() {
    return IROP.heatLevels[this.heat]?.label ?? "";
  }

  get reputationLabel() {
    return IROP.reputationLevels[String(this.reputation)] ?? "";
  }
}

/* -------------------------------------------- */

/**
 * An ODR project (Strategy Layer step 5, 2026-10-08): a Research project, an
 * Engineering Action or an Intelligence Action, as the doc formats them. Progress
 * is in Logistics, or Intel for Intelligence; the cost is the GM's, per project.
 */
export class ProjectData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    const id = () => new fields.StringField({ required: true, blank: true, initial: "" });
    return {
      description: description(),
      kind: choice(() => Object.fromEntries(Object.entries(IROP.projectKinds).map(([k, v]) => [k, v.label])), "research"),
      status: choice(() => IROP.projectStatus, "available"),
      cost: int(0, { min: 0 }),
      progress: int(0, { min: 0 }),
      // Doc: the skills that let a soldier add progress (Research and Engineering).
      specialization: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
      // Doc: the research categories it belongs to, and what it unlocks.
      advancement: text(""),
      unlocks: text(""),
      // Intelligence: short or long term. Engineering: what it builds.
      term: choice(() => IROP.intelTerms, "short"),
      builds: choice(() => IROP.engineeringBuilds, "base"),
      // Where it is built, or where an Intelligence Action looks (a territory id).
      territory: id(),
      // Intelligence: the Tactical Action it reveals when complete.
      reveals: text(""),
      // Research: salvage recovered for it.
      salvage: int(0, { min: 0 }),
      // The soldiers working it, each with the one skill they contribute ("labor" on Engineering).
      assigned: new fields.ArrayField(new fields.SchemaField({
        actor: new fields.StringField({ required: true, blank: false }),
        skill: new fields.StringField({ required: true, blank: false })
      }))
    };
  }

  /** Paid and progressed in: Intel for Intelligence, else Logistics. */
  get resource() {
    return IROP.projectKinds[this.kind]?.resource ?? "logistics";
  }

  get remaining() {
    return Math.max(0, this.cost - this.progress);
  }

  get percent() {
    return this.cost ? Math.min(100, Math.round((this.progress / this.cost) * 100)) : 0;
  }
}

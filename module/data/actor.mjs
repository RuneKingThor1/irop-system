import { xpSpent } from "../rules/xp.mjs";
import { serviceRank, migrateRankKey } from "../rules/ranks.mjs";
import { BANK_CAP } from "../rules/dynosrs.mjs";
import { armorPerks, armorDrAll, actorPerks } from "../rules/perks.mjs";
import { IROP } from "../config.mjs";
import { attributeModifier, buildPool } from "../rules/dynosrs.mjs";
import { houseRules } from "../settings.mjs";
import { concealmentLoad } from "../rules/concealment.mjs";

const fields = foundry.data.fields;

/** A required integer with an initial value. */
function int(initial = 0, options = {}) {
  return new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...options });
}

/** A blank-allowed text field. */
function text(initial = "") {
  return new fields.StringField({ required: true, blank: true, initial });
}

/**
 * The Personnel Record drawer: plain dossier text and a dated service log.
 * Field lists come from IROP.record, so adding a field there and here is all it takes.
 * (The attached file was removed 2026-10-06, by Johnald.)
 */
function personnelRecord() {
  const simple = {};
  for ( const f of [...IROP.record.identity, ...IROP.record.service] ) simple[f.key] = text(f.key === "assignment" ? "Eclipse" : "");
  return new fields.SchemaField({
    ...simple,
    marks: text(),
    // A rank the GM set by hand (2026-10-17); blank is by XP earned, the ODR bands (rules/ranks.mjs).
    rank: new fields.StringField({ required: true, blank: true, initial: "" }),
    // Medals (Johnald, 2026-10-17): awarded by the GM, each with why and on what mission.
    medals: new fields.ArrayField(new fields.SchemaField({
      id: text(""), name: text(""), mission: text(""), date: text(""), description: text(""), by: text("")
    })),
    nextOfKin: new fields.SchemaField({ name: text(), relation: text() }),
    // The record's own photo (Johnald, 2026-10-16), apart from the sheet's portrait; blank shows the portrait.
    photo: new fields.FilePathField({ required: false, blank: true, initial: "", categories: ["IMAGE"] }),
    // How that photo sits in its frame: the point it centers on, as a share across and down, and its zoom.
    portrait: new fields.SchemaField({
      set: new fields.BooleanField({ initial: false }),
      x: new fields.NumberField({ required: true, nullable: false, min: 0, max: 100, initial: 50 }),
      y: new fields.NumberField({ required: true, nullable: false, min: 0, max: 100, initial: 18 }),
      zoom: new fields.NumberField({ required: true, nullable: false, min: 100, max: 300, initial: 100 })
    }),
    timeline: new fields.ArrayField(new fields.SchemaField({ date: text(), entry: text() }))
  });
}

/** A resource pool: current value, a derived max, and a bonus effects and players can add to. */
function pool(initial = 0) {
  return new fields.SchemaField({
    value: int(initial),
    max: int(initial),
    bonus: int(0)
  });
}

/**
 * Data shared by every combatant: operatives and NPCs roll, take damage and
 * move by the same rules, so they share one schema and one derivation.
 */
export class CombatantData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    const attributes = {};
    for ( const key of Object.keys(IROP.attributes) ) {
      attributes[key] = new fields.SchemaField({
        base: int(IROP.attributeDefaults[key], { min: 0, max: 200 }),
        advances: int(0, { min: 0, max: IROP.attributeAdvance.maxRanks })
      });
    }

    const skills = {};
    for ( const key of Object.keys(IROP.skills) ) {
      skills[key] = new fields.SchemaField({ rank: int(0, { min: 0, max: IROP.skillRanks.max }) });
    }

    const dr = {};
    for ( const key of Object.keys(IROP.damageTypes) ) dr[key] = int(0);

    const disciplines = {};
    for ( const key of Object.keys(IROP.disciplines) ) disciplines[key] = int(0, { min: 0, max: 10 });

    return {
      attributes: new fields.SchemaField(attributes),
      skills: new fields.SchemaField(skills),
      vitals: new fields.SchemaField({
        hp: pool(12),
        energy: pool(18),
        armor: pool(0),
        barrier: pool(0),
        luck: new fields.SchemaField({ value: int(3, { min: 0 }), max: int(3) }),
        dodges: new fields.SchemaField({ value: int(1, { min: 0 }), max: int(1), bonus: int(0) })
      }),
      // Bonuses that perks and effects add to. The totals are derived.
      bonuses: new fields.SchemaField({
        critical: int(0),
        initiative: int(0),
        move: new fields.SchemaField(Object.fromEntries(Object.keys(IROP.speeds).map(k => [k, int(0)]))),
        carry: int(0),
        // Defense outside worn armor, from effects or perks: the live sheet's Defense Mod.
        defense: int(0),
        // More or less Edge and Victory an operative may bank (2026-10-17): Overclocked Cortex +1 Edge,
        // Frayed Focus -1 Edge, Squandered Insight -1 Victory (none at all).
        edgeCap: int(0),
        victoryCap: int(0),
        // Percent points more of carry capacity that may show at a checkpoint (2026-10-10).
        concealment: int(0),
        // The same, at one place only (Model Citizen's Megacity, Johnald, 2026-10-11).
        concealmentAt: new fields.SchemaField(Object.fromEntries(Object.keys(IROP.concealment.places).map(k => [k, int(0)]))),
        // Background perks on the Strategy Layer (Johnald, 2026-10-11), raised by their effects:
        // more per skill rank on a kind of project, Toughness on Engineering labor, Intel on an
        // Intelligence Action in a Megacity, and what a successful mission brings back.
        strategy: new fields.SchemaField({
          perRank: new fields.SchemaField(Object.fromEntries(Object.keys(IROP.projectKinds).map(kind =>
            [kind, new fields.SchemaField(Object.fromEntries(Object.keys(IROP.skills).map(k => [k, int(0)])))]))),
          laborToughness: int(0),
          intelMegacity: int(0),
          mission: new fields.SchemaField({
            logistics: int(0),
            intel: int(0),
            reputation: new fields.SchemaField(Object.fromEntries(Object.keys(IROP.territoryKinds).map(k => [k, int(0)])))
          })
        })
      }),
      // Damage reduction a character carries outside its armor, per type.
      dr: new fields.SchemaField(dr),
      paraphysics: new fields.SchemaField(disciplines)
    };
  }

  /* -------------------------------------------- */

  /** The actor's single species item, if any. */
  get species() {
    return this.parent.items.find(i => i.type === "species") ?? null;
  }

  /**
   * Can this actor carry mutations? RULED 2026-10-06: only Mutants. A species says
   * so with its "Carries mutations" switch; an NPC with a caste is a mutant too.
   */
  get canMutate() {
    if ( this.species?.system.mutations ) return true;
    return !!this.details?.caste;
  }

  /**
   * Can this actor take attribute boons? RULED 2026-10-06: only Humans, whose
   * species bonus they are. A species says so with its "Grants boons" switch.
   */
  get canTakeBoons() {
    return !!this.species?.system.boons;
  }

  /**
   * Does this actor carry the Paraphysical tag? RULED 2026-10-08 (Johnald): the
   * Paraphysics panel is hidden unless it does. A species or background grants it
   * (the Awakened background does); so does knowing a paraphysical ability or
   * holding a rank in any discipline, so nothing already on a sheet is hidden.
   */
  get isParaphysical() {
    const items = this.parent?.items ?? [];
    if ( items.some(i => ["species", "background"].includes(i.type) && i.system.paraphysical) ) return true;
    if ( items.some(i => (i.type === "ability") && i.system.isParaphysical) ) return true;
    return Object.values(this.paraphysics ?? {}).some(rank => rank > 0);
  }

  /** The actor's role item, if any. */
  get role() {
    return this.parent.items.find(i => i.type === "role") ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Attribute scores are set before Active Effects apply, so an effect that
   * adds to system.attributes.str.value stacks on top of base, advances and boons.
   * @override
   */
  prepareBaseData() {
    super.prepareBaseData();
    const boons = {};
    // A mutation's chosen attribute (2026-10-17): Aberrant Potential +5, Genetic Degradation -5.
    const mutated = {};
    for ( const item of this.parent.items ) {
      if ( item.type === "boon" ) {
        const key = item.system.attribute;
        boons[key] = (boons[key] ?? 0) + item.system.amount;
      }
      else if ( (item.type === "mutation") && item.system.choice?.attribute && item.system.chosen?.attribute ) {
        const key = item.system.chosen.attribute;
        mutated[key] = (mutated[key] ?? 0) + item.system.choice.attribute;
      }
    }
    // Role perks straight on the character (2026-10-18): Strongest Avenger's +5, Long Distance Conditioning's speed.
    const perked = actorPerks(this.parent.items.filter(i => i.type === "ability"));
    this._perked = perked;
    for ( const [key, attr] of Object.entries(this.attributes) ) {
      attr.boons = boons[key] ?? 0;
      attr.mutation = mutated[key] ?? 0;
      attr.perks = perked.attributes[key] ?? 0;
      attr.value = attr.base + (attr.advances * IROP.attributeAdvance.perRank) + attr.boons + attr.mutation + attr.perks;
    }
    for ( const [path, n] of Object.entries(perked.bonuses) ) {
      const now = foundry.utils.getProperty(this.bonuses, path);
      if ( typeof now === "number" ) foundry.utils.setProperty(this.bonuses, path, now + n);
    }
  }

  /* -------------------------------------------- */

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    const mods = {};
    for ( const [key, attr] of Object.entries(this.attributes) ) {
      attr.mod = attributeModifier(attr.value);
      attr.label = IROP.attributes[key].label;
      attr.abbr = IROP.attributes[key].abbr;
      mods[key] = attr.mod;
    }
    this.mods = mods;

    const species = this.species?.system ?? IROP.defaultSpecies;
    const d = IROP.derived;
    const v = this.vitals;

    // Equipped armor feeds armor points, defense, barrier, damage reduction, mobility and dodges.
    const armor = { points: 0, defense: 0, barrier: 0, dodges: 0, dr: {}, move: Object.fromEntries(Object.keys(IROP.speeds).map(k => [k, 0])) };
    // Role perks on worn armor (2026-10-18): Medium Armor Mastery's extra armor HP, Full Regalia's DR.
    const perks = armorPerks(this.parent.items.filter(i => i.type === "ability"));
    for ( const item of this.parent.items ) {
      // Worn and not stowed (2026-10-08): stowing takes armor off, but older data may carry both.
      if ( (item.type !== "armor") || !item.system.equipped || item.system.stowed ) continue;
      const pct = perks.pct[item.system.armorClass] ?? 0;
      armor.points += item.system.points + (pct ? Math.ceil(item.system.points * pct / 100) : 0);
      if ( perks.fullRegalia && (item.system.armorClass === "medium") ) {
        const slots = Number(item.system.slots) || 0;
        const fitted = this.parent.items.filter(i => (i.type === "mod") && (i.system.installedOn === item.id)).length;
        if ( slots && (fitted >= slots) ) for ( const t of ["ballistic", "physical", "laser", "plasma"] ) armor.dr[t] = (armor.dr[t] ?? 0) + slots;
      }
      armor.defense += item.system.defense;
      armor.barrier += item.system.barrier ?? 0;
      for ( const k of Object.keys(armor.move) ) armor.move[k] += item.system.mobility[k] ?? 0;
      armor.dodges += item.system.dodges;
      for ( const [type, n] of Object.entries(item.system.dr) ) armor.dr[type] = (armor.dr[type] ?? 0) + n;
      // Heavy Armor Mastery II and Heavy Armor Paragon: DR to every type in worn heavy armor.
      const allDr = armorDrAll(perks, item.system);
      if ( allDr ) for ( const type of Object.keys(IROP.damageTypes) ) armor.dr[type] = (armor.dr[type] ?? 0) + allDr;
    }

    v.hp.max = d.health(mods, species) + v.hp.bonus;
    v.energy.max = d.energy(mods, species) + v.energy.bonus;
    v.armor.max = armor.points + v.armor.bonus;
    v.barrier.max = armor.barrier + v.barrier.bonus;
    v.luck.max = d.luck(mods);
    v.dodges.max = d.dodges(mods) + armor.dodges + v.dodges.bonus;

    this.critical = d.critical(mods) + this.bonuses.critical;
    // Got an Eye for this: the PER mod counts twice toward Critical (2026-10-18).
    for ( const key of this._perked?.critical ?? [] ) this.critical += Number(mods[key]) || 0;
    // Added to every attack roll against this character (RULED 2026-10-07).
    this.defense = armor.defense + this.bonuses.defense;
    this.initiativeBonus = this.bonuses.initiative;
    this.throwRange = d.throwRange(mods);

    // Sprint comes from the unarmored Run; armor and effect bonuses add flat per speed.
    const run = d.moveRun(mods);
    const base = { shift: d.moveShift(mods), run, sprint: 2 * run };
    this.movement = {};
    for ( const k of Object.keys(base) ) this.movement[k] = base[k] + armor.move[k] + this.bonuses.move[k];

    this.drTotal = {};
    for ( const key of Object.keys(IROP.damageTypes) ) this.drTotal[key] = this.dr[key] + (armor.dr[key] ?? 0);

    // Carried weight: everything with weight that is not stowed away. A grenade or rocket
    // loaded in a launcher still weighs what it did until it is fired (Johnald, 2026-10-09).
    let carried = 0;
    for ( const item of this.parent.items ) {
      const s = item.system;
      if ( (s.weight === undefined) || s.stowed ) continue;
      carried += s.weight * (s.quantity ?? 1);
      for ( const shot of (Array.isArray(s.loaded) ? s.loaded : []) ) carried += Number(shot?.system?.weight) || 0;
    }
    this.carry = { value: Math.round(carried * 10) / 10, max: d.carry(mods) + this.bonuses.carry };
    this.carry.over = this.carry.value > this.carry.max;
    // What of it shows, for concealment (2026-10-10): the concealable and the hidden left out. A
    // species' share more (Humans, 10) and effects' raise the share allowed at every place.
    const speciesName = this.species?.name ?? "";
    const fromSpecies = Number(IROP.concealment.speciesBonus?.[speciesName]) || 0;
    this.concealment = {
      ...concealmentLoad(this.parent.items, this.carry.max),
      bonus: fromSpecies + (Number(this.bonuses.concealment) || 0),
      // At one place only, from effects (2026-10-11).
      bonusAt: Object.fromEntries(Object.keys(IROP.concealment.places).map(k => [k, Number(this.bonuses.concealmentAt?.[k]) || 0])),
      speciesBonus: fromSpecies, species: fromSpecies ? speciesName : ""
    };

    // DYNOSRS pools for every skill.
    const rules = houseRules();
    for ( const [key, skill] of Object.entries(this.skills) ) {
      const cfg = IROP.skills[key];
      skill.label = cfg.label;
      skill.attribute = cfg.attribute;
      skill.mod = mods[cfg.attribute];
      skill.pool = buildPool(skill.mod, skill.rank, rules);
    }
  }

  /* -------------------------------------------- */

  /**
   * Roll data for formulas. Flat and short on purpose, so damage and healing
   * read naturally: "1d6 + @str.mod", "1d4 + @int.mod", "@per.value".
   */
  getRollData() {
    const data = {};
    for ( const [key, attr] of Object.entries(this.attributes) ) data[key] = { value: attr.value, mod: attr.mod };
    data.critical = this.critical;
    data.initiativeBonus = this.initiativeBonus ?? 0;
    data.paraphysics = { ...this.paraphysics };
    data.hp = { value: this.vitals.hp.value, max: this.vitals.hp.max };
    data.energy = { value: this.vitals.energy.value, max: this.vitals.energy.max };
    return data;
  }
}

/* -------------------------------------------- */

/** A player character: an Eclipse operative. */
export class OperativeData extends CombatantData {

  /** @override */
  static defineSchema() {
    return {
      ...super.defineSchema(),
      banks: new fields.SchemaField({
        // Capped by banks.edgeMax and banks.victoryMax, which effects can move (2026-10-17).
        edge: int(0, { min: 0, max: 10 }),
        victory: int(0, { min: 0, max: 5 })
      }),
      // RULED 2026-10-08: Earned is set by the GM; Spent is the sum of the ledger, so
      // it cannot drift. Each entry is an award or a purchase (attribute or skill rank,
      // and next, a perk tree perk).
      xp: new fields.SchemaField({
        earned: int(IROP.startingXP, { min: 0 }),
        log: new fields.ArrayField(new fields.SchemaField({
          kind: text(""),
          label: text(""),
          xp: int(0),
          ref: text(""),
          rank: int(0),
          date: text("")
        }))
      }),
      // RULED 2026-10-07 (Johnald): Credits, Valuables (was Alien credits) and Alien
      // Alloys (was Valuables). From the live Sandbox sheet: acur becomes valuables,
      // val becomes alloys.
      wealth: new fields.SchemaField({
        credits: int(IROP.startingCredits),
        valuables: int(0),
        alloys: int(0)
      }),
      details: new fields.SchemaField({
        callsign: new fields.StringField({ required: true, blank: true }),
        biography: new fields.HTMLField({ required: true, blank: true }),
        notes: new fields.HTMLField({ required: true, blank: true }),
        // Free starting skills already taken (2026-10-08): the name of the role and the
        // background they came from, so swapping one later does not hand them out again.
        startingSkills: new fields.SchemaField({ role: text(""), background: text("") }),
        record: personnelRecord()
      })
    };
  }

  /**
   * XP saved before the ledger (2026-10-08) kept a hand typed Spent. It becomes one
   * opening entry, so the total stays the same.
   * @override
   */
  static migrateData(source) {
    const xp = source.xp;
    if ( xp && (typeof xp === "object") && !("log" in xp) && ("spent" in xp) ) {
      const spent = Number(xp.spent) || 0;
      xp.log = spent > 0 ? [{ kind: "adjust", label: "Spent before the ledger", xp: spent, ref: "", rank: 0, date: "" }] : [];
    }
    // Squaddie, the only rank before the ladder (2026-10-17), is Initiate by XP now.
    const record = source.details?.record;
    if ( record && ("rank" in record) ) record.rank = migrateRankKey(record.rank);
    return super.migrateData(source);
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    // What may be banked: the dice rules' caps, moved by effects (2026-10-17).
    this.banks.edgeMax = Math.max(0, BANK_CAP.EDGE + (Number(this.bonuses.edgeCap) || 0));
    this.banks.victoryMax = Math.max(0, BANK_CAP.VICTORY + (Number(this.bonuses.victoryCap) || 0));
    this.xp.spent = xpSpent(this.xp.log);
    this.xp.unspent = this.xp.earned - this.xp.spent;
    // The ODR rank: by XP earned, unless the GM set one (2026-10-17).
    this.serviceRank = serviceRank(this.xp.earned, this.details?.record?.rank);
    const role = this.role?.system.role;
    this.roleKey = role ?? null;
    this.accent = IROP.roles[role]?.color ?? null;
  }
}

/* -------------------------------------------- */

/** Anything the cell fights, meets or bargains with. */
export class NpcData extends CombatantData {

  /** @override */
  static defineSchema() {
    return {
      ...super.defineSchema(),
      details: new fields.SchemaField({
        threat: new fields.StringField({ required: true, initial: "soldier", choices: () => IROP.npcThreats }),
        caste: new fields.StringField({ required: true, blank: true, initial: "", choices: () => IROP.castes }),
        faction: new fields.StringField({ required: true, blank: true }),
        biography: new fields.HTMLField({ required: true, blank: true }),
        notes: new fields.HTMLField({ required: true, blank: true })
      })
    };
  }
}

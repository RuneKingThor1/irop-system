import { WEAPON_TYPES } from "./rules/weapon-types.mjs";
/**
 * IROP CONFIGURATION AND ASSUMPTIONS BLOCK
 * ========================================
 *
 * Every number the system derives lives here, so a rules change is one edit.
 * Each value is tagged with where it came from:
 *
 *   HANDOFF   docs/Insurrection_Handoff.md, the canonical rules reference.
 *   LIVE      the formulas the campaign actually ran on, read from the
 *             property definitions of the Sandbox world (backup of 2026-09-03).
 *             These are the rules as played, so they win over the handoff
 *             where the two differ, and every such case is noted.
 *   ASSUMED   a reading I had to make. Johnald decides; change it here.
 */

export const IROP = {};

/* -------------------------------------------- */
/*  Attributes                                  */
/* -------------------------------------------- */

/** HANDOFF Section 5: the seven attributes. */
IROP.attributes = {
  str: { label: "Strength", abbr: "STR" },
  agi: { label: "Agility", abbr: "AGI" },
  tgh: { label: "Toughness", abbr: "TGH" },
  cha: { label: "Charisma", abbr: "CHA" },
  lck: { label: "Luck", abbr: "LCK" },
  int: { label: "Intelligence", abbr: "INT" },
  per: { label: "Perception", abbr: "PER" }
};

/** HANDOFF Section 5: every attribute starts at 40 except Luck at 30. */
IROP.attributeDefaults = { str: 40, agi: 40, tgh: 40, cha: 40, lck: 30, int: 40, per: 40 };

/**
 * HANDOFF Section 4: each attribute rank raises the score by 5. Ranks run 1 to 6,
 * and the cost is for the rank being bought into.
 */
IROP.attributeAdvance = { perRank: 5, maxRanks: 6, xpCost: [10, 20, 40, 60, 80, 100] };

/**
 * RULED 2026-10-17 (Johnald): Luck cannot be raised. No XP buys a Luck rank, on the sheet or at
 * enlistment, and a player's Edit mode cannot set one; a GM in Edit mode still can, for corrections.
 */
IROP.attributeAdvance.locked = ["lck"];

/** Whether an attribute's ranks are locked against raising. */
export function rankLocked(key) {
  return IROP.attributeAdvance.locked.includes(key);
}

/** HANDOFF Section 9: a boon raises one attribute by 10. */
IROP.boonAmount = 10;

/* -------------------------------------------- */
/*  Skills                                      */
/* -------------------------------------------- */

/**
 * LIVE: the 22 skills on the played sheet and the attribute each draws its
 * dice from. The handoff names most of them but defers the full list to the
 * Skills 2.0 document, which is not on disk, so the live sheet is the source.
 * Coercion draws on Strength on the live sheet.
 */
IROP.skills = {
  acrobatics: { label: "Acrobatics", attribute: "agi", group: "physical" },
  athletics: { label: "Athletics", attribute: "str", group: "physical" },
  awareness: { label: "Awareness", attribute: "per", group: "physical" },
  biology: { label: "Biology", attribute: "int", group: "knowledge" },
  coercion: { label: "Coercion", attribute: "str", group: "social" },
  cybernetics: { label: "Cybernetics", attribute: "int", group: "knowledge" },
  deception: { label: "Deception", attribute: "cha", group: "social" },
  hacking: { label: "Hacking", attribute: "int", group: "knowledge" },
  history: { label: "History", attribute: "int", group: "knowledge" },
  insight: { label: "Insight", attribute: "per", group: "social" },
  investigation: { label: "Investigation", attribute: "int", group: "knowledge" },
  lockpicking: { label: "Lock Picking", attribute: "agi", group: "knowledge" },
  mechanics: { label: "Mechanics", attribute: "int", group: "knowledge" },
  medical: { label: "Medical", attribute: "int", group: "knowledge" },
  paraphysics: { label: "Paraphysics", attribute: "cha", group: "knowledge" },
  persuasion: { label: "Persuasion", attribute: "cha", group: "social" },
  stealth: { label: "Stealth", attribute: "agi", group: "physical" },
  // RULED 2026-10-07: Survivalism, as the live sheet named it. The key stays "survival".
  survival: { label: "Survivalism", attribute: "per", group: "knowledge" },
  tactics: { label: "Tactics", attribute: "int", group: "knowledge" },
  technology: { label: "Technology", attribute: "int", group: "knowledge" },
  xenobiology: { label: "Xenobiology", attribute: "int", group: "knowledge" },
  xenotech: { label: "Xenotechnology", attribute: "int", group: "knowledge" }
};

/**
 * RULED 2026-10-07 (Johnald): the sheet sorts skills into Physical, Knowledge
 * and Social, by the group on each skill above. First proposed with Survivalism,
 * Lock Picking and Paraphysics elsewhere; he moved all three to Knowledge.
 *
 * Layout: groups fill a two column grid in this order. Physical and Social (four
 * skills each) sit side by side; Knowledge (fourteen) is wide, spanning both
 * columns with its list split in two.
 */
IROP.skillGroups = {
  physical: { label: "Physical" },
  social: { label: "Social" },
  knowledge: { label: "Knowledge", wide: true }
};

/**
 * HANDOFF Section 4 and 16: skills have four ranks. RULED 2026-10-08 (Johnald),
 * settling the PHB 10/20/30/40 against Skills 2.0 20/40/60/80: a skill pip costs
 * 20, 40, 60 or 80 XP by which pip is bought.
 */
IROP.skillRanks = { max: 4, xpCost: [20, 40, 60, 80] };

/** HANDOFF Section 4. */
IROP.startingXP = 100;
IROP.startingCredits = 200;

/**
 * The three currencies on an operative's sheet (RULED 2026-10-07), keyed as in
 * system.wealth. An item's price is in one of them, Credits unless set otherwise (Johnald,
 * 2026-10-10, for stores). `short` is how a price reads: the armory prints "25 cr".
 */
IROP.currencies = {
  credits: { label: "Credits", short: "cr" },
  valuables: { label: "Valuables", short: "Valuables" },
  alloys: { label: "Alien Alloys", short: "Alloys" }
};
IROP.currencyLabels = Object.fromEntries(Object.entries(IROP.currencies).map(([k, c]) => [k, c.label]));

/**
 * Stores (Johnald, 2026-10-10): several, each its own actor, stocked by the GM; players buy
 * at once and the price comes off their sheet. Markup is a percent over the items' own prices
 * (negative for a discount). Buy back is the percent of an item's price the store pays for
 * it, 0 for one that buys nothing. ASSUMED defaults: no markup, buys back at half.
 */
IROP.store = { markup: 0, markupMin: -90, markupMax: 500, sellBack: 50 };

/**
 * Concealment of carried gear (Johnald, 2026-10-10; rules/concealment.mjs). Pass or fail, no skill
 * check: what an operative carries that shows, against their carry capacity, must be no more than
 * the place's share.
 *   RULED: Slums 50%, Megacities 25%; caught, the player may hand over items of their choice until
 *     under, and what they hand over is gone; the GM picks the place at a checkpoint; an item ticked
 *     Concealable, or fitted with a mod that conceals its host, does not count; this is apart from
 *     the combat Concealment status, which stays.
 *   ASSUMED: the share is of carry capacity (the Carried bar's maximum); at the limit exactly passes.
 */
IROP.concealment = {
  places: {
    slums: { label: "Slums", limit: 50 },
    megacity: { label: "Megacity", limit: 25 }
  },
  // RULED (Johnald, 2026-10-10: "For humans lets add a species ability that allots them an additional
  // 10% of concealment for slums and megacities"): percent points added at every place, by species
  // name, so every Human has it at once. Effects add more through system.bonuses.concealment.
  speciesBonus: { Human: 10 }
};

/**
 * The turn order ribbon across the top of the screen in combat (Johnald, 2026-10-11; apps/turn-ribbon.mjs).
 *   RULED: the tactical ribbon he picked from the mockups; wide, tall cards; the acting card opens out
 *     with a large portrait on its left; hostiles wear the GENESIS livery, as the opposition's dice do.
 *   ASSUMED, until he rules: the condition words and where each starts; that players see a hostile's
 *     condition and its status effects but not its numbers or dodges; that everyone sees operatives'
 *     numbers (squadmates), and anyone who may observe an actor sees its numbers too.
 */
IROP.turnOrder = {
  // Health left, as a share of the maximum: full is Unhurt; above each share, its word; nothing left, Down.
  condition: {
    full: "Unhurt",
    bands: [
      { above: 0.5, label: "Hurt" },
      { above: 0.25, label: "Wounded" },
      { above: 0, label: "Critical" }
    ],
    none: "Down"
  },
  // Players see the status effects on combatants whose numbers they cannot see.
  statusesShown: true,
  // The edge color of each side. Operatives wear their doctrine's color, or ODR sky without one.
  sides: {
    operative: { label: "Operative", color: "#42abf2" },
    ally: { label: "Ally", color: "#42abf2" },
    neutral: { label: "Neutral", color: "#b9c4c8" },
    hostile: { label: "Hostile", color: "#c4121c" }
  },
  // Dodge pips drawn at most; past this the count shows as a number.
  maxPips: 6
};

/**
 * The turn marker under the acting token (Johnald, 2026-10-11: the blend of the segmented bezel and
 * the callout band). White, so Foundry's "Match disposition" tints it by side; Foundry uses it unless
 * the GM sets an image of their own in Combat Tracker Settings.
 */
IROP.turnMarker = "systems/irop/assets/markers/turn-marker.svg";

/* -------------------------------------------- */
/*  Derived statistics                          */
/* -------------------------------------------- */

/**
 * LIVE formulas, as the Sandbox sheet computed them. Each takes the prepared
 * attribute modifiers and returns a number.
 *
 *   Health      species health + TGH mod      (RULED 2026-10-06: base health varies by
 *                                              species; the handoff's 8 is the Human value.
 *                                              The TGH modifier is added as live play did)
 *   Energy      species energy + CHA mod + INT mod
 *   Critical    10 + PER mod + 2 x LCK mod
 *   Luck Points max equals LCK mod
 *   Carry       30 + 2 x STR mod + TGH mod     (handoff agrees)
 *   Throw range 2 x STR mod tiles
 *   Initiative  1d20 + AGI mod + LCK mod
 *   Movement    shift 2, run 4 + AGI mod, sprint 2 x run, before armor and
 *               effect bonuses, which add flat to each speed (below)
 *   Dodges      1 per round
 */
IROP.derived = {
  health: (mods, species) => species.health + mods.tgh,
  energy: (mods, species) => species.energy + mods.cha + mods.int,
  critical: mods => 10 + mods.per + (2 * mods.lck),
  luck: mods => mods.lck,
  carry: mods => 30 + (2 * mods.str) + mods.tgh,
  throwRange: mods => 2 * mods.str,
  moveShift: () => 2,
  moveRun: mods => 4 + mods.agi,
  dodges: () => 1
};

/**
 * RULED 2026-10-06: three speeds, as the Field Manual's movement actions name
 * them and the live sheet showed them: Shift (a quick action, 2 tiles), Run
 * (the Move action, 4 + AGI mod) and Sprint (two actions, turn ending, 2 x Run).
 * The live sheet also computed a fourth, 4 x Run, that it never displayed; it
 * is not a speed and is not carried over.
 *
 * RULED 2026-10-06: an armor's mobility bonus varies from armor to armor, so
 * each armor carries a flat bonus per speed. The usual bonus is +1 to Run and
 * Sprint; some armor boosts Shift instead. Sprint is figured from the unarmored
 * Run, then the flat bonuses are added, so a Run bonus does not double into Sprint.
 */
IROP.speeds = {
  shift: "Shift",
  run: "Run",
  sprint: "Sprint"
};

/* RULED 2026-10-06: Morale is a scrapped system. The live sheet's Morale stat is not carried over. */

/**
 * The Personnel Record: the operative's dossier drawer. Plain text fields, in the
 * order the record shows them; add or drop entries here.
 *
 * RULED 2026-10-06: the identity box uses the fields of the reference record
 * Johnald supplied (an in-world personnel terminal), less Measurements. Section
 * sits indented under Profession, as in the reference. The record opens on the
 * left of the sheet, and the long Biography lives in it.
 */
IROP.record = {
  title: "Eclipse Personnel Record",
  identity: [
    { key: "firstName", label: "First name" },
    { key: "lastName", label: "Last name" },
    { key: "age", label: "Age" },
    { key: "race", label: "Race" },
    { key: "nationality", label: "Nationality", placeholder: "pre-war nation, megacity, haven" },
    { key: "profession", label: "Profession", placeholder: "trade or posting" },
    { key: "section", label: "Section", placeholder: "cell, fireteam", indent: true },
    { key: "height", label: "Height" },
    { key: "hair", label: "Hair color" },
    { key: "eyes", label: "Eye color" }
  ],
  service: [
    { key: "enlisted", label: "Enlisted", placeholder: "date joined Eclipse" },
    { key: "assignment", label: "Assignment" },
    { key: "registry", label: "GENESIS registry", placeholder: "status on file" }
  ],
  log: ["Secure link established", "Retrieving dossier", "Decrypting", "Cell use only"]
};

/**
 * ODR RANKS, Johnald 2026-10-17: ten, by XP earned, loosely after real military ranks, shown on the
 * Personnel Record. Squaddie, the first (2026-10-08), is renamed Initiate. Each has a Space Force
 * inspired sleeve patch (dev/build-rank-insignia.mjs): chevrons for the enlisted, rockers under them
 * for the senior enlisted, a gold star for the sergeants, bars for the warrant and the officers.
 * `from` is the XP earned the band starts at. RULED: his example, 100 to 250 (everyone starts at
 * 100) and 251 to 400. ASSUMPTION: the names, and the bands above those two, widening as they climb;
 * Ranger lines up with the first specialization (300 earned), Fireteam Corporal with the second (900).
 * `like` is the real rank each is loosely after.
 */
IROP.ranks = {
  initiate: { label: "Initiate", from: 0, like: "Private", insignia: "systems/irop/assets/icons/ranks/initiate.svg" },
  ranger: { label: "Ranger", from: 251, like: "Private Second Class", insignia: "systems/irop/assets/icons/ranks/ranger.svg" },
  rangerFirst: { label: "Ranger First Class", from: 401, like: "Private First Class", insignia: "systems/irop/assets/icons/ranks/rangerFirst.svg" },
  lanceRanger: { label: "Lance Ranger", from: 601, like: "Lance Corporal", insignia: "systems/irop/assets/icons/ranks/lanceRanger.svg" },
  fireteamCorporal: { label: "Fireteam Corporal", from: 851, like: "Corporal", insignia: "systems/irop/assets/icons/ranks/fireteamCorporal.svg" },
  strikeSergeant: { label: "Strike Sergeant", from: 1151, like: "Sergeant", insignia: "systems/irop/assets/icons/ranks/strikeSergeant.svg" },
  deltaSergeant: { label: "Delta Sergeant", from: 1501, like: "Master Sergeant", insignia: "systems/irop/assets/icons/ranks/deltaSergeant.svg" },
  orbitalWarrant: { label: "Orbital Warrant", from: 1901, like: "Warrant Officer", insignia: "systems/irop/assets/icons/ranks/orbitalWarrant.svg" },
  deltaLieutenant: { label: "Delta Lieutenant", from: 2401, like: "Lieutenant", insignia: "systems/irop/assets/icons/ranks/deltaLieutenant.svg" },
  deltaCaptain: { label: "Delta Captain", from: 3001, like: "Captain", insignia: "systems/irop/assets/icons/ranks/deltaCaptain.svg" }
};

/** HANDOFF Section 9 and LIVE species items: the default when no species is set (Human). */
IROP.defaultSpecies = { health: 8, energy: 10 };

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

/**
 * LIVE: the twelve damage types. RULED 2026-10-06: the type is Electric; the
 * live sheet's "Lightning DR" was an inconsistency.
 */
IROP.damageTypes = {
  ballistic: { label: "Ballistic" },
  physical: { label: "Physical" },
  laser: { label: "Laser" },
  plasma: { label: "Plasma" },
  fire: { label: "Fire" },
  cold: { label: "Cold" },
  acid: { label: "Acid" },
  electric: { label: "Electric" },
  sonic: { label: "Sonic" },
  explosive: { label: "Explosive" },
  psychic: { label: "Psychic" },
  cosmic: { label: "Cosmic" }
};

/* -------------------------------------------- */
/*  Roles                                       */
/* -------------------------------------------- */

/** HANDOFF Section 4 and CLAUDE.md: the six doctrines and their accent colors. */
IROP.roles = {
  legionary: { label: "Legionary", color: "#5fb85f" },
  marauder: { label: "Marauder", color: "#e08a3c" },
  specialist: { label: "Specialist", color: "#d9b234" },
  outrider: { label: "Outrider", color: "#d64f4f" },
  warmachine: { label: "Warmachine", color: "#4a90d9" },
  vanguard: { label: "Vanguard", color: "#3fb8b0" }
};

/** Where an ability comes from. The six roles, plus sources outside them. */
IROP.abilitySources = {
  legionary: "Legionary",
  marauder: "Marauder",
  specialist: "Specialist",
  outrider: "Outrider",
  warmachine: "Warmachine",
  vanguard: "Vanguard",
  generalist: "Generalist",
  species: "Species",
  // A perk taken from a background (2026-10-10).
  background: "Background",
  other: "Other"
};

/**
 * Perk trees (RULED 2026-10-08). Each role has a Primary tree and specializations;
 * a General tree (the Generalist perks) is open to everyone. Order on the Dossier:
 * Primary, then specializations, then General.
 */
IROP.treeKinds = {
  primary: "Primary",
  specialization: "Specialization",
  general: "General"
};

/** Who a tree is for: a role, or blank for Everyone. */
IROP.treeRoles = {
  "": "Everyone",
  legionary: "Legionary",
  marauder: "Marauder",
  specialist: "Specialist",
  outrider: "Outrider",
  warmachine: "Warmachine",
  vanguard: "Vanguard"
};

/* -------------------------------------------- */
/*  Weapons, armor, gear                        */
/* -------------------------------------------- */

/**
 * Weapon categories and the attribute an attack rolls against.
 * HANDOFF Section 6: ranged against Perception, melee against Strength.
 * LIVE: grenades are thrown against Strength.
 */
IROP.weaponCategories = {
  ranged: { label: "Ranged", attribute: "per" },
  melee: { label: "Melee", attribute: "str" },
  thrown: { label: "Thrown", attribute: "str" },
  explosive: { label: "Explosive", attribute: null }
};

/**
 * RULED 2026-10-08 (Johnald): the Combat tab sorts weapons into Ranged, Melee,
 * Special and Explosives. Special is the launchers (LAW, Rocket Launcher,
 * Grenade Launcher, RPG: the Rocket Launcher class) and the chemthrowers. A
 * weapon may name its section; "By category", the default, sends those to
 * Special, melee to Melee, thrown and explosive to Explosives, the rest to Ranged.
 */
IROP.weaponGroups = {
  ranged: "Ranged",
  melee: "Melee",
  special: "Special",
  explosives: "Explosives"
};
IROP.weaponGroupChoices = { auto: "By category", ...IROP.weaponGroups };

/**
 * RULED 2026-10-08 (Johnald): the weapon classes, consolidated from the old
 * specialty families ("we have too much here"). Ranged: Small Arms (pistols,
 * magnums), Rifles (assault rifles, SMGs), Saturation (LMGs, SAWs), Precision
 * (DMRs, sniper rifles), Shotguns (sawn-offs, shotguns). Melee: Natural, One
 * Handed, Two Handed (knives, axes and shields fold in). Special: Chemthrower,
 * Launchers. Grenade and Explosive stay for the Explosives section, which the
 * ruling did not touch: grenades count down and launchers scatter by class.
 * Natural weapons (bites, claws, the Bio-Spike Launcher) take no mods and no
 * special ammo. The role Weapon Specialties in the handoff still name the old
 * families; flagged to him.
 */
IROP.weaponClasses = {
  smallArms: "Small Arms",
  rifles: "Rifles",
  saturation: "Saturation",
  precision: "Precision",
  shotguns: "Shotguns",
  natural: "Natural",
  oneHanded: "One Handed",
  twoHanded: "Two Handed",
  chemthrower: "Chemthrower",
  launcher: "Launchers",
  grenade: "Grenade",
  // Added 2026-10-08: the RPG is a rocket ("a standard rocket within the arsenal of
  // explosives"), the ammunition a Rocket Launcher loads, not a launcher itself.
  rocket: "Rocket",
  explosive: "Explosive"
};

/**
 * RULED 2026-10-08 (Johnald): how a weapon is fed. Magazine is the usual clip with
 * one special ammo slot. Single use (the LAW) is fired once and tossed. Fuel (the
 * chemthrowers) is a tank out of 100 spent in burns. Grenades and Rockets are
 * launchers that load actual grenade or rocket items into slots, four for a grenade
 * launcher and one for a rocket launcher; a loaded one fires on a click.
 */
IROP.weaponFeeds = {
  magazine: { label: "Magazine" },
  singleUse: { label: "Single use" },
  fuel: { label: "Fuel" },
  grenades: { label: "Grenades (4 slots)", slots: 4, takes: "grenade", noun: "grenade" },
  rockets: { label: "Rockets (1 slot)", slots: 1, takes: "rocket", noun: "rocket" }
};
IROP.weaponFeedChoices = Object.fromEntries(Object.entries(IROP.weaponFeeds).map(([k, f]) => [k, f.label]));

/**
 * The old class keys and where each went, for items saved before 2026-10-08.
 * "other" and "turret" had no home in the ruling, so they follow the category.
 */
IROP.weaponClassMigration = {
  pistol: "smallArms", magnum: "smallArms",
  assaultRifle: "rifles", smg: "rifles",
  lmg: "saturation", saw: "saturation",
  dmr: "precision", sniperRifle: "precision",
  shotgun: "shotguns",
  knife: "oneHanded", axe: "oneHanded", shield: "oneHanded",
  rocketLauncher: "launcher"
};
// The only explosive classed as a rocket launcher was the RPG, which is a rocket.
IROP.weaponClassMigrationByCategory = { explosive: { rocketLauncher: "rocket" } };
IROP.weaponClassByCategory = { ranged: "smallArms", melee: "oneHanded", thrown: "grenade", explosive: "explosive" };

/** Short class names for the line under a weapon's name on the Combat tab (Johnald, 2026-10-08). */
IROP.weaponClassShort = {
  oneHanded: "1H",
  twoHanded: "2H"
};

/** HANDOFF Section 6: firing while engaged depends on the weapon. */
IROP.weaponHandling = {
  light: { label: "Light", engagedPenalty: 0 },
  standard: { label: "Standard", engagedPenalty: 20 },
  cumbersome: { label: "Cumbersome", engagedPenalty: 40 }
};

/** HANDOFF Section 6: range bands. The D.M. for each lives on the weapon. */
/**
 * What a project's progress is counted in, on the board and its sheet (Johnald, 2026-10-18): Progression,
 * not the Logistics or Intel that may be spent to push it.
 */
IROP.progressUnit = "Progression";

/** Weapon types, finer than classes, for the role perks (Johnald, 2026-10-18). See rules/weapon-types.mjs. */
IROP.weaponTypes = WEAPON_TYPES;

IROP.rangeBands = {
  short: "Short",
  medium: "Medium",
  long: "Long",
  extreme: "Extreme"
};

IROP.armorClasses = {
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
  shield: "Shield",
  other: "Other"
};

/**
 * The armor classes that are a full suit (Johnald, 2026-10-09): only one is worn at a time,
 * so putting one on takes the other off. Shields and other pieces go with any suit.
 */
IROP.bodyArmorClasses = ["light", "medium", "heavy"];

/**
 * The shape set down on the map when something with a Blast is used (Johnald, 2026-10-09):
 * chosen on the item, a circle unless it says otherwise. Blast is the circle's radius, half
 * the square's side, or the length of a cone or line. A cone is 90 degrees wide and a line
 * one tile wide (ASSUMED); both turn with the mouse wheel while being placed.
 */
IROP.blastTemplates = {
  circle: "Circle",
  square: "Square",
  cone: "Cone",
  line: "Line",
  none: "No template"
};
IROP.blastShape = { coneAngle: 90, lineWidth: 1 };

/**
 * Mod slots, ruled by Johnald 2026-10-06 for the Weapon Mods module:
 * ranged 3, melee 2, Light armor 3, Medium 4, Heavy 3, anything else 3.
 * These are only the defaults a new item starts with; each item can override.
 */
/** RULED 2026-10-08: Special weapons (launchers, chemthrowers) get one mod slot by default. */
IROP.modSlots = {
  special: 1,
  weapon: { ranged: 3, melee: 2, thrown: 0, explosive: 0 },
  armor: { light: 3, medium: 4, heavy: 3, shield: 3, other: 3 }
};

/** Which kind of item a mod fits. */
IROP.modTargets = {
  ranged: "Ranged weapon",
  melee: "Melee weapon",
  armor: "Armor"
};

IROP.gearKinds = {
  general: "General",
  medical: "Medical",
  consumable: "Consumable",
  deployable: "Deployable",
  plating: "Armor Plating",
  ammunition: "Ammunition",
  // A paraphysical focus (2026-10-19): -20 on paraphysical attacks under the -25 ceiling. It weighs
  // against carry capacity and can never be concealed.
  focus: "Paraphysical Focus",
  // Psycrystals are loot (Johnald, 2026-10-20): found, bought and sold like any gear, never a
  // currency. The ones a character carries are the ones they can spend.
  psycrystal: "Psycrystal"
};

/* -------------------------------------------- */
/*  Abilities and paraphysics                   */
/* -------------------------------------------- */

/** HANDOFF Section 6: the action types. */
IROP.actionTypes = {
  dual: "Dual Action",
  turnEnding: "Turn Ending Action",
  single: "Single Action",
  quick: "Quick Action",
  reaction: "Reaction",
  passive: "Passive",
  none: "None"
};

/**
 * The twelve paraphysics disciplines, GENESIS taxonomy (Paraphysics Framework Draft 0.6, Johnald,
 * 2026-10-18 and 19). Form is Vitakinesis, Cosmic is Astrokinesis, Divining is the twelfth. The
 * Sandbox era "Energy" school migrates to Astrokinesis.
 */
IROP.disciplines = {
  telekinesis: "Telekinesis",
  telepathy: "Telepathy",
  pyrokinesis: "Pyrokinesis",
  astrokinesis: "Astrokinesis",
  vitakinesis: "Vitakinesis",
  optics: "Optics",
  cryokinesis: "Cryokinesis",
  electrokinesis: "Electrokinesis",
  spatial: "Spatial",
  hemokinesis: "Hemokinesis",
  entropy: "Entropy",
  divining: "Divining"
};

/** Each discipline's wave and what it owns. Wave two is hidden from players for now. */
IROP.disciplineInfo = {
  telekinesis: { wave: 1, owns: "Forced movement, Pinned, object weaponization" },
  telepathy: { wave: 1, owns: "Mind Control, Panicked, silent communication, memory. Fails on mind immune creatures" },
  pyrokinesis: { wave: 1, owns: "Ignited, area denial, persistent burning ground" },
  astrokinesis: { wave: 1, owns: "Cover in both directions, Cosmic damage" },
  vitakinesis: { wave: 1, owns: "All healing, augmentation, barriers on allies" },
  optics: { wave: 1, owns: "Disorientated, Concealment, detection, decoys. Works on mind immune creatures" },
  cryokinesis: { wave: 2, owns: "Frostbite, Brittle, static destructible cover" },
  electrokinesis: { wave: 2, owns: "Electrified, crits, chains, machines" },
  spatial: { wave: 2, owns: "Teleportation and position swapping" },
  hemokinesis: { wave: 2, owns: "HP as a casting cost, blood curses" },
  entropy: { wave: 2, owns: "Shred, Acidized, cover destruction" },
  divining: { wave: 2, owns: "Precognition: deja vu and premonition" }
};

/** The framework's numbers (Draft 0.6). Values marked OPEN in the framework are not here. */
IROP.paraphysics = {
  // Waves open to players: 1 until wave two is written.
  openWave: 1,
  // Humans: Charisma, up to five schools (a species may say otherwise).
  attribute: "cha",
  schools: 5,
  rankMax: 5,
  creationMax: 2,
  // Powers a discipline holds per rank (Johnald, 2026-10-19: two, for more options in the field).
  slotsPerRank: 2,
  // Discipline ranks 1 to 5, by which rank is bought.
  disciplineXp: [50, 75, 100, 125, 150],
  powerMax: 5,
  // Power Ranks 2 to 4 cost XP; 1 (learning it) and 5 (its evolution) a psycrystal.
  powerXp: { 2: 20, 3: 40, 4: 60 },
  crystalRanks: [1, 5],
  awakenCost: 2,
  // A focus: -20, sharing the -25 ceiling with the Accuracy track.
  focus: -20,
  accuracyCeiling: -25,
  // In Optimal Range: twice the casting modifier, as a bonus. Out of it: +15 to hit (Johnald, 2026-10-20).
  optimalRangeTimes: 2,
  outOfRange: 15,
  // The discipline discount touches powers of base cost 4 or more.
  discountFrom: 4
};

/**
 * The five profile tracks a power advances two of, by what Rank 2 and Rank 4 add (2026-10-19).
 * Accuracy is a D.M. (minus is better); Potency goes on the target's save. null is OPEN.
 */
IROP.powerTracks = {
  accuracy: { label: "Accuracy", rank2: -10, rank4: -15 },
  potency: { label: "Potency", rank2: 4, rank4: 6 },
  damage: { label: "Damage", rank2: null, rank4: null },
  duration: { label: "Duration", rank2: null, rank4: null },
  range: { label: "Range", rank2: null, rank4: null }
};

/** The Rank 3 choice node library (proposed in the framework, not final). Each power offers two or three. */
IROP.powerArchetypes = {
  lingering: { label: "Lingering", text: "Effect duration extended." },
  chain: { label: "Chain", text: "Jumps to a second target at reduced effect." },
  piercing: { label: "Piercing", text: "Ignores a defense it normally respects." },
  overload: { label: "Overload", text: "Spend additional Energy for scaled effect." },
  reflexive: { label: "Reflexive", text: "Usable as a reaction." },
  wide: { label: "Wide", text: "Single target becomes a small area." },
  // What an archetype does to the numbers when it is copied onto a power; the GM edits it per power.
  efficient: { label: "Efficient", text: "Energy cost 1 less, never below half its base.", changes: { energy: -1 } },
  anchored: { label: "Anchored", text: "No longer requires Concentration.", changes: { anchored: true } },
  // Save powers only (Johnald, 2026-10-29): +1 Energy, paid or not at each cast.
  adaptive: { label: "Adaptive", text: "You may for the added cost of +1 energy change the attribute required to save from this power.",
    changes: { energy: 1, optionalEnergy: true, adaptive: true } }
};

IROP.mutationPolarity = {
  positive: "Positive",
  negative: "Negative"
};

/** HANDOFF Section 9: the mutant castes. Barons are the only playable one. */
IROP.castes = {
  "": "None",
  serf: "Serf",
  vassal: "Vassal",
  baron: "Baron",
  monarch: "Monarch"
};

/** For NPC sheets. ASSUMED labels; nothing in the rules tiers NPCs yet. */
IROP.npcThreats = {
  minion: "Minion",
  soldier: "Soldier",
  elite: "Elite",
  boss: "Boss"
};

/* -------------------------------------------- */
/*  Status effects                              */
/* -------------------------------------------- */

/**
 * The twelve status effects, worded from the field guide (site guide.html, Status Effects), which
 * outranks the handoff's shorter Section 8 (Johnald, 2026-10-10), with his rulings that day:
 * Pinned's +20 D.M. makes the pinned creature's own attacks harder (roll low); Ignited's cure is a
 * flat Agility check; Frostbite cuts Run and Sprint each by X; Panicked ends on a flat Charisma
 * test, an ally's Help (one of their actions) giving a re-roll; every X effect ticks down by 1 each
 * turn except Stunned and Vulnerable.
 *
 * `counter`: the status carries an (X), asked for when it is put on from a sheet (statuses.mjs);
 * `counterHint` says what X counts. X ticks down by 1 at the start of each of the creature's turns
 * (rules/durations.mjs, 2026-10-20), except where `ticks` is false; `onTurn` is what the turn's
 * start does first, read out in chat with X in it.
 *
 * Added beyond those twelve: Disorientated and Suppressed, which Section 6
 * lists as battlefield modifiers, so a token can carry them and the attack
 * dialog can tick them automatically; and Bleeding Out and Dead, the two downed
 * states Section 6 names. "dead" is also the id core Foundry uses for defeat.
 */
IROP.statusEffects = [
  { id: "ignited", name: "Ignited", img: "icons/svg/fire.svg", counter: true, counterHint: "fire damage each turn", onTurn: "takes X fire damage",
    text: "Take fire damage equal to X at the start of each turn; X drops by 1 each turn until 0. Cured by Hunkering Down, or by a flat Agility check that costs 1 action." },
  { id: "poisoned", name: "Poisoned", img: "icons/svg/poison.svg", counter: true, counterHint: "+10 D.M. to all checks per point",
    text: "All checks take +10 D.M. per X: Poisoned (3) is +30 to all checks. Ticks down each turn. Cured by a Medkit or an Antidote." },
  { id: "acidized", name: "Acidized", img: "icons/svg/acid.svg", counter: true, counterHint: "damage each turn, doubled against armor", onTurn: "takes X acid damage, doubled against armor",
    text: "Damage like Ignited, but X doubles against armor points. Overflow past destroyed armor carries into HP (minimum 1). Ticks down each turn. Cured by Base Paste." },
  { id: "frostbite", name: "Frostbite", img: "icons/svg/frozen.svg", counter: true, counterHint: "damage each turn, and Run and Sprint each cut by it", onTurn: "takes X cold damage, Run and Sprint each cut by X",
    text: "Take X damage at the start of each turn, and Run and Sprint speed are each reduced by X. Ticks down each turn. Cured by Warming Gel." },
  { id: "pinned", name: "Pinned", img: "icons/svg/net.svg", counter: false,
    text: "Speed is set to 0, and its attacks take +20 D.M. If the pinner takes damage, make a contested Athletics check (+1 per 5 damage dealt) to break free. Ends by winning that check." },
  { id: "concealment", name: "Concealment", img: "icons/svg/invisible.svg", counter: false,
    text: "Won't trigger overwatch in most cases, and attacks made from concealment take -5 D.M. Entered with a Challenging Stealth check, which costs an action. Any non-movement action breaks it." },
  { id: "mindControl", name: "Mind Control", img: "icons/svg/daze.svg", counter: false,
    text: "The controller decides the target's turn. A Charisma save partly mitigates the orders (a shotgun order becomes a pistol). Cured by disorienting or killing the controller." },
  { id: "panicked", name: "Panicked", img: "icons/svg/terror.svg", counter: true, counterHint: "turns", onTurn: "Hunkers Down at once",
    text: "At the start of its turn the creature immediately Hunkers Down, for X turns. Ticks down each turn. Ended by a flat Charisma test; an ally can spend one of their actions to Help, giving a re-roll." },
  { id: "vulnerable", name: "Vulnerable", img: "icons/svg/downgrade.svg", counter: true, counterHint: "bonus damage on the next hit", ticks: false,
    text: "The first time it takes damage, add bonus damage equal to X, then the status drops. Cured by a Medkit before it triggers." },
  { id: "bleeding", name: "Bleeding", img: "icons/svg/blood.svg", counter: true, counterHint: "damage when acting", onTurn: "takes X damage on its first action other than self healing, past armor and barriers",
    text: "Take X damage when taking any action other than self-healing, once per turn. Bypasses armor and barriers. Ticks down each turn. Cured by a Medkit." },
  { id: "electrified", name: "Electrified", img: "icons/svg/lightning.svg", counter: true, counterHint: "damage each turn, doubled against barriers", onTurn: "takes X electric damage, doubled against barriers",
    text: "Damage like Ignited, but X doubles against barrier or shield points. Overflow past destroyed shields carries into HP (minimum 1). Ticks down each turn. Cured by a Grounding Stake." },
  { id: "stunned", name: "Stunned", img: "icons/svg/paralysis.svg", counter: true, counterHint: "actions lost", ticks: false,
    text: "Lose actions equal to X, usually 1, though some abilities and creatures stun for longer. Cured by an Adrenal Shot." },
  { id: "disorientated", name: "Disorientated", img: "icons/svg/stoned.svg", counter: false,
    text: "+20 D.M. to attacks and dodges. Speed halved (rounded down), no Concentration actions, and maintained concentration breaks." },
  // A Telestoi's Glamor held (2026-10-20): 3 Energy committed while it holds.
  { id: "glamor", name: "Glamor", img: "icons/svg/mystery-man.svg", counter: false,
    text: "Holding Telestoian Glamor: a disguise on the minds around you. 3 Energy is committed while it holds. Falls if you go down; Disorientated does not break it." },
  // A power's Concentration held (2026-10-20); the power it is for rides on the status.
  { id: "concentrating", name: "Concentrating", img: "icons/svg/eye.svg", counter: false,
    text: "Holding a power that needs Concentration. Disorientated breaks it; concentrating on another power lets this one go." },
  { id: "suppressed", name: "Suppressed", img: "icons/svg/down.svg", counter: false,
    text: "+20 D.M. to attacks. Item and ability range capped at two tiles. Paraphysical abilities are unaffected." },
  { id: "bleedingOut", name: "Bleeding Out", img: "icons/svg/unconscious.svg", counter: false,
    text: "Downed. See the Bleeding Out rules." },
  { id: "dead", name: "Dead", img: "icons/svg/skull.svg", counter: false,
    text: "Character Death. See the Next of Kin rule." }
];

/* -------------------------------------------- */
/*  Strategy Layer                              */
/* -------------------------------------------- */

/**
 * The Strategy Layer (docs/Strategy_Layer_2026-10-08.md, Johnald's rules doc).
 * A campaign is a set of territories at the scale the GM picks; each scale names
 * its territories differently. Every territory has the same stats.
 */
IROP.strategyScales = {
  global: { label: "Global", unit: "Super region" },
  superRegion: { label: "Super region", unit: "Region" },
  region: { label: "Region", unit: "Sector" },
  city: { label: "City", unit: "District" }
};

/**
 * What a territory is. GENESIS moves Strength out of rural and wildland
 * territories first, then slums, then Megacities (doc, GENESIS Phase step 2).
 */
IROP.territoryKinds = {
  megacity: { label: "Megacity", icon: "icons/svg/city.svg", drain: 3 },
  slums: { label: "Slums", icon: "icons/svg/house.svg", drain: 2 },
  rural: { label: "Rural", icon: "icons/svg/village.svg", drain: 1 },
  wildland: { label: "Wildland", icon: "icons/svg/mountain.svg", drain: 1 }
};

/** Who holds a territory. A liberated one is an ODR base and blocks GENESIS ground movement. */
IROP.territoryControl = {
  genesis: "GENESIS held",
  contested: "Contested",
  liberated: "Liberated"
};

/** The five Heat levels, with the doc's example response. */
IROP.heatLevels = [
  { label: "None", response: "Police response before military units are mobilized." },
  { label: "Low", response: "Military units are mobilized first, in ground transports." },
  { label: "Medium", response: "Alien and GENESIS units arrive by air and ground at greater speed; stratagems and combat vehicles start to be deployed." },
  { label: "High", response: "Elite soldiers drop on the squad's position from orbit within minutes." },
  { label: "Maximum", response: "Alien combat units are teleported to the squad's position." }
];

/**
 * REPUTATION, RULED 2026-10-11 (Johnald): like Strength, a bar of points, here inside each of
 * nine levels, four up from Neutral and four down. Gains and losses move the points; the level
 * changes only when the bar fills (up) or empties (down), and the new level starts at the middle
 * of its bar, the overflow thrown away. Hard to move, easy to hold. The same engine runs a
 * territory's Reputation and a faction's standing (rules/reputation.mjs).
 */
IROP.reputationScale = { levels: 4, points: 10, entry: 5 };

/** Reputation in a territory, -4 to +4: the populace's ladder. The old -2 to +2 doubled into it. */
IROP.reputationLevels = {
  "-4": "Hostile",
  "-3": "Resentful",
  "-2": "Wary",
  "-1": "Uneasy",
  "0": "Neutral",
  "1": "Sympathetic",
  "2": "Friendly",
  "3": "Supportive",
  "4": "Devoted"
};

/**
 * STRATEGY RULES, the numbers the turn engine runs on. RULED 2026-10-08 (Johnald):
 * these defaults stand, and a GM can change any of them in game (Configure
 * Settings, Strategy Layer rules). Where the doc gives a number it is quoted;
 * the rest are ASSUMPTIONS the doc left open, marked so.
 */
IROP.strategyRules = {
  strengthMax: 25,              // RULED 2026-10-11 (Johnald): Strength runs 0 to 25 per territory (was 10; worlds scaled x2.5)
  megacityGrowthEvery: 8,       // doc: every 8 turns each Megacity gains +1 Strength
  megacityGrowth: 1,
  strengthMoves: 3,             // ASSUMPTION, scaled to 25 (RULED 2026-10-11): a hotter territory pulls 3 Strength from one cooler neighbour a turn
  heatRise: { minor: 1, major: 2, critical: 3 },   // ASSUMPTION: skirmish or ambush; security station or VIP; base or propaganda centre
  heatQuietWeeks: 2,            // doc: Heat falls where nothing happened for two turns
  heatFall: 1,                  // ASSUMPTION: by one level
  researchPassive: 10,          // doc: 10 Logistics of progress per turn
  engineeringPassive: 10,       // ASSUMPTION: the doc gives no rate; matches Research
  engineeringSlots: 3,          // doc: up to 3 Engineering Actions at a time
  intelPassive: 10,             // doc: 10 Intel per turn, read as progress on the active Intelligence Actions
  salvagePercent: 30,           // doc: recovered salvage gives 30% of a research project's cost
  eventEvery: 2,                // doc: the Event Phase is every 2nd turn
  eventDraw: 3,
  darkEventEvery: 4,            // doc: every 4 turns draw 3 Dark Events, use 2
  darkEventDraw: 3,
  darkEventKeep: 2,
  worldEventEvery: 2,           // ASSUMPTION (Johnald asked for the deck, 2026-10-08): World Events come with the Event phase
  worldEventDraw: 1,            // ASSUMPTION: one World Event each time
  incursionStrength: 20,        // RULED 2026-10-08 as 8 of 10, kept at 80% on the 25 scale (2026-10-11): a neighbour of a liberated territory at this Strength launches an Incursion
  incursionWeeks: 1,            // ASSUMPTION (step 7): weeks the ODR has to stop an Incursion before it lands
  incursionMoves: 8,            // ASSUMPTION, scaled to 25: Strength an Incursion that lands brings into the territory it retakes
  incursionLoss: 8,             // ASSUMPTION, scaled to 25: Strength the staging territory loses when its Incursion is broken
  liberationHeat: 2,            // ASSUMPTION: doc "nearby Megacities and their surrounding regions spike in Heat"; by this much
  liberationReach: 2,           // ASSUMPTION: as far as this many borders from the liberated area
  missionReputation: {          // RULED 2026-10-11, in Reputation points: the doc says successes raise it and undeniable failures lower it
    success: 2,
    partial: 1,
    failure: -2,
    civilians: -4               // an undeniable failure, or civilians hurt
  },
  cardReputation: 3,            // RULED 2026-10-11: Reputation points in each step of a card's Reputation effect
  cardStrength: 3,              // RULED 2026-10-11: Strength in each step of a card's Strength effect, on the 25 scale
  factions: {                   // Faction tasks (2026-10-11), in standing points. RULED 2026-10-11: done +2, failed -2
    taskStanding: 2,            // standing a task done earns with its faction
    taskFailure: 2,             // standing a task failed, or left undone at its deadline, costs
    rivalLoss: 2,               // ASSUMPTION: standing lost with a faction a task works against, when it is done
    taskTurns: 1,               // turns a new task runs: 1 is due by the end of the turn it is offered
    partialPercent: 50,         // a partial success earns this share of the rewards, rounded down
    lapseLoss: 0                // standing lost when an offered task is left untaken (0: no cost to turning work down)
  },
  support: {                    // doc: General Uses of Logistics
    reinforcements: 10,
    insideJobMin: 10,
    insideJobMax: 25,
    hiddenCache: 15,
    mortarStrike: 30,
    emergencyExtraction: 50
  }
};

/**
 * The Resistance's two stocks (Strategy Layer step 3, 2026-10-08). Doc: Logistics is
 * "the currency of the strategy layer"; Intel is the rarer secondary resource.
 */
IROP.resources = {
  logistics: { label: "Logistics", icon: "fa-solid fa-boxes-stacked" },
  intel: { label: "Intel", icon: "fa-solid fa-satellite-dish" }
};

/**
 * Support in tactical battles, paid in Logistics (doc: General Uses of Logistics).
 * What each costs is a rule the GM can change (IROP.strategyRules.support, named
 * by `cost`); what each does is the doc's text.
 */
IROP.supportOptions = {
  reinforcements: { label: "Reinforcements", icon: "fa-solid fa-people-group", cost: "reinforcements",
    effect: "Resistance soldiers break cover and assist you. They deploy nearby and follow the squad's orders. While they may not be the most skilled, sometimes a few extra guns are all it takes to change the outcome of a battle." },
  insideJob: { label: "Inside Job", icon: "fa-solid fa-key", cost: "insideJobMin", most: "insideJobMax",
    effect: "The Resistance uses one of their many connections to your benefit, from something as simple as an unlocked door to delaying GENESIS' response time. GM discretion, but this cannot directly interact with GENESIS forces. Cost depends on what is asked for." },
  hiddenCache: { label: "Hidden Cache", icon: "fa-solid fa-box-open", cost: "hiddenCache",
    effect: "Request the location of hidden Resistance supplies. A nearby location will contain items useful for the situation at hand. The GM should be as helpful as possible when choosing items without directly solving the problem." },
  mortarStrike: { label: "Mortar Strike", icon: "fa-solid fa-burst", cost: "mortarStrike",
    effect: "Designate three non-overlapping areas on the map. Roll three d100s; any roll of 75+ causes that strike to scatter 1d4 tiles. Each mortar deals 3d4+4 damage, radius 3, Destructive 6." },
  emergencyExtraction: { label: "Emergency Extraction", icon: "fa-solid fa-helicopter", cost: "emergencyExtraction",
    effect: "Call for an emergency evacuation to escape a potentially lethal situation. It generally takes at least 1 full combat round to arrive. Initially an armored civilian transport is available, but more options can be discovered over time." }
};

/* -------------------------------------------- */
/*  The turn and the ODR phase (steps 4, 5)     */
/* -------------------------------------------- */

/** How much Heat an action raises (IROP.strategyRules.heatRise), as the debrief offers it. */
IROP.heatClasses = {
  none: "None",
  minor: "Minor",
  major: "Major",
  critical: "Critical"
};

/**
 * The ODR's projects (doc: Research, Engineering and Intelligence Actions). Research
 * and Engineering are paid and progressed in Logistics, Intelligence in Intel.
 */
IROP.projectKinds = {
  research: { label: "Research", icon: "fa-solid fa-flask", resource: "logistics" },
  engineering: { label: "Engineering", icon: "fa-solid fa-helmet-safety", resource: "logistics" },
  intelligence: { label: "Intelligence", icon: "fa-solid fa-user-secret", resource: "intel" }
};

/** Where a project stands. Hidden ones are the GM's until shown. */
IROP.projectStatus = {
  hidden: "Hidden from players",
  available: "Available",
  active: "Under way",
  complete: "Complete"
};

/** Doc: one Short Term and one Long Term Intelligence Action at a time. */
IROP.intelTerms = {
  short: "Short term",
  long: "Long term"
};

/** What an Engineering project builds (doc: regional upgrades, base upgrades, tactical assets). */
IROP.engineeringBuilds = {
  regional: "Regional upgrade",
  base: "Base upgrade",
  asset: "Tactical asset"
};

/** Doc: soldiers with any Social skill, Stealth, Hacking or Lock Picking work Intelligence Actions. */
IROP.intelSkills = ["stealth", "hacking", "lockpicking"];

/**
 * The Tactical Actions always open (doc: Always Available), with what each rewards.
 * The Heat each raises by default is an ASSUMPTION from the heatRise notes (skirmish
 * or ambush minor; security station or VIP major); the debrief can change it.
 */
IROP.tacticalActions = {
  ambushPatrols: { label: "Ambush Patrols", heat: "minor", rewards: "Corpses, valuables, loot. Minor Logistics, minor Heat." },
  scavenge: { label: "Scavenge for Basic Resources", heat: "minor", rewards: "Logistics, alloys, valuables." },
  securityStation: { label: "Low-Priority GENESIS Security Station", heat: "major", rewards: "Higher risk than an ambush or a scavenge, but greater rewards." },
  obviousAsset: { label: "Obvious GENESIS Asset", heat: "major", rewards: "A GENESIS asset in plain sight." },
  distressCall: { label: "Respond to a Distress Call", heat: "minor", rewards: "If one is available." },
  respondEvent: { label: "Respond to an Event or Dark Event", heat: "minor", rewards: "If one is available." },
  vip: { label: "Low-Priority VIP Extraction or Assassination", heat: "major", rewards: "High Heat manipulation, plus Intel if captured." },
  // Step 7 (doc: every Megacity has three assets that must be taken). Only at a Megacity.
  megacityAssault: { label: "Assault a Megacity objective", heat: "critical", megacity: true,
    rewards: "Take the military citadel, the motor pool or the center of government. All three liberate the Megacity." }
};

/**
 * The two sides' facilities in a territory, for the card's quick view (Johnald, 2026-10-08).
 * Built Engineering upgrades join the Rebellion's; a Megacity's objectives join GENESIS's.
 */
IROP.facilitySides = {
  rebellion: { label: "Rebellion", down: "Lost", placeholder: "Safe house, supply cache, cell" },
  genesis: { label: "GENESIS", down: "Destroyed", placeholder: "Security station, propaganda center" }
};

/**
 * Weather on the territory card (Johnald, 2026-10-08: "something fun"). Each climate sets a
 * year's middle temperature (degrees F), how far the seasons swing it, how far a turn can
 * wander from that, and the odds of each condition. ALL ASSUMPTIONS, for flavour.
 */
IROP.climates = {
  temperate: { label: "Temperate", base: 57, swing: 18, spread: 8,
    weights: { clear: 25, partly: 25, overcast: 18, rain: 17, storm: 4, fog: 6, wind: 5 } },
  wet: { label: "Rainy coast", base: 52, swing: 13, spread: 6,
    weights: { clear: 10, partly: 15, overcast: 22, rain: 32, storm: 3, fog: 15, wind: 3 } },
  coastal: { label: "Warm coast", base: 66, swing: 9, spread: 7,
    weights: { clear: 45, partly: 22, overcast: 8, rain: 5, fog: 16, wind: 4 } },
  arid: { label: "Desert", base: 68, swing: 22, spread: 10,
    weights: { clear: 45, partly: 15, haze: 15, wind: 10, dust: 12, storm: 3 } },
  alpine: { label: "Mountain", base: 45, swing: 20, spread: 10,
    weights: { clear: 25, partly: 18, overcast: 15, rain: 10, snow: 12, storm: 6, fog: 6, wind: 8 } },
  continental: { label: "Inland plains", base: 50, swing: 28, spread: 10,
    weights: { clear: 30, partly: 20, overcast: 15, rain: 13, storm: 8, wind: 10, fog: 4 } }
};

/** The conditions: their look, a nudge to the temperature, and the wind they bring (mph). */
IROP.weatherConditions = {
  clear: { label: "Clear", icon: "fa-sun" },
  partly: { label: "Partly cloudy", icon: "fa-cloud-sun" },
  overcast: { label: "Overcast", icon: "fa-cloud" },
  rain: { label: "Rain", icon: "fa-cloud-rain", temp: -3 },
  storm: { label: "Thunderstorm", icon: "fa-cloud-bolt", temp: -4, wind: [15, 40] },
  fog: { label: "Fog", icon: "fa-smog", temp: -2, wind: [0, 6] },
  snow: { label: "Snow", icon: "fa-snowflake", wind: [2, 18] },
  wind: { label: "High winds", icon: "fa-wind", wind: [22, 45] },
  dust: { label: "Dust storm", icon: "fa-wind", wind: [25, 50] },
  haze: { label: "Heat haze", icon: "fa-temperature-high", temp: 3, wind: [0, 8] },
  smog: { label: "Smog", icon: "fa-smog", wind: [0, 8] },
  // The vault's own tag on The Glasslands: Paraphysical Storms.
  paraStorm: { label: "Paraphysical storm", icon: "fa-bolt-lightning", wind: [10, 35] }
};

/** A Megacity's three objectives (doc: Megacity Objectives). */
IROP.megacityObjectives = {
  citadel: "Military citadel",
  motorPool: "Motor pool",
  government: "Center of government"
};

/**
 * FACTIONS (2026-10-11): the ODR's standing with the other groups on the board, major and
 * minor, and the tasks they offer from turn to turn. Standing runs on the Reputation engine
 * (IROP.reputationScale), with its own ladder, as factions are organizations, not crowds
 * (RULED 2026-10-11). The stance line on a faction carries the nuance a level cannot
 * ("Dangerous ally", "Business only").
 */
IROP.factionTiers = {
  major: { label: "Major factions", one: "Major", icon: "fa-solid fa-landmark" },
  minor: { label: "Minor factions", one: "Minor", icon: "fa-solid fa-people-group" }
};

IROP.factionLevels = {
  "-4": { label: "At War", text: "Hunts the ODR openly, and will spend its own people to hurt it." },
  "-3": { label: "Hostile", text: "Works against the ODR when it can, and sells what it learns." },
  "-2": { label: "Unfriendly", text: "Keeps its distance, deals only at a steep price, and may talk to the wrong people." },
  "-1": { label: "Wary", text: "Will hear the ODR out, and trusts none of it." },
  "0": { label: "Neutral", text: "Deals when it suits them. Neither help nor harm is promised." },
  "1": { label: "Cordial", text: "Open to business, and to trading small favors." },
  "2": { label: "Friendly", text: "Trades fairly, passes on what it hears, and offers regular work." },
  "3": { label: "Trusted", text: "Shares supplies and safe houses, and asks the ODR for help in turn." },
  "4": { label: "Allied", text: "Stands with the ODR: shelters operatives, and fights beside them when asked." }
};

/** Where a faction task stands. */
IROP.factionTaskStatus = {
  draft: "Draft",
  offered: "Offered",
  accepted: "Taken",
  resolved: "Resolved",
  lapsed: "Lapsed"
};

/** How a mission ended, at the debrief. */
IROP.missionOutcomes = {
  success: "Success",
  partial: "Partial success",
  failure: "Failure"
};

/**
 * What a territory's Strength means for a mission briefing, by share of the highest
 * Strength. The doc gives the low and high ends; the middle band is an ASSUMPTION.
 */
IROP.strengthBands = [
  { upTo: 0.3, label: "Low", text: "Patrols of a few troopers." },
  { upTo: 0.7, label: "Moderate", text: "Regular GENESIS squads, with some support." },
  { upTo: 1, label: "High", text: "Elite Xar'Nath squads with paraphysical specialists and close air support." }
];

/** What Reputation means on a mission (doc: Effects of Reputation). */
IROP.reputationEffects = {
  high: "Civilians might look the other way, or even stick their necks out for the ODR, potentially buying the squad just enough time to escape.",
  low: "People might call GENESIS if the squad is spotted, or even attack them to curry favor with the aliens."
};

/* -------------------------------------------- */
/*  Event and Dark Event cards (step 6)         */
/* -------------------------------------------- */

/**
 * The two decks (doc: Event Phase, and the GENESIS phase's Dark Events). Each card
 * says what it changes when revealed and when discarded; the GM writes the rest as
 * the card's text.
 */
IROP.cardKinds = {
  event: { label: "Event", back: "systems/irop/assets/cards/event-back.svg", icon: "fa-solid fa-bolt" },
  dark: { label: "Dark Event", back: "systems/irop/assets/cards/dark-back.svg", icon: "fa-solid fa-skull" },
  // Johnald, 2026-10-08: a neutral deck of world events, favouring neither side.
  world: { label: "World Event", back: "systems/irop/assets/cards/world-back.svg", icon: "fa-solid fa-earth-americas" }
};

/**
 * The card stacks the War Room keeps, found by their flag so a GM can rename them.
 * In play holds both kinds; each card remembers its territory and the week it landed.
 */
IROP.cardStacks = {
  eventDeck: { name: "Event deck", type: "deck", kind: "event" },
  darkDeck: { name: "Dark Event deck", type: "deck", kind: "dark" },
  worldDeck: { name: "World Event deck", type: "deck", kind: "world" },
  inPlay: { name: "Events in play", type: "pile" },
  darkHand: { name: "GENESIS hand", type: "hand" },
  discard: { name: "Discard", type: "pile" }
};

/** What a card can change, on a territory or in the stock. Heat waits for next week (doc). */
IROP.cardEffects = {
  logistics: "Logistics",
  intel: "Intel",
  strength: "Strength steps",
  heat: "Heat next turn",
  reputation: "Reputation steps"
};

/** The Mortar Strike as the doc runs it. Scatter direction is the canon 1d8 from North. */
IROP.mortarStrike = {
  strikes: 3,
  scatterOn: 75,
  scatter: "1d4",
  damage: "3d4 + 4",
  damageType: "explosive",
  radius: 3,
  destruction: 6
};

/**
 * The calendar (Johnald, 2026-10-08). A new world opens on this date, once, where nothing
 * has set the time yet; the GM moves it from the Calendar window. The year is RULED
 * (2026-09-30: the campaign year is 2040); 1 January is ASSUMED. Counted from 0: month 0
 * is January, day 0 the 1st.
 */
IROP.calendarStart = { year: 2040, month: 0, dayOfMonth: 0, hour: 8, minute: 0 };

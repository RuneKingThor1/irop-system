/**
 * Build the test kit macro from a Sandbox world dump.
 * Run: node dev/build-test-kit.mjs <items.json from the world backup> [out.js]
 *
 * Converts the old world's cItems (species, roles, backgrounds, boons, weapons,
 * armor, gear, a handful of abilities) into this system's item data, validates
 * every one against the real data models, and writes a GM macro that creates
 * them in an "Insurrection Test Kit" folder with a ready made test operative and
 * a test NPC. For testing only: content import proper is a separate job.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [itemsPath, outPath = path.join(ROOT, "dev", "test-kit-macro.js")] = process.argv.slice(2);
if ( !itemsPath ) throw new Error("Pass the path to items.json from the world dump.");

const common = await import("file:///C:/Program%20Files/Foundry%20Virtual%20Tabletop/resources/app/common/server.mjs");
globalThis.foundry = { ...common };
globalThis.CONST = common.CONST;
globalThis.game = { settings: { get() { throw new Error("none"); } } };
const models = await import("../module/data/item.mjs");
const { IROP } = await import("../module/config.mjs");

const all = JSON.parse(fs.readFileSync(itemsPath, "utf8"))
  .filter(i => i._key.startsWith("!items!") && (i.type === "cItem"));
const groupOf = i => (i.system.groups ?? []).map(g => g.ikey)
  .find(k => !["cover_type", "rng_fndr_grp", "cover_crit_type"].includes(k));
const byName = name => all.find(i => i.name === name);

/* -------------------------------------------- */
/*  Parsing helpers                             */
/* -------------------------------------------- */

const attr = (i, k) => i.system.attributes?.[k]?.value;
const num = v => {
  const n = parseInt(String(v ?? "").replace(/[^\d+-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};
const clean = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Old formula syntax to new: @{str_mod} to @str.mod, @{telekinesis_rank} to @paraphysics.telekinesis. */
function formula(f) {
  if ( !f ) return "";
  return String(f)
    .replace(/@\{(str|agi|tgh|cha|lck|int|per)_mod\}/g, "@$1.mod")
    .replace(/@\{(str|agi|tgh|cha|lck|int|per)\}/g, "@$1.value")
    .replace(/@\{(\w+)_rank\}/g, "@paraphysics.$1")
    .replace(/\s*([+-])\s*/g, " $1 ").trim();
}

function damageType(v) {
  const k = String(v ?? "").trim().toLowerCase();
  return IROP.damageTypes[k] ? k : null;
}

/** Every table in a description as rows of cleaned cells. */
function tables(html) {
  return [...String(html ?? "").matchAll(/<table[\s\S]*?<\/table>/g)].map(t =>
    [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map(r => [...r[0].matchAll(/<td[\s\S]*?<\/td>/g)].map(c => clean(c[0]))));
}

/** Header to value from any "Amount" table (Shred, Penetration, Destruction, Crit Damage, Blast...). */
function amounts(html) {
  const out = {};
  for ( const rows of tables(html) ) {
    const amount = rows.find(r => /^amount$/i.test(r[0]));
    if ( !amount ) continue;
    rows[0].forEach((h, i) => { if ( h ) out[h.toLowerCase()] = amount[i]; });
  }
  return out;
}

/** Rangefinder tiles: the far end of each band ("1 - 6" is 6, "<10" is 10). */
function rangeTiles(html) {
  for ( const rows of tables(html) ) {
    const tiles = rows.find(r => /tile range/i.test(r[0]));
    if ( !tiles ) continue;
    const ends = tiles.slice(1).map(c => {
      const ns = (c.match(/\d+/g) ?? []).map(Number);
      return ns.length ? Math.max(...ns) : 0;
    });
    return { short: ends[0] ?? 0, medium: ends[1] ?? 0, long: ends[2] ?? 0, extreme: ends[3] ?? 0 };
  }
  return { short: 0, medium: 0, long: 0, extreme: 0 };
}

function cost(html) {
  const m = clean(html).match(/Cost\s*:\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

/** List items under "Additional Properties" or "Special Properties", by name only. */
function properties(html) {
  const m = String(html ?? "").match(/Properties<\/h3>\s*<ul>([\s\S]*?)<\/ul>/i);
  if ( !m ) return [];
  return [...m[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(li => clean(li[1]).split(":")[0].trim()).filter(Boolean);
}

/* -------------------------------------------- */
/*  Converters                                  */
/* -------------------------------------------- */

/**
 * Corrections from Johnald (2026-10-08) where a weapon's name gives the wrong class:
 * "Lucy" is a T5 plasma pistol, and these are natural weapons.
 */
const NATURAL_WEAPONS = ["Bite", "Acid Bite", "Claw Attack", "Vassal Claws", "Bio-Spike Launcher"];
const WEAPON_FIXES = {
  '"Lucy"': { weaponClass: "smallArms", tier: 5, damageType: "plasma" },
  // Special weapons (RULED 2026-10-08). The LAW is fired once and tossed. The launchers
  // load grenades or rockets, which bring their own damage, so the launcher has none
  // ("See Grenade", "See Rocket" on the old sheet). The Flame Chemthrower burns fuel; its
  // text gives the AGI save, Ignited (3), and the range D.M.s on the save (+5, +10, -10).
  "LAW": { system: { feed: "singleUse", ammo: { value: 0, max: 0 } } },
  "Grenade Launcher": { system: { feed: "grenades", damage: { formula: "", type: "explosive" }, ammo: { value: 0, max: 0 } } },
  "Rocket Launcher": { system: { feed: "rockets", damage: { formula: "", type: "explosive" }, ammo: { value: 0, max: 0 } } },
  "Flame Chemthrower": { system: {
    feed: "fuel", ammo: { value: 0, max: 0 },
    fuel: { value: 100, max: 100, cost: 10, maxBurns: 5 },
    burn: { save: "agi", status: "ignited", statusValue: 3 },
    range: { short: { tiles: 2, dm: 5 }, medium: { tiles: 4, dm: 10 }, long: { tiles: 6, dm: -10 }, extreme: { tiles: 0, dm: 0 } }
  } }
};

/** The weapon classes as consolidated on 2026-10-08 (Johnald); see IROP.weaponClasses. */
function weaponClass(name, group) {
  const n = name.toLowerCase();
  if ( NATURAL_WEAPONS.includes(name) ) return "natural";
  if ( /chem ?thrower|flame ?thrower/.test(n) ) return "chemthrower";
  if ( group === "grenades" ) return "grenade";
  // The RPG is a rocket, ammunition for a rocket launcher (2026-10-08).
  if ( group === "explosives" ) return /rpg/.test(n) ? "rocket" : "explosive";
  if ( group === "melwepn" ) return /\(2h\)/.test(n) ? "twoHanded" : "oneHanded";
  if ( /sawn-off|shotgun/.test(n) ) return "shotguns";
  if ( /\bsaw\b|\blmg\b/.test(n) ) return "saturation";
  if ( /\bdmr\b|sniper/.test(n) ) return "precision";
  if ( /magnum|pistol/.test(n) ) return "smallArms";
  if ( /rocket|\blaw\b|grenade launcher/.test(n) ) return "launcher";
  if ( /\bsmg\b|assault rifle|\bar\b|rifle/.test(n) ) return "rifles";
  return "smallArms";
}

function convertWeapon(i) {
  const group = groupOf(i);
  const html = i.system.description;
  const a = amounts(html);
  const props = properties(html);
  const category = { melwepn: "melee", grenades: "thrown", explosives: "explosive" }[group] ?? "ranged";
  const dmg = formula(attr(i, { melwepn: "dmgrollmelee", grenades: "dmgrollgrenade", explosives: "dmgrollexplosive" }[group]
    ?? "dmgrollt1gun") || attr(i, "vis_dmg"));
  const tiles = rangeTiles(html);
  const fallbackType = category === "melee" ? "physical" : (group === "grenades" || group === "explosives" ? "explosive" : "ballistic");
  const clip = num(attr(i, "clip"));
  return {
    name: i.name,
    type: "weapon",
    system: {
      description: html ?? "",
      category,
      weaponClass: WEAPON_FIXES[i.name]?.weaponClass ?? weaponClass(i.name, group),
      tier: WEAPON_FIXES[i.name]?.tier ?? num((i.name.match(/^T(\d)\b/) ?? [])[1]),
      handling: props.some(p => /^light$/i.test(p)) ? "light" : (props.some(p => /cumbersome/i.test(p)) ? "cumbersome" : "standard"),
      accuracy: num(attr(i, "accu_bonus")),
      damage: { formula: dmg, type: WEAPON_FIXES[i.name]?.damageType ?? damageType(attr(i, "dmg_type")) ?? fallbackType },
      critical: { chance: num(attr(i, "critc_bonus")), damage: num(a["crit damage"]) || num(attr(i, "critd_bonus")) },
      shred: num(a.shred),
      penetration: num(a.penetration),
      destruction: num(a.destruction),
      blast: num(a.radius ?? a["blast radius"]),
      ...(category === "ranged" ? { range: {
        short: { tiles: tiles.short, dm: num(attr(i, "short_range")) },
        medium: { tiles: tiles.medium, dm: num(attr(i, "medium_range")) },
        long: { tiles: tiles.long, dm: num(attr(i, "long_range")) },
        extreme: { tiles: tiles.extreme, dm: num(attr(i, "extreme_range")) }
      } } : {}),
      ammo: category === "ranged" ? { value: clip, max: clip } : { value: 0, max: 0 },
      properties: props.join(", "),
      quantity: 1,
      weight: num(attr(i, "wght")),
      price: cost(html),
      // Special weapon feeds and the like, from Johnald's rulings (2026-10-08).
      ...(WEAPON_FIXES[i.name]?.system ?? {})
    }
  };
}

function convertArmor(i) {
  const n = i.name;
  const armorClass = /shield/i.test(n) ? "shield" : /heavy/i.test(n) ? "heavy" : /medium/i.test(n) ? "medium"
    : /light/i.test(n) ? "light" : (n === "Kevlar Armor" ? "medium" : "other");
  const dr = num(attr(i, "dr_armor"));
  const mobility = num(attr(i, "bonus_mobility"));
  const dodges = (i.system.mods ?? []).filter(m => m.attribute === "dodge_pool.max").reduce((s, m) => s + num(m.value), 0);
  // RULED 2026-10-07 (correcting 2026-10-06): the HP Bonus is the ablative armor HP,
  // and the Armor Bonus is the Defense added to shots against the wearer.
  const points = num(attr(i, "hp_armor"));
  const defense = num(attr(i, "armr_bonus"));
  return {
    name: n,
    type: "armor",
    system: {
      description: i.system.description ?? "",
      armorClass,
      points,
      defense,
      dr: dr ? { ballistic: dr, physical: dr } : {},
      mobility: mobility ? { run: mobility, sprint: mobility } : {},
      dodges,
      quantity: 1,
      weight: num(attr(i, "wght")),
      price: cost(i.system.description)
    }
  };
}

function convertGear(i) {
  const group = groupOf(i);
  const kind = { medicae: "medical", cnsm: "deployable", armorplating: "plating" }[group] ?? "general";
  const data = {
    name: i.name,
    type: "gear",
    system: {
      description: i.system.description ?? "",
      kind,
      formula: formula(attr(i, "medkitheal")),
      consumable: kind === "medical",
      quantity: 1,
      weight: num(attr(i, "wght")),
      price: cost(i.system.description)
    }
  };
  // LIVE: the Backpack added 5 to carry. Here that is an effect while carried.
  if ( i.name === "Backpack" ) {
    data.effects = [{ name: "Backpack", img: "icons/svg/item-bag.svg", transfer: true,
      changes: [{ key: "system.bonuses.carry", mode: 2, value: "5" }] }];
  }
  return data;
}

const speciesNotes = [];

/** The "Starting Attributes" table in a species description, as attribute keys to scores. */
function startingAttributes(html) {
  const out = {};
  for ( const rows of tables(html) ) {
    for ( const [label, value] of rows ) {
      const key = Object.entries(IROP.attributes).find(([, a]) => a.label.toLowerCase() === String(label).toLowerCase())?.[0];
      if ( key && /^\d+$/.test(String(value)) ) out[key] = Number(value);
    }
  }
  return out;
}

function convertSpecies(i) {
  const mods = i.system.mods ?? [];
  const hp = mods.find(m => m.attribute === "hp.max");
  const en = mods.find(m => m.attribute === "ener.max");
  const health = num(hp?.value);
  const energy = num(String(en?.value ?? "").match(/^\d+/)?.[0]);
  // The description states the same numbers in prose; note where the two disagree.
  const text = clean(i.system.description);
  const statedHealth = Number(text.match(/Base Health:?\s*(\d+)/i)?.[1] ?? NaN);
  const statedEnergy = Number(text.match(/Base Energy:?\s*(\d+)/i)?.[1] ?? NaN);
  if ( Number.isFinite(statedHealth) && (statedHealth !== health) ) {
    speciesNotes.push(`${i.name}: health ${health} on the sheet, ${statedHealth} in its description`);
  }
  if ( Number.isFinite(statedEnergy) && (statedEnergy !== energy) ) {
    speciesNotes.push(`${i.name}: energy ${energy} on the sheet, ${statedEnergy} in its description`);
  }
  return {
    name: i.name,
    type: "species",
    system: {
      description: i.system.description ?? "",
      health,
      energy,
      attributes: { ...IROP.attributeDefaults, ...startingAttributes(i.system.description) },
      playable: i.name !== "GENESIS",
      mutations: i.name === "Mutant",
      boons: i.name === "Human",
      // RULED 2026-10-08 (Johnald): Reticulons are all paraphysical.
      paraphysical: i.name === "Reticulon"
    }
  };
}

/** HANDOFF Section 4: the role table. */
const ROLE_TABLE = {
  legionary: ["Awareness, Investigate or Athletics", "Agility, Perception", "Assault Rifles, SAWs, SMGs, Shotguns",
    "Rally, Pour it On!, Chained Shot", "Pointman, Field Tactician, Punisher"],
  // RULED 2026-10-08 (Johnald): the first is the free one: Awareness for the Marauder, Athletics for the Warmachine.
  marauder: ["Awareness, Athletics or Survivalism", "Agility, Perception", "Shotguns, SMGs, Shields, Axes",
    "Spray and Pray, Run and Gun, Raid Time", "Commando, Defender, Liquidator"],
  specialist: ["Medical, Biology or Mechanics", "Intelligence, Perception", "Assault Rifles, SMGs, Pistols, Grenades",
    "Jury Rig, Paramedic, With the Wind", "Medic, Sapper, Engineer"],
  outrider: ["Stealth, Acrobatics or Lockpicking", "Agility, Perception", "Sniper Rifles, DMRs, Pistols, Magnums, Knives",
    "Disabling Shot, Hit and Run, Called Shot", "Ghost, Sharpshooter, Gunslinger"],
  warmachine: ["Athletics, Survivalism or Coercion", "Toughness, Perception", "LMGs, SAWs, Rocket Launchers, Turrets",
    "Eat Lead!, Area Suppression, Sweeping Fire", "Rocketeer, Guardian, Machinist"],
  vanguard: ["Athletics, Tactics or History", "Strength, Toughness", "One and Two Handed Melee, Shields",
    "Bladestorm, Charge, Cross Strike", "Frontbreaker, Knight, Duelist"]
};

function convertRole(i) {
  const role = i.name.toLowerCase();
  const [startingSkills, preferredAttributes, weaponSpecialties, roleAbilities, specializations] = ROLE_TABLE[role];
  return { name: i.name, type: "role", system: { description: i.system.description ?? "", role, startingSkills,
    preferredAttributes, weaponSpecialties, roleAbilities, specializations } };
}

function convertBackground(i) {
  const text = clean(i.system.description);
  const m = text.match(/Starting Skills[^:]*:\s*([^.]*?)(?:\s{2,}|$|Cost|Equipment)/i);
  return { name: i.name, type: "background", system: { description: i.system.description ?? "",
    startingSkills: m ? m[1].trim() : "",
    // The Awakened are "paraphysically enabled": the Paraphysical tag (2026-10-08).
    paraphysical: /paraphysically enabled/i.test(text) } };
}

function convertBoon(i) {
  const key = Object.entries(IROP.attributes).find(([, a]) => i.name.startsWith(a.label))?.[0];
  return { name: i.name.replace(/ Boon A$/, " Boon"), type: "boon",
    system: { description: i.system.description ?? "", attribute: key, amount: 10 } };
}

/** A few abilities, enough to test use, Energy and paraphysics attacks. */
function abilities() {
  const out = [];
  const charge = byName("Charge");
  out.push({ name: "Charge", type: "ability", system: { description: charge?.system.description ?? "", kind: "active",
    source: "vanguard", tree: "Primary", energyCost: num(attr(charge, "enercost")) || 6, actionType: "single" } });
  for ( const [name, discipline, source] of [["Gravbolt", "telekinesis", "other"], ["Reticulon Psi-Lance", "telekinesis", "species"]] ) {
    const i = byName(name);
    out.push({ name, type: "ability", system: { description: i?.system.description ?? "", kind: "active", source,
      energyCost: num(attr(i, "enercost")),
      paraphysics: { discipline, attack: true, accuracy: num(attr(i, "accu_bonus")),
        damage: { formula: formula(attr(i, "dmgrollparaphys")), type: "psychic" } } } });
  }
  for ( const [name, discipline] of [["Reticulon Instill Panic", "telepathy"], ["Reticulon Mind Control", "telepathy"],
    ["Barrier Restoration", "energy"]] ) {
    const i = byName(name);
    out.push({ name, type: "ability", system: { description: i?.system.description ?? "", kind: "active", source: "species",
      energyCost: num(attr(i, "enercost")), range: num(attr(i, "tilerange")), paraphysics: { discipline } } });
  }
  out.push({ name: "Resilience (1)", type: "ability",
    system: { description: "<p>Pre-Requisites: None</p><p>Gain +2 HP</p>", kind: "passive", source: "generalist" },
    effects: [{ name: "Resilience (1)", img: "icons/svg/regen.svg", transfer: true,
      changes: [{ key: "system.vitals.hp.bonus", mode: 2, value: "2" }] }] });
  return out;
}

/** Placeholder mods: the real mod list lives in the live world, added after this backup. */
function testMods() {
  return [
    { name: "Reflex Sight (test)", type: "mod", system: { target: "ranged", weight: 1,
      description: "<p>Test mod. Fits a ranged weapon.</p>" } },
    { name: "Grip Wrap (test)", type: "mod", system: { target: "melee", weight: 0,
      description: "<p>Test mod. Fits a melee weapon.</p>" } },
    { name: "Ceramic Insert (test)", type: "mod", system: { target: "armor", weight: 1,
      description: "<p>Test mod. +2 armor HP while fitted.</p>" },
      effects: [{ name: "Ceramic Insert", img: "icons/svg/shield.svg", transfer: true,
        changes: [{ key: "system.vitals.armor.bonus", mode: 2, value: "2" }] }] }
  ];
}

/* -------------------------------------------- */
/*  Build                                       */
/* -------------------------------------------- */

const folders = {
  "Species": all.filter(i => groupOf(i) === "speci").map(convertSpecies),
  "Roles": all.filter(i => groupOf(i) === "grole").map(convertRole),
  "Backgrounds": all.filter(i => groupOf(i) === "bckrole").map(convertBackground),
  "Boons": all.filter(i => groupOf(i) === "boon_grp").map(convertBoon),
  "Weapons": all.filter(i => ["wepn", "melwepn", "grenades", "explosives"].includes(groupOf(i)))
    .filter(i => !/template/i.test(i.name)).map(convertWeapon),
  "Armor": all.filter(i => groupOf(i) === "armr").map(convertArmor),
  "Gear": all.filter(i => ["medicae", "gear_group", "cnsm", "armorplating"].includes(groupOf(i))).map(convertGear),
  "Abilities": abilities(),
  "Mods": testMods(),
  // Placeholders: the real mutation tables were imported into the live world after this backup.
  "Mutations": [
    { name: "Positive Mutation (test)", type: "mutation", system: { polarity: "positive",
      description: "<p>Test mutation. Only a Mutant operative can carry it.</p>" } },
    { name: "Negative Mutation (test)", type: "mutation", system: { polarity: "negative",
      description: "<p>Test mutation. Only a Mutant operative can carry it.</p>" } }
  ]
};

// HANDOFF Section 9: Telestoi, not in the old world's species list.
folders.Species.push({ name: "Telestoi", type: "species", system: {
  description: "<p>A proud, refined, magnetic species from Elysthae in the Eridani System. (Block from the handoff.)</p>",
  health: 6, energy: 10, attributes: { str: 30, agi: 30, tgh: 40, cha: 50, lck: 30, int: 40, per: 40 }, playable: true } });

const MODELS = { weapon: models.WeaponData, armor: models.ArmorData, gear: models.GearData, mod: models.ModData,
  ability: models.AbilityData, species: models.SpeciesData, role: models.RoleData, background: models.BackgroundData,
  boon: models.BoonData, mutation: models.MutationData };

// Validate every item strictly against the real data models.
let count = 0;
const problems = [];
for ( const [folder, list] of Object.entries(folders) ) {
  for ( const item of list ) {
    count++;
    const failure = MODELS[item.type].schema.validate(item.system, { partial: true });
    if ( failure ) problems.push(`${folder}/${item.name}: ${failure}`);
    try { new MODELS[item.type](item.system, { strict: true }); }
    catch(err) { problems.push(`${folder}/${item.name}: ${err.message.split("\n").slice(0, 3).join(" ")}`); }
  }
}

const template = fs.readFileSync(path.join(ROOT, "dev", "test-kit-template.js"), "utf8");
const macro = template.replace("/*__KIT__*/{}", JSON.stringify(folders));
fs.writeFileSync(outPath, macro);

for ( const [f, list] of Object.entries(folders) ) console.log(`${f.padEnd(12)} ${list.length}`);
console.log(`${count} items, ${problems.length} validation problems`);
problems.forEach(p => console.log("  " + p));
if ( speciesNotes.length ) console.log("Species sheet values and descriptions disagree:\n  " + speciesNotes.join("\n  "));
for ( const sp of folders.Species ) {
  const attrs = Object.entries(sp.system.attributes ?? {}).map(([k, v]) => `${k} ${v}`).join(" ");
  console.log(`  ${sp.name.padEnd(10)} health ${sp.system.health}, energy ${sp.system.energy} | ${attrs}`);
}
console.log(`wrote ${outPath} (${Math.round(macro.length / 1024)} KB)`);

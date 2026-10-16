/**
 * Data model tests against Foundry's real data layer.
 * Run: node test/models.test.mjs [path to a census JSON]
 *
 * Loads Foundry 13's own common modules (the same ones the server runs), so the
 * schemas, field validation and cleaning here are the genuine article. Then
 * cross checks derived statistics against the live campaign's stored values.
 */
import fs from "node:fs";

const COMMON = "file:///C:/Program%20Files/Foundry%20Virtual%20Tabletop/resources/app/common/server.mjs";
const foundryCommon = await import(COMMON);
globalThis.foundry = foundryCommon;
globalThis.CONST = foundryCommon.CONST;
globalThis.game = { settings: { get() { throw new Error("no settings in tests"); } } };

const { OperativeData, NpcData } = await import("../module/data/actor.mjs");
const items = await import("../module/data/item.mjs");
const { IROP } = await import("../module/config.mjs");

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if ( cond ) pass++;
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

/** Foundry requires a model's parent to be a DataModel, so the stand ins are empty ones. */
class FakeDoc extends foundry.abstract.DataModel {
  static defineSchema() { return {}; }
  static TYPES = [];
}

/** A stand in for an Actor: just what the data models read. */
function fakeActor(itemSpecs = []) {
  const actor = new FakeDoc({});
  actor.items = [];
  for ( const [i, spec] of itemSpecs.entries() ) {
    const item = new FakeDoc({});
    Object.assign(item, { id: `item${i}`, type: spec.type, name: spec.name ?? spec.type, actor });
    const Model = { weapon: items.WeaponData, armor: items.ArmorData, gear: items.GearData, mod: items.ModData,
      ability: items.AbilityData, species: items.SpeciesData, role: items.RoleData, background: items.BackgroundData,
      boon: items.BoonData, mutation: items.MutationData }[spec.type];
    item.system = new Model(spec.system ?? {}, { parent: item });
    actor.items.push(item);
  }
  return actor;
}

function prepare(Model, source, itemSpecs) {
  const actor = fakeActor(itemSpecs);
  const model = new Model(source, { parent: actor });
  actor.system = model;
  model.prepareBaseData();
  model.prepareDerivedData();
  return model;
}

/* -------------------------------------------- */
/*  Schema defaults and validation              */
/* -------------------------------------------- */

let m = prepare(OperativeData, {});
check("default STR 40", m.attributes.str.value === 40 && m.attributes.str.mod === 4);
check("default LCK 30", m.attributes.lck.value === 30 && m.attributes.lck.mod === 3);
check("default HP 8 + TGH 4 = 12", m.vitals.hp.max === 12, m.vitals.hp.max);
check("default energy 10 + 4 + 4 = 18", m.vitals.energy.max === 18, m.vitals.energy.max);
check("default crit 10 + 4 + 6 = 20", m.critical === 20, m.critical);
check("default carry 42 (handoff)", m.carry.max === 42, m.carry.max);
check("default luck max 3", m.vitals.luck.max === 3);
check("default speeds: shift 2, run 8, sprint 16", JSON.stringify(m.movement) === JSON.stringify({ shift: 2, run: 8, sprint: 16 }),
  JSON.stringify(m.movement));
check("default throw 8", m.throwRange === 8);
check("default XP 100 unspent", m.xp.unspent === 100);
check("default credits 200", m.wealth.credits === 200);
check("wealth is Credits, Valuables and Alien Alloys (renamed 2026-10-07)",
  Object.keys(m.wealth).join() === "credits,valuables,alloys" && !("alienCredits" in m._source.wealth));
check("22 skills", Object.keys(m.skills).length === 22);
check("untrained mod 4 skill pool: 2 Aptitude (d10)", m.skills.stealth.pool.aptitude === 2 && m.skills.stealth.pool.skill === 0);
check("no morale on the sheet (scrapped)", !("morale" in m.vitals) && !("morale" in m._source.vitals));

// Out of range numbers are clamped by Foundry's cleaning: a rank of 5 becomes 4.
check("skill rank 5 clamps to 4", new OperativeData({ skills: { stealth: { rank: 5 } } }).skills.stealth.rank === 4);
// A full reset (Johnald, 2026-10-08): the data it writes is a valid operative, as new, or keeping what was asked.
{
  const { resetSystem } = await import("../module/rules/reset.mjs");
  const blank = new OperativeData({}).toObject();
  const lived = new OperativeData({
    attributes: { str: { base: 55, advances: 3 } }, skills: { stealth: { rank: 3 } }, banks: { edge: 2 }, wealth: { credits: 900 },
    xp: { earned: 400, log: [{ kind: "award", xp: 300, label: "OP-1" }, { kind: "perk", xp: 60, label: "Ghost" }] },
    details: { callsign: "Ghost", notes: "<p>Mine</p>", startingSkills: { role: "Outrider" }, record: { rank: "squaddie" } }
  }).toObject();
  let valid = 0;
  for ( const keep of [{}, { identity: true, gear: true, xp: true }] ) {
    try { new OperativeData(resetSystem(blank, lived, keep), { strict: true }); valid++; }
    catch(err) { console.log(err.message); }
  }
  const fresh = new OperativeData(resetSystem(blank, lived));
  const keptAll = new OperativeData(resetSystem(blank, lived, { identity: true, gear: true, xp: true }));
  check("reset: a full reset is a new operative; kept parts come through; both are valid operatives",
    valid === 2 && fresh.attributes.str.advances === 0 && fresh.skills.stealth.rank === 0 && fresh.banks.edge === 0 && fresh.details.callsign === ""
      && fresh.xp.earned === blank.xp.earned && !fresh.xp.log.length && fresh.details.startingSkills.role === ""
      && keptAll.details.callsign === "Ghost" && keptAll.details.notes === "<p>Mine</p>" && keptAll.wealth.credits === 900
      && keptAll.xp.earned === 400 && keptAll.xp.log.length === 1 && keptAll.skills.stealth.rank === 0);
}
check("attribute advances clamp to 6", new OperativeData({ attributes: { str: { advances: 9 } } }).attributes.str.advances === 6);

/* -------------------------------------------- */
/*  Advances, boons, species, armor, weight     */
/* -------------------------------------------- */

m = prepare(OperativeData, { attributes: { per: { base: 40, advances: 2 } }, skills: { awareness: { rank: 3 } } }, [
  { type: "boon", system: { attribute: "per", amount: 10 } },
  { type: "species", system: { health: 6, energy: 10, attributes: { str: 30 } } },
  { type: "armor", system: { equipped: true, points: 4, defense: 6, mobility: { run: 1, sprint: 1 }, dodges: 1, dr: { ballistic: 1, physical: 1 }, weight: 6 } },
  { type: "armor", system: { equipped: false, points: 9, defense: 10, weight: 10 } },
  { type: "gear", system: { quantity: 2, weight: 3 } },
  { type: "gear", system: { quantity: 5, weight: 1, stowed: true } },
  { type: "ability", system: {} }
]);
check("PER 40 + 2 ranks + boon = 60", m.attributes.per.value === 60 && m.attributes.per.mod === 6, m.attributes.per.value);
check("species health 6 + TGH 4", m.vitals.hp.max === 10, m.vitals.hp.max);
check("worn armor points only", m.vitals.armor.max === 4, m.vitals.armor.max);
// RULED 2026-10-07: Defense (the live Armor Bonus) is its own number, from worn armor only, separate from armor HP.
check("worn armor Defense only, apart from armor HP", m.defense === 6 && m.vitals.armor.max === 4, m.defense);
check("no armor, no Defense", prepare(OperativeData, {}).defense === 0);
// Barrier from armor (Johnald, 2026-10-13): worn armor adds its Barrier to the maximum, beside effect bonuses.
check("worn armor's Barrier adds to the Barrier maximum, with bonuses; armor not worn adds none",
  prepare(OperativeData, { vitals: { barrier: { bonus: 2 } } }, [
    { type: "armor", system: { equipped: true, barrier: 5 } }, { type: "armor", system: { equipped: false, barrier: 9 } }]).vitals.barrier.max === 7
    && prepare(OperativeData, {}).vitals.barrier.max === 0);
check("armor both worn and stowed counts for nothing (2026-10-08)", prepare(OperativeData, {}, [
  { type: "armor", system: { equipped: true, stowed: true, defense: 6, points: 4 } }]).defense === 0);
check("a Defense bonus outside armor adds on", prepare(OperativeData, { bonuses: { defense: 5 } }, [
  { type: "armor", system: { equipped: true, defense: 3 } }]).defense === 8);
check("worn armor DR", m.drTotal.ballistic === 1 && m.drTotal.physical === 1 && m.drTotal.laser === 0);
check("worn armor dodges", m.vitals.dodges.max === 2);
check("ruled mobility: +1 run and sprint only, sprint from the unarmored run", m.movement.shift === 2 && m.movement.run === 9 && m.movement.sprint === 17,
  JSON.stringify(m.movement));
check("carried weight skips stowed, counts unworn armor", m.carry.value === 6 + 10 + 6, m.carry.value);
{
  // Johnald, 2026-10-09: a grenade or rocket loaded in a launcher still weighs what it did, until fired.
  const loaded = prepare(OperativeData, {}, [
    { type: "weapon", name: "Grenade Launcher", system: { weaponClass: "launcher", feed: "grenades", weight: 8,
      loaded: [{ name: "Frag Grenade", img: "g.svg", system: { weight: 1, blast: 2 } }, { name: "HE Grenade", img: "h.svg", system: { weight: 1.5 } }] } },
    { type: "weapon", name: "Frag Grenade", system: { weaponClass: "grenade", category: "thrown", quantity: 2, weight: 1 } }
  ]);
  check("carried weight: grenades in a launcher's slots still count", loaded.carry.value === 8 + 1 + 1.5 + 2, loaded.carry.value);
  const stowedLauncher = prepare(OperativeData, {}, [
    { type: "weapon", name: "Grenade Launcher", system: { weaponClass: "launcher", stowed: true, weight: 8, loaded: [{ name: "Frag Grenade", system: { weight: 1 } }] } }
  ]);
  check("carried weight: a stowed launcher's loaded grenades are stowed with it", stowedLauncher.carry.value === 0, stowedLauncher.carry.value);
  check("weapon: the blast template is a circle unless set", new items.WeaponData({}).template === "circle" && new items.WeaponData({ template: "cone" }).template === "cone");
}
check("crit uses PER mod 6", m.critical === 10 + 6 + 6);
check("awareness rank 3 at PER mod 6: 3 Skill (d12)", m.skills.awareness.pool.skill === 3 && m.skills.awareness.pool.aptitude === 0,
  JSON.stringify(m.skills.awareness.pool));

/* -------------------------------------------- */
/*  NPC and item models                         */
/* -------------------------------------------- */

const npc = prepare(NpcData, { details: { threat: "elite", caste: "monarch" } });
check("NPC derives the same", npc.critical === 20 && npc.vitals.hp.max === 12);
check("NPC caste", npc.details.caste === "monarch");

const w = new items.WeaponData({ category: "melee", accuracy: 30, damage: { formula: "1d6 + @str.mod", type: "physical" } });
check("melee rolls STR", w.attackAttribute === "str");
check("melee default 2 slots", w.slots === 2);
check("ranged default 3 slots", new items.WeaponData({}).slots === 3);
// RULED 2026-10-08: Combat tab sections. By category unless the weapon names one; launchers are Special.
const sectionOf = src => new items.WeaponData(src).section;
check("weapon sections by category and class",
  sectionOf({ category: "ranged", weaponClass: "smallArms" }) === "ranged"
    && sectionOf({ category: "melee", weaponClass: "oneHanded" }) === "melee"
    && sectionOf({ category: "thrown", weaponClass: "grenade" }) === "explosives"
    && sectionOf({ category: "explosive", weaponClass: "explosive" }) === "explosives"
    && sectionOf({ category: "ranged", weaponClass: "precision" }) === "ranged"
    && sectionOf({ category: "melee", weaponClass: "twoHanded" }) === "melee");
check("chemthrowers are Special too", sectionOf({ category: "ranged", weaponClass: "chemthrower" }) === "special");
// Natural weapons (2026-10-08): in their category's section, no mod slots unless set, no special ammo.
const spike = new items.WeaponData({ category: "ranged", weaponClass: "natural" });
check("natural weapons: Ranged section, no mod slots, no special ammo slot",
  spike.section === "ranged" && spike.slots === 0 && spike.takesSpecialAmmo === false
    && new items.WeaponData({ category: "melee", weaponClass: "natural" }).section === "melee");
check("natural weapons: a hand set slot count still wins", new items.WeaponData({ weaponClass: "natural", modSlots: 1 }).slots === 1);
check("launchers are Special, the RPG included", sectionOf({ category: "ranged", weaponClass: "launcher" }) === "special"
  && sectionOf({ category: "explosive", weaponClass: "launcher" }) === "special");
// RULED 2026-10-08: twelve classes now. Items saved with an old class read as the new one.
check("weapon classes: the consolidated twelve, plus Rocket for the RPG and its kind",
  Object.keys(IROP.weaponClasses).join() === "smallArms,rifles,saturation,precision,shotguns,natural,oneHanded,twoHanded,chemthrower,launcher,grenade,rocket,explosive");
check("weapon classes: an old explosive rocket launcher (the RPG) reads as a Rocket",
  new items.WeaponData({ category: "explosive", weaponClass: "rocketLauncher" }).weaponClass === "rocket");
// Special weapon feeds (RULED 2026-10-08).
const law = new items.WeaponData({ weaponClass: "launcher", feed: "singleUse", ammo: { value: 1, max: 1 } });
const gl = new items.WeaponData({ weaponClass: "launcher", feed: "grenades" });
const rl = new items.WeaponData({ weaponClass: "launcher", feed: "rockets" });
const chem = new items.WeaponData({ weaponClass: "chemthrower", feed: "fuel" });
check("feeds: a grenade launcher holds 4, a rocket launcher 1, others none",
  gl.projectileSlots === 4 && rl.projectileSlots === 1 && law.projectileSlots === 0 && chem.projectileSlots === 0);
check("feeds: only a magazine uses ammo or takes special ammo",
  !law.usesAmmo && !gl.takesSpecialAmmo && !chem.takesSpecialAmmo && new items.WeaponData({ ammo: { value: 5, max: 5 } }).usesAmmo);
check("feeds: fuel defaults to a full tank of 100, 10 a burn, 5 burns",
  chem.fuel.value === 100 && chem.fuel.max === 100 && chem.fuel.cost === 10 && chem.fuel.maxBurns === 5 && chem.burn.save === "agi");
// RULED 2026-10-08 (bug report): a mod works only while fitted to something in use.
{
  const { itemEffectsSuppressed: off } = await import("../module/rules/effects.mjs");
  const host = (equipped, stowed = false) => ({ system: { equipped, stowed } });
  const mod = h => ({ type: "mod", system: { host: h } });
  check("mod effects: on when fitted to worn armor or an equipped weapon", off(mod(host(true))) === false);
  check("mod effects: off on spare armor, an unequipped weapon, a stowed host, loose, or with its host gone",
    off(mod(host(false))) && off(mod(host(true, true))) && off(mod(host(false, true))) && off(mod(null)));
  check("weapon and armor effects: only while equipped and not stowed",
    !off({ type: "armor", system: { equipped: true, stowed: false } }) && off({ type: "armor", system: { equipped: false } })
      && off({ type: "weapon", system: { equipped: true, stowed: true } }));
  check("special ammo effects follow the weapon it is loaded in; other gear works unless stowed",
    off({ type: "gear", system: { loadedHost: host(false) } }) && !off({ type: "gear", system: { loadedHost: host(true) } })
      && !off({ type: "gear", system: {} }) && off({ type: "gear", system: { stowed: true } }));
  check("effects on other item types are left to Foundry", off({ type: "ability", system: {} }) === null);
}
// RULED 2026-10-08: one XP ledger. Attribute pips 10/20/40/60/80/100, skill pips 20/40/60/80, by pip.
{
  const xp = await import("../module/rules/xp.mjs");
  check("xp: pip costs by which pip is bought",
    [1, 2, 3, 4, 5, 6].map(n => xp.rankCost("attribute", n)).join() === "10,20,40,60,80,100"
      && [1, 2, 3, 4].map(n => xp.rankCost("skill", n)).join() === "20,40,60,80");
  const buy = (o) => xp.checkRankPurchase({ kind: "skill", label: "Stealth", ...o });
  check("xp: only the next pip, never past the top, only with the XP",
    buy({ current: 1, n: 2, unspent: 40 }).ok && buy({ current: 1, n: 2, unspent: 40 }).cost === 40
      && !buy({ current: 1, n: 3, unspent: 999 }).ok && !buy({ current: 4, n: 5, unspent: 999 }).ok
      && /costs 40 XP; 39 unspent/.test(buy({ current: 1, n: 2, unspent: 39 }).reason));
  check("xp: spent is every entry but awards",
    xp.xpSpent([{ kind: "skill", xp: 40 }, { kind: "award", xp: 100 }, { kind: "attribute", xp: 10 }]) === 50);
  const ledger = prepare(OperativeData, { xp: { earned: 200, log: [{ kind: "skill", label: "Stealth rank 1", xp: 20 }] } });
  check("xp: unspent is earned less the ledger", ledger.xp.spent === 20 && ledger.xp.unspent === 180);
  const legacy = new OperativeData({ xp: { earned: 300, spent: 120 } });
  check("xp: a hand typed Spent from before the ledger becomes its opening entry",
    legacy.xp.log.length === 1 && legacy.xp.log[0].xp === 120 && /before the ledger/.test(legacy.xp.log[0].label));
  check("xp: no Spent before the ledger, no opening entry", new OperativeData({ xp: { earned: 100, spent: 0 } }).xp.log.length === 0);
}
// The Sandbox abilities import (2026-10-08): the data the system ships, and the importer.
{
  const pathMod = await import("node:path");
  const root = pathMod.resolve(pathMod.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
  const list = JSON.parse(fs.readFileSync(pathMod.join(root, "assets/data/sandbox-abilities.json"), "utf8"));
  const bad = [];
  for ( const d of list ) {
    try { new items.AbilityData(d.system, { strict: true }); }
    catch(err) { bad.push(d.name); }
  }
  check("sandbox abilities: every one fits the ability model", list.length > 500 && !bad.length, bad.slice(0, 5).join());
  check("sandbox abilities: ids are unique Foundry ids", new Set(list.map(d => d._id)).size === list.length
    && list.every(d => /^[A-Za-z0-9]{16}$/.test(d._id)));
  const missing = list.filter(d => d.img.startsWith("systems/irop/") && !fs.existsSync(pathMod.join(root, d.img.slice("systems/irop/".length))));
  check("sandbox abilities: every icon they name ships with the system", !missing.length && list.filter(d => d.img.startsWith("systems/irop/")).length === 373,
    missing.slice(0, 3).map(d => d.img).join());
  check("sandbox abilities: filed under Abilities, by role and tree",
    list.every(d => d.folder[0] === "Abilities") && list.some(d => d.folder.join("/") === "Abilities/Legionary/Pointman")
      && list.find(d => d.name === "Clear the Room")?.system.tree === "Pointman" && list.find(d => d.name === "Rally")?.system.tree === "Primary");
  // Foundry 14's shape: the changes under system (2026-10-11).
  const keys = new Set(list.flatMap(d => (d.effects ?? []).flatMap(e => e.system.changes.map(c => c.key))));
  const actorSource = new OperativeData({}).toObject();
  check("sandbox abilities: their effects touch real operative fields (HP, Energy, carry)",
    keys.size === 3 && [...keys].every(k => foundry.utils.getProperty({ system: actorSource }, k) !== undefined), [...keys].join());
  const res2 = list.find(d => d.name === "Resilience (2)");
  check("sandbox abilities: Resilience (2) is a passive rank 2 Generalist perk worth +2 HP, needing Resilience (1)",
    res2.system.kind === "passive" && res2.system.rank === 2 && res2.system.source === "generalist"
      && res2.effects?.[0].system.changes[0].value === "2" && (res2.effects[0].system.changes[0].type === "add") && /^Resilience \(1\)/.test(res2.system.prerequisites));
  check("sandbox abilities: Sandbox templates are left behind", !list.some(d => /template/i.test(d.name)));
  check("sandbox abilities: no Google Sheets wrappers left in the text", !list.some(d => /data-sheets-/.test(d.system.description)));

  // The importer: folders by path, Sandbox ids kept, what is already there skipped.
  const { importAbilities } = await import("../module/import.mjs");
  const folders = [];
  const createdItems = [];
  const notes = [];
  globalThis.ui = { notifications: { info: m => notes.push(m), error: m => notes.push(m) } };
  globalThis.fetch = async () => ({ ok: true, json: async () => list.slice(0, 5) });
  globalThis.Folder = { create: async d => { const f = { id: `f${folders.length}`, ...d, folder: folders.find(x => x.id === d.folder) ?? null }; folders.push(f); return f; } };
  globalThis.Item = { createDocuments: async (data, options) => { createdItems.push({ data, options }); return data; } };
  game.user = { isGM: true };
  game.folders = folders;
  game.items = new Map([[list[0]._id, {}]]);
  const result = await importAbilities({ confirm: false });
  const made = createdItems.flatMap(c => c.data);
  check("importer: skips what is already there, keeps the Sandbox ids",
    result.created === 4 && result.skipped === 1 && createdItems[0].options.keepId === true && made.every(d => list.some(l => l._id === d._id)));
  const first = made[0];
  const chain = [];
  for ( let f = folders.find(x => x.id === first.folder); f; f = f.folder ) chain.unshift(f.name);
  check("importer: makes the folder path once and files each item in it",
    chain.join("/") === list[1].folder.join("/") && new Set(folders.map(f => `${f.folder?.id}/${f.name}`)).size === folders.length, chain.join("/"));
  game.items = new Map(list.slice(0, 5).map(d => [d._id, {}]));
  const again = await importAbilities({ confirm: false });
  check("importer: a second run adds nothing", again.created === 0 && again.skipped === 5);

  // The perk trees (2026-10-08): the live game's 25, at 10 XP a point.
  const { trees, abilityUpdates } = JSON.parse(fs.readFileSync(pathMod.join(root, "assets/data/sandbox-trees.json"), "utf8"));
  const { nodeStates } = await import("../module/rules/skill-trees.mjs");
  const ids = new Set(list.map(d => d._id));
  const nodes = trees.flatMap(t => t.system.tiers.flatMap(x => x.nodes));
  const badTrees = [];
  for ( const t of trees ) {
    try { new items.SkillTreeData(t.system, { strict: true }); }
    catch(err) { badTrees.push(t.name); }
  }
  check("sandbox trees: 25 that fit the model: six roles' Primary and three specializations, and the Generalist perks",
    (trees.length === 25) && !badTrees.length && (trees.filter(t => t.system.kind === "primary").length === 6)
      && (trees.filter(t => t.system.kind === "specialization").length === 18) && (trees.filter(t => !t.system.role).length === 1), badTrees.join());
  check("sandbox trees: no Attributes or Skills trees (those are bought on the sheet)", !trees.some(t => /attribute|skill/i.test(t.name)));
  check("sandbox trees: every perk points at an imported ability, and keeps its own id",
    nodes.every(n => ids.has(n.uuid.replace(/^Item\./, ""))) && (new Set(nodes.map(n => n.id)).size === nodes.length) && (nodes.length === 392));
  check("sandbox trees: every prerequisite is a perk of the same tree",
    trees.every(t => { const own = new Set(t.system.tiers.flatMap(x => x.nodes.map(n => n.id))); return t.system.tiers.every(x => x.nodes.every(n => !n.requires || own.has(n.requires))); }));
  check("sandbox trees: XP is the live points times 10", nodes.every(n => (n.xp > 0) && (n.xp % 10 === 0)));
  const tree = name => trees.find(t => t.name === name);
  const tierNames = (t, i) => t.system.tiers[i].nodes.map(n => n.name).join(", ");
  const legion = tree("Legionary: Primary");
  check("sandbox trees: Legionary Primary opens with a Pick one of Rally, Pour it On! and Chained Shot at 10 XP",
    legion.system.tiers[0].exclusive && /Rally/.test(tierNames(legion, 0)) && /Pour it On!/.test(tierNames(legion, 0)) && /Chained Shot/.test(tierNames(legion, 0))
      && legion.system.tiers[0].nodes.every(n => n.xp === 10) && (legion.system.tab === "Primary") && legion.system.gated, tierNames(legion, 0));
  const pointman = tree("Legionary: Pointman");
  check("sandbox trees: Pointman is a Legionary specialization: Clear the Room, then Watch my Six or Fall in Line",
    (pointman.system.role === "legionary") && (pointman.system.kind === "specialization") && (tierNames(pointman, 0) === "Clear the Room")
      && pointman.system.tiers[1].exclusive && (tierNames(pointman, 1) === "Watch my Six, Fall in Line"), tierNames(pointman, 1));
  check("sandbox trees: Pick one the live tree never set is taken from the role page (Ghost, Guardian)",
    tree("Outrider: Ghost").system.tiers[1].exclusive && tree("Warmachine: Guardian").system.tiers[1].exclusive
      && tree("Outrider: Sharpshooter").system.tiers[3].exclusive);
  const general = tree("Generalist");
  const sb = general.system.tiers[0].nodes;
  check("sandbox trees: Generalist is for everyone, ungated, each rank needing the one before",
    !general.system.role && (general.system.kind === "general") && !general.system.gated
      && (sb.map(n => n.name).join() === "Strong Back (1),Strong Back (2),Strong Back (3)") && (sb[1].requires === sb[0].id) && (sb[2].requires === sb[1].id));
  const states = nodeStates(legion.system, { owned: new Set(), unspent: 100 });
  check("sandbox trees: a new Legionary can buy Tier 1 and nothing below it",
    legion.system.tiers[0].nodes.every(n => states.get(n.id).canBuy) && legion.system.tiers[1].nodes.every(n => states.get(n.id).state === "locked"));
  const clear = list.find(d => d.name === "Clear the Room");
  check("sandbox trees: abilities carry their tier from the trees",
    (clear.system.tier === 1) && (list.find(d => d.name === "Bullet Storm")?.system.tier === 8) && (abilityUpdates[clear._id]?.tier === 1));

  // importTrees: brings in missing abilities first, gives earlier ones their tier, files the trees.
  const { importTrees } = await import("../module/import.mjs");
  const treeData = { trees, abilityUpdates };
  globalThis.fetch = async url => ({ ok: true, json: async () => (url.endsWith("sandbox-trees.json") ? treeData : list) });
  createdItems.length = 0;
  folders.length = 0;
  const updated = [];
  Item.updateDocuments = async u => { updated.push(...u); return u; };
  const bullet = list.find(d => d.name === "Bullet Storm");
  const earlier = { system: { tier: 1, source: "legionary" } };
  game.items = new Map(list.filter(d => d._id !== clear._id).map(d => [d._id, d._id === bullet._id ? earlier : { system: { tier: 7, source: "x" } }]));
  game.items.get = function(id) { return Map.prototype.get.call(this, id); };
  const res = await importTrees({ confirm: false });
  const madeTrees = createdItems.flatMap(c => c.data).filter(d => d.type === "skillTree");
  const madeAbilities = createdItems.flatMap(c => c.data).filter(d => d.type === "ability");
  check("tree importer: missing abilities first, then the 25 trees, ids kept",
    (res.created === 25) && (res.abilities === 1) && (madeAbilities[0]?._id === clear._id) && createdItems.every(c => c.options.keepId)
      && (madeTrees.length === 25), JSON.stringify(res));
  check("tree importer: an ability imported earlier at tier 1 learns its tree tier; one a GM set is left",
    updated.some(u => (u._id === bullet._id) && (u["system.tier"] === 8)) && !updated.some(u => (u._id !== bullet._id) && ("system.tier" in u)),
    JSON.stringify(updated.slice(0, 3)));
  const pointFolder = folders.find(f => f.id === madeTrees.find(t => t.name === "Legionary: Pointman").folder);
  check("tree importer: trees filed under Perk Trees, by role", (pointFolder?.name === "Legionary") && (pointFolder.folder?.name === "Perk Trees"));
  game.items = new Map([...list, ...trees].map(d => [d._id, d]));
  const twice = await importTrees({ confirm: false });
  check("tree importer: a second run adds nothing", (twice.created === 0) && (twice.skipped === 25) && (twice.grown === 0));

  // Quick Recovery joins the Generalist tree (Johnald, 2026-10-08), and reaches worlds that imported before.
  const generalist = trees.find(t => t.name === "Generalist");
  const qr = generalist.system.tiers.at(-1).nodes[0];
  check("Quick Recovery: its own line at the end of the Generalist tree, 20 XP, its Agility 45 read as a requirement",
    (qr?.name === "Quick Recovery") && (qr.xp === 20) && (generalist.system.tiers.at(-1).nodes.length === 1)
      && (list.find(d => d.name === "Quick Recovery").system.prerequisites === "Agility 45"));
  const { addMissingPerks } = await import("../module/import.mjs");
  const before = generalist.system.tiers.slice(0, -1);
  let grownTiers = addMissingPerks(before, generalist.system.tiers);
  check("tree importer: a perk new to the import is added to the world's tree, once",
    (grownTiers.added.map(n => n.name).join() === "Quick Recovery") && (grownTiers.tiers.length === before.length + 1)
      && (addMissingPerks(grownTiers.tiers, generalist.system.tiers).added.length === 0));
  const dropped = [...before, { exclusive: false, nodes: [{ ...qr, id: "gmOwnNodeId00001" }] }];
  check("tree importer: not if the GM already put that ability in the tree", addMissingPerks(dropped, generalist.system.tiers).added.length === 0);
  const twoNew = [{ exclusive: false, nodes: [{ id: "a1", uuid: "Item.a1" }] }, { exclusive: true, nodes: [{ id: "b1", uuid: "Item.b1" }, { id: "b2", uuid: "Item.b2" }] }];
  grownTiers = addMissingPerks([{ exclusive: false, nodes: [{ id: "a1", uuid: "Item.a1" }] }], twoNew);
  check("tree importer: two new perks of one new tier stay together, Pick one kept",
    (grownTiers.tiers.length === 2) && (grownTiers.tiers[1].nodes.map(n => n.id).join() === "b1,b2") && grownTiers.tiers[1].exclusive);
  const grewWith = [];
  const oldGeneralist = { name: "Generalist", system: { tiers: before }, update: async data => { grewWith.push(data); return data; } };
  game.items = new Map([...list, ...trees].map(d => [d._id, d._id === generalist._id ? oldGeneralist : d]));
  const third = await importTrees({ confirm: false });
  check("tree importer: run again in a world imported before, it adds Quick Recovery to the Generalist tree there",
    (third.created === 0) && (third.grown === 1) && (grewWith[0]?.["system.tiers"]?.at(-1).nodes[0].name === "Quick Recovery"));
  delete game.user; delete game.folders; delete game.items; delete game.irop;
  delete globalThis.fetch; delete globalThis.Folder; delete globalThis.Item; delete globalThis.ui;
}

// Squad sight (Johnald, 2026-10-08): players see through every friendly token; a world setting.
{
  const ss = await import("../module/canvas/squad-sight.mjs");
  const originalSettings = globalThis.game.settings;
  const D = CONST.TOKEN_DISPOSITIONS;
  const player = { isGM: false };
  const gm = { isGM: true };
  globalThis.canvas = { visibility: { tokenVision: true } };
  const token = (disposition, extra = {}) => ({ hasSight: true, document: { disposition, hidden: false, ...extra } });
  const shares = (t, opts = {}) => ss.sharesSquadSight(t, { enabled: true, user: player, ...opts });
  check("squad sight: a friendly token lends its sight to a player",
    shares(token(D.FRIENDLY)) === true);
  check("squad sight: hostile, neutral and secret tokens never do",
    !shares(token(D.HOSTILE)) && !shares(token(D.NEUTRAL)) && !shares(token(D.SECRET)));
  check("squad sight: nor a hidden token, nor one without sight",
    !shares(token(D.FRIENDLY, { hidden: true })) && !shares({ hasSight: false, document: { disposition: D.FRIENDLY, hidden: false } }));
  check("squad sight: the GM's view is unchanged", !shares(token(D.FRIENDLY), { user: gm }));
  check("squad sight: off when the setting is off, or the scene has no token vision",
    !shares(token(D.FRIENDLY), { enabled: false })
      && !(globalThis.canvas.visibility.tokenVision = false, shares(token(D.FRIENDLY))));
  globalThis.canvas.visibility.tokenVision = true;
  globalThis.canvas.level = { id: "ground" };
  check("squad sight (Foundry 14): only tokens on the level being viewed",
    shares(token(D.FRIENDLY, { level: "ground" })) && !shares(token(D.FRIENDLY, { level: "roof" })));
  delete globalThis.canvas.level;

  // The Token class: Foundry's own sources, plus friendly ones.
  class Base { constructor(own, doc) { this.own = own; this.hasSight = true; this.document = doc; } _isVisionSource() { return this.own; } }
  const Squad = ss.squadSightToken(Base);
  globalThis.game.user = player;
  globalThis.game.settings = { get: (ns, key) => { if ( (ns === "irop") && (key === "squadSight") ) return true; throw new Error("none"); } };
  check("squad sight: the token class adds friendly tokens to Foundry's own vision sources",
    (new Squad(false, { disposition: D.FRIENDLY, hidden: false })._isVisionSource() === true)
      && (new Squad(true, { disposition: D.HOSTILE, hidden: false })._isVisionSource() === true)
      && (new Squad(false, { disposition: D.HOSTILE, hidden: false })._isVisionSource() === false)
      && (new Squad(false, { disposition: D.FRIENDLY, hidden: false }) instanceof Base));
  globalThis.game.settings.get = () => false;
  check("squad sight: turned off, friendly tokens are back to Foundry's rules", new Squad(false, { disposition: D.FRIENDLY, hidden: false })._isVisionSource() === false);

  // A disposition change or the setting being flipped recomputes vision.
  const calls = [];
  const placed = [1, 2, 3].map(i => ({ initializeVisionSource: () => calls.push(`t${i}`) }));
  globalThis.canvas = { ready: true, tokens: { placeables: placed }, perception: { update: o => calls.push(o.refreshVision ? "refresh" : "?") } };
  ss.refreshSquadSight();
  check("squad sight: flipping the setting recomputes every token's vision", calls.join() === "t1,t2,t3,refresh", calls.join());
  calls.length = 0;
  globalThis.game.settings.get = () => true;
  ss.onTokenDisposition({ object: placed[1] }, { disposition: D.FRIENDLY });
  ss.onTokenDisposition({ object: placed[1] }, { name: "x" });
  check("squad sight: a token's disposition changing recomputes its vision, nothing else does", calls.join() === "t2,refresh", calls.join());
  calls.length = 0;
  globalThis.game.user = gm;
  ss.onTokenDisposition({ object: placed[1] }, { disposition: D.FRIENDLY });
  check("squad sight: not for the GM", !calls.length);

  // The world setting: a GM check box, on by default.
  const { registerSettings } = await import("../module/settings.mjs");
  const registered = {};
  globalThis.game.settings = { register: (ns, key, data) => { registered[key] = data; } };
  registerSettings();
  const setting = registered.squadSight;
  check("squad sight: a world setting the GM ticks in Configure Settings, on by default",
    setting?.scope === "world" && setting.config === true && setting.type === Boolean && setting.default === true && setting.name === "Squad sight");
  globalThis.game.settings = originalSettings;
  delete globalThis.canvas;
  delete globalThis.game.user;
}

// Written requirements on a perk (2026-10-08): attributes and skill ranks, as the Generalist perks have them.
{
  const rq = await import("../module/rules/requirements.mjs");
  const { nodeStates } = await import("../module/rules/skill-trees.mjs");
  const read = t => rq.parseRequirements(t).map(r => `${r.kind}:${r.keys.join("|")}:${r.min}`).join();
  check("requirements: an attribute after the perk it follows", read("Resilience (2), Toughness 55") === "attribute:tgh:55", read("Resilience (2), Toughness 55"));
  check("requirements: either of two attributes", read("Perception -or- Strength 45") === "attribute:per|str:45", read("Perception -or- Strength 45"));
  check("requirements: a skill rank", read("Athletics Rank 2") === "skill:athletics:2", read("Athletics Rank 2"));
  check("requirements: perk names and None are left to the tree", read("Shake it Off, Toughness 60") === "attribute:tgh:60" && read("Strong Back (2)") === "" && read("") === "");
  check("requirements: abbreviations too", read("TGH 50; agi 45") === "attribute:tgh:50,attribute:agi:45", read("TGH 50; agi 45"));
  const system = { attributes: { tgh: { value: 50 }, per: { value: 30 }, str: { value: 45 } }, skills: { athletics: { rank: 1 } } };
  const unmet = t => rq.unmetRequirements(rq.parseRequirements(t), system).join(" and ");
  check("requirements: met when the score is there, either attribute will do",
    unmet("Toughness 50") === "" && unmet("Perception -or- Strength 45") === "");
  check("requirements: unmet ones say what is needed",
    unmet("Resilience (2), Toughness 55") === "Toughness 55" && unmet("Athletics Rank 2") === "Athletics rank 2"
      && unmet("Toughness 60, Athletics Rank 2") === "Toughness 60 and Athletics rank 2");
  const tree = { gated: false, tiers: [{ exclusive: false, nodes: [{ id: "a", name: "Shake it Off", xp: 20 }] }] };
  const states = free => nodeStates(tree, { owned: new Set(), unspent: 100, free, unmet: () => ["Toughness 50"] }).get("a");
  check("requirements: an unmet one locks the perk, and says why; Edit mode adds it anyway",
    (states(false).state === "locked") && (states(false).reason === "Locked: needs Toughness 50") && states(true).canBuy);
  check("requirements: they are listed for the lock icon, and none once in Edit mode",
    (states(false).needs.join() === "Toughness 50") && !states(true).needs.length);
  const chain = { gated: false, tiers: [{ exclusive: false, nodes: [{ id: "r1", name: "Resilience (1)", xp: 20 }, { id: "r2", name: "Resilience (2)", xp: 30, requires: "r1" }] }] };
  const r2 = nodeStates(chain, { owned: new Set(), unspent: 100, unmet: n => (n.id === "r2" ? ["Toughness 45"] : []) }).get("r2");
  check("requirements: waiting on the perk before it and short on Toughness, it says both",
    (r2.reason === "Locked: needs Resilience (1) first, and Toughness 45") && (r2.needs.join() === "Toughness 45")
      && (r2.waitsOn === "Resilience (1)"), r2.reason);
  check("requirements: once the perk before it is owned, it waits on nothing",
    nodeStates(chain, { owned: new Set(["r1"]), unspent: 100 }).get("r2").waitsOn === "");
  check("requirements: owned perks need nothing more",
    !nodeStates(chain, { owned: new Set(["r2"]), unspent: 100, unmet: () => ["Toughness 45"] }).get("r2").needs.length);
}

// The Strategy Layer, step one (2026-10-08): territories, and the sixteen from the vault.
{
  const t = new items.TerritoryData({ kind: "megacity", strength: 6, heat: 2, reputation: 2, objectives: { citadel: true } });
  check("territory: stats and labels as the rules doc names them",
    t.isMegacity && t.objectivesTaken === 1 && t.heatLabel === "Medium" && t.reputationLabel === "Friendly" && t.reputationPoints === 5
      && t.control === "genesis" && t.neighbors.length === 0 && t.region === "");
  let refused = 0;
  for ( const bad of [{ kind: "moonbase" }, { control: "aliens" }] ) {
    try { new items.TerritoryData(bad, { strict: true }); }
    catch(err) { refused++; }
  }
  check("territory: an unknown type or holder is refused", refused === 2);
  check("territory: Heat past Maximum, Reputation past +4 or -4 and its bar past 10 are held to the ladder (RULED 2026-10-11)",
    new items.TerritoryData({ heat: 5 }).heat === 4 && new items.TerritoryData({ reputation: 5 }).reputation === 4
      && new items.TerritoryData({ reputation: -5 }).reputation === -4 && new items.TerritoryData({ reputationPoints: 12 }).reputationPoints === 10
      && new items.TerritoryData({ reputation: 4 }).reputationLabel === "Devoted");
  const pathMod = await import("node:path");
  const root = pathMod.resolve(pathMod.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
  const list = JSON.parse(fs.readFileSync(pathMod.join(root, "assets/data/territories.json"), "utf8"));
  const by = n => list.find(x => x.name === n)?.system;
  let bad = 0;
  for ( const x of list ) { try { new items.TerritoryData(x.system, { strict: true }); } catch(err) { bad++; } }
  check("territories: sixteen from the vault, all valid", list.length === 16 && !bad);
  check("territories: the three Megacities at Strength 15 of 25 (2026-10-11), Heat Medium; the subsectors are slums",
    ["Neo Seattle", "Neo LA", "Neo Denver"].every(n => by(n).kind === "megacity" && by(n).strength === 15 && by(n).heat === 2)
      && by("Spokane Subsector").strength === 5 && by("Portlandia").strength === 10
      && by("Spokane Subsector").kind === "slums" && by("Redwood Havens").kind === "rural" && by("Portlandia").kind === "wildland");
  check("territories: Eclipse HQ is contested, its lore and modifiers come along",
    by("Eclipse Headquarters").control === "contested" && /^<p>/.test(by("Neo Seattle").description) && by("Black Hills").modifiers === "Havens, Paraphysical Radiation");

  // The import: under Territories, skipping any already here by name.
  const { importTerritories } = await import("../module/import.mjs");
  const made = [];
  const folders = [];
  globalThis.ui = { notifications: { info() {}, error() {} } };
  globalThis.fetch = async () => ({ ok: true, json: async () => list });
  globalThis.Folder = { create: async d => { const f = { id: `f${folders.length}`, ...d, folder: null }; folders.push(f); return f; } };
  globalThis.Item = { createDocuments: async data => { made.push(...data); return data; } };
  game.user = { isGM: true };
  game.folders = folders;
  game.items = Object.assign([{ type: "territory", name: "Neo Seattle" }], { has: () => false });
  const res = await importTerritories({ confirm: false });
  check("territories: the import files them under Territories and skips one already here",
    res.created === 15 && res.skipped === 1 && !made.some(m => m.name === "Neo Seattle") && folders[0]?.name === "Territories"
      && made.every(m => m.folder === "f0" && m.type === "territory"));
  delete game.user; delete game.folders; delete game.items;
  delete globalThis.fetch; delete globalThis.Folder; delete globalThis.Item; delete globalThis.ui;
}

// ODR projects (Strategy Layer step 5, 2026-10-08), and the doc's examples.
{
  const p = new items.ProjectData({ kind: "intelligence", cost: 50, progress: 20, term: "long", assigned: [{ actor: "a1", skill: "stealth" }] });
  check("project: defaults and what it is paid in",
    p.status === "available" && p.resource === "intel" && p.remaining === 30 && p.percent === 40 && p.assigned[0].skill === "stealth"
      && new items.ProjectData({}).kind === "research" && new items.ProjectData({}).resource === "logistics" && new items.ProjectData({}).percent === 0);
  check("project: territories have activity this week, off by default", new items.TerritoryData({}).active === false);
  check("territory: no journal linked by default, a header image path", new items.TerritoryData({}).journal === "" && new items.TerritoryData({ art: "a.webp" }).art === "a.webp");
  check("territory: a climate, temperate by default; an unknown one refused; no rerolls yet",
    new items.TerritoryData({}).climate === "temperate" && new items.TerritoryData({}).weatherSalt === 0
      && (() => { try { new items.TerritoryData({ climate: "lunar" }, { strict: true }); return false; } catch(err) { return true; } })());
  {
    const pathMod = await import("node:path");
    const root = pathMod.resolve(pathMod.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
    const list = JSON.parse(fs.readFileSync(pathMod.join(root, "assets/data/territories.json"), "utf8"));
    const climate = n => list.find(x => x.name === n)?.system.climate;
    check("territories: the sixteen come with climates", climate("Neo Seattle") === "wet" && climate("Reno Subsector") === "arid" && climate("Neo LA") === "coastal"
      && climate("Neo Denver") === "alpine" && list.every(x => x.system.climate in IROP.climates));
  }
  const tw = new items.TerritoryData({}).weather;
  check("territory: its own weather is off by default, a chance for every condition",
    tw.custom === false && tw.base === 57 && Object.keys(tw.weights).length === Object.keys(IROP.weatherConditions).length && tw.weights.rain === 0);
  const fac = new items.TerritoryData({ facilities: { genesis: [{ name: "Checkpoint", hidden: true }] } });
  check("territory: facilities on each side, none by default; a row is name, note, down, hidden",
    new items.TerritoryData({}).facilities.rebellion.length === 0 && fac.facilities.genesis[0].hidden && fac.facilities.genesis[0].down === false && fac.facilities.genesis[0].note === "");
  let refused = 0;
  for ( const bad of [{ kind: "sorcery" }, { status: "lost" }, { term: "medium" }, { builds: "castle" }] ) {
    try { new items.ProjectData(bad, { strict: true }); }
    catch(err) { refused++; }
  }
  check("project: an unknown kind, status, term or build is refused", refused === 4);
  const pathMod = await import("node:path");
  const root = pathMod.resolve(pathMod.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
  const list = JSON.parse(fs.readFileSync(pathMod.join(root, "assets/data/projects.json"), "utf8"));
  let bad = 0;
  for ( const x of list ) { try { new items.ProjectData(x.system, { strict: true }); } catch(err) { bad++; console.log(x.name, err.message); } }
  const kinds = k => list.filter(x => x.system.kind === k);
  check("projects: the doc's examples, all valid: Armory Refit, the SAM Site and Training Facility, twelve Intelligence Actions",
    !bad && kinds("research").length === 1 && kinds("engineering").length === 2 && kinds("intelligence").length === 12
      && kinds("intelligence").filter(x => x.system.term === "short").length === 6 && list.every(x => x.system.cost > 0));
  check("projects: every specialization is a real skill, and every folder is under Projects",
    list.every(x => (x.system.specialization ?? []).every(k => k in IROP.skills)) && list.every(x => x.folder[0] === "Projects"));

  const { importProjects } = await import("../module/import.mjs");
  const made = [];
  const folders = [];
  globalThis.ui = { notifications: { info() {}, error() {} } };
  globalThis.fetch = async () => ({ ok: true, json: async () => list });
  globalThis.Folder = { create: async d => { const f = { id: `f${folders.length}`, ...d, type: "Item" }; f.folder = d.folder ? folders.find(x => x.id === d.folder) : null; folders.push(f); return f; } };
  globalThis.Item = { createDocuments: async data => { made.push(...data); return data; } };
  game.user = { isGM: true };
  game.folders = folders;
  game.items = Object.assign([{ type: "project", name: "SAM Site" }], { has: () => false });
  const res = await importProjects({ confirm: false });
  check("projects: the import files them under Projects by kind, skipping one already here",
    res.created === 14 && res.skipped === 1 && !made.some(m => m.name === "SAM Site")
      && folders.map(f => f.name).join() === "Projects,Research,Engineering,Intelligence" && made.every(m => m.type === "project"));
  delete game.user; delete game.folders; delete game.items;
  delete globalThis.fetch; delete globalThis.Folder; delete globalThis.Item; delete globalThis.ui;
}

// Event and Dark Event cards (Strategy Layer step 6, 2026-10-08), and the six examples.
{
  const { EventCardData } = await import("../module/data/card.mjs");
  const c = new EventCardData({ kind: "dark", reprisal: true, discard: { logistics: -20 } });
  check("card: a Dark Event's switches and numbers, none by default",
    c.kind === "dark" && c.reprisal && !c.persistent && c.discard.logistics === -20 && c.effect.strength === 0
      && new EventCardData({}).kind === "event" && Object.keys(new EventCardData({}).effect).join() === "logistics,intel,strength,heat,reputation");
  let refused = 0;
  try { new EventCardData({ kind: "omen" }, { strict: true }); } catch(err) { refused++; }
  check("card: an unknown deck is refused", refused === 1);
  check("card: Never in is empty by default, and keeps the territories set (2026-10-08)",
    Array.isArray(new EventCardData({}).excluded) && !new EventCardData({}).excluded.length
      && new EventCardData({ excluded: ["ns", "pl"] }).excluded.join() === "ns,pl");
  const pathMod = await import("node:path");
  const root = pathMod.resolve(pathMod.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
  const list = JSON.parse(fs.readFileSync(pathMod.join(root, "assets/data/event-cards.json"), "utf8"));
  let bad = 0;
  for ( const x of list ) { try { new EventCardData(x.system, { strict: true }); } catch(err) { bad++; console.log(x.name, err.message); } }
  check("cards: eight examples: three Events, three Dark Events, two World Events, all valid, all marked as examples",
    !bad && list.length === 8 && list.filter(x => x.system.kind === "dark").length === 3 && list.filter(x => x.system.kind === "world").length === 2
      && list.every(x => /Example card/.test(x.description)) && list.every(x => x.img.startsWith("icons/svg/")));
  check("cards: the card backs ship with the system",
    ["event", "dark", "world"].every(k => fs.existsSync(pathMod.join(root, IROP.cardKinds[k].back.replace("systems/irop/", "")))));
  check("card: a World Event, worldwide", new EventCardData({ kind: "world", worldwide: true }).worldwide && new EventCardData({}).worldwide === false);
}

// RULED 2026-10-08: perk trees are items. A node gets its own id; role blank is Everyone.
{
  const tree = new items.SkillTreeData({
    role: "", kind: "primary",
    tiers: [{ exclusive: true, nodes: [{ uuid: "Item.a", name: "Rally" }, { uuid: "Item.b", name: "Chained Shot", xp: 20 }] }]
  });
  const [first, second] = tree.tiers[0].nodes;
  check("perk tree: nodes get their own ids and a 10 XP default", /^[A-Za-z0-9]{16}$/.test(first.id) && first.id !== second.id
    && first.xp === 10 && second.xp === 20, JSON.stringify(tree.tiers[0].nodes));
  check("perk tree: role blank means Everyone, gating on by default", IROP.treeRoles[tree.role] === "Everyone" && tree.gated === true);
  check("perk tree: findNode gives the node, its tier and Pick one",
    tree.findNode(second.id)?.node.name === "Chained Shot" && tree.findNode(second.id).tier === 0 && tree.findNode(second.id).exclusive);
  let bad = false;
  try { new items.SkillTreeData({ role: "pirate" }); }
  catch(err) { bad = true; }
  check("perk tree: an unknown role is refused", bad);
}

// RULED 2026-10-08: free starting skills. A role's first skill plus one of the other two; three of a background's six.
{
  const ss = await import("../module/rules/starting-skills.mjs");
  check("starting skills: old names and typos map to skills",
    ss.skillKeyOf("Investigate") === "investigation" && ss.skillKeyOf("Survival") === "survival" && ss.skillKeyOf("Survivalism") === "survival"
      && ss.skillKeyOf("Lockpicking") === "lockpicking" && ss.skillKeyOf("Atheltics") === "athletics" && ss.skillKeyOf("Xenotechnology") === "xenotech");
  const marauder = ss.startingSkillPlan({ type: "role", system: { startingSkills: "Awareness, Athletics or Survivalism" } });
  check("starting skills: a role gives its first skill, and a pick of one of the other two",
    marauder.granted.join() === "awareness" && marauder.pick === 1 && marauder.options.join() === "athletics,survival");
  // RULED 2026-10-08 (Johnald): the Marauder's free skill is Awareness, the Warmachine's Athletics.
  const { legacyRoleSkillOrder } = await import("../module/data/legacy.mjs");
  const role = (key, text) => legacyRoleSkillOrder({ type: "role", name: key, system: { role: key, startingSkills: text } }).system.startingSkills;
  check("starting skills: Marauder and Warmachine roles saved in the old order read in the new",
    (role("marauder", "Athletics, Awareness or Survivalism") === "Awareness, Athletics or Survivalism")
      && (role("warmachine", "Survivalism, Athletics or Coercion") === "Athletics, Survivalism or Coercion")
      // Items from the older test kit spell it Survival (the case in Johnald's world, 2026-10-08).
      && (role("marauder", "Athletics, Awareness or Survival") === "Awareness, Athletics or Survivalism")
      && (role("warmachine", "Survival, Athletics or Coercion") === "Athletics, Survivalism or Coercion")
      && (ss.startingSkillPlan({ type: "role", system: { startingSkills: role("warmachine", "Survivalism, Athletics or Coercion") } }).granted.join() === "athletics"));
  check("starting skills: other roles, and a GM's own wording, are left alone",
    (role("vanguard", "Athletics, Tactics or History") === "Athletics, Tactics or History")
      && (role("marauder", "Survivalism, Athletics or Awareness") === "Survivalism, Athletics or Awareness")
      && (role("legionary", "Athletics, Awareness or Survivalism") === "Athletics, Awareness or Survivalism"));
  const docs = fs.readFileSync(new URL("../module/documents.mjs", import.meta.url), "utf8");
  check("starting skills: every Item runs the fix as it loads (IropItem.migrateData)",
    docs.slice(docs.indexOf("static migrateData(source)"), docs.indexOf("return super.migrateData(source)")).includes("legacyRoleSkillOrder(source);"));
  const awakened = ss.startingSkillPlan({ type: "background",
    system: { startingSkills: "Paraphysics, Persuasion, Awareness, Insight, Deception Starting Boon: Minor Powers Unlocked", skillPicks: 3 } });
  check("starting skills: a background offers its list, pick three, ignoring trailing text",
    awakened.granted.length === 0 && awakened.pick === 3 && awakened.options.join() === "paraphysics,persuasion,awareness,insight,deception"
      && awakened.unknown.length === 0, JSON.stringify(awakened));
  const kitTexts = ["Athletics, Survivalism or Coercion", "Medical, Biology or Mechanics", "Athletics, Tactics or History",
    "Awareness, Investigate or Athletics", "Stealth, Acrobatics or Lockpicking", "Awareness, Athletics or Survivalism",
    "Awareness, Deception, Coercion, Insight, Atheltics, Lock Picking", "Athletics, Tactics, Xenobiology, Xenotechnology, History, Cybernetics"];
  check("starting skills: a leading \"Pick three:\" is skipped", ss.parseSkillNames("Pick three: Survival, Awareness").keys.join() === "survival,awareness");
  check("starting skills: every role and background list in the kit reads cleanly",
    kitTexts.every(t => (ss.parseSkillNames(t).unknown.length === 0) && (ss.parseSkillNames(t).keys.length >= 3)));
  const { update, capped } = ss.startingSkillRanks({ athletics: 0, awareness: 1, stealth: 4 }, ["athletics", "awareness", "athletics", "stealth"]);
  check("starting skills: each one taken goes up a rank, twice if both give it, never past the top",
    update["system.skills.athletics.rank"] === 2 && update["system.skills.awareness.rank"] === 2
      && !("system.skills.stealth.rank" in update) && capped.join() === "stealth");
}
// RULED 2026-10-08: the Paraphysical tag, which shows the Paraphysics panel.
check("paraphysical: no tag, no ability, no rank means not paraphysical", prepare(OperativeData, {}, []).isParaphysical === false);
check("paraphysical: granted by a background or a species",
  prepare(OperativeData, {}, [{ type: "background", system: { paraphysical: true } }]).isParaphysical
    && prepare(OperativeData, {}, [{ type: "species", system: { paraphysical: true } }]).isParaphysical);
check("paraphysical: knowing a paraphysical ability or holding a discipline rank counts too",
  prepare(OperativeData, {}, [{ type: "ability", system: { paraphysics: { discipline: "telepathy" } } }]).isParaphysical
    && prepare(OperativeData, { paraphysics: { telekinesis: 1 } }, []).isParaphysical);
{
  const { legacyParaphysicalTag } = await import("../module/data/legacy.mjs");
  const bg = (description, extra = {}) => legacyParaphysicalTag({ type: "background", system: { description, ...extra } }).system.paraphysical;
  check("paraphysical: an older Awakened background is tagged on load; others and saved values are left alone",
    bg("<p>Paraphysically&nbsp;enabled is what the GENESIS scientists call it</p>") === true
      && bg("<p>You grew up in the slums.</p>") === undefined && bg("Paraphysically enabled", { paraphysical: false }) === false);
  const species = (name, system = {}) => legacyParaphysicalTag({ type: "species", name, system }).system.paraphysical;
  check("paraphysical: Reticulons are all paraphysical, older ones tagged on load; other species are not",
    species("Reticulon") === true && species("Human") === undefined && species("Reticulon", { paraphysical: false }) === false);
}
// Weapons saved before feeds existed get theirs by name, once (2026-10-08).
{
  const { legacyWeaponFeed } = await import("../module/data/legacy.mjs");
  const old = name => legacyWeaponFeed({ type: "weapon", name, system: { weaponClass: "smallArms", category: "ranged" } }).system;
  check("legacy weapons: the LAW, the launchers and a chemthrower get their feeds",
    old("LAW").feed === "singleUse" && old("Grenade Launcher").feed === "grenades" && old("Rocket Launcher").feed === "rockets"
      && old("LAW").weaponClass === "launcher" && old("Flame Chemthrower").feed === "fuel" && old("Flame Chemthrower").weaponClass === "chemthrower"
      && old("Flame Chemthrower").burn?.status === "ignited" && old("Flame Chemthrower").burn.statusValue === 3);
  check("legacy weapons: anything else, a saved feed, or a partial update is left alone",
    !("feed" in old("T1 Pistol"))
      && legacyWeaponFeed({ type: "weapon", name: "LAW", system: { feed: "magazine" } }).system.feed === "magazine"
      && !("feed" in legacyWeaponFeed({ system: { quantity: 0 } }).system)
      && legacyWeaponFeed({ type: "weapon", name: "Cryo Chemthrower", system: {} }).system.burn === undefined);
}
check("special weapons get one mod slot by default",
  law.slots === 1 && gl.slots === 1 && chem.slots === 1 && new items.WeaponData({ weaponClass: "launcher", modSlots: 3 }).slots === 3);
check("weapon classes: old keys convert on load",
  new items.WeaponData({ weaponClass: "pistol" }).weaponClass === "smallArms"
    && new items.WeaponData({ weaponClass: "smg" }).weaponClass === "rifles"
    && new items.WeaponData({ weaponClass: "saw" }).weaponClass === "saturation"
    && new items.WeaponData({ weaponClass: "sniperRifle" }).weaponClass === "precision"
    && new items.WeaponData({ weaponClass: "shotgun" }).weaponClass === "shotguns"
    && new items.WeaponData({ category: "melee", weaponClass: "knife" }).weaponClass === "oneHanded"
    && new items.WeaponData({ weaponClass: "rocketLauncher" }).weaponClass === "launcher"
    && new items.WeaponData({ category: "melee", weaponClass: "other" }).weaponClass === "oneHanded"
    && new items.WeaponData({ category: "ranged", weaponClass: "turret" }).weaponClass === "smallArms");
// RULED 2026-10-08: special ammo effects on ammunition gear, all optional.
const cryo = new items.GearData({ kind: "ammunition", quantity: 3, ammo: { damageType: "cold", status: "frostbite", statusValue: 2 } });
check("special ammo: fields hold a damage type and a status, blank by default",
  cryo.ammo.damageType === "cold" && cryo.ammo.status === "frostbite" && new items.GearData({}).ammo.damageType === ""
    && new items.GearData({}).ammo.status === "" && new items.GearData({}).ammo.ignoreDefense === false);
check("special ammo: an unknown damage type or status is rejected",
  !!items.GearData.schema.validate({ ammo: { damageType: "laser-ish" } }) && !!items.GearData.schema.validate({ ammo: { status: "zapped" } }));
check("a weapon can name its own section", sectionOf({ category: "ranged", weaponClass: "launcher", sheetSection: "explosives" }) === "explosives"
  && new items.WeaponData({}).sheetSection === "auto");
check("weapon slot override", new items.WeaponData({ modSlots: 5 }).slots === 5);
check("armor medium 4 slots", new items.ArmorData({ armorClass: "medium" }).slots === 4);
const bad = items.WeaponData.schema.validate({ category: "laser-sword" });
check("bad weapon category caught", !!bad, String(bad));

/* -------------------------------------------- */
/*  Cross check against the live census         */
/* -------------------------------------------- */

const censusPath = process.argv[2];
if ( censusPath && fs.existsSync(censusPath) ) {
  const census = JSON.parse(fs.readFileSync(censusPath, "utf8"));
  const skillMap = { acro: "acrobatics", athl: "athletics", awre: "awareness", stlh: "stealth", hist: "history",
    cybr: "cybernetics", biol: "biology", xbio: "xenobiology", tech: "technology", xtec: "xenotech", para: "paraphysics",
    mech: "mechanics", hack: "hacking", medi: "medical", lock: "lockpicking", tact: "tactics", surv: "survival",
    invs: "investigation", pers: "persuasion", coer: "coercion", dece: "deception", insi: "insight" };
  const counts = { actors: 0, crit: 0, carry: 0, move: 0, skillBase: 0 };
  const misses = { crit: [], carry: [], move: [], skillBase: [] };
  for ( const a of census.actors ) {
    const at = a.attributes;
    if ( !at || (typeof at.str !== "number") || !at.str ) continue;
    counts.actors++;
    const src = { attributes: {} };
    for ( const k of Object.keys(IROP.attributes) ) src.attributes[k] = { base: at[k], advances: 0 };
    const model = prepare(OperativeData, src);
    if ( model.critical === at.crit ) counts.crit++; else misses.crit.push(`${a.name} ${model.critical}/${at.crit}`);
    // A Backpack adds 5 carry on the live sheet; here it is an effect on system.bonuses.carry.
    if ( (a.faction === "1. Eclipse") && (typeof at.mxwght === "number") ) {
      counts.operatives = (counts.operatives ?? 0) + 1;
      const pack = (a.gear?.carried ?? []).some(g => g.name === "Backpack") ? 5 : 0;
      if ( model.carry.max + pack === at.mxwght ) counts.carry++; else misses.carry.push(`${a.name} ${model.carry.max}+${pack}/${at.mxwght}`);
    }
    // The live sheet's Full Move (tagged Run) includes armor mobility; compare the base formula on actors whose sprint is exactly double.
    if ( at.runmv === 2 * at.fulmv ) {
      if ( model.movement.run === at.fulmv ) counts.move++; else misses.move.push(`${a.name} ${model.movement.run}/${at.fulmv}`);
    }
    let allSkills = true;
    for ( const [short, key] of Object.entries(skillMap) ) {
      const live = at[`${short}_mod`];
      if ( typeof live !== "number" ) continue;
      if ( model.skills[key].pool.base !== Math.floor(live) ) { allSkills = false; misses.skillBase.push(`${a.name} ${key} ${model.skills[key].pool.base}/${live}`); }
    }
    if ( allSkills ) counts.skillBase++;
  }
  console.log(`census: ${counts.actors} actors with attributes`);
  console.log(`  critical matches ${counts.crit}/${counts.actors}`, misses.crit.slice(0, 5));
  console.log(`  carry matches ${counts.carry}/${counts.operatives} operatives (Backpack +5 counted)`, misses.carry.slice(0, 5));
  console.log(`  run matches ${counts.move} (of actors without armor mobility)`, misses.move.slice(0, 5));
  console.log(`  every skill base matches on ${counts.skillBase}/${counts.actors}`, misses.skillBase.slice(0, 5));
  check("census crit agreement above 90%", counts.crit / counts.actors > 0.9);
  check("census carry agreement on every operative", counts.carry === counts.operatives);
}

// The calendar handed to Foundry (2026-10-08): Foundry's own CalendarData, from the
// installed client, must accept it, and the system's subclass must read dates the same way.
{
  const os = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const APP = "C:/Program Files/Foundry Virtual Tabletop/resources/app";
  let source = fs.readFileSync(`${APP}/client/data/calendar.mjs`, "utf8");
  source = source.replace("\"@client/utils/_module.mjs\"", JSON.stringify(pathToFileURL(`${APP}/common/utils/helpers.mjs`).href))
    .replace("\"@common/abstract/data.mjs\"", JSON.stringify(pathToFileURL(`${APP}/common/abstract/data.mjs`).href));
  const copy = path.join(os.tmpdir(), `irop-core-calendar-${process.pid}.mjs`);
  fs.writeFileSync(copy, source);
  let CalendarData = null;
  try { ({ default: CalendarData } = await import(pathToFileURL(copy).href)); }
  catch(err) { console.log("Foundry's CalendarData did not load:", err.message); }
  finally { fs.rmSync(copy, { force: true }); }
  const cal = await import("../module/rules/calendar.mjs");
  const glue = await import("../module/calendar.mjs");
  check("calendar: Foundry's own CalendarData loads from the install", typeof CalendarData === "function");
  if ( CalendarData ) {
    const own = cal.normalizeCalendar({
      months: [{ name: "Thaw", days: 36 }, { name: "Ash", days: 36, leapDays: 37 }],
      weekdays: [{ name: "One" }, { name: "Two" }, { name: "Three" }],
      leap: { rule: "every", every: 5, start: 0 },
      seasons: [{ name: "Only", month: 0, day: 1 }]
    });
    for ( const [label, k] of [["Gregorian", cal.normalizeCalendar({})], ["a GM's own", own], ["no leap years or seasons", { ...own, leap: { rule: "none", every: 4, start: 0 }, seasons: [] }]] ) {
      let ok = true;
      try { new CalendarData(foundry.utils.deepClone(cal.toCoreConfig(k)), { strict: true }); }
      catch(err) { ok = false; console.log(err.message); }
      check(`calendar: Foundry accepts the ${label} calendar`, ok);
    }
    const Iron = glue.makeCalendarClass(CalendarData);
    const core = new Iron(foundry.utils.deepClone(cal.toCoreConfig(cal.normalizeCalendar({}))), { strict: true });
    const t = cal.dateToTime(cal.normalizeCalendar({}), { year: 2040, month: 5, dayOfMonth: 0, hour: 8 });
    const c = core.timeToComponents(t);
    check("calendar: Foundry's calendar, through the system's class, reads 1 June 2040 a Friday in summer",
      c.year === 2040 && c.month === 5 && c.dayOfMonth === 0 && c.dayOfWeek === 5 && core.seasons.values[c.season]?.name === "Summer"
        && core.months.values[c.month].name === "June" && core.days.values[c.dayOfWeek].name === "Friday");
    check("calendar: and back, and its leap years are Gregorian",
      core.componentsToTime(c) === t && core.isLeapYear(2000) && !core.isLeapYear(1900) && core.countLeapYears(2040) === cal.leapYearsBefore(cal.normalizeCalendar({}), 2040)
        && core.add(t, { day: 7 }).dayOfMonth === 7);
    // installCalendar puts it in CONFIG.time and keeps Foundry's own if the config would be refused.
    globalThis.CONFIG = { time: { worldCalendarClass: CalendarData, worldCalendarConfig: null } };
    check("calendar: installed as Foundry's world calendar", glue.installCalendar() && CONFIG.time.worldCalendarClass.iropCalendar
      && CONFIG.time.worldCalendarConfig.months.values[0].name === "January");
    check("calendar: installing twice does not wrap the class twice",
      glue.installCalendar() && (Object.getPrototypeOf(CONFIG.time.worldCalendarClass) === CalendarData));
    delete globalThis.CONFIG;
  }
}

// Stores (Johnald, 2026-10-10).
{
  const { StoreData } = await import("../module/data/store.mjs");
  const s = new StoreData({});
  check("store model: no markup, buys back at half, no description", (s.markup === 0) && (s.sellBack === 50) && (s.description === ""));
  const past = new StoreData({ sellBack: 150, markup: -500 });
  check("store model: buys back at no more than 100%, a discount of no more than 90%", (past.sellBack === 100) && (past.markup === -90),
    `${past.sellBack} ${past.markup}`);
  const g = new items.GearData({});
  check("items: a price per currency, none set, every currency ticked to buy it",
    (Object.keys(g.prices).join() === "credits,valuables,alloys") && Object.values(g.prices).every(p => p === 0)
      && Object.values(g.accepts).every(a => a === true) && ["WeaponData", "ArmorData", "ModData"].every(k => "prices" in new items[k]({})));
  const oldAlloys = new items.WeaponData({ price: 10, currency: "alloys" });
  check("items: an old single price goes to Credits, or to the currency it was in",
    (new items.GearData({ price: 25 }).prices.credits === 25) && (oldAlloys.prices.alloys === 10) && (oldAlloys.prices.credits === 0)
      && (new items.ArmorData({ price: 80 }).prices.credits === 80) && (new items.ModData({ price: 5 }).prices.credits === 5));
  check("store model: prefers Credits unless set", (new StoreData({}).preferred === "credits") && (new StoreData({ preferred: "alloys" }).preferred === "alloys"));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

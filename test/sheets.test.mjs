/**
 * Sheet and template tests. Run: node test/sheets.test.mjs <node_modules dir with handlebars and jsdom>
 *
 * Runs the REAL sheet context builders and roll card builders against
 * Foundry's real data layer, with only the client base classes stubbed, then
 * renders every template through Handlebars and inspects the HTML:
 *   - nothing renders as undefined, NaN or [object Object]
 *   - every data-action button maps to a real action handler
 *   - every form input names a real field in the document's schema
 *   - tab sections carry the attributes Foundry's tab switcher looks for
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(process.argv[2] ?? ".", "x.js"));
const Handlebars = require("handlebars");
const { JSDOM } = require("jsdom");

/* -------------------------------------------- */
/*  Foundry: real data layer, stubbed client    */
/* -------------------------------------------- */

const common = await import("file:///C:/Program%20Files/Foundry%20Virtual%20Tabletop/resources/app/common/server.mjs");

class StubApp {
  constructor(document) { this.document = document; }
  get actor() { return this.document; }
  get item() { return this.document; }
  get isEditable() { return true; }
  render() {}
  _getTabsConfig(group) { return (this.constructor.TABS ?? {})[group] ?? null; }
  // Foundry's own (client/applications/api/application.mjs), for tests that open a sheet on a tab.
  _prepareTabs(group) {
    const { tabs, initial = null } = this._getTabsConfig(group) ?? { tabs: [] };
    this.tabGroups[group] ??= initial;
    return Object.fromEntries(tabs.map(t => [t.id, { ...t, group, active: this.tabGroups[group] === t.id }]));
  }
  async _prepareContext() {
    const tabs = {};
    (this._getTabsConfig("primary")?.tabs ?? []).forEach((t, i) => {
      tabs[t.id] = { ...t, group: "primary", active: i === 0, cssClass: i === 0 ? "active" : "" };
    });
    return { tabs, document: this.document, editable: true };
  }
  async _preparePartContext(partId, context) { return { ...context }; }
  _configureRenderParts() { return foundry.utils.deepClone(this.constructor.PARTS); }
  _configureRenderOptions() {}
  async _onRender() {}
  async _onDropItem(event, item) { return { created: item.name }; }
  _onClose() {}
  _initializeApplicationOptions(options) {
    return { ...options, position: { ...(options.position ?? {}) }, classes: [...(options.classes ?? [])] };
  }
}

class StubRoll {
  constructor(formula, data = {}, options = {}) { this._formula = formula; this.data = data; this.options = options; this._dice = []; }
  get dice() { return this._dice; }
  async _prepareChatRenderContext({ flavor } = {}) {
    return { formula: this._formula, flavor, user: "u1", tooltip: "<div class=\"dice-tooltip\"></div>", total: this.total };
  }
}

globalThis.foundry = {
  ...common,
  applications: {
    api: { HandlebarsApplicationMixin: Base => class extends Base {}, DialogV2: class {} },
    sheets: { ActorSheetV2: StubApp, ItemSheetV2: StubApp },
    ux: { TextEditor: { implementation: { enrichHTML: async html => html ?? "" } } },
    handlebars: { renderTemplate: async () => "", loadTemplates: async () => {} }
  },
  dice: { Roll: StubRoll }
};
globalThis.CONST = common.CONST;
globalThis.game = {
  settings: { get() { throw new Error("no settings in tests"); } },
  i18n: { localize: k => k.split(".").pop() }
};

const { IROP } = await import("../module/config.mjs");
const { OperativeData, NpcData } = await import("../module/data/actor.mjs");
const itemModels = await import("../module/data/item.mjs");
const { OperativeSheet, NpcSheet, IropActorSheet, recordBarIcon, splitScore, shownFormula, formulaInWords, plainText } = await import("../module/sheets/actor-sheet.mjs");
const { IropItemSheet } = await import("../module/sheets/item-sheet.mjs");
const { DynosrsRoll } = await import("../module/dice/dynosrs-roll.mjs");
const { D100Roll, DamageRoll } = await import("../module/dice/d100-roll.mjs");
const { collectModifiers } = await import("../module/rules/combat.mjs");
const { resolve, symbolsFor } = await import("../module/rules/dynosrs.mjs");

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if ( cond ) pass++;
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

// Formulas on the sheet show numbers, not @ references (2026-10-07).
{
  const data = { str: { mod: 4 }, agi: { mod: -1 }, paraphysics: { telepathy: 2 } };
  check("formula shown: @str.mod filled in", shownFormula("1d6 + @str.mod", data) === "1d6 + 4");
  check("formula shown: a negative mod reads as a minus", shownFormula("1d2 + @agi.mod", data) === "1d2 - 1");
  check("formula shown: plain formulas untouched, unknown references kept",
    shownFormula("2d3 + 2", data) === "2d3 + 2" && shownFormula("1d4 + @foo.bar", data) === "1d4 + @foo.bar");
  check("formula in words: attributes and disciplines",
    formulaInWords("2d6dl1 + @str.mod") === "2d6dl1 + STR mod" && formulaInWords("1d4 + @paraphysics.telepathy") === "1d4 + Telepathy rank");
}

/* -------------------------------------------- */
/*  Handlebars with the core helpers we use     */
/* -------------------------------------------- */

const hb = Handlebars.create();
hb.registerHelper({
  checked: v => (v ? "checked" : ""),
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  lt: (a, b) => a < b,
  gt: (a, b) => a > b,
  lte: (a, b) => a <= b,
  gte: (a, b) => a >= b,
  not: v => !v,
  and(...args) { return args.slice(0, -1).every(Boolean); },
  or(...args) { return args.slice(0, -1).some(Boolean); },
  localize: k => k,
  object(options) { return options.hash; },
  iropTimes(n, options) { let s = ""; for ( let i = 0; i < (Number(n) || 0); i++ ) s += options.fn({ index: i }); return s; },
  selectOptions(choices, options) {
    const { selected, blank, valueAttr = "value", labelAttr = "label" } = options.hash;
    const opts = [];
    if ( blank !== undefined ) opts.push({ value: "", label: blank });
    if ( Array.isArray(choices) ) for ( const c of choices ) opts.push({ value: c[valueAttr], label: c[labelAttr] });
    else for ( const [k, v] of Object.entries(choices) ) opts.push({ value: k, label: typeof v === "object" ? v.label : v });
    return new Handlebars.SafeString(opts.map(o =>
      `<option value="${o.value}" ${String(o.value) === String(selected ?? "") ? "selected" : ""}>${o.label}</option>`).join(""));
  }
});
const tpl = rel => hb.compile(fs.readFileSync(path.join(ROOT, rel), "utf8"), { strict: false });
hb.registerPartial("systems/irop/templates/item/physical.hbs", fs.readFileSync(path.join(ROOT, "templates/item/physical.hbs"), "utf8"));

// Every template must at least compile.
const allTemplates = [];
(function walk(dir) {
  for ( const f of fs.readdirSync(dir) ) {
    const p = path.join(dir, f);
    if ( fs.statSync(p).isDirectory() ) walk(p);
    else if ( f.endsWith(".hbs") ) allTemplates.push(path.relative(ROOT, p));
  }
})(path.join(ROOT, "templates"));
for ( const t of allTemplates ) {
  try { hb.precompile(fs.readFileSync(path.join(ROOT, t), "utf8")); check(`compiles ${t}`, true); }
  catch(err) { check(`compiles ${t}`, false, err.message.split("\n")[0]); }
}

/* -------------------------------------------- */
/*  A populated operative                       */
/* -------------------------------------------- */

class FakeDoc extends foundry.abstract.DataModel {
  static defineSchema() { return {}; }
  static TYPES = [];
}

const MODELS = {
  weapon: itemModels.WeaponData, armor: itemModels.ArmorData, gear: itemModels.GearData, mod: itemModels.ModData,
  ability: itemModels.AbilityData, species: itemModels.SpeciesData, role: itemModels.RoleData,
  background: itemModels.BackgroundData, boon: itemModels.BoonData, mutation: itemModels.MutationData
};

function makeActor(type, Model, source, specs) {
  const actor = new FakeDoc({});
  const list = [];
  list.contents = list;
  list.get = id => list.find(i => i.id === id);
  Object.assign(actor, {
    type, name: "Test Operative", img: "icons/svg/mystery-man.svg", uuid: "Actor.test", isOwner: true,
    items: list, statuses: new Set(["bleeding"]),
    *allApplicableEffects() {
      yield { id: "e1", name: "Resilience", img: "x.svg", disabled: false, parent: list[0], statuses: new Set(),
        system: { changes: [{ key: "system.vitals.hp.bonus", type: "add", value: "2" }] } };
    }
  });
  specs.forEach((spec, i) => {
    const item = new FakeDoc({});
    Object.assign(item, { id: spec.id ?? `i${i}`, type: spec.type, name: spec.name, img: "x.svg", actor, sort: i });
    item.system = new MODELS[spec.type](spec.system ?? {}, { parent: item });
    list.push(item);
  });
  actor.system = new Model(source, { parent: actor });
  actor.system.prepareBaseData();
  actor.system.prepareDerivedData();
  return actor;
}

const operative = makeActor("operative", OperativeData, {
  attributes: { per: { base: 45, advances: 1 } },
  skills: { stealth: { rank: 2 }, awareness: { rank: 4 } },
  details: { callsign: "Wraith", biography: "<p>Born in the slums.</p>" }
}, [
  { type: "role", name: "Outrider", system: { role: "outrider" } },
  { type: "species", name: "Human", system: { boons: true } },
  { type: "background", name: "Slum Dweller", system: {} },
  { type: "boon", name: "Perception Boon A", system: { attribute: "per" } },
  { type: "weapon", name: "T1 Pistol", id: "pistol", system: { category: "ranged", weaponClass: "smallArms", accuracy: 20,
    damage: { formula: "2d2 + 1", type: "ballistic" }, ammo: { value: 6, max: 6 }, weight: 2, equipped: true,
    range: { short: { tiles: 5, dm: -15 }, medium: { tiles: 10, dm: 5 }, long: { tiles: 20, dm: 10 }, extreme: { tiles: 30, dm: 30 } } } },
  { type: "weapon", name: "Survival Sword", system: { category: "melee", weaponClass: "oneHanded", accuracy: 30,
    damage: { formula: "1d6 + @str.mod", type: "physical" }, critical: { chance: 15, damage: 3 }, weight: 5 } },
  { type: "armor", name: "Kevlar Armor", id: "kevlar", system: { armorClass: "medium", points: 4, defense: 6, dr: { ballistic: 1, physical: 1 },
    equipped: true, weight: 6 } },
  { type: "mod", name: "Red Dot", system: { target: "ranged", installedOn: "pistol", weight: 1 } },
  { type: "mod", name: "Ceramic Plate", system: { target: "armor", weight: 1 } },
  { type: "gear", name: "Medkit", system: { kind: "medical", formula: "1d4 + @int.mod", consumable: true, quantity: 2, weight: 3 } },
  { type: "gear", name: "Ration Pack", id: "rations", system: { quantity: 4, weight: 1, stowed: true } },
  { type: "gear", name: "Deployable Turret", id: "turret", system: { kind: "deployable", quantity: 1, weight: 8 } },
  { type: "gear", name: "Cryo Rounds", id: "cryo", system: { kind: "ammunition", quantity: 3, weight: 1, loadedIn: "pistol",
    ammo: { damageType: "cold", status: "frostbite", statusValue: 2 } } },
  { type: "gear", name: "Incendiary Rounds", id: "incendiary", system: { kind: "ammunition", quantity: 20, weight: 1 } },
  { type: "weapon", name: "Frag Grenade", id: "frag", system: { category: "thrown", weaponClass: "grenade", quantity: 2,
    damage: { formula: "2d4 + 1", type: "explosive" }, blast: 2 } },
  { type: "weapon", name: "RPG", id: "rpg", system: { category: "explosive", weaponClass: "rocket", quantity: 1,
    damage: { formula: "3d2 + 5", type: "explosive" } } },
  { type: "weapon", name: "Grenade Launcher", id: "gl", system: { category: "ranged", weaponClass: "launcher", feed: "grenades",
    damage: { formula: "", type: "explosive" }, loaded: [{ name: "Frag Grenade", img: "x.svg",
      system: { category: "thrown", weaponClass: "grenade", damage: { formula: "2d4 + 1", type: "explosive" }, blast: 2, quantity: 1 } }] } },
  { type: "weapon", name: "LAW", id: "law", system: { category: "ranged", weaponClass: "launcher", feed: "singleUse", quantity: 1,
    damage: { formula: "2d4 + 4", type: "explosive" } } },
  { type: "weapon", name: "Flame Chemthrower", id: "chem", system: { category: "ranged", weaponClass: "chemthrower", feed: "fuel",
    damage: { formula: "2d4 + 2", type: "fire" }, fuel: { value: 80 }, burn: { save: "agi", status: "ignited", statusValue: 3 } } },
  { type: "weapon", name: "Spare Pistol", id: "spare", system: { category: "ranged", weaponClass: "smallArms", accuracy: 20, weight: 2, stowed: true } },
  { type: "ability", name: "Called Shot", system: { kind: "active", source: "outrider", energyCost: 4, range: 12 } },
  { type: "ability", name: "Gravbolt", system: { kind: "active", source: "species", energyCost: 5,
    paraphysics: { discipline: "telekinesis", attack: true, accuracy: 40, damage: { formula: "2d4 + @cha.mod", type: "psychic" } } } },
  { type: "ability", name: "Resilience (1)", system: { kind: "passive", source: "generalist" } },
  { type: "mutation", name: "Chitinous Shell", system: { polarity: "positive" } }
]);
// The red dot needs to see its host after construction.
check("mod finds its host", operative.items.get("i7").system.host?.name === "T1 Pistol");

const ACTIONS = new Set([...Object.keys(IropActorSheet.DEFAULT_OPTIONS.actions),
  ...Object.keys(OperativeSheet.DEFAULT_OPTIONS.actions ?? {}), "tab", "editImage"]);
const ITEM_ACTIONS = new Set([...Object.keys(IropItemSheet.DEFAULT_OPTIONS.actions), "tab", "editImage"]);

/** Inspect rendered HTML for leaks, dead buttons and unbound inputs. */
function inspect(label, html, { actions, source }) {
  const dom = new JSDOM(`<body>${html}</body>`);
  const doc = dom.window.document;
  const text = doc.body.textContent;
  for ( const bad of ["undefined", "[object Object]", "NaN"] ) {
    check(`${label}: no "${bad}" in text`, !text.includes(bad), text.slice(Math.max(0, text.indexOf(bad) - 60), text.indexOf(bad) + 20));
  }
  for ( const el of doc.querySelectorAll("*") ) {
    for ( const attr of el.attributes ) {
      if ( /undefined|\[object Object\]|NaN/.test(attr.value) ) check(`${label}: attribute ${attr.name}="${attr.value}"`, false);
    }
  }
  for ( const el of doc.querySelectorAll("[data-action]") ) {
    check(`${label}: action ${el.dataset.action} exists`, actions.has(el.dataset.action));
  }
  for ( const el of doc.querySelectorAll("[name]") ) {
    const name = el.getAttribute("name");
    if ( (name === "name") || (name === "img") ) continue;
    const ok = name.startsWith("system.") && (foundry.utils.getProperty(source, name.slice(7)) !== undefined);
    check(`${label}: input ${name} is a schema field`, ok);
  }
  return doc;
}

async function renderSheet(SheetClass, document, { editMode = false } = {}) {
  const sheet = new SheetClass(document);
  if ( editMode ) await IropActorSheet.DEFAULT_OPTIONS.actions.toggleMode.call(sheet);
  const context = await sheet._prepareContext({});
  const parts = sheet._configureRenderParts ? sheet._configureRenderParts({}) : SheetClass.PARTS;
  const out = {};
  for ( const [id, part] of Object.entries(parts) ) {
    const partContext = await sheet._preparePartContext(id, { ...context }, {});
    const rel = part.template.replace("systems/irop/", "");
    out[id] = tpl(rel)(partContext);
  }
  return { context, out };
}

for ( const editMode of [false, true] ) {
  const { context, out } = await renderSheet(OperativeSheet, operative, { editMode });
  const mode = editMode ? "edit" : "play";
  check(`operative ${mode}: editMode flag`, context.editMode === editMode);
  check("operative accent is Outrider red", context.accent === "#d64f4f", context.accent);
  check("initiative text: AGI mod 4 + LCK mod 3", context.initiativeText === "1d20 + 7", context.initiativeText);
  const luck = context.attributes.find(x => x.key === "lck");
  check(`operative ${mode}: Luck's ranks are locked (RULED 2026-10-17): none for sale, dimmed, editable only by a GM in Edit mode`,
    luck.locked && !luck.advancePips.some(p => p.buyable) && (luck.rankEditable === (editMode && !!game.user?.isGM))
      && (editMode || context.attributes.find(x => x.key === "str").advancePips.some(p => p.buyable))
      && /cannot be raised/.test(new JSDOM(out.main).window.document.querySelector(".advance-pips.locked")?.dataset.tooltip ?? ""));
  for ( const [id, html] of Object.entries(out) ) {
    const doc = inspect(`operative ${mode} ${id}`, html, { actions: ACTIONS, source: operative.system._source });
    // The record is a drawer beside the sheet, not a tab.
    if ( !["header", "tabs", "record"].includes(id) ) {
      const section = doc.querySelector("section.tab");
      check(`operative ${id} is a tab section`, section?.dataset.group === "primary" && section?.dataset.tab === id);
    }
  }
  // RULED 2026-10-06: three speeds, Shift, Run, Sprint, in boxes like the attributes. No fourth.
  const speeds = [...new JSDOM(out.main).window.document.querySelectorAll(".stat.movement .speed")]
    .map(el => `${el.querySelector(".abbr").textContent} ${el.querySelector(".score").textContent}`);
  const mv = operative.system.movement;
  check(`operative ${mode}: the Movement label is just the word`,
    new JSDOM(out.main).window.document.querySelector(".stat.movement > .mono-label")?.textContent === "Movement");
  check(`operative ${mode}: movement shows Shift, Run and Sprint only`,
    speeds.join() === `Shift ${mv.shift},Run ${mv.run},Sprint ${mv.sprint}` && Object.keys(mv).join() === "shift,run,sprint", speeds.join());
  // Critical, Initiative and Throw show one big centred number each (Johnald, 2026-10-07).
  const big = [...new JSDOM(out.main).window.document.querySelectorAll(".derived .stat.big")]
    .map(el => `${el.querySelector(".mono-label").textContent}=${el.querySelector(".stat-value").textContent}`);
  // Defense (RULED 2026-10-07): worn armor's Armor Bonus, shown on its row and as the character's total.
  const combatDoc = new JSDOM(out.combat).window.document;
  // Weapon and armor rows show labelled boxes in fixed columns (Johnald, 2026-10-08).
  const statsOf = row => [...row.querySelectorAll(".item-stats > .item-stat")]
    .map(c => `${c.querySelector(".label").textContent.trim()}=${c.querySelector(".value").textContent.trim().replace(/\s+/g, " ")}`);
  const kevlarStats = statsOf(combatDoc.querySelector('.armor-row[data-item-id="kevlar"]'));
  check(`operative ${mode}: an armor row reads Defense, Armor HP, Barrier, DR, Mobility, Dodges, each labelled`,
    kevlarStats.join() === "Defense=6,Armor HP=4,Barrier=0,DR=1,Mobility=0,Dodges=0", kevlarStats.join());
  check(`operative ${mode}: armor DR explains itself on hover`,
    combatDoc.querySelector('.armor-row[data-item-id="kevlar"] .item-stat:nth-child(4)').dataset.tooltip === "Damage reduction: Ballistic 1, Physical 1");
  check(`operative ${mode}: the combat tab shows the character's Defense`,
    operative.system.defense === 6 && /Defense <strong>6<\/strong>/.test(out.combat));
  // Weapon chips read as the D.M. on the roll, as the Field Manual prints them: accuracy 30 is "ACC -30" (2026-10-07).
  const sword = operative.items.find(i => i.type === "weapon" && i.system.accuracy > 0 && i.system.critical.chance > 0);
  const weaponRows = [...combatDoc.querySelectorAll(".weapon-row")];
  const swordStats = statsOf(weaponRows.find(r => r.dataset.itemId === sword.id));
  check(`operative ${mode}: a weapon row reads Accuracy, Damage, Type, Crit, Ammo, bonuses as minus`,
    swordStats.join() === `Accuracy=-${sword.system.accuracy},Damage=1d6 + ${operative.system.attributes.str.mod},Type=Physical,Crit=-${sword.system.critical.chance},Ammo=none`,
    swordStats.join());
  check(`operative ${mode}: every weapon row has the same five labelled boxes, the last fitted to its feed`,
    weaponRows.length > 1 && weaponRows.every(r => /^Accuracy,Damage,Type,Crit,(Ammo|Count|Fuel|Single use|Loaded)$/
      .test(statsOf(r).map(x => x.split("=")[0]).join())));
  // Special weapons (RULED 2026-10-08).
  const rowOf = id => combatDoc.querySelector(`.weapon-row[data-item-id="${id}"]`);
  const lastStat = id => statsOf(rowOf(id)).at(-1);
  check(`operative ${mode}: a LAW is single use, a chemthrower shows its fuel, a launcher its loaded count`,
    // The LAW's count is typed in (Johnald, 2026-10-10): "x" and a number box holding 1.
    lastStat("law") === "Single use=x" && rowOf("law").querySelector('.item-stat.count input[data-item-field="system.quantity"]')?.value === "1"
      && lastStat("gl") === "Loaded=1 / 4"
      && rowOf("chem").querySelector('.item-stat.fuel input[data-item-field="system.fuel.value"]')?.value === "80"
      && !!rowOf("chem").querySelector('[data-action="refuel"]'), `${lastStat("law")} | ${lastStat("gl")}`);
  const glSlots = [...rowOf("gl").querySelectorAll(".mod-tray .ammo-slot.projectile")];
  check(`operative ${mode}: a grenade launcher has four slots, the loaded one fires on a click`,
    glSlots.length === 4 && glSlots[0].querySelector('[data-action="fireProjectile"][data-slot="0"]')
      && glSlots[0].querySelector(".ammo-name").textContent === "Frag Grenade"
      && glSlots.slice(1).every(b => b.dataset.action === "chooseProjectile") && !rowOf("gl").querySelector(".ammo-slot:not(.projectile)"));
  check(`operative ${mode}: special weapons have one mod slot and no special ammo slot`,
    ["gl", "law", "chem"].every(id => rowOf(id).querySelectorAll(".mod-tray .mod-slot, .mod-tray .mod-chip").length === 1)
      && !rowOf("law").querySelector('[data-action="chooseAmmo"]') && !rowOf("chem").querySelector('[data-action="chooseAmmo"]'));
  check(`operative ${mode}: rockets are ammunition, with no Attack button of their own`,
    !rowOf("rpg").querySelector('[data-action="useItem"]') && !!rowOf("frag").querySelector('[data-action="useItem"]'));
  const pistolAmmo = combatDoc.querySelector('.weapon-row[data-item-id="pistol"] .item-stat.ammo');
  check(`operative ${mode}: a gun's Ammo box holds the magazine count and a reload button`,
    !!pistolAmmo?.querySelector('input[data-item-field="system.ammo.value"]') && !!pistolAmmo.querySelector('[data-action="reload"]'));
  check(`operative ${mode}: mod slots are squares, a fitted mod shown by its icon and named on hover`,
    !!combatDoc.querySelector('.mod-chip[data-tooltip="Red Dot"] img[alt="Red Dot"]') && !combatDoc.querySelector(".mod-slot")?.textContent.trim());
  // Weapons in sections, and a Deployables box between Weapons and Armor (Johnald, 2026-10-08).
  const sections = [...combatDoc.querySelectorAll(".panel .item-group")].map(g => `${g.querySelector(".item-group-title").textContent}:${
    [...g.querySelectorAll(".weapon-row")].map(r => r.querySelector(".item-name a").textContent).join("+")}`);
  check(`operative ${mode}: weapons sit in their sections, empty sections left out`,
    sections.join() === "Ranged:T1 Pistol,Melee:Survival Sword,Special:Grenade Launcher+LAW+Flame Chemthrower,Explosives:Frag Grenade+RPG",
    sections.join());
  const combatPanels = [...combatDoc.querySelectorAll(".panel > .panel-head h3")].map(h => h.textContent);
  check(`operative ${mode}: under a weapon's name, its class and tier, not Ranged or Melee`,
    combatDoc.querySelector('.weapon-row[data-item-id="pistol"] .item-sub')?.textContent.trim() === "Small Arms · Tier 1",
    combatDoc.querySelector('.weapon-row[data-item-id="pistol"] .item-sub')?.textContent);
  check(`operative ${mode}: one handed melee reads 1H under the name`,
    /^1H( · Tier \d+)?$/.test([...combatDoc.querySelectorAll(".weapon-row")].find(r => r.querySelector(".item-name a").textContent === "Survival Sword")
      ?.querySelector(".item-sub").textContent.trim() ?? ""));
  // Special ammo: ranged weapons only, a rectangle after the mod squares (Johnald, 2026-10-08).
  const pistolSlot = combatDoc.querySelector('.weapon-row[data-item-id="pistol"] .mod-tray .ammo-slot.loaded');
  check(`operative ${mode}: a ranged weapon shows its loaded special ammo, last in the mod row`,
    pistolSlot?.querySelector(".ammo-name").textContent === "Cryo Rounds" && pistolSlot.querySelector(".ammo-count").textContent === "x3"
      && pistolSlot === pistolSlot.parentElement.lastElementChild && !!pistolSlot.querySelector('[data-action="unloadAmmo"][data-ammo-id="cryo"]'));
  const pistolType = combatDoc.querySelector('.weapon-row[data-item-id="pistol"] .item-stat.type');
  check(`operative ${mode}: loaded Cryo Rounds show Cold in the Type box, marked as from the ammo`,
    pistolType?.classList.contains("from-ammo") && pistolType.querySelector(".value").textContent === "Cold"
      && /from Cryo Rounds/.test(pistolType.dataset.tooltip), pistolType?.outerHTML);
  check(`operative ${mode}: the ammo slot's tooltip lists its magazines and effects`,
    /Cryo Rounds: 3 magazines, one loaded\. Cold damage, Frostbite \(2\) on hit/.test(pistolSlot?.dataset.tooltip ?? ""), pistolSlot?.dataset.tooltip);
  check(`operative ${mode}: melee weapons have no special ammo slot`,
    !combatDoc.querySelector(`.weapon-row[data-item-id="${sword.id}"] .ammo-slot`));
  check(`operative ${mode}: loaded ammo leaves the Gear list, carried ammo stays`,
    !out.gear.includes('data-item-id="cryo"') && out.gear.includes('data-item-id="incendiary"'));
  check(`operative ${mode}: Deployables sits between Weapons and Armor`,
    combatPanels.slice(0, 3).join() === "Weapons,Deployables,Armor", combatPanels.join());
  const turretRow = combatDoc.querySelector('.deploy-row[data-item-id="turret"]');
  check(`operative ${mode}: deployable gear is in the Deployables box with a Deploy button, not on the Gear tab`,
    !!turretRow?.querySelector('[data-action="useItem"]') && !out.gear.includes('data-item-id="turret"')
      && statsOf(turretRow).join() === "Count=,Weight=8"
      && turretRow.querySelector('.item-stat input[data-item-field="system.quantity"]')?.value === "1", turretRow?.outerHTML.slice(0, 300));
  // The Add buttons are the GM's (2026-10-10): what they make, players could not fill in.
  check(`operative ${mode}: the Deployables Add button makes deployable gear, for the GM`,
    !!combatDoc.querySelector('.deployables [data-action="createItem"][data-type="gear"][data-kind="deployable"]') === !!context.gmEditable);
  // No subtext beside the Weapons, Armor or Status titles (Johnald, 2026-10-07).
  const headOf = title => [...combatDoc.querySelectorAll(".panel-head")].find(h => h.querySelector("h3")?.textContent === title);
  check(`operative ${mode}: no subtext beside the Weapons, Armor and Status titles`,
    ["Weapons", "Armor", "Status"].every(t => headOf(t) && !headOf(t).querySelector(".hint")));
  // The Stowed box under Loose mods holds everything stowed, of any kind (Johnald, 2026-10-07).
  const gearDoc = new JSDOM(out.gear).window.document;
  const gearPanels = [...gearDoc.querySelectorAll(".panel h3")].map(h => h.textContent);
  check(`operative ${mode}: the Stowed box comes right after Loose mods`,
    gearPanels.indexOf("Stowed") === gearPanels.indexOf("Loose mods") + 1, gearPanels.join());
  const stowedRows = [...gearDoc.querySelectorAll(".stowed-panel .stowed-row")].map(r => r.dataset.itemId);
  check(`operative ${mode}: stowed gear and a stowed weapon sit in the Stowed box`,
    stowedRows.includes("rations") && stowedRows.includes("spare")
      && /Weapon, Small Arms/.test(gearDoc.querySelector('.stowed-row[data-item-id="spare"] .item-sub')?.textContent ?? ""), stowedRows.join());
  check(`operative ${mode}: stowed things leave their usual lists`,
    !gearDoc.querySelector('.gear-row[data-item-id="rations"]') && !combatDoc.querySelector('[data-item-id="spare"]'));
  check(`operative ${mode}: weapons, armor, gear and loose mods each have a Stow button, stowed rows a take out button`,
    !!gearDoc.querySelector('.gear-row [data-action="toggleStow"]') && !!gearDoc.querySelector('.mod-row [data-action="toggleStow"]')
      && combatDoc.querySelectorAll(".weapon-row, .armor-row").length > 0
      && [...combatDoc.querySelectorAll(".weapon-row, .armor-row")].every(r => r.querySelector(':scope > .row-main [data-action="toggleStow"]'))
      && gearDoc.querySelectorAll('.stowed-row [data-action="toggleStow"]').length === stowedRows.length);
  check(`operative ${mode}: Gear tab panels run Wealth, Gear, Loose mods, Stowed`,
    gearPanels.join() === "Wealth,Gear,Loose mods,Stowed", gearPanels.join());
  check(`operative ${mode}: no subtext beside the Loose mods title`,
    ![...gearDoc.querySelectorAll(".panel-head")].find(h => h.querySelector("h3")?.textContent === "Loose mods")?.querySelector(".hint"));
  check(`operative ${mode}: wealth reads Credits, Valuables, Alien Alloys`,
    [...gearDoc.querySelectorAll(".wealth-row .mono-label")].map(l => l.textContent).join() === "Credits,Valuables,Alien Alloys");
  // Formulas show the character's numbers, not Sandbox style @ references (Johnald, 2026-10-07).
  const strMod = operative.system.attributes.str.mod, intMod = operative.system.attributes.int.mod;
  const swordRow = [...combatDoc.querySelectorAll(".weapon-row")].find(r => r.querySelector(".item-name a")?.textContent === "Survival Sword");
  const swordDmg = swordRow?.querySelector(".item-stat:nth-child(2)");
  check(`operative ${mode}: a melee weapon's damage reads 1d6 + the STR mod, explained on hover`,
    swordDmg?.querySelector(".value").textContent.trim() === `1d6 + ${strMod}` && swordDmg.dataset.tooltip === "1d6 + STR mod",
    swordDmg?.outerHTML);
  check(`operative ${mode}: no @ reference shows anywhere on the combat or gear tabs`,
    ![out.combat, out.gear].some(h => /@(str|agi|tgh|cha|lck|int|per)\.mod/.test(new JSDOM(h).window.document.body.textContent)));
  check(`operative ${mode}: the Medkit's heal reads 1d4 + the INT mod`,
    new RegExp(`· 1d4 \\+ ${intMod}`).test(gearDoc.querySelector(".gear-row .item-sub")?.textContent ?? ""));
  // The fixture knows a telekinesis attack, so it is paraphysical: the panel shows, with no subtext (2026-10-08).
  const paraHead = [...new JSDOM(out.paraphysics ?? "").window.document.querySelectorAll(".panel-head")].find(h => h.querySelector("h3")?.textContent === "Paraphysics");
  check(`operative ${mode}: a paraphysical character has the Paraphysics tab (2026-10-16), its panel there and not on Abilities`,
    !!paraHead && !paraHead.querySelector(".hint") && !/<h3>Paraphysics<\/h3>/.test(out.abilities)
      && new OperativeSheet(operative)._getTabsConfig("primary").tabs.map(t => t.id).slice(0, 3).join() === "main,abilities,paraphysics");
  check(`operative ${mode}: no subtext beside the Active abilities title`,
    ![...new JSDOM(out.abilities).window.document.querySelectorAll(".panel-head")]
      .find(h => h.querySelector("h3")?.textContent === "Active abilities")?.querySelector(".hint"));
  // Combat tab, 2026-10-07: no top bar; Defense, Dodge and Reset dodges head the Damage reduction panel.
  const drPanel = [...combatDoc.querySelectorAll(".panel")].find(p => p.querySelector("h3")?.textContent === "Damage reduction");
  check(`operative ${mode}: Defense, Dodge and Reset dodges sit in the Damage reduction panel`,
    !!drPanel?.querySelector(".defense-bar .defense-readout") && !!drPanel.querySelector('.defense-bar [data-action="rollDodge"]')
      && !!drPanel.querySelector('.defense-bar [data-action="resetDodges"]') && !/armor plus bonus/.test(drPanel.textContent));
  check(`operative ${mode}: no top bar, Initiative or Critical on the combat tab`,
    !combatDoc.querySelector('.quick-actions, [data-action="rollInitiative"]') && !/Critical <strong>/.test(out.combat));
  check(`operative ${mode}: Critical, Initiative and Throw are the big value boxes`,
    big.join() === `Critical=${operative.system.critical},Initiative=+7,Throw=${operative.system.throwRange}`, big.join());
  // Johnald, 2026-10-10: "I dont think we need the dodge pool on the attributes tab".
  const combatDodge = new JSDOM(out.combat).window.document.querySelector('.defense-bar [data-action="rollDodge"]');
  check(`operative ${mode}: no dodge pool on the Attributes tab; the Combat tab's Dodge has its pips, one per dodge`,
    !/data-action="rollDodge"/.test(out.main) && (combatDodge?.querySelectorAll(".pips .pip").length === operative.system.vitals.dodges.max));
  const derivedOrder = [...new JSDOM(out.main).window.document.querySelectorAll(".derived > .stat")].map(el => el.querySelector(".mono-label")?.textContent).filter(Boolean);
  check(`operative ${mode}: Throw sits beside Initiative (Johnald, 2026-10-10)`,
    derivedOrder.indexOf("Throw") === derivedOrder.indexOf("Initiative") + 1, derivedOrder.join());
  check(`operative ${mode}: with dodges left, the Dodge button works`,
    (operative.system.vitals.dodges.value > 0) && !combatDodge.disabled);
  check(`operative ${mode}: Initiative shows the bonus alone, the full formula in its tooltip`,
    context.initiativeBonusText === "+7" && /data-tooltip="Roll initiative into the current combat: 1d20 \+ 7"/.test(out.main));
  // Skills grouped Physical, Knowledge, Social (RULED 2026-10-07): every skill once, alphabetical in its group.
  const mainDoc = new JSDOM(out.main).window.document;
  const order = [...mainDoc.querySelectorAll(".skill-groups > .skill-group")]
    .map(g => `${g.querySelector(".skill-group-title").textContent}${g.classList.contains("wide") ? " (wide)" : ""}`);
  check(`operative ${mode}: Physical and Social side by side, Knowledge wide beneath`,
    order.join() === "Physical,Social,Knowledge (wide)", order.join());
  const grouped = [...mainDoc.querySelectorAll(".skill-group")].map(g => ({
    group: g.dataset.group, skills: [...g.querySelectorAll(".skill-roll")].map(b => b.dataset.skill)
  }));
  check(`operative ${mode}: Survivalism, Lock Picking and Paraphysics are Knowledge (Johnald, 2026-10-07)`,
    ["survival", "lockpicking", "paraphysics"].every(k => grouped.find(g => g.group === "knowledge").skills.includes(k))
      && grouped.map(g => `${g.group} ${g.skills.length}`).join() === "physical 4,social 4,knowledge 14");
  const allSkills = grouped.flatMap(g => g.skills);
  check(`operative ${mode}: all 22 skills shown once each`,
    allSkills.length === 22 && new Set(allSkills).size === 22 && Object.keys(operative.system.skills).every(k => allSkills.includes(k)));
  check(`operative ${mode}: each skill sits in its configured group, alphabetical`,
    grouped.every(g => g.skills.every(k => IROP.skills[k].group === g.group)
      && g.skills.join() === [...g.skills].sort((a, b) => IROP.skills[a].label.localeCompare(IROP.skills[b].label)).join()));
  check(`operative ${mode}: the skill is named Survivalism, Xenotechnology in full (Johnald, 2026-10-07)`,
    mainDoc.querySelector('.skill-roll[data-skill="survival"] .skill-name')?.textContent === "Survivalism"
      && mainDoc.querySelector('.skill-roll[data-skill="xenotech"] .skill-name')?.textContent === "Xenotechnology");
  check(`operative ${mode}: the DYNOSRS hint sentence is gone`, !/click a skill to build its pool/.test(out.main));
  // Skill rows: name left aligned, its attribute in a small box right aligned (Johnald, 2026-10-07).
  const stealthRoll = new JSDOM(out.main).window.document.querySelector('.skill-roll[data-skill="stealth"]');
  check(`operative ${mode}: a skill shows its name, then its attribute box with the modifier in the tooltip`,
    [...stealthRoll.children].map(el => el.className).join() === "skill-name,attr"
      && stealthRoll.querySelector(".attr").textContent === "AGI"
      && stealthRoll.querySelector(".attr").dataset.tooltip === `Uses the Agility modifier, ${operative.system.attributes.agi.mod}`,
    stealthRoll?.outerHTML);
  // Carried weight in the header under Background, so it shows on every tab (Johnald, 2026-10-09).
  const derivedLabels = [...new JSDOM(out.main).window.document.querySelectorAll(".derived > .stat > .mono-label")].map(el => el.textContent.trim());
  check(`operative ${mode}: no Carry box on the Attributes tab`, !derivedLabels.some(l => /^Carry/.test(l)) && !out.main.includes("system.carry.max"), derivedLabels.join());
  const head = new JSDOM(out.header).window.document;
  const carry = head.querySelector(".identity .carry-line");
  check(`operative ${mode}: Carried in the header, right under Background, with the weight, a bar and how it is worked out`,
    carry?.querySelector(".carry-value").textContent.replace(/\s+/g, " ").trim() === `${operative.system.carry.value} / ${operative.system.carry.max}`
      && /30 \+ 2 x STR mod \+ TGH mod/.test(carry.dataset.tooltip) && !!carry.querySelector(".carry-meter .fill")
      && carry.previousElementSibling?.classList.contains("identity-list") && /Background/.test(carry.previousElementSibling.lastElementChild.textContent)
      && !out.gear.includes("carry-bar"));
  // Attribute ranks show in both modes (Johnald, 2026-10-06), locked outside edit mode.
  const attrs = [...new JSDOM(out.main).window.document.querySelectorAll(".attribute")];
  const per = attrs.find(el => el.querySelector('[data-attribute="per"]'));
  const perPips = [...per.querySelectorAll('.advance-pips [data-action="setAdvance"]')];
  check(`operative ${mode}: every attribute shows its six rank pips`,
    attrs.length === 7 && attrs.every(el => el.querySelectorAll(".advance-pips .pip").length === 6));
  check(`operative ${mode}: PER shows its ${operative.system.attributes.per.advances} ranks filled`,
    perPips.filter(p => p.classList.contains("filled")).length === operative.system.attributes.per.advances);
  // RULED 2026-10-08: in Play mode only the next pip up can be clicked, to buy it with XP.
  check(`operative ${mode}: rank pips ${editMode ? "editable" : "locked, except the next one, which is for sale"}`,
    editMode ? perPips.every(p => !p.disabled)
      : perPips.every(p => p.disabled === (Number(p.dataset.rank) !== operative.system.attributes.per.advances + 1)));
  // Each box names its attribute above the score, and the score's tens (the modifier) are split out for the role color.
  check(`operative ${mode}: each box names its attribute above the score`,
    attrs.every(el => el.querySelector(".attr-roll").firstElementChild.matches(".name"))
      && attrs.map(el => el.querySelector(".attr-roll .name").textContent).join() === Object.values(operative.system.attributes).map(a => a.label).join());
  check(`operative ${mode}: the tens are the modifier, the whole still reads as the score`,
    Object.values(operative.system.attributes).every((a, i) => {
      const score = attrs[i].querySelector(".attr-roll .score");
      return (score.querySelector(".tens").textContent === String(a.mod)) && !!score.querySelector(".ones")
        && (score.textContent === String(a.value));
    }));
  // Boons glow in ODR Silver instead of a small "boon +10" note (Johnald, 2026-10-06).
  const boonKeys = Object.entries(operative.system.attributes).filter(([, a]) => a.boons).map(([k]) => k);
  const lit = attrs.filter(el => el.querySelector(".attr-roll.boon")).map(el => el.querySelector(".attr-roll").dataset.attribute);
  check(`operative ${mode}: exactly the boosted attributes glow`, boonKeys.length > 0 && lit.join() === boonKeys.join(), `${lit} vs ${boonKeys}`);
  check(`operative ${mode}: the boon is named in the tooltip, not printed under the box`,
    lit.every(k => /Boon \+10/.test(out.main.match(new RegExp(`data-attribute="${k}"[^>]*`))[0])) && !/boon \+\d/.test(out.main) && !out.main.includes("attr-breakdown"));
  if ( editMode ) {
    check("edit mode: a bonus box per speed",
      ["shift", "run", "sprint"].every(k => out.main.includes(`name="system.bonuses.move.${k}"`)) && !/bonuses\.move\.(half|full)/.test(out.main));
    check("edit mode exposes attribute bases", out.main.includes("system.attributes.per.base"));
    check("edit mode rank pips enabled", !/data-action="setRank"[^>]*disabled/.test(out.main));
  }
  else {
    check("play mode rank pips disabled", /data-action="setRank"[^>]*disabled/.test(out.main));
    // Free slots: pistol 3 less the Red Dot, sword 2 (melee), Kevlar 4 (medium).
    // Pistol 3 less the Red Dot, sword 2, Kevlar 4, and one each for the three special weapons.
    check("pistol has a fitted Red Dot; free slots 2 + 2 + 4 + 1 + 1 + 1",
      out.combat.includes("Red Dot") && (out.combat.match(/class="mod-slot"/g) ?? []).length === 2 + 2 + 4 + 1 + 1 + 1,
      `slots ${(out.combat.match(/class="mod-slot"/g) ?? []).length}`);
    check("loose mod listed on gear", out.gear.includes("Ceramic Plate") && !out.gear.includes(">Red Dot<"));
    check("bleeding status active", /class="status active"[^>]*data-status="bleeding"/.test(out.combat));
    // Since 2026-10-06 the upgraded dice are Skill (d12) and the rest Aptitude (d10).
    check("awareness rank 4 at PER mod 6 shows 3 Skill + 1 Aptitude",
      (out.main.match(/die-skill/g) ?? []).length >= 3);
  }
}

// Special ammo: dropping ammunition on a ranged weapon loads it and takes out what it held; a melee weapon refuses.
{
  const sheet = new OperativeSheet(operative);
  const sent = [];
  const ap = operative.items.get("cryo");
  ap.update = data => { sent.push(["cryo", data]); return data; };
  const pistol = operative.items.get("pistol");
  pistol.update = data => { sent.push(["pistol", data]); return data; };
  const incendiary = { id: "incendiary", type: "gear", name: "Incendiary Rounds", parent: { uuid: operative.uuid },
    system: { kind: "ammunition" }, update: data => { sent.push(["incendiary", data]); return data; } };
  const onto = id => ({ target: { closest: sel => (sel === "[data-mod-host]" ? { dataset: { modHost: id } } : null) } });
  const warned = [];
  const oldUi = globalThis.ui;
  globalThis.ui = { notifications: { warn: m => warned.push(m), info: m => warned.push(m) } };
  await sheet._onDropItem(onto("pistol"), incendiary);
  check("special ammo: dropping it on a ranged weapon loads it, unloading the old",
    JSON.stringify(sent) === JSON.stringify([["cryo", { "system.loadedIn": "" }], ["pistol", { "system.ammo.value": pistol.system.ammo.max }],
      ["incendiary", { "system.loadedIn": "pistol", "system.stowed": false }]]),
    JSON.stringify(sent));
  sent.length = 0;
  const swordId = operative.items.find(i => i.name === "Survival Sword").id;
  await sheet._onDropItem(onto(swordId), incendiary);
  check("special ammo: a melee weapon refuses it with a reason", !sent.length && /Only ranged weapons take special ammo/.test(warned[0] ?? ""));
  await IropActorSheet.DEFAULT_OPTIONS.actions.unloadAmmo.call(sheet, {}, { dataset: { ammoId: "cryo" } });
  check("special ammo: unloading empties the slot", JSON.stringify(sent) === JSON.stringify([["cryo", { "system.loadedIn": "" }]]));

  // RULED 2026-10-08: quantity counts magazines; a reload spends the loaded one, the last one deletes the item.
  const atPistol = { closest: () => ({ dataset: { itemId: "pistol" } }) };
  sent.length = 0;
  await IropActorSheet.DEFAULT_OPTIONS.actions.reload.call(sheet, {}, atPistol);
  check("special ammo: a reload spends one magazine, empties the slot, then refills standard rounds",
    JSON.stringify(sent) === JSON.stringify([["cryo", { "system.quantity": 2, "system.loadedIn": "" }], ["pistol", { "system.ammo.value": pistol.system.ammo.max }]]),
    JSON.stringify(sent));
  let deleted = false;
  ap.delete = async () => { deleted = true; };
  ap.system.quantity = 1;
  sent.length = 0;
  await IropActorSheet.DEFAULT_OPTIONS.actions.reload.call(sheet, {}, atPistol);
  check("special ammo: reloading out of the last magazine deletes it", deleted && (sent.length === 1) && (sent[0][0] === "pistol"), JSON.stringify(sent));
  check("special ammo: the reload says what was spent", warned.some(m => /Cryo Rounds spent, none left/.test(m)));
  ap.system.quantity = 3;
  delete ap.delete;

  // While loaded, Cryo Rounds turn the pistol's damage Cold and carry Frostbite (2) on hit.
  const { attackProfile } = await import("../module/rolls.mjs");
  const prof = attackProfile(pistol);
  check("special ammo: the attack's damage turns Cold and carries Frostbite (2)",
    prof.damage.type === "cold" && prof.damage.status?.id === "frostbite" && prof.damage.status.value === 2 && prof.ammo?.name === "Cryo Rounds",
    JSON.stringify(prof.damage));
  globalThis.ui = oldUi;
  delete ap.update;
  delete pistol.update;
  const rifleman = makeActor("operative", OperativeData, {}, [
    { type: "weapon", name: "T1 Assault Rifle", id: "rifle", system: { category: "ranged", weaponClass: "rifles", modSlots: 0 } }]);
  const { out: rifleOut } = await renderSheet(OperativeSheet, rifleman);
  const emptySlot = new JSDOM(rifleOut.combat).window.document.querySelector('.weapon-row[data-item-id="rifle"] .ammo-slot');
  check("special ammo: an empty slot is a button to choose ammo, shown even with no mod slots",
    emptySlot?.tagName === "BUTTON" && emptySlot.dataset.action === "chooseAmmo" && /Special ammo/.test(emptySlot.textContent));
}

// An empty mod slot opens a picker of the loose mods that fit (Johnald, 2026-10-11: a loose mod on the
// Gear tab could not be dragged to a weapon on the Combat tab).
{
  const armory = makeActor("operative", OperativeData, {}, [
    { type: "weapon", name: "T2 Pistol", id: "pistol", system: { category: "ranged", weaponClass: "pistols", modSlots: 3 } },
    { type: "weapon", name: "Survival Sword", id: "sword", system: { category: "melee", weaponClass: "blades", modSlots: 1 } },
    { type: "mod", name: "Laser Sight", id: "laser", system: { target: "ranged", installedOn: "pistol" } },
    { type: "mod", name: "Laser Sight", id: "laser2", system: { target: "ranged" } },
    { type: "mod", name: "Red Dot", id: "dot", system: { target: "ranged" } },
    { type: "mod", name: "Scope", id: "scope", system: { target: "ranged", stowed: true } },
    { type: "mod", name: "Ceramic Plate", id: "plate", system: { target: "armor" } }
  ]);
  const api = foundry.applications.api;
  const realInput = api.DialogV2.input;
  const oldUi = globalThis.ui;
  const said = [];
  globalThis.ui = { notifications: { warn: m => said.push(m), info: m => said.push(m) } };
  const asked = [];
  api.DialogV2.input = async opts => { asked.push(opts); return { mod: "dot" }; };
  const updates = [];
  for ( const item of armory.items ) item.update = async data => { updates.push([item.id, data]); return item; };
  const sheet = new OperativeSheet(armory);
  const at = id => ({ closest: () => ({ dataset: { itemId: id } }) });
  await IropActorSheet.DEFAULT_OPTIONS.actions.chooseMod.call(sheet, {}, at("pistol"));
  const offered = [...new JSDOM(asked[0]?.content ?? "").window.document.querySelectorAll("option")].map(o => o.value);
  check("mod picker: a pistol's empty slot offers the loose ranged mods, not one it already has, a stowed one, or armor's",
    offered.join() === "dot" && /Fit a mod to T2 Pistol/.test(asked[0]?.window?.title ?? ""), offered.join());
  check("mod picker: the chosen mod is fitted", JSON.stringify(updates) === JSON.stringify([["dot", { "system.installedOn": "pistol" }]]),
    JSON.stringify(updates));
  asked.length = 0;
  await IropActorSheet.DEFAULT_OPTIONS.actions.chooseMod.call(sheet, {}, at("sword"));
  check("mod picker: with no loose mod that fits, it says what the weapon takes, and asks nothing",
    !asked.length && /None of Test Operative's loose mods fit Survival Sword, which takes melee weapon mods/.test(said.at(-1) ?? ""), said.at(-1));
  const bare = makeActor("operative", OperativeData, {}, [
    { type: "weapon", name: "T2 Pistol", id: "pistol", system: { category: "ranged", weaponClass: "pistols", modSlots: 1 } }]);
  await IropActorSheet.DEFAULT_OPTIONS.actions.chooseMod.call(new OperativeSheet(bare), {}, at("pistol"));
  check("mod picker: with no loose mods at all, it says where they wait", /carries no loose mods\. They wait on the Gear tab/.test(said.at(-1) ?? ""), said.at(-1));
  const { out } = await renderSheet(OperativeSheet, armory);
  const slot = new JSDOM(out.combat).window.document.querySelector('.weapon-row[data-item-id="pistol"] .mod-tray .mod-slot');
  check("mod picker: an empty mod slot is a button that opens it, and still says a mod can be dragged there",
    slot?.tagName === "BUTTON" && slot.dataset.action === "chooseMod" && /click to fit a loose mod, or drag one here/.test(slot.dataset.tooltip ?? ""));
  api.DialogV2.input = realInput;
  globalThis.ui = oldUi;
}

// Launchers (RULED 2026-10-08): load a grenade from the stack, fire it with its own damage, unload it back.
{
  const sheet = new OperativeSheet(operative);
  const sent = [];
  const gl = operative.items.get("gl");
  const frag = operative.items.get("frag");
  const rpg = operative.items.get("rpg");
  gl.update = data => { sent.push(["gl", data]); return data; };
  frag.update = data => { sent.push(["frag", data]); return data; };
  // Stand ins for the dragged items: owned by the operative, as a drag from its own sheet would be.
  const owned = (item, key) => ({ id: item.id, type: item.type, name: item.name, img: "x.svg", system: item.system,
    parent: { uuid: operative.uuid }, toObject: () => ({ name: item.name, img: "x.svg", system: { ...item.system._source } }),
    update: data => { sent.push([key, data]); return data; } });
  const fragDrop = owned(frag, "frag");
  const rpgDrop = owned(rpg, "rpg");
  const onto = id => ({ target: { closest: sel => (sel === "[data-mod-host]" ? { dataset: { modHost: id } } : null) } });
  const warned = [];
  const oldUi = globalThis.ui;
  globalThis.ui = { notifications: { warn: m => warned.push(m), info: m => warned.push(m) } };
  await sheet._onDropItem(onto("gl"), fragDrop);
  const loadedNow = sent.find(([k]) => k === "gl")?.[1]["system.loaded"];
  check("launcher: dropping a grenade loads a copy into the next slot and takes one from the stack",
    loadedNow?.length === 2 && loadedNow[1].name === "Frag Grenade" && loadedNow[1].system.quantity === 1
      && JSON.stringify(sent.find(([k]) => k === "frag")?.[1]) === JSON.stringify({ "system.quantity": 1 }), JSON.stringify(sent));
  // Loading the last grenade leaves none behind in Explosives (2026-10-08).
  sent.length = 0;
  const lastFrag = { id: "frag", type: "weapon", name: "Frag Grenade", img: "x.svg", parent: { uuid: operative.uuid },
    system: { weaponClass: "grenade", quantity: 1 },
    toObject: () => ({ name: "Frag Grenade", img: "x.svg", system: { weaponClass: "grenade", quantity: 1 } }),
    update: data => { sent.push(["frag", data]); return data; }, delete: async () => { sent.push(["frag", "deleted"]); } };
  await sheet._onDropItem(onto("gl"), lastFrag);
  check("launcher: loading the last grenade removes it from the sheet",
    sent.some(([k, d]) => (k === "frag") && (d === "deleted")) && !sent.some(([k, d]) => (k === "frag") && (typeof d === "object")),
    JSON.stringify(sent));
  sent.length = 0;
  await sheet._onDropItem(onto("gl"), rpgDrop);
  check("launcher: a grenade launcher refuses a rocket", !sent.length && /loads grenades, and RPG is not one/.test(warned.at(-1) ?? ""));
  await sheet._onDropItem(onto("pistol"), fragDrop);
  check("launcher: a magazine weapon takes no grenades", /does not load grenades or rockets/.test(warned.at(-1) ?? ""));
  sent.length = 0;
  await IropActorSheet.DEFAULT_OPTIONS.actions.unloadProjectile.call(sheet, {}, { closest: () => ({ dataset: { itemId: "gl" } }), dataset: { slot: "0" } });
  check("launcher: unloading returns the grenade to its stack",
    JSON.stringify(sent) === JSON.stringify([["gl", { "system.loaded": [] }], ["frag", { "system.quantity": 3 }]]), JSON.stringify(sent));
  const { attackProfile, addDice, burnOutcome } = await import("../module/rolls.mjs");
  const shot = attackProfile(gl, { projectile: 0 });
  check("launcher: a launched grenade brings its own damage and blast, and scatters as launched",
    shot.damage?.formula === "2d4 + 1" && shot.damage.blast === 2 && shot.projectile?.name === "Frag Grenade" && shot.scatter === "launched",
    JSON.stringify(shot.damage));
  check("launcher: an empty slot has nothing to fire", attackProfile(gl, { projectile: 3 }).projectile === null);
  check("chemthrower: each burn past the first adds a die", addDice("2d4 + 2", 2) === "4d4 + 2" && addDice("d6", 1) === "2d6"
    && addDice("2d4 + 2", 0) === "2d4 + 2");
  const failed = burnOutcome({ label: "Flame Chemthrower", typeLabel: "Fire", target: "GENESIS Trooper", full: 9, failed: true,
    status: { id: "ignited", value: 3 } });
  const saved = burnOutcome({ label: "Flame Chemthrower", typeLabel: "Fire", target: "GENESIS Trooper", full: 9, failed: false,
    status: { id: "ignited", value: 3 } });
  check("chemthrower: a failed save takes it all and the status, with Apply; a save takes half, no status",
    /fails: takes <strong>9<\/strong> Fire and gains <strong>Ignited \(3\)<\/strong>/.test(failed) && /data-irop-action="applyStatus"/.test(failed)
      && /saves: takes <strong>4<\/strong> Fire \(half\), no status/.test(saved) && !/applyStatus/.test(saved));
  globalThis.ui = oldUi;
  for ( const i of [gl, frag] ) delete i.update;
}

// Johnald, 2026-10-10: grenades, rockets and the LAW dragged from the sidebar join the stack of
// the same name; the count is typed in on the Combat tab.
{
  const sheet = new OperativeSheet(operative);
  const sent = [];
  const keyed = { frag: operative.items.get("frag"), rpg: operative.items.get("rpg"), law: operative.items.get("law") };
  for ( const [k, i] of Object.entries(keyed) ) i.update = data => { sent.push([k, data]); return data; };
  const before = Object.fromEntries(Object.entries(keyed).map(([k, i]) => [k, i.system.quantity]));
  const fromSidebar = (name, system) => ({ id: "world1", type: "weapon", name, img: "x.svg", parent: null, system,
    toObject: () => ({ name, img: "x.svg", system }) });
  const nowhere = { target: { closest: () => null } };
  await sheet._onDropItem(nowhere, fromSidebar("Frag Grenade", { weaponClass: "grenade", category: "thrown", quantity: 1 }));
  await sheet._onDropItem(nowhere, fromSidebar("RPG", { weaponClass: "rocket", category: "explosive", quantity: 2 }));
  await sheet._onDropItem(nowhere, fromSidebar("LAW", { weaponClass: "launcher", feed: "singleUse", quantity: 1 }));
  check("stacking: a grenade, a rocket and a LAW from the sidebar join the stacks of the same name",
    JSON.stringify(sent) === JSON.stringify([["frag", { "system.quantity": before.frag + 1 }], ["rpg", { "system.quantity": before.rpg + 2 }],
      ["law", { "system.quantity": before.law + 1 }]]), JSON.stringify(sent));
  sent.length = 0;
  const pistol = await sheet._onDropItem(nowhere, fromSidebar("T1 Pistol", { weaponClass: "smallArms", category: "ranged", quantity: 1 }));
  check("stacking: a second pistol is its own item, mods and ammo of its own", (pistol?.created === "T1 Pistol") && !sent.length);
  for ( const i of Object.values(keyed) ) delete i.update;

  const { out } = await renderSheet(OperativeSheet, operative);
  const combat = new JSDOM(out.combat).window.document;
  const countIn = id => combat.querySelector(`[data-item-id="${id}"] .item-stat.count input[data-item-field="system.quantity"]`);
  check("stacking: grenades, rockets and the LAW have their count to type in on the Combat tab; a pistol has none",
    (countIn("frag")?.value === String(before.frag)) && (countIn("rpg")?.value === String(before.rpg)) && (countIn("law")?.value === String(before.law))
      && (countIn("frag").getAttribute("min") === "0") && !countIn("pistol")
      && /Single use/.test(countIn("law").closest(".item-stat").textContent) && /Count/.test(countIn("rpg").closest(".item-stat").textContent));
  check("stacking: a count typed in is a whole number, never below none",
    /if \( input\.dataset\.itemField === "system\.quantity" \) value = Math\.max\(0, Math\.round\(value\) \|\| 0\);/
      .test(fs.readFileSync(path.join(ROOT, "module/sheets/actor-sheet.mjs"), "utf8")));
}

// Mods follow their host, on the real items (bug report, 2026-10-08): the Red Dot works while the pistol is
// equipped, stops when it is put down or stowed; the loose Ceramic Plate does nothing.
{
  const { itemEffectsSuppressed } = await import("../module/rules/effects.mjs");
  const redDot = operative.items.find(i => i.name === "Red Dot");
  const plate = operative.items.find(i => i.name === "Ceramic Plate");
  const pistolSys = operative.items.get("pistol").system;
  const was = { equipped: pistolSys.equipped, stowed: pistolSys.stowed };
  const on = itemEffectsSuppressed(redDot) === false;
  pistolSys.equipped = false;
  const offUnequipped = itemEffectsSuppressed(redDot) === true;
  Object.assign(pistolSys, { equipped: true, stowed: true });
  const offStowed = itemEffectsSuppressed(redDot) === true;
  Object.assign(pistolSys, was);
  check("mods on real items: the Red Dot works on the equipped pistol, not once it is put down or stowed",
    on && offUnequipped && offStowed && redDot.system.host?.id === "pistol");
  check("mods on real items: a loose mod does nothing", itemEffectsSuppressed(plate) === true);
}

// XP (RULED 2026-10-08): Play mode buys the next pip; a GM awards and undoes; the Dossier shows the ledger.
{
  const api = foundry.applications.api;
  const realConfirm = api.DialogV2.confirm, realInput = api.DialogV2.input, oldUser = game.user, oldUi = globalThis.ui;
  const sent = [];
  const warned = [];
  globalThis.ui = { notifications: { warn: m => warned.push(m), info: m => warned.push(m) } };
  operative.update = data => { sent.push(data); return data; };
  api.DialogV2.confirm = async () => true;
  const sheet = new OperativeSheet(operative);
  const skill = Object.entries(operative.system.skills).find(([, s]) => s.rank === 0)[0];
  await IropActorSheet.DEFAULT_OPTIONS.actions.setRank.call(sheet, {}, { dataset: { skill, rank: "1" } });
  check("xp: in Play mode the next skill pip is bought for its cost and logged",
    sent[0]?.[`system.skills.${skill}.rank`] === 1 && sent[0]["system.xp.log"].at(-1).xp === 20
      && sent[0]["system.xp.log"].at(-1).kind === "skill" && sent[0]["system.xp.log"].at(-1).rank === 1, JSON.stringify(sent[0]));
  sent.length = 0;
  await IropActorSheet.DEFAULT_OPTIONS.actions.setRank.call(sheet, {}, { dataset: { skill, rank: "3" } });
  check("xp: skipping ahead buys nothing", !sent.length);
  const perNext = operative.system.attributes.per.advances + 1;
  await IropActorSheet.DEFAULT_OPTIONS.actions.setAdvance.call(sheet, {}, { dataset: { attribute: "per", rank: String(perNext) } });
  check("xp: the next attribute pip costs its table price",
    sent[0]?.["system.xp.log"]?.at(-1).xp === [10, 20, 40, 60, 80, 100][perNext - 1], JSON.stringify(sent[0]));
  sent.length = 0;
  // A GM awards XP, and can undo a purchase: refund and the rank comes off.
  game.user = { isGM: true };
  api.DialogV2.input = async () => ({ xp: "30", label: "OP-009 debrief" });
  await IropActorSheet.DEFAULT_OPTIONS.actions.awardXp.call(sheet);
  check("xp: a GM award raises Earned and is logged",
    sent[0]?.["system.xp.earned"] === operative.system.xp.earned + 30 && sent[0]["system.xp.log"].at(-1).kind === "award"
      && sent[0]["system.xp.log"].at(-1).label === "OP-009 debrief");
  sent.length = 0;
  const logged = { kind: "skill", label: "Stealth rank 2", xp: 40, ref: "stealth", rank: operative.system.skills.stealth.rank, date: "" };
  operative.system._source.xp.log.push(logged);
  await IropActorSheet.DEFAULT_OPTIONS.actions.refundXp.call(sheet, {}, { closest: () => ({ dataset: { logIndex: "0" } }) });
  check("xp: a GM undo removes the entry and takes the rank back off",
    sent[0]?.["system.xp.log"]?.length === 0 && sent[0][`system.skills.stealth.rank`] === logged.rank - 1, JSON.stringify(sent[0]));
  operative.system._source.xp.log.length = 0;
  // The Dossier: Earned, Spent, Unspent and the ledger; the Award button for a GM only.
  operative.system.xp.log = [{ kind: "award", label: "OP-009 debrief", xp: 30, date: "2026-10-08" }, { kind: "skill", label: "Stealth rank 1", xp: 20, date: "2026-10-08" }];
  let { out } = await renderSheet(OperativeSheet, operative);
  let dossier = new JSDOM(out.bio).window.document;
  check("dossier: the XP strip and the ledger, newest first, with the GM's controls",
    [...dossier.querySelectorAll(".xp-bar .xp-stat .mono-label")].map(l => l.textContent).join() === "Earned,Spent,Unspent"
      && dossier.querySelector(".xp-bar .xp-meter-fill")?.getAttribute("style") === `width: ${Math.round(100 * operative.system.xp.spent / operative.system.xp.earned)}%`
      && !!dossier.querySelector('.xp-bar [data-action="awardXp"]')
      && [...dossier.querySelectorAll(".xp-entry .xp-amount")].map(a => a.textContent).join() === "-20,+30"
      && !!dossier.querySelector('[data-action="awardXp"]') && dossier.querySelectorAll('[data-action="refundXp"]').length === 2);
  game.user = { isGM: false };
  ({ out } = await renderSheet(OperativeSheet, operative));
  dossier = new JSDOM(out.bio).window.document;
  check("dossier: a player sees the ledger but no Award or undo", !dossier.querySelector('[data-action="awardXp"], [data-action="refundXp"]'));
  operative.system.xp.log = [];
  check("dossier: a buyable pip shows its price", /data-tooltip="Buy rank 1: 20 XP"/.test(out.main));
  delete operative.update;
  api.DialogV2.confirm = realConfirm;
  api.DialogV2.input = realInput;
  game.user = oldUser;
  globalThis.ui = oldUi;
}

// Free starting skills (2026-10-08): picked once per role and background, from the Dossier button or on drop.
{
  const api = foundry.applications.api;
  const realInput = api.DialogV2.input, oldUser = game.user, oldUi = globalThis.ui;
  const recruit = makeActor("operative", OperativeData, {}, [
    { type: "role", name: "Marauder", id: "marauder", system: { role: "marauder", startingSkills: "Awareness, Athletics or Survivalism" } },
    { type: "background", name: "Survivalist", id: "survivalist",
      system: { startingSkills: "Survival, Awareness, Mechanics, Technology, Stealth, Medical", skillPicks: 3 } }
  ]);
  const sent = [];
  recruit.update = data => { sent.push(data); return data; };
  const warned = [];
  globalThis.ui = { notifications: { warn: m => warned.push(m), info: m => warned.push(m) } };
  game.user = { isGM: true };
  const sheet = new OperativeSheet(recruit);
  let shown = "";
  api.DialogV2.input = async ({ content }) => { shown = content; return { "skill.athletics": true }; };
  await IropActorSheet.DEFAULT_OPTIONS.actions.pickStartingSkills.call(sheet, {}, { dataset: { source: "role" } });
  check("starting skills: the role's first skill is free (the Marauder's Awareness) and one of the other two is picked",
    /Free: <strong>Awareness<\/strong>/.test(shown) && sent[0]?.["system.skills.athletics.rank"] === 1
      && sent[0]["system.skills.awareness.rank"] === 1 && sent[0]["system.details.startingSkills.role"] === "Marauder", JSON.stringify(sent[0]));
  sent.length = 0;
  api.DialogV2.input = async () => ({ "skill.awareness": true, "skill.stealth": true });
  await IropActorSheet.DEFAULT_OPTIONS.actions.pickStartingSkills.call(sheet, {}, { dataset: { source: "background" } });
  check("starting skills: too few picks takes nothing and says why", !sent.length && /Pick 3 from Survivalist/.test(warned.at(-1) ?? ""));
  api.DialogV2.input = async () => ({ "skill.awareness": true, "skill.stealth": true, "skill.medical": true });
  await IropActorSheet.DEFAULT_OPTIONS.actions.pickStartingSkills.call(sheet, {}, { dataset: { source: "background" } });
  check("starting skills: three picks from the background, each up a rank",
    sent[0]?.["system.skills.stealth.rank"] === 1 && sent[0]["system.skills.medical.rank"] === 1
      && sent[0]["system.details.startingSkills.background"] === "Survivalist", JSON.stringify(sent[0]));
  // Once taken, the slot is not offered again; the Dossier says so, and a GM can reset it in Edit mode.
  recruit.system.details.startingSkills.role = "Marauder";
  sent.length = 0;
  await IropActorSheet.DEFAULT_OPTIONS.actions.pickStartingSkills.call(sheet, {}, { dataset: { source: "role" } });
  check("starting skills: a slot already taken is not offered again", !sent.length);
  const { out } = await renderSheet(OperativeSheet, recruit, { editMode: true });
  const chips = new JSDOM(out.header).window.document;
  const chip = id => chips.querySelector(`.identity-list .identity-row[data-item-id="${id}"]`);
  check("starting skills: in Edit mode the header list carries them: a GM reset on the taken role, Pick on the open background",
    /Starting skills taken/.test(chip("marauder")?.querySelector('[data-action="resetStartingSkills"][data-source="role"]')?.dataset.tooltip ?? "")
      && !!chip("survivalist")?.querySelector('[data-action="pickStartingSkills"][data-source="background"]')
      && !!chip("marauder").querySelector('[data-action="deleteItem"]') && !!chip("marauder").querySelector('a[data-action="editItem"]'));
  check("identity: the Training tab no longer repeats Role, Species and Background", !/identity-card/.test(out.bio));
  const play = new JSDOM((await renderSheet(OperativeSheet, recruit)).out.header).window.document;
  check("identity: in Play mode the list is just the names, no buttons",
    !play.querySelector(".identity-list .identity-btn") && play.querySelectorAll(".identity-list .identity-link").length === 2
      && /Drop a species/.test(play.querySelector(".identity-list").textContent));
  // Johnald, 2026-10-08: a labelled list, one to a line, not chips.
  const rows = [...play.querySelectorAll(".identity-list > .identity-row")];
  check("identity: Role, Species and Background, labelled, one to a line, the role marked",
    rows.map(r => r.querySelector("dt").textContent).join() === "Role,Species,Background" && rows[0].classList.contains("role")
      && rows[1].classList.contains("empty") && !play.querySelector(".chips, .chip"));
  await IropActorSheet.DEFAULT_OPTIONS.actions.resetStartingSkills.call(sheet, {}, { dataset: { source: "role" } });
  check("starting skills: a GM reset frees the slot", sent.at(-1)?.["system.details.startingSkills.role"] === "");
  api.DialogV2.input = realInput;
  game.user = oldUser;
  globalThis.ui = oldUi;
}

// Perk trees (RULED 2026-10-08): the editor on the tree item, the trees on the Dossier, buying perks.
{
  const api = foundry.applications.api;
  const realConfirm = api.DialogV2.confirm, realPrompt = api.DialogV2.prompt, oldUser = game.user, oldUi = globalThis.ui;
  const oldItems = game.items, oldUtils = foundry.utils;
  const world = {
    "Item.cs": { name: "Called Shot", img: "cs.svg", type: "ability", system: { kind: "active", energyCost: 4, description: "<p>Aim.</p>" } },
    "Item.hm": { name: "Hunter's Mark", img: "hm.svg", type: "ability", system: { kind: "passive", energyCost: 0, description: "<p>Mark.</p>" } },
    "Item.gs": { name: "Ghost Step", img: "gs.svg", type: "ability", system: { kind: "active", energyCost: 3, description: "<p>Step.</p>" } },
    "Item.sb": { name: "Shadowborn", img: "sb.svg", type: "ability", system: { kind: "passive", energyCost: 0, description: "<p>Shadows.</p>" } },
    "Item.sa": { name: "Strong Arm", img: "sa.svg", type: "ability", system: { kind: "passive", energyCost: 0, prerequisites: "Strength 50", description: "<p>Throw far.</p>" } }
  };
  for ( const a of Object.values(world) ) {
    a.toObject = () => ({ _id: "src", name: a.name, type: "ability", img: a.img, folder: "f1", sort: 5, ownership: { default: 0 },
      system: { ...a.system }, flags: {} });
  }
  foundry.utils = { ...oldUtils, fromUuidSync: uuid => world[uuid] ?? null, fromUuid: async uuid => world[uuid] ?? null };
  const makeTree = (id, name, system) => {
    const tree = new FakeDoc({});
    Object.assign(tree, { id, name, type: "skillTree", img: "tree.svg", uuid: `Item.${id}`, isOwner: true, effects: [] });
    tree.getRollData = () => ({});
    tree.system = new itemModels.SkillTreeData(system, { parent: tree });
    return tree;
  };
  const outriderTree = makeTree("t1", "Outrider", { role: "outrider", kind: "primary", tiers: [
    { exclusive: true, nodes: [{ id: "n1", uuid: "Item.cs", name: "Called Shot", xp: 10 }, { id: "n2", uuid: "Item.hm", name: "Hunter's Mark", xp: 10 }] },
    { exclusive: false, nodes: [{ id: "n3", uuid: "Item.gs", name: "Ghost Step", xp: 30 }] },
    { exclusive: false, nodes: [{ id: "n4", uuid: "Item.gone", name: "Lost Perk", img: "lost.svg", xp: 40 }] }
  ] });
  const generalTree = makeTree("t2", "Generalist Perks", { role: "", kind: "general", tab: "Generalist", gated: false, tiers: [
    { exclusive: false, nodes: [{ id: "g1", uuid: "", name: "Resilience (1)", xp: 20 }, { id: "g2", uuid: "", name: "Resilience (2)", xp: 30, requires: "g1" }] },
    { exclusive: false, nodes: [{ id: "g3", uuid: "Item.sa", name: "Strong Arm", xp: 20 }] }
  ] });
  const ghostTree = makeTree("t4", "Ghost", { role: "outrider", kind: "specialization", order: 1, tiers: [
    { exclusive: true, nodes: [{ id: "gh1", uuid: "Item.sb", name: "Shadowborn", xp: 20 }, { id: "gh2", uuid: "", name: "Ghost Stepping", xp: 30 }] }
  ] });
  const list = [makeTree("t3", "Legionary", { role: "legionary", kind: "primary" }), generalTree, ghostTree, outriderTree,
    makeTree("t5", "Pointman", { role: "legionary", kind: "specialization", order: 1, tiers: [
      { exclusive: false, nodes: [{ id: "pm1", uuid: "", name: "Clear the Room", xp: 20 }] }] }),
    makeTree("t6", "Sharpshooter", { role: "outrider", kind: "specialization", order: 2, tiers: [
      { exclusive: false, nodes: [{ id: "ss1", uuid: "", name: "Squadsight", xp: 20 }] }] })];
  list.get = id => list.find(t => t.id === id);
  game.items = list;
  game.user = { isGM: false };

  // A role's perk trees, on the role's own sheet (Johnald, 2026-10-17): read only, its Primary then its specializations.
  {
    const roleDoc = new FakeDoc({});
    Object.assign(roleDoc, { id: "ro", name: "Outrider", type: "role", img: "role.svg", uuid: "Item.ro", isOwner: true, effects: [], actor: null });
    roleDoc.getRollData = () => ({});
    roleDoc.system = new itemModels.RoleData({ role: "outrider" }, { parent: roleDoc });
    const roleSheet = new IropItemSheet(roleDoc);
    const { out: roleOut } = await renderSheet(IropItemSheet, roleDoc);
    const rt = new JSDOM(roleOut.trees ?? "").window.document;
    check("role trees: a role's sheet has a Perk trees tab: its Primary first, then its specializations, no General or other roles' trees",
      roleSheet._getTabsConfig("primary").tabs.some(t => t.id === "trees") && [...rt.querySelectorAll(".tree-tab")].map(e => e.textContent.trim()).join() === "Outrider,Ghost,Sharpshooter"
        && rt.querySelector(".tree-tab.active")?.dataset.treeId === "t1", [...rt.querySelectorAll(".tree-tab")].map(e => e.textContent.trim()).join());
    const primary = rt.querySelector('.tree-view[data-tree-id="t1"]');
    check("role trees: each tier's perks with their XP and kind, Pick one marked, a missing ability said so; every perk opens",
      [...primary.querySelectorAll(".perk-name")].map(e => e.textContent).join() === "Called Shot,Hunter's Mark,Ghost Step,Lost Perk"
        && /10 XP, Active/.test(primary.querySelector(".perk-sub").textContent) && /Pick one/.test(primary.querySelector(".tree-tier.exclusive .tier-label").textContent)
        && /Missing ability/.test(primary.querySelectorAll(".perk-sub")[3].textContent) && [...primary.querySelectorAll(".perk")].every(b => b.dataset.action === "openTreePerk"));
    check("role trees: a specialization says when it opens; a player gets no Edit button",
      /Opens at 300 XP earned, a second specialization at 900/.test(rt.querySelector('.tree-view[data-tree-id="t4"] .tree-note').textContent) && !rt.querySelector('[data-action="openTree"]'));
    const gearLike = new IropItemSheet(Object.assign(new FakeDoc({}), { id: "gx", name: "Rope", type: "ability", img: "x.svg", uuid: "Item.gx", isOwner: true, effects: [], actor: null }));
    check("role trees: only a role has the tab", !gearLike._getTabsConfig("primary").tabs.some(t => t.id === "trees"));
  }

  // The editor, on the tree item: the GM's (players never edit an item, 2026-10-10).
  {
    const playerUser = game.user;
    game.user = { isGM: true };
    const { out } = await renderSheet(IropItemSheet, outriderTree);
    for ( const [id, html] of Object.entries(out) ) inspect(`item skillTree ${id}`, html, { actions: ITEM_ACTIONS, source: outriderTree.system._source });
    const ed = new JSDOM(out.details).window.document;
    check("tree editor: no Effects tab on a tree", !("effects" in out) && !/data-tab="effects"/.test(out.tabs));
    const tiers = [...ed.querySelectorAll(".tree-tier-edit")];
    check("tree editor: a box per tier, Pick one ticked where set, the first tier cannot move up",
      tiers.length === 3 && tiers[0].querySelector('[data-tree-field="exclusive"]').checked && !tiers[1].querySelector('[data-tree-field="exclusive"]').checked
        && tiers[0].querySelector('[data-action="moveTier"][data-delta="-1"]').disabled && tiers[2].querySelector('[data-action="moveTier"][data-delta="1"]').disabled);
    const names = [...ed.querySelectorAll(".tree-node-edit .node-name")].map(a => a.textContent);
    check("tree editor: perks show their ability's name, a missing one its stored name, marked",
      names.join() === "Called Shot,Hunter's Mark,Ghost Step,Lost Perk" && ed.querySelector('[data-node-id="n4"]').classList.contains("missing"), names.join());
    const reqs = [...ed.querySelectorAll('[data-node-id="n3"] .node-requires option')].map(o => o.value);
    check("tree editor: a perk can require any other perk of the tree, not itself",
      reqs.join() === ",n1,n2,n4" && ed.querySelector('[data-node-id="n3"] [data-tree-field="xp"]').value === "30", reqs.join());
    check("tree editor: For, Kind, Tab name, Order and the gating switch",
      ed.querySelector('select[name="system.role"] option[value="outrider"][selected]') && ed.querySelector('select[name="system.kind"] option[value="primary"][selected]')
        && ed.querySelector('input[name="system.gated"]').checked && !!ed.querySelector('.tree-drop.new-tier [data-action="addTier"]'));
    const gen = new JSDOM((await renderSheet(IropItemSheet, generalTree)).out.details).window.document;
    game.user = playerUser;
    check("tree editor: a tree without tier gating has lines, not tiers (2026-10-08)",
      [...gen.querySelectorAll(".tree-tier-edit .tier-label")].map(l => l.textContent.trim()).join() === "Line 1,Line 2"
        && /^Tier 1$/.test(ed.querySelector(".tree-tier-edit .tier-label").textContent.trim()));
    check("tree editor: Everyone is the blank role; a prerequisite shows selected",
      gen.querySelector('select[name="system.role"] option[value=""][selected]')?.textContent === "Everyone"
        && gen.querySelector('[data-node-id="g2"] .node-requires option[value="g1"][selected]'));
    // Edits go to the tiers as a whole.
    const sent = [];
    outriderTree.update = data => { sent.push(data); return data; };
    const sheet = new IropItemSheet(outriderTree);
    const at = (el, extra = {}) => ({ closest: sel => el.closest(sel), dataset: { ...el.dataset, ...extra } });
    await IropItemSheet.DEFAULT_OPTIONS.actions.addTier.call(sheet);
    await IropItemSheet.DEFAULT_OPTIONS.actions.deleteNode.call(sheet, {}, at(ed.querySelector('[data-node-id="n2"] [data-action="deleteNode"]')));
    await IropItemSheet.DEFAULT_OPTIONS.actions.moveTier.call(sheet, {}, at(tiers[2].querySelector('[data-action="moveTier"][data-delta="-1"]')));
    check("tree editor: add a tier, take a perk out, move a tier",
      sent[0]["system.tiers"].length === 4 && sent[1]["system.tiers"][0].nodes.map(n => n.id).join() === "n1"
        && sent[2]["system.tiers"].map(t => t.nodes[0]?.id).join() === "n1,n4,n3", JSON.stringify(sent.map(x => x["system.tiers"].length)));
    delete outriderTree.update;
  }

  // The Dossier: the role's Primary and the Everyone trees.
  let { out } = await renderSheet(OperativeSheet, operative);
  let doc = new JSDOM(out.bio).window.document;
  const perk = id => doc.querySelector(`.perk[data-node-id="${id}"]`);
  const tabs = [...doc.querySelectorAll(".tree-tab")].map(a => a.textContent.trim());
  check("dossier trees: the role's Primary, its specializations, then the Everyone trees; no other role",
    tabs.join() === "Outrider,Ghost,Sharpshooter,Generalist", tabs.join());
  check("dossier trees: below 300 XP earned the specializations are locked, and say why",
    doc.querySelector('.tree-tab[data-tree-id="t4"]').classList.contains("locked")
      && /Specializations open at 300 XP earned/.test(doc.querySelector('.tree-view[data-tree-id="t4"] .tree-lock')?.textContent ?? "")
      && perk("gh1").classList.contains("locked") && !perk("gh1").classList.contains("buyable"));
  check("dossier trees: the first tab shows", doc.querySelector(".tree-tab.active")?.dataset.treeId === "t1"
    && doc.querySelector(".tree-view.active")?.dataset.treeId === "t1" && doc.querySelectorAll(".tree-view.active").length === 1);
  check("dossier trees: an ability already on the sheet counts as owned, and rules out its pair",
    perk("n1").classList.contains("owned") && perk("n2").classList.contains("excluded") && !perk("n2").classList.contains("buyable"));
  check("dossier trees: a Pick one tier says so, with 'or' between its perks",
    /Pick one/.test(doc.querySelector('.tree-view[data-tree-id="t1"] .tree-tier.exclusive .tier-label')?.textContent ?? "")
      && doc.querySelectorAll('.tree-view[data-tree-id="t1"] .tree-tier.exclusive .tier-or').length === 1);
  check("dossier trees: each perk reads its cost or Owned, its kind and energy",
    perk("n1").querySelector(".perk-sub").textContent === "Owned, Active, 4 EN" && perk("n3").querySelector(".perk-sub").textContent === "30 XP, Active, 3 EN",
    `${perk("n1").querySelector(".perk-sub").textContent} | ${perk("n3").querySelector(".perk-sub").textContent}`);
  check("dossier trees: the next tier can be bought, the one after is locked and says why",
    perk("n3").classList.contains("buyable") && perk("n4").classList.contains("locked") && perk("n4").dataset.tooltip === "Locked: take a perk from Tier 2 first");
  check("dossier trees: a missing ability keeps its stored name and image",
    perk("n4").querySelector(".perk-name").textContent === "Lost Perk" && perk("n4").querySelector("img").getAttribute("src") === "lost.svg");
  check("dossier trees: with gating off, rank 2 opens once rank 1 is owned",
    perk("g1").classList.contains("owned") && perk("g2").classList.contains("buyable"));
  // The Generalist perks have no tiers (Johnald, 2026-10-08): lines with arrows, then the single perks in a grid.
  const general = doc.querySelector('.tree-view[data-tree-id="t2"]');
  const line = general.querySelector(".tree-line");
  check("free form: no tier labels; a line of perks with an arrow to the one it opens",
    !general.querySelector(".tier-label, .tree-tier") && !!line && [...line.children].map(el => el.dataset.nodeId ?? el.className).join()
      === "g1,fa-solid fa-chevron-right line-arrow,g2", [...(line?.children ?? [])].map(el => el.dataset.nodeId ?? el.className).join());
  check("free form: a perk on its own sits in the grid below the lines", !!general.querySelector('.tree-singles .perk[data-node-id="g3"]'));
  check("free form: a written requirement the character lacks locks it and says so (Strength 50)",
    operative.system.attributes.str.value < 50 && perk("g3").classList.contains("locked") && perk("g3").dataset.tooltip === "Locked: needs Strength 50",
    perk("g3")?.dataset.tooltip);
  check("tiered trees keep their tiers", !!doc.querySelector('.tree-view[data-tree-id="t1"] .tree-tier .tier-label'));
  // Johnald, 2026-10-08: a perk locked by unmet requirements wears a lock on its icon; nothing else does.
  check("requirement lock: the perk short of Strength 50 has a lock on its icon; open, owned and tier locked ones none",
    !!perk("g3").querySelector(".perk-icon .perk-lock") && perk("g3").classList.contains("unmet")
      && doc.querySelectorAll(".perk-lock").length === 1 && !perk("g2").querySelector(".perk-lock") && !perk("n4").querySelector(".perk-lock"));
  {
    // Johnald, 2026-10-08: waiting on the perk before it counts as a requirement too.
    const fresh = makeActor("operative", OperativeData, {}, [{ type: "role", name: "Outrider", system: { role: "outrider" } }]);
    const fd = new JSDOM((await renderSheet(OperativeSheet, fresh)).out.bio).window.document;
    const fp = id => fd.querySelector(`.perk[data-node-id="${id}"]`);
    check("requirement lock: a perk waiting on the one before it in its line wears the lock too",
      !!fp("g2").querySelector(".perk-lock") && fp("g2").classList.contains("locked") && !fp("g1").querySelector(".perk-lock"));
  }

  // Buying.
  const created = [], sent = [], warned = [];
  let dialog = "";
  globalThis.ui = { notifications: { warn: m => warned.push(m), info: m => warned.push(m) } };
  operative.createEmbeddedDocuments = async (type, data) => { created.push(...data); return data; };
  operative.update = data => { sent.push(data); return data; };
  api.DialogV2.confirm = async ({ content, yes }) => { dialog = `${content}|${yes.label}`; return true; };
  api.DialogV2.prompt = async ({ content }) => { dialog = content; return true; };
  const sheet = new OperativeSheet(operative);
  const click = el => IropActorSheet.DEFAULT_OPTIONS.actions.perkNode.call(sheet, {}, el);
  await click(perk("n3"));
  const bought = created[0];
  check("buy: a perk costs its XP; the character gets its own copy of the ability, marked with tree and node",
    /\|Buy for 30 XP$/.test(dialog) && /<p>Step\.<\/p>/.test(dialog) && bought?.name === "Ghost Step"
      && !["_id", "folder", "sort", "ownership"].some(k => k in bought) && bought.flags.irop.perk.node === "n3" && bought.flags.irop.perk.tree === "t1", dialog);
  check("buy: and the ledger records it",
    sent[0]?.["system.xp.log"]?.at(-1)?.kind === "perk" && sent[0]["system.xp.log"].at(-1).xp === 30 && sent[0]["system.xp.log"].at(-1).ref === "n3"
      && sent[0]["system.xp.log"].at(-1).label === "Ghost Step (Outrider)", JSON.stringify(sent[0]));
  created.length = 0;
  sent.length = 0;
  await click(perk("n4"));
  check("buy: a locked perk shows why and buys nothing", !created.length && !sent.length
    && /Locked: take a perk from Tier 2 first/.test(dialog) && /missing from the world/.test(dialog));
  let opened = false;
  const calledShot = operative.items.find(i => i.name === "Called Shot");
  calledShot.sheet = { render: () => { opened = true; } };
  await click(perk("n1"));
  check("buy: clicking an owned perk opens it", opened && !created.length);
  delete calledShot.sheet;

  // A new Outrider: the Pick one warning, and Edit mode adds free with no ledger line.
  const rookie = makeActor("operative", OperativeData, {}, [{ type: "role", name: "Outrider", system: { role: "outrider" } }]);
  rookie.createEmbeddedDocuments = async (type, data) => { created.push(...data); return data; };
  rookie.update = data => { sent.push(data); return data; };
  ({ out } = await renderSheet(OperativeSheet, rookie));
  doc = new JSDOM(out.bio).window.document;
  const rookieSheet = new OperativeSheet(rookie);
  await IropActorSheet.DEFAULT_OPTIONS.actions.perkNode.call(rookieSheet, {}, perk("n2"));
  check("buy: a Pick one perk warns that it rules out the others and only the GM can undo it",
    /rules out Called Shot\. Only the GM can undo that\./.test(dialog) && /\|Buy for 10 XP$/.test(dialog) && created.at(-1)?.name === "Hunter's Mark", dialog);
  created.length = 0;
  sent.length = 0;
  await IropActorSheet.DEFAULT_OPTIONS.actions.toggleMode.call(rookieSheet);
  ({ out } = await renderSheet(OperativeSheet, rookie, { editMode: true }));
  doc = new JSDOM(out.bio).window.document;
  check("edit mode: every perk can be added, gating aside", perk("n3").classList.contains("buyable") && !doc.querySelector(".skill-trees .panel-head .hint"));
  await IropActorSheet.DEFAULT_OPTIONS.actions.perkNode.call(rookieSheet, {}, perk("n3"));
  check("edit mode: a perk is added free, with no ledger line",
    /\|Add free$/.test(dialog) && created[0]?.flags.irop.perk.xp === 0 && !sent.length, dialog);

  // Only the GM takes a perk back: a player cannot delete it; a GM refund removes it.
  let deleted = false;
  const ghost = { id: "ghostcopy", name: "Ghost Step", type: "ability", img: "gs.svg", sort: 9, system: new itemModels.AbilityData({ kind: "active" }),
    flags: { irop: { perk: { node: "n3", tree: "t1", xp: 30 } } },
    deleteDialog: () => { deleted = true; }, delete: async () => { deleted = true; } };
  rookie.items.push(ghost);
  const row = { closest: () => ({ dataset: { itemId: "ghostcopy", logIndex: "0" } }) };
  await IropActorSheet.DEFAULT_OPTIONS.actions.deleteItem.call(rookieSheet, {}, row);
  check("perks: a player cannot delete one", !deleted && /Only the GM can take it back/.test(warned.at(-1) ?? ""));
  game.user = { isGM: true };
  rookie.system._source.xp.log.push({ kind: "perk", label: "Ghost Step (Outrider)", xp: 30, ref: "n3", rank: 0, date: "" });
  await IropActorSheet.DEFAULT_OPTIONS.actions.refundXp.call(rookieSheet, {}, row);
  check("perks: a GM refund removes the perk and the ledger line", deleted && sent.at(-1)?.["system.xp.log"]?.length === 0);
  rookie.system.xp.log = [{ kind: "perk", label: "Ghost Step (Outrider)", xp: 30, ref: "n3", rank: 0, date: "" }];
  ({ out } = await renderSheet(OperativeSheet, rookie));
  rookie.system.xp.log = [];
  check("perks: the undo button says it removes the perk",
    /data-tooltip="Undo: refund the XP and remove the perk"/.test(out.bio));
  rookie.system._source.xp.log.length = 0;
  check("perks: a perk tree dropped on a character is not carried",
    (await rookieSheet._onDropItem({ target: { closest: () => null } }, { type: "skillTree" })) === null && /Perk trees stay in the Items sidebar/.test(warned.at(-1)));

  // Specializations (part B, 2026-10-08): 300 XP earned opens the first, of the role; 900 the second, of any role.
  {
    const realInput = api.DialogV2.input;
    const vet = makeActor("operative", OperativeData, { xp: { earned: 350 } }, [{ type: "role", name: "Outrider", system: { role: "outrider" } }]);
    vet.createEmbeddedDocuments = async (type, data) => { created.push(...data); return data; };
    vet.update = data => { sent.push(data); return data; };
    const removed = [];
    vet.deleteEmbeddedDocuments = async (type, ids) => { removed.push(...ids); return ids; };
    game.user = { isGM: false };
    created.length = 0;
    sent.length = 0;
    const render = async (opts) => new JSDOM((await renderSheet(OperativeSheet, vet, opts)).out.bio).window.document;
    let d = await render();
    const view = id => d.querySelector(`.tree-view[data-tree-id="${id}"]`);
    check("specializations: at 300 XP earned the role's open, each saying a perk makes it the first",
      !d.querySelector('.tree-tab[data-tree-id="t4"]').classList.contains("locked") && !d.querySelector('.tree-tab[data-tree-id="t6"]').classList.contains("locked")
        && /makes Ghost your first specialization/.test(view("t4").querySelector(".tree-note")?.textContent ?? "")
        && view("t4").querySelector('.perk[data-node-id="gh1"]').classList.contains("buyable"));
    check("specializations: no cross training before a second can be taken", !d.querySelector("select[data-browse-tree]"));
    const vetSheet = new OperativeSheet(vet);
    await IropActorSheet.DEFAULT_OPTIONS.actions.perkNode.call(vetSheet, {}, view("t4").querySelector('.perk[data-node-id="gh1"]'));
    check("specializations: the first perk bought warns that it makes Ghost the first specialization",
      /This makes Ghost your first specialization\. Only the GM can undo that\./.test(dialog) && created.at(-1)?.flags.irop.perk.tree === "t4", dialog);
    // Now Ghost is theirs: Sharpshooter waits for 900.
    const ghostPerk = { id: "ghc", name: "Shadowborn", type: "ability", img: "x.svg", sort: 20,
      system: new itemModels.AbilityData({ kind: "passive" }), flags: { irop: { perk: { tree: "t4", node: "gh1", xp: 20 } } } };
    vet.items.push(ghostPerk);
    d = await render();
    check("specializations: with Ghost taken, the second waits for 900 XP earned",
      d.querySelector('.tree-tab[data-tree-id="t6"]').classList.contains("locked")
        && /second specialization opens at 900/.test(view("t6").querySelector(".tree-lock")?.textContent ?? "")
        && !view("t4").querySelector(".tree-note") && !view("t4").querySelector(".tree-lock"));
    vet.system.xp.earned = 950;
    d = await render();
    const picker = [...d.querySelectorAll("select[data-browse-tree] option")].map(o => o.textContent);
    check("specializations: at 900 the second opens, and other roles' specializations can be looked at",
      !d.querySelector('.tree-tab[data-tree-id="t6"]').classList.contains("locked") && (picker.join() === "Other roles...,Legionary: Pointman"), picker.join());
    // A specialization of another role, once bought into, keeps its own tab, labelled with its role.
    vet.items.push({ id: "pmc", name: "Clear the Room", type: "ability", img: "x.svg", sort: 21,
      system: new itemModels.AbilityData({ kind: "active" }), flags: { irop: { perk: { tree: "t5", node: "pm1", xp: 20 } } } });
    d = await render();
    check("specializations: another role's, once bought into, shows as Pointman (Legionary)",
      [...d.querySelectorAll(".tree-tab")].map(a => a.textContent.trim()).includes("Pointman (Legionary)") && !d.querySelector("select[data-browse-tree]"));
    // With both taken, the role's untaken specializations leave the tabs (Johnald, 2026-10-08); Edit mode keeps them.
    const tabIds = doc => [...doc.querySelectorAll(".tree-tab")].map(a => a.dataset.treeId).join();
    check("specializations: once full, the untaken ones are hidden, leaving Primary, the two held, and Generalist",
      tabIds(d) === "t1,t4,t5,t2", tabIds(d));
    await IropActorSheet.DEFAULT_OPTIONS.actions.toggleMode.call(vetSheet);
    const editDoc = new JSDOM((await renderSheet(OperativeSheet, vet, { editMode: true })).out.bio).window.document;
    check("specializations: Edit mode still shows them all", tabIds(editDoc).split(",").includes("t6"), tabIds(editDoc));
    await IropActorSheet.DEFAULT_OPTIONS.actions.toggleMode.call(vetSheet);
    vet.items.splice(vet.items.findIndex(i => i.id === "pmc"), 1);

    // GM reset: the perks come off, ledger buys are refunded, pre ledger ones at the tree's price if chosen.
    vet.items.push({ id: "gsx", name: "Ghost Stepping", type: "ability", img: "x.svg", sort: 22,
      system: new itemModels.AbilityData({ kind: "passive" }), flags: {} });
    vet.system._source.xp.log.push({ kind: "perk", label: "Shadowborn (Ghost)", xp: 20, ref: "gh1", rank: 0, date: "" },
      { kind: "award", label: "Op", xp: 50, ref: "", rank: 0, date: "" });
    game.user = { isGM: true };
    await IropActorSheet.DEFAULT_OPTIONS.actions.toggleMode.call(vetSheet);
    d = await render({ editMode: true });
    check("tree reset: a GM in Edit mode gets Reset on a tree the character holds perks in",
      !!view("t4").querySelector('[data-action="resetTree"]') && !view("t6").querySelector('[data-action="resetTree"]'));
    let asked = "";
    api.DialogV2.input = async ({ content }) => { asked = content; return { older: true }; };
    sent.length = 0;
    await IropActorSheet.DEFAULT_OPTIONS.actions.resetTree.call(vetSheet, {}, view("t4").querySelector('[data-action="resetTree"]'));
    const log = sent.at(-1)?.["system.xp.log"] ?? [];
    check("tree reset: both perks come off, the bought one refunded from the ledger, the older one at the tree's price",
      removed.sort().join() === "ghc,gsx" && /20 XP bought on the ledger comes back/.test(asked) && /Also refund 30 XP/.test(asked)
        && !log.some(e => e.kind === "perk") && log.some(e => e.kind === "award")
        && (log.find(e => e.kind === "refund")?.xp === -30), JSON.stringify(log));
    vet.system.xp.log = [log.find(e => e.kind === "refund")];
    d = await render({ editMode: true });
    check("tree reset: the ledger shows the refund as XP back, and a GM can remove it",
      d.querySelector(".xp-entry .xp-amount")?.textContent === "+30"
        && d.querySelector('.xp-entry [data-action="refundXp"]')?.dataset.tooltip === "Remove this refund");
    api.DialogV2.input = realInput;
    game.user = { isGM: true };

    // The world settings change the rules on the sheet (2026-10-08).
    const realSettings = game.settings.get;
    const table = { specializationXP: "100", specializationOwnRoleFirst: false, specializationCrossRole: true };
    game.settings.get = (scope, key) => {
      if ( (scope === "irop") && (key in table) ) return table[key];
      return realSettings(scope, key);
    };
    const rookie2 = makeActor("operative", OperativeData, { xp: { earned: 120 } }, [{ type: "role", name: "Outrider", system: { role: "outrider" } }]);
    let r2 = new JSDOM((await renderSheet(OperativeSheet, rookie2)).out.bio).window.document;
    check("settings on the sheet: one specialization at 100 XP, any role first: open now, other roles offered",
      !r2.querySelector('.tree-tab[data-tree-id="t4"]').classList.contains("locked") && !!r2.querySelector("select[data-browse-tree]"));
    table.specializationXP = "";
    r2 = new JSDOM((await renderSheet(OperativeSheet, rookie2)).out.bio).window.document;
    check("settings on the sheet: blank unlocks, no specializations at this table, so none show",
      !r2.querySelector('.tree-tab[data-tree-id="t4"]') && !r2.querySelector('.tree-tab[data-tree-id="t6"]')
        && !!r2.querySelector('.tree-tab[data-tree-id="t1"]') && !r2.querySelector("select[data-browse-tree]"));
    game.settings.get = realSettings;
  }

  // No trees in the world yet.
  game.items = Object.assign([], { get: () => null });
  ({ out } = await renderSheet(OperativeSheet, rookie));
  check("dossier trees: none yet says so, and tells a GM where trees are made",
    /No perk trees for this role yet\. A GM makes trees in the Items sidebar/.test(out.bio));

  delete operative.createEmbeddedDocuments;
  delete operative.update;
  api.DialogV2.confirm = realConfirm;
  api.DialogV2.prompt = realPrompt;
  game.user = oldUser;
  game.items = oldItems;
  foundry.utils = oldUtils;
  globalThis.ui = oldUi;
}

// Passive perks show as a grid of tiles (Johnald, 2026-10-08), each with its text on hover.
{
  const { out } = await renderSheet(OperativeSheet, operative);
  const abil = new JSDOM(out.abilities).window.document;
  const tiles = [...abil.querySelectorAll(".perk-grid > .perk-tile")];
  const passives = operative.items.filter(i => (i.type === "ability") && (i.system.kind === "passive"));
  check("perk grid: one tile per passive perk, none left in a list, actives still a list",
    (tiles.length === passives.length) && (tiles.length > 0) && !abil.querySelector(".perk-grid .item-row")
      && abil.querySelectorAll(".ability-row").length === operative.items.filter(i => (i.type === "ability") && (i.system.kind === "active")).length);
  const tile = tiles[0];
  check("perk grid: a tile opens the perk, posts it, deletes it, and drags",
    tile.classList.contains("draggable") && !!tile.dataset.itemId && !!tile.querySelector('img[data-action="editItem"]')
      && !!tile.querySelector('.perk-tile-name[data-action="editItem"]') && !!tile.querySelector('[data-action="postItem"]')
      && !!tile.querySelector('[data-action="deleteItem"]'));
  check("perk grid: just the icon and the name, no line under it (Johnald, 2026-10-08)",
    !tile.querySelector(".perk-tile-sub") && (tile.querySelector(".perk-tile-name").textContent === passives[0].name));
  const long = "<p>Gain <strong>+2 HP</strong>&nbsp;while it&#39;s on. " + "More words here. ".repeat(30) + "</p>";
  const tip = plainText(long);
  check("perk grid: the hover text is plain, decoded, and cut at a word",
    tip.startsWith("Gain +2 HP while it's on.") && !/[<>]/.test(tip) && tip.endsWith("...") && tip.length <= 283, tip);
  check("perk grid: markup written as text stays text", plainText("&lt;img src=x&gt;") === "&lt;img src=x&gt;");
}

// Active abilities drop their text down on a click of the name, like 5e spells (Johnald, 2026-10-08).
{
  const shot = operative.items.find(i => i.name === "Called Shot");
  const was = shot.system.description;
  shot.system.description = "<p>Aim small, <strong>miss small</strong>.</p>";
  shot.system.prerequisites = "Perception 45";
  const sheet = new OperativeSheet(operative);
  const draw = async () => {
    const context = await sheet._prepareContext({});
    const part = await sheet._preparePartContext("abilities", { ...context }, {});
    return new JSDOM(tpl("templates/actor/abilities.hbs")(part)).window.document;
  };
  let d = await draw();
  let row = d.querySelector(`.ability-row[data-item-id="${shot.id}"]`);
  check("ability dropdown: folded at first, its text and prerequisites ready underneath",
    !row.classList.contains("expanded") && row.querySelector(".ability-summary").innerHTML.includes("Aim small, <strong>miss small</strong>.")
      && /Prerequisites/.test(row.querySelector(".summary-prereq")?.textContent ?? "") && row.querySelector(".summary-toggle").getAttribute("aria-expanded") === "false");
  check("ability dropdown: the name drops it down, the icon opens the ability",
    row.querySelector(".summary-toggle").dataset.action === "toggleSummary" && row.querySelector("img").dataset.action === "editItem");
  await IropActorSheet.DEFAULT_OPTIONS.actions.toggleSummary.call(sheet, {}, row.querySelector(".summary-toggle"));
  check("ability dropdown: a click opens it in place", row.classList.contains("expanded") && row.querySelector(".summary-toggle").getAttribute("aria-expanded") === "true");
  d = await draw();
  row = d.querySelector(`.ability-row[data-item-id="${shot.id}"]`);
  check("ability dropdown: it stays open when the sheet redraws", row.classList.contains("expanded"));
  await IropActorSheet.DEFAULT_OPTIONS.actions.toggleSummary.call(sheet, {}, row.querySelector(".summary-toggle"));
  check("ability dropdown: a second click folds it", !row.classList.contains("expanded") && !(await draw()).querySelector(".ability-row.expanded"));
  const empty = [...d.querySelectorAll(".ability-row")].find(r => r.dataset.itemId !== shot.id);
  check("ability dropdown: one with no text says so", /No description yet/.test(empty?.querySelector(".ability-summary").textContent ?? ""));
  shot.system.description = was;
  shot.system.prerequisites = "";
}

// The Dossier tab is called Training now (Johnald, 2026-10-08).
check("tabs: Dossier is now Training", OperativeSheet.TABS.primary.tabs.find(t => t.id === "bio")?.label === "Training"
  && !OperativeSheet.TABS.primary.tabs.some(t => t.label === "Dossier"));
// Abilities before Combat on the operative sheet (Johnald, 2026-10-11).
check("tabs: Attributes, Abilities, Paraphysics (when shown, 2026-10-16), Combat, Gear, in that order", OperativeSheet.TABS.primary.tabs.map(t => t.id).slice(0, 5).join() === "main,abilities,paraphysics,combat,gear");

// The ledger folds away on a click of its header, and stays as each user left it (Johnald, 2026-10-08).
{
  operative.system.xp.log = [{ kind: "award", label: "Op", xp: 30, date: "" }, { kind: "skill", label: "Stealth rank 1", xp: 20, date: "" }];
  let d = new JSDOM((await renderSheet(OperativeSheet, operative)).out.bio).window.document;
  const panel = d.querySelector(".xp-ledger");
  const head = panel.querySelector('.ledger-toggle[data-action="toggleLedger"]');
  check("ledger: open by default, its header counts the entries", panel.classList.contains("open") && /2 entries/.test(head.textContent)
    && head.getAttribute("aria-expanded") === "true" && panel.querySelectorAll(".xp-entry").length === 2);
  const saved = [];
  const realSet = game.settings.set, realGet = game.settings.get;
  game.settings.set = (scope, key, value) => { saved.push([scope, key, value]); return value; };
  await IropActorSheet.DEFAULT_OPTIONS.actions.toggleLedger.call(new OperativeSheet(operative), {}, head);
  check("ledger: a click folds it, and the choice is saved for this user",
    !panel.classList.contains("open") && head.getAttribute("aria-expanded") === "false" && saved.at(-1)?.join() === "irop,ledgerOpen,false");
  game.settings.get = (scope, key) => ((scope === "irop") && (key === "ledgerOpen")) ? false : realGet(scope, key);
  d = new JSDOM((await renderSheet(OperativeSheet, operative)).out.bio).window.document;
  check("ledger: it stays folded when the sheet redraws", !d.querySelector(".xp-ledger").classList.contains("open"));
  game.settings.set = realSet;
  game.settings.get = realGet;
  operative.system.xp.log = [{ kind: "award", label: "Op", xp: 30, date: "" }];
  d = new JSDOM((await renderSheet(OperativeSheet, operative)).out.bio).window.document;
  check("ledger: one entry reads as one entry", d.querySelector(".ledger-count").textContent === "1 entry");
  operative.system.xp.log = [];
}

// The Strategy Layer, step one (2026-10-08): the territory sheet and the rules window.
{
  // The territory sheet is the GM's to edit (players never edit an item, 2026-10-10).
  game.user = { isGM: true, name: "GM" };
  const makeTerritory = (id, name, system) => {
    const t = new FakeDoc({});
    Object.assign(t, { id, name, type: "territory", img: "t.svg", uuid: `Item.${id}`, isOwner: true, effects: [] });
    t.getRollData = () => ({});
    t.system = new itemModels.TerritoryData(system, { parent: t });
    return t;
  };
  const seattle = makeTerritory("ts", "Neo Seattle", { kind: "megacity", strength: 6, heat: 2, neighbors: ["tv"], objectives: { citadel: true } });
  const victoria = makeTerritory("tv", "Old Victoria", { kind: "wildland", neighbors: ["ts"] });
  const spokane = makeTerritory("tk", "Spokane Subsector", { kind: "slums" });
  const oldItems = game.items;
  const world = [seattle, victoria, spokane];
  world.get = id => world.find(t => t.id === id);
  game.items = world;
  const { out } = await renderSheet(IropItemSheet, seattle);
  for ( const [id, html] of Object.entries(out) ) inspect(`item territory ${id}`, html, { actions: ITEM_ACTIONS, source: seattle.system._source });
  const d = new JSDOM(out.details).window.document;
  check("territory sheet: no Effects tab", !("effects" in out));
  check("territory sheet: type, holder, Strength, Heat, Reputation and the parent",
    !!d.querySelector('select[name="system.kind"] option[value="megacity"][selected]') && !!d.querySelector('input[name="system.strength"][max="25"]')
      && d.querySelector('select[name="system.heat"] option[selected]')?.textContent === "Medium"
      && d.querySelector('select[name="system.reputation"] option[selected]')?.textContent === "0 Neutral"
      && [...d.querySelectorAll('select[name="system.parent"] option')].map(o => o.textContent).join() === "None,Old Victoria,Spokane Subsector");
  check("territory sheet: a Megacity shows its three objectives, ticked as taken",
    d.querySelectorAll('.territory-objectives input[type="checkbox"]').length === 3 && d.querySelector('input[name="system.objectives.citadel"]').checked
      && /1 of 3 taken/.test(d.querySelector(".territory-objectives").textContent));
  check("territory sheet: its neighbours, by name",
    [...d.querySelectorAll(".neighbor-chip")].map(c => c.textContent.trim()).join() === "Old Victoria");
  check("territory sheet: no objectives for anything but a Megacity",
    !new JSDOM((await renderSheet(IropItemSheet, spokane)).out.details).window.document.querySelector(".territory-objectives"));
  const writes = [];
  for ( const t of world ) t.update = data => { writes.push([t.id, data["system.neighbors"].join()]); return data; };
  await IropItemSheet.DEFAULT_OPTIONS.actions.removeNeighbor.call(new IropItemSheet(seattle), {}, d.querySelector('.neighbor-chip [data-action="removeNeighbor"]'));
  check("territory sheet: unlinking a neighbour unlinks both", writes.map(w => w.join(":")).sort().join() === "ts:,tv:", JSON.stringify(writes));
  const { setNeighbors } = await import("../module/sheets/item-sheet.mjs");
  writes.length = 0;
  await setNeighbors(seattle, spokane, true);
  check("territory sheet: linking a dropped territory links both", writes.map(w => w.join(":")).sort().join() === "tk:ts,ts:tv,tk", JSON.stringify(writes));
  for ( const t of world ) delete t.update;
  game.items = oldItems;

  // The rules window: every number, grouped, each a real rule.
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  const { StrategyRulesConfig, RULE_FIELDS } = await import("../module/apps/strategy-rules.mjs");
  const paths = RULE_FIELDS.flatMap(s => s.fields.map(f => f[0]));
  check("rules window: every field is a rule, and every rule has a field",
    paths.every(p => typeof foundry.utils.getProperty(IROP.strategyRules, p) === "number")
      && paths.length === Object.values(foundry.utils.flattenObject(IROP.strategyRules)).length);
  const rules = await new StrategyRulesConfig()._prepareContext({});
  const page = new JSDOM(tpl("templates/apps/strategy-rules.hbs")(rules)).window.document;
  check("rules window: the defaults fill the form, with Save and the reset",
    page.querySelector('input[name="strengthMax"]').value === "25"
      && page.querySelector('input[name="support.mortarStrike"]').value === "30" && !!page.querySelector('[data-action="reset"]')
      && !!page.querySelector('button[type="submit"]'));
  // Johnald, 2026-10-08: all the Strategy Layer settings together, the campaign ones first.
  check("rules window: Campaign first (scale and the automatic GENESIS switch), then the groups of numbers",
    [...page.querySelectorAll(".section-title")].map(h => h.textContent).join() === "Campaign,GENESIS,Losing Ground,ODR,Events,Missions,Factions,Support (Logistics)"
      && !!page.querySelector('select[name="campaign.scale"] option[value="superRegion"][selected]')
      && page.querySelector('input[name="campaign.automatic"]').checked);
  // Johnald, 2026-10-09: it needed a scroll bar. Every setting scrolls; Save stays below them.
  const rulesCss = fs.readFileSync(path.join(ROOT, "styles/irop.css"), "utf8");
  check("rules window: the settings scroll, with Save and the reset below them, always in view",
    page.querySelectorAll(".rules-body .section-title").length === 8 && !page.querySelector(".rules-body .rules-actions")
      && page.querySelector(".strategy-rules").lastElementChild.classList.contains("rules-actions")
      && StrategyRulesConfig.PARTS.body.scrollable.join() === ".rules-body"
      && /\.irop-strategy-rules \.rules-body \{[^}]*overflow-y: auto/.test(rulesCss) && /\.irop-strategy-rules \.window-content \{[^}]*overflow: hidden/.test(rulesCss));
  const saved = {};
  const realSettings = game.settings;
  game.user = { isGM: true };
  game.settings = { get: realSettings.get, set: async (ns, key, value) => { saved[key] = value; return value; } };
  await StrategyRulesConfig.DEFAULT_OPTIONS.form.handler({}, null, { object: { "campaign.scale": "city", "campaign.automatic": false, strengthMax: "12", "heatRise.minor": "2" } });
  check("rules window: saving sets the scale, the GENESIS switch and the numbers",
    saved.strategyScale === "city" && saved.genesisAutomatic === false && saved.strategyRules.strengthMax === 12
      && saved.strategyRules.heatRise.minor === 2 && saved.strategyRules.heatRise.major === 2 && !("campaign" in saved.strategyRules), JSON.stringify(saved));
  game.settings = realSettings;
  delete game.user;
}

// The War Room (Strategy Layer step 2, 2026-10-08): the bar, the card, the scene's own settings.
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  const { WarRoomBar, TerritoryCard } = await import("../module/apps/war-room.mjs");
  const { onRenderSceneConfig, onRenderSceneDirectory } = await import("../module/canvas/war-room.mjs");
  WarRoomBar.tools = { mapCounts: () => ({ linked: 12, total: 16, regions: 0 }) };
  const oldUser = game.user;
  game.user = { isGM: true };
  let bar = new JSDOM(tpl("templates/apps/war-room-bar.hbs")(await new WarRoomBar()._prepareContext({}))).window.document;
  check("war room bar: week, phase, Logistics and Intel; Heat chosen by default",
    /Turn\s*1/.test(bar.body.textContent) && /Phase\s*ODR/.test(bar.body.textContent) && /Logistics\s*0/.test(bar.body.textContent)
      && [...bar.querySelectorAll(".wr-chip")].map(c => c.textContent).join() === "Heat,Strength,Reputation,Control"
      && bar.querySelector(".wr-chip.active")?.dataset.layer === "heat");
  check("war room bar: the GM sees how many territories are on the map, the test layout while it has no regions, neighbours and settings",
    /12 of 16 on the map/.test(bar.body.textContent) && !!bar.querySelector('[data-action="testMap"]')
      && !!bar.querySelector('[data-action="neighbours"]') && !!bar.querySelector('[data-action="settings"]'));
  check("war room bar: every button is a real action",
    [...bar.querySelectorAll("[data-action]")].every(b => b.dataset.action in WarRoomBar.DEFAULT_OPTIONS.actions));
  game.user = { isGM: false };
  bar = new JSDOM(tpl("templates/apps/war-room-bar.hbs")(await new WarRoomBar()._prepareContext({}))).window.document;
  check("war room bar: players get the stock and the overlays, no GM tools", !bar.querySelector(".wr-tools") && bar.querySelectorAll(".wr-chip").length === 4);

  const card = new TerritoryCard();
  card.territory = { name: "Neo Seattle", testUserPermission: () => true,
    system: new itemModels.TerritoryData({ kind: "megacity", strength: 15, heat: 2, reputation: 2, reputationPoints: 7, modifiers: "GENESIS Megacity", objectives: { citadel: true } }) };
  const c = new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  check("territory card: type and holder, Heat with its pips, Strength of 25, Reputation with its bar, objectives",
    /Megacity, GENESIS held/.test(c.querySelector(".tc-sub").textContent) && c.querySelectorAll(".tc-pip.on").length === 2 && c.querySelectorAll(".tc-pip").length === 4
      && /15 \/ 25/.test(c.body.textContent) && /\+2 Friendly/.test(c.body.textContent) && /1 of 3/.test(c.body.textContent)
      && c.querySelectorAll(".rep-pip").length === 10 && c.querySelectorAll(".rep-pip.on").length === 7 && c.querySelector(".rep-count").textContent === "7/10"
      && c.querySelector(".rep-pips").classList.contains("tone-friendly") && /Fill the bar to rise a level/.test(c.querySelector(".rep-pips").dataset.tooltip)
      && c.querySelector(".tc-track span").getAttribute("style") === "width: 60%" && !c.querySelector('[data-action="openSheet"]'));
  check("territory card: Heat explains itself on hover", /Alien and GENESIS units arrive by air/.test(c.querySelector(".tc-pips").dataset.tooltip));
  // Johnald, 2026-10-10: Open its sheet is the GM's only.
  game.user = { isGM: true };
  const cg = new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  check("territory card: Open its sheet for the GM, not for players", !!cg.querySelector('[data-action="openSheet"]'));
  // Its neighbours, coloured by who holds them, each opening its own card.
  const nbItems = [
    { id: "pl", name: "Portlandia", type: "territory", system: { control: "contested" } },
    { id: "rh", name: "Redwood Havens", type: "territory", system: { control: "liberated" } },
    { id: "bo", name: "Boise Ruins", type: "territory", system: { control: "genesis" } }
  ];
  const itemsBefore = game.items;
  game.items = Object.assign([...nbItems], { get: id => nbItems.find(i => i.id === id) ?? null });
  game.user = { isGM: false };
  card.territory = { id: "ns", name: "Neo Seattle", testUserPermission: () => true,
    system: new itemModels.TerritoryData({ kind: "megacity", neighbors: ["rh", "pl", "bo", "gone"] }) };
  const cn = new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  const chips = [...cn.querySelectorAll(".tc-neighbours .tc-nb")];
  check("territory card: its neighbours by name, coloured by who holds them, a deleted one left out",
    chips.map(b => b.textContent.trim()).join() === "Boise Ruins,Portlandia,Redwood Havens"
      && chips[1].classList.contains("control-contested") && chips[2].classList.contains("control-liberated")
      && /Neighboring regions/.test(cn.querySelector(".tc-neighbours").textContent)
      && chips.every(b => (b.dataset.action === "neighbour") && b.dataset.id) && "neighbour" in TerritoryCard.DEFAULT_OPTIONS.actions);
  let picked = null;
  TerritoryCard.tools = { select: id => { picked = id; } };
  card.render = () => card;
  await TerritoryCard.DEFAULT_OPTIONS.actions.neighbour.call(card, {}, chips[1]);
  check("territory card: a neighbour opens its card in place, and is selected on the map", card.territory.id === "pl" && picked === "pl");
  // Johnald, 2026-10-10: "drop the U, I'm American". Neighbor wherever it is read: template text and the strings shown.
  const shownText = file => fs.readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{[^}]*\}\}/g, "").replace(/\s(class|data-action|data-[\w-]+)="[^"]*"/g, "");
  const britishIn = ["templates/apps/territory-card.hbs", "templates/apps/war-room-bar.hbs", "templates/item/details-territory.hbs"]
    .filter(f => /neighbour/i.test(shownText(f)));
  const quoted = file => (fs.readFileSync(path.join(ROOT, file), "utf8").match(/(["'`])(?:(?!\1)[^\n])*?\1/g) ?? []);
  const britishStrings = ["module/canvas/war-room.mjs", "module/import.mjs", "module/apps/war-room.mjs"]
    .flatMap(f => quoted(f).filter(q => /neighbour/i.test(q)).map(q => `${f}: ${q}`));
  check("neighbors: spelled the American way wherever it is read", !britishIn.length && !britishStrings.length, [...britishIn, ...britishStrings].join(" | "));
  delete card.render;
  game.items = itemsBefore;
  game.user = oldUser;

  // The scene's own settings get a Strategy Layer box.
  const sceneDoc = new JSDOM(`<form><div class="tab" data-tab="basics"></div></form>`).window.document;
  const oldItems = game.items;
  game.items = Object.assign([{ id: "ns", name: "Neo Seattle", type: "territory" }], { get: () => null });
  onRenderSceneConfig({ document: { flags: { irop: { warRoom: { map: true, parent: "ns" } } } } }, sceneDoc.body);
  const box = sceneDoc.querySelector('.tab[data-tab="basics"] .irop-war-room-config');
  check("scene settings: a Strategy Layer box with War Room map ticked and what it shows",
    !!box && box.querySelector('input[name="flags.irop.warRoom.map"]').checked
      && box.querySelector('select[name="flags.irop.warRoom.parent"] option[selected]')?.textContent === "Territories inside Neo Seattle"
      && box.querySelector('select[name="flags.irop.warRoom.parent"] option[value=""]')?.textContent === "The whole campaign");
  onRenderSceneConfig({ document: {} }, sceneDoc.body);
  check("scene settings: the box is added once", sceneDoc.querySelectorAll(".irop-war-room-config").length === 1);
  game.items = oldItems;
  const dir = new JSDOM(`<div><div class="header-actions"></div></div>`).window.document;
  onRenderSceneDirectory({}, dir.body);
  onRenderSceneDirectory({}, dir.body);
  check("scenes sidebar: one War Room button", dir.querySelectorAll(".irop-war-room-button").length === 1 && /War Room/.test(dir.body.textContent));
}

// Logistics and Intel, and Support (Strategy Layer step 3, 2026-10-08).
{
  const { ResourceLedger, SupportApp, supportCardContext, mortarCardContext, addSupportButton } = await import("../module/apps/resources.mjs");
  const { mortarStrikes } = await import("../module/rules/resources.mjs");
  const { WarRoomBar } = await import("../module/apps/war-room.mjs");
  const oldUser = game.user;
  const oldSettings = game.settings;
  const ledger = [
    { id: "a", resource: "logistics", amount: 40, week: 1, reason: "Starting stock" },
    { id: "b", resource: "intel", amount: 6, week: 1, reason: "Interrogated a VIP" },
    { id: "c", resource: "logistics", amount: -10, week: 2, reason: "Reinforcements (Wraith)" }
  ];
  game.settings = { get(scope, key) {
    if ( key === "resourceLedger" ) return ledger;
    if ( key === "warRoom" ) return { week: 2, phase: "odr" };
    throw new Error("no settings in tests");
  } };
  game.user = { isGM: true, name: "GM" };
  const render = async (App, file) => new JSDOM(tpl(file)(await new App()._prepareContext({}))).window.document;
  let led = await render(ResourceLedger, "templates/apps/resource-ledger.hbs");
  check("ledger window: the stock from the ledger, the week",
    [...led.querySelectorAll(".rl-stock")].map(s => `${s.querySelector(".rl-label").textContent} ${s.querySelector(".rl-value").textContent}`).join() === "Logistics 30,Intel 6" && /Turn 2/.test(led.querySelector(".rl-week").textContent));
  check("ledger window: weeks newest first, each line signed and coloured",
    [...led.querySelectorAll(".rl-week-name")].map(w => w.textContent).join() === "Turn 2,Turn 1"
      && led.querySelector(".rl-line.loss .rl-amount").textContent.trim().startsWith("-10") && led.querySelectorAll(".rl-line.gain").length === 2);
  check("ledger window: the GM records gains and spends and can undo a line",
    !!led.querySelector('.rl-entry select[name="resource"]') && led.querySelectorAll('[data-action="record"]').length === 2
      && led.querySelectorAll('[data-action="undo"]').length === 3
      && [...led.querySelectorAll("[data-action]")].every(b => b.dataset.action in ResourceLedger.DEFAULT_OPTIONS.actions));
  game.user = { isGM: false, name: "Player" };
  led = await render(ResourceLedger, "templates/apps/resource-ledger.hbs");
  check("ledger window: players read it, no entry row or undo", !led.querySelector(".rl-entry") && !led.querySelector('[data-action="undo"]') && led.querySelectorAll(".rl-line").length === 3);

  // Johnald, 2026-10-10: padding inside the windows and larger text, Logistics and Intel and Support alike.
  {
    const css = fs.readFileSync(path.join(ROOT, "styles/irop.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
    const ours = rules.filter(r => /(^|[\s,])\.(rl-|so-|support-(stock|body|list|option))|\.irop \.resource-ledger|irop-support-dialog/.test(r.sel));
    const sizes = ours.flatMap(r => [...r.body.matchAll(/font-size:\s*(\d+)px/g)].map(m => ({ sel: r.sel, px: Number(m[1]) })));
    const pad = rules.find(r => r.sel.startsWith(".irop-resource-ledger .window-content"))?.body ?? "";
    check("ledger and support windows: margins of 18px or more inside the window",
      /padding:\s*18px 22px 20px/.test(pad) && /padding:\s*18px 22px/.test(rules.find(r => r.sel === ".irop-support-dialog .window-content")?.body ?? ""));
    // All text 2px up again on 2026-10-16 (Johnald, for low vision).
    check("ledger and support windows: no text under 16px, the body at 18px",
      sizes.length > 15 && sizes.every(s => s.px >= 16) && /font-size:\s*18px/.test(ours.find(r => /\.irop \.resource-ledger, \.irop \.support-body/.test(r.sel))?.body ?? ""),
      JSON.stringify(sizes.filter(s => s.px < 16)));
    check("ledger window: the Turn label set in from the window's edge",
      /margin-right:\s*12px/.test(rules.find(r => r.sel === ".irop .rl-week")?.body ?? ""));
    check("ledger and support windows: 580 wide for the larger text",
      (ResourceLedger.DEFAULT_OPTIONS.position.width === 580) && (SupportApp.DEFAULT_OPTIONS.position.width === 580));
  }

  let sup = await render(SupportApp, "templates/apps/support.hbs");
  const opt = key => sup.querySelector('[data-support="' + key + '"]');
  check("support window: the five options, their prices, Logistics in stock",
    sup.querySelectorAll(".support-option").length === 5 && /Logistics\s*30/.test(sup.querySelector(".support-stock").textContent)
      && /10 to 25/.test(opt("insideJob").querySelector(".so-cost").textContent) && /50/.test(opt("emergencyExtraction").textContent));
  check("support window: what the stock cannot cover is shut, and says why",
    opt("emergencyExtraction").querySelector("button").disabled && /Needs 50 Logistics; 30 in stock/.test(opt("emergencyExtraction").textContent)
      && !opt("mortarStrike").querySelector("button").disabled);
  check("support window: players request, the GM calls it in",
    /Request/.test(opt("reinforcements").querySelector("button").textContent)
      && [...sup.querySelectorAll("[data-action]")].every(b => b.dataset.action in SupportApp.DEFAULT_OPTIONS.actions));
  game.user = { isGM: true, name: "GM" };
  sup = await render(SupportApp, "templates/apps/support.hbs");
  check("support window: the GM's button calls it in", /Call it in/.test(sup.querySelector('[data-support="reinforcements"] button').textContent));

  const card = s => new JSDOM(tpl("templates/chat/support-card.hbs")(supportCardContext(s))).window.document;
  let c = card({ key: "insideJob", cost: 15, note: "Kill the lights at <the depot>", by: "Wraith", status: "pending" });
  check("support card: a request waits for the GM, with what was asked",
    /Inside Job/.test(c.querySelector("h3").textContent) && /15 Logistics/.test(c.querySelector(".card-sub").textContent)
      && /Wraith requests it/.test(c.body.textContent) && c.querySelectorAll("[data-gm-only]").length === 2
      && c.querySelector(".support-note").innerHTML.includes("&lt;the depot&gt;"));
  c = card({ key: "mortarStrike", cost: 30, by: "Wraith", status: "approved", left: 0 });
  check("support card: approved, what it cost and what is left; a Mortar Strike can fire",
    /Approved for Wraith: 30 Logistics spent, 0 left/.test(c.body.textContent) && !!c.querySelector('[data-irop-action="mortarFire"]') && !c.querySelector("[data-gm-only]"));
  c = card({ key: "mortarStrike", cost: 30, by: "GM", gm: true, status: "approved", left: 5, fired: true });
  check("support card: called in by the GM; fired only once", /Called in by the GM/.test(c.body.textContent) && !c.querySelector('[data-irop-action="mortarFire"]') && /Fired/.test(c.body.textContent));
  c = card({ key: "hiddenCache", cost: 15, by: "Wraith", status: "declined" });
  check("support card: declined spends nothing", /Declined\. No Logistics spent/.test(c.body.textContent) && !c.querySelector("button"));

  const strikes = mortarStrikes([30, 88, 75]);
  Object.assign(strikes[1], { direction: "Southwest", distance: 3, tiles: "tiles" });
  Object.assign(strikes[2], { direction: "North", distance: 1, tiles: "tile" });
  const m = new JSDOM(tpl("templates/chat/mortar-card.hbs")(mortarCardContext(strikes))).window.document;
  check("mortar card: three strikes, which scatter where, a Damage button each",
    m.querySelectorAll(".mortar-strike").length === 3 && /On target/.test(m.querySelectorAll(".mortar-strike")[0].textContent)
      && /Scatters\s*3\s*tiles\s*Southwest/.test(m.querySelectorAll(".mortar-strike")[1].textContent)
      && /1\s*tile\s*North/.test(m.querySelectorAll(".mortar-strike")[2].textContent)
      && [...m.querySelectorAll('[data-irop-action="mortarDamage"]')].map(b => b.dataset.strike).join() === "1,2,3"
      && /3d4 \+ 4 Explosive, radius 3, Destruction 6/.test(m.querySelector(".card-sub").textContent));

  WarRoomBar.tools = { mapCounts: () => ({ linked: 0, total: 0, regions: 1 }) };
  const bar = new JSDOM(tpl("templates/apps/war-room-bar.hbs")(await new WarRoomBar()._prepareContext({}))).window.document;
  check("war room bar: Logistics and Intel from the ledger, each opening it",
    [...bar.querySelectorAll('[data-action="ledger"]')].map(b => b.textContent.replace(/\s+/g, " ").trim()).join() === "Logistics 30,Intel 6"
      && "ledger" in WarRoomBar.DEFAULT_OPTIONS.actions);

  const side = new JSDOM('<div><div class="header-actions"><button class="irop-banks-button">Banks</button></div></div>').window.document;
  addSupportButton({}, side.body);
  addSupportButton({}, side.body);
  check("actors sidebar: one Support button, beside Banks",
    side.querySelectorAll(".irop-support-button").length === 1 && !!side.querySelector(".irop-banks-button + .irop-support-button"));
  game.user = oldUser;
  game.settings = oldSettings;
}

// The turn and the ODR phase (Strategy Layer steps 4 and 5, 2026-10-08).
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  const { OdrBoard, TurnReport, ProjectStrip } = await import("../module/apps/odr.mjs");
  const { WarRoomBar, TerritoryCard } = await import("../module/apps/war-room.mjs");
  const { briefingContext, debriefContext, completionContext } = await import("../module/strategy/odr.mjs");
  const { weekReportContext } = await import("../module/strategy/turn.mjs");
  const { planTurn } = await import("../module/rules/turn.mjs");
  const oldUser = game.user;
  const oldItems = game.items;
  const oldActors = game.actors;
  const oldSettings = game.settings;
  const store = { warRoom: { week: 3, phase: "odr", tactical: null }, resourceLedger: [{ id: "a", resource: "logistics", amount: 40, week: 1, reason: "x" }],
    revealedActions: [{ id: "rv", label: "Strike the GENESIS asset", territory: "ns", rewards: "Revealed by Locate GENESIS Assets.", heat: "major" }],
    missionLog: [{ id: "m1", week: 2, label: "Ambush Patrols", territory: "Redwood Havens", outcome: "success", logistics: 12, intel: 0, heat: "minor", reputation: 1, salvage: 0, notes: "" }],
    turnHistory: [] };
  game.settings = { get(scope, key) { if ( key in store ) return foundry.utils.deepClone(store[key]); throw new Error("no settings in tests"); } };
  const mk = (id, name, type, Model, system) => {
    const d = new FakeDoc({});
    Object.assign(d, { id, name, type, img: "p.svg", uuid: `Item.${id}`, isOwner: true, effects: [] });
    d.getRollData = () => ({});
    d.testUserPermission = () => true;
    d.system = new Model(system, { parent: d });
    return d;
  };
  const P = (id, name, system) => mk(id, name, "project", itemModels.ProjectData, system);
  const world = [
    mk("ns", "Neo Seattle", "territory", itemModels.TerritoryData, { kind: "megacity", strength: 6, heat: 2, heatPending: 2 }),
    mk("rh", "Redwood Havens", "territory", itemModels.TerritoryData, { kind: "rural", strength: 3, heat: 1 }),
    mk("lb", "Neo LA", "territory", itemModels.TerritoryData, { kind: "megacity", control: "liberated" }),
    P("ar", "Armory Refit", { kind: "research", status: "active", cost: 100, progress: 40, specialization: ["tactics", "mechanics"], unlocks: "Weapon Modifications",
      assigned: [{ actor: "k", skill: "tactics" }], description: "<p>Taking stock.</p>" }),
    P("xr", "Xeno Studies", { kind: "research", status: "available", cost: 80, specialization: ["biology"] }),
    P("hd", "Secret Project", { kind: "research", status: "hidden", cost: 40 }),
    P("sam", "SAM Site", { kind: "engineering", status: "active", cost: 60, progress: 10, builds: "regional", territory: "rh" }),
    P("tf", "Training Facility", { kind: "engineering", status: "available", cost: 0, builds: "base", specialization: ["tactics", "history"] }),
    P("old", "Old Bunker", { kind: "engineering", status: "complete", cost: 30, progress: 30, builds: "regional", territory: "ns" }),
    P("lg", "Locate GENESIS Assets", { kind: "intelligence", term: "long", status: "active", cost: 50, progress: 20, territory: "ns", reveals: "Strike the GENESIS asset" }),
    P("fl", "Find Logistics Cache", { kind: "intelligence", term: "short", status: "available", cost: 20 })
  ];
  world.get = id => world.find(d => d.id === id) ?? null;
  world.has = id => world.some(d => d.id === id);
  game.items = world;
  const kael = { id: "k", name: "Kael", type: "operative", isOwner: true,
    system: { attributes: { int: { mod: 4 }, str: { mod: 5 } }, skills: { tactics: { rank: 2 } } } };
  const vex = { id: "v", name: "Vex", type: "operative", isOwner: false, system: { attributes: { int: { mod: 3 } }, skills: {} } };
  const actors = [kael, vex];
  actors.get = id => actors.find(a => a.id === id);
  game.actors = actors;
  const ODR_ACTIONS = new Set(Object.keys(OdrBoard.DEFAULT_OPTIONS.actions));

  // The project sheet.
  const { out: pout } = await renderSheet(IropItemSheet, world.get("ar"));
  for ( const [id, html] of Object.entries(pout) ) inspect(`item project ${id}`, html, { actions: ITEM_ACTIONS, source: world.get("ar").system._source });
  const ps = new JSDOM(pout.details).window.document;
  check("project sheet: no Effects tab", !("effects" in pout));
  check("project sheet: kind, status, cost and progress; specialization as chips, the chosen ones lit",
    !!ps.querySelector('select[name="system.kind"] option[value="research"][selected]') && ps.querySelector('input[name="system.cost"]').value === "100"
      && [...ps.querySelectorAll(".skill-chip.on")].map(b => b.dataset.skill).join() === "mechanics,tactics" && ps.querySelectorAll(".skill-chip").length === 22
      && !!ps.querySelector('input[name="system.unlocks"]') && !!ps.querySelector('input[name="system.salvage"]'));
  check("project sheet: who is assigned", /Kael \(Tactics\)/.test(ps.querySelector(".hint:last-of-type").textContent));
  const intelSheet = new JSDOM((await renderSheet(IropItemSheet, world.get("lg"))).out.details).window.document;
  check("project sheet: an Intelligence Action shows its term, where it looks and what it reveals, not specialization",
    !!intelSheet.querySelector('select[name="system.term"]') && !!intelSheet.querySelector('select[name="system.territory"] option[value="ns"][selected]')
      && intelSheet.querySelector('input[name="system.reveals"]').value === "Strike the GENESIS asset" && !intelSheet.querySelector(".skill-chip"));
  const samSheet = new JSDOM((await renderSheet(IropItemSheet, world.get("sam"))).out.details).window.document;
  check("project sheet: a regional upgrade says where it is built", /Built in/.test(samSheet.body.textContent) && !!samSheet.querySelector('select[name="system.builds"] option[value="regional"][selected]'));
  const toggled = [];
  world.get("ar").update = data => { toggled.push(data["system.specialization"].join()); return data; };
  // The GM's to change (players never edit an item, 2026-10-10).
  const projectUser = game.user;
  game.user = { isGM: false, name: "Johnald" };
  await IropItemSheet.DEFAULT_OPTIONS.actions.toggleSkill.call(new IropItemSheet(world.get("ar")), {}, { dataset: { skill: "tactics" } });
  check("project sheet: a player's chip click changes nothing", !toggled.length);
  game.user = { isGM: true, name: "GM" };
  await IropItemSheet.DEFAULT_OPTIONS.actions.toggleSkill.call(new IropItemSheet(world.get("ar")), {}, { dataset: { skill: "tactics" } });
  await IropItemSheet.DEFAULT_OPTIONS.actions.toggleSkill.call(new IropItemSheet(world.get("ar")), {}, { dataset: { skill: "biology" } });
  game.user = projectUser;
  check("project sheet: a GM's chip click takes a skill away or adds it", toggled.join("|") === "mechanics|tactics,mechanics,biology");
  delete world.get("ar").update;

  // The territory sheet and card, steps 4 and 5.
  const nsSheet = new JSDOM((await renderSheet(IropItemSheet, world.get("ns"))).out.details).window.document;
  check("territory sheet: Heat next turn, action this week, and the upgrades built there among the Rebellion's facilities",
    nsSheet.querySelector('input[name="system.heatPending"]').value === "2" && !!nsSheet.querySelector('input[name="system.active"]')
      && /Old Bunker\s*Built/.test(nsSheet.querySelector(".facility-list.rebellion .facility-auto").textContent));
  const card = new TerritoryCard();
  card.territory = world.get("ns");
  game.user = { isGM: false };
  const tc = new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  check("territory card: Heat waiting for next turn, upgrades, and a mission planned here",
    /Heat \+2 next turn/.test(tc.querySelector(".tc-pending").textContent) && /Old Bunker/.test(tc.querySelector(".tc-fac-list").textContent)
      && !!tc.querySelector('[data-action="plan"]') && "plan" in TerritoryCard.DEFAULT_OPTIONS.actions);
  card.territory = world.get("lb");
  check("territory card: no mission in a liberated territory", !(await card._prepareContext({})).canPlan);

  // The War Room bar: ODR for all; Advance week and Undo for the GM.
  WarRoomBar.tools = { mapCounts: () => ({ linked: 0, total: 0, regions: 1 }) };
  let bar = new JSDOM(tpl("templates/apps/war-room-bar.hbs")(await new WarRoomBar()._prepareContext({}))).window.document;
  check("war room bar: players get the ODR board, not Advance week", !!bar.querySelector('[data-action="odr"]') && !bar.querySelector('[data-action="advance"]'));
  game.user = { isGM: true, name: "GM" };
  store.turnHistory = [{ week: 2, to: 3, phase: "odr", before: [] }];
  bar = new JSDOM(tpl("templates/apps/war-room-bar.hbs")(await new WarRoomBar()._prepareContext({}))).window.document;
  check("war room bar: the GM advances the week, and can undo the last one",
    !!bar.querySelector('[data-action="advance"]') && bar.querySelector('[data-action="undo"]')?.dataset.tooltip === "Undo turn 3"
      && [...bar.querySelectorAll("[data-action]")].every(b => b.dataset.action in WarRoomBar.DEFAULT_OPTIONS.actions));

  // The ODR board.
  const board = new OdrBoard();
  const renderBoard = async tab => {
    board.tab = tab;
    const html = tpl("templates/apps/odr-board.hbs")(await board._prepareContext({}));
    return inspect(`odr board ${tab} ${game.user.isGM ? "gm" : "player"}`, html, { actions: ODR_ACTIONS, source: {} });
  };
  let b = await renderBoard("research");
  check("odr board: week, phase, the stock; the GM can advance or undo",
    /Turn\s*3/.test(b.querySelector(".odr-head").textContent) && /Logistics\s*40/.test(b.querySelector(".odr-head").textContent)
      && !!b.querySelector('.odr-gm [data-action="advance"]') && /Undo turn 3/.test(b.querySelector(".odr-gm").textContent));
  check("odr board: five tabs with their counts", [...b.querySelectorAll(".odr-tab")].map(t => t.textContent.replace(/\s+/g, " ").trim()).join() ===
    "Research 1/1,Engineering 1/3,Intelligence 1/2,Tactical open,Factions 0");
  // Bug, 2026-10-08 (Johnald: the tabs would not switch): "tab" is Foundry's own action, so ours never ran.
  const engTab = b.querySelector('.odr-tab[data-tab="engineering"]');
  board.render = () => board;
  await OdrBoard.DEFAULT_OPTIONS.actions[engTab.dataset.action].call(board, {}, engTab);
  check("odr board: a tab button switches the tab, through an action Foundry leaves to us",
    engTab.dataset.action === "switchTab" && board.tab === "engineering" && !("tab" in OdrBoard.DEFAULT_OPTIONS.actions));
  delete board.render;
  const slotEl = b.querySelector('.odr-slot[data-project-id="ar"]');
  check("odr board: the research under way, its progress, next turn's gain and who works it",
    /40 \/ 100 Logistics/.test(slotEl.querySelector(".os-count").textContent) && /\+24 next turn/.test(slotEl.querySelector(".os-weekly").textContent)
      && slotEl.querySelector(".os-weekly").dataset.tooltip === "Passive 10, Kael (Tactics) 14" && /Kael/.test(slotEl.querySelector(".os-soldier").textContent)
      && /Unlocks\s*Weapon Modifications/.test(slotEl.textContent) && /Taking stock/.test(slotEl.querySelector(".os-desc").textContent));
  check("odr board: spend, assign, salvage (+30) for the GM",
    !!slotEl.querySelector('[data-action="spend"]') && slotEl.querySelector("input[data-spend]").getAttribute("max") === "60"
      && [...slotEl.querySelectorAll("select[data-soldier] option")].map(o => o.textContent).join() === "Vex" && /Salvage \+30/.test(slotEl.textContent));
  check("odr board: the GM sees hidden projects, marked, with Show; others switch the research",
    /Hidden/.test(b.querySelector('[data-project-id="hd"]').textContent) && !!b.querySelector('[data-project-id="hd"] [data-action="show"]')
      && b.querySelector('[data-project-id="xr"] [data-action="start"]').textContent === "Switch to this");
  b = await renderBoard("engineering");
  check("odr board: Engineering, three slots: one under way, two free",
    b.querySelectorAll(".odr-slot").length === 1 && b.querySelectorAll(".odr-empty").length === 2 && /Regional upgrade, Redwood Havens/.test(b.querySelector(".odr-slot .os-sub").textContent));
  check("odr board: a project with no cost cannot start, and says why",
    b.querySelector('[data-project-id="tf"] [data-action="start"]').disabled && /no cost yet/.test(b.querySelector('[data-project-id="tf"] .or-start').dataset.tooltip)
      && /Built \(1\)/.test(b.querySelector(".odr-done summary").textContent));
  b = await renderBoard("intelligence");
  check("odr board: Intelligence, one short and one long term slot",
    /No short term action under way/.test(b.body.textContent) && /Reveals\s*Strike the GENESIS asset, in Neo Seattle/.test(b.querySelector('[data-project-id="lg"]').textContent)
      && !!b.querySelector('[data-project-id="fl"] [data-action="start"]:not([disabled])'));
  b = await renderBoard("tactical");
  check("odr board: the Tactical Actions, the revealed one marked where, and the territories but no liberated one",
    b.querySelectorAll(".odr-choice").length === 9 && /Revealed: Neo Seattle/.test(b.querySelector('[data-choice="rv"]').textContent)
      && [...b.querySelectorAll("select[data-tactical-territory] option")].map(o => o.textContent).join() === "Pick a territory,Neo Seattle,Redwood Havens"
      && /Turn 2/.test(b.querySelector(".odr-log").textContent) && /\+12 Logistics/.test(b.querySelector(".odr-log").textContent));
  board.territory = "rh";
  b = await renderBoard("tactical");
  check("odr board: a territory picked from its card is already chosen", !!b.querySelector('select[data-tactical-territory] option[value="rh"][selected]'));
  store.warRoom = { week: 3, phase: "odr", tactical: { key: "ambushPatrols", label: "Ambush Patrols", territory: "rh", heat: "minor", status: "briefed", by: "Kael", rewards: "Corpses." } };
  b = await renderBoard("tactical");
  check("odr board: this week's mission, briefed: the GM debriefs it",
    /Ambush Patrols/.test(b.querySelector(".tactical-slot").textContent) && /Redwood Havens\. Briefed/.test(b.querySelector(".tactical-slot .os-sub").textContent)
      && !!b.querySelector('[data-action="debrief"]') && !b.querySelector(".odr-choice"));
  game.user = { isGM: false, name: "Johnald" };
  b = await renderBoard("research");
  check("odr board: players see no hidden project, no GM buttons, and only their own operatives to assign",
    !b.querySelector('[data-project-id="hd"]') && !b.querySelector(".odr-gm") && !b.querySelector('[data-action="salvage"]') && !b.querySelector('[data-action="show"]')
      && !b.querySelector('.odr-slot[data-project-id="ar"] select[data-soldier]') && /Research 1\/1/.test(b.querySelector(".odr-tabs").textContent));
  b = await renderBoard("tactical");
  check("odr board: players cannot put back or debrief a briefed mission", !b.querySelector('[data-action="clear"]') && !b.querySelector('[data-action="debrief"]'));
  store.warRoom = { week: 3, phase: "odr", tactical: null };

  // The project strip.
  game.user = { isGM: true };
  const strip = new JSDOM(tpl("templates/apps/project-strip.hbs")(await new ProjectStrip()._prepareContext({}))).window.document;
  check("project strip: each slot at a glance, each opening its tab",
    [...strip.querySelectorAll(".ps-seg")].map(s => s.dataset.tab).join() === "research,engineering,intelligence,tactical"
      && /Armory Refit/.test(strip.querySelector('[data-tab="research"]').textContent) && /2 free/.test(strip.querySelector('[data-tab="engineering"]').textContent)
      && /short: none/.test(strip.querySelector('[data-tab="intelligence"]').textContent) && /not chosen/.test(strip.querySelector('[data-tab="tactical"]').textContent));

  // The turn report: automatic, everything ticked; manual, GENESIS unticked and projects ticked.
  const plan = planTurn({ week: 7, territories: [
    { id: "ns", name: "Neo Seattle", system: { kind: "megacity", control: "genesis", strength: 6, heat: 2, heatPending: 0, quietWeeks: 1, active: false, neighbors: ["rh"] } },
    { id: "rh", name: "Redwood Havens", system: { kind: "rural", control: "genesis", strength: 3, heat: 1, heatPending: 2, quietWeeks: 0, active: false, neighbors: ["ns"] } }
  ], projects: [{ id: "ar", name: "Armory Refit", system: { kind: "research", status: "active", cost: 100, progress: 40, specialization: [], assigned: [] } }], rules: IROP.strategyRules });
  const report = new TurnReport();
  report.replan(plan);
  let r = new JSDOM(tpl("templates/apps/turn-report.hbs")(await report._prepareContext({}))).window.document;
  inspect("turn report", r.body.innerHTML, { actions: new Set(Object.keys(TurnReport.DEFAULT_OPTIONS.actions)), source: {} });
  check("turn report: turn 8's GENESIS phase, by section, every line ticked",
    /Turn 8/.test(r.querySelector(".tr-banner").textContent) && [...r.querySelectorAll(".tr-section .section-title")].map(h => h.textContent).join() ===
      "Megacities grow,Strength moves,Heat,ODR projects,Due this turn"
      && [...r.querySelectorAll("input[data-line]")].every(i => i.checked) && !r.querySelector(".tr-manual"));
  check("turn report: warnings, due draws, and Start turn 8",
    /No Tactical Action/.test(r.querySelector(".tr-warn").textContent) && r.querySelectorAll(".tr-due").length === 2 && /Start turn 8/.test(r.querySelector('[data-action="apply"]').textContent));
  game.settings = { get(scope, key) { if ( key === "genesisAutomatic" ) return false; if ( key in store ) return foundry.utils.deepClone(store[key]); throw new Error("no settings in tests"); } };
  report.replan(plan);
  r = new JSDOM(tpl("templates/apps/turn-report.hbs")(await report._prepareContext({}))).window.document;
  const boxes = section => [...r.querySelectorAll(".tr-section")].find(s => s.querySelector(".section-title").textContent === section)?.querySelectorAll("input[data-line]") ?? [];
  // Johnald, 2026-10-10: "a little hard to read". The body 16px, nothing under 14px; the last size set for each piece counts.
  {
    const css = fs.readFileSync(path.join(ROOT, "styles/irop.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const last = new Map();
    for ( const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g) ) {
      const size = m[2].match(/font-size:\s*(\d+)px/)?.[1];
      if ( !size ) continue;
      for ( const sel of m[1].split(",").map(x => x.trim()) ) {
        if ( /^\.irop \.(tr-|turn-report)/.test(sel) ) last.set(sel, Number(size));
      }
    }
    const small = [...last].filter(([, px]) => px < 16);
    check("turn report: larger text, the body 18px and nothing under 16px",
      (last.get(".irop .turn-report") === 18) && (last.size > 10) && !small.length
        && (last.get(".irop .tr-detail") === 16) && (last.get(".irop .tr-phase") === 17), JSON.stringify(small));
    check("turn report: 640 wide for it, and the chat card's banner 2px up with everything else",
      (TurnReport.DEFAULT_OPTIONS.position.width === 640) && /\.irop-card \.week-phase \{[^}]*font-size:\s*15px/.test(css));
  }
  check("turn report: a manual GENESIS phase lists the rules' suggestions unticked; the projects stay ticked",
    !!r.querySelector(".tr-manual") && [...boxes("Heat")].every(i => !i.checked) && [...boxes("Megacities grow")].every(i => !i.checked) && [...boxes("ODR projects")].every(i => i.checked));

  // Chat cards.
  const wr = new JSDOM(tpl("templates/chat/week-report.hbs")(weekReportContext(plan, new Set(plan.lines.map(l => l.id))))).window.document;
  check("week card: the new week, what GENESIS did, and what is due",
    /Turn 8/.test(wr.querySelector(".week-no").textContent) && wr.querySelectorAll(".week-lines li").length === plan.lines.filter(l => !l.hidden).length
      && !!wr.querySelector(".week-lines .tone-up") && wr.querySelectorAll(".week-due p").length === 2 && /ODR phase begins/.test(wr.body.textContent));
  const quiet = new JSDOM(tpl("templates/chat/week-report.hbs")(weekReportContext(plan, new Set()))).window.document;
  check("week card: nothing ticked is a quiet week", /A quiet turn/.test(quiet.body.textContent));
  const brief = briefingContext({ label: "Ambush Patrols", rewards: "Corpses, valuables, loot.", heat: "minor", by: "Kael" }, world.get("ns"), { rules: IROP.strategyRules, week: 3 });
  const bc = new JSDOM(tpl("templates/chat/mission-brief.hbs")(brief)).window.document;
  inspect("mission briefing", bc.body.innerHTML, { actions: new Set(), source: {} });
  check("briefing card: where, the doc's Heat response, the Strength band, Reputation, rewards",
    /Neo Seattle/.test(bc.querySelector(".mission-where").textContent) && /Medium\./.test(bc.body.textContent) && /Alien and GENESIS units/.test(bc.body.textContent)
      && /6 of 25, Low/.test(bc.body.textContent) && /0 Neutral/.test(bc.body.textContent) && /Corpses/.test(bc.body.textContent) && /Chosen by Kael/.test(bc.body.textContent));
  const dc = new JSDOM(tpl("templates/chat/mission-debrief.hbs")(debriefContext({ week: 3, label: "Ambush Patrols", territory: "Neo Seattle", outcome: "success",
    logistics: 15, intel: 0, heat: "major", reputation: 1, salvage: 1, notes: "Clean exit" }, { salvageNote: "to Armory Refit", rules: IROP.strategyRules }))).window.document;
  check("debrief card: outcome, gains, the Heat to come, Reputation, salvage, notes",
    /Success/.test(dc.querySelector(".mission-outcome").textContent) && /\+15 Logistics/.test(dc.body.textContent) && !/Intel/.test(dc.querySelector(".debrief-lines").textContent)
      && /Major, \+2 next turn/.test(dc.body.textContent) && /Reputation \+1/.test(dc.body.textContent) && /1 salvage to Armory Refit/.test(dc.body.textContent) && /Clean exit/.test(dc.body.textContent));
  const moved = new JSDOM(tpl("templates/chat/mission-debrief.hbs")(debriefContext({ id: "m3", week: 3, label: "Raid", territory: "Neo Seattle", outcome: "success",
    logistics: 0, intel: 0, heat: "none", reputation: 3, reputationResult: "+3: up to Supportive", salvage: 0, notes: "" }, { rules: IROP.strategyRules }))).window.document;
  check("debrief card: Reputation says where the bar went (2026-10-11)", /Reputation \+3: up to Supportive/.test(moved.body.textContent));
  const cc = new JSDOM(tpl("templates/chat/project-complete.hbs")(completionContext(world.get("lg")))).window.document;
  check("complete card: an Intelligence Action says what it reveals, and where",
    /Intelligence complete/.test(cc.body.textContent) && /Strike the GENESIS asset, in Neo Seattle/.test(cc.body.textContent));
  const sc = new JSDOM(tpl("templates/chat/project-complete.hbs")(completionContext(world.get("sam")))).window.document;
  check("complete card: an upgrade says what was built, and where", /Regional upgrade, Redwood Havens/.test(sc.body.textContent) && !/Reveals/.test(sc.body.textContent));
  const dd = new JSDOM(tpl("templates/dialog/debrief.hbs")({ label: "Ambush Patrols", territory: "Neo Seattle", rewards: "Corpses.",
    defaults: { outcome: "success", heat: "minor", reputation: 2 }, outcomes: IROP.missionOutcomes,
    heatClasses: IROP.heatClasses, reputationRules: IROP.strategyRules.missionReputation, salvagePercent: 30 })).window.document;
  check("debrief dialog: outcome, Heat raised, Logistics, Intel, Reputation points, salvage, notes",
    ["outcome", "heat", "logistics", "intel", "reputation", "salvage", "notes"].every(n => !!dd.querySelector(`[name="${n}"]`))
      && dd.querySelector('[name="heat"] option[selected]')?.value === "minor" && dd.querySelector('[name="reputation"]').value === "2"
      && /Success \+2, partial \+1, failure -2; an undeniable failure, or civilians hurt, -4/.test(dd.querySelector('[name="reputation"]').closest("label").dataset.tooltip));

  game.user = oldUser;
  game.items = oldItems;
  game.actors = oldActors;
  game.settings = oldSettings;
}

// Factions on the ODR board (Johnald, 2026-10-11): standing, the tasks on offer, their dialogs and card.
{
  const { OdrBoard } = await import("../module/apps/odr.mjs");
  const { taskCardContext, resolveDefaults } = await import("../module/strategy/factions.mjs");
  const { normalizeTask } = await import("../module/rules/factions.mjs");
  const oldUser = game.user;
  const oldItems = game.items;
  const oldActors = game.actors;
  const oldSettings = game.settings;
  const store = {
    warRoom: { week: 4, phase: "odr", tactical: null }, resourceLedger: [], turnHistory: [], missionLog: [], revealedActions: [],
    factions: [
      { id: "cu", name: "Copperhides", tier: "minor", standing: 4, points: 7, stance: "Allied. No Monarch", home: "mal", notes: "Mutant clan of Malmstrom." },
      { id: "ps", name: "Pale Sons", tier: "minor", standing: -3, points: 2, stance: "Hostile" },
      { id: "gi", name: "GIA", tier: "major", standing: -1, points: 5, img: "gia.webp" },
      { id: "zb", name: "Zaibatsu", tier: "major", standing: 0, points: 5, hidden: true }
    ],
    factionTasks: [
      { id: "t1", faction: "cu", title: "Clear the dam road", brief: "Raiders on the road.", status: "accepted", term: 1, week: 4, due: 4, standing: 2, failure: 1,
        logistics: 20, reward: "A guide through Malmstrom", rival: "ps", rivalLoss: 1, operatives: ["k"], by: "Kael" },
      { id: "t2", faction: "gi", title: "Lose a file", status: "offered", term: 2, week: 4, due: 5, standing: 1, failure: 1 },
      { id: "t3", faction: "cu", title: "Draft job", status: "draft", term: 2 },
      { id: "t4", faction: "zb", title: "Secret run", status: "offered", term: 1, week: 4, due: 4 },
      { id: "t5", faction: "cu", title: "Scout the bridge", status: "resolved", outcome: "success", resolvedWeek: 3 }
    ],
    factionLog: [
      { id: "l1", week: 3, faction: "cu", name: "Copperhides", delta: 2, from: { level: 4, points: 5 }, to: { level: 4, points: 7 }, moved: 0, reason: "Task success: Scout the bridge" },
      { id: "l2", week: 3, faction: "zb", name: "Zaibatsu", delta: -1, from: { level: 0, points: 6 }, to: { level: 0, points: 5 }, moved: 0, reason: "Secret dealings" }
    ]
  };
  game.settings = { get(scope, key) { if ( key in store ) return foundry.utils.deepClone(store[key]); throw new Error("no settings in tests"); } };
  const mal = new FakeDoc({});
  Object.assign(mal, { id: "mal", name: "Malmstrom", type: "territory", img: "t.svg", effects: [] });
  mal.system = new itemModels.TerritoryData({ kind: "wildland" }, { parent: mal });
  const world = [mal];
  world.get = id => world.find(d => d.id === id) ?? null;
  world.has = id => world.some(d => d.id === id);
  game.items = world;
  const actors = [
    { id: "k", name: "Kael", type: "operative", isOwner: true, system: { attributes: {}, skills: {} } },
    { id: "v", name: "Vex", type: "operative", isOwner: false, system: { attributes: {}, skills: {} } }
  ];
  actors.get = id => actors.find(a => a.id === id);
  game.actors = actors;
  const ACTIONS = new Set(Object.keys(OdrBoard.DEFAULT_OPTIONS.actions));
  const board = new OdrBoard();
  board.tab = "factions";
  const render = async () => inspect(`odr board factions ${game.user.isGM ? "gm" : "player"}`,
    tpl("templates/apps/odr-board.hbs")(await board._prepareContext({})), { actions: ACTIONS, source: {} });
  const texts = (doc, sel) => [...doc.querySelectorAll(sel)].map(e => e.textContent.replace(/\s+/g, " ").trim());
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  // The GM's view.
  game.user = { isGM: true, name: "GM" };
  let b = await render();
  check("factions tab: the badge counts open tasks, the hidden faction's among them for the GM",
    texts(b, ".odr-tab").at(-1) === "Factions 3" && b.querySelector(".odr-tab.active")?.dataset.tab === "factions");
  check("factions tab: taken first, then offered by deadline; drafts apart",
    eq([...b.querySelectorAll(".odr-section:first-of-type > .faction-task")].map(e => e.dataset.taskId), ["t1", "t4", "t2"])
      && eq([...b.querySelectorAll(".ft-drafts .faction-task")].map(e => e.dataset.taskId), ["t3"]));
  const t1 = b.querySelector('.faction-task[data-task-id="t1"]');
  check("factions tab: a taken task says who, what it offers, what failing costs, who it works against, and who went",
    /Copperhides\. Due this turn\. Taken by Kael\./.test(t1.querySelector(".os-sub").textContent) && t1.classList.contains("due-now") && t1.classList.contains("status-accepted")
      && /Offers\s*\+2 standing points, \+20 Logistics, A guide through Malmstrom/.test(t1.textContent) && /Failing it\s*-1 standing/.test(t1.textContent)
      && /Works against\s*Pale Sons, -1 standing/.test(t1.textContent) && texts(t1, ".os-soldier").join() === "Kael"
      && !!t1.querySelector('[data-action="resolveTask"]') && !!t1.querySelector('[data-action="releaseTask"]') && !t1.querySelector('[data-action="acceptTask"]'));
  const t2 = b.querySelector('.faction-task[data-task-id="t2"]');
  check("factions tab: an offered task can be taken, with an operative picked or no one yet",
    /Due by turn 5, 2 turns left/.test(t2.textContent) && !t2.classList.contains("due-now") && !!t2.querySelector('[data-action="acceptTask"]')
      && texts(t2, "select[data-task-soldier] option").join() === "No one yet,Kael (on Clear the dam road),Vex" && !!t2.querySelector("img[src='gia.webp']"));
  const t3 = b.querySelector('.faction-task[data-task-id="t3"]');
  check("factions tab: a draft is the GM's to offer, with no team or deadline yet",
    !!t3.querySelector('[data-action="offerTask"]') && !t3.querySelector('[data-action="resolveTask"]') && !t3.querySelector(".os-team") && /Runs 2 turns once offered/.test(t3.textContent));
  check("factions tab: standing by tier, highest first, the hidden faction marked",
    eq(texts(b, ".ft-tier"), ["Major factions", "Minor factions"])
      && eq([...b.querySelectorAll(".faction-row")].map(r => r.dataset.factionId), ["zb", "gi", "cu", "ps"])
      && /Hidden/.test(b.querySelector('.faction-row[data-faction-id="zb"]').textContent));
  const cuRow = b.querySelector('.faction-row[data-faction-id="cu"]');
  const psRow = b.querySelector('.faction-row[data-faction-id="ps"]');
  check("factions tab: a row shows stance, home, open tasks, its level, and the bar of points inside it in the level's color",
    /Allied\. No Monarch\. Based in Malmstrom\. 1 task open\./.test(cuRow.querySelector(".or-sub").textContent) && cuRow.classList.contains("band-allied")
      && cuRow.querySelector(".fr-value").textContent === "+4 Allied" && cuRow.querySelectorAll(".rep-pip.on").length === 7 && cuRow.querySelectorAll(".rep-pip").length === 10
      && cuRow.querySelector(".rep-count").textContent === "7/10" && cuRow.querySelector(".rep-pips").classList.contains("tone-allied")
      && psRow.querySelector(".fr-value").textContent === "-3 Hostile" && psRow.querySelectorAll(".rep-pip.on").length === 2 && psRow.classList.contains("band-hostile")
      && /Mutant clan of Malmstrom/.test(cuRow.querySelector(".or-desc").textContent)
      && /Stands with the ODR.*Turn 3: \+2, Task success: Scout the bridge/s.test(cuRow.querySelector(".fr-standing").dataset.tooltip));
  check("factions tab: the GM's row tools", ["standingDown", "standingUp", "newTask", "hideFaction", "deleteFaction"].every(a => !!cuRow.querySelector(`[data-action="${a}"]`))
    && cuRow.querySelector(".or-name").dataset.action === "editFaction" && !!b.querySelector('[data-action="newFaction"]'));
  check("factions tab: the standing log, newest first, and the finished tasks",
    eq(texts(b.querySelector(".faction-log li"), "span"), ["Turn 3", "Zaibatsu: Secret dealings", "-1", "Neutral, 5 of 10"]) && (texts(b, ".faction-log li").length === 2)
      && eq(texts(b, ".odr-done:not(.ft-drafts):not(.ft-bands) .odr-log li span"), ["Turn 3", "Scout the bridge, for Copperhides", "Success", ""]));
  check("factions tab: the ladder, top first, and how its bars work",
    texts(b, ".ft-band-list li").length === 9 && /^Allied \+4 Stands with the ODR/.test(texts(b, ".ft-band-list li")[0]) && /^At War -4 Hunts the ODR/.test(texts(b, ".ft-band-list li")[8])
      && /a bar of 10 points.*start the new level at 5/.test(b.querySelector(".ft-bands .hint").textContent));

  // A player's view: no hidden faction, no drafts, no GM tools.
  game.user = { isGM: false, name: "Johnald" };
  b = await render();
  check("factions tab: players see neither the hidden faction nor its task, nor the drafts",
    texts(b, ".odr-tab").at(-1) === "Factions 2" && !b.querySelector('[data-faction-id="zb"]') && !b.querySelector('[data-task-id="t4"]') && !b.querySelector(".ft-drafts")
      && texts(b, ".faction-log li").length === 1);
  check("factions tab: players take tasks and send their own, nothing more",
    !!b.querySelector('[data-task-id="t2"] [data-action="acceptTask"]') && !b.querySelector('[data-action="resolveTask"]') && !b.querySelector('[data-action="standingUp"]')
      && !b.querySelector('[data-action="newTask"]') && !b.querySelector('[data-action="newFaction"]') && !b.querySelector(".faction-row .or-name[data-action]")
      && texts(b, '[data-task-id="t2"] select[data-task-soldier] option').join() === "No one yet,Kael (on Clear the dam road)"
      && !!b.querySelector('[data-task-id="t1"] .os-soldier [data-action="recallOperative"]'));

  // The dialogs and the chat card render clean.
  const clean = (label, html) => {
    const doc = new JSDOM(`<body>${html}</body>`).window.document;
    const bad = /undefined|\[object Object\]|NaN/;
    check(`${label}: renders clean`, !bad.test(doc.body.textContent) && [...doc.querySelectorAll("*")].every(el => [...el.attributes].every(a => !bad.test(a.value))), doc.body.textContent.slice(0, 200));
    return doc;
  };
  const fd = clean("faction dialog", tpl("templates/dialog/faction.hbs")({
    faction: store.factions[0], tiers: { major: "Major", minor: "Minor" }, territories: { mal: "Malmstrom" },
    levels: { 4: "+4 Allied", 3: "+3 Trusted", 0: "0 Neutral", "-4": "-4 At War" }, scale: IROP.reputationScale
  }));
  check("faction dialog: every field, set from the faction: its level and the points in its bar",
    fd.querySelector('[name="name"]').value === "Copperhides" && fd.querySelector('[name="tier"] option[selected]')?.value === "minor"
      && fd.querySelector('[name="standing"] option[selected]')?.value === "4" && fd.querySelector('[name="points"]').value === "7" && fd.querySelector('[name="points"]').getAttribute("max") === "10"
      && fd.querySelector('[name="home"] option[selected]')?.value === "mal" && fd.querySelector('[name="notes"]').textContent === "Mutant clan of Malmstrom."
      && !fd.querySelector('[name="hidden"]').checked && !!fd.querySelector("[data-pick-image]"));
  const rules = IROP.strategyRules;
  const td = clean("task dialog", tpl("templates/dialog/faction-task.hbs")({
    task: { faction: "cu", term: rules.factions.taskTurns, standing: rules.factions.taskStanding, failure: rules.factions.taskFailure, rivalLoss: rules.factions.rivalLoss, logistics: 0, intel: 0 },
    isNew: true, factions: { cu: "Copperhides", ps: "Pale Sons" }
  }));
  check("task dialog: a new task starts from the rules, offered at once unless unticked",
    td.querySelector('[name="faction"] option[selected]')?.value === "cu" && td.querySelector('[name="standing"]').value === "2" && td.querySelector('[name="term"]').value === "1"
      && td.querySelector('[name="rival"] option[selected]')?.value === "" && td.querySelector('[name="offer"]').checked
      && ["title", "brief", "failure", "logistics", "intel", "reward", "rivalLoss"].every(n => !!td.querySelector(`[name="${n}"]`)));
  const task1 = normalizeTask(store.factionTasks[0], rules);
  const rd = clean("resolve dialog", tpl("templates/dialog/task-resolve.hbs")({
    task: task1, defaults: resolveDefaults(task1, rules), faction: "Copperhides", rival: "Pale Sons", outcomes: IROP.missionOutcomes, offers: "+2 standing, +20 Logistics"
  }));
  check("resolve dialog: a success's numbers, and the rival's loss",
    rd.querySelector('[name="outcome"] option[selected]')?.value === "success" && rd.querySelector('[name="standing"]').value === "2"
      && rd.querySelector('[name="logistics"]').value === "20" && rd.querySelector('[name="rival"]').value === "-1" && /Standing with Pale Sons/.test(rd.body.textContent));
  const factions = store.factions;
  const offered = clean("task card offered", tpl("templates/chat/faction-task.hbs")(taskCardContext({ ...task1, status: "offered", week: 4, due: 4 }, "offered", { factions })));
  check("task card: offered, with what it offers and when it is due",
    /Task offered, turn 4/.test(offered.body.textContent) && /Offers \+2 standing points, \+20 Logistics, A guide through Malmstrom/.test(offered.body.textContent)
      && /Works against Pale Sons: -1 with them/.test(offered.body.textContent) && /Due by the end of this turn/.test(offered.body.textContent));
  const resolved = clean("task card resolved", tpl("templates/chat/faction-task.hbs")(taskCardContext({ ...task1, status: "resolved", outcome: "success", resolvedWeek: 4,
    result: { standing: 2, rival: -1, logistics: 20, intel: 0, notes: "Road open." } }, "resolved",
  { factions, log: [{ name: "Copperhides", delta: 2, from: { level: 4, points: 7 }, to: { level: 4, points: 9 } }, { name: "Pale Sons", delta: -1, from: { level: -3, points: 1 }, to: { level: -4, points: 5 } }] })));
  check("task card: resolved, with what it gave and where each standing now sits",
    resolved.querySelector(".faction-card").classList.contains("outcome-success")
      && eq(texts(resolved, ".debrief-lines li"), ["+20 Logistics", "Copperhides: +2, Allied, 9 of 10", "Pale Sons: -1, down to At War"])
      && eq([...resolved.querySelectorAll(".debrief-lines li")].map(li => li.className), ["gain", "gain", "heat"])
      && /Road open\./.test(resolved.body.textContent));

  game.user = oldUser;
  game.items = oldItems;
  game.actors = oldActors;
  game.settings = oldSettings;
}

// Event and Dark Event cards (Strategy Layer step 6, 2026-10-08).
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  foundry.applications.api.DocumentSheetV2 ??= class { constructor(options = {}) { this.options = options; this.document = options.document; } get isEditable() { return true; } render() { return this; } };
  const { EventCardData } = await import("../module/data/card.mjs");
  const { EventsApp } = await import("../module/apps/events.mjs");
  const { EventCardSheet } = await import("../module/apps/card-sheet.mjs");
  const { eventCardContext } = await import("../module/strategy/events.mjs");
  const { TurnReport, OdrBoard } = await import("../module/apps/odr.mjs");
  const { WarRoomBar, TerritoryCard } = await import("../module/apps/war-room.mjs");
  const { weekReportContext } = await import("../module/strategy/turn.mjs");
  const { planTurn } = await import("../module/rules/turn.mjs");
  const oldUser = game.user;
  const oldItems = game.items;
  const oldSettings = game.settings;
  const store = { warRoom: { week: 4, phase: "odr", tactical: null }, resourceLedger: [], revealedActions: [], missionLog: [], turnHistory: [] };
  game.settings = { get(scope, key) { if ( key in store ) return foundry.utils.deepClone(store[key]); throw new Error("no settings in tests"); } };
  const terr = (id, name) => { const t = new FakeDoc({}); Object.assign(t, { id, name, type: "territory", img: "t.svg" }); t.system = new itemModels.TerritoryData({ kind: "rural" }, { parent: t }); return t; };
  const items = [terr("ns", "Neo Seattle"), terr("pl", "Portlandia")];
  items.get = id => items.find(i => i.id === id) ?? null;
  game.items = items;
  const card = (id, name, system, flags = {}, extra = {}) => ({
    id, name, description: `<p>${name} text.</p>`, faces: [{ img: `${id}.svg` }], img: `${id}.svg`, flags,
    system: new EventCardData(system), getFlag: (s, k) => flags.irop?.[k], ...extra
  });
  const stackOf = (role, type, cards) => {
    const list = [...cards];
    return { id: role, type, cards: Object.assign(list, { contents: list, size: list.length, get: id => list.find(c => c.id === id) }),
      get availableCards() { return list.filter(c => !c.drawn); }, getFlag: (s, k) => (k === "stack" ? role : undefined) };
  };
  const eventDeck = stackOf("eventDeck", "deck", [card("e1", "Supply Drop", { effect: { logistics: 10 } }), card("e2", "Riot", { negative: true }, {}, { drawn: true })]);
  const darkDeck = stackOf("darkDeck", "deck", [card("d1", "Propaganda", { kind: "dark", effect: { reputation: -1 } })]);
  const inPlay = stackOf("inPlay", "pile", [
    card("p1", "Distress Call", { persistent: true, respond: true, discard: { reputation: -1 }, discardText: "No one came." }, { irop: { territory: "pl", week: 4, kind: "event" } }),
    card("p2", "Reprisal", { kind: "dark", persistent: true, reprisal: true }, { irop: { territory: "ns", week: 3, kind: "dark" } }),
    card("w1", "Ion Storm", { kind: "world", persistent: true, worldwide: true }, { irop: { territory: "", week: 4, kind: "world" } })
  ]);
  const worldDeck = stackOf("worldDeck", "deck", [card("w9", "Refugee Column", { kind: "world", persistent: true }, {}, { drawn: true })]);
  const darkHand = stackOf("darkHand", "hand", [card("h1", "Crackdown", { kind: "dark", discretionary: true, effect: { strength: 1 } }, { irop: { week: 4 } })]);
  const discard = stackOf("discard", "pile", [card("x1", "Riot", { negative: true }, {}, { origin: eventDeck })]);
  game.cards = [eventDeck, darkDeck, worldDeck, inPlay, darkHand, discard];
  const EV_ACTIONS = new Set(Object.keys(EventsApp.DEFAULT_OPTIONS.actions));

  game.user = { isGM: true, name: "GM" };
  let ev = inspect("events window gm", tpl("templates/apps/events.hbs")(await new EventsApp()._prepareContext({})), { actions: EV_ACTIONS, source: {} });
  check("events window: the cards in play, where, until when, what they do on discard",
    ev.querySelectorAll('.ev-section:first-child .ev-card').length === 3 && /Portlandia, until turn 6 starts/.test(ev.querySelector('[data-card-id="p1"] .ev-where').textContent)
      && /respond to it/.test(ev.querySelector('[data-card-id="p1"] .ev-where').textContent) && /Reputation -3\. No one came/.test(ev.querySelector('[data-card-id="p1"] .ev-discard').textContent)
      && /Reprisal/.test(ev.querySelector('[data-card-id="p2"] .ev-flag').textContent) && ev.querySelector('[data-card-id="p2"]').classList.contains("kind-dark"));
  check("events window: the GM's hand plays with a territory, and the decks count what is left",
    !!ev.querySelector('[data-card-id="h1"] select[data-where]') && !!ev.querySelector('[data-card-id="h1"] [data-action="play"]')
      && [...ev.querySelectorAll(".ev-count")].map(c => c.textContent).join("|") === "1 left of 2, 1 discarded|1 left of 1, 0 discarded|0 left of 1, 0 discarded"
      && ev.querySelectorAll('[data-action="newCard"]').length === 3 && !ev.querySelector(".ev-setup") && !ev.querySelector(".ev-warn"));
  check("events window: a worldwide card in play is everywhere",
    /Every territory, until turn 6 starts/.test(ev.querySelector('[data-card-id="w1"] .ev-where').textContent) && ev.querySelector('[data-card-id="w1"]').classList.contains("kind-world"));
  game.user = { isGM: false, name: "Johnald" };
  ev = new JSDOM(tpl("templates/apps/events.hbs")(await new EventsApp()._prepareContext({}))).window.document;
  check("events window: players see what is in play, not the hand, the decks, or the GM's buttons",
    ev.querySelectorAll(".ev-card").length === 3 && !ev.querySelector('[data-action="play"]') && !ev.querySelector(".ev-deck") && !ev.querySelector('[data-action="discard"]'));
  game.cards = [];
  game.user = { isGM: true, name: "GM" };
  ev = new JSDOM(tpl("templates/apps/events.hbs")(await new EventsApp()._prepareContext({}))).window.document;
  check("events window: with no decks, the GM is offered the setup", !!ev.querySelector('.ev-setup [data-action="setup"]'));
  game.documentTypes = { Card: ["base"] };
  ev = new JSDOM(tpl("templates/apps/events.hbs")(await new EventsApp()._prepareContext({}))).window.document;
  check("events window: before the world is relaunched, the GM is told", /Return to Setup and launch the world again/.test(ev.querySelector(".ev-warn")?.textContent ?? ""));
  delete game.documentTypes;
  game.cards = [eventDeck, darkDeck, worldDeck, inPlay, darkHand, discard];

  // The card sheet.
  const sheet = new EventCardSheet({ document: Object.assign(card("d9", "Reprisal", { kind: "dark", persistent: true, reprisal: true, discard: { logistics: -20 } }),
    { toObject: () => ({ faces: [{ img: "d9.svg" }] }) }) });
  const cs = new JSDOM(tpl("templates/cards/event-card.hbs")(await sheet._prepareContext({}))).window.document;
  check("card sheet: deck, the Dark Event switches, and the numbers for revealed and discarded",
    cs.querySelector('select[name="system.kind"] option[selected]')?.value === "dark" && cs.querySelector('input[name="system.reprisal"]').checked
      && !!cs.querySelector('input[name="system.discretionary"]') && cs.querySelectorAll(".ec-effects tbody tr").length === 5
      && cs.querySelector('input[name="system.discard.logistics"]').value === "-20" && !!cs.querySelector('textarea[name="description"]')
      && [...cs.querySelectorAll("[name]")].every(el => ["name", "description"].includes(el.getAttribute("name")) || el.getAttribute("name").startsWith("system.")));
  const evSheet = new JSDOM(tpl("templates/cards/event-card.hbs")(await new EventCardSheet({ document: Object.assign(card("e9", "Supply Drop", {}), { toObject: () => ({}) }) })._prepareContext({}))).window.document;
  check("card sheet: an Event has no Dark Event switches; any card can be worldwide", !evSheet.querySelector('input[name="system.discretionary"]') && /When revealed/.test(evSheet.body.textContent)
    && !!evSheet.querySelector('input[name="system.worldwide"]') && [...cs.querySelectorAll('select[name="system.kind"] option')].map(o => o.textContent).join() === "Event,Dark Event,World Event");
  check("card sheet: its title says which deck", sheet.title === "Dark Event: Reprisal");

  // Never in (Johnald, 2026-10-08): the regions a card never happens in.
  foundry.applications.api.DocumentSheetV2.prototype._onRender ??= async function() {};
  const neverCard = Object.assign(card("d8", "Purge", { kind: "dark", excluded: ["ns"] }), { toObject: () => ({ faces: [{ img: "d8.svg" }] }) });
  const cardWrites = [];
  neverCard.update = async data => { cardWrites.push(data); return neverCard; };
  const nSheet = new EventCardSheet({ document: neverCard });
  const nd = new JSDOM(tpl("templates/cards/event-card.hbs")(await nSheet._prepareContext({}))).window.document;
  check("card sheet: Never in lists the regions it never happens in, and offers the rest",
    [...nd.querySelectorAll(".ec-never .ec-chip")].map(c => c.textContent.trim()).join() === "Neo Seattle"
      && [...nd.querySelectorAll(".ec-never-add option")].map(o => o.textContent).join() === "Add a region,Portlandia"
      && nd.querySelector(".ec-chip-x").dataset.action === "allow" && "allow" in EventCardSheet.DEFAULT_OPTIONS.actions
      && /never lands on these regions at random/.test(nd.querySelector(".ec-never").textContent) && !nd.querySelector(".ec-never-add").hasAttribute("name"));
  nSheet.element = nd.body;
  await nSheet._onRender({}, {});
  const addSelect = nd.querySelector(".ec-never-add");
  addSelect.value = "pl";
  addSelect.dispatchEvent(new nd.defaultView.Event("change", { bubbles: true }));
  check("card sheet: picking a region adds it", JSON.stringify(cardWrites.at(-1)) === JSON.stringify({ "system.excluded": ["ns", "pl"] }));
  await EventCardSheet.DEFAULT_OPTIONS.actions.allow.call(nSheet, {}, { dataset: { id: "ns" } });
  check("card sheet: the x lets it happen there again", JSON.stringify(cardWrites.at(-1)) === JSON.stringify({ "system.excluded": [] }));
  const anywhere = new JSDOM(tpl("templates/cards/event-card.hbs")(await new EventCardSheet({ document: Object.assign(card("e7", "Rally", {}), { toObject: () => ({}) }) })._prepareContext({}))).window.document;
  check("card sheet: a card with no list can happen in any region", /Any region/.test(anywhere.querySelector(".ec-never-list").textContent) && !anywhere.querySelector(".ec-chip"));
  const heldCard = darkHand.cards[0];
  const heldSystem = heldCard.system;
  heldCard.system = new EventCardData({ kind: "dark", discretionary: true, effect: { strength: 1 }, excluded: ["pl"] });
  const evNever = new JSDOM(tpl("templates/apps/events.hbs")(await new EventsApp()._prepareContext({}))).window.document;
  check("events window: a held Dark Event offers only the regions it may be played on",
    [...evNever.querySelectorAll('[data-card-id="h1"] select[data-where] option')].map(o => o.textContent).join() === "Choose a territory,Neo Seattle");
  heldCard.system = heldSystem;

  // Chat: a card played or discarded.
  const played = new JSDOM(tpl("templates/chat/event-card.hbs")(eventCardContext(darkHand.cards[0], { territory: items[1], action: "played", week: 4 }))).window.document;
  check("event card: the Dark Event played, where, what it does",
    /Dark Event played: Portlandia/.test(played.querySelector(".card-sub").textContent) && /Strength \+3/.test(played.body.textContent)
      && played.querySelector(".irop-card").classList.contains("kind-dark"));
  const gone = new JSDOM(tpl("templates/chat/event-card.hbs")(eventCardContext(inPlay.cards[0], { territory: items[1], action: "discarded", week: 6 }))).window.document;
  check("event card: discarded, with its discard effect and words", /Reputation -3/.test(gone.body.textContent) && /No one came/.test(gone.body.textContent) && !/Stays until/.test(gone.body.textContent));

  // The turn report: the cards with their pictures; a Dark Event that hits picks where.
  const plan = planTurn({ week: 3, territories: items.map(t => ({ id: t.id, name: t.name, system: { kind: "rural", control: "genesis", strength: 0, heat: 0, neighbors: [] } })),
    rules: IROP.strategyRules, cards: { inPlay: [], held: [], eventDeck: [{ id: "e1", name: "Supply Drop", img: "e1.svg", system: { effect: { logistics: 10 } } }],
      darkDeck: [{ id: "d1", name: "Reprisal", img: "d1.svg", system: { kind: "dark", persistent: true, reprisal: true } },
        { id: "d2", name: "Propaganda", img: "d2.svg", system: { kind: "dark", effect: { reputation: -1 } } },
        { id: "d3", name: "Crackdown", img: "d3.svg", system: { kind: "dark", discretionary: true } }] }, random: () => 0 });
  const report = new TurnReport();
  report.replan(plan);
  const r = new JSDOM(tpl("templates/apps/turn-report.hbs")(await report._prepareContext({}))).window.document;
  const darkSection = [...r.querySelectorAll(".tr-section")].find(s => /Dark Events/.test(s.querySelector(".section-title").textContent));
  check("turn report: Dark Events drawn with their pictures, two ticked to use, a territory for each that hits one",
    darkSection.querySelectorAll(".tr-line").length === 3 && darkSection.querySelectorAll("img.tr-card").length === 3
      && darkSection.querySelectorAll("input[data-line]:checked").length === 2 && /use 2/.test(darkSection.querySelector(".tr-keep").textContent)
      && darkSection.querySelectorAll("select[data-where]").length === 2
      && [...darkSection.querySelectorAll("select[data-where]")[0].querySelectorAll("option")].map(o => o.textContent).join() === "Choose a territory,Neo Seattle,Portlandia");
  check("turn report: the Event phase's card lands with its picture",
    /Supply Drop lands on/.test([...r.querySelectorAll(".tr-section")].find(s => /Event phase/.test(s.textContent)).textContent) && !r.querySelector(".tr-due"));
  const wr = new JSDOM(tpl("templates/chat/week-report.hbs")(weekReportContext(plan, new Set(plan.lines.map(l => l.id)), new Map([[plan.lines.find(l => l.text === "Reprisal").id, "ns"]])))).window.document;
  check("week card: the cards dealt as small cards, where each went",
    wr.querySelectorAll(".week-card-tile").length === 4 && /Neo Seattle/.test([...wr.querySelectorAll(".week-card-tile")].find(t => /Reprisal/.test(t.textContent)).textContent)
      && /held/.test([...wr.querySelectorAll(".week-card-tile")].find(t => /Crackdown/.test(t.textContent)).textContent)
      && wr.querySelectorAll(".week-card-tile.kind-dark").length === 3);

  // Never in: the report's choice of where a Dark Event hits leaves out where it never happens.
  const purgePlan = planTurn({ week: 3, territories: items.map(t => ({ id: t.id, name: t.name, system: { kind: "rural", control: "genesis", strength: 0, heat: 0, neighbors: [] } })),
    rules: IROP.strategyRules, cards: { inPlay: [], held: [], eventDeck: [], worldDeck: [],
      darkDeck: [{ id: "d5", name: "Purge", img: "d5.svg", system: { kind: "dark", effect: { reputation: -1 }, excluded: ["ns"] } }] }, random: () => 0 });
  const purgeReport = new TurnReport();
  purgeReport.replan(purgePlan);
  const pr = new JSDOM(tpl("templates/apps/turn-report.hbs")(await purgeReport._prepareContext({}))).window.document;
  check("turn report: a Dark Event's choice of where it hits leaves out where it never happens",
    [...pr.querySelectorAll("select[data-where] option")].map(o => o.textContent).join() === "Choose a territory,Portlandia");

  // The territory card, the bar, the board, the debrief.
  const tc = new TerritoryCard();
  tc.territory = items[1];
  const tcd = new JSDOM(tpl("templates/apps/territory-card.hbs")(await tc._prepareContext({}))).window.document;
  check("territory card: the cards in play there", /Distress Call\s*until turn 6 starts/.test(tcd.querySelector(".tc-event")?.textContent ?? ""));
  WarRoomBar.tools = { mapCounts: () => ({ linked: 2, total: 2, regions: 2 }) };
  const bar = new JSDOM(tpl("templates/apps/war-room-bar.hbs")(await new WarRoomBar()._prepareContext({}))).window.document;
  check("war room bar: an Events button for everyone", !!bar.querySelector('[data-action="events"]') && "events" in WarRoomBar.DEFAULT_OPTIONS.actions && !bar.querySelector(".wr-note"));
  const board = new OdrBoard();
  board.tab = "tactical";
  const oldActors = game.actors;
  game.actors = Object.assign([], { get: () => null });
  const b = new JSDOM(tpl("templates/apps/odr-board.hbs")(await board._prepareContext({}))).window.document;
  check("odr board: a card that can be answered is a Tactical Action there", /In play: Portlandia/.test(b.querySelector('[data-choice="card:p1"]')?.textContent ?? "")
    && b.querySelector('[data-choice="card:p1"]').classList.contains("response") && !b.querySelector('[data-choice="card:p2"]'));
  const dd = new JSDOM(tpl("templates/dialog/debrief.hbs")({ label: "Respond: Distress Call", territory: "Portlandia", defaults: { outcome: "success", heat: "minor", reputation: 1, response: true },
    outcomes: IROP.missionOutcomes, heatClasses: IROP.heatClasses, reputationSteps: { "0": "No change", "1": "+1" }, salvagePercent: 30 })).window.document;
  check("debrief dialog: a response can counter the card", dd.querySelector('input[name="countered"]')?.checked === true);

  game.user = oldUser;
  game.items = oldItems;
  game.settings = oldSettings;
  game.actors = oldActors;
  delete game.cards;
}

// Losing Ground (Strategy Layer step 7, 2026-10-08).
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  const { WarRoomBar, TerritoryCard } = await import("../module/apps/war-room.mjs");
  const { OdrBoard } = await import("../module/apps/odr.mjs");
  const { liberationContext } = await import("../module/strategy/losing-ground.mjs");
  const oldUser = game.user;
  const oldItems = game.items;
  const oldActors = game.actors;
  const oldSettings = game.settings;
  const store = { warRoom: { week: 6, phase: "odr", tactical: null }, resourceLedger: [], revealedActions: [], missionLog: [], turnHistory: [],
    incursions: [{ id: "i1", target: "mc", source: "mc2", week: 6 }] };
  game.settings = { get(scope, key) { if ( key in store ) return foundry.utils.deepClone(store[key]); throw new Error("no settings in tests"); } };
  const terr = (id, name, system) => {
    const t = new FakeDoc({});
    Object.assign(t, { id, name, type: "territory", img: "t.svg", uuid: `Item.${id}`, isOwner: true, effects: [] });
    t.getRollData = () => ({});
    t.testUserPermission = () => true;
    t.system = new itemModels.TerritoryData(system, { parent: t });
    return t;
  };
  const items = [
    terr("mc", "Neo Denver", { kind: "megacity", control: "liberated", neighbors: ["s1", "mc2"], landmark: "Mile High Spire", landmarkBonus: "+5 Logistics a week",
      objectives: { citadel: true, motorPool: true, government: true } }),
    terr("mc2", "Neo Cheyenne", { kind: "megacity", strength: 8, heat: 2, neighbors: ["mc", "s1"], objectives: { citadel: true, motorPool: true, government: true }, landmark: "Frontier Arch" }),
    terr("s1", "Aurora Slums", { kind: "slums", heat: 1, neighbors: ["mc", "mc2"] })
  ];
  items.get = id => items.find(i => i.id === id) ?? null;
  game.items = items;
  game.actors = Object.assign([], { get: () => null });
  game.user = { isGM: true, name: "GM" };

  // The territory card.
  const card = new TerritoryCard();
  card.territory = items[0];
  let c = new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  check("territory card: a liberated Megacity is an ODR base with its landmark; an Incursion coming says from where and when",
    /Liberated: an ODR base/.test(c.querySelector(".tc-base")?.textContent ?? "") && /Mile High Spire: \+5 Logistics a week/.test(c.querySelector(".tc-landmark").textContent)
      && !c.querySelector(".tc-landmark").classList.contains("dormant")
      && /Incursion from Neo Cheyenne: lands as turn 7 starts/.test(c.querySelector(".tc-incursion")?.textContent ?? "") && !c.querySelector('[data-action="liberate"]'));
  card.territory = items[1];
  c = new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  check("territory card: a Megacity with all three objectives taken offers the GM Liberate; its landmark waits",
    !!c.querySelector('[data-action="liberate"]') && "liberate" in TerritoryCard.DEFAULT_OPTIONS.actions && c.querySelector(".tc-landmark").classList.contains("dormant"));
  game.user = { isGM: false, name: "Johnald" };
  c = new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  check("territory card: players cannot liberate", !c.querySelector('[data-action="liberate"]'));

  // The bar: an Incursion alert for everyone.
  WarRoomBar.tools = { mapCounts: () => ({ linked: 3, total: 3, regions: 3 }) };
  const bar = new JSDOM(tpl("templates/apps/war-room-bar.hbs")(await new WarRoomBar()._prepareContext({}))).window.document;
  check("war room bar: an Incursion under way shows, and opens the Tactical tab",
    /Incursion/.test(bar.querySelector(".wr-alert")?.textContent ?? "") && bar.querySelector(".wr-alert").dataset.action === "incursion" && "incursion" in WarRoomBar.DEFAULT_OPTIONS.actions);

  // The board: Incursions first, the Megacity count.
  game.user = { isGM: true, name: "GM" };
  const board = new OdrBoard();
  board.tab = "tactical";
  const b = new JSDOM(tpl("templates/apps/odr-board.hbs")(await board._prepareContext({}))).window.document;
  const first = b.querySelector(".odr-choice");
  check("odr board: the Incursion is first, high priority, where GENESIS masses",
    first.classList.contains("priority") && /Stop the Incursion into Neo Denver/.test(first.textContent) && /High priority: Neo Cheyenne/.test(first.textContent));
  check("odr board: the Megacity assault is marked; the Megacities liberated are counted",
    /At a Megacity/.test(b.querySelector('[data-choice="megacityAssault"]').textContent) && /Megacities\s*1\/2/.test(b.querySelector(".odr-head").textContent));

  // The debrief, the liberation dialog, the cards.
  const dd = new JSDOM(tpl("templates/dialog/debrief.hbs")({ label: "Assault a Megacity objective", territory: "Neo Cheyenne", outcomes: IROP.missionOutcomes, heatClasses: IROP.heatClasses,
    reputationSteps: { "0": "No change" }, salvagePercent: 30, defaults: { outcome: "success", heat: "critical", reputation: 0, objectives: [{ key: "motorPool", label: "Motor pool" }], incursion: true } })).window.document;
  check("debrief dialog: the objectives still standing, and what an Incursion mission decides",
    [...dd.querySelectorAll('select[name="objective"] option')].map(o => o.textContent).join() === "None,Motor pool" && /breaks the Incursion/.test(dd.body.textContent));
  const lib = new JSDOM(tpl("templates/dialog/liberation.hbs")(liberationContext(items[1]))).window.document;
  check("liberation dialog: the Megacity fixed, its surroundings ticked, another Megacity left out, the spike shown",
    [...lib.querySelectorAll(".lib-area li")].map(li => li.textContent.replace(/\s+/g, " ").trim()).join("|") === "Neo Cheyenne Megacity|Aurora Slums Slums"
      && lib.querySelector('input[name="free.mc2"]').disabled && lib.querySelector('input[name="free.s1"]').checked && /3 of 3 objectives/.test(lib.body.textContent)
      && /Heat spikes nearby/.test(lib.body.textContent));
  const freed = new JSDOM(tpl("templates/chat/liberation.hbs")({ name: "Neo Cheyenne", week: 6, freed: ["Aurora Slums"], spike: [{ name: "Plains", to: "High" }],
    landmark: "Frontier Arch", landmarkBonus: "", count: { liberated: 2, total: 3 }, victory: false })).window.document;
  check("liberation card: what was freed, the landmark, GENESIS's answer, the count",
    /Neo Cheyenne liberated/.test(freed.body.textContent) && /Freed with it: Aurora Slums/.test(freed.body.textContent) && /Frontier Arch/.test(freed.body.textContent)
      && /Plains to High/.test(freed.body.textContent) && /2 of 3/.test(freed.body.textContent));
  const won = new JSDOM(tpl("templates/chat/liberation.hbs")({ victory: true, week: 9, count: { liberated: 3, total: 3 } })).window.document;
  check("victory card: every Megacity liberated", /Victory/.test(won.body.textContent) && /3 of 3/.test(won.body.textContent) && won.querySelector(".irop-card").classList.contains("victory"));

  // The territory sheet: a Megacity's landmark.
  const { out } = await renderSheet(IropItemSheet, items[1]);
  inspect("item territory step 7", out.details, { actions: ITEM_ACTIONS, source: items[1].system._source });
  const sheet = new JSDOM(out.details).window.document;
  check("territory sheet: a Megacity has its landmark and bonus", sheet.querySelector('input[name="system.landmark"]').value === "Frontier Arch" && !!sheet.querySelector('input[name="system.landmarkBonus"]'));
  check("territory sheet: no landmark for anything but a Megacity",
    !new JSDOM((await renderSheet(IropItemSheet, items[2])).out.details).window.document.querySelector('input[name="system.landmark"]'));

  game.user = oldUser;
  game.items = oldItems;
  game.actors = oldActors;
  game.settings = oldSettings;
}

// The territory card: a header image the GM sets, and the journal's intel (Johnald, 2026-10-08).
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  const { TerritoryCard } = await import("../module/apps/war-room.mjs");
  const oldUser = game.user;
  const oldItems = game.items;
  const oldJournal = game.journal;
  const terr = (id, name, system, { observer = true } = {}) => {
    const t = new FakeDoc({});
    Object.assign(t, { id, name, type: "territory", img: "t.svg", uuid: `Item.${id}`, isOwner: true, effects: [] });
    t.getRollData = () => ({});
    t.testUserPermission = user => !!user?.isGM || observer;
    t.update = async () => t;
    t.system = new itemModels.TerritoryData(system, { parent: t });
    return t;
  };
  const page = (id, name, html, { seen = true, entry } = {}) => ({
    id, name, uuid: `JournalEntry.lore.JournalEntryPage.${id}`, documentName: "JournalEntryPage", type: "text", sort: 0,
    text: { content: html }, parent: entry, testUserPermission: user => !!user?.isGM || seen
  });
  const lore = { id: "lore", name: "Lore", uuid: "JournalEntry.lore", documentName: "JournalEntry" };
  const pages = [page("p1", "Neo Seattle", "<p>The Emerald Spire still stands.</p>", { entry: lore }), page("p2", "Portlandia", "<p>Classified.</p>", { seen: false, entry: lore })];
  lore.pages = { contents: pages };
  lore.testUserPermission = () => true;
  game.journal = { contents: [lore] };
  const items = [
    terr("ns", "Neo Seattle", { kind: "megacity", art: "art/neo-seattle.webp" }),
    terr("pl", "Portlandia", { kind: "wildland", control: "liberated" }),
    terr("rn", "Reno", { kind: "slums", control: "contested", description: "<p>A desert town.</p>" }, { observer: false }),
    terr("lk", "Black Hills", { kind: "rural", journal: "JournalEntry.lore" })
  ];
  items.get = id => items.find(i => i.id === id) ?? null;
  game.items = items;
  const card = new TerritoryCard();
  const show = async (t, user) => {
    game.user = user;
    card.territory = t;
    return new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  };
  let c = await show(items[0], { isGM: true, name: "GM" });
  check("territory card: the GM's header image, edge to edge, the name over it; the GM can change it from the card",
    c.querySelector(".tc-header").classList.contains("with-art") && c.querySelector(".tc-header img.tc-art").getAttribute("src") === "art/neo-seattle.webp"
      && c.querySelector(".tc-name").textContent === "Neo Seattle" && c.querySelector(".tc-header").dataset.action === "editArt" && "editArt" in TerritoryCard.DEFAULT_OPTIONS.actions);
  check("territory card: the journal page named like it is its intel, with a way to open it",
    /Emerald Spire/.test(c.querySelector(".tc-intel-text").innerHTML) && /Neo Seattle/.test(c.querySelector(".tc-intel-head small").textContent)
      && c.querySelector('.tc-journal-link[data-action="openJournal"]').dataset.uuid === "JournalEntry.lore.JournalEntryPage.p1");
  c = await show(items[0], { isGM: false, name: "Johnald" });
  check("territory card: players see the journal they may see; they cannot change the header", /Emerald Spire/.test(c.querySelector(".tc-intel-text")?.innerHTML ?? "") && !c.querySelector('[data-action="editArt"]'));
  c = await show(items[1], { isGM: false, name: "Johnald" });
  check("territory card: a journal the players may not see reads as no intel on file, and is not offered to open",
    /No intel on file/.test(c.querySelector(".tc-classified")?.textContent ?? "") && !c.querySelector(".tc-intel-text") && !c.querySelector(".tc-journal-link"));
  check("territory card: with no image, a banner in the holder's colour", !c.querySelector(".tc-art") && c.querySelector(".tc-header").classList.contains("control-liberated"));
  c = await show(items[1], { isGM: true, name: "GM" });
  check("territory card: the GM sees every journal", /Classified/.test(c.querySelector(".tc-intel-text").innerHTML));
  c = await show(items[2], { isGM: true, name: "GM" });
  check("territory card: with no journal, the lore on its sheet", /A desert town/.test(c.querySelector(".tc-intel-text").innerHTML) && !c.querySelector(".tc-journal-link"));
  c = await show(items[2], { isGM: false, name: "Johnald" });
  check("territory card: that lore follows the territory's own permission", /No intel on file/.test(c.querySelector(".tc-classified")?.textContent ?? ""));
  c = await show(items[3], { isGM: true, name: "GM" });
  check("territory card: a linked journal entry shows its first page", /Emerald Spire/.test(c.querySelector(".tc-intel-text").innerHTML));
  check("territory card: half as wide again, 600", TerritoryCard.DEFAULT_OPTIONS.position.width === 600);

  // The territory sheet: the header image picker and the journal box.
  game.user = { isGM: true, name: "GM" };
  let out = (await renderSheet(IropItemSheet, items[0])).out.details;
  inspect("item territory card fields", out, { actions: ITEM_ACTIONS, source: items[0].system._source });
  let d = new JSDOM(out).window.document;
  check("territory sheet: the header image is a picker, with a preview",
    d.querySelector('file-picker[name="system.art"]')?.getAttribute("value") === "art/neo-seattle.webp" && d.querySelector(".territory-art-preview")?.getAttribute("src") === "art/neo-seattle.webp");
  check("territory sheet: the journal named like it is shown, ready to open; a drop links another",
    /Showing\s*Lore: Neo Seattle, named like this territory/.test(d.querySelector(".territory-journal").textContent) && !!d.querySelector("[data-journal-drop]")
      && !!d.querySelector('.territory-journal [data-action="openJournal"]'));
  out = (await renderSheet(IropItemSheet, items[3])).out.details;
  d = new JSDOM(out).window.document;
  check("territory sheet: a linked journal can be opened or unlinked", /Lore/.test(d.querySelector(".territory-journal .neighbor-chip").textContent)
    && !!d.querySelector('[data-action="unlinkJournal"]'));
  out = (await renderSheet(IropItemSheet, items[2])).out.details;
  check("territory sheet: with nothing to show, it says the card uses the description", /the card shows the description/.test(new JSDOM(out).window.document.querySelector(".territory-journal").textContent));

  game.user = oldUser;
  game.items = oldItems;
  game.journal = oldJournal;
}

// Facilities on the territory card, each side's (Johnald, 2026-10-08).
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  const { TerritoryCard } = await import("../module/apps/war-room.mjs");
  const oldUser = game.user;
  const oldItems = game.items;
  const t = new FakeDoc({});
  Object.assign(t, { id: "nd", name: "Neo Denver", type: "territory", img: "t.svg", uuid: "Item.nd", isOwner: true, effects: [] });
  t.getRollData = () => ({});
  t.testUserPermission = () => true;
  const writes = [];
  t.update = async data => { writes.push(data); return t; };
  t.system = new itemModels.TerritoryData({
    kind: "megacity", objectives: { citadel: true },
    facilities: {
      rebellion: [{ name: "Safe house", note: "Under the old mall" }, { name: "Supply cache", down: true }],
      genesis: [{ name: "Security station" }, { name: "Propaganda center", hidden: true }, { name: "" }]
    }
  }, { parent: t });
  const sam = new FakeDoc({});
  Object.assign(sam, { id: "sam", name: "SAM Site", type: "project" });
  sam.system = new itemModels.ProjectData({ kind: "engineering", builds: "regional", status: "complete", territory: "nd", cost: 60, progress: 60 }, { parent: sam });
  const items = [t, sam];
  items.get = id => items.find(i => i.id === id) ?? null;
  game.items = items;
  const card = new TerritoryCard();
  card.territory = t;
  const view = async user => {
    game.user = user;
    return new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  };
  let c = await view({ isGM: true, name: "GM" });
  const lists = [...c.querySelectorAll(".tc-fac-list")];
  const names = list => [...list.querySelectorAll("li .fac-name")].map(n => n.textContent).join();
  check("facilities: two columns, the numbers beside each side's facilities", !!c.querySelector(".tc-columns .tc-stats") && !!c.querySelector(".tc-columns .tc-facilities"));
  check("facilities: the Rebellion's, with the upgrades built here first",
    names(lists[0]) === "SAM Site,Safe house,Supply cache" && /Under the old mall/.test(lists[0].textContent) && lists[0].querySelectorAll("li.down").length === 1);
  check("facilities: GENESIS's, with a Megacity's objectives, the one taken struck through; blank rows skipped",
    names(lists[1]) === "Military citadel,Motor pool,Center of government,Security station,Propaganda center"
      && lists[1].querySelector("li.down .fac-name").textContent === "Military citadel" && lists[1].querySelector("li.hidden-fac .fa-eye-slash"));
  c = await view({ isGM: false, name: "Johnald" });
  check("facilities: players do not see what the GM keeps hidden", !/Propaganda center/.test(c.querySelector(".tc-facilities").textContent) && /Security station/.test(c.querySelector(".tc-facilities").textContent));

  // The sheet: rows to edit, with what the card adds by itself above them.
  game.user = { isGM: true, name: "GM" };
  const { out } = await renderSheet(IropItemSheet, t);
  inspect("item territory facilities", out.details, { actions: ITEM_ACTIONS, source: t.system._source });
  const d = new JSDOM(out.details).window.document;
  check("facilities sheet: a list for each side, each row a name, a note, down and GM only",
    d.querySelectorAll('.facility-list[data-facility-side="rebellion"] .facility-row').length === 2 && d.querySelectorAll('.facility-list[data-facility-side="genesis"] .facility-row').length === 3
      && d.querySelector('.facility-list.genesis .facility-row [data-facility-field="hidden"]') && /Destroyed/.test(d.querySelector(".facility-list.genesis .facility-row").textContent)
      && /Lost/.test(d.querySelector(".facility-list.rebellion .facility-row").textContent));
  check("facilities sheet: the upgrades and objectives the card adds show above the rows",
    /SAM Site/.test(d.querySelector(".facility-list.rebellion .facility-auto").textContent) && d.querySelectorAll(".facility-list.genesis .facility-auto").length === 3);
  const sheet = new IropItemSheet(t);
  await IropItemSheet.DEFAULT_OPTIONS.actions.addFacility.call(sheet, {}, { dataset: { side: "genesis" } });
  check("facilities sheet: Add puts an empty row on that side", writes.at(-1)["system.facilities.genesis"].length === 4 && writes.at(-1)["system.facilities.genesis"][3].name === "");
  const row = d.querySelector('.facility-list.rebellion .facility-row[data-facility-index="1"] [data-action="removeFacility"]');
  await IropItemSheet.DEFAULT_OPTIONS.actions.removeFacility.call(sheet, {}, row);
  check("facilities sheet: the x takes that row away", writes.at(-1)["system.facilities.rebellion"].map(f => f.name).join() === "Safe house");
  game.user = oldUser;
  game.items = oldItems;
}

// The weather on the territory card (Johnald, 2026-10-08).
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  const { TerritoryCard } = await import("../module/apps/war-room.mjs");
  const { briefingContext } = await import("../module/strategy/odr.mjs");
  const { weatherFor } = await import("../module/rules/weather.mjs");
  const { weatherSeason } = await import("../module/calendar.mjs");
  const calRules = await import("../module/rules/calendar.mjs");
  const oldUser = game.user;
  const oldTime = game.time;
  // The calendar sets the season (2026-10-08): 2 June 2040 is summer.
  game.time = { worldTime: calRules.dateToTime(calRules.normalizeCalendar({}), { year: 2040, month: 5, dayOfMonth: 1, hour: 8 }) };
  const t = new FakeDoc({});
  Object.assign(t, { id: "gl", name: "The Glasslands", type: "territory", img: "t.svg", uuid: "Item.gl", isOwner: true, effects: [] });
  t.getRollData = () => ({});
  t.testUserPermission = () => true;
  const writes = [];
  t.update = async data => { writes.push(data); return t; };
  t.system = new itemModels.TerritoryData({ kind: "wildland", climate: "arid", modifiers: "Paraphysical Storms", weatherSalt: 2 }, { parent: t });
  const card = new TerritoryCard();
  card.territory = t;
  game.user = { isGM: true, name: "GM" };
  let c = new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  const w = weatherFor({ id: "gl", turn: 1, climate: "arid", modifiers: "Paraphysical Storms", salt: 2, season: weatherSeason() });
  const badge = c.querySelector(".tc-header .tc-weather");
  check("weather badge: in the header's corner, this turn's weather for this territory",
    !!badge && badge.classList.contains(`wx-${w.key}`) && badge.querySelector(".wx-label").textContent === w.label
      && new RegExp(`${w.tempF}\\u00B0\\s*F`).test(badge.querySelector(".wx-temp").textContent)
      && new RegExp(`${w.tempC}\\u00B0C, wind ${w.wind} mph ${w.direction}, Summer`).test(badge.querySelector(".wx-detail").textContent));
  check("weather badge: the GM can roll it again", badge.dataset.action === "rerollWeather" && "rerollWeather" in TerritoryCard.DEFAULT_OPTIONS.actions);
  await TerritoryCard.DEFAULT_OPTIONS.actions.rerollWeather.call(card, { stopPropagation() {} });
  check("weather badge: a reroll counts up, for everyone to see", writes.at(-1)["system.weatherSalt"] === 3);
  game.user = { isGM: false, name: "Johnald" };
  c = new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  check("weather badge: players see it, and cannot reroll it", !!c.querySelector(".tc-weather") && !c.querySelector('[data-action="rerollWeather"]'));
  const brief = briefingContext({ label: "Ambush Patrols", rewards: "" }, t, { rules: IROP.strategyRules, week: 1 });
  check("briefing: the weather where the mission goes", brief.weather.startsWith(`${w.label}, ${w.tempF}°F`));
  game.user = { isGM: true, name: "GM" };
  const d = new JSDOM((await renderSheet(IropItemSheet, t)).out.details).window.document;
  check("territory sheet: its climate", d.querySelector('select[name="system.climate"] option[selected]')?.textContent === "Desert"
    && d.querySelectorAll('select[name="system.climate"] option').length === 6);
  game.user = oldUser;
  game.time = oldTime;
}

// The GM's own weather for a territory, and Celsius or Fahrenheit (Johnald, 2026-10-08).
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  const { TerritoryCard } = await import("../module/apps/war-room.mjs");
  const { briefingContext } = await import("../module/strategy/odr.mjs");
  const { territoryWeather } = await import("../module/rules/weather.mjs");
  const oldUser = game.user;
  const oldSettings = game.settings;
  const make = system => {
    const t = new FakeDoc({});
    Object.assign(t, { id: "nd", name: "Neo Denver", type: "territory", img: "t.svg", uuid: "Item.nd", isOwner: true, effects: [] });
    t.getRollData = () => ({});
    t.testUserPermission = () => true;
    t.writes = [];
    t.update = async data => { t.writes.push(data); return t; };
    t.system = new itemModels.TerritoryData(system, { parent: t });
    return t;
  };
  game.user = { isGM: true, name: "GM" };
  const unit = u => { game.settings = { get(scope, key) { if ( key === "temperatureUnit" ) return u; throw new Error("no settings in tests"); } }; };
  unit("F");
  let t = make({ kind: "megacity", climate: "alpine" });
  let out = (await renderSheet(IropItemSheet, t)).out.details;
  inspect("item territory weather", out, { actions: ITEM_ACTIONS, source: t.system._source });
  let d = new JSDOM(out).window.document;
  check("weather sheet: the climate, a summary of it, and Customize",
    d.querySelector('.territory-weather select[name="system.climate"] option[selected]')?.textContent === "Mountain"
      && /Mountain: about 45°F on average, 20° either way/.test(d.querySelector(".territory-weather .hint").textContent)
      && !!d.querySelector('[data-action="customizeWeather"]') && !d.querySelector(".tw-chances"));
  await IropItemSheet.DEFAULT_OPTIONS.actions.customizeWeather.call(new IropItemSheet(t), {}, {});
  const set = t.writes.at(-1)["system.weather"];
  check("weather sheet: Customize starts from the climate's numbers, smog and all", set.custom && set.base === 45 && set.weights.snow === 12 && set.weights.smog === 12);
  t = make({ kind: "megacity", climate: "alpine", weather: { ...set } });
  out = (await renderSheet(IropItemSheet, t)).out.details;
  inspect("item territory weather custom", out, { actions: ITEM_ACTIONS, source: t.system._source });
  d = new JSDOM(out).window.document;
  const chance = key => d.querySelector(`input[name="system.weather.weights.${key}"]`);
  check("weather sheet: customized, the temperatures and a chance for every condition, each with its share",
    d.querySelector('[data-weather-temp="base"]').value === "45" && d.querySelector('[data-weather-temp="swing"]').value === "20"
      && d.querySelectorAll(".tw-chance").length === 12 && chance("snow").value === "12"
      && /^\d+%$/.test(d.querySelector(".tw-chance .tw-share").textContent) && !!d.querySelector('[data-action="resetWeather"]')
      && d.querySelector('select[name="system.climate"]').disabled);
  await IropItemSheet.DEFAULT_OPTIONS.actions.resetWeather.call(new IropItemSheet(t), {}, {});
  check("weather sheet: Back to the climate", t.writes.at(-1)["system.weather.custom"] === false);
  unit("C");
  d = new JSDOM((await renderSheet(IropItemSheet, t)).out.details).window.document;
  check("weather sheet: in Celsius, the temperatures are shown in Celsius", d.querySelector('[data-weather-temp="base"]').value === "7"
    && d.querySelector('[data-weather-temp="swing"]').value === "11" && /°C/.test(d.querySelector(".tw-temps").textContent));
  const card = new TerritoryCard();
  card.territory = t;
  const c = new JSDOM(tpl("templates/apps/territory-card.hbs")(await card._prepareContext({}))).window.document;
  const w = territoryWeather("nd", t.system, 1, (await import("../module/calendar.mjs")).weatherSeason());
  check("weather badge: in Celsius, Celsius large and Fahrenheit small",
    new RegExp(`^${w.tempC}°\\s*C$`).test(c.querySelector(".wx-temp").textContent.trim()) && c.querySelector(".wx-detail").textContent.startsWith(`${w.tempF}°F`));
  check("briefing: in the GM's unit", briefingContext({ label: "x" }, t, { rules: IROP.strategyRules, week: 1 }).weather.includes(`${w.tempC}°C (${w.tempF}°F)`));
  game.user = oldUser;
  game.settings = oldSettings;
}

// The calendar (Johnald, 2026-10-08): its window, the GM's settings, the date bar, the date on the Strategy Layer.
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  const { CalendarApp, CalendarEditor, DateBar, addCalendarControl } = await import("../module/apps/calendar.mjs");
  const { WarRoomBar } = await import("../module/apps/war-room.mjs");
  const { briefingContext } = await import("../module/strategy/odr.mjs");
  const { weekReportContext } = await import("../module/strategy/turn.mjs");
  const glue = await import("../module/calendar.mjs");
  const calRules = await import("../module/rules/calendar.mjs");
  const api = foundry.applications.api;
  const g = calRules.normalizeCalendar({});
  const oldUser = game.user;
  const oldSettings = game.settings;
  const oldTime = game.time;
  const realConfirm = api.DialogV2.confirm;
  const store = {};
  game.settings = {
    get(scope, key) { if ( key in store ) return foundry.utils.deepClone(store[key]); throw new Error("no settings in tests"); },
    async set(scope, key, value) { store[key] = foundry.utils.deepClone(value); if ( key === "calendar" ) glue.forgetCalendar(); return value; }
  };
  glue.forgetCalendar();
  game.time = {
    worldTime: calRules.dateToTime(g, { year: 2040, month: 5, dayOfMonth: 9, hour: 8, minute: 30 }),
    async advance(s) { this.worldTime += s; return this.worldTime; },
    async set(s) { this.worldTime = s; return s; }
  };
  game.user = { isGM: true, name: "GM", id: "gm" };
  const page = async app => new JSDOM(tpl("templates/apps/calendar.hbs")(await app._prepareContext({}))).window.document;
  const acts = CalendarApp.DEFAULT_OPTIONS.actions;

  // The window.
  const app = new CalendarApp();
  let d = await page(app);
  check("calendar window: today in words, its season and time, June's page with today marked",
    d.querySelector(".cal-date").textContent === "Sunday, 10 June 2040" && /Summer/.test(d.querySelector(".cal-sub").textContent)
      && /08:30/.test(d.querySelector(".cal-sub").textContent) && d.querySelector(".cal-title").textContent === "June 2040"
      && d.querySelector(".cal-day.today").textContent.trim() === "10" && d.querySelectorAll("th").length === 7);
  check("calendar window: the GM's controls, every action known",
    !!d.querySelector(".cal-gm") && d.querySelectorAll('button[data-action="pick"]').length === 30
      && [...d.querySelectorAll("[data-action]")].every(b => b.dataset.action in acts) && /moves the date on 7 days/.test(d.querySelector(".cal-foot").textContent));
  await acts.month.call(app, {}, { dataset: { delta: "1" } });
  d = await page(app);
  check("calendar window: the pages turn, and Today brings them back",
    d.querySelector(".cal-title").textContent === "July 2040" && !!d.querySelector('[data-action="toToday"]') && !d.querySelector(".cal-day.today"));
  await acts.toToday.call(app);
  await acts.pick.call(app, {}, { dataset: { day: "20" } });
  d = await page(app);
  check("calendar window: the GM picks a day", d.querySelector(".cal-day.picked")?.textContent.trim() === "21" && d.querySelector(".cal-picked").textContent === "Thursday, 21 June 2040");
  app.element = { querySelector: () => ({ value: "14:15" }) };
  await acts.setDate.call(app);
  check("calendar window: Set moves the date to the picked day, at the time entered",
    glue.dateInfo().long === "Thursday, 21 June 2040" && glue.dateInfo().time === "14:15" && app.picked === null);
  await acts.step.call(app, {}, { dataset: { days: "-7" } });
  check("calendar window: a week back", glue.dateInfo().long === "Thursday, 14 June 2040" && glue.dateInfo().time === "14:15");
  game.user = { isGM: false, name: "Johnald", id: "p1" };
  d = await page(app);
  const was = game.time.worldTime;
  let refused = false;
  try { await acts.step.call(app, {}, { dataset: { days: "7" } }); }
  catch { refused = true; }
  check("calendar window: players see the page, without the GM's controls, and cannot move the date",
    !d.querySelector(".cal-gm") && !d.querySelector('[data-action="pick"]') && d.querySelectorAll("span.cal-day").length === 30 && game.time.worldTime === was && !refused);
  game.user = { isGM: true, name: "GM", id: "gm" };

  // The GM's settings.
  const ed = new CalendarEditor();
  const form = async () => {
    const doc = new JSDOM(tpl("templates/apps/calendar-editor.hbs")(await ed._prepareContext({}))).window.document;
    ed.element = doc.body;
    return doc;
  };
  const edActs = CalendarEditor.DEFAULT_OPTIONS.actions;
  let e = await form();
  check("calendar settings: where the date shows, the turn link, Gregorian, 12 months, 7 weekdays, 4 seasons, today's weekday",
    e.querySelector('[name="show.strategy"]').checked && !e.querySelector('[name="show.dateBar"]').checked && e.querySelector('[name="turnDays"]').value === "7"
      && /Gregorian/.test(e.querySelector(".ce-tag")?.textContent ?? "") && e.querySelectorAll(".ce-months .ce-row").length === 12
      && e.querySelectorAll(".ce-weekdays .ce-row").length === 7 && e.querySelectorAll(".ce-seasons .ce-row").length === 4
      && e.querySelector('[name="anchor"] option[selected]')?.textContent === "Thursday" && /365 days, 366 in a leap year/.test(e.body.textContent)
      && !e.querySelector('[name="leap.every"][type="number"]') && [...e.querySelectorAll("[data-action]")].every(b => b.dataset.action in edActs));
  e.querySelector('[name="months.0.name"]').value = "Thaw";
  e.querySelector('[name="show.dateBar"]').checked = true;
  e.querySelector('[name="turnDays"]').value = "14";
  await edActs.addRow.call(ed, {}, { dataset: { list: "months" } });
  e = await form();
  check("calendar settings: a month added, what was typed kept, Gregorian no more",
    e.querySelectorAll(".ce-months .ce-row").length === 13 && e.querySelector('[name="months.0.name"]').value === "Thaw"
      && e.querySelector('[name="months.12.name"]').value === "Month 13" && e.querySelector('[name="show.dateBar"]').checked
      && e.querySelector('[name="turnDays"]').value === "14" && !e.querySelector(".ce-tag"));
  await edActs.removeRow.call(ed, {}, { dataset: { list: "months", index: "12" } });
  for ( let i = 0; i < 6; i++ ) await (async () => { await form(); await edActs.moveRow.call(ed, {}, { dataset: { list: "weekdays", index: String(i), dir: "down" } }); })();
  e = await form();
  check("calendar settings: Sunday moved to the end makes a week from Monday, today still a Thursday",
    [...e.querySelectorAll(".ce-weekdays .ce-row input[name$='.name']")].map(i => i.value).join() === "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday"
      && e.querySelector('[name="anchor"] option[selected]')?.textContent === "Thursday");
  await edActs.removeRow.call(ed, {}, { dataset: { list: "seasons", index: "3" } });
  e = await form();
  e.querySelector('[name="months.5.days"]').value = "10";
  await CalendarEditor.DEFAULT_OPTIONS.form.handler.call(ed, {}, e.body, {});
  check("calendar settings: saved, and today kept its weekday and its date (June now ends on the 10th)",
    store.calendar.months[0].name === "Thaw" && store.calendar.months[5].days === 10 && store.calendar.seasons.length === 3
      && store.calendarDateBar === true && store.calendarWarRoom === true && store.calendarTurnDays === 14
      && glue.dateInfo().long === "Thursday, 10 June 2040" && glue.dateInfo().time === "14:15", glue.dateInfo().long);
  d = await page(app);
  check("calendar window: the saved calendar shows, its week from Monday",
    d.querySelectorAll("th")[0].textContent === "Mon" && d.querySelectorAll("button.cal-day").length === 10 && /moves the date on 14 days/.test(d.querySelector(".cal-foot").textContent)
      && !!d.querySelector('[data-action="step"][data-days="14"]'));
  api.DialogV2.confirm = async () => true;
  await form();
  await edActs.gregorian.call(ed);
  e = await form();
  await CalendarEditor.DEFAULT_OPTIONS.form.handler.call(ed, {}, e.body, {});
  check("calendar settings: back to Gregorian puts today on its true weekday",
    calRules.sameCalendar(store.calendar, calRules.GREGORIAN) && glue.dateInfo().long === "Sunday, 10 June 2040");
  api.DialogV2.confirm = realConfirm;

  // On the Strategy Layer, and elsewhere.
  WarRoomBar.tools = { mapCounts: () => ({ linked: 1, total: 1, regions: 1 }) };
  let bar = new JSDOM(tpl("templates/apps/war-room-bar.hbs")(await new WarRoomBar()._prepareContext({}))).window.document;
  check("war room bar: the date first, opening the calendar", bar.querySelector(".wr-date")?.textContent.trim() === "Sun 10 Jun 2040"
    && bar.querySelector(".wr-date").dataset.action === "calendar" && "calendar" in WarRoomBar.DEFAULT_OPTIONS.actions
    && bar.querySelector(".war-room-bar").firstElementChild.classList.contains("wr-date"));
  const brief = briefingContext({ label: "Ambush Patrols" }, null, { rules: IROP.strategyRules, week: 1 });
  const report = new JSDOM(tpl("templates/chat/week-report.hbs")(weekReportContext({ week: 2, lines: [], due: [] }, new Set(), new Map(), { date: glue.dateInfo().long }))).window.document;
  check("strategy layer: the date in the briefing and on the turn's report", brief.date === "Sunday, 10 June 2040"
    && new JSDOM(tpl("templates/chat/mission-brief.hbs")(brief)).window.document.querySelector(".mission-intel dd").textContent === "Sunday, 10 June 2040"
    && report.querySelector(".week-date")?.textContent.trim() === "Sunday, 10 June 2040");
  store.calendarWarRoom = false;
  bar = new JSDOM(tpl("templates/apps/war-room-bar.hbs")(await new WarRoomBar()._prepareContext({}))).window.document;
  check("strategy layer: with the date off, no date on the bar or the briefing", !bar.querySelector(".wr-date")
    && briefingContext({ label: "Ambush Patrols" }, null, { rules: IROP.strategyRules, week: 1 }).date === "");
  const strip = new JSDOM(tpl("templates/apps/date-bar.hbs")(await new DateBar()._prepareContext({}))).window.document;
  check("date bar: the date and season, opening the calendar", /Sun 10 Jun 2040/.test(strip.body.textContent) && /Summer/.test(strip.body.textContent)
    && strip.querySelector(".date-bar").dataset.action === "open" && "open" in DateBar.DEFAULT_OPTIONS.actions);
  check("date bar: shown off the War Room when the GM turns it on, never on a War Room", DateBar.sync(false) !== null && DateBar.sync(true) === null);
  store.calendarDateBar = false;
  check("date bar: hidden when off", DateBar.sync(false) === null);
  const controls = { notes: { tools: {} }, tokens: { tools: {} } };
  addCalendarControl(controls);
  check("calendar: a Calendar button in the Journal Notes tools, for everyone",
    controls.notes.tools.iropCalendar?.button === true && controls.notes.tools.iropCalendar.visible === true && typeof controls.notes.tools.iropCalendar.onChange === "function");
  const older = [];
  addCalendarControl(older);
  check("calendar: an older list of controls is left alone", older.length === 0);

  game.user = oldUser;
  game.settings = oldSettings;
  game.time = oldTime;
  glue.forgetCalendar();
}

// Foundry keeps the actions tab, close and toggleControls for itself and never calls a window's own
// handler for them (the ODR board's tabs were dead, 2026-10-08). Only Foundry's own tab groups may use "tab".
{
  const reserved = [];
  (function walk(dir) {
    for ( const f of fs.readdirSync(dir) ) {
      const p = path.join(dir, f);
      if ( fs.statSync(p).isDirectory() ) { walk(p); continue; }
      if ( !f.endsWith(".mjs") ) continue;
      fs.readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => {
        if ( /^\s+(tab|close|toggleControls):\s*([A-Z(]|async)/.test(line) ) reserved.push(`${path.relative(ROOT, p)}:${i + 1}`);
      });
    }
  })(path.join(ROOT, "module"));
  (function walk(dir) {
    for ( const f of fs.readdirSync(dir) ) {
      const p = path.join(dir, f);
      if ( fs.statSync(p).isDirectory() ) { walk(p); continue; }
      if ( !f.endsWith(".hbs") ) continue;
      for ( const m of fs.readFileSync(p, "utf8").matchAll(/<[^>]*data-action="(tab|close|toggleControls)"[^>]*>/g) ) {
        if ( (m[1] !== "tab") || !/data-group=/.test(m[0]) ) reserved.push(`${path.relative(ROOT, p)}: ${m[0].slice(0, 60)}`);
      }
    }
  })(path.join(ROOT, "templates"));
  check("no window uses an action name Foundry keeps for itself", reserved.length === 0, reserved.join(" | "));
}

// Foundry gives .application only to framed windows, so every frameless window and the chat cards
// need the accent colour set for them (bug, 2026-10-08: the project strip's bars filled invisibly).
{
  const css = fs.readFileSync(path.join(ROOT, "styles/irop.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const accented = new Set();
  for ( const block of css.split("}") ) {
    const [sel, body = ""] = block.split("{");
    if ( !/--irop-accent\s*:/.test(body) ) continue;
    for ( const s of sel.split(",") ) accented.add(s.trim());
  }
  const frameless = [];
  (function walk(dir) {
    for ( const f of fs.readdirSync(dir) ) {
      const p = path.join(dir, f);
      if ( fs.statSync(p).isDirectory() ) { walk(p); continue; }
      if ( !f.endsWith(".mjs") ) continue;
      for ( const m of fs.readFileSync(p, "utf8").matchAll(/classes:\s*\[([^\]]*)\],\s*window:\s*\{\s*frame:\s*false/g) ) {
        frameless.push(...m[1].split(",").map(c => c.trim().replace(/"/g, "")).filter(c => c && (c !== "irop")));
      }
    }
  })(path.join(ROOT, "module"));
  const missing = [...frameless, "irop-card"].filter(c => !accented.has(`.${c}`));
  check("every frameless window, and the chat cards, has the accent colour", frameless.length >= 3 && !missing.length, missing.join());
}

// Card text two sizes larger (Johnald, 2026-10-08): the chat cards' own text sits 2px over Foundry's
// chat text, and no card body text is set below 14px. Titles, sub-titles and row labels may be smaller.
{
  const css = fs.readFileSync(path.join(ROOT, "styles/irop.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const LABELS = /\.card-sub|\.mission-intel dt|\.label\b|\.week-phase|\.tr-phase/;
  const small = [];
  let base = "";
  for ( const block of css.split("}") ) {
    const [selRaw, body = ""] = block.split("{");
    const sel = selRaw.trim().replace(/\s+/g, " ");
    if ( sel === ".irop-card" ) base = (body.match(/font-size:\s*([^;]+)/) ?? [])[1] ?? "";
    if ( !sel.startsWith(".irop-card") || LABELS.test(sel) ) continue;
    const size = (body.match(/font-size:\s*([^;]+)/) ?? [])[1];
    if ( !size ) continue;
    const px = { "var(--irop-small-size)": 14, "var(--irop-label-size)": 15 }[size.trim()] ?? parseFloat(size);
    if ( Number.isFinite(px) && (px < 16) ) small.push(`${sel}: ${size}`);
  }
  check("chat cards: their text is 4px over Foundry's chat text (2026-10-16)", base.trim() === "calc(1em + 4px)", base);
  check("chat cards: no body text under 16px", !small.length, small.join(" | "));
  // Item and card sheets too (Johnald, 2026-10-08: "weapons, species, perks, etc").
  const sheetRule = css.split("}").find(b => b.split("{")[0].trim().replace(/\s+/g, " ") === ".application.irop:is(.item-sheet, .event-card-sheet) .window-content") ?? "";
  check("item and card sheets: their text and the small sizes larger again, in the window body",
    /--irop-label-size:\s*17px/.test(sheetRule) && /--irop-small-size:\s*16px/.test(sheetRule) && /font-size:\s*calc\(var\(--font-size-14, 14px\) \+ 4px\)/.test(sheetRule));
}

// Reset character (Johnald, 2026-10-08): one option in the sheet's menu, after a confirm.
{
  const reset = await import("../module/reset.mjs");
  const api = foundry.applications.api;
  const oldUser = game.user;
  const oldUsers = game.users;
  const oldUi = globalThis.ui;
  const oldChat = globalThis.ChatMessage;
  const realWait = api.DialogV2.wait;
  const notes = [];
  const chat = [];
  globalThis.ui = { notifications: { info: m => notes.push(m), warn: m => notes.push(m) } };
  globalThis.ChatMessage = { implementation: { create: async d => { chat.push(d); return d; } } };
  game.users = [{ id: "gm", isGM: true }, { id: "p1", isGM: false }];
  const makeOp = (owner = true) => {
    const op = {
      type: "operative", name: "Kael", isOwner: owner, deleted: { Item: [], ActiveEffect: [] }, updated: null,
      system: new OperativeData({ skills: { stealth: { rank: 3 } }, wealth: { credits: 900 }, details: { callsign: "Ghost" },
        xp: { earned: 400, log: [{ kind: "award", xp: 300 }, { kind: "perk", xp: 60 }] } }),
      items: { contents: [{ id: "w", type: "weapon" }, { id: "r", type: "role" }, { id: "p", type: "ability" }] },
      effects: { contents: [{ id: "e1" }] }
    };
    op.toObject = () => ({ system: op.system.toObject() });
    op.deleteEmbeddedDocuments = async (type, ids) => { op.deleted[type].push(...ids); };
    op.update = async data => { op.updated = data; };
    return op;
  };

  // The menu: the owner and the GM see it; nobody else does.
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  let op = makeOp();
  const menu = new OperativeSheet(op)._getHeaderControls();
  check("reset: Reset character in the sheet's menu for the owner, and its action exists",
    menu.some(c => (c.action === "resetCharacter") && (c.label === "Reset character")) && "resetCharacter" in OperativeSheet.DEFAULT_OPTIONS.actions);
  check("reset: not for someone who does not own the character", !new OperativeSheet(makeOp(false))._getHeaderControls().some(c => c.action === "resetCharacter")
    && !reset.canReset({ type: "npc", isOwner: true }));

  // The confirm: Cancel by default, nothing happens unless Reset is pressed.
  let asked = null;
  api.DialogV2.wait = async options => { asked = options; return "cancel"; };
  await reset.confirmReset(op);
  const content = new JSDOM(asked.content).window.document;
  check("reset: it asks first, Cancel the default, and says it cannot be undone",
    asked.buttons[0].action === "cancel" && asked.buttons[0].default && asked.buttons[1].label === "Reset Kael"
      && /cannot be undone/.test(content.body.textContent) && !!content.querySelector('[name="identity"]') && !!content.querySelector('[name="gear"]')
      && !content.querySelector('[name="xp"]') && !op.updated && !op.deleted.Item.length);
  // Pressing Reset with gear kept: everything else goes, the GMs are told.
  const form = new JSDOM(`<form>${asked.content}</form>`).window.document.querySelector("form");
  form.elements.gear.checked = true;
  api.DialogV2.wait = async options => options.buttons[1].callback({}, { form });
  await reset.confirmReset(op);
  check("reset: the owner resets: items but the gear, the operative's own effects, and its data as new",
    op.deleted.Item.join() === "r,p" && op.deleted.ActiveEffect.join() === "e1" && op.updated.system.skills.stealth.rank === 0
      && op.updated.system.details.callsign === "" && op.updated.system.wealth.credits === 900 && op.updated.system.xp.earned === IROP.startingXP
      && !op.updated.system.xp.log.length);
  check("reset: the GMs get a note of it, and the player is told", chat.length === 1 && chat[0].whisper.join() === "gm"
    && /Kael<\/strong> was reset by Johnald\. Kept their gear\./.test(chat[0].content) && /new operative again/.test(notes.at(-1)));
  // A player cannot keep the XP, even if asked; a GM can.
  op = makeOp();
  await reset.resetOperative(op, { xp: true });
  check("reset: a player's reset never keeps the XP", op.updated.system.xp.earned === IROP.startingXP);
  game.user = { id: "gm", isGM: true, name: "GM" };
  op = makeOp();
  api.DialogV2.wait = async options => { asked = options; return "cancel"; };
  await reset.confirmReset(op);
  check("reset: the GM is offered to keep the XP", !!new JSDOM(asked.content).window.document.querySelector('[name="xp"]'));
  await reset.resetOperative(op, { xp: true, identity: true });
  check("reset: the GM keeps the XP earned, everything spent refunded, and who they are",
    op.updated.system.xp.earned === 400 && op.updated.system.xp.log.length === 1 && op.updated.system.details.callsign === "Ghost"
      && op.deleted.Item.join() === "w,r,p");

  api.DialogV2.wait = realWait;
  game.user = oldUser;
  game.users = oldUsers;
  globalThis.ui = oldUi;
  globalThis.ChatMessage = oldChat;
}

// The date bar can be dragged anywhere, each user's spot remembered (Johnald, 2026-10-09).
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  foundry.applications.api.ApplicationV2.prototype._onRender ??= async function() {};
  const { DateBar, clampToScreen } = await import("../module/apps/calendar.mjs");
  const oldSettings = game.settings;
  const store = {};
  game.settings = {
    get(scope, key) { if ( key in store ) return foundry.utils.deepClone(store[key]); throw new Error("no settings in tests"); },
    async set(scope, key, value) { store[key] = foundry.utils.deepClone(value); return value; }
  };
  check("date bar: a position is kept on the screen, the whole bar in view",
    JSON.stringify(clampToScreen({ left: -50, top: 2000 }, { width: 200, height: 34 }, { width: 1000, height: 800 })) === JSON.stringify({ left: 0, top: 766 })
      && JSON.stringify(clampToScreen({ left: 300, top: 40 }, { width: 200, height: 34 }, { width: 1000, height: 800 })) === JSON.stringify({ left: 300, top: 40 }));
  const bar = new DateBar();
  bar.position = { left: 400, top: 70 };
  bar.setPosition = p => Object.assign(bar.position, p);
  bar.element = { offsetWidth: 200, offsetHeight: 34 };
  bar.dragStart(500, 80);
  bar.dragMove(502, 81);
  check("date bar: a press that barely moves is a click, not a drag", bar.position.left === 400 && bar.drag.moving === false);
  bar.dragMove(300, 300);
  await bar.dragEnd();
  check("date bar: dragged, it follows the pointer, and the spot is kept for this user",
    bar.position.left === 200 && bar.position.top === 290 && JSON.stringify(store.dateBarPosition) === JSON.stringify({ left: 200, top: 290 }));
  check("date bar: the click that ends a drag does not open the calendar", DateBar.DEFAULT_OPTIONS.actions.open.call(bar) === null);
  bar.dragged = false;
  check("date bar: a plain click still opens it", DateBar.DEFAULT_OPTIONS.actions.open.call(bar) !== null);
  // Drawn again, it goes where this user left it, held on the screen; a right click puts it back.
  store.dateBarPosition = { left: 5000, top: 100 };
  const doc = new JSDOM(tpl("templates/apps/date-bar.hbs")({ date: { short: "Sun 1 Jan 2040", season: "Winter" } })).window.document;
  Object.defineProperty(doc.body, "offsetWidth", { value: 200 });
  Object.defineProperty(doc.body, "offsetHeight", { value: 34 });
  bar.element = doc.body;
  await bar._onRender({}, {});
  check("date bar: drawn where this user left it, kept on the screen", bar.position.left === 1720 && bar.position.top === 100
    && !!doc.querySelector(".date-bar .db-grip") && /Drag to move it/.test(doc.querySelector(".date-bar").dataset.tooltip));
  doc.querySelector(".date-bar").dispatchEvent(new doc.defaultView.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));
  check("date bar: a right click puts it back at the top centre", JSON.stringify(store.dateBarPosition) === "{}" && bar.position.top === 70 && bar.position.left === 860);
  game.settings = oldSettings;
}

// Blast markers (Johnald, 2026-10-09): anything with a blast radius is set down on the map
// before the attack window, and a scatter moves it where the blast lands.
{
  const blast = await import("../module/canvas/blast.mjs");
  const rolls = await import("../module/rolls.mjs");
  const { scatterOffset } = await import("../module/rules/combat.mjs");
  const api = foundry.applications.api;
  const realInput = api.DialogV2.input;
  const realUtils = foundry.utils;
  const realRoll = foundry.dice.Roll;
  const oldUser = game.user;
  const oldUi = globalThis.ui;
  const oldChat = globalThis.ChatMessage;
  const oldCanvas = globalThis.canvas;
  const notes = [];
  const chat = [];
  globalThis.ui = { notifications: { info: m => notes.push(m), warn: m => notes.push(m) } };
  globalThis.ChatMessage = { implementation: { create: async d => { chat.push(d); return d; }, getSpeaker: () => ({ alias: "Kael" }) } };

  check("blast: scatter steps on a square grid, North first and clockwise",
    JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8].map(d => scatterOffset(d, 3)).map(o => [o.dx, o.dy]))
      === JSON.stringify([[0, -3], [3, -3], [3, 0], [3, 3], [0, 3], [-3, 3], [-3, 0], [-3, -3]])
      && Math.abs(scatterOffset(2, 3, { square: false }).dx - (3 / Math.SQRT2)) < 1e-9 && scatterOffset(9, 2).dy === -2);
  const data = blast.blastRegionData({ name: "Frag Grenade", radius: 2, gridSize: 100, user: { id: "p1", color: "#42abf2" }, level: "L1", item: "Item.g", actor: "Actor.k" });
  check("blast: a true circle of the blast's radius (not grid squares), seen by everyone, owned by the thrower",
    data.shapes[0].type === "circle" && data.shapes[0].radius === 200 && !data.shapes[0].gridBased && data.highlightMode === "shapes" && data.displayMeasurements
      && data.ownership.p1 === 3 && data.levels.join() === "L1" && data.flags.irop.blast.radius === 2 && !data.restriction.enabled && data.name === "Frag Grenade: blast");

  // Using a grenade: the marker first, then the attack window.
  const calls = [];
  let placed = null;
  let dialogAnswer = null;
  globalThis.canvas = {
    ready: true, scene: { id: "s1" }, dimensions: { size: 100 }, level: { id: "L1" },
    regions: { placeRegion: async (d, options) => { calls.push(["place", d.shapes[0].radius, options.allowRotation]); return placed; } }
  };
  api.DialogV2.input = async () => { calls.push(["dialog"]); return dialogAnswer; };
  game.user = { id: "p1", isGM: false, name: "Johnald", color: "#42abf2", targets: new Set() };
  // What the attack window reads for its roll visibility list.
  const oldConfig = globalThis.CONFIG;
  const oldSettingsBlast = game.settings;
  globalThis.CONFIG = { ...(oldConfig ?? {}), ChatMessage: { modes: { public: { label: "Public" } } } };
  game.settings = { get(scope, key) { if ( key === "messageMode" ) return "public"; throw new Error("no settings in tests"); } };
  const grenade = new FakeDoc({});
  Object.assign(grenade, { type: "weapon", name: "Frag Grenade", uuid: "Item.g", img: "g.svg", updates: [], actor: null });
  grenade.system = new itemModels.WeaponData({ category: "thrown", weaponClass: "grenade", quantity: 2, blast: 2, damage: { formula: "3d6", type: "explosive" } },
    { parent: grenade });
  grenade.update = async d => grenade.updates.push(d);
  const kael = { uuid: "Actor.k", name: "Kael", statuses: new Set(), getRollData: () => ({}),
    system: { attributes: Object.fromEntries(["str", "agi", "per", "int", "cha", "tgh", "lck"].map(k => [k, { label: k, abbr: k.toUpperCase(), value: 45 }])) } };
  check("blast: a grenade's attack carries its blast radius", rolls.attackProfile(grenade).blast === 2);
  const result = await rolls.rollAttack(kael, grenade);
  check("blast: the player sets the blast down before the attack window; backing out calls the attack off, nothing spent",
    result === null && calls.length === 1 && calls[0][0] === "place" && calls[0][1] === 200 && calls[0][2] === false && !grenade.updates.length
      && /left click to place it/.test(notes.at(-1)));
  let removed = false;
  placed = { uuid: "Scene.s1.Region.r1", delete: async () => { removed = true; } };
  calls.length = 0;
  await rolls.rollAttack(kael, grenade);
  check("blast: placed, then the attack window; closing the window takes the marker away",
    calls.map(c => c[0]).join() === "place,dialog" && removed && !grenade.updates.length);
  globalThis.canvas = { ready: false };
  calls.length = 0;
  await rolls.rollAttack(kael, grenade);
  check("blast: with no map on screen, the attack window opens as before", calls.map(c => c[0]).join() === "dialog");

  // Scatter moves the marker, once, for its owner or a GM.
  const marker = {
    uuid: "Scene.s1.Region.r1", isOwner: true, parent: { grid: { size: 100, type: 1 } }, flags: { irop: { blast: { radius: 2, scattered: false } } },
    shapes: [{ type: "circle", x: 500, y: 500, radius: 200, gridBased: true }],
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    toObject() { return { shapes: JSON.parse(JSON.stringify(this.shapes)) }; },
    async update(d) { this.shapes = d.shapes; if ( d["flags.irop.blast.scattered"] ) this.flags.irop.blast.scattered = true; }
  };
  foundry.utils = { ...realUtils, fromUuid: async uuid => (uuid === marker.uuid ? marker : null) };
  foundry.dice.Roll = class { constructor(formula) { this.formula = formula; } async evaluate() { this.total = (this.formula === "1d8") ? 4 : 5; return this; } };
  await rolls.rollScatter("launched", kael, { blast: { uuid: marker.uuid } });
  check("blast: a scatter moves the marker that far in that direction (Southeast 5: five squares right and down)",
    marker.shapes[0].x === 1000 && marker.shapes[0].y === 1000 && /Southeast/.test(chat.at(-1).content) && /The blast marker has moved there/.test(chat.at(-1).content));
  await rolls.rollScatter("launched", kael, { blast: { uuid: marker.uuid } });
  check("blast: it scatters once; a second press leaves it", marker.shapes[0].x === 1000 && /already scattered once/.test(chat.at(-1).content));
  marker.flags.irop.blast.scattered = false;
  marker.isOwner = false;
  await rolls.rollScatter("thrown", kael, { blast: { uuid: marker.uuid } });
  check("blast: only the thrower or a GM can move it", marker.shapes[0].x === 1000 && /Only the thrower or a GM/.test(chat.at(-1).content));
  game.user = { id: "gm", isGM: true, name: "GM", targets: new Set() };
  await rolls.rollScatter("thrown", kael, { blast: { uuid: "Scene.s1.Region.gone" } });
  check("blast: a marker someone deleted is reported, not an error", /place the blast by hand/.test(chat.at(-1).content));
  await rolls.rollScatter("thrown", kael);
  check("blast: a scatter with no marker reads as before", !/scatter-note/.test(chat.at(-1).content));

  api.DialogV2.input = realInput;
  foundry.utils = realUtils;
  foundry.dice.Roll = realRoll;
  globalThis.CONFIG = oldConfig;
  game.settings = oldSettingsBlast;
  game.user = oldUser;
  globalThis.ui = oldUi;
  globalThis.ChatMessage = oldChat;
  globalThis.canvas = oldCanvas;
}

// Blast templates chosen on the item, the Clear marker button, one suit of armor (Johnald, 2026-10-09).
{
  const blast = await import("../module/canvas/blast.mjs");
  const { onRenderChatMessage } = await import("../module/chat.mjs");
  const realUtils = foundry.utils;
  const oldUser = game.user;
  const oldUi = globalThis.ui;
  const oldCanvas = globalThis.canvas;
  const notes = [];
  globalThis.ui = { notifications: { info: m => notes.push(m), warn: m => notes.push(m) } };

  // The shapes.
  const sq = blast.blastShape("square", 2, 100);
  const cone = blast.blastShape("cone", 3, 100);
  const line = blast.blastShape("line", 4, 100);
  check("template: a square twice the blast across, centred where it is set down",
    sq.type === "rectangle" && sq.width === 400 && sq.height === 400 && sq.anchorX === 0.5 && sq.anchorY === 0.5 && !sq.gridBased);
  check("template: a cone as long as the blast, 90 degrees wide; a line as long, one tile wide",
    cone.type === "cone" && cone.radius === 300 && cone.angle === 90 && line.type === "line" && line.length === 400 && line.width === 100
      && blast.blastShape("circle", 1, 100).radius === 100 && blast.blastShape(undefined, 1, 100).type === "circle");
  check("template: the item sheet offers the shapes, a circle by default",
    Object.keys(IROP.blastTemplates).join() === "circle,square,cone,line,none" && new itemModels.WeaponData({}).template === "circle");
  // The Details tab is the GM's (2026-10-10).
  const userBeforeWeapon = game.user;
  game.user = { id: "gm", isGM: true, name: "GM" };
  const weaponSheet = await renderSheet(IropItemSheet, (() => {
    const w = new FakeDoc({});
    Object.assign(w, { id: "w1", name: "Frag Grenade", type: "weapon", img: "g.svg", uuid: "Item.w1", isOwner: true, effects: [], actor: null });
    w.getRollData = () => ({});
    w.system = new itemModels.WeaponData({ weaponClass: "grenade", category: "thrown", blast: 2, template: "cone" }, { parent: w });
    return w;
  })());
  game.user = userBeforeWeapon;
  const wd = new JSDOM(weaponSheet.out.details).window.document;
  check("template: the weapon sheet has a Template select beside Blast, showing the item's",
    wd.querySelector('select[name="system.template"] option[selected]')?.value === "cone" && wd.querySelectorAll('select[name="system.template"] option').length === 5);

  // Placing: cones and lines turn with the mouse wheel; No template places nothing.
  const placed = [];
  globalThis.canvas = { ready: true, scene: { id: "s1" }, dimensions: { size: 100 }, level: { id: "L1" },
    regions: { placeRegion: async (d, options) => { placed.push({ type: d.shapes[0].type, rotate: options.allowRotation }); return { uuid: "R" }; } } };
  game.user = { id: "p1", isGM: false, name: "Johnald", targets: new Set() };
  await blast.placeBlast({ name: "Chem Burst", radius: 3, template: "cone" });
  await blast.placeBlast({ name: "Frag", radius: 2 });
  const none = await blast.placeBlast({ name: "Flash", radius: 2, template: "none" });
  check("template: a cone turns with the mouse wheel while placed, a circle does not, and No template places nothing",
    placed.map(p => `${p.type}:${p.rotate}`).join() === "cone:true,circle:false" && none === undefined
      && /mouse wheel to turn it/.test(notes.find(n => /Chem Burst/.test(n)) ?? ""));

  // The damage card clears the marker.
  const card = new JSDOM(tpl("templates/chat/damage-roll.hbs")({ total: 12, formula: "3d6", label: "Frag Grenade", blastUuid: "Scene.s1.Region.r1" })).window.document;
  const noMarker = new JSDOM(tpl("templates/chat/damage-roll.hbs")({ total: 12, formula: "3d6", label: "Frag Grenade", blastUuid: "" })).window.document;
  check("clear marker: the damage card has the button when a marker was set down, not otherwise",
    !!card.querySelector('[data-irop-action="clearBlast"]') && !noMarker.querySelector('[data-irop-action="clearBlast"]'));
  let deleted = 0;
  const marker = { uuid: "Scene.s1.Region.r1", isOwner: true, delete: async () => { deleted++; } };
  let present = true;
  foundry.utils = { ...realUtils, fromUuid: async uuid => ((present && (uuid === marker.uuid)) ? marker : null),
    fromUuidSync: uuid => ((present && (uuid === marker.uuid)) ? marker : null) };
  const message = { rolls: [{ options: { blastUuid: marker.uuid } }], isAuthor: true };
  onRenderChatMessage(message, card.body);
  const button = card.querySelector('[data-irop-action="clearBlast"]');
  button.dispatchEvent(new card.defaultView.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  check("clear marker: the thrower presses it, the marker comes off the map and the button goes", deleted === 1 && !card.querySelector('[data-irop-action="clearBlast"]'));
  present = false;
  const later = new JSDOM(tpl("templates/chat/damage-roll.hbs")({ total: 12, formula: "3d6", label: "Frag Grenade", blastUuid: marker.uuid })).window.document;
  onRenderChatMessage(message, later.body);
  check("clear marker: once the marker is gone, the card no longer offers it", !later.querySelector('[data-irop-action="clearBlast"]'));
  present = true;
  marker.isOwner = false;
  check("clear marker: only its owner or a GM", (await blast.clearBlast(marker.uuid)) === "permission" && deleted === 1);
  game.user = { id: "gm", isGM: true, name: "GM", targets: new Set() };
  check("clear marker: a GM can clear anyone's", (await blast.clearBlast(marker.uuid)) === "cleared" && deleted === 2);
  foundry.utils = realUtils;

  // One suit of armor at a time.
  globalThis.Actor ??= class {};
  globalThis.Item ??= class { _onUpdate() {} async _preCreate() { return true; } _onDelete() {} };
  globalThis.ActiveEffect ??= class {};
  const { IropItem, isSuit } = await import("../module/documents.mjs");
  const updates = [];
  const wearer = { name: "Kael", items: [], updateEmbeddedDocuments: async (type, list) => { updates.push(...list); return list; } };
  const armor = (id, name, armorClass, equipped) => {
    const it = Object.create(IropItem.prototype);
    Object.assign(it, { id, name, type: "armor", actor: wearer, system: { armorClass, equipped } });
    it.updateSource = d => { if ( "system.equipped" in d ) it.system.equipped = d["system.equipped"]; };
    return it;
  };
  const medium = armor("m", "Medium Armor", "medium", true);
  const heavy = armor("h", "Heavy Armor", "heavy", false);
  const shield = armor("s", "Riot Shield", "shield", true);
  wearer.items.push(medium, heavy, shield);
  check("armor: light, medium and heavy are suits; a shield is not", isSuit(medium) && isSuit(heavy) && !isSuit(shield) && !isSuit({ type: "weapon" }));
  heavy.system.equipped = true;
  IropItem.prototype._onUpdate.call(heavy, { system: { equipped: true } }, {}, game.user.id);
  check("armor: putting on the heavy takes off the medium, and the shield stays",
    updates.length === 1 && updates[0]._id === "m" && updates[0]["system.equipped"] === false && /Kael takes off Medium Armor to wear Heavy Armor/.test(notes.at(-1)));
  updates.length = 0;
  IropItem.prototype._onUpdate.call(shield, { system: { equipped: true } }, {}, game.user.id);
  IropItem.prototype._onUpdate.call(heavy, { system: { equipped: true } }, {}, "someone else");
  check("armor: a shield takes nothing off, and only the client that made the change acts", !updates.length);
  medium.system.equipped = false;
  const arriving = armor("l", "Light Armor", "light", true);
  await IropItem.prototype._preCreate.call(arriving, {}, {}, game.user);
  check("armor: a suit arriving already worn is taken off when one is worn", arriving.system.equipped === false);

  // The armor pool follows what is worn (Johnald, 2026-10-10: the bar did not fill or empty).
  const poolActor = {
    name: "Kael", items: [], updates: [], system: { vitals: { armor: { value: 0, max: 0, bonus: 0 } } },
    async update(d) { poolActor.updates.push(d); poolActor.system.vitals.armor.value = d["system.vitals.armor.value"]; },
    async updateEmbeddedDocuments(type, list, options) { poolActor.embedded = { list, options }; return list; }
  };
  const piece = (id, name, armorClass, equipped, points) => {
    const it = armor(id, name, armorClass, equipped);
    it.actor = poolActor;
    Object.assign(it.system, { points, stowed: false });
    poolActor.items.push(it);
    return it;
  };
  const change = async (item, changes) => {
    const options = changes.options ?? {};
    await IropItem.prototype._preUpdate.call(item, {}, options, game.user);
    Object.assign(item.system, changes.system);
    IropItem.prototype._onUpdate.call(item, { system: changes.system }, options, game.user.id);
    await new Promise(r => setTimeout(r, 0));
  };
  const poolValue = () => poolActor.system.vitals.armor.value;
  const med = piece("pm", "Medium Armor", "medium", false, 6);
  await change(med, { system: { equipped: true } });
  check("armor pool: putting armor on fills its points", poolValue() === 6);
  poolActor.system.vitals.armor.value = 2;
  await change(med, { system: { equipped: false } });
  check("armor pool: taking it off empties its points, damage and all", poolValue() === 0);
  med.system.equipped = true;
  poolActor.system.vitals.armor.value = 4;
  const hv = piece("ph", "Heavy Armor", "heavy", false, 8);
  await change(hv, { system: { equipped: true } });
  check("armor pool: a damaged suit swapped for another, the new one goes on fresh, the old one comes off",
    poolValue() === 8 && poolActor.embedded.list[0]._id === "pm" && poolActor.embedded.options.iropArmorSwap === true);
  const updatesBefore = poolActor.updates.length;
  await change(med, { system: { equipped: false }, options: { iropArmorSwap: true } });
  check("armor pool: the old suit's own update in a swap leaves the pool alone", poolActor.updates.length === updatesBefore && poolValue() === 8);
  poolActor.system.vitals.armor.value = 5;
  await change(hv, { system: { points: 10 } });
  check("armor pool: more points on the armor being worn add the difference", poolValue() === 7);
  await change(hv, { system: { stowed: true, equipped: false } });
  check("armor pool: stowing worn armor takes its points away", poolValue() === 0);
  Object.assign(hv.system, { stowed: false, equipped: true });
  poolActor.system.vitals.armor.value = 10;
  IropItem.prototype._onDelete.call(hv, {}, game.user.id);
  await new Promise(r => setTimeout(r, 0));
  check("armor pool: worn armor thrown away takes its points with it", poolValue() === 0);
  const helmet = piece("hl", "Helmet", "other", true, 2);
  IropItem.prototype._onCreate.call(helmet, {}, {}, game.user.id);
  await new Promise(r => setTimeout(r, 0));
  check("armor pool: armor that arrives already worn adds its points", poolValue() === 2);

  game.user = oldUser;
  globalThis.ui = oldUi;
  globalThis.canvas = oldCanvas;
}

// Blast markers for the Mortar Strike (Johnald, 2026-10-10): the three strikes set down on the map
// before the roll, none overlapping, and moved where a strike scatters.
{
  const res = await import("../module/apps/resources.mjs");
  const { scatterOffset } = await import("../module/rules/combat.mjs");
  const realUtils = foundry.utils;
  const realRoll = foundry.dice.Roll;
  const realRender = foundry.applications.handlebars.renderTemplate;
  const oldUser = game.user;
  const oldUi = globalThis.ui;
  const oldCanvas = globalThis.canvas;
  const oldChat = globalThis.ChatMessage;
  const notes = [];
  globalThis.ui = { notifications: { info: m => notes.push(m), warn: m => notes.push(m), error: m => notes.push(m) } };
  game.user = { id: "p1", isGM: false, name: "Wraith", color: "#5fb85f" };

  // The map: each placement sets the circle down at the next spot; a null spot backs out.
  const regions = new Map();
  let spots = [];
  let nextId = 0;
  const allMarkers = [];
  const makeMarker = (data, at) => {
    const marker = {
      uuid: `Scene.s1.Region.r${++nextId}`, isOwner: true, deleted: false, parent: { grid: { size: 100, type: 1 } },
      flags: realUtils.deepClone(data.flags), shapes: data.shapes.map(s => ({ ...s, x: at.x, y: at.y })),
      toObject() { return { shapes: this.shapes.map(s => ({ ...s })) }; },
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
      async update(d) {
        if ( d.shapes ) this.shapes = d.shapes;
        if ( d["flags.irop.blast.scattered"] ) this.flags.irop.blast.scattered = true;
      },
      async delete() { this.deleted = true; regions.delete(this.uuid); }
    };
    regions.set(marker.uuid, marker);
    allMarkers.push(marker);
    return marker;
  };
  const mapCanvas = { ready: true, scene: { id: "s1" }, dimensions: { size: 100 }, level: null,
    regions: { placeRegion: async data => { const at = spots.shift(); return at ? makeMarker(data, at) : null; } } };
  globalThis.canvas = mapCanvas;
  foundry.utils = { ...realUtils, fromUuid: async uuid => regions.get(uuid) ?? null, fromUuidSync: uuid => regions.get(uuid) ?? null };
  let totals = [];
  foundry.dice.Roll = class { constructor(formula) { this.formula = formula; } async evaluate() { this.total = totals.shift(); return this; } };
  const created = [];
  globalThis.ChatMessage = { implementation: { getSpeaker: () => ({}), create: async d => { created.push(d); return d; } } };
  foundry.applications.handlebars.renderTemplate = async (file, context) => tpl(file.replace("systems/irop/", ""))(context);
  const supportMessage = () => ({
    id: `m${++nextId}`, updates: [],
    flags: { irop: { support: { key: "mortarStrike", status: "approved", cost: 30, by: "Wraith", left: 0 } } },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async update(d) { this.updates.push(d); if ( d["flags.irop.support"] ) this.flags.irop.support = d["flags.irop.support"]; }
  });

  // Fired: strike 2 is set down over strike 1, taken up and set down again; strikes 2 and 3 scatter.
  spots = [{ x: 500, y: 500 }, { x: 700, y: 500 }, { x: 1200, y: 500 }, { x: 500, y: 1200 }];
  totals = [30, 88, 75, 6, 3, 1, 1];
  let msg = supportMessage();
  const [first, second] = await Promise.all([res.fireMortar(msg), res.fireMortar(msg)]);
  const strikes = created[0]?.flags.irop.mortar.strikes ?? [];
  const at = uuid => regions.get(uuid)?.shapes[0];
  const sw = scatterOffset(6, 3, { square: true });
  const north = scatterOffset(1, 1, { square: true });
  check("mortar markers: three strikes set down, the one over another taken up and set down again",
    (allMarkers.length === 4) && allMarkers[1].deleted && (regions.size === 3)
      && notes.some(n => /Strike 2 overlaps Strike 1: the three areas must not overlap\. Set it down again\./.test(n))
      && allMarkers.every(mk => (mk.shapes[0].type === "circle") && (mk.shapes[0].radius === 300)), JSON.stringify(notes));
  check("mortar markers: each strike carries its marker; the ones that scatter moved where they land, the one on target stayed",
    (strikes.length === 3) && strikes.every(s => regions.has(s.blast)) && (at(strikes[0].blast).x === 500) && (at(strikes[0].blast).y === 500)
      && (strikes[1].marker === "moved") && (at(strikes[1].blast).x === 1200 + (sw.dx * 100)) && (at(strikes[1].blast).y === 500 + (sw.dy * 100))
      && (strikes[2].marker === "moved") && (at(strikes[2].blast).x === 500 + (north.dx * 100)) && (at(strikes[2].blast).y === 1200 + (north.dy * 100))
      && !("marker" in strikes[0]), JSON.stringify(strikes));
  check("mortar markers: pressed twice, it fires once", (created.length === 1) && (second === null) && !!first && (msg.flags.irop.support.fired === true));
  const mortarDoc = new JSDOM(created[0].content).window.document;
  check("mortar markers: the card says the markers are down and the scattered ones moved",
    /The blast markers are on the map; the strikes that scattered have moved where they land\./.test(mortarDoc.querySelector(".scatter-note")?.textContent ?? ""));
  const firedMessage = { getFlag: (scope, key) => created[0].flags[scope]?.[key] };
  check("mortar markers: each strike's damage carries its marker, for the damage card's Clear marker",
    (res.mortarAttack(2, firedMessage).blast?.uuid === strikes[1].blast) && (res.mortarAttack(2, null).blast === null)
      && (res.mortarAttack(1, firedMessage).damage.destruction === 6)
      && /mortarDamage\(Number\(button\.dataset\.strike\) \|\| 1, message\)/.test(fs.readFileSync(path.join(ROOT, "module/chat.mjs"), "utf8")));

  // Backing out of the third strike calls the whole thing off: the two down are taken up, nothing fired.
  for ( const mk of [...regions.values()] ) await mk.delete();
  allMarkers.length = 0;
  created.length = 0;
  notes.length = 0;
  spots = [{ x: 500, y: 500 }, { x: 1200, y: 500 }, null];
  totals = [];
  msg = supportMessage();
  const calledOff = await res.fireMortar(msg);
  check("mortar markers: backing out calls it off, takes up the markers already down, and leaves it ready to fire",
    (calledOff === null) && (allMarkers.length === 2) && allMarkers.every(mk => mk.deleted) && !created.length && !msg.updates.length
      && !msg.flags.irop.support.fired && notes.some(n => /Mortar Strike called off: nothing fired/.test(n)));

  // No scene on screen to set markers down on: it fires as before, with no markers.
  globalThis.canvas = { ready: true, scene: null, regions: {} };
  totals = [10, 20, 30];
  msg = supportMessage();
  await res.fireMortar(msg);
  check("mortar markers: where none can be set down, it fires without them",
    (created.length === 1) && created[0].flags.irop.mortar.strikes.every(s => !s.blast) && !new JSDOM(created[0].content).window.document.querySelector(".scatter-note"));

  // A strike whose marker could not move says so.
  const stuck = new JSDOM(tpl("templates/chat/mortar-card.hbs")(res.mortarCardContext([
    { n: 1, roll: 10, scatters: false, blast: "a" },
    { n: 2, roll: 90, scatters: true, blast: "b", marker: "gone", direction: "North", distance: 2, tiles: "tiles" },
    { n: 3, roll: 20, scatters: false, blast: "c" }
  ]))).window.document;
  check("mortar markers: a strike that could not move its marker says to place that blast by hand",
    /The blast markers are on the map\. Strike 2 could not move its marker: place that blast by hand\./.test(stuck.querySelector(".scatter-note")?.textContent ?? ""));

  // The support card says to set the strikes down after firing.
  const hintCtx = res.supportCardContext({ key: "mortarStrike", status: "approved", cost: 30, by: "Wraith", left: 0 });
  const hint = new JSDOM(tpl("templates/chat/support-card.hbs")(hintCtx)).window.document.querySelector(".support-hint")?.textContent ?? "";
  check("mortar markers: the card says to fire, then set the strikes down on the map",
    /Fire, then set the three strikes down on the map/.test(hint) && !/Mark three areas/.test(hint) && !("markers" in hintCtx));

  foundry.utils = realUtils;
  foundry.dice.Roll = realRoll;
  foundry.applications.handlebars.renderTemplate = realRender;
  game.user = oldUser;
  globalThis.ui = oldUi;
  globalThis.canvas = oldCanvas;
  globalThis.ChatMessage = oldChat;
}

// Stores (Johnald, 2026-10-10): several, each its own actor; the GM stocks the shelf, players buy
// at once with the price off their sheet, and sell their own things back.
{
  const { StoreData } = await import("../module/data/store.mjs");
  const { StoreSheet, itemStats, typeLine } = await import("../module/sheets/store-sheet.mjs");
  const storeMod = await import("../module/store.mjs");
  const realUtils = foundry.utils;
  const oldUser = game.user;
  const oldActors = game.actors;
  const oldUsers = game.users;
  const oldSocket = game.socket;
  const oldUi = globalThis.ui;
  const oldChat = globalThis.ChatMessage;
  const notes = [];
  globalThis.ui = { notifications: { info: m => notes.push(m), warn: m => notes.push(m), error: m => notes.push(m) } };
  const chats = [];
  globalThis.ChatMessage = { implementation: { getSpeaker: ({ actor } = {}) => ({ alias: actor?.name }), create: async d => { chats.push(d); return d; } } };
  const coll = arr => Object.assign(arr, { get: id => arr.find(i => i.id === id) ?? null });
  const log = [];

  // The shelf: grenades (unlimited), a rifle in Alien Alloys, heavy armor (limited, 1 left),
  // a sold-out pistol, a hidden prototype; Medkits in Credits or Valuables, Stim Packs that
  // refuse Valuables, and Scrap with no price at all.
  const shelfItem = (id, name, type, system, shelf) => {
    const it = { id, name, type, img: `${id}.svg`, system: { quantity: 1, ...system },
      flags: { irop: { shelf: { limited: false, stock: 0, hidden: false, ...shelf } } } };
    it.toObject = () => ({ _id: id, name, type, img: it.img, system: { ...it.system }, flags: structuredClone(it.flags) });
    it.update = async d => {
      log.push([id, d]);
      for ( const [k, v] of Object.entries(d) ) realUtils.setProperty(it, k, v);
      return it;
    };
    it.delete = async () => { log.push([id, "deleted"]); store.items.splice(store.items.indexOf(it), 1); };
    return it;
  };
  const store = {
    id: "st1", uuid: "Actor.st1", type: "store", name: "The Black Market", img: "coins.svg", isOwner: true,
    system: new StoreData({ markup: 20, sellBack: 50, description: "<p>No questions asked.</p>" }),
    items: coll([
      shelfItem("frag", "Frag Grenade", "weapon", { weaponClass: "grenade", category: "thrown", prices: { credits: 25 } }, {}),
      shelfItem("rifle", "T2 Rifle", "weapon", { weaponClass: "rifles", category: "ranged", prices: { alloys: 10 }, accuracy: 10,
        damage: { formula: "2d6 + @per.mod", type: "ballistic" }, critical: { chance: 5, damage: 4 }, weight: 4,
        range: { short: { tiles: 10, dm: 0 }, medium: { tiles: 20, dm: 10 } }, description: "<p>Standard issue.</p>" }, {}),
      shelfItem("heavy", "Heavy Armor", "armor", { armorClass: "heavy", prices: { credits: 90 } }, { limited: true, stock: 1 }),
      shelfItem("pistol", "T1 Pistol", "weapon", { weaponClass: "smallArms", category: "ranged", prices: { credits: 40 } }, { limited: true, stock: 0 }),
      shelfItem("proto", "Prototype Rail", "weapon", { weaponClass: "rifles", category: "ranged", prices: { credits: 500 } }, { hidden: true }),
      shelfItem("medkit", "Medkit", "gear", { prices: { credits: 20, valuables: 2 } }, {}),
      shelfItem("stim", "Stim Pack", "gear", { prices: { credits: 15, valuables: 1 }, accepts: { credits: true, valuables: false, alloys: true } }, {}),
      shelfItem("junk", "Scrap", "gear", { prices: {} }, {})
    ])
  };
  // The buyer: Kael, with 100 Credits, two Frag Grenades already, a Medkit stack, and a fitted mod.
  const kaelItem = (id, name, type, system) => {
    const it = { id, name, type, img: `${id}.svg`, parent: null, system: { quantity: 1, ...system } };
    it.toObject = () => ({ _id: id, name, type, img: it.img, system: structuredClone(it.system), flags: structuredClone(it.flags ?? {}) });
    it.update = async d => { log.push([`kael.${id}`, d]); for ( const [k, v] of Object.entries(d) ) realUtils.setProperty(it, k, v); return it; };
    it.delete = async () => { log.push([`kael.${id}`, "deleted"]); kael.items.splice(kael.items.indexOf(it), 1); };
    return it;
  };
  const kael = {
    id: "op1", uuid: "Actor.op1", type: "operative", name: "Kael", isOwner: true,
    system: { wealth: { credits: 100, valuables: 3, alloys: 25 } },
    testUserPermission: user => user.isGM || (user.id === "p1"),
    update: async d => { log.push(["kael", d]); for ( const [k, v] of Object.entries(d) ) realUtils.setProperty(kael, k, v); return kael; },
    createEmbeddedDocuments: async (type, list) => { log.push(["kael.create", list]); return list; },
    items: coll([])
  };
  kael.items.push(kaelItem("kfrag", "Frag Grenade", "weapon", { weaponClass: "grenade", quantity: 2, prices: { credits: 25 } }),
    kaelItem("med", "Medkit", "gear", { kind: "consumable", quantity: 3, prices: { credits: 20 } }),
    kaelItem("dot", "Red Dot", "mod", { prices: { credits: 30 }, installedOn: "w1" }),
    kaelItem("rock", "Pet Rock", "gear", { prices: {} }),
    kaelItem("idol", "Alien Idol", "gear", { prices: { credits: 40, valuables: 6 } }));
  for ( const it of kael.items ) it.parent = kael;
  const other = { id: "op2", uuid: "Actor.op2", type: "operative", name: "Wraith", isOwner: false, system: { wealth: { credits: 0, valuables: 0, alloys: 0 } }, items: coll([]) };
  game.actors = Object.assign([kael, other, store], { get: id => [kael, other, store].find(a => a.id === id) });
  const byUuid = { "Actor.st1": store, "Actor.op1": kael, "Actor.op2": other };
  foundry.utils = { ...realUtils, fromUuidSync: uuid => byUuid[uuid] ?? null };

  // The GM's sheet: everything, the shelf's controls, the hidden prototype marked.
  game.user = { id: "gm", isGM: true, name: "GM" };
  const gmSheet = new StoreSheet(store);
  const gmCtx = await gmSheet._prepareContext({});
  // editImage is Foundry's own sheet action (2026-10-16: the store picture, editable in Manage).
  const gmDoc = inspect("store gm", tpl("templates/actor/store.hbs")(gmCtx), { actions: new Set([...Object.keys(StoreSheet.DEFAULT_OPTIONS.actions), "editImage"]), source: store.system._source });
  check("store gm: the shelf in sections, each with a heading, the hidden ones in theirs",
    [...gmDoc.querySelectorAll(".shelf-heading")].map(h => h.textContent).join() === "Ranged,Explosives,Armor,Gear"
      && [...gmDoc.querySelectorAll(".shelf-row")].map(r => r.dataset.itemId).slice(0, 4).join() === "proto,pistol,rifle,frag",
    [...gmDoc.querySelectorAll(".shelf-row")].map(r => r.dataset.itemId).join());
  check("store gm: the store's picture opens Foundry's image picker in Manage", gmDoc.querySelector(".store-img")?.dataset.action === "editImage" && gmDoc.querySelector(".store-img").dataset.edit === "img");
  const row = (doc, id) => doc.querySelector(`.shelf-row[data-item-id="${id}"]`);
  check("store gm: the name, markup, buy back and preferred currency to set, and the description to write",
    !!gmDoc.querySelector('input[name="name"]') && !!gmDoc.querySelector('input[name="system.markup"]')
      && !!gmDoc.querySelector('input[name="system.sellBack"]') && !!gmDoc.querySelector('prose-mirror[name="system.description"]')
      && (gmDoc.querySelector('select[name="system.preferred"] option[selected]')?.value === "credits")
      && (gmDoc.querySelectorAll('select[name="system.preferred"] option').length === 3));
  check("store gm: every shelf item has a price and a tick per currency, its stock limit, hide and remove; the hidden one is marked",
    [...gmDoc.querySelectorAll(".shelf-row")].length === 8
      && [...gmDoc.querySelectorAll(".shelf-row")].every(r => (r.querySelectorAll('input[type="number"][data-shelf-field^="system.prices."]').length === 3)
        && (r.querySelectorAll('input[type="checkbox"][data-shelf-field^="system.accepts."]').length === 3)
        && r.querySelector('[data-action="toggleLimited"]') && r.querySelector('[data-action="toggleHidden"]') && r.querySelector('[data-action="removeItem"]'))
      && !row(gmDoc, "stim").querySelector('[data-shelf-field="system.accepts.valuables"]').checked
      && row(gmDoc, "stim").querySelector('[data-shelf-field="system.accepts.valuables"]').closest(".shelf-price-cell").classList.contains("refused")
      && (row(gmDoc, "medkit").querySelector('[data-shelf-field="system.prices.valuables"]').value === "2")
      && /Hidden from players/.test(row(gmDoc, "proto").textContent) && row(gmDoc, "proto").classList.contains("hidden-item")
      && !!row(gmDoc, "heavy").querySelector('[data-shelf-field="flags.irop.shelf.stock"]') && !row(gmDoc, "frag").querySelector('[data-shelf-field="flags.irop.shelf.stock"]'));
  check("store gm: the GM picks which operative buys", gmDoc.querySelectorAll("select[data-buyer] option").length === 2);

  // A player's sheet: the shop (Johnald, 2026-10-10: a list beside a detail panel, with category
  // filters). No store settings, nothing hidden, prices with the markup, what they can afford.
  game.user = { id: "p1", isGM: false, name: "Johnald", character: kael };
  const sheet = new StoreSheet(store);
  Object.defineProperty(sheet, "isEditable", { get: () => false });
  const shopActs = StoreSheet.DEFAULT_OPTIONS.actions;
  // Show a category and pick an item, as a player's clicks would, then draw the sheet.
  const shop = async ({ category = null, pick = null, of = sheet } = {}) => {
    if ( category ) await shopActs.category.call(of, {}, { dataset: { category } });
    if ( pick ) await shopActs.pick.call(of, {}, { closest: () => ({ dataset: { pick } }) });
    const c = await of._prepareContext({});
    return { ctx: c, doc: new JSDOM(tpl("templates/actor/store.hbs")(c)).window.document };
  };
  let { ctx, doc } = await shop();
  inspect("store shop", tpl("templates/actor/store.hbs")(ctx), { actions: new Set(Object.keys(StoreSheet.DEFAULT_OPTIONS.actions)), source: store.system._source });
  const listRow = (d, id) => d.querySelector(`.shop-row[data-pick="${id}"]`);
  const detailOf = d => d.querySelector(".shop-detail");
  const statsOf = d => [...d.querySelectorAll(".shop-stats dt")].map(dt => `${dt.textContent}=${dt.nextElementSibling.textContent}`).join(" | ");
  check("store player: the shop, with no store settings, no shelf controls and no Manage switch; the terms in words",
    !!doc.querySelector(".shop") && !doc.querySelector(".store-shelf") && !doc.querySelector("[name]") && !doc.querySelector(".shelf-gm")
      && !doc.querySelector(".store-views") && /Prefers Credits\. Prices \+20%\. Buys back at 50% of an item's price\./.test(doc.querySelector(".store-terms-read").textContent));
  check("store player: categories with their counts, empty ones left out, Sell last, all usable on a read only sheet",
    [...doc.querySelectorAll(".shop-cat")].map(b => b.textContent.replace(/\s+/g, " ").trim()).join() === "All 7,Ranged 2,Explosives 1,Armor 1,Gear 3,Sell 3"
      && (doc.querySelector(".shop-cat.on").dataset.category === "all") && (doc.querySelector(".shop-cat.sell").dataset.category === "sell")
      && [...doc.querySelectorAll(".shop-cat")].every(b => b.hasAttribute("data-shop")),
    [...doc.querySelectorAll(".shop-cat")].map(b => b.textContent.replace(/\s+/g, " ").trim()).join());
  check("store player: six tabs or fewer need no arrows; Sell sits apart on the right, always shown",
    !doc.querySelector(".shop-cat-arrow") && doc.querySelectorAll(".shop-cat-tabs .shop-cat").length === 5 && !doc.querySelector(".shop-cat-tabs .sell")
      && doc.querySelector(".shop-cats > .shop-cat.sell")?.dataset.category === "sell");
  // A store with more sections than six tabs (bug, Johnald, 2026-10-16: the arrows did nothing with All picked).
  {
    const extra = [["xm", "Baton", "weapon", { category: "melee", weaponClass: "oneHanded" }], ["xd", "Turret", "gear", { kind: "deployable" }],
      ["xa", "Slugs", "gear", { kind: "ammunition" }], ["xc", "Ration", "gear", { kind: "consumable" }], ["xp", "Plate", "gear", { kind: "plating" }]]
      .map(([id, name, type, sys]) => shelfItem(id, name, type, { prices: { credits: 5 }, ...sys }, {}));
    store.items.push(...extra);
    const big = new StoreSheet(store);
    Object.defineProperty(big, "isEditable", { get: () => false });
    let v = await shop({ of: big });
    const tabs = d => [...d.querySelectorAll(".shop-cat-tabs .shop-cat")].map(b => b.dataset.category).join();
    const first = tabs(v.doc);
    await shopActs.catScroll.call(big, {}, { dataset: { dir: "more" } });
    v = await shop({ of: big });
    check("store player: with All picked, the arrow moves the tabs along and All stays picked",
      first.startsWith("all,") && (first.split(",").length === 6) && (tabs(v.doc) !== first) && !tabs(v.doc).startsWith("all")
        && !!v.doc.querySelector('.shop-cat-arrow[data-dir="back"]:not([disabled])') && (v.ctx.categories.find(c => c.active)?.key === "all")
        && !!v.doc.querySelector(".shop-cats > .shop-cat.sell"), `${first} -> ${tabs(v.doc)}`);
    v = await shop({ of: big, category: "all" });
    check("store player: picking a tab brings it back into view", tabs(v.doc).startsWith("all,"));
    for ( const x of extra ) store.items.splice(store.items.indexOf(x), 1);
  }
  check("store player: the list holds everything on show in sections (melee, ranged, explosives, armor, gear), the hidden prototype left out",
    !listRow(doc, "proto") && ([...doc.querySelectorAll(".shop-row")].map(r => r.dataset.pick).join() === "pistol,rifle,frag,heavy,medkit,junk,stim")
      && [...doc.querySelectorAll(".shop-heading")].map(h => h.textContent).join() === "Ranged,Explosives,Armor,Gear"
      && [...doc.querySelectorAll(".shop-row")].every(r => r.dataset.action === "pick"));
  check("store player: prices in the list carry the markup and their currency; sold out says so",
    (listRow(doc, "frag").querySelector(".shop-row-price").textContent === "30 cr") && (listRow(doc, "rifle").querySelector(".shop-row-price").textContent === "12 Alloys")
      && (listRow(doc, "heavy").querySelector(".shop-row-price").textContent === "108 cr") && (listRow(doc, "pistol").querySelector(".shop-row-price").textContent === "Sold out")
      && listRow(doc, "pistol").classList.contains("sold-out"));
  check("store player: the first item is picked: the sold out pistol, which cannot be bought",
    listRow(doc, "pistol").classList.contains("picked") && detailOf(doc).querySelector('[data-action="buy"]').disabled);
  ({ ctx, doc } = await shop({ pick: "frag" }));
  check("store player: an item picked is shown in full: what it is, how many they carry, its price, Buy",
    listRow(doc, "frag").classList.contains("picked") && (detailOf(doc).dataset.itemId === "frag")
      && /Frag Grenade/.test(detailOf(doc).querySelector(".shop-detail-name").textContent) && /Kael carries 2\./.test(detailOf(doc).querySelector(".shop-carry").textContent)
      && (detailOf(doc).querySelector(".shop-price").textContent === "30 cr") && /In stock/.test(detailOf(doc).textContent)
      && detailOf(doc).querySelector('[data-action="buy"]').hasAttribute("data-shop") && !detailOf(doc).querySelector('[data-action="buy"]').disabled);
  ({ ctx, doc } = await shop({ pick: "rifle" }));
  check("store player: picking the rifle shows its stats, formulas in words, its description, and that they carry none",
    listRow(doc, "rifle").classList.contains("picked") && !listRow(doc, "frag").classList.contains("picked")
      && (detailOf(doc).querySelector(".item-sub").textContent === "Rifles, Ranged")
      && (statsOf(doc) === "Accuracy=-10 | Damage=2d6 + PER mod Ballistic | Critical=-5 chance, +4 damage | Range=Short 10 (0), Medium 20 (+10) | Weight=4")
      && /Standard issue\./.test(detailOf(doc).querySelector(".shop-desc").textContent) && /Kael carries none\./.test(detailOf(doc).textContent), statsOf(doc));
  const payOptions = d => [...detailOf(d).querySelectorAll("select[data-pay] option")].map(o => `${o.value}:${o.textContent}${o.selected ? "*" : ""}${o.disabled ? "!" : ""}`).join();
  ({ ctx, doc } = await shop({ pick: "medkit" }));
  check("store player: an item two currencies can buy offers both, the store's preferred picked",
    (payOptions(doc) === "credits:24 cr*,valuables:2 Valuables") && !detailOf(doc).querySelector(".shop-price"));
  ({ ctx, doc } = await shop({ pick: "stim" }));
  check("store player: a currency ticked off is not offered; with one left, the price just shows",
    !detailOf(doc).querySelector("select[data-pay]") && (detailOf(doc).querySelector(".shop-price").textContent === "18 cr") && (detailOf(doc).dataset.payCurrency === "credits"));
  ({ ctx, doc } = await shop({ pick: "junk" }));
  check("store player: an item with no price says so and cannot be bought",
    (detailOf(doc).querySelector(".shop-price").textContent === "No price") && detailOf(doc).querySelector('[data-action="buy"]').disabled
      && (detailOf(doc).querySelector(".shop-why").textContent === "No price set"));
  ({ ctx, doc } = await shop({ pick: "pistol" }));
  check("store player: sold out cannot be bought, and says why",
    detailOf(doc).querySelector('[data-action="buy"]').disabled && (detailOf(doc).querySelector(".shop-why").textContent === "Sold out"));
  ({ ctx, doc } = await shop({ pick: "heavy" }));
  check("store player: too dear cannot be bought, and says why; limited stock shows what is left",
    detailOf(doc).querySelector('[data-action="buy"]').disabled && (detailOf(doc).querySelector(".shop-why").textContent === "Not enough Credits")
      && /1 left/.test(detailOf(doc).textContent));
  ({ ctx, doc } = await shop({ category: "ranged" }));
  check("store player: a section shows only its own, and picks its first",
    ([...doc.querySelectorAll(".shop-row")].map(r => r.dataset.pick).join() === "pistol,rifle") && listRow(doc, "pistol").classList.contains("picked")
      && (doc.querySelector(".shop-cat.on").dataset.category === "ranged") && !doc.querySelector(".shop-heading"));
  check("store player: buying as their own character, with the purse shown",
    /Buying as\s*Kael/.test(doc.querySelector(".buyer-pick").textContent) && !doc.querySelector("select[data-buyer]")
      && [...doc.querySelectorAll(".wallet-coin")].map(w => w.textContent.replace(/\s+/g, " ").trim()).join() === "Credits 100,Valuables 3,Alien Alloys 25");
  ({ ctx, doc } = await shop({ category: "sell" }));
  check("store player: Sell lists what they carry that has a price and is not fitted, at half price each",
    ([...doc.querySelectorAll(".shop-row")].map(r => `${r.dataset.pick}:${r.querySelector(".shop-row-price").textContent}`).join() === "idol:20 cr,kfrag:12 cr,med:10 cr")
      && /x3/.test(listRow(doc, "med").textContent));
  ({ ctx, doc } = await shop({ pick: "med" }));
  check("store player: a thing to sell, picked, shows what the store pays each, with Sell, marked to stay usable",
    (detailOf(doc).dataset.sellId === "med") && /10 cr each/.test(detailOf(doc).querySelector(".shop-price").textContent)
      && /Kael carries 3\./.test(detailOf(doc).textContent) && (detailOf(doc).querySelector(".sell-qty").getAttribute("max") === "3")
      && [...detailOf(doc).querySelectorAll("input, button")].every(el => el.hasAttribute("data-shop")));
  check("store player: a shopper's sheet saves nothing as it changes",
    gmSheet.options?.form?.submitOnChange !== false && (() => {
      const opts = StoreSheet.prototype._initializeApplicationOptions.call(Object.create(StoreSheet.prototype),
        { document: { isOwner: false }, form: { submitOnChange: true }, position: {}, classes: [] });
      return opts.form.submitOnChange === false;
    })());

  // Foundry disables every control on a sheet the viewer cannot edit; the shopping ones come back.
  {
    const live = async opts => {
      const { ctx: c } = await shop(opts);
      const d = new JSDOM(`<body>${tpl("templates/actor/store.hbs")(c)}</body>`).window.document;
      for ( const el of d.querySelectorAll("input, select, button, textarea") ) el.disabled = true;
      sheet.element = d.body;
      await sheet._onRender(c, {});
      return d;
    };
    const on = el => el && !el.disabled;
    const sellDoc = await live({ pick: "med" });
    const sellOk = [...detailOf(sellDoc).querySelectorAll("input, button")].every(on) && [...sellDoc.querySelectorAll(".shop-cat")].every(on);
    const fragDoc = await live({ category: "all", pick: "frag" });
    const medDoc = await live({ pick: "medkit" });
    const pistolDoc = await live({ pick: "pistol" });
    const heavyDoc = await live({ pick: "heavy" });
    check("store player: on the read only sheet, the categories, Buy, Sell, the counts and the currency pick are usable again; sold out and too dear stay off",
      sellOk && on(detailOf(fragDoc).querySelector('[data-action="buy"]')) && on(detailOf(fragDoc).querySelector(".shelf-qty"))
        && on(detailOf(medDoc).querySelector("select[data-pay]")) && !on(detailOf(pistolDoc).querySelector('[data-action="buy"]'))
        && !on(detailOf(heavyDoc).querySelector('[data-action="buy"]')));
    delete sheet.element;
    await shop({ category: "all", pick: "frag" });
  }
  // The GM's price typed on the shelf writes the shelf item, not the store.
  {
    const live = new JSDOM(`<body>${tpl("templates/actor/store.hbs")(gmCtx)}</body>`).window.document;
    gmSheet.element = live.body;
    game.user = { id: "gm", isGM: true, name: "GM" };
    await gmSheet._onRender(gmCtx, {});
    log.length = 0;
    const price = row(live, "frag").querySelector('[data-shelf-field="system.prices.credits"]');
    price.value = "27.6";
    price.dispatchEvent(new live.defaultView.Event("change", { bubbles: true }));
    const tick = row(live, "stim").querySelector('[data-shelf-field="system.accepts.valuables"]');
    tick.checked = true;
    tick.dispatchEvent(new live.defaultView.Event("change", { bubbles: true }));
    check("store gm: a price typed on the shelf goes on that item, a whole number; a tick lets a currency buy it",
      JSON.stringify(log) === JSON.stringify([["frag", { "system.prices.credits": 28 }], ["stim", { "system.accepts.valuables": true }]]), JSON.stringify(log));
    store.items.get("frag").system.prices.credits = 25;
    store.items.get("stim").system.accepts.valuables = false;
    delete gmSheet.element;
    game.user = { id: "p1", isGM: false, name: "Johnald", character: kael };
  }
  // Whoever runs the store switches between Manage and the shop as players see it.
  {
    game.user = { id: "gm", isGM: true, name: "GM" };
    const draw = async () => new JSDOM(tpl("templates/actor/store.hbs")(await gmSheet._prepareContext({}))).window.document;
    const manageDoc = await draw();
    await shopActs.switchView.call(gmSheet, {}, { dataset: { view: "shop" } });
    const preview = await draw();
    await shopActs.switchView.call(gmSheet, {}, { dataset: { view: "manage" } });
    const back = await draw();
    check("store gm: Manage first, with the switch; Shop shows it as players see it, the hidden prototype left out and nothing to edit; and back",
      !!manageDoc.querySelector(".store-shelf") && !manageDoc.querySelector(".shop") && manageDoc.querySelector('.store-views [data-view="manage"]').classList.contains("on")
        && !!preview.querySelector(".shop") && !preview.querySelector('input[name="name"]') && !preview.querySelector(".shelf-gm")
        && !preview.querySelector('.shop-row[data-pick="proto"]') && preview.querySelector('.store-views [data-view="shop"]').classList.contains("on")
        && !!back.querySelector(".store-shelf") && !!back.querySelector('input[name="name"]'));
    game.user = { id: "p1", isGM: false, name: "Johnald", character: kael };
  }
  // Buying something in unlimited supply happens at once, on the buyer's client: money off, goods on.
  log.length = 0;
  chats.length = 0;
  await storeMod.buyFromStore({ store, item: store.items.get("frag"), buyer: kael, qty: 2 });
  check("store buy: two grenades at 30 come off Kael's 100 Credits and join the two he carries",
    (kael.system.wealth.credits === 40) && (kael.items.get("kfrag").system.quantity === 4) && !log.some(([k]) => k === "kael.create")
      && !log.some(([k]) => k === "frag"), JSON.stringify(log));
  const card = new JSDOM(chats[0]?.content ?? "").window.document;
  check("store buy: chat says who bought what, from where, for how much",
    /Kael bought 2 × Frag Grenade for 60 cr\./.test(card.querySelector(".store-deal")?.textContent ?? "")
      && (card.querySelector(".card-sub").textContent === "The Black Market") && card.querySelector(".store-card").classList.contains("buy"));
  log.length = 0;
  await storeMod.buyFromStore({ store, item: store.items.get("rifle"), buyer: kael, qty: 2 });
  check("store buy: two rifles in Alien Alloys come as two rifles, the alloys paid",
    (kael.system.wealth.alloys === 1) && (log.find(([k]) => k === "kael.create")?.[1].length === 2), JSON.stringify(log));
  log.length = 0;
  notes.length = 0;
  await storeMod.buyFromStore({ store, item: store.items.get("rifle"), buyer: kael, qty: 1 });
  check("store buy: short of money, nothing changes and the player is told why",
    !log.length && notes.includes("Not enough Alien Alloys: 12 needed, 1 on hand."), JSON.stringify(notes));

  // Limited stock goes to the active GM's client, which counts it down.
  const emitted = [];
  game.socket = { emit: (channel, data) => emitted.push([channel, data]) };
  game.users = { activeGM: { id: "gm" } };
  storeMod.registerStoreActions();
  log.length = 0;
  await storeMod.buyFromStore({ store, item: store.items.get("heavy"), buyer: kael, qty: 1 });
  check("store buy: a player's purchase from limited stock goes to the GM, nothing done here",
    !log.length && (emitted.length === 1) && (emitted[0][0] === "system.irop") && (emitted[0][1].action === "storeBuy")
      && (emitted[0][1].payload.itemId === "heavy") && (emitted[0][1].userId === "p1"), JSON.stringify(emitted));
  game.users = { activeGM: null };
  notes.length = 0;
  await storeMod.buyFromStore({ store, item: store.items.get("heavy"), buyer: kael, qty: 1 });
  check("store buy: with no GM online, limited stock cannot be bought, and the player is told",
    notes.includes("No GM is connected. Items in limited stock need one online to count them down."));
  // On the GM's client: the player's request, carried out.
  kael.system.wealth.credits = 200;
  log.length = 0;
  const done = await storeMod.performPurchase({ storeUuid: "Actor.st1", itemId: "heavy", buyerUuid: "Actor.op1", qty: 1 }, { id: "p1", isGM: false, name: "Johnald" });
  check("store buy: the GM's client takes the price, gives the armor and counts the stock down to none",
    !done.error && (kael.system.wealth.credits === 92) && (log.find(([k]) => k === "kael.create")?.[1][0].name === "Heavy Armor")
      && (store.items.get("heavy").flags.irop.shelf.stock === 0) && !log.find(([k]) => k === "kael.create")?.[1][0].flags?.irop, JSON.stringify(log));
  const again = await storeMod.performPurchase({ storeUuid: "Actor.st1", itemId: "heavy", buyerUuid: "Actor.op1", qty: 1 }, { id: "p1", isGM: false, name: "Johnald" });
  check("store buy: the last one gone, the next buyer is told it is sold out", again.error === "Heavy Armor is sold out.");
  check("store buy: a player cannot buy what is hidden, or spend someone else's money",
    ((await storeMod.performPurchase({ storeUuid: "Actor.st1", itemId: "proto", buyerUuid: "Actor.op1", qty: 1 }, { id: "p1", isGM: false, name: "Johnald" })).error === "Prototype Rail is not for sale.")
      && ((await storeMod.performPurchase({ storeUuid: "Actor.st1", itemId: "frag", buyerUuid: "Actor.op2", qty: 1 }, { id: "p1", isGM: false, name: "Johnald" })).error === "Johnald cannot spend Wraith's money."));

  // Selling back: the store's share, paid at once; the last one leaves the sheet.
  log.length = 0;
  chats.length = 0;
  const credits = kael.system.wealth.credits;
  await storeMod.sellToStore({ store, item: kael.items.get("med"), seller: kael, qty: 2 });
  check("store sell: two Medkits at half of 20 bring 20 Credits, one left",
    (kael.system.wealth.credits === credits + 20) && (kael.items.get("med").system.quantity === 1)
      && /Kael sold 2 × Medkit for 20 cr\./.test(new JSDOM(chats[0]?.content ?? "").window.document.body.textContent));
  await storeMod.sellToStore({ store, item: kael.items.get("med"), seller: kael, qty: 1 });
  check("store sell: selling the last one takes it off the sheet", !kael.items.get("med") && log.some(([k, d]) => (k === "kael.med") && (d === "deleted")));
  notes.length = 0;
  await storeMod.sellToStore({ store, item: kael.items.get("dot"), seller: kael, qty: 1 });
  check("store sell: a fitted mod is not sold", /fitted/.test(notes[0] ?? ""));

  // Paying with another currency, and the store's preferred one (Johnald, 2026-10-10).
  notes.length = 0;
  log.length = 0;
  await storeMod.buyFromStore({ store, item: store.items.get("stim"), buyer: kael, qty: 1, currency: "valuables" });
  check("store buy: a currency ticked off cannot pay", !log.length && notes.includes("Stim Pack cannot be bought with Valuables."), JSON.stringify(notes));
  check("store buy: an item with no price cannot be bought",
    (await storeMod.performPurchase({ storeUuid: "Actor.st1", itemId: "junk", buyerUuid: "Actor.op1", qty: 1 }, { id: "p1", isGM: false, name: "Johnald" })).error === "Scrap has no price here.");
  store.system = new StoreData({ ...store.system.toObject(), preferred: "valuables" });
  ({ ctx, doc } = await shop({ category: "all", pick: "medkit" }));
  const medkitPrefers = payOptions(doc);
  ({ ctx, doc } = await shop({ pick: "stim" }));
  check("store preferred: a store preferring Valuables shows and charges them where the item takes them, Credits elsewhere",
    /Prefers Valuables\./.test(doc.querySelector(".store-terms-read").textContent) && (medkitPrefers === "credits:24 cr,valuables:2 Valuables*")
      && (detailOf(doc).querySelector(".shop-price").textContent === "18 cr"), medkitPrefers);
  ({ ctx, doc } = await shop({ category: "sell" }));
  check("store preferred: it buys back in Valuables what has a Valuables price, in Credits what has none",
    [...doc.querySelectorAll(".shop-row")].map(r => `${r.dataset.pick}:${r.querySelector(".shop-row-price").textContent}`).join() === "idol:3 Valuables,kfrag:12 cr");
  const valuables = kael.system.wealth.valuables;
  await storeMod.sellToStore({ store, item: kael.items.get("idol"), seller: kael, qty: 1 });
  check("store preferred: selling the Alien Idol there pays 3 Valuables", kael.system.wealth.valuables === valuables + 3);
  store.system = new StoreData({ ...store.system.toObject(), preferred: "credits" });
  // Picking Valuables in the detail panel pays with them.
  ({ ctx } = await shop({ category: "all", pick: "medkit" }));
  {
    const live = new JSDOM(`<body>${tpl("templates/actor/store.hbs")(ctx)}</body>`).window.document;
    detailOf(live).querySelector("select[data-pay]").value = "valuables";
    log.length = 0;
    const before = { ...kael.system.wealth };
    await StoreSheet.DEFAULT_OPTIONS.actions.buy.call(sheet, {}, detailOf(live).querySelector('[data-action="buy"]'));
    check("store buy: Valuables picked on the row pay for the Medkit, the Credits untouched",
      (kael.system.wealth.valuables === before.valuables - 2) && (kael.system.wealth.credits === before.credits)
        && (log.find(([k]) => k === "kael.create")?.[1][0].name === "Medkit"), JSON.stringify(log));
  }

  // Johnald, 2026-10-10: "On the store page lets move the buy option above the item description. Also lets
  // include a refund or buyback option incase someone does something by accident".
  {
    game.user = { id: "p1", isGM: false, name: "Johnald", character: kael };
    ({ ctx, doc } = await shop({ category: "all", pick: "rifle" }));
    const placeOf = cls => [...detailOf(doc).children].findIndex(el => el.classList.contains(cls));
    check("store detail: Buy comes first under the name, then what is carried, the stats, then the description",
      (placeOf("shop-detail-head") === 0) && (placeOf("shop-deal") === 1) && (placeOf("shop-deal") < placeOf("shop-carry"))
        && (placeOf("shop-carry") < placeOf("shop-stats")) && (placeOf("shop-stats") < placeOf("shop-desc")),
      [...detailOf(doc).children].map(el => el.className).join());
    ({ ctx, doc } = await shop({ category: "sell" }));
    check("store detail: Sell the same way, under the name", (placeOf("shop-deal") === 1) && (placeOf("shop-note") === 2));
    const sellQty = detailOf(doc).querySelector(".shop-qty");
    ({ ctx, doc } = await shop({ category: "all", pick: "frag" }));
    const buyQty = detailOf(doc).querySelector(".shop-qty");
    check("store detail: the box beside the stock count is labelled as how many to buy (or sell), not the stock",
      (buyQty?.querySelector("span")?.textContent === "Qty") && (buyQty.dataset.tooltip === "How many to buy") && !!buyQty.querySelector("input[data-shop-qty]")
        && (sellQty?.dataset.tooltip === "How many to sell"));

    // Johnald, 2026-10-10: "The quantity can be set higher than the stores amount".
    store.items.get("heavy").flags.irop.shelf.stock = 3;
    ({ ctx, doc } = await shop({ category: "all", pick: "heavy" }));
    const liveShop = new JSDOM(`<body>${tpl("templates/actor/store.hbs")(ctx)}</body>`).window.document;
    sheet.element = liveShop.body;
    await sheet._onRender(ctx, {});
    const qtyBox = detailOf(liveShop).querySelector("input[data-shop-qty]");
    const typeIn = value => {
      qtyBox.value = value;
      qtyBox.dispatchEvent(new liveShop.defaultView.Event("input", { bubbles: true }));
      return qtyBox.value;
    };
    check("store detail: how many to buy cannot go above what is left, nor below one",
      (qtyBox.getAttribute("max") === "3") && (typeIn("10") === "3") && (typeIn("0") === "1") && (typeIn("2") === "2") && (typeIn("-4") === "1"));
    delete sheet.element;
    store.items.get("heavy").flags.irop.shelf.stock = 0;
    // On a store's shelf the item sheet has no Quantity (it read as the stock), only a word on where the stock is.
    game.user = { id: "gm", isGM: true, name: "GM" };
    const shelfDoc = new FakeDoc({});
    Object.assign(shelfDoc, { id: "sh1", name: "Flare", type: "gear", img: "f.svg", uuid: "Actor.st1.Item.sh1", isOwner: true, effects: [], actor: store });
    Object.defineProperty(shelfDoc, "parent", { get: () => store });
    shelfDoc.getRollData = () => ({});
    shelfDoc.system = new itemModels.GearData({ quantity: 1 }, { parent: shelfDoc });
    const shelfDetails = new JSDOM((await renderSheet(IropItemSheet, shelfDoc)).out.details).window.document;
    check("store stock: a shelf item's sheet has no Quantity, Equipped or Stowed, and says the stock is on the store",
      !shelfDetails.querySelector('[name="system.quantity"], [name="system.equipped"], [name="system.stowed"]')
        && /its Stock there, on the store's Manage page/.test(shelfDetails.body.textContent) && !!shelfDetails.querySelector('[name="system.weight"]'));
    game.user = { id: "p1", isGM: false, name: "Johnald", character: kael };

    // Bug, Johnald, 2026-10-10: "Players seem capable of editing how much of an item a store has in stock".
    // A player given Owner of the store still gets only the shop; running it is the GM's.
    const ownerPlayer = new StoreSheet(store);
    const ownerOptions = ownerPlayer._initializeApplicationOptions({ document: store, form: { submitOnChange: true }, position: {}, classes: [] });
    const ownerCtx = await ownerPlayer._prepareContext({});
    const ownerDoc = new JSDOM(tpl("templates/actor/store.hbs")(ownerCtx)).window.document;
    check("store: a player who owns the store cannot run it: no Manage, no shelf fields, no stock to change, and its form saves nothing",
      (store.isOwner === true) && (ownerPlayer.isEditable === false) && ownerPlayer.shopView && !ownerCtx.manage
        && !ownerDoc.querySelector(".store-views, .store-shelf, [data-shelf-field], [data-action='toggleLimited']")
        && (ownerOptions.form.submitOnChange === false));
    game.user = { id: "gm", isGM: true, name: "GM" };
    const gmRun = new StoreSheet(store);
    check("store: the GM runs it", (gmRun.isEditable === true) && !gmRun.shopView
      && (gmRun._initializeApplicationOptions({ document: store, form: { submitOnChange: true }, position: {}, classes: [] }).form.submitOnChange === true));
    game.user = { id: "p1", isGM: false, name: "Johnald", character: kael };

    const player = { id: "p1", isGM: false, name: "Johnald" };
    const gmUser = { id: "gm", isGM: true, name: "GM" };
    let mid = 0;
    const cardOf = data => {
      const message = { id: `m${++mid}`, isAuthor: true, flags: structuredClone(data.flags), content: data.content };
      message.update = async d => { for ( const [k, v] of Object.entries(d) ) realUtils.setProperty(message, k, v); return message; };
      return message;
    };
    const madeIds = [];
    kael.createEmbeddedDocuments = async (type, list) => list.map(d => {
      const it = kaelItem(`new${madeIds.length}`, d.name, d.type, d.system);
      it.parent = kael;
      madeIds.push(it.id);
      kael.items.push(it);
      return it;
    });

    // A purchase that joined a stack: refunded in full.
    kael.system.wealth.credits = 100;
    const fragsBefore = kael.items.get("kfrag").system.quantity;
    chats.length = 0;
    await storeMod.buyFromStore({ store, item: store.items.get("frag"), buyer: kael, qty: 2 });
    const buyCard = chats.at(-1);
    const fragDeal = buyCard?.flags?.irop?.storeDeal ?? {};
    check("store undo: a purchase card has a Refund button, and keeps what it takes to refund",
      /data-irop-action="storeUndo"[\s\S]*Refund/.test(buyCard?.content ?? "") && (fragDeal.kind === "buy") && (fragDeal.whoUuid === "Actor.op1")
        && (fragDeal.total === 60) && (fragDeal.currency === "credits") && (JSON.stringify(fragDeal.given) === JSON.stringify([{ id: "kfrag", count: 2, after: fragsBefore + 2 }]))
        && !fragDeal.limited && (fragDeal.name === "Frag Grenade"), JSON.stringify(fragDeal));
    const fragMsg = cardOf(buyCard);
    check("store undo: only the character's player or a GM",
      (await storeMod.performUndo(fragMsg, { id: "p2", isGM: false, name: "Mara" })).error === "Mara cannot undo Kael's deal.");
    const refunded = await storeMod.performUndo(fragMsg, player);
    check("store undo: refunded, the grenades go back and every credit comes back; the card is marked",
      !refunded?.error && (kael.items.get("kfrag").system.quantity === fragsBefore) && (kael.system.wealth.credits === 100)
        && (fragMsg.flags.irop.storeDeal.undone === true), JSON.stringify(refunded));
    check("store undo: not twice", (await storeMod.performUndo(fragMsg, player)).error === "That deal has been undone already.");
    await storeMod.buyFromStore({ store, item: store.items.get("frag"), buyer: kael, qty: 2 });
    const usedMsg = cardOf(chats.at(-1));
    kael.items.get("kfrag").system.quantity -= 1;
    const refused = await storeMod.performUndo(usedMsg, player);
    check("store undo: nothing is refunded once any of it is used up",
      /Kael no longer carries all of the Frag Grenade bought, so it cannot be refunded\./.test(refused?.error ?? "") && !usedMsg.flags.irop.storeDeal.undone
        && (kael.system.wealth.credits === 40), JSON.stringify(refused));
    kael.items.get("kfrag").system.quantity = fragsBefore;

    // Bought as separate items: each goes back.
    kael.system.wealth.alloys = 30;
    await storeMod.buyFromStore({ store, item: store.items.get("rifle"), buyer: kael, qty: 2 });
    const rifleMsg = cardOf(chats.at(-1));
    const rifles = rifleMsg.flags.irop.storeDeal.given.map(g => g.id);
    await storeMod.performUndo(rifleMsg, player);
    check("store undo: two rifles bought as two items both go back, the alloys returned",
      (rifles.length === 2) && rifles.every(id => !kael.items.get(id)) && (kael.system.wealth.alloys === 30), JSON.stringify(rifles));

    // Limited stock: refunded on the GM's client, the stock counted back up.
    store.items.get("heavy").flags.irop.shelf.stock = 1;
    kael.system.wealth.credits = 200;
    await storeMod.performPurchase({ storeUuid: "Actor.st1", itemId: "heavy", buyerUuid: "Actor.op1", qty: 1 }, player);
    const heavyMsg = cardOf(chats.at(-1));
    heavyMsg.isAuthor = false;
    const asked = [];
    const realConfirmStore = foundry.applications.api.DialogV2.confirm;
    foundry.applications.api.DialogV2.confirm = async options => { asked.push(options); return true; };
    game.users = { activeGM: { id: "gm" } };
    emitted.length = 0;
    await storeMod.undoDeal(heavyMsg);
    check("store undo: asked first, in words; a player's refund of limited stock goes to the GM's client, nothing done here",
      /Give back 1 × Heavy Armor from Kael, for the 108 cr paid\?/.test(new JSDOM(asked[0]?.content ?? "").window.document.body.textContent)
        && (emitted.length === 1) && (emitted[0][1].action === "storeUndo") && (emitted[0][1].payload.messageId === heavyMsg.id)
        && (store.items.get("heavy").flags.irop.shelf.stock === 0), JSON.stringify(emitted));
    const heavyDone = await storeMod.performUndo(heavyMsg, player);
    check("store undo: on the GM's client, the armor goes back, the credits return and the stock is counted back up",
      !heavyDone?.error && (store.items.get("heavy").flags.irop.shelf.stock === 1) && (kael.system.wealth.credits === 200), JSON.stringify(heavyDone));
    asked.length = 0;
    foundry.applications.api.DialogV2.confirm = async options => { asked.push(options); return false; };
    await storeMod.buyFromStore({ store, item: store.items.get("frag"), buyer: kael, qty: 1 });
    const keptMsg = cardOf(chats.at(-1));
    const keptCredits = kael.system.wealth.credits;
    await storeMod.undoDeal(keptMsg);
    check("store undo: thought better of, nothing changes", (asked.length === 1) && !keptMsg.flags.irop.storeDeal.undone && (kael.system.wealth.credits === keptCredits));
    foundry.applications.api.DialogV2.confirm = realConfirmStore;
    game.users = { activeGM: null };

    // Selling back by mistake: bought back for what the store paid.
    const tool = kaelItem("tool", "Multitool", "gear", { prices: { credits: 30 }, quantity: 2 });
    tool.parent = kael;
    kael.items.push(tool);
    kael.system.wealth.credits = 50;
    await storeMod.sellToStore({ store, item: tool, seller: kael, qty: 1 });
    const saleCard = chats.at(-1);
    const saleDeal = saleCard?.flags?.irop?.storeDeal ?? {};
    check("store undo: a sale card has a Buy back button, and keeps what was sold",
      /data-irop-action="storeUndo"[\s\S]*Buy back/.test(saleCard?.content ?? "") && (saleDeal.kind === "sell") && (saleDeal.itemData?.name === "Multitool")
        && (saleDeal.itemData.system.quantity === 1) && !("_id" in saleDeal.itemData) && (saleDeal.total === 15), JSON.stringify(saleDeal));
    const saleMsg = cardOf(saleCard);
    await storeMod.performUndo(saleMsg, player);
    check("store undo: bought back, it rejoins the stack and the store's pay goes back",
      (kael.items.get("tool").system.quantity === 2) && (kael.system.wealth.credits === 50) && saleMsg.flags.irop.storeDeal.undone);
    await storeMod.sellToStore({ store, item: tool, seller: kael, qty: 2 });
    const lastMsg = cardOf(chats.at(-1));
    kael.system.wealth.credits = 10;
    const short = await storeMod.performUndo(lastMsg, player);
    check("store undo: not without the money to pay it back", /Kael needs 30 cr to buy the Multitool back\./.test(short?.error ?? "") && !kael.items.get("tool"));
    kael.system.wealth.credits = 80;
    await storeMod.performUndo(lastMsg, player);
    const back = kael.items.find(i => i.name === "Multitool");
    check("store undo: the last one sold comes back as it was", (back?.system.quantity === 2) && (back.type === "gear") && (kael.system.wealth.credits === 50));

    // The card in chat: the button for the character's player; once undone, a word in its place.
    const { onRenderChatMessage } = await import("../module/chat.mjs");
    game.user = { id: "p1", isGM: false, name: "Johnald" };
    const shown = (message, content) => {
      const d = new JSDOM(`<div>${content}</div>`).window.document;
      onRenderChatMessage(message, d.body);
      return d;
    };
    const liveDoc = shown(keptMsg, chats.find(c => c.flags?.irop?.storeDeal?.kind === "buy")?.content ?? "");
    const strangerMsg = { ...keptMsg, flags: { irop: { storeDeal: { ...keptMsg.flags.irop.storeDeal, whoUuid: "Actor.gone" } } } };
    const strangerDoc = shown(strangerMsg, buyCard.content);
    const undoneDoc = shown(fragMsg, buyCard.content);
    const soldDoc = shown(saleMsg, saleCard.content);
    check("store undo: in chat, the button works for the character's player, not for others; once undone, it says Refunded or Bought back",
      !liveDoc.querySelector('[data-irop-action="storeUndo"]')?.disabled && strangerDoc.querySelector('[data-irop-action="storeUndo"]')?.disabled
        && !undoneDoc.querySelector('[data-irop-action="storeUndo"]') && (undoneDoc.querySelector(".deal-undone")?.textContent === "Refunded")
        && (soldDoc.querySelector(".deal-undone")?.textContent === "Bought back"));
    kael.createEmbeddedDocuments = async (type, list) => { log.push(["kael.create", list]); return list; };
    store.items.get("heavy").flags.irop.shelf.stock = 0;
    game.user = { id: "p1", isGM: false, name: "Johnald", character: kael };
  }

  // What the detail panel says about each kind of item.
  const statLine = stats => stats.map(st => `${st.label}=${st.value}`).join("|");
  check("store detail: armor, gear and mods read what matters for each; kinds in a line",
    (statLine(itemStats({ type: "armor", system: { defense: 6, points: 4, dr: { ballistic: 1, physical: 1, fire: 0 }, mobility: { shift: 0, run: 1, sprint: 1 }, dodges: 1, weight: 6 } }))
      === "Defense=6|Armor=4|Damage reduction=Ballistic 1, Physical 1|Mobility=+1 Run, +1 Sprint|Dodges=+1|Weight=6")
      && (statLine(itemStats({ type: "gear", system: { kind: "medical", formula: "1d4 + @int.mod", consumable: true, weight: 1 } })) === "Effect=1d4 + INT mod|Use=Used up when used|Weight=1")
      && (statLine(itemStats({ type: "mod", system: { target: "ranged" } })) === "Fits=Ranged weapon")
      && (statLine(itemStats({ type: "weapon", system: { category: "thrown", weaponClass: "grenade", damage: { formula: "3d6", type: "explosive" }, blast: 2, feed: "magazine", ammo: { max: 0 } } }))
        === "Accuracy=0|Damage=3d6 Explosive|Blast=2 tiles")
      && (statLine(itemStats({ type: "weapon", system: { category: "ranged", weaponClass: "launcher", feed: "grenades", damage: { formula: "" } } })) === "Accuracy=0|Damage=From the grenade loaded|Feed=Grenades (4 slots)")
      && (typeLine({ type: "armor", system: { armorClass: "heavy" } }) === "Heavy armor") && (typeLine({ type: "gear", system: { kind: "medical" } }) === "Medical")
      && (typeLine({ type: "mod", system: { target: "armor" } }) === "Mod for armor"),
    statLine(itemStats({ type: "weapon", system: { category: "ranged", weaponClass: "launcher", feed: "grenades", damage: { formula: "" } } })));

  // Stocking: drop items on the store.
  game.user = { id: "gm", isGM: true, name: "GM" };
  const created = [];
  store.createEmbeddedDocuments = async (type, list) => { created.push(...list); return list; };
  const sidebar = (name, type, system) => ({ id: "w1", name, type, img: "x.svg", parent: null, system: { quantity: 1, ...system },
    toObject: () => ({ _id: "w1", name, type, img: "x.svg", system: { quantity: 4, equipped: true, ...system }, flags: {} }) });
  await gmSheet._onDropItem({}, sidebar("Flare", "gear", { prices: { credits: 15 } }));
  check("store stock: an item dropped on the store goes on the shelf, on show, as many in stock as were dropped (four flares)",
    (created.length === 1) && (created[0].name === "Flare") && (created[0].system.quantity === 1) && !created[0].system.equipped
      && (JSON.stringify(created[0].flags.irop.shelf) === JSON.stringify({ limited: true, stock: 4, hidden: false })));
  notes.length = 0;
  await gmSheet._onDropItem({}, sidebar("Dash", "ability", {}));
  await gmSheet._onDropItem({}, sidebar("Frag Grenade", "weapon", { weaponClass: "grenade" }));
  check("store stock: only carried things are sold; one already on the shelf is not added twice",
    (created.length === 1) && notes.includes("A store sells weapons, armor, gear and mods.") && notes.includes("Frag Grenade is already on the shelf."));
  log.length = 0;
  await gmSheet._onDropItem({}, Object.assign(sidebar("Heavy Armor", "armor", {}), { system: { quantity: 2 } }));
  check("store stock: one dropped on a limited item adds to its stock", JSON.stringify(log) === JSON.stringify([["heavy", { "flags.irop.shelf.stock": 2 }]]), JSON.stringify(log));
  log.length = 0;
  const btn = id => ({ closest: () => ({ dataset: { itemId: id } }) });
  await StoreSheet.DEFAULT_OPTIONS.actions.toggleHidden.call(gmSheet, {}, btn("frag"));
  await StoreSheet.DEFAULT_OPTIONS.actions.toggleLimited.call(gmSheet, {}, btn("frag"));
  check("store stock: the GM hides an item, and limits its stock starting at one",
    JSON.stringify(log) === JSON.stringify([["frag", { "flags.irop.shelf.hidden": true }], ["frag", { "flags.irop.shelf.limited": true, "flags.irop.shelf.stock": 1 }]]), JSON.stringify(log));

  // A new store: no bars, neither side's, and players may open it.
  globalThis.Actor ??= class {};
  const { IropActor } = await import("../module/documents.mjs");
  const base = Object.getPrototypeOf(IropActor.prototype);
  const hadPre = Object.prototype.hasOwnProperty.call(base, "_preCreate");
  const oldPre = base._preCreate;
  base._preCreate = async () => true;
  const made = { type: "store", _source: { ownership: { gm: 3 } }, updateSource(d) { this.set = d; } };
  await IropActor.prototype._preCreate.call(made, {}, {}, game.user);
  check("store actor: one of it, no bars, neutral, and open to players unless the GM says otherwise",
    (made.set.prototypeToken.actorLink === true) && (made.set.prototypeToken.displayBars === CONST.TOKEN_DISPLAY_MODES.NONE)
      && (made.set.prototypeToken.disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL) && (made.set.prototypeToken.bar1.attribute === null)
      && (made.set.ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) && (made.set.ownership.gm === 3)
      && (IropActor.getDefaultArtwork({ type: "store" }).img === "icons/svg/coins.svg"));
  if ( hadPre ) base._preCreate = oldPre;
  else delete base._preCreate;
  check("store actor: the type is registered, named, and has its sheet",
    /store: StoreData/.test(fs.readFileSync(path.join(ROOT, "module/irop.mjs"), "utf8"))
      && /registerSheet\(Actor, "irop", StoreSheet, \{\s*types: \["store"\]/.test(fs.readFileSync(path.join(ROOT, "module/irop.mjs"), "utf8"))
      && (JSON.parse(fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8")).TYPES.Actor.store === "Store")
      && ("store" in JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8")).documentTypes.Actor));

  foundry.utils = realUtils;
  game.user = oldUser;
  game.actors = oldActors;
  game.users = oldUsers;
  game.socket = oldSocket;
  globalThis.ui = oldUi;
  globalThis.ChatMessage = oldChat;
}

// ARTEMIS (Johnald, 2026-10-10): the sheet the Discord bot reads, built by this system's own
// rules, checked against the site's own reader; and the link and sync from a character's sheet.
{
  const snap = await import("../module/artemis/snapshot.mjs");
  const art = await import("../module/artemis/link.mjs");
  const saved = { settings: game.settings, user: game.user, world: game.world, system: game.system, ui: globalThis.ui,
    fetch: globalThis.fetch, window: globalThis.window, id: operative.id };
  const stored = { artemisUrl: "https://75th-eclipse.com/", artemisTokens: {} };
  game.settings = { get: (scope, key) => stored[key], set: async (scope, key, value) => { stored[key] = value; return value; } };
  game.world = { id: "world1", title: "IROP New Test" };
  game.system = { ...(game.system ?? {}), version: "0.1.0" };
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  globalThis.window = { location: { origin: "https://foundry.example.com" } };
  const notes = [];
  globalThis.ui = { notifications: { info: m => notes.push(m), warn: m => notes.push(m), error: m => notes.push(m) } };
  operative.id = "actorTest";

  const sheet = snap.buildSnapshot(operative, { origin: "https://foundry.example.com", world: game.world, systemVersion: "0.1.0" });
  const attackBy = name => sheet.attacks.find(a => a.name === name);
  const sys = operative.system;
  check("artemis sheet: format 1, the character, the world, a picture Discord can fetch",
    (sheet.v === 1) && (sheet.actor.id === "actorTest") && (sheet.world.id === "world1")
      && (sheet.actor.img === "https://foundry.example.com/icons/svg/mystery-man.svg") && (sheet.details.callsign === "Wraith")
      && (sheet.details.role.key === "outrider") && (sheet.details.species === "Human") && (sheet.details.rank === "Initiate")
      && (sheet.rules.tiebreak === true));
  check("artemis sheet: attributes and every skill's pool are the sheet's own",
    Object.entries(sys.attributes).every(([k, a]) => (sheet.attributes[k].value === a.value) && (sheet.attributes[k].mod === a.mod))
      && (sheet.skills.length === Object.keys(sys.skills).length)
      && sheet.skills.every(k => (k.skill === sys.skills[k.key].pool.skill) && (k.aptitude === sys.skills[k.key].pool.aptitude)
        && (k.rank === sys.skills[k.key].rank) && (k.label === sys.skills[k.key].label)));
  check("artemis sheet: vitals, Critical, Defense, movement, banks, wealth and statuses",
    (sheet.vitals.hp.max === sys.vitals.hp.max) && (sheet.combat.critical === sys.critical) && (sheet.combat.defense === 6)
      && (sheet.combat.movement.run === sys.movement.run) && (sheet.wealth.credits === sys.wealth.credits)
      && (JSON.stringify(sheet.statuses) === JSON.stringify([{ id: "bleeding", name: "Bleeding" }])));
  operative.effects = [{ statuses: new Set(["bleeding"]), flags: { irop: { counter: 2 } } }];
  check("artemis sheet: a status's X goes with it, in its name, as the sheet shows it (2026-10-10)",
    JSON.stringify(snap.buildSnapshot(operative, { origin: "https://foundry.example.com", world: game.world, systemVersion: "0.1.0" }).statuses)
      === JSON.stringify([{ id: "bleeding", name: "Bleeding (2)" }]));
  delete operative.effects;
  const pistol = attackBy("T1 Pistol");
  check("artemis sheet: a pistol's accuracy as its D.M., its range table, its loaded special ammo, its magazine",
    (pistol.attribute === "per") && (pistol.accuracy === -20) && (pistol.ranges.short.dm === -15) && (pistol.ranges.extreme.tiles === 30)
      && (pistol.special?.name === "Cryo Rounds") && (pistol.damage.typeLabel === "Cold") && (pistol.damage.formula === "2d2 + 1")
      && (JSON.stringify(pistol.ammo) === JSON.stringify({ value: 6, max: 6 })) && (pistol.engaged === "engaged") && pistol.equipped,
    JSON.stringify(pistol));
  const sword = attackBy("Survival Sword");
  check("artemis sheet: a formula has the character's numbers in it, as the sheet shows it",
    (sword.damage.formula === `1d6 + ${sys.attributes.str.mod}`) && (sword.critChance === 15) && (sword.damage.critDamage === 3)
      && (sword.attribute === "str") && (sword.ranges === null) && (sword.engaged === null));
  check("artemis sheet: grenades scatter thrown and count; the LAW scatters launched; the launcher fires what it holds",
    (attackBy("Frag Grenade").scatter === "thrown") && (attackBy("Frag Grenade").quantity === 2) && (attackBy("Frag Grenade").blast === 2)
      && (attackBy("LAW").scatter === "launched") && (attackBy("LAW").quantity === 1)
      && (JSON.stringify(attackBy("Grenade Launcher").loaded) === JSON.stringify(["Frag Grenade"])) && (attackBy("Grenade Launcher").projectile === "Frag Grenade")
      && (attackBy("Grenade Launcher").damage.formula === "2d4 + 1"));
  check("artemis sheet: a chemthrower burns with its save; a paraphysical attack rolls Charisma with its accuracy",
    (attackBy("Flame Chemthrower").burn?.save === "agi") && (attackBy("Flame Chemthrower").burn.saveLabel === "Agility")
      && (attackBy("Gravbolt").kind === "paraphysics") && (attackBy("Gravbolt").attribute === "cha") && (attackBy("Gravbolt").accuracy === -40)
      && (attackBy("Gravbolt").damage.formula === `2d4 + ${sys.attributes.cha.mod}`));
  check("artemis sheet: nothing stowed is an attack, and a rocket is carried, not fired",
    !attackBy("Spare Pistol") && !attackBy("RPG") && sheet.gear.some(g => (g.name === "RPG") && (g.quantity === 1)));
  check("artemis sheet: armor worn, and gear with what is stowed; a fitted mod is part of its weapon",
    (JSON.stringify(sheet.armor) === JSON.stringify([{ name: "Kevlar Armor", defense: 6, points: 4 }]))
      && sheet.gear.some(g => (g.name === "Medkit") && (g.quantity === 2)) && sheet.gear.some(g => (g.name === "Ration Pack") && g.stowed)
      && sheet.gear.some(g => g.name === "Ceramic Plate") && !sheet.gear.some(g => g.name === "Red Dot"));
  check("artemis sheet: only a picture another machine can reach is sent; formulas fill in, leaving what they cannot",
    (snap.absoluteImage("worlds/x/kael.webp", "http://localhost:30000") === "") && (snap.absoluteImage("", "https://a.b") === "")
      && (snap.absoluteImage("https://cdn.example.com/k.png") === "https://cdn.example.com/k.png")
      && (snap.resolveFormula("1d6 + @str.mod + @nope", { str: { mod: -1 } }) === "1d6 - 1 + @nope"));
  check("artemis sheet: whether it changed ignores when it was taken",
    snap.snapshotKey({ ...sheet, updatedAt: "a" }) === snap.snapshotKey({ ...sheet, updatedAt: "b" }));

  // The site's own reader takes this sheet whole: nothing the bot rolls from is dropped.
  const site = "C:/Tempest Knights/irop/functions/_lib/artemis";
  if ( fs.existsSync(path.join(site, "sheet.js")) ) {
    const reader = await import(pathToFileURL(path.join(site, "sheet.js")).href);
    const dice = await import(pathToFileURL(path.join(site, "dice.js")).href);
    const clean = reader.sanitizeSnapshot(JSON.parse(JSON.stringify(sheet)));
    check("artemis contract: the site reads this sheet, every attack and skill kept",
      clean.ok && (clean.snapshot.attacks.length === sheet.attacks.length) && (clean.snapshot.skills.length === sheet.skills.length)
        && (clean.snapshot.attributes.per.value === sheet.attributes.per.value), clean.error);
    check("artemis contract: every damage formula survives the site's check and its dice roller reads it",
      sheet.attacks.filter(a => a.damage).every(a => {
        const kept = clean.snapshot.attacks.find(b => b.id === a.id);
        return kept?.damage?.formula === a.damage.formula && dice.parseFormula(a.damage.formula).ok;
      }), JSON.stringify(sheet.attacks.map(a => a.damage?.formula)));
  }
  else check("artemis contract: the site's reader is where the test expects it", false, site);

  // Linking, with a stand-in site.
  const requests = [];
  let answer = () => ({ status: 200, body: { ok: true } });
  globalThis.fetch = async (url, init = {}) => {
    const req = { url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null };
    requests.push(req);
    const { status, body, fail } = answer(req);
    if ( fail ) throw new Error(fail);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  const token = "a".repeat(64);
  answer = () => ({ status: 200, body: { ok: true, token, characterId: "c1", discordName: "Johnald" } });
  const linked = await art.linkActor(operative, " ab-c12 3");
  check("artemis link: the code goes to the site with the sheet, read without case or dashes",
    linked && (requests[0].url === "https://75th-eclipse.com/api/artemis/link") && (requests[0].method === "POST")
      && (requests[0].body.code === "ABC123") && (requests[0].body.snapshot.actor.id === "actorTest"));
  check("artemis link: the token is kept in this browser only, keyed by world and character",
    art.isLinked(operative) && (stored.artemisTokens["world1:Actor.test"] === token) && notes.some(n => /linked to ODR ARTEMIS for Johnald/.test(n)));
  requests.length = 0;
  check("artemis sync: an unchanged sheet is not sent again", !(await art.syncActor(operative)) && !requests.length);
  await art.syncActor(operative, { force: true });
  check("artemis sync: sent with its token when asked", (requests.length === 1) && (requests[0].url === "https://75th-eclipse.com/api/artemis/sync")
    && (requests[0].headers.Authorization === `Bearer ${token}`) && (requests[0].body.snapshot.actor.name === operative.name));
  requests.length = 0;
  const hp = sys.vitals.hp.value;
  sys.vitals.hp.value = hp - 3;
  check("artemis sync: a changed sheet is sent", (await art.syncActor(operative)) && (requests.length === 1) && (requests[0].body.snapshot.vitals.hp.value === hp - 3));
  sys.vitals.hp.value = hp;
  answer = () => ({ status: 401, body: { error: "not linked" } });
  notes.length = 0;
  await art.syncActor(operative, { force: true });
  check("artemis sync: a dead link is forgotten, and the player told", !art.isLinked(operative) && notes.some(n => /no longer linked to ODR ARTEMIS/.test(n)));
  answer = () => ({ status: 404, body: { error: "That code is wrong or has run out." } });
  notes.length = 0;
  check("artemis link: a wrong code says what the site said, and links nothing",
    !(await art.linkActor(operative, "ZZZZZZ")) && !art.isLinked(operative) && notes.includes("That code is wrong or has run out."));
  answer = () => ({ fail: "offline" });
  notes.length = 0;
  check("artemis link: no site to reach says so", !(await art.linkActor(operative, "ABCDEF")) && notes.some(n => /could not be reached \(offline\)/.test(n)));
  answer = () => ({ status: 200, body: { ok: true, token, discordName: "" } });
  await art.linkActor(operative, "ABCDEF");
  check("artemis menu: linked, the sheet's menu offers sending now and unlinking",
    ["artemisSync", "artemisUnlink"].every(a => new OperativeSheet(operative)._getHeaderControls().some(c => c.action === a))
      && ["artemisLink", "artemisSync", "artemisUnlink"].every(a => a in OperativeSheet.DEFAULT_OPTIONS.actions));
  requests.length = 0;
  answer = () => ({ status: 200, body: { ok: true, unlinked: true } });
  await art.unlinkActor(operative);
  check("artemis unlink: the site is told with the token, and the link is forgotten",
    (requests[0]?.method === "DELETE") && (requests[0].headers.Authorization === `Bearer ${token}`) && !art.isLinked(operative));
  check("artemis menu: unlinked, it offers linking",
    new OperativeSheet(operative)._getHeaderControls().some(c => (c.action === "artemisLink") && (c.label === "Link to ODR ARTEMIS")));
  const stranger = Object.assign(Object.create(operative), { isOwner: false, uuid: "Actor.other" });
  requests.length = 0;
  notes.length = 0;
  check("artemis link: only the owner can link a character", !(await art.linkActor(stranger, "ABCDEF")) && !requests.length
    && notes.some(n => /Only the character's owner/.test(n)));
  check("artemis: the address setting's trailing slash is dropped, and it falls back to the site",
    (art.artemisUrl() === "https://75th-eclipse.com") && ((stored.artemisUrl = "  ") && (art.artemisUrl() === "https://75th-eclipse.com")));

  game.settings = saved.settings;
  game.user = saved.user;
  game.world = saved.world;
  game.system = saved.system;
  globalThis.ui = saved.ui;
  globalThis.fetch = saved.fetch;
  globalThis.window = saved.window;
  if ( saved.id === undefined ) delete operative.id;
  else operative.id = saved.id;
}

// The token health bar (Johnald, 2026-10-10): thicker health, the armor as a razor wrapped
// round its left end, and a pulsing force field while a barrier is up.
{
  const bars = await import("../module/canvas/token-bars.mjs");
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const oldCanvas = globalThis.canvas;
  const oldPixi = globalThis.PIXI;
  // A stand in for a PIXI Graphics: every drawing call is recorded and chains.
  const recorder = () => {
    const calls = [];
    const target = { calls, children: [], visible: true, alpha: 1, destroyed: false,
      position: { set(x, y) { target.pos = [x, y]; } },
      addChild(child) { target.children.push(child); return child; } };
    const drawing = ["clear", "lineStyle", "beginFill", "endFill", "drawRoundedRect", "drawRect", "drawPolygon", "drawEllipse", "moveTo", "lineTo", "arcTo"];
    const proxy = new Proxy(target, { get(t, k) {
      if ( k in t ) return t[k];
      if ( !drawing.includes(k) ) return undefined;
      return (...args) => { calls.push([k, ...args]); return proxy; };
    } });
    return proxy;
  };
  const count = (g, name) => g.calls.filter(c => c[0] === name).length;

  const lay = bars.vitalBarLayout({ width: 100, hp: 0.5, armor: 0.5, barrier: { value: 3, max: 5 } });
  check("token bar: 10% thinner than first built (10.8, blades 2.7 over its edges), the token's full width",
    near(lay.bh, 10.8) && near(lay.t, 2.7) && lay.x0 === 0 && near(lay.height, 14.4) && lay.barW === 100 && lay.hpW === 50 && lay.armorW === 50 && lay.tip === 6 && lay.radius === 3);
  check("token bar: half as thick again on a large token, scaled with Foundry's interface",
    near(bars.vitalBarLayout({ width: 200, large: true, hp: 1 }).bh, 16.2) && near(bars.vitalBarLayout({ width: 100, uiScale: 2, hp: 1 }).bh, 21.6));
  check("token bar: a pool's share left, nothing for a pool with no maximum",
    bars.poolShare({ value: 2, max: 4 }) === 0.5 && bars.poolShare({ value: 9, max: 4 }) === 1 && bars.poolShare({ value: 3, max: 0 }) === 0);

  const plain = recorder();
  plain.iropField = recorder();
  bars.drawVitalBar(plain, bars.vitalBarLayout({ width: 100, hp: 0.3, armor: 0, barrier: { value: 0, max: 5 } }));
  check("token bar: armor shredded, no blades or wrap; no barrier, no field",
    count(plain, "drawPolygon") === 0 && count(plain, "arcTo") === 0 && count(plain, "drawRoundedRect") === 2 && plain.iropField.visible === false);
  const full = recorder();
  full.iropField = recorder();
  bars.drawVitalBar(full, lay);
  const rounded = full.iropField.calls.filter(c => c[0] === "drawRoundedRect");
  // Health runs the token's full width (Johnald, 2026-10-10), the wrap curled over its left end, nothing past the token's edges.
  const xs = full.calls.flatMap(c => {
    if ( c[0] === "drawPolygon" ) return c[1].filter((_, i) => !(i % 2));
    if ( ["moveTo", "lineTo"].includes(c[0]) ) return [c[1]];
    if ( c[0] === "arcTo" ) return [c[1], c[3]];
    if ( ["drawRoundedRect", "drawRect"].includes(c[0]) ) return [c[1], c[1] + c[3]];
    return [];
  });
  const gaugeRect = full.calls.find(c => c[0] === "drawRoundedRect");
  check("token bar: health spans the token, x 0 to 100, and nothing in it reaches past either edge",
    gaugeRect[1] === 0 && gaugeRect[3] === 100 && Math.min(...xs) >= 0 && Math.max(...xs) <= 100);
  const shapes = full.iropField.calls.filter(c => c[0] === "drawPolygon");
  // The field is 106 wide from x -3 (five cells of 21.2) and 22 tall from y -3; three cells left reach x 60.6.
  check("token bar: armor's blades wrap the left end; a barrier of 3 of 5 is one smooth field, no lines between its cells",
    count(full, "drawPolygon") === 2 && count(full, "arcTo") === 2 && full.iropField.visible === true && !full.iropField.iropFlicker
      && !rounded.length && shapes.length === 4 && shapes.every(c => c[1].length === shapes[0][1].length)
      && (Math.abs(Math.max(...shapes[0][1].filter((_, i) => !(i % 2))) - 60.6) < 1e-9));
  check("token bar: where chunks broke off, a jagged edge and a faint outline of what was lost",
    shapes[0][1].length === bars.fieldOutline(-3, -3, 63.6, 22, 1, false).length && shapes[0][1].length > bars.fieldOutline(0, 0, 10, 10, 1, true).length
      && full.iropField.calls.some(c => (c[0] === "lineStyle") && (c[2] === bars.BAR_COLORS.spent) && (c[3] === 0.22)));
  check("token bar: no fog in the field (Johnald, 2026-10-10)", !count(full.iropField, "drawEllipse"));
  const whole = recorder();
  whole.iropField = recorder();
  bars.drawVitalBar(whole, bars.vitalBarLayout({ width: 100, hp: 1, armor: 1, barrier: { value: 5, max: 5 } }));
  check("token bar: a full barrier is whole, its right end straight, nothing marked as lost",
    whole.iropField.calls.filter(c => c[0] === "drawPolygon")[0][1].length === bars.fieldOutline(0, 0, 10, 10, 1, true).length
      && !whole.iropField.calls.some(c => (c[0] === "lineStyle") && (c[2] === bars.BAR_COLORS.spent) && (c[3] === 0.22)));
  check("barrier cells: one per point up to ten, a bigger barrier in ten equal cells, any barrier left lights a cell",
    JSON.stringify(bars.barrierCells(3, 5)) === JSON.stringify({ count: 5, active: 3, per: 1 })
      && JSON.stringify(bars.barrierCells(7, 20)) === JSON.stringify({ count: 10, active: 4, per: 2 })
      && bars.barrierCells(0.5, 20).active === 1 && bars.barrierCells(0, 5).count === 0
      && JSON.stringify(bars.barrierCells(4, 0)) === JSON.stringify({ count: 4, active: 4, per: 1 }) && bars.barrierCells(12, 10).active === 10);
  const last = recorder();
  last.iropField = recorder();
  bars.drawVitalBar(last, bars.vitalBarLayout({ width: 100, hp: 1, armor: 1, barrier: { value: 1, max: 5 } }));
  check("barrier cells: down to the last one, it flickers", last.iropField.iropFlicker === true && last.iropField.visible);

  // On a token: the first bar, when it is health, is drawn this way; the rest as Foundry draws them.
  const added = [];
  globalThis.canvas = { dimensions: { uiScale: 1 }, app: { ticker: { add(fn) { added.push(fn); } } } };
  globalThis.PIXI = { Graphics: function() { return recorder(); } };
  class Base { _drawBar(index) { this.superCalls = [...(this.superCalls ?? []), index]; } }
  const Token = bars.vitalBarsToken(Base);
  const token = new Token();
  token.document = { bar1: { attribute: "vitals.hp" }, bar2: { attribute: "vitals.energy" }, height: 1, getSize: () => ({ width: 100, height: 100 }) };
  token.actor = { system: { vitals: { armor: { value: 2, max: 4 }, barrier: { value: 3, max: 3 } } } };
  const bar1 = recorder();
  token._drawBar(0, bar1, { value: 6, max: 12, attribute: "vitals.hp" });
  token._drawBar(0, bar1, { value: 5, max: 12, attribute: "vitals.hp" });
  check("token bar: health drawn the system's way at the token's foot, the field pulsing on Foundry's ticker",
    !token.superCalls && bar1.pos[0] === 0 && near(bar1.pos[1], 85.6) && bar1.children.length === 1 && bar1.iropField.visible && added.length === 1);
  // Energy (Johnald, 2026-10-10): green, in the health bar's style, along the top, lined up with health.
  const energy = recorder();
  token._drawBar(1, energy, { value: 9, max: 18, attribute: "vitals.energy" });
  const fills = energy.calls.filter(c => c[0] === "beginFill").map(c => c[1]);
  const gauge = energy.calls.filter(c => c[0] === "drawRoundedRect");
  check("token bar: Energy is green in health's style, slimmer, along the top, the token's full width",
    !token.superCalls && energy.pos.join() === "0,0" && fills.includes(bars.BAR_COLORS.energy) && fills.includes(bars.BAR_COLORS.energyLight)
      && fills.includes(bars.BAR_COLORS.energyDark) && !fills.includes(bars.BAR_COLORS.hp)
      && gauge[0][1] === 0 && gauge[0][3] === 100 && near(gauge[0][4], 9) && gauge[1][3] === 50 && !energy.children.length);
  check("token bar: Energy half as thick again on a large token", near(bars.energyBarLayout({ width: 200, large: true, energy: 1 }).bh, 13.5));
  token.document.bar2 = { attribute: "vitals.luck" };
  token._drawBar(1, recorder(), { value: 2, max: 3, attribute: "vitals.luck" });
  token.document.bar1 = { attribute: "vitals.energy" };
  const other = recorder();
  token._drawBar(0, other, { value: 10, max: 18, attribute: "vitals.energy" });
  check("token bar: a bar set to anything but health or Energy stays Foundry's own", token.superCalls.join() === "1,0");
  // Each player can turn the style off for Foundry's plain bars (Johnald, 2026-10-10).
  const settingsBefore = game.settings;
  game.settings = { get(scope, key) { if ( key === "styledTokenBars" ) return false; throw new Error("no settings in tests"); } };
  token.document.bar1 = { attribute: "vitals.hp" };
  token.document.bar2 = { attribute: "vitals.energy" };
  token.superCalls = [];
  const plainBar = recorder();
  plainBar.iropField = recorder();
  token._drawBar(0, plainBar, { value: 6, max: 12, attribute: "vitals.hp" });
  token._drawBar(1, recorder(), { value: 9, max: 18, attribute: "vitals.energy" });
  check("token bar: turned off, both bars are Foundry's plain ones and the field is hidden",
    token.superCalls.join() === "0,1" && plainBar.iropField.visible === false && !plainBar.calls.length && bars.styledBarsOn() === false);
  game.settings = settingsBefore;
  check("token bar: on unless turned off", bars.styledBarsOn() === true);
  const redrawn = [];
  globalThis.canvas = { tokens: { placeables: [{ renderFlags: { set: f => redrawn.push(f) } }, { renderFlags: { set: f => redrawn.push(f) } }] } };
  bars.refreshAllTokenBars();
  check("token bar: changing the setting redraws every token's bars", redrawn.length === 2 && redrawn.every(f => f.refreshBars));

  // Armor or a barrier changing redraws the bars, as health does.
  const flags = [];
  const actor = { documentName: "Actor", getActiveTokens: () => [{ renderFlags: { set: f => flags.push(f) } }] };
  bars.onVitalsChanged(actor, { system: { vitals: { armor: { value: 1 } } } });
  bars.onVitalsChanged(actor, { name: "Kael" });
  bars.onVitalsChanged({ type: "armor", parent: actor }, {});
  bars.onVitalsChanged({ type: "gear", parent: actor }, {});
  check("token bar: redrawn when the vitals change or armor is put on or off, not for anything else",
    flags.length === 2 && flags.every(f => f.refreshBars === true));

  globalThis.canvas = oldCanvas;
  globalThis.PIXI = oldPixi;
}

// Effects only in Edit mode for players; a GM always sees them (Johnald, 2026-10-10).
{
  const oldUser = game.user;
  const tabIds = async sheet => Object.keys((await sheet._prepareContext({})).tabs ?? {});
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  const play = new OperativeSheet(operative);
  check("effects: a player in Play mode has no Effects tab or page",
    !(await tabIds(play)).includes("effects") && !("effects" in play._configureRenderParts({})) && (await tabIds(play)).includes("gear"));
  play.tabGroups = { primary: "effects" };
  await IropActorSheet.DEFAULT_OPTIONS.actions.toggleMode.call(play);
  check("effects: in Edit mode the player has them", (await tabIds(play)).includes("effects") && ("effects" in play._configureRenderParts({})));
  await IropActorSheet.DEFAULT_OPTIONS.actions.toggleMode.call(play);
  check("effects: back in Play mode on the Effects tab, the sheet goes back to the first tab",
    play.tabGroups.primary === "main" && !(await tabIds(play)).includes("effects"));
  const npcPlayer = new NpcSheet(operative);
  check("effects: the same on an NPC sheet", !(await tabIds(npcPlayer)).includes("effects"));
  game.user = { id: "gm", isGM: true, name: "GM" };
  const gmSheet = new OperativeSheet(operative);
  check("effects: a GM always has them, in Play mode too", (await tabIds(gmSheet)).includes("effects") && ("effects" in gmSheet._configureRenderParts({})));
  game.user = oldUser;
}

// Stowing worn armor takes it off; taking something out of stowage leaves it unworn.
{
  const sheet = new OperativeSheet(operative);
  const kevlar = operative.items.get("kevlar");
  const sent = [];
  kevlar.update = data => { sent.push(data); return data; };
  const at = id => ({ closest: () => ({ dataset: { itemId: id } }) });
  await IropActorSheet.DEFAULT_OPTIONS.actions.toggleStow.call(sheet, {}, at("kevlar"));
  check("stow: worn armor is taken off as it is stowed (and a held weapon put down)",
    sent[0]?.["system.stowed"] === true && sent[0]?.["system.equipped"] === false, JSON.stringify(sent));
  const rations = operative.items.get("rations");
  rations.update = data => { sent.push(data); return data; };
  await IropActorSheet.DEFAULT_OPTIONS.actions.toggleStow.call(sheet, {}, at("rations"));
  check("stow: taking out of stowage only unstows", JSON.stringify(sent[1]) === JSON.stringify({ "system.stowed": false }));
  delete kevlar.update;
  delete rations.update;
}

// A locked rank pip cannot change the rank even if a click reaches it; edit mode can.
{
  const sheet = new OperativeSheet(operative);
  const sent = [];
  const original = operative.update;
  operative.update = data => { sent.push(data); return data; };
  const target = { dataset: { attribute: "per", rank: "3" } };
  await IropActorSheet.DEFAULT_OPTIONS.actions.setAdvance.call(sheet, {}, target);
  check("attribute ranks: play mode ignores a click", sent.length === 0);
  await IropActorSheet.DEFAULT_OPTIONS.actions.toggleMode.call(sheet);
  await IropActorSheet.DEFAULT_OPTIONS.actions.setAdvance.call(sheet, {}, target);
  check("attribute ranks: edit mode sets the rank", sent.length === 1 && sent[0]["system.attributes.per.advances"] === 3, JSON.stringify(sent));
  operative.update = original;
}

// The portrait is square and as tall as the vitals column beside it (Johnald, 2026-10-06: no gap under it).
{
  const { context, out } = await renderSheet(OperativeSheet, operative);
  const root = new JSDOM(`<div class="application irop">${out.header}</div>`).window.document.querySelector(".application");
  const header = root.querySelector(".irop-header");
  let height = 203;
  Object.defineProperty(header.querySelector(".vitals"), "offsetHeight", { get: () => height });
  const watchers = [];
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.on = true; watchers.push(this); }
    observe() { this.cb([]); }
    disconnect() { this.on = false; }
  };
  const sheet = new OperativeSheet(operative);
  sheet.element = root;
  // On the window, which outlives a re-render of the header (bug, Johnald, 2026-10-17: the portrait jiggled).
  const size = () => root.style.getPropertyValue("--irop-portrait");
  await IropActorSheet.prototype._onRender.call(sheet, context, {});
  check("portrait: as tall as the vitals column, set on the window rather than the header",
    (size() === "203px") && !header.style.getPropertyValue("--irop-portrait"), size());
  height = 240.4; watchers.at(-1).cb([]);
  check("portrait: follows the column as it changes", size() === "240px", size());
  let idHeight = 0;
  Object.defineProperty(header.querySelector(".identity"), "offsetHeight", { get: () => idHeight });
  idHeight = 262; watchers.at(-1).cb([]);
  check("portrait: follows the identity column when it is the taller (2026-10-08)", size() === "262px", size());
  idHeight = 0;
  height = 60; watchers.at(-1).cb([]);
  check("portrait: never smaller than 112px", size() === "112px", size());
  await IropActorSheet.prototype._onRender.call(sheet, context, {});
  check("portrait: a re-render drops the old watcher", watchers.length === 2 && !watchers[0].on && watchers[1].on);
  sheet._onClose({});
  check("portrait: closing stops watching", !watchers[1].on);
  delete globalThis.ResizeObserver;

  const css = fs.readFileSync(path.join(ROOT, "styles/irop.css"), "utf8");
  check("portrait css: column and image both follow the measured size, square",
    /grid-template-columns:\s*var\(--irop-portrait, 112px\) 1fr 300px/.test(css)
      && /\.irop \.portrait \{\s*width:\s*var\(--irop-portrait, 112px\);\s*height:\s*var\(--irop-portrait, 112px\);/.test(css));
  const boonRule = css.match(/\.irop \.attr-roll\.boon \{([^}]*)\}/)?.[1] ?? "";
  check("boon css: an inner ODR Silver glow, accent top edge kept",
    /inset[^;]*var\(--odr-silver\)/.test(boonRule) && /border-top-color:\s*var\(--irop-accent\)/.test(boonRule), boonRule);
  check("boon css: hover keeps the glow", /\.irop \.attr-roll\.boon:hover:not\(:disabled\) \{[^}]*inset[^}]*--odr-silver/.test(css));
  check("attribute css: the tens wear the role color", /\.irop \.attr-roll \.score \.tens \{ color: var\(--irop-accent\); \}/.test(css));
  check("attribute css: the ones are a duller slate (Johnald, 2026-10-07)", /\.irop \.attr-roll \.score \.ones \{ color: var\(--irop-muted\); \}/.test(css));
  const ruleOf = sel => css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}"))?.[1] ?? "";
  check("attribute and stat buttons undo Foundry's fixed button height",
    [".irop .attr-roll", ".irop .stat"].every(sel => /height:\s*auto/.test(ruleOf(sel)) && /min-height:\s*0/.test(ruleOf(sel))));
  check("split score: tens are the modifier",
    JSON.stringify([splitScore(40, 4), splitScore(45, 4), splitScore(105, 10), splitScore(7, 0)])
      === JSON.stringify([{ tens: "4", ones: "0" }, { tens: "4", ones: "5" }, { tens: "10", ones: "5" }, { tens: "", ones: "7" }]));
  // Small text, raised 2026-10-07 (Johnald): nothing outside the record drawer and icon glyphs under 12px.
  const tiny = [...css.matchAll(/(?:^|\})\s*([^{}@]+?)\s*\{([^}]*)\}/g)]
    .filter(([, , body]) => Number(body.match(/font-size:\s*(\d+)px/)?.[1] ?? 99) < 14)
    .map(([, sel]) => sel.trim())
    .filter(sel => !/irop-record \.|record-(log|stamp|stack|bio|btn|entry)|\.step|\.pip\b|button\.icon/.test(sel));
  check("small text: nothing on the sheets under 14px (2px up, 2026-10-16)", tiny.length === 0, tiny.join(" | "));
  check("small text: labels 15px, secondary 14px, lighter slate",
    /--irop-label-size:\s*15px/.test(css) && /--irop-small-size:\s*14px/.test(css)
      && /\.irop \.mono-label \{[^}]*font-size: var\(--irop-label-size\);[^}]*color: var\(--irop-label-ink\);/.test(css));
  const bigRule = ruleOf(".irop .stat.big .stat-value");
  check("big stat css: the number fills the box, centred and large",
    /justify-content:\s*center/.test(bigRule) && /align-items:\s*center/.test(bigRule) && /flex:\s*1/.test(bigRule)
      && Number(bigRule.match(/font-size:\s*(\d+)px/)?.[1]) >= 24, bigRule);
  check("no white text in the system's windows: ink is slate (Johnald, 2026-10-07)",
    /\.application\.irop \{[^}]*--irop-ink:\s*var\(--irop-muted\);[^}]*--irop-ink-bright:\s*var\(--irop-muted\);/.test(css));
  const hardWhite = [...css.matchAll(/(?:^|\})\s*([^{}@]+?)\s*\{([^}]*)\}/g)]
    .filter(([, sel, body]) => /(^|[^-])color:\s*(#fff\b|#ffffff|white)/i.test(body) && !/record|irop-card/.test(sel))
    .map(([, sel]) => sel.trim());
  const rowRule = ruleOf(".irop .derived > .stat:not(.bonuses)");
  check("attributes row css: every label top and centre",
    /justify-content:\s*flex-start/.test(rowRule) && /align-items:\s*center/.test(rowRule) && /text-align:\s*center/.test(rowRule), rowRule);
  const sepRule = css.match(/\.irop \.derived > \.stat:not\(\.bonuses\) > \.mono-label::after,\s*\.irop \.attr-roll \.name::after \{([^}]*)\}/)?.[1] ?? "";
  check("separator css: one tapered gradient line under the row's labels and the attribute names (Johnald, 2026-10-07)",
    /content:\s*""/.test(sepRule) && /linear-gradient\(90deg, transparent, [^,]+, transparent\)/.test(sepRule)
      && /clip-path:\s*polygon\(0 50%, 50% 0, 100% 50%, 50% 100%\)/.test(sepRule), sepRule);
  check("skill groups css: two columns, the wide group spans both and splits its list in two",
    /grid-template-columns:\s*1fr 1fr/.test(ruleOf(".irop .skill-groups")) && /grid-column:\s*1 \/ -1/.test(ruleOf(".irop .skill-group.wide"))
      && /columns:\s*2/.test(ruleOf(".irop .skill-group.wide .skill-list")) && /break-inside:\s*avoid/.test(ruleOf(".irop .skill-group.wide .skill-row")));
  const skillRule = ruleOf(".irop .skill-roll"), attrBox = ruleOf(".irop .skill-roll .attr");
  check("skill css: names left aligned, the attribute boxed and right aligned",
    /justify-content:\s*flex-start/.test(skillRule) && /text-align:\s*left/.test(skillRule) && /margin-left:\s*auto/.test(attrBox) && /width:\s*100%/.test(skillRule)
      && /border:\s*1px solid/.test(attrBox) && /background:/.test(attrBox), `${skillRule} || ${attrBox}`);
  check("carried bar css: as thick as its label's line, lined up with Background's label",
    /height:\s*calc\(var\(--irop-label-size\) \* 1\.2\)/.test(ruleOf(".irop .carry-line .carry-meter")) && /116px/.test(ruleOf(".irop .carry-line")) && /116px/.test(ruleOf(".irop .identity-row")));
  check("the vital bars keep white text (Johnald, 2026-10-07)",
    /--irop-white:\s*#f4f7fb/.test(css)
      && /var\(--irop-white\)/.test(ruleOf(".irop .vital-values input"))
      && /var\(--irop-white-dim\)/.test(ruleOf(".irop .vital-values .max"))
      && /var\(--irop-white-dim\)/.test(ruleOf(".irop .vital-bar .step"))
      && !/\.application\.irop \{[^}]*--irop-white/.test(css));
  check("no hard coded white text outside the record and chat cards", hardWhite.length === 0, hardWhite.join(" | "));
  check("portrait css: item sheets keep their small icon", /\.irop \.portrait\.small \{ width: 64px; height: 64px; \}/.test(css));
}

// Mutations: only Mutants (RULED 2026-10-06).
{
  const panel = html => /<h3>Mutations<\/h3>/.test(html);
  // The fixture is a Human holding a mutation: the panel stays, with the warning, so it can be removed.
  let { context, out } = await renderSheet(OperativeSheet, operative);
  check("human with a stray mutation: panel shown with warning", panel(out.abilities) && out.abilities.includes("Only Mutants carry mutations")
    && context.strayMutations === true);

  const plainHuman = makeActor("operative", OperativeData, {}, [{ type: "species", name: "Human", system: { boons: true } }]);
  ({ context, out } = await renderSheet(OperativeSheet, plainHuman));
  check("human without mutations: no Mutations panel", !panel(out.abilities) && context.showMutations === false);
  // A mutation that asks for a choice (2026-10-17): a Choose button until chosen, then the choice on its row.
  const choiceActor = makeActor("operative", OperativeData, {}, [{ type: "species", name: "Mutant", system: { mutations: true } },
    { type: "mutation", name: "Aberrant Potential", id: "ap", system: { polarity: "positive", choice: { attribute: 5, skill: 1 } } },
    { type: "mutation", name: "Genetic Degradation", id: "gd", system: { polarity: "negative", choice: { attribute: -5, noLuck: true }, chosen: { attribute: "str" } } }]);
  const baronOut = (await renderSheet(OperativeSheet, choiceActor)).out.abilities;
  const bdoc = new JSDOM(baronOut).window.document;
  check("mutations: one waiting on a choice has a Choose button; one chosen says what it changed",
    !!bdoc.querySelector('[data-item-id="ap"] [data-action="chooseMutation"]') && !bdoc.querySelector('[data-item-id="gd"] [data-action="chooseMutation"]')
      && /Strength -5/.test(bdoc.querySelector('[data-item-id="gd"] .item-sub').textContent));
  check("human: Boons panel shown", /<h3>Boons<\/h3>/.test(out.abilities) && context.canTakeBoons === true);
  // No Paraphysical tag: the panel is hidden in play, and shown in edit mode so a GM can still set ranks (2026-10-08).
  const plainSheet = new OperativeSheet(plainHuman);
  plainSheet.tabGroups = { primary: "paraphysics" };
  check("not paraphysical: no Paraphysics tab or panel in play, and a tab left open there falls back to Attributes",
    !("paraphysics" in out) && !/<h3>Paraphysics<\/h3>/.test(out.abilities) && !plainSheet._getTabsConfig("primary").tabs.some(t => t.id === "paraphysics")
      && !("paraphysics" in plainSheet._configureRenderParts({})) && plainSheet.tabGroups.primary === "main");
  const userBefore = game.user;
  game.user = { ...(userBefore ?? {}), isGM: true };
  const plainEdit = await renderSheet(OperativeSheet, plainHuman, { editMode: true });
  game.user = userBefore;
  check("not paraphysical: a GM in edit mode still gets the tab, to set the first ranks", /<h3>Paraphysics<\/h3>/.test(plainEdit.out.paraphysics ?? "") && !/<h3>Paraphysics<\/h3>/.test(plainEdit.out.abilities));
  check("human: Boons take the full width", !/class="two-col"[\s\S]*?<h3>Boons/.test(out.abilities.split("<h3>Paraphysics")[0]));

  const baron = makeActor("operative", OperativeData, {}, [
    { type: "species", name: "Mutant", system: { mutations: true, health: 10, energy: 6 } },
    { type: "mutation", name: "Chitinous Shell", system: { polarity: "positive" } }
  ]);
  ({ context, out } = await renderSheet(OperativeSheet, baron));
  check("mutant: panel shown, no warning", panel(out.abilities) && !out.abilities.includes("Only Mutants carry") && context.canMutate === true);
  inspect("mutant operative bio", out.abilities, { actions: ACTIONS, source: baron.system._source });

  const vassal = makeActor("npc", NpcData, { details: { caste: "vassal" } }, []);
  ({ out } = await renderSheet(NpcSheet, vassal));
  check("npc with a caste: panel shown", panel(out.bio));
  const trooper = makeActor("npc", NpcData, {}, []);
  ({ out } = await renderSheet(NpcSheet, trooper));
  check("npc without caste or mutant species: no panel", !panel(out.bio));
  // Caste only for a Mutant (Johnald, 2026-10-17); one set before shows, flagged.
  const casteSelect = html => new JSDOM(html).window.document.querySelector('select[name="system.details.caste"]');
  const mutantNpc = makeActor("npc", NpcData, {}, [{ type: "species", name: "Mutant", system: { mutations: true } }]);
  const strayNpc = makeActor("npc", NpcData, { details: { caste: "baron" } }, [{ type: "species", name: "Xargryr", system: {} }]);
  const plainHead = (await renderSheet(NpcSheet, trooper)).out.header;
  const mutantHead = (await renderSheet(NpcSheet, mutantNpc)).out.header;
  const strayHead = (await renderSheet(NpcSheet, strayNpc)).out.header;
  check("npc caste: no dropdown without the Mutant species; a Mutant has it; one set on another species shows, flagged",
    !casteSelect(plainHead) && !!casteSelect(mutantHead) && !casteSelect(mutantHead).closest(".stray")
      && !!casteSelect(strayHead)?.closest(".field-inline.stray") && /Only Mutants have a caste/.test(casteSelect(strayHead).closest(".field-inline").dataset.tooltip));
}

// The Threat Codex (Johnald, 2026-10-17): the enemy's file as players and the GM see it, and the GM's reveals.
{
  const cx = await import("../module/codex.mjs");
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const oldUser = game.user, oldUtils = foundry.utils;
  const wraith = makeActor("npc", NpcData, { details: { threat: "elite", faction: "GENESIS" }, paraphysics: { telekinesis: 2 } }, [
    { type: "species", name: "Xargryr", system: {} },
    { type: "weapon", name: "Plasma Lance", id: "w1", system: { category: "ranged", damage: { formula: "2d6", type: "plasma" } } },
    { type: "weapon", name: "Shock Baton", id: "w2", system: { category: "melee", damage: { formula: "1d6", type: "electric" } } },
    { type: "ability", name: "Phase Step", id: "a1", system: { kind: "active", description: "<p>Steps through a wall.</p>" } },
    { type: "mutation", name: "Armored Hide", id: "m1", system: { polarity: "positive" } }
  ]);
  wraith.name = "Wraith Stalker";
  wraith.img = "wraith.webp";
  wraith.uuid = "Actor.wraith";
  foundry.utils = { ...oldUtils, fromUuidSync: u => (u === "Actor.wraith" ? wraith : null) };
  const facts = cx.actorFacts(wraith);
  check("codex: an enemy's file holds its classification, attributes, vitals, defenses, paraphysics and what it carries",
    eq(facts.classification.map(r => `${r.label}: ${r.value}`), ["Threat: Elite", "Species: Xargryr", "Faction: GENESIS"]) && (facts.attributes.length === 7)
      && facts.vitals.some(v => v.label === "Barrier") && facts.paraphysics.has && (facts.paraphysics.disciplines[0].value === 2)
      && eq(facts.weapons.map(w => w.name), ["Plasma Lance", "Shock Baton"]) && /2d6 Plasma/.test(facts.weapons[0].stats.find(st => st.label === "Damage")?.value ?? "")
      && (facts.abilities[0].text === "Steps through a wall.") && (facts.mutations[0].meta === "Positive"));
  // A page, with its updates caught.
  const page = { id: "pg1", name: "Wraith Stalker", type: "codex", updates: [], system: null };
  const sys = { actor: "Actor.wraith", img: "", reveal: { classification: false, attributes: false, vitals: false, defenses: false, paraphysics: false, lore: false },
    items: [], lore: "<p>Hunts alone at night.</p>", art: "", known: {} };
  page.system = { ...sys, toObject: () => structuredClone({ ...page.system, toObject: undefined }) };
  page.update = async changes => {
    page.updates.push(changes);
    for ( const [k, v] of Object.entries(changes) ) if ( k.startsWith("system.") ) foundry.utils.setProperty(page.system, k.slice(7), v);
    return page;
  };
  game.user = { id: "gm", isGM: true, name: "GM" };
  await cx.refreshCodexPage(page);
  check("codex: a fresh file shows players the art and nothing else", eq(Object.keys(page.system.known), ["progress"]) && (page.system.known.progress === 0) && (page.system.art === "wraith.webp"));
  const view = ctx => new JSDOM(tpl("templates/journal/codex-view.hbs")({ name: page.name, ...ctx, loreHTML: ctx.lore })).window.document;
  game.user = { id: "p1", isGM: false, name: "Player" };
  let d = view(cx.codexContext(page, { gm: false }));
  // Foundry drops a root part's outer tag (bug, 2026-10-17), so the styled file must sit inside a plain wrapper.
  const wrapper = new JSDOM(tpl("templates/journal/codex-view.hbs")({ name: page.name, ...cx.codexContext(page, { gm: false }) })).window.document.body.firstElementChild;
  check("codex: the page's root is a plain wrapper, the styled file inside it", (wrapper?.tagName === "DIV") && !wrapper.className && (wrapper.children.length === 1) && wrapper.firstElementChild.matches("article.irop-codex"));
  check("codex: a player starts with the name and art; every section and list redacted, no eyes",
    (d.querySelector(".codex-name").textContent === "Wraith Stalker") && (d.querySelector(".codex-art img").getAttribute("src") === "wraith.webp")
      && (d.querySelectorAll(".codex-sec.redacted").length === 9) && !d.querySelector(".codex-eye") && !/Plasma Lance|Hunts alone|Xargryr/.test(d.body.textContent));
  // The GM reveals a section, a weapon, and the field notes.
  game.user = { id: "gm", isGM: true, name: "GM" };
  await cx.revealSection(page, "attributes");
  await cx.revealItem(page, "w2");
  await cx.revealSection(page, "lore");
  d = view(cx.codexContext(page, { gm: true }));
  check("codex: the GM sees the whole file live, hidden parts dimmed, an eye on each",
    (d.querySelectorAll(".codex-sec.redacted").length === 0) && /Plasma Lance/.test(d.body.textContent) && (d.querySelectorAll("[data-codex-reveal]").length === 6)
      && (d.querySelectorAll("[data-codex-item]").length === 4) && d.querySelector('[data-codex-item="w2"]').classList.contains("on")
      && d.querySelector('[data-codex-section="vitals"]').classList.contains("hidden-part") && !d.querySelector('[data-codex-section="attributes"]').classList.contains("hidden-part"));
  game.user = { id: "p1", isGM: false, name: "Player" };
  d = view(cx.codexContext(page, { gm: false }));
  check("codex: the player now sees the attributes, the Shock Baton and the notes; the rest stays redacted",
    !d.querySelector('[data-codex-section="attributes"]').classList.contains("redacted") && d.querySelector('[data-codex-section="vitals"]').classList.contains("redacted")
      && /Shock Baton/.test(d.body.textContent) && !/Plasma Lance/.test(d.body.textContent) && /Hunts alone/.test(d.body.textContent)
      && /More may remain unknown/.test(d.querySelector('[data-codex-list="weapons"]').textContent) && d.querySelector('[data-codex-list="abilities"]').classList.contains("redacted")
      && /^\d+%$/.test(d.querySelector(".codex-intel b").textContent) && (page.system.known.progress > 0));
  check("codex: the players' copy holds only what was revealed",
    eq(Object.keys(page.system.known).sort(), ["attributes", "lore", "progress", "weapons"]) && (page.system.known.weapons.length === 1));
  game.user = { id: "gm", isGM: true, name: "GM" };
  await cx.revealList(page, "weapons");
  check("codex: Reveal all shows every weapon; again hides them all", eq(page.system.items.filter(i => i.startsWith("w")).sort(), ["w1", "w2"]));
  await cx.revealList(page, "weapons");
  check("codex: ...and hides them", !page.system.items.some(i => i.startsWith("w")));
  game.user = { id: "p1", isGM: false, name: "Player" };
  const before = page.updates.length;
  await cx.revealSection(page, "vitals");
  check("codex: a player cannot reveal anything", page.updates.length === before);
  game.user = oldUser;
  foundry.utils = oldUtils;
}

// ODR ranks and medals (Johnald, 2026-10-17).
{
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const api = foundry.applications.api;
  const realInput = api.DialogV2.input, realConfirm = api.DialogV2.confirm, oldUser = game.user, oldChat = globalThis.ChatMessage;
  const posted = [];
  globalThis.ChatMessage = { implementation: { create: async m => { posted.push(m); return m; }, getSpeaker: () => ({}) } };
  const vet = makeActor("operative", OperativeData, { xp: { earned: 1600 }, details: { record: { medals: [
    { id: "md1", name: "Orbital Cross", mission: "Week 3: Scavenge (Neo Seattle)", date: "17 May 2040", description: "Held the dam road.", by: "GM" }] } } }, []);
  vet.id = "vet000000001";
  vet.updates = [];
  vet.update = async d => { vet.updates.push(d); return vet; };
  game.user = { id: "gm", isGM: true, name: "GM" };
  const vs = new OperativeSheet(vet);
  const vctx = await vs._prepareContext({});
  const vhtml = tpl("templates/actor/record.hbs")(await vs._preparePartContext("record", { ...vctx }, {}));
  const vd = inspect("record ranks and medals", vhtml, { actions: ACTIONS, source: vet.system._source });
  check("ranks: 1600 XP earned is a Delta Sergeant, its band 1501 to 1900, Orbital Warrant next",
    (vet.system.serviceRank.key === "deltaSergeant") && /1501 to 1900 XP earned/.test(vd.querySelector(".record-rank-band").textContent)
      && /Orbital Warrant at 1901/.test(vd.querySelector(".record-rank").dataset.tooltip) && /deltaSergeant\.svg$/.test(vd.querySelector(".record-rank-img").getAttribute("src")));
  const pick = vd.querySelector('select[name="system.details.record.rank"]');
  check("ranks: a GM may set one by hand, By XP earned first and picked",
    (pick?.querySelectorAll("option").length === 11) && (pick.querySelector("option:checked")?.value === "") && (pick.querySelector("option").textContent === "By XP earned"));
  const medal = vd.querySelector('.record-medal[data-medal-id="md1"]');
  check("medals: each with a ribbon, its name, mission and date, and why; the GM can edit or remove it",
    /linear-gradient/.test(medal?.querySelector(".medal-ribbon")?.getAttribute("style") ?? "") && (medal.querySelector(".medal-name").textContent === "Orbital Cross")
      && /Week 3: Scavenge \(Neo Seattle\), 17 May 2040/.test(medal.querySelector(".medal-meta").textContent) && /Held the dam road/.test(medal.querySelector(".medal-why").textContent)
      && !!medal.querySelector('[data-action="editMedal"]') && !!medal.querySelector('[data-action="removeMedal"]') && !!vd.querySelector('[data-action="awardMedal"]'));
  const { medalRibbon } = await import("../module/sheets/actor-sheet.mjs");
  check("medals: the same medal always gets the same ribbon", (medalRibbon("Orbital Cross") === medalRibbon("Orbital Cross")) && (medalRibbon("Orbital Cross") !== medalRibbon("Purple Delta")));
  // Award one.
  api.DialogV2.input = async () => ({ name: "  Iron Star ", mission: "Week 4: Ambush Patrols", date: "20 May 2040", description: "Pulled Vex out of the fire." });
  await OperativeSheet.DEFAULT_OPTIONS.actions.awardMedal.call(vs, {}, {});
  const awarded = vet.updates.at(-1)?.["system.details.record.medals"];
  check("medals: the GM awards one, trimmed, with who awarded it, and chat hears it",
    (awarded?.length === 2) && (awarded[1].name === "Iron Star") && (awarded[1].by === "GM") && !!awarded[1].id
      && /awarded the <strong>Iron Star<\/strong>, Week 4: Ambush Patrols/.test(posted.at(-1)?.content ?? "") && /Pulled Vex out of the fire/.test(posted.at(-1).content));
  api.DialogV2.confirm = async () => true;
  await OperativeSheet.DEFAULT_OPTIONS.actions.removeMedal.call(vs, {}, { closest: () => ({ dataset: { medalId: "md1" } }) });
  check("medals: removing one takes it off", eq(vet.updates.at(-1)?.["system.details.record.medals"], []));
  // A player sees them, and cannot award, edit, remove or set a rank.
  game.user = { id: "p1", isGM: false, name: "Player" };
  const pctx = await vs._prepareContext({});
  const pd = new JSDOM(tpl("templates/actor/record.hbs")(await vs._preparePartContext("record", { ...pctx }, {}))).window.document;
  check("medals and ranks: a player reads them, with no GM controls",
    !!pd.querySelector(".record-medal") && !pd.querySelector('[data-action="awardMedal"], [data-action="editMedal"], [data-action="removeMedal"]') && !pd.querySelector(".record-rank-set"));
  // The promotion card.
  const { promotionHTML } = await import("../module/ranks.mjs");
  const { serviceRank } = await import("../module/rules/ranks.mjs");
  const card = promotionHTML("Kael", serviceRank(240), serviceRank(260));
  check("ranks: crossing 250 XP earned is a promotion to Ranger, said in chat with the insignia",
    /Promotion/.test(card) && /is promoted to <strong>Ranger<\/strong>, from Initiate/.test(card) && /ranger\.svg/.test(card)
      && /now holds the rank of/.test(promotionHTML("Kael", serviceRank(900), serviceRank(900, "ranger"))));
  // The hooks: XP earned past a band edge posts the promotion once, from the client that made the change.
  const { registerRankWatch } = await import("../module/ranks.mjs");
  const oldHooks = globalThis.Hooks;
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => { hooks[name] = fn; } };
  registerRankWatch();
  globalThis.Hooks = oldHooks;
  game.user = { id: "gm", isGM: true, name: "GM" };
  const rookie = { type: "operative", name: "Kael", system: { xp: { earned: 240 }, details: { record: { rank: "" } }, serviceRank: serviceRank(240) } };
  const before = posted.length;
  const opts = {};
  hooks.preUpdateActor(rookie, { system: { xp: { earned: 260 } } }, opts);
  hooks.updateActor(rookie, {}, opts, "someone-else");
  const quiet = posted.length === before;
  hooks.updateActor(rookie, {}, opts, "gm");
  const same = {};
  hooks.preUpdateActor(rookie, { system: { xp: { earned: 245 } } }, same);
  check("ranks: crossing into Ranger posts the promotion once, from the client that made the change; staying in the band posts nothing",
    quiet && (posted.length === before + 1) && /promoted to <strong>Ranger/.test(posted.at(-1).content) && !same.iropRank);
  api.DialogV2.input = realInput;
  api.DialogV2.confirm = realConfirm;
  game.user = oldUser;
  globalThis.ChatMessage = oldChat;
}

// Personnel Record drawer (2026-10-06).
{
  const agent = makeActor("operative", OperativeData, {
    details: { callsign: "Wraith", record: {
      age: "31", height: "5'10\"", eyes: "Grey", marks: "Burn scar, left forearm",
      nextOfKin: { name: "A. Vance", relation: "sister" },
      timeline: [{ date: "2033", entry: "Left the megacity." }, { date: "2038", entry: "Joined Eclipse." }]
    } }
  }, [
    { type: "species", name: "Human", system: { boons: true } },
    { type: "role", name: "Outrider", system: { role: "outrider" } },
    { type: "background", name: "Slum Dweller", system: {} }
  ]);
  agent.id = "abcDEF123xyz";
  const sheet = new OperativeSheet(agent);
  let context = await sheet._prepareContext({});
  let html = tpl("templates/actor/record.hbs")(await sheet._preparePartContext("record", { ...context }, {}));
  const doc = inspect("record drawer", html, { actions: ACTIONS, source: agent.system._source });
  const dock = doc.querySelector(".irop-record-dock");
  const drawer = doc.querySelector(".irop-record-dock > .irop-record");
  const bar = doc.querySelector(".irop-record-dock > .record-gutter > .record-bar");
  check("record: the button sits in the gutter, inside the sheet", !!bar);
  check("record: rendered, closed by default", !!drawer && !dock.classList.contains("open") && drawer.getAttribute("aria-hidden") === "true");
  check("record: the bar toggles the record", bar?.dataset.action === "toggleRecord" && bar.getAttribute("aria-expanded") === "false");
  check("record: closed, the bar points left (pull it out)",
    [...bar.querySelectorAll("i")].every(i => i.classList.contains("fa-caret-left")) && bar.querySelectorAll("i").length === 2);
  check("record: a stable seven digit number", /^\d{7}$/.test(context.record.number) && context.record.number === (await sheet._prepareContext({})).record.number);
  check("record: the assignment defaults to Eclipse", agent.system.details.record.assignment === "Eclipse");
  check("record: service panel shows species and callsign; the doctrine is the emblem now, not a Service line (2026-10-08)",
    /record-service[\s\S]*>Human</.test(html) && html.includes(">Wraith<") && !/Doctrine:/.test(html));
  // RULED 2026-10-06: the reference record's fields, less Measurements.
  const identityKeys = [...doc.querySelectorAll('.record-fields input[name^="system.details.record."]')]
    .map(el => el.name.replace("system.details.record.", ""));
  check("record: identity box is the reference fields, in order",
    identityKeys.join() === "firstName,lastName,age,race,nationality,profession,section,height,hair,eyes", identityKeys.join());
  check("record: no measurements, weight or origin", !/measurement|weight|origin/i.test(html));
  check("record: Section indented under Profession",
    !!doc.querySelector('.record-line.indent input[name="system.details.record.section"]'));
  check("record: service fields are inputs",
    ["enlisted", "assignment", "registry"].every(k => doc.querySelector(`input[name="system.details.record.${k}"]`)));
  agent.name = "Ilya Mara Vance";
  const named = await sheet._prepareContext({});
  check("record: first and last names suggested from the actor name",
    named.record.identity[0].placeholder === "Ilya" && named.record.identity[1].placeholder === "Mara Vance");
  check("record: no side switching, it always opens left", !("side" in context.record) && !/side-(left|right)/.test(html));
  check("record: Biography lives in the record", !!doc.querySelector('prose-mirror.record-biography[name="system.details.biography"]'));
  check("record: values print into the fields", doc.querySelector('input[name="system.details.record.height"]').value === "5'10\"");
  check("record: two timeline entries, edited outside the form",
    doc.querySelectorAll(".record-entry").length === 2
    && [...doc.querySelectorAll(".record-entry [data-record-field]")].every(el => !el.hasAttribute("name")));
  // Layout, 2026-10-06: the portrait alone and large on top; then Basic info beside the emblem and rank
  // (Biometrics until 2026-10-08); no attached file.
  check("record: no attached file anywhere", !/attach|record-file/i.test(html) && !("attachment" in agent.system._source.details.record));
  const body = doc.querySelector(".record-body");
  const sections = [...body.children].map(el => el.className);
  check("record: order is header, portrait, info beside emblem and rank, service, bio",
    sections.join(" | ") === "record-head | record-identity | record-pair | record-panel record-service | record-panel record-medals | record-panel record-bio", sections.join(" | "));
  const top = body.querySelector(".record-identity");
  check("record: the top section holds only the portrait, in its frame", top.children.length === 1 && top.firstElementChild.matches("[data-portrait-frame]")
    && !!top.querySelector("img.record-portrait"));
  // Photo framing (Johnald, 2026-10-16): the owner moves and zooms it; the frame carries where it centers.
  const frameEl = top.firstElementChild;
  check("record: the photo centers where its owner set it, and can be adjusted",
    /--px: 50%; --py: 18%; --pz: 1;/.test(frameEl.getAttribute("style")) && !!frameEl.querySelector('[data-action="framePortrait"]'));
  check("record: with no photo of its own the record shows the sheet's portrait; the header portrait is never framed",
    frameEl.querySelector("img.record-portrait").getAttribute("src") === operative.img && "recordPhoto" in OperativeSheet.DEFAULT_OPTIONS.actions);
  const pair = [...body.querySelector(".record-pair").children].map(el => el.classList[1]);
  check("record: Basic info on the left, emblem and rank on the right", pair.join() === "record-fields,record-insignia", pair.join());
  // Johnald, 2026-10-08: the role's emblem on top, the rank (Squaddie for now) below; Biometrics gone.
  const insignia = body.querySelector(".record-insignia");
  const roleItem = agent.items.find(i => i.type === "role");
  check("record: the top half is the doctrine's emblem, the role's own image, named",
    insignia.querySelector(".record-emblem img.record-emblem-img")?.getAttribute("src") === roleItem?.img
      && insignia.querySelector(".record-emblem .record-insignia-name").textContent === roleItem?.name);
  check("record: the bottom half is the ODR rank by XP earned (2026-10-17), Initiate at the start, with its insignia and band",
    (agent.system.details.record.rank === "") && (agent.system.serviceRank.key === "initiate")
      && insignia.querySelector(".record-rank img.record-rank-img")?.getAttribute("src") === "systems/irop/assets/icons/ranks/initiate.svg"
      && insignia.querySelector(".record-rank .record-insignia-name").textContent === "Initiate"
      && /Up to 250 XP earned/.test(insignia.querySelector(".record-rank-band").textContent)
      && /Next: Ranger at 251 XP earned/.test(insignia.querySelector(".record-rank").dataset.tooltip));
  check("record: Commendations, empty at first", /No commendations on file/.test(body.querySelector(".record-medals").textContent));
  check("record: Biometrics is gone; distinguishing marks moved under Basic info",
    !/Biometrics|fingerprint|Print on file/.test(html) && !!body.querySelector('.record-fields textarea[name="system.details.record.marks"]'));
  check("record: background links to its item", !!doc.querySelector('.record-service a[data-action="editItem"]'));
  check("record: no Close record button, the side bar is the only toggle (Johnald, 2026-10-06)",
    !/Close record/.test(html) && doc.querySelectorAll('[data-action="toggleRecord"]').length === 1 && !doc.querySelector(".record-head-tabs"));

  // Toggling opens it on the next render.
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);
  context = await sheet._prepareContext({});
  html = tpl("templates/actor/record.hbs")(await sheet._preparePartContext("record", { ...context }, {}));
  check("record: toggled open", /class="irop-record-dock page-record open/.test(html) && context.record.open === true);
  const openDoc = new JSDOM(html).window.document;
  const openBar = openDoc.querySelector(".record-bar");
  check("record: open, the bar points right (push it back in)",
    [...openBar.querySelectorAll("i")].every(i => i.classList.contains("fa-caret-right")) && openBar.getAttribute("aria-expanded") === "true");
  check("record: arrows point out to open, in to close",
    recordBarIcon(false) === "fa-caret-left" && recordBarIcon(true) === "fa-caret-right");
  const header = tpl("templates/actor/header.hbs")(await sheet._preparePartContext("header", { ...context }, {}));
  check("record: the header has no Record button, the side bar is the only toggle",
    !/record-toggle|toggleRecord/.test(header) && /data-action="toggleMode"/.test(header));
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);
  check("record: toggled closed again", (await sheet._prepareContext({})).record.open === false);

  // Notes off the tab bar, onto a side tab under Record (Johnald, 2026-10-11): one drawer, two pages.
  const drawerDoc = async () => new JSDOM(tpl("templates/actor/record.hbs")(await sheet._preparePartContext("record", { ...(await sheet._prepareContext({})) }, {}))).window.document;
  let nd = await drawerDoc();
  const gutterBars = [...nd.querySelectorAll(".record-gutter > .record-bar")];
  check("notes drawer: a Notes side tab under Record in the gutter, shut, pointing out",
    (gutterBars.map(b => b.dataset.action).join() === "toggleRecord,toggleNotes") && /Notes/.test(gutterBars[1].textContent)
      && (gutterBars[1].getAttribute("aria-expanded") === "false") && [...gutterBars[1].querySelectorAll("i")].every(i => i.classList.contains("fa-caret-left")));
  check("notes drawer: the editor for the owner's notes, with its rich text, in the drawer",
    !!nd.querySelector('.irop-record > .drawer-notes prose-mirror.drawer-notes-editor[name="system.details.notes"]'));
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleNotes.call(sheet);
  nd = await drawerDoc();
  let dk = nd.querySelector(".irop-record-dock");
  check("notes drawer: Notes opens the drawer on its Notes page, its tab lit and pointing in, Record's not",
    dk.classList.contains("open") && dk.classList.contains("page-notes") && !dk.classList.contains("page-record")
      && nd.querySelector(".notes-tab").classList.contains("active") && !nd.querySelector(".record-tab").classList.contains("active")
      && [...nd.querySelectorAll(".notes-tab i")].every(i => i.classList.contains("fa-caret-right"))
      && [...nd.querySelectorAll(".record-tab i")].every(i => i.classList.contains("fa-caret-left")));
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);
  nd = await drawerDoc();
  dk = nd.querySelector(".irop-record-dock");
  check("notes drawer: Record while the Notes are open turns the drawer to the record, still open",
    dk.classList.contains("open") && dk.classList.contains("page-record") && nd.querySelector(".record-tab").classList.contains("active"));
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleNotes.call(sheet);
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleNotes.call(sheet);
  check("notes drawer: Notes on its own open page shuts the drawer", (await sheet._prepareContext({})).record.open === false);
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);
  check("notes drawer: the drawer shut on Notes opens on the record from the Record tab",
    (await sheet._prepareContext({})).record.page === "record" && (await sheet._prepareContext({})).record.open === true);
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);
  {
    const ncss = fs.readFileSync(path.join(ROOT, "styles/irop.css"), "utf8");
    check("notes drawer css: one page at a time, the notes tab shorter than Record's, only the open page's tab lit",
      /\.irop-record-dock\.page-notes \.record-body \{ display: none; \}/.test(ncss) && /\.irop \.drawer-notes \{ display: none; \}/.test(ncss)
        && /\.record-bar\.notes-tab \{ height: 112px; \}/.test(ncss) && /\.irop-record-dock\.open \.record-bar\.active \{/.test(ncss)
        && !/\.irop-record-dock\.open \.record-bar \{/.test(ncss));
  }

  // Opening near the left of the screen shifts the sheet right to make room, as far as the screen allows.
  const moves = [];
  Object.assign(sheet, { rendered: true, position: { left: 100, top: 50, width: 920 } });
  sheet.setPosition = p => { moves.push(p); Object.assign(sheet.position, p); };
  globalThis.window = { innerWidth: 1920 };
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);
  check("record: sheet near the left edge shifts right to fit the drawer", sheet.position.left === 464, JSON.stringify(moves));
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);
  check("record: closing does not move the sheet", moves.length === 1);
  Object.assign(sheet.position, { left: 100 });
  globalThis.window = { innerWidth: 1200 };
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);
  check("record: on a narrow screen it shifts only as far as stays on screen", sheet.position.left === 280, JSON.stringify(moves));
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);
  Object.assign(sheet.position, { left: 700 });
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);
  check("record: with room already, the sheet stays put", sheet.position.left === 700 && moves.length === 2);
  await OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);

  // Detached into its own window (Foundry 14; Johnald, 2026-10-10: the record was cut off there,
  // then "expand out instead of in", then "a little twitchy"). A stand-in popup: moveBy moves it,
  // resizeBy changes its size (at most `cap` wider) and fires resize after Foundry's own handler,
  // which stretches its sheet to fill it (harness.mjs ResizeManager).
  const mainDoc = new JSDOM('<body><section class="application irop operative"></section></body>').window.document;
  const detDoc = new JSDOM('<body class="detached"><section class="application irop operative"></section></body>').window.document;
  const popup = ({ width = 935, height = 820, availWidth = 1920, availLeft = 0, screenX = 300, refuse = false, cap = Infinity } = {}) => {
    const listeners = new Set();
    const win = {
      innerWidth: width, innerHeight: height, outerWidth: width + 16, screenX, screen: { availWidth, availLeft }, calls: [],
      addEventListener: (type, fn) => listeners.add(fn),
      removeEventListener: (type, fn) => listeners.delete(fn),
      resizeBy(dx, dy) {
        win.calls.push(["resize", dx, dy]);
        if ( refuse ) return;
        dx = Math.min(dx, cap);
        win.innerWidth += dx;
        win.innerHeight += dy;
        win.outerWidth += dx;
        setTimeout(() => {
          Object.assign(sheet.position, { width: win.innerWidth - sheet.position.left, height: win.innerHeight - sheet.position.top });
          win.stretched = sheet.position.width;
          for ( const fn of [...listeners] ) fn();
        }, 0);
      },
      moveBy(dx, dy) { win.calls.push(["move", dx, dy]); win.screenX += dx; }
    };
    return win;
  };
  const putIn = (win, { own = true } = {}) => {
    // Its classes from a real element; its window the stand-in (no drawer inside: the drawer's own state is tested above).
    const { classList } = detDoc.createElement("section");
    classList.add("application", "irop", "operative");
    // Its inline translate kept as a list of what was written, in order.
    const style = { writes: [], set translate(v) { this.writes.push(v); this.value = v; }, get translate() { return this.value ?? ""; } };
    sheet.element = { classList, style, querySelector: () => null, ownerDocument: { body: detDoc.body, defaultView: win } };
    sheet.id = "irop-sheet-x";
    sheet.window = { windowId: own ? "irop-sheet-x" : "some-other-app" };
    moves.length = 0;
    Object.assign(sheet.position, { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight });
  };
  const settle = (ms = 40) => new Promise(r => setTimeout(r, ms));
  const toggle = () => OperativeSheet.DEFAULT_OPTIONS.actions.toggleRecord.call(sheet);
  const gliding = () => sheet.element.classList.contains("irop-gliding");
  const pulls = () => sheet.element.style.writes;
  const slideBefore = OperativeSheet.RECORD_SLIDE_MS;
  const waitBefore = OperativeSheet.WINDOW_RESIZE_WAIT;
  const settleBefore = OperativeSheet.SLIDE_SETTLE_MS;
  OperativeSheet.RECORD_SLIDE_MS = 0;
  OperativeSheet.WINDOW_RESIZE_WAIT = 20;
  OperativeSheet.SLIDE_SETTLE_MS = 0;
  globalThis.window = { innerWidth: 1920 };

  // Foundry measures the sheet for its window with the drawer left out.
  sheet.element = mainDoc.querySelector("section");
  sheet._configureRenderOptions({ window: { detach: true } });
  const measuredWithout = sheet.element.classList.contains("irop-detaching");
  sheet.element.classList.remove("irop-detaching");
  sheet._configureRenderOptions({ window: {} });
  check("detached: the drawer is left out while Foundry measures the sheet for its window",
    measuredWithout && !sheet.element.classList.contains("irop-detaching"));

  // In its window, sheet at the top left: nothing to fit.
  let win = popup();
  putIn(win);
  sheet.element.classList.add("irop-detaching");
  sheet._onDetach(mainDoc, detDoc);
  await settle();
  check("detached: a sheet already at its window's top left leaves the window alone, the drawer back",
    !win.calls.length && !moves.length && !sheet.element.classList.contains("irop-detaching"));
  // Johnald, 2026-10-10: "when closing the window you get the gray strip".
  const painted = el => /rgb\(10, 12, 15\)|#0a0c0f/i.test(el.style.getPropertyValue("background") || el.style.background);
  check("detached: the window behind the sheet is painted the sheet's black, page and body, on the page itself",
    painted(detDoc.documentElement) && painted(detDoc.body), detDoc.documentElement.style.cssText);
  const otherDoc = new JSDOM('<body class="detached"></body>').window.document;
  win = popup();
  putIn(win, { own: false });
  sheet._onDetach(mainDoc, otherDoc);
  await settle();
  check("detached: a window shared with another app is not repainted", !painted(otherDoc.documentElement) && !painted(otherDoc.body));

  // Anything hanging off the sheet left it in from the edge: the window is trimmed, the sheet kept in place on screen.
  win = popup({ width: 935 + 411 });
  putIn(win);
  Object.assign(sheet.position, { left: 411, width: 935 });
  sheet._onDetach(mainDoc, detDoc);
  await settle();
  check("detached: the window is trimmed to the sheet, at its top left, the sheet kept where it was on screen",
    (sheet.position.left === 0) && (sheet.position.width === 935) && (win.innerWidth === 935)
      && JSON.stringify(win.calls) === JSON.stringify([["resize", -411, 0], ["move", 411, 0]]), JSON.stringify(win.calls));

  // Opening: the window widens on its right, the sheet held still in it, then the sheet glides over.
  win = popup();
  putIn(win);
  await toggle();
  check("detached: opening the record widens the window on its right only, never moving it",
    sheet.recordOpen && (win.innerWidth === 935 + 464) && (win.screenX === 300)
      && JSON.stringify(win.calls) === JSON.stringify([["resize", 464, 0]]) && !sheet.element.classList.contains("record-inside"),
    JSON.stringify({ calls: win.calls, pos: sheet.position }));
  check("detached: while the window widens, Foundry's stretch is undone and the sheet holds its place and size",
    (win.stretched === 935 + 464) && (moves.length === 2) && (moves[0].left === 0) && (moves[0].width === 935), JSON.stringify(moves));
  check("detached: then the sheet glides over beside the record, keeping its size",
    (moves[1].left === 464) && !("width" in moves[1]) && (sheet.position.left === 464) && (sheet.position.width === 935) && gliding(),
    JSON.stringify(moves));
  check("detached: the glide is a translate: the sheet takes its place, pulled back to where it showed, then eased to it",
    JSON.stringify(pulls()) === JSON.stringify(["-464px 0", "0px 0"]) && !sheet.element.classList.contains("irop-resizing"), JSON.stringify(pulls()));
  await settle();
  check("detached: the glide's transition and translate come off once it is done", !gliding() && (sheet.element.style.translate === ""));
  win.calls.length = 0;
  moves.length = 0;
  await toggle();
  check("detached: shutting glides the sheet home at once, with the drawer, the window not yet touched",
    !sheet.recordOpen && (sheet.position.left === 0) && gliding() && !win.calls.length
      && JSON.stringify(pulls().slice(-2)) === JSON.stringify(["464px 0", "0px 0"]), JSON.stringify({ moves, pulls: pulls() }));
  await settle();
  check("detached: once the slide is done, the window gives back its width on its right",
    (sheet.position.left === 0) && (sheet.position.width === 935) && (win.innerWidth === 935)
      && JSON.stringify(win.calls) === JSON.stringify([["resize", -464, 0]]) && !gliding(), JSON.stringify(win.calls));

  // Opened again while still sliding shut: the room stays, the sheet glides back over.
  win = popup();
  putIn(win);
  await toggle();
  await settle();
  win.calls.length = 0;
  await toggle();
  // Partway home: the browser shows it 200px along from its new place.
  win.getComputedStyle = () => ({ translate: "200px" });
  await toggle();
  check("detached: opened again partway home, the sheet turns from where it shows, not from either end",
    JSON.stringify(pulls().slice(-2)) === JSON.stringify(["-264px 0", "0px 0"]), JSON.stringify(pulls()));
  delete win.getComputedStyle;
  await settle();
  check("detached: opened again before the room went back, the window keeps it and the sheet glides back",
    sheet.recordOpen && (sheet.position.left === 464) && !win.calls.length && (win.innerWidth === 935 + 464), JSON.stringify(win.calls));
  await toggle();
  await settle();
  check("detached: and shut after that, the room goes back once", JSON.stringify(win.calls) === JSON.stringify([["resize", -464, 0]]));

  // Shut while the window was still taking its size: it gives the width straight back.
  win = popup();
  putIn(win);
  const opening = toggle();
  await toggle();
  await opening;
  await settle();
  check("detached: shut while the window was widening, the window and sheet end as they began",
    !sheet.recordOpen && (sheet.position.left === 0) && (win.innerWidth === 935)
      && JSON.stringify(win.calls) === JSON.stringify([["resize", 464, 0], ["resize", -464, 0]]), JSON.stringify(win.calls));

  // Near the screen's right edge: the window moves left, whole, by what the screen lacks, then widens.
  win = popup({ screenX: 1920 - 951 - 100 });
  putIn(win);
  await toggle();
  check("detached: near the screen's right edge the window first moves left by what is missing, then widens",
    (sheet.position.left === 464) && (win.screenX + win.outerWidth === 1920)
      && JSON.stringify(win.calls) === JSON.stringify([["move", -364, 0], ["resize", 464, 0]]), JSON.stringify(win.calls));
  win.calls.length = 0;
  await toggle();
  await settle();
  check("detached: shut there, it narrows on its right and stays put, so it opens again without moving",
    JSON.stringify(win.calls) === JSON.stringify([["resize", -464, 0]]));
  win.calls.length = 0;
  await toggle();
  check("detached: opened again there, it only widens", JSON.stringify(win.calls) === JSON.stringify([["resize", 464, 0]]));
  await toggle();
  await settle();
  // On a second screen to the right, its edge is that screen's.
  win = popup({ availLeft: 1920, screenX: 1920 + 300 });
  putIn(win);
  await toggle();
  check("detached: on a second screen the room is measured against that screen's edge",
    JSON.stringify(win.calls) === JSON.stringify([["resize", 464, 0]]), JSON.stringify(win.calls));
  await toggle();
  await settle();

  // A window wide enough already (maximized): the sheet gives up the room, gliding, the window is left alone.
  win = popup({ width: 1920 });
  putIn(win);
  await toggle();
  check("detached: in a wide window the sheet makes the room itself, at its full default width or more, gliding",
    (sheet.position.left === 464) && (sheet.position.width === 1456) && !win.calls.length && gliding());
  check("detached: there it eases left and width together, its right edge still, not as a translate",
    sheet.element.classList.contains("irop-resizing") && !pulls().length);
  await toggle();
  check("detached: shut, the sheet glides back to fill the wide window", (sheet.position.left === 0) && (sheet.position.width === 1920) && gliding());
  await settle();

  // No room on the screen to grow: the record opens inside the sheet.
  win = popup({ availWidth: 1200 });
  putIn(win);
  await toggle();
  check("detached: with no room on screen, the record opens inside the sheet",
    sheet.recordOpen && sheet.element.classList.contains("record-inside") && (sheet.position.left === 0) && !win.calls.length && !gliding());
  await toggle();
  await settle();
  check("detached: shut, the inside opening is undone", !sheet.element.classList.contains("record-inside"));

  // A window that will not change size: inside, after the wait.
  win = popup({ refuse: true });
  putIn(win);
  await toggle();
  check("detached: a window that refuses to grow falls back to the record inside",
    sheet.element.classList.contains("record-inside") && (sheet.position.left === 0) && (sheet.position.width === 935)
      && JSON.stringify(win.calls) === JSON.stringify([["resize", 464, 0]]), JSON.stringify(win.calls));
  await toggle();
  await settle();

  // A window that takes only part of it: what it took goes back, and the record opens inside.
  win = popup({ cap: 200 });
  putIn(win);
  await toggle();
  await settle();
  check("detached: a window that only partly widens is put back as it was, the record inside",
    sheet.element.classList.contains("record-inside") && (win.innerWidth === 935) && (sheet.position.left === 0) && (sheet.position.width === 935)
      && JSON.stringify(win.calls) === JSON.stringify([["resize", 464, 0], ["resize", -200, 0]]), JSON.stringify({ calls: win.calls, pos: sheet.position }));
  await toggle();
  await settle();

  // Sharing another app's window: that window is not the sheet's to resize.
  win = popup();
  putIn(win, { own: false });
  await toggle();
  check("detached: in another app's window, the record opens inside and the window is left alone",
    sheet.element.classList.contains("record-inside") && !win.calls.length);
  await toggle();
  await settle();

  // Detached with the record open: it gets its room in the new window.
  win = popup();
  putIn(win);
  await toggle();
  win = popup();
  putIn(win);
  sheet._onDetach(mainDoc, detDoc);
  await settle();
  check("detached: a sheet detached with its record open widens its new window for it",
    sheet.recordOpen && (sheet.position.left === 464) && JSON.stringify(win.calls) === JSON.stringify([["resize", 464, 0]]),
    JSON.stringify(win.calls));

  // Back in the main window with the record open: the main window's way, inside opening undone.
  sheet.element = mainDoc.querySelector("section");
  sheet.element.classList.add("record-inside", "irop-gliding", "irop-resizing");
  sheet.element.style.translate = "-120px 0";
  Object.assign(sheet.position, { left: 100, width: 935 });
  moves.length = 0;
  sheet._onAttach(detDoc, mainDoc);
  check("detached: back in the main window with the record open, the sheet shifts right to fit it",
    !sheet.inDetachedWindow && (sheet.position.left === 464) && !sheet.element.classList.contains("record-inside")
      && !sheet.element.classList.contains("irop-gliding") && !sheet.element.classList.contains("irop-resizing")
      && !sheet.element.style.translate);
  await toggle();
  moves.length = 0;
  sheet._onAttach(detDoc, mainDoc);
  check("detached: back with the record shut, the sheet stays put", !moves.length);
  sheet.element.classList.add("irop-detaching");
  await toggle();
  check("detached: after a detach that failed, the record button still brings the drawer back",
    !sheet.element.classList.contains("irop-detaching"));
  await toggle();
  OperativeSheet.RECORD_SLIDE_MS = slideBefore;
  OperativeSheet.WINDOW_RESIZE_WAIT = waitBefore;
  OperativeSheet.SLIDE_SETTLE_MS = settleBefore;
  delete sheet.element;
  delete sheet.id;
  delete sheet.window;
  delete globalThis.window;

  // The stylesheet: gutter inside the sheet, the button never stretched by offsets (the 2026-10-06 bug).
  const css = fs.readFileSync(path.join(ROOT, "styles/irop.css"), "utf8");
  // Every block for a selector, joined: a selector can appear in more than one rule.
  const rule = sel => [...css.matchAll(new RegExp("(?:^|\\}|\\*\\/)\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "gm"))]
    .map(m => m[1]).join("\n");
  check("record css: the sheet body makes room for the gutter",
    /padding-left:\s*var\(--irop-record-gutter\)/.test(rule(".application.irop.operative .window-content")));
  check("record css: the gutter starts below the title bar", /top:\s*var\(--header-height/.test(rule(".irop .record-gutter")));
  const barRule = rule(".irop .irop-record-dock .record-bar");
  check("record css: the button has its own height, not top and bottom offsets",
    /height:\s*\d+px/.test(barRule) && !/\btop:/.test(barRule) && !/\bbottom:/.test(barRule) && !/position:\s*absolute/.test(barRule));
  // Widened 15px (Johnald, 2026-10-06, after 25 proved too much): the gutter is 37px, the bar fills it less 3px a side, and the sheet grew to match.
  check("record css: the gutter is 37px and the bar follows it",
    /--irop-record-gutter:\s*37px/.test(rule(".application.irop.operative"))
      && /width:\s*calc\(var\(--irop-record-gutter, 37px\) - 6px\)/.test(barRule), barRule);
  check("sheets open at 1100 x 850 (Johnald, 2026-10-17), the operative too, gutter and all", (OperativeSheet.DEFAULT_OPTIONS.position.width === 1100) && (IropActorSheet.DEFAULT_OPTIONS.position.width === 1100) && (IropActorSheet.DEFAULT_OPTIONS.position.height === 850));
  check("record css: the drawer sits flush against the sheet's left edge", /right:\s*100%;/.test(rule(".irop .irop-record")));
  // Detached (Foundry 14, 2026-10-10): the window ends at the sheet, so the drawer opens inside it, from the gutter.
  const detRule = rule(".application.irop.operative.record-inside:not(.record-only) .irop-record");
  const detOpen = rule(".application.irop.operative.record-inside:not(.record-only) .irop-record-dock.open .irop-record");
  check("record css: no room to be made, the drawer opens inside the sheet from the gutter, below the title bar",
    /right:\s*auto/.test(detRule) && /left:\s*var\(--irop-record-gutter/.test(detRule) && /top:\s*var\(--header-height/.test(detRule)
      && /clip-path:\s*inset\(0 100% 0 0\)/.test(detRule) && /transform:\s*translateX\(-48px\)/.test(detRule)
      && /transform:\s*none/.test(detOpen) && /clip-path:\s*inset\(0 -40px 0 0\)/.test(detOpen), detRule);
  check("record: the slide time in the sheet code matches the stylesheet's",
    new RegExp(`clip-path ${OperativeSheet.RECORD_SLIDE_MS}ms`).test(rule(".irop .irop-record")) && (OperativeSheet.RECORD_SLIDE_MS === 260));
  const glideRule = rule(".application.irop.operative.irop-gliding");
  const sizeRule = rule(".application.irop.operative.irop-gliding.irop-resizing");
  check("record css: detached, the sheet glides with the drawer's own time and easing, as a translate",
    new RegExp(`transition:\\s*translate ${OperativeSheet.RECORD_SLIDE_MS}ms ease;`).test(glideRule)
      && /clip-path 260ms ease, transform 260ms ease/.test(rule(".irop .irop-record")), glideRule);
  check("record css: in a wide window, left and width ease together at the same pace",
    new RegExp(`left ${OperativeSheet.RECORD_SLIDE_MS}ms ease, width ${OperativeSheet.RECORD_SLIDE_MS}ms ease`).test(sizeRule), sizeRule);
  check("record css: the black a detached sheet's window is painted is the sheet's own",
    /--irop-bg:\s*#0a0c0f/.test(css) && !/body\.detached/.test(css));
  check("record css: detached, the drawer is left out while the sheet is measured",
    /display:\s*none/.test(rule(".application.irop.operative.irop-detaching:not(.record-only) .irop-record")));
  // Bug, Johnald, 2026-10-10 ("I cannot type into the field"): Foundry's editor must stay a column,
  // or its text box has no height once opened.
  // Johnald, 2026-10-10: "On the buy panel highlight it in gold so it sticks out against the rest of the info".
  const dealRule = rule(".irop .shop-deal");
  check("store css: the buy panel is gold, its border, its glow and its Buy button",
    /border-left:\s*3px solid var\(--irop-warn\)/.test(dealRule) && /var\(--irop-warn\) 18%/.test(dealRule) && /box-shadow/.test(dealRule)
      && /background:\s*var\(--irop-warn\)/.test(rule(".irop :where(.window-content) .shop-deal button:enabled"))
      && /color:\s*var\(--irop-warn\)/.test(rule(".irop .shop-deal .shop-price")) && /--irop-warn:\s*#d9b234/.test(css), dealRule);
  const editorRules = rule(".irop prose-mirror");
  check("banner css: a background's perks are gold ribbons with a notched end, the taken one brighter",
    /border-left:\s*3px solid var\(--irop-warn\)/.test(rule(".irop .perk-banner")) && /clip-path:\s*polygon\(/.test(rule(".irop .perk-banner"))
      && /30%/.test(rule(".irop .perk-banner.taken")) && /min-height:\s*90px/.test(rule(".irop .tab.description.has-extras prose-mirror")));
  check("editor css: every text editor stays a column, never a plain block, so an opened one has room to type",
    /display:\s*flex/.test(editorRules) && /flex-direction:\s*column/.test(editorRules) && !/display:\s*block/.test(editorRules), editorRules);
  check("editor css: its pencil always shows, an empty one says to press it, and the small ones grow when opened",
    /display:\s*block/.test(rule(".irop :where(.window-content) prose-mirror.inactive button.toggle:enabled"))
      && /Press the pencil to write/.test(css) && /min-height:\s*180px/.test(rule(".irop prose-mirror.store-description.active"))
      && /min-height:\s*220px/.test(rule(".irop .irop-record prose-mirror.record-biography.active")));
  const portraitRule = rule(".irop .record-portrait");
  check("record css: the portrait is large, full width",
    /width:\s*100%/.test(portraitRule) && Number(portraitRule.match(/height:\s*(\d+)px/)?.[1]) >= 280, portraitRule);
  check("record css: no attached file styles left", !/record-attachment|record-file/.test(css));

  // Dice colours, RULED 2026-10-06: Eclipse on the player's dice, GENESIS on the opposition's.
  const cssVar = name => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
  const ruled = {
    "die-assistance": "var(--odr-silver)", "die-aptitude": "var(--odr-navy)", "die-skill": "var(--odr-sky)",
    "die-hindrance": "var(--genesis-black)", "die-difficulty": "var(--genesis-red)", "die-obstacle": "var(--genesis-gold)"
  };
  for ( const [name, value] of Object.entries(ruled) ) check(`dice css: ${name} is ${value}`, cssVar(name) === value, cssVar(name));
  check("dice css: the dark dice carry a visible edge",
    cssVar("die-aptitude-edge") === "var(--odr-sky)" && cssVar("die-hindrance-edge") === "var(--genesis-grey)");
  // The palette must match the liveries on file.
  const livery = "C:/Users/jscha/Documents/Claude/docs/species/genesis-theme.html";
  if ( fs.existsSync(livery) ) {
    const theme = fs.readFileSync(livery, "utf8");
    const token = name => theme.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1].toLowerCase();
    const pairs = [["odr-sky", "odr"], ["odr-navy", "odr-panel"], ["genesis-black", "void"], ["genesis-red", "red"],
      ["genesis-gold", "gold"], ["genesis-grey", "muted"]];
    for ( const [ours, theirs] of pairs ) {
      check(`dice css: --${ours} matches the livery's --${theirs}`, cssVar(ours)?.toLowerCase() === token(theirs), `${cssVar(ours)} vs ${token(theirs)}`);
    }
  }

  // NPCs have no record drawer.
  check("record: NPC sheet has no record part", !("record" in NpcSheet.PARTS));

  // The Dossier tab no longer carries the Biography, so no field is edited in two places.
  const bioHtml = tpl("templates/actor/bio.hbs")(await sheet._preparePartContext("bio", { ...context }, {}));
  check("record: Dossier tab has no Biography editor", !/name="system.details.biography"/.test(bioHtml) && !/<h3>Biography/.test(bioHtml));
  check("record: Notes are off the Training tab, and off the tab bar, in the drawer (2026-10-11)", !/name="system.details.notes"/.test(bioHtml)
    && !("notes" in OperativeSheet.PARTS) && !OperativeSheet.TABS.primary.tabs.some(t => t.id === "notes")
    && /name="system.details.notes"/.test(tpl("templates/actor/record.hbs")(await sheet._preparePartContext("record", { ...context }, {}))));
}

// Observers (and Limited users) see the Personnel Record alone, read only (RULED 2026-10-06).
{
  const watched = makeActor("operative", OperativeData, {
    details: { callsign: "Wraith", record: { age: "31", timeline: [{ date: "2038", entry: "Joined Eclipse." }] } }
  }, [{ type: "species", name: "Human", system: { boons: true } }]);
  watched.id = "watched000001";

  // The owner (or GM) first: the full sheet, record closed.
  const ownerSheet = new OperativeSheet(watched);
  // A player owner in Play mode gets every part but Effects (Johnald, 2026-10-10: Effects only in Edit mode for players).
  const noEffects = Object.keys(OperativeSheet.PARTS).filter(k => !["effects", "paraphysics"].includes(k)).join();
  check("owner: full sheet parts (but Effects, in Play mode)", Object.keys(ownerSheet._configureRenderParts({})).join() === noEffects);
  check("owner: record not forced open", (await ownerSheet._prepareContext({})).record.open === false);

  // An observer: the record alone.
  watched.isOwner = false;
  const sheet = new OperativeSheet(watched);
  Object.defineProperty(sheet, "isEditable", { value: false });
  const parts = sheet._configureRenderParts({});
  check("observer: only the record is rendered", Object.keys(parts).join() === "record", Object.keys(parts).join());
  const context = await sheet._prepareContext({});
  check("observer: record open and marked record only", context.record.open === true && context.record.only === true);
  const html = tpl("templates/actor/record.hbs")(await sheet._preparePartContext("record", { ...context }, {}));
  const doc = inspect("observer record", html, { actions: ACTIONS, source: watched.system._source });
  check("observer: no bar, no close button", !doc.querySelector(".record-gutter, .record-bar") && !/Close record/.test(html));
  check("observer: none of the owner's Notes", !doc.querySelector(".drawer-notes, .notes-tab") && !/system\.details\.notes/.test(html));
  check("observer: a Read only tag in its place", doc.querySelector(".record-tag")?.textContent.trim() === "Read only");
  check("observer: every field is disabled",
    [...doc.querySelectorAll("input, textarea")].length > 0 && [...doc.querySelectorAll("input, textarea")].every(el => el.disabled));
  check("observer: no add or delete controls", !doc.querySelector('[data-action="addRecordEntry"], [data-action="deleteRecordEntry"]'));
  check("observer: the record still shows its content", html.includes("Joined Eclipse.") && /value="31"/.test(html));
  const opts = OperativeSheet.prototype._initializeApplicationOptions.call(sheet, { document: watched, position: { width: 920 } });
  check("observer: the window opens sized to the record", opts.position.width === OperativeSheet.RECORD_WIDTH + 20);
  check("owner: the window keeps its full width",
    OperativeSheet.prototype._initializeApplicationOptions.call(ownerSheet, { document: { isOwner: true }, position: { width: 920 } }).position.width === 920);

  // Ownership granted later: the full sheet comes back on the next render.
  watched.isOwner = true;
  check("ownership granted: full sheet on next render", Object.keys(sheet._configureRenderParts({})).join() === noEffects);

  // The stylesheet lays the record out as the window body.
  const css = fs.readFileSync(path.join(ROOT, "styles/irop.css"), "utf8");
  check("observer css: record is static and visible in record-only windows",
    /\.application\.irop\.operative\.record-only \.irop-record \{[^}]*position:\s*static[^}]*visibility:\s*visible/.test(css));
  check("observer css: no gutter padding in record-only windows",
    /\.application\.irop\.operative\.record-only \.window-content \{\s*padding-left:\s*0;/.test(css));
}

// Boons: only Humans (RULED 2026-10-06).
{
  const boonsPanel = html => /<h3>Boons<\/h3>/.test(html);
  const before = html => html.split("<h3>Paraphysics")[0];

  const baron = makeActor("operative", OperativeData, {}, [
    { type: "species", name: "Mutant", system: { mutations: true } }
  ]);
  let { context, out } = await renderSheet(OperativeSheet, baron);
  check("mutant: no Boons panel", !boonsPanel(out.abilities) && context.showBoons === false);
  check("mutant: Mutations take the full width", !/class="two-col"/.test(before(out.abilities)));

  const telestoi = makeActor("operative", OperativeData, {}, [{ type: "species", name: "Telestoi", system: {} }]);
  ({ context, out } = await renderSheet(OperativeSheet, telestoi));
  check("other species: neither panel, no empty row", !boonsPanel(out.abilities) && !/<h3>Mutations/.test(out.abilities)
    && !/class="two-col"/.test(before(out.abilities)) && !/<div class="">/.test(before(out.abilities)));

  const strayBaron = makeActor("operative", OperativeData, {}, [
    { type: "species", name: "Mutant", system: { mutations: true } },
    { type: "boon", name: "Strength Boon", system: { attribute: "str" } }
  ]);
  ({ context, out } = await renderSheet(OperativeSheet, strayBaron));
  check("mutant holding a boon: shown with warning, beside Mutations",
    boonsPanel(out.abilities) && out.abilities.includes("Only Humans take boons") && /class="two-col"/.test(before(out.abilities)));
  inspect("stray boon bio", out.abilities, { actions: ACTIONS, source: strayBaron.system._source });

  const genesis = makeActor("npc", NpcData, {}, [{ type: "species", name: "GENESIS", system: {} }]);
  ({ out } = await renderSheet(NpcSheet, genesis));
  check("GENESIS npc: neither panel", !boonsPanel(out.bio) && !/<h3>Mutations/.test(out.bio));
}

// NPC sheet.
const npc = makeActor("npc", NpcData, { details: { threat: "elite", caste: "vassal" } }, [
  { type: "weapon", name: "Bone Club", system: { category: "melee", damage: { formula: "1d8", type: "physical" } } }
]);
{
  const { out } = await renderSheet(NpcSheet, npc);
  for ( const [id, html] of Object.entries(out) ) inspect(`npc ${id}`, html, { actions: ACTIONS, source: npc.system._source });
  // No Gear tab on an NPC, so its Carry box stays on the Stats tab.
  check("npc: keeps its Carry box (no Gear tab to show it)",
    !("gear" in out) && /<span class="mono-label">Carry<\/span><span class="stat-value">\d+ \/ \d+<\/span>/.test(out.main));
}

/* -------------------------------------------- */
/*  Item sheets, every type                     */
/* -------------------------------------------- */

// As the GM, who keeps the Effects tab on item sheets, so every page is inspected.
const itemUserBefore = game.user;
game.user = { id: "gm", isGM: true, name: "GM" };
for ( const item of operative.items ) {
  item.getRollData = () => ({});
  item.isOwner = true;
  item.effects = [];
  const { out } = await renderSheet(IropItemSheet, item);
  for ( const [id, html] of Object.entries(out) ) {
    inspect(`item ${item.type} ${id}`, html, { actions: ITEM_ACTIONS, source: item.system._source });
  }
}
// Johnald, 2026-10-10: players never get the Effects tab on an item sheet (no Edit mode there); the GM always does.
{
  const tabIds = async sheet => Object.keys((await sheet._prepareContext({})).tabs ?? {});
  const results = [];
  for ( const item of operative.items.filter(i => !["skillTree", "territory", "project"].includes(i.type)) ) {
    game.user = { id: "p1", isGM: false, name: "Player" };
    const ps = new IropItemSheet(item);
    const playerTabs = await tabIds(ps);
    // A background's, weapon's, armor's, gear's and mod's Details tab is the GM's too (Johnald, 2026-10-10).
    const player = !playerTabs.includes("effects") && !("effects" in ps._configureRenderParts({}))
      && (playerTabs.includes("details") === !["background", "weapon", "armor", "gear", "mod", "role", "species", "ability", "boon", "mutation"].includes(item.type));
    game.user = { id: "gm", isGM: true, name: "GM" };
    const gs = new IropItemSheet(item);
    results.push({ type: item.type, player, gm: (await tabIds(gs)).includes("effects") && ("effects" in gs._configureRenderParts({})) });
  }
  check("item effects: on every item sheet, no Effects tab or page for a player, both for the GM",
    results.length > 5 && results.every(r => r.player && r.gm), JSON.stringify(results.filter(r => !r.player || !r.gm)));
}
game.user = itemUserBefore;
{
  // The Details tab is the GM's (2026-10-10).
  game.user = { id: "gm", isGM: true, name: "GM" };
  const cryo = operative.items.get("cryo");
  const { out: cryoOut } = await renderSheet(IropItemSheet, cryo);
  const cryoDetails = new JSDOM(cryoOut.details).window.document;
  check("item sheet: ammunition gets the Special ammo section, other gear does not",
    !!cryoDetails.querySelector('select[name="system.ammo.damageType"] option[value="cold"][selected]')
      && !!cryoDetails.querySelector('select[name="system.ammo.status"]') && !!cryoDetails.querySelector('input[name="system.ammo.ignoreDefense"]')
      && !(await renderSheet(IropItemSheet, operative.items.find(i => i.name === "Medkit"))).out.details.includes("system.ammo.damageType"));
  game.user = itemUserBefore;
}

// Johnald, 2026-10-10, after backgrounds: "Lets do the same for items, gear, weapons, and armor".
// Players read them on the Description tab, with their stats; the Details tab and the editor are the GM's.
{
  const userBefore = game.user;
  const physical = (type, Model, system, name) => {
    const d = new FakeDoc({});
    Object.assign(d, { id: `${type}1`, name, type, img: `${type}.svg`, uuid: `Item.${type}1`, isOwner: true, effects: [], actor: null });
    d.getRollData = () => ({});
    d.system = new Model({ description: "<p>Standard issue.</p>", ...system }, { parent: d });
    return d;
  };
  const kit = [
    physical("weapon", itemModels.WeaponData, { weaponClass: "rifles", category: "ranged", accuracy: 10, damage: { formula: "2d6 + @per.mod", type: "ballistic" } }, "Rifle"),
    physical("armor", itemModels.ArmorData, { armorClass: "medium", defense: 6, points: 8 }, "Vest"),
    physical("gear", itemModels.GearData, { kind: "medical", formula: "1d6", consumable: true }, "Stim"),
    physical("mod", itemModels.ModData, { target: "ranged" }, "Scope")
  ];
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  const seen = [];
  for ( const item of kit ) {
    const { context, out } = await renderSheet(IropItemSheet, item);
    const doc = new JSDOM(out.description).window.document;
    const sheet = new IropItemSheet(item);
    sheet.tabGroups = { primary: "details" };
    sheet._prepareTabs("primary");
    seen.push({
      type: item.type,
      noDetails: !("details" in out) && !context.tabs.details && (sheet.tabGroups.primary === "description"),
      readOnly: !doc.querySelector("prose-mirror") && (doc.querySelector(".item-description-read")?.innerHTML === "<p>Standard issue.</p>"),
      stats: [...doc.querySelectorAll(".item-facts .item-stats dt")].map(dt => dt.textContent),
      values: [...doc.querySelectorAll(".item-facts .item-stats dd")].map(dd => dd.textContent),
      heading: doc.querySelector(".item-facts .description-section-title")?.textContent
    });
  }
  check("weapons, armor, gear and mods: players get no Details tab and open on Description",
    seen.every(r => r.noDetails), JSON.stringify(seen.filter(r => !r.noDetails)));
  check("weapons, armor, gear and mods: players read the description, with no editor",
    seen.every(r => r.readOnly), JSON.stringify(seen.filter(r => !r.readOnly)));
  const weaponRow = seen.find(r => r.type === "weapon");
  check("weapons, armor, gear and mods: a Stats section under the description, its type first, as the shop lists them",
    seen.every(r => (r.heading === "Stats") && (r.stats[0] === "Type"))
      && (weaponRow.values[0] === "Rifles, Ranged") && weaponRow.stats.includes("Damage") && weaponRow.values.includes("2d6 + PER mod Ballistic")
      && seen.find(r => r.type === "armor").stats.includes("Defense") && seen.find(r => r.type === "mod").stats.includes("Fits"),
    JSON.stringify(seen.map(r => ({ type: r.type, stats: r.stats, values: r.values }))));
  game.user = { id: "gm", isGM: true, name: "GM" };
  const gmRows = [];
  for ( const item of kit ) {
    const { out } = await renderSheet(IropItemSheet, item);
    const doc = new JSDOM(out.description).window.document;
    gmRows.push(("details" in out) && !!doc.querySelector('prose-mirror[name="system.description"].content-sized') && !!doc.querySelector(".item-facts"));
  }
  check("weapons, armor, gear and mods: the GM keeps the Details tab and writes the description, the stats beneath it", gmRows.every(Boolean));

  // Johnald, 2026-10-10: "We need to run this change for the Roles and Species too".
  const role = (() => {
    const d = new FakeDoc({});
    Object.assign(d, { id: "role1", name: "Legionary", type: "role", img: "role.svg", uuid: "Item.role1", isOwner: true, effects: [], actor: null });
    d.getRollData = () => ({});
    d.system = new itemModels.RoleData({ description: "<p>The backbone of the ODR.</p>", role: "legionary",
      startingSkills: "Awareness, Investigate or Athletics", preferredAttributes: "Agility and Perception",
      weaponSpecialties: "Assault Rifles, SAWs, SMGs and Shotguns", roleAbilities: "Rally, Pour it On!, Chained Shot",
      specializations: "" }, { parent: d });
    return d;
  })();
  const species = (() => {
    const d = new FakeDoc({});
    Object.assign(d, { id: "sp1", name: "Human", type: "species", img: "human.svg", uuid: "Item.sp1", isOwner: true, effects: [], actor: null });
    d.getRollData = () => ({});
    d.system = new itemModels.SpeciesData({ description: "<p>The default playable species.</p>", health: 8, energy: 10,
      attributes: { str: 40, agi: 40, tgh: 40, cha: 40, lck: 30, int: 40, per: 40 }, boons: true, paraphysical: true }, { parent: d });
    return d;
  })();
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  const readFacts = async item => {
    const { context, out } = await renderSheet(IropItemSheet, item);
    const doc = new JSDOM(out.description).window.document;
    const sheet = new IropItemSheet(item);
    sheet.tabGroups = { primary: "details" };
    sheet._prepareTabs("primary");
    return {
      noDetails: !("details" in out) && !context.tabs.details && (sheet.tabGroups.primary === "description"),
      readOnly: !doc.querySelector("prose-mirror") && !!doc.querySelector(".item-description-read"),
      title: doc.querySelector(".item-facts .description-section-title")?.textContent,
      rows: Object.fromEntries([...doc.querySelectorAll(".item-facts dt")].map(dt => [dt.textContent, dt.nextElementSibling.textContent]))
    };
  };
  const roleRead = await readFacts(role);
  const speciesRead = await readFacts(species);
  check("roles and species: players get no Details tab, open on Description, and read the description with no editor",
    roleRead.noDetails && speciesRead.noDetails && roleRead.readOnly && speciesRead.readOnly);
  check("roles: a Dossier as the field guide sets one out, the starting skills as the sheet offers them, empty lines left out",
    (roleRead.title === "Dossier") && (roleRead.rows.Doctrine === "Legionary")
      && (roleRead.rows["Starting skills"] === "Awareness free, then one of Investigation or Athletics")
      && (roleRead.rows["Preferred attributes"] === "Agility and Perception") && (roleRead.rows["Weapon specialties"] === "Assault Rifles, SAWs, SMGs and Shotguns")
      && (roleRead.rows["Role abilities"] === "Rally, Pour it On!, Chained Shot") && !("Specializations" in roleRead.rows), JSON.stringify(roleRead.rows));
  check("species: its Stats, health and energy with what they add, the attributes, its traits; Paraphysical left to the GM",
    (speciesRead.title === "Stats") && (speciesRead.rows.Health === "8 + TGH mod") && (speciesRead.rows.Energy === "10 + CHA mod + INT mod")
      && (speciesRead.rows.Attributes === "STR 40, AGI 40, TGH 40, CHA 40, LCK 30, INT 40, PER 40")
      && (speciesRead.rows.Traits === "Takes attribute boons, +10% concealment in the slums and megacities")
      && !JSON.stringify(speciesRead.rows).includes("Paraphysical"), JSON.stringify(speciesRead.rows));
  game.user = { id: "gm", isGM: true, name: "GM" };
  const gmRole = await renderSheet(IropItemSheet, role);
  const gmSpecies = await renderSheet(IropItemSheet, species);
  check("roles and species: the GM keeps the Details tab and the editor",
    ("details" in gmRole.out) && ("details" in gmSpecies.out) && /<prose-mirror/.test(gmRole.out.description) && /<prose-mirror/.test(gmSpecies.out.description));

  // Johnald, 2026-10-10: "Do the same for boons and mutations as well as the perks themselves".
  const make = (type, Model, system, name) => {
    const d = new FakeDoc({});
    Object.assign(d, { id: `${type}9`, name, type, img: `${type}.svg`, uuid: `Item.${type}9`, isOwner: true, effects: [], actor: null });
    d.getRollData = () => ({});
    d.system = new Model({ description: `<p>${name}.</p>`, ...system }, { parent: d });
    return d;
  };
  const perk = make("ability", itemModels.AbilityData, { kind: "active", source: "legionary", tree: "Pointman", tier: 2, actionType: "single",
    energyCost: 6, range: 4, area: 1, uses: { value: 1, max: 3 }, prerequisites: "Rally" }, "Rally");
  const psionic = make("ability", itemModels.AbilityData, { kind: "active", source: "other", actionType: "single", energyCost: 3,
    paraphysics: { discipline: Object.keys(IROP.disciplines)[0], attack: true, accuracy: 40, damage: { formula: "2d4 + @cha.mod", type: "psychic" } } }, "Mind Spike");
  const boon = make("boon", itemModels.BoonData, { attribute: "agi", amount: 10 }, "Agility Boon");
  const mutation = make("mutation", itemModels.MutationData, { polarity: "negative" }, "Brittle Bones");
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  const perkRead = await readFacts(perk);
  const psiRead = await readFacts(psionic);
  const boonRead = await readFacts(boon);
  const mutationRead = await readFacts(mutation);
  check("perks, boons and mutations: players get no Details tab, open on Description, and read the description with no editor",
    [perkRead, psiRead, boonRead, mutationRead].every(r => r.noDetails && r.readOnly));
  check("perks: their Stats as the Details tab sets them, empty lines left out, uses left to the character sheet",
    (perkRead.rows.Kind === "Active") && (perkRead.rows.Source === "Legionary, Pointman") && (perkRead.rows.Tier === "2")
      && (perkRead.rows.Action === "Single Action") && (perkRead.rows.Energy === "6 EN") && (perkRead.rows.Range === "4 tiles")
      && (perkRead.rows.Area === "1 tile") && (perkRead.rows.Uses === "3") && (perkRead.rows.Prerequisites === "Rally")
      && !("Paraphysics" in perkRead.rows) && !("Damage" in perkRead.rows), JSON.stringify(perkRead.rows));
  check("perks: a paraphysical attack shows its discipline, accuracy as its D.M. and damage in words",
    (psiRead.rows.Paraphysics === `${Object.values(IROP.disciplines)[0]}, rank 1`) && (psiRead.rows.Accuracy === "-40")
      && (psiRead.rows.Damage === `2d4 + CHA mod ${IROP.damageTypes.psychic.label}`) && !("Tier" in psiRead.rows), JSON.stringify(psiRead.rows));
  check("boons and mutations: what they raise, and which way a mutation goes",
    (boonRead.rows.Raises === "Agility +10") && (mutationRead.rows.Polarity === "Negative"), JSON.stringify([boonRead.rows, mutationRead.rows]));

  // What players still change themselves: an ability's uses left, on the character sheet; and no Add buttons for blanks.
  const user = makeActor("operative", OperativeData, {}, [
    { type: "role", name: "Legionary", system: { role: "legionary" } },
    { type: "ability", name: "Rally", id: "rally", system: { kind: "active", uses: { value: 1, max: 3 } } }
  ]);
  const asPlayer = await renderSheet(OperativeSheet, user);
  const usesIn = new JSDOM(asPlayer.out.abilities).window.document.querySelector('[data-item-id="rally"] .stat-chip.uses input[data-item-field="system.uses.value"]');
  check("perks: uses left are typed in on the character sheet, from none up to the most it holds",
    (usesIn?.value === "1") && (usesIn.getAttribute("max") === "3") && (usesIn.getAttribute("min") === "0")
      && /if \( input\.dataset\.itemField === "system\.uses\.value" \) value = Math\.min\(item\.system\.uses\?\.max \|\| Infinity, Math\.max\(0, Math\.round\(value\) \|\| 0\)\);/
        .test(fs.readFileSync(path.join(ROOT, "module/sheets/actor-sheet.mjs"), "utf8")));
  const addsIn = out => ["abilities", "combat", "gear"].reduce((n, part) => n + (out[part]?.match(/data-action="createItem"/g)?.length ?? 0), 0);
  game.user = { id: "gm", isGM: true, name: "GM" };
  const asGm = await renderSheet(OperativeSheet, user);
  const playerGearAdd = new JSDOM(asPlayer.out.gear).window.document.querySelectorAll('[data-action="createItem"]');
  check("character sheet: the Add buttons are the GM's, but the Gear tab's, where players make a trinket of their own (2026-10-10)",
    (addsIn(asPlayer.out) === 1) && (playerGearAdd.length === 1) && (playerGearAdd[0].dataset.type === "gear") && !playerGearAdd[0].dataset.kind
      && /trinket of your own/.test(playerGearAdd[0].dataset.tooltip) && (addsIn(asGm.out) === 7), `${addsIn(asPlayer.out)} / ${addsIn(asGm.out)}`);

  // Johnald, 2026-10-10: "I will allow players to rename weapons and armor on their sheet. They are also
  // allowed to create simple items in gear if they want to homebrew up some kind of personal trinket".
  const created = [];
  const maker = { ...user, name: "Kael", createEmbeddedDocuments: async (type, list) => { created.push(...list); return list.map(d => ({ ...d, sheet: { render: () => null } })); } };
  const makerSheet = new OperativeSheet(maker);
  const press = dataset => IropActorSheet.DEFAULT_OPTIONS.actions.createItem.call(makerSheet, {}, { dataset });
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  await press({ type: "gear" });
  await press({ type: "weapon" });
  await press({ type: "gear", kind: "deployable" });
  await press({ type: "ability", kind: "active" });
  check("homebrew: a player's Add makes plain gear marked as theirs, named a trinket, and nothing else",
    (created.length === 1) && (created[0].type === "gear") && (created[0].name === "New Trinket") && (created[0].flags?.irop?.homebrew === true), JSON.stringify(created));
  game.user = { id: "gm", isGM: true, name: "GM" };
  await press({ type: "weapon" });
  check("homebrew: the GM's Add makes any item, unmarked", (created.length === 2) && (created[1].type === "weapon") && !created[1].flags);
  game.user = { id: "p1", isGM: false, name: "Johnald" };

  const owned = (type, Model, extra = {}) => {
    const d = new FakeDoc({});
    Object.assign(d, { id: `${type}h`, name: `My ${type}`, type, img: `${type}.svg`, uuid: `Item.${type}h`, isOwner: true, effects: [], actor: null, ...extra });
    d.getRollData = () => ({});
    d.system = new Model({ description: "<p>Mine.</p>" }, { parent: d });
    return d;
  };
  const trinket = owned("gear", itemModels.GearData, { flags: { irop: { homebrew: true } } });
  const issued = owned("gear", itemModels.GearData);
  const rifle = owned("weapon", itemModels.WeaponData);
  const vest = owned("armor", itemModels.ArmorData);
  const sheetOf = d => new IropItemSheet(d);
  check("homebrew: a player's own trinket is theirs to edit; gear the GM gave them is not",
    sheetOf(trinket).isEditable && sheetOf(trinket).isHomebrew && !sheetOf(issued).isEditable && !sheetOf(issued).canRename);
  const trinketView = await renderSheet(IropItemSheet, trinket);
  const trinketHead = new JSDOM(trinketView.out.header).window.document;
  check("homebrew: they name, picture and describe it; its stats and Details stay the GM's",
    !trinketHead.querySelector('input[name="name"]').disabled && !!trinketHead.querySelector('[data-action="editImage"]')
      && /<prose-mirror[^>]*name="system.description"/.test(trinketView.out.description) && !("details" in trinketView.out) && !("effects" in trinketView.out)
      && /item-facts/.test(trinketView.out.description));
  check("rename: a player may rename their own weapon and armor, and change nothing else on them",
    sheetOf(rifle).canRename && sheetOf(vest).canRename && !sheetOf(rifle).isEditable && !sheetOf(vest).isEditable);
  const rifleView = await renderSheet(IropItemSheet, rifle);
  const rifleHead = new JSDOM(`<section class="application irop item-sheet">${rifleView.out.header}</section>`).window.document;
  check("rename: the name field is open, with a word on what it is; the picture and description stay locked",
    !rifleHead.querySelector('input[name="name"]').disabled && /Rename it/.test(rifleHead.querySelector('input[name="name"]').dataset.tooltip ?? "")
      && !rifleHead.querySelector('[data-action="editImage"]') && !/<prose-mirror/.test(rifleView.out.description) && !("details" in rifleView.out));
  // Foundry disables every field of a read only sheet; the name is opened again and saves itself.
  const renamed = [];
  rifle.update = data => { renamed.push(data); return data; };
  const rifleSheet = sheetOf(rifle);
  rifleSheet.element = rifleHead.querySelector("section");
  const nameInput = rifleHead.querySelector('input[name="name"]');
  nameInput.disabled = true;
  await IropItemSheet.prototype._onRender.call(rifleSheet, { accent: null }, {});
  nameInput.value = "  Old Faithful  ";
  nameInput.dispatchEvent(new rifleHead.defaultView.Event("change", { bubbles: true }));
  nameInput.value = "   ";
  nameInput.dispatchEvent(new rifleHead.defaultView.Event("change", { bubbles: true }));
  check("rename: the name field opens again on the locked sheet and saves the new name, a blank one put back",
    !nameInput.disabled && (JSON.stringify(renamed) === JSON.stringify([{ name: "Old Faithful" }])) && (nameInput.value === "My weapon"), JSON.stringify(renamed));
  const ringSheet = sheetOf(owned("gear", itemModels.GearData));
  check("rename: not for other items, and not for the GM (who edits everything)",
    !ringSheet.canRename && !sheetOf(owned("ability", itemModels.AbilityData)).canRename
      && (() => { game.user = { id: "gm", isGM: true, name: "GM" }; const r = !sheetOf(rifle).canRename && sheetOf(rifle).isEditable; game.user = { id: "p1", isGM: false, name: "Johnald" }; return r; })());
  game.user = { id: "gm", isGM: true, name: "GM" };
  const gmPerk = await renderSheet(IropItemSheet, perk);
  check("perks, boons and mutations: the GM keeps the Details tab and the editor",
    ("details" in gmPerk.out) && /<prose-mirror/.test(gmPerk.out.description) && ("details" in (await renderSheet(IropItemSheet, boon)).out));
  game.user = userBefore;
}
const covered = new Set(operative.items.map(i => i.type));
check("every item type rendered", Object.keys(MODELS).every(t => covered.has(t)), [...covered].join(","));

/* -------------------------------------------- */
/*  Chat cards                                  */
/* -------------------------------------------- */

const cardTpl = {
  dynosrs: tpl("templates/chat/dynosrs-roll.hbs"),
  d100: tpl("templates/chat/d100-roll.hbs"),
  damage: tpl("templates/chat/damage-roll.hbs")
};

// DYNOSRS: Skill 12 (V), Aptitude 9 (S E E), Difficulty 3 (F F), Difficulty 4 (D).
const dyn = DynosrsRoll.fromPool({ skill: 1, aptitude: 1, difficulty: 2 }, { label: "Stealth check", actorUuid: "Actor.test" });
check("pool formula: Skill is the d12, Aptitude the d10", dyn._formula === "1d12[Skill] + 1d10[Aptitude] + 2d10[Difficulty]", dyn._formula);
dyn._dice = [
  { flavor: "Skill", faces: 12, results: [{ result: 12, active: true }] },
  { flavor: "Aptitude", faces: 10, results: [{ result: 9, active: true }] },
  { flavor: "Difficulty", faces: 10, results: [{ result: 3, active: true }, { result: 4, active: true }] }
];
const expected = resolve([["skill", 12], ["aptitude", 9], ["difficulty", 3], ["difficulty", 4]].map(([k, f]) => ({ symbols: symbolsFor(k, f) })));
check("roll resolution equals the rules core", JSON.stringify(dyn.resolution.net) === JSON.stringify(expected.net));

// A card rolled before the swap says "1d12[Aptitude] + 1d10[Skill]": it must still read as the dice it was.
{
  const { dieKeyForTerm } = await import("../module/dice/dynosrs-roll.mjs");
  check("old card: a d12 named Aptitude reads as Skill", dieKeyForTerm("Aptitude", 12) === "skill");
  check("old card: a d10 named Skill reads as Aptitude", dieKeyForTerm("Skill", 10) === "aptitude");
  check("new card: names and sizes agree", dieKeyForTerm("Skill", 12) === "skill" && dieKeyForTerm("Aptitude", 10) === "aptitude");
  check("negative dice unaffected", dieKeyForTerm("Obstacle", 12) === "obstacle" && dieKeyForTerm("Difficulty", 10) === "difficulty");
  const old = DynosrsRoll.fromPool({ skill: 1 }, { label: "Old card" });
  old._dice = [
    { flavor: "Aptitude", faces: 12, results: [{ result: 12, active: true }] },
    { flavor: "Skill", faces: 10, results: [{ result: 4, active: true }] }
  ];
  const oldCtx = await old._prepareChatRenderContext({ message: { id: "m0", flags: {} } });
  check("old card renders with Victory from its d12 and the right names",
    oldCtx.dice.map(d => d.key).join() === "skill,aptitude" && oldCtx.net.some(n => n.key === "VICTORY") && oldCtx.poolText === "1 Skill, 1 Aptitude",
    `${oldCtx.dice.map(d => d.key).join()} | ${oldCtx.poolText}`);
}
let ctx = await dyn._prepareChatRenderContext({ message: { id: "m1", flags: {} } });
let doc = inspect("dynosrs card", cardTpl.dynosrs(ctx), { actions: new Set(), source: {} });
check("dynosrs outcome rendered", doc.querySelector(".result-word")?.textContent === ctx.outcomeLabel, ctx.outcomeLabel);
check("dynosrs shows 4 dice", doc.querySelectorAll(".irop-die-face").length === 4);
for ( const b of doc.querySelectorAll("[data-irop-action]") ) {
  check(`dynosrs button ${b.dataset.iropAction} known`, ["bank", "applyDefeat"].includes(b.dataset.iropAction));
}
// Banked flag hides the button.
ctx = await dyn._prepareChatRenderContext({ message: { id: "m1", flags: { irop: { banked: { EDGE: true } } } } });
doc = new JSDOM(cardTpl.dynosrs(ctx)).window.document;
check("banked edge shows as banked", !ctx.banking.some(b => b.symbol === "EDGE") || doc.querySelector(".banked"));

// d100: Alan's worked example, then a hit with buttons.
const alanMods = collectModifiers({ cover: "half", accuracy: -15 });
const alan = D100Roll.create({ kind: "attack", label: "Assault Rifle", target: 45, targetLabel: "PER 45", modifiers: alanMods,
  attack: { damage: { formula: "2d4", type: "ballistic" }, critChance: 0, cover: "half" } });
alan._dice = [{ total: 45 }];
alan.total = 60;
ctx = await alan._prepareChatRenderContext({});
doc = inspect("d100 miss card", cardTpl.d100(ctx), { actions: new Set(), source: {} });
check("Alan misses", doc.querySelector(".result-word")?.textContent === "Miss");
check("Alan formula", alan._formula === "1d100 + 30 - 15", alan._formula);
check("miss has no damage button", !doc.querySelector('[data-irop-action="damage"]'));
alan.total = 20;
ctx = await alan._prepareChatRenderContext({});
doc = inspect("d100 hit card", cardTpl.d100(ctx), { actions: new Set(), source: {} });
check("hit offers damage and critical", !!doc.querySelector('[data-irop-action="damage"]') && !!doc.querySelector('[data-irop-action="critical"]'));
// A missed explosive (a launched grenade, a LAW) still goes off where it scatters to (2026-10-08).
{
  const launched = D100Roll.create({ kind: "attack", label: "Grenade Launcher: Frag Grenade", target: 40, targetLabel: "PER 40",
    modifiers: [], actorUuid: "Actor.test", attack: { scatter: "launched", damage: { formula: "2d4 + 1", type: "explosive" } } });
  launched.total = 80;
  const missDoc = inspect("missed explosive card", cardTpl.d100(await launched._prepareChatRenderContext({})), { actions: new Set(), source: {} });
  check("a missed explosive offers Scatter and its damage where it lands",
    !!missDoc.querySelector('[data-irop-action="scatter"]') && /Damage where it lands/.test(missDoc.querySelector('[data-irop-action="damage"]')?.textContent ?? ""));
}

const dmg = new DamageRoll("2d4", {}, { label: "Assault Rifle", damageTypeLabel: "Ballistic", shred: 1, penetration: 0, critical: true });
dmg.total = 6;
ctx = await dmg._prepareChatRenderContext({});
inspect("damage card", cardTpl.damage(ctx), { actions: new Set(), source: {} });
// A chemthrower burn card (2026-10-08): no attack roll, the target's save for half, a button to roll it.
{
  const burnRoll = new DamageRoll("4d4 + 2", {}, { label: "Flame Chemthrower", damageTypeLabel: "Fire",
    burn: { burns: 3, spent: 30, save: "agi", saveLabel: "Agility", saveAbbr: "AGI", dm: 5, bandLabel: "Short",
      status: { id: "ignited", value: 3 } }, targetUuid: "Actor.trooper", targetName: "GENESIS Trooper" });
  burnRoll.total = 11;
  const burnDoc = inspect("burn card", cardTpl.damage(await burnRoll._prepareChatRenderContext({})), { actions: new Set(), source: {} });
  const burnText = burnDoc.querySelector(".burn-save")?.textContent.replace(/\s+/g, " ") ?? "";
  check("burn card: names the save and its range D.M., full and half, and offers the save roll",
    /3 burns, 30 fuel\. GENESIS Trooper makes Agility save \(Short range, D\.M\. 5\)/.test(burnText)
      && /Fails: 11 and Ignited \(3\)\. Saves: 5, no status/.test(burnText)
      && !!burnDoc.querySelector('.burn-save [data-irop-action="burnSave"]'), burnText);
  // Burned with no target (2026-10-08): the save button rolls for whoever the presser targets.
  const loose = new DamageRoll("2d4 + 2", {}, { label: "Flame Chemthrower", damageTypeLabel: "Fire",
    burn: { burns: 1, spent: 10, save: "agi", saveLabel: "Agility", saveAbbr: "AGI", dm: 0, bandLabel: "Short", status: null } });
  loose.total = 6;
  const looseDoc = inspect("untargeted burn card", cardTpl.damage(await loose._prepareChatRenderContext({})), { actions: new Set(), source: {} });
  check("burn card: with no target it reads 'The target' and the save button asks the presser to target",
    /The target makes Agility save/.test(looseDoc.querySelector(".burn-save")?.textContent.replace(/\s+/g, " ") ?? "")
      && /Target the token that must save/.test(looseDoc.querySelector('[data-irop-action="burnSave"]')?.dataset.tooltip ?? ""));
}
// Special ammo on the damage card (2026-10-08): DR bypass, and the status on hit with an Apply button.
{
  const cryoHit = new DamageRoll("1d4 + 2", {}, { label: "T1 Pistol", damageTypeLabel: "Cold", drBypass: 3,
    status: { id: "frostbite", value: 2, ammo: "Cryo Rounds" }, targetUuid: "Actor.trooper", targetName: "GENESIS Trooper" });
  cryoHit.total = 5;
  const cryoDoc = inspect("cryo damage card", cardTpl.damage(await cryoHit._prepareChatRenderContext({})), { actions: new Set(), source: {} });
  check("damage card: special ammo shows its DR bypass and status, with an Apply button",
    /Bypasses 3 DR/.test(cryoDoc.body.textContent)
      && /Cryo Rounds: GENESIS Trooper gains Frostbite \(2\)/.test(cryoDoc.querySelector(".damage-status")?.textContent.replace(/\s+/g, " ") ?? "")
      && !!cryoDoc.querySelector('.damage-status [data-irop-action="applyStatus"]'), cryoDoc.querySelector(".damage-status")?.outerHTML);
}

/* -------------------------------------------- */
/*  Banks window                                */
/* -------------------------------------------- */

foundry.applications.api.ApplicationV2 = StubApp;
const { BanksApp, operativesFromDrop } = await import("../module/apps/banks.mjs");
const { setSquad } = await import("../module/settings.mjs");
const { startSession, endSession, attackTarget } = await import("../module/rolls.mjs");
// RULED 2026-10-07: the squad is only the operatives the GM deploys, not every player owned operative.
operative.id = "deployed0001";
operative.hasPlayerOwner = true;
operative.system.banks.edge = 2;
operative.system.banks.victory = 1;
const benched = makeActor("operative", OperativeData, {}, []);
Object.assign(benched, { id: "benched00001", name: "Benched Operative", hasPlayerOwner: true });
benched.system.banks.victory = 1;
const roster = [operative, npc, benched];
roster.get = id => roster.find(a => a.id === id);
game.actors = roster;
game.user = { isGM: true };
let squad = [operative.id];
const writes = [];
game.settings.get = (ns, key) => {
  if ( key === "gmBanks" ) return { danger: 4, defeat: 1 };
  if ( key === "squad" ) return squad;
  throw new Error("no settings in tests");
};
game.settings.set = async (ns, key, value) => {
  writes.push([key, value]);
  if ( key === "squad" ) squad = value;
  return value;
};
const notes = [];
globalThis.ui = { notifications: { warn: m => notes.push(m), info: m => notes.push(m) } };
const ACTIONS_BANKS = new Set(Object.keys(BanksApp.DEFAULT_OPTIONS.actions));
{
  const app = new BanksApp();
  let context = await app._prepareContext({});
  check("banks: only the deployed operative is listed, not every player operative",
    context.operatives.map(o => o.id).join() === operative.id);
  check("banks: the squad's Victory opens Nigh Impossible", context.squadVictory === true);
  const html = tpl("templates/apps/banks.hbs")(context);
  const doc = inspect("banks window", html, { actions: ACTIONS_BANKS, source: {} });
  check("banks: 4 Danger pips lit", doc.querySelectorAll(".bank-pip.danger.filled").length === 4);
  check("banks: 2 Edge pips lit", doc.querySelectorAll(".bank-pip.edge.filled").length === 2);
  check("banks: GM sees session controls", !!doc.querySelector('[data-action="start"]'));
  check("banks: GM gets a stand down button per row and the drop zone",
    doc.querySelectorAll('.bank-line.operative [data-action="standDown"]').length === 1 && !!doc.querySelector(".squad-drop"));

  // A benched operative's Victory does not count.
  operative.system.banks.victory = 0;
  context = await app._prepareContext({});
  check("banks: a Victory held off the squad does not open Nigh Impossible", context.squadVictory === false);
  operative.system.banks.victory = 1;

  // Players see the squad, but cannot deploy or stand anyone down.
  game.user = { isGM: false };
  const playerDoc = new JSDOM(tpl("templates/apps/banks.hbs")(await app._prepareContext({}))).window.document;
  check("banks: players see no drop zone, stand down or session controls",
    !playerDoc.querySelector('.squad-drop, [data-action="standDown"], [data-action="start"]'));
  game.user = { isGM: true };

  // Standing down takes one operative off; deploying never doubles anyone up.
  await BanksApp.DEFAULT_OPTIONS.actions.standDown.call(app, {}, { closest: () => ({ dataset: { actorId: operative.id } }) });
  check("banks: stand down empties that row", squad.length === 0);
  const emptyDoc = new JSDOM(tpl("templates/apps/banks.hbs")(await app._prepareContext({}))).window.document;
  check("banks: an empty squad says so", /No operatives deployed\./.test(emptyDoc.querySelector(".squad .hint:not(.panel-head .hint)")?.textContent ?? emptyDoc.body.textContent));
  await setSquad([operative.id, operative.id, benched.id]);
  check("banks: deploying twice does not double up", squad.join() === `${operative.id},${benched.id}`);

  // Drops: one operative, or every operative in a folder; nothing else.
  const realUtils = foundry.utils;
  const docs = {
    "Actor.op": operative, "Actor.npc": npc, "Compendium.x.Actor.op": { ...operative, pack: "x", type: "operative" },
    "Folder.team": { type: "Actor", name: "Team", contents: [operative, npc, benched] },
    "Folder.empty": { type: "Actor", name: "Empty", contents: [npc] }
  };
  foundry.utils = { ...realUtils, fromUuid: async uuid => docs[uuid] ?? null };
  const drop = async data => operativesFromDrop(data);
  check("drop: an operative deploys", (await drop({ type: "Actor", uuid: "Actor.op" })).actors[0] === operative);
  check("drop: an NPC is refused with a reason", (await drop({ type: "Actor", uuid: "Actor.npc" })).warning === "Only operatives deploy on a mission.");
  check("drop: a compendium operative is refused with a reason", /Import the operative/.test((await drop({ type: "Actor", uuid: "Compendium.x.Actor.op" })).warning));
  check("drop: a folder deploys its operatives only",
    (await drop({ type: "Folder", uuid: "Folder.team" })).actors.map(a => a.id).join() === `${operative.id},${benched.id}`);
  check("drop: a folder without operatives says so", /holds no operatives/.test((await drop({ type: "Folder", uuid: "Folder.empty" })).warning));
  check("drop: an item is ignored quietly", (await drop({ type: "Item", uuid: "Item.x" })).actors.length === 0);
  foundry.utils = realUtils;

  // Attacks need one target, whose Defense goes on the roll unasked (RULED 2026-10-07).
  const trooperToken = { name: "GENESIS Trooper", actor: { uuid: "Actor.trooper", system: { defense: 6 } } };
  check("attack target: none targeted is refused with how to target", /Target an enemy first/.test(attackTarget(new Set()).warning));
  check("attack target: two targeted is refused", /one enemy at a time/.test(attackTarget(new Set([trooperToken, { name: "B" }])).warning));
  const picked = attackTarget(new Set([trooperToken]));
  check("attack target: one target gives its name, uuid and Defense",
    (picked.name === "GENESIS Trooper") && (picked.uuid === "Actor.trooper") && (picked.defense === 6) && !picked.warning);
  check("attack target: a token with no actor has no Defense", attackTarget(new Set([{ name: "Crate" }])).defense === 0);
  const dialogHtml = tpl("templates/dialog/attack.hbs")({
    itemName: "T1 Pistol", img: "x.svg", targetLabel: "AGI 40", accuracyText: "+0", covers: [], ranges: null, toggles: [],
    target: { name: "GENESIS Trooper", defense: 6, defenseText: "+6", single: true }, modes: [], mode: "public"
  });
  const dialogDoc = new JSDOM(dialogHtml).window.document;
  const defenseBox = dialogDoc.querySelector('.target-defense input[name="defense"]');
  check("attack dialog: names the target and its Defense, ticked on by default",
    !!defenseBox?.checked && /GENESIS Trooper's Defense/.test(dialogDoc.querySelector(".target-defense").textContent)
      && dialogDoc.querySelector(".target-defense em").textContent === "+6");
  // Johnald, 2026-10-10: the Defense box sits under cover and range, above Battlefield.
  const legendsOf = doc => [...doc.querySelectorAll(".attack-dialog > fieldset > legend")].map(l => l.textContent.trim()).join("|");
  const rangedDoc = new JSDOM(tpl("templates/dialog/attack.hbs")({
    itemName: "T1 Rifle", img: "x.svg", targetLabel: "AGI 40", accuracyText: "+0", covers: [], toggles: [],
    ranges: [{ key: "short", label: "Short", checked: true }],
    target: { name: "GENESIS Trooper", defense: 6, defenseText: "+6", single: true }, modes: [], mode: "public"
  })).window.document;
  check("attack dialog: cover, then range, then the target's Defense, then Battlefield",
    (legendsOf(rangedDoc) === "Target's cover|Range band|Target|Battlefield") && (legendsOf(dialogDoc) === "Target's cover|Target|Battlefield"),
    `${legendsOf(rangedDoc)} / ${legendsOf(dialogDoc)}`);

  // RULED 2026-10-08: area weapons (grenades, launchers, chemthrowers) need no target.
  check("area weapons: no target is fine, aimed at an area with no Defense",
    attackTarget(new Set(), { optional: true }).area === true && attackTarget(new Set(), { optional: true }).defense === 0
      && !attackTarget(new Set(), { optional: true }).warning);
  const blast = attackTarget(new Set([trooperToken, { name: "Vassal" }]), { optional: true });
  check("area weapons: several targets are all in the blast, no single Defense", blast.name === "GENESIS Trooper, Vassal" && !blast.uuid && blast.defense === 0);
  check("area weapons: one target still brings its Defense", attackTarget(new Set([trooperToken]), { optional: true }).defense === 6);
  const { isAreaWeapon } = await import("../module/rolls.mjs");
  const w = (system, type = "weapon") => ({ type, system });
  check("area weapons: grenades, rockets, explosives, launchers and chemthrowers; not guns or blades",
    isAreaWeapon(w({ weaponClass: "grenade", category: "thrown" })) && isAreaWeapon(w({ weaponClass: "launcher", category: "ranged" }))
      && isAreaWeapon(w({ weaponClass: "chemthrower", category: "ranged" })) && isAreaWeapon(w({ weaponClass: "rocket", category: "explosive" }))
      && !isAreaWeapon(w({ weaponClass: "smallArms", category: "ranged" })) && !isAreaWeapon(w({ weaponClass: "oneHanded", category: "melee" })));
  const areaDialog = new JSDOM(tpl("templates/dialog/attack.hbs")({
    itemName: "Frag Grenade", img: "x.svg", targetLabel: "STR 40", accuracyText: "+0", covers: [], ranges: null, toggles: [],
    target: { name: null, defense: 0, defenseText: "0", single: false }, modes: [], mode: "public"
  })).window.document;
  check("area weapons: the dialog says it is aimed at an area, with no Defense box",
    !areaDialog.querySelector('input[name="defense"]') && /aimed at an area/.test(areaDialog.querySelector(".target-defense").textContent));

  // Sessions: no squad, no start; the end clears every bank still held, and stands the squad down if asked.
  squad = [];
  notes.length = 0;
  await startSession();
  check("session: starting with no squad deployed warns and rolls nothing", /Deploy the squad first/.test(notes[0] ?? ""));
  squad = [operative.id];
  const updated = [];
  for ( const a of [operative, benched] ) a.update = async data => updated.push([a.id, data]);
  writes.length = 0;
  await endSession({ standDown: false });
  check("session end: everyone still holding Edge or Victory is cleared, deployed or not",
    updated.map(([id]) => id).join() === `${operative.id},${benched.id}`
      && updated.every(([, d]) => (d["system.banks.edge"] === 0) && (d["system.banks.victory"] === 0)));
  check("session end, keep the squad: the squad stays", squad.join() === operative.id && !writes.some(([k]) => k === "squad"));
  await endSession({ standDown: true });
  check("session end, stand down: the squad empties", squad.length === 0);
  delete operative.update;
  delete benched.update;
}

/* -------------------------------------------- */
/*  Stylesheet: never restyle the title bar      */
/* -------------------------------------------- */

// Foundry's window header buttons carry their Font Awesome icon class on the
// button itself. A rule like ".irop button" outranks the icon font and blanks
// them (seen on Foundry 14, 2026-10-06), so button rules must stay inside the body.
{
  const css = fs.readFileSync(path.join(ROOT, "styles/irop.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = css.split("}").map(block => block.split("{")[0]).flatMap(sel => sel.split(",")).map(s => s.trim());
  const reachesHeader = selectors.filter(sel => /^\.(application\.)?irop(\.[\w-]+)*\s+(button|\.icon|\.header-control|\.window-header\s+button)/.test(sel));
  check("no stylesheet rule reaches title bar buttons", reachesHeader.length === 0, reachesHeader.join(" | "));
  check("button rules are scoped to the window body",
    selectors.filter(sel => /\bbutton\b/.test(sel) && /^\.(application\.)?irop\b/.test(sel) && !/window-content|irop-card|irop-banks|irop-support-button|irop-project-strip|irop-roll-dialog|irop-record|irop-war-room-bar|irop-calendar|irop-date-bar|irop-turn-ribbon|irop-codex/.test(sel)).length === 0);
}

// Status effects (Johnald, 2026-10-10): the field guide's rules on all twelve, with his rulings, and
// an (X) asked for in a popup as a status goes on from a sheet.
{
  const statuses = await import("../module/statuses.mjs");
  const { onRenderChatMessage } = await import("../module/chat.mjs");
  const api = foundry.applications.api;
  const saved = { input: api.DialogV2.input, utils: foundry.utils, config: globalThis.CONFIG, user: game.user, ui: globalThis.ui };
  const notes = [];
  globalThis.ui = { notifications: { info: m => notes.push(m), warn: m => notes.push(m) } };
  const byId = Object.fromEntries(IROP.statusEffects.map(e => [e.id, e]));
  const twelve = ["ignited", "poisoned", "acidized", "frostbite", "pinned", "concealment", "mindControl", "panicked", "vulnerable", "bleeding", "electrified", "stunned"];
  const withX = ["ignited", "poisoned", "acidized", "frostbite", "panicked", "vulnerable", "bleeding", "electrified", "stunned"];
  check("statuses: all twelve carry their rules, none left unrecorded",
    twelve.every(id => byId[id]?.text.length > 60) && !IROP.statusEffects.some(e => /not yet recorded/i.test(e.text)));
  check("statuses: those with an (X) are marked and say what X counts; Pinned, Concealment and Mind Control have none",
    twelve.every(id => !!byId[id].counter === withX.includes(id)) && withX.every(id => byId[id].counterHint));
  check("statuses: every X ticks down each turn but Stunned's and Vulnerable's",
    withX.every(id => /Ticks down each turn|drops by 1 each turn/.test(byId[id].text) === !["stunned", "vulnerable"].includes(id)));
  check("statuses: his rulings in the words: Pinned's own attacks harder, Ignited's flat Agility check, Frostbite on Run and Sprint, Panicked's Charisma test and Help re-roll",
    /its attacks take \+20 D\.M\./.test(byId.pinned.text) && /flat Agility check/.test(byId.ignited.text)
      && /Run and Sprint speed are each reduced by X/.test(byId.frostbite.text)
      && /flat Charisma test/.test(byId.panicked.text) && /Help, giving a re-roll/.test(byId.panicked.text));
  check("statuses: Concealment as the field guide has it, not the handoff's DC 15",
    /Challenging Stealth check/.test(byId.concealment.text) && /overwatch/.test(byId.concealment.text) && !/DC 15/.test(byId.concealment.text));
  check("statuses: the guide's cures", /Base Paste/.test(byId.acidized.text) && /Warming Gel/.test(byId.frostbite.text)
    && /Medkit or an Antidote/.test(byId.poisoned.text) && /Grounding Stake/.test(byId.electrified.text) && /Adrenal Shot/.test(byId.stunned.text));

  check("status X: the name carries it, Ignited (3), and is plain without one",
    (statuses.statusLabel("ignited", 3) === "Ignited (3)") && (statuses.statusLabel("pinned", 0) === "Pinned"));
  check("status X: a whole number of at least 1, or nothing",
    (statuses.cleanStatusValue("2.6") === 3) && (statuses.cleanStatusValue(0) === null) && (statuses.cleanStatusValue("") === null)
      && (statuses.cleanStatusValue("x") === null));

  // Effects made the way Foundry's own status toggle makes them.
  const made = [];
  const liveEffect = data => ({
    ...data, statuses: new Set(data.statuses), flags: foundry.utils.deepClone(data.flags ?? {}),
    async update(u) {
      this.updated = (this.updated ?? 0) + 1;
      this.name = u.name;
      foundry.utils.setProperty(this.flags, "irop.counter", u["flags.irop.counter"]);
      return this;
    }
  });
  class FakeEffect {
    constructor(data) { this.data = data; }
    static async fromStatusEffect(id) {
      const def = IROP.statusEffects.find(e => e.id === id);
      return new FakeEffect({ name: def.name, img: def.img, statuses: [id] });
    }
    updateSource(u) {
      this.data.name = u.name;
      foundry.utils.setProperty(this.data, "flags.irop.counter", u["flags.irop.counter"]);
    }
    toObject() { return foundry.utils.deepClone(this.data); }
    static async create(data, { parent, keepId }) {
      const effect = liveEffect(data);
      parent.effects.push(effect);
      for ( const id of effect.statuses ) parent.statuses.add(id);
      made.push({ data, keepId });
      return effect;
    }
  }
  globalThis.CONFIG = { ...(saved.config ?? {}), ActiveEffect: { documentClass: FakeEffect } };
  const someone = name => ({
    name, isOwner: true, effects: [], statuses: new Set(), toggled: [],
    async toggleStatusEffect(id) {
      this.toggled.push(id);
      if ( this.statuses.has(id) ) this.statuses.delete(id);
      else this.statuses.add(id);
    }
  });

  const kael = someone("Kael");
  await statuses.setStatus(kael, "ignited", 3);
  const ignited = statuses.statusEffectOn(kael, "ignited");
  check("status X: put on, it is the status's own effect, named with its X and keeping it",
    (ignited?.name === "Ignited (3)") && (ignited.flags.irop.counter === 3) && made[0].keepId && (statuses.statusValue(kael, "ignited") === 3));
  await statuses.setStatus(kael, "ignited", 1);
  check("status X: set again, that effect changes; no second one",
    (kael.effects.length === 1) && (ignited.name === "Ignited (1)") && (statuses.statusValue(kael, "ignited") === 1));
  await statuses.setStatus(kael, "pinned", 4);
  const pinned = statuses.statusEffectOn(kael, "pinned");
  check("status X: a status without one goes on plain", (pinned.name === "Pinned") && (statuses.statusValue(kael, "pinned") === 0));

  // The popup.
  let asked = null;
  api.DialogV2.input = async options => { asked = options; return { value: 2 }; };
  const got = await statuses.askStatusValue("bleeding", { actorName: "Kael" });
  check("status popup: titled with the status and whose it is, its rules above, X with what it counts, an Apply button",
    (got === 2) && (asked.window.title === "Bleeding (X): Kael") && asked.content.includes("Take X damage when taking any action")
      && /name="value"[^>]*value="1"|value="1"[^>]*name="value"/.test(asked.content.replace(/\s+/g, " "))
      && /damage when acting/.test(asked.content) && (asked.ok.label === "Apply") && (asked.rejectClose === false)
      && asked.classes.includes("irop-status-dialog"), asked.content);
  api.DialogV2.input = async () => null;
  check("status popup: dismissed, nothing", (await statuses.askStatusValue("bleeding")) === null);
  api.DialogV2.input = async () => ({ value: 0 });
  check("status popup: 0 or less, nothing", (await statuses.askStatusValue("bleeding")) === null);

  // On the sheet: the X shown, and asked for as a status goes on.
  const marked = makeActor("operative", OperativeData, {}, [{ type: "role", name: "Outrider", system: { role: "outrider" } }]);
  marked.effects = [liveEffect({ name: "Bleeding (2)", statuses: ["bleeding"], flags: { irop: { counter: 2 } } })];
  const { context: sc, out: so } = await renderSheet(OperativeSheet, marked);
  const sdoc = new JSDOM(`<section class="application irop operative">${so.combat}</section>`).window.document;
  const bleedButton = sdoc.querySelector('[data-status="bleeding"]');
  check("status on the sheet: one that is on shows its X at the button's end, and how to change it",
    (sc.statuses.find(e => e.id === "bleeding").label === "Bleeding (2)") && (bleedButton.querySelector(".status-x")?.textContent === "2")
      && bleedButton.hasAttribute("data-counter") && /^Bleeding \(X\): /.test(bleedButton.dataset.tooltip)
      && /Right-click to change X\.$/.test(bleedButton.dataset.tooltip), bleedButton?.outerHTML);
  const pinButton = sdoc.querySelector('[data-status="pinned"]');
  const igniteButton = sdoc.querySelector('[data-status="ignited"]');
  check("status on the sheet: one without an (X) has no number and no mark for one; one that is off shows no number yet",
    !pinButton.hasAttribute("data-counter") && !pinButton.querySelector(".status-x") && /^Pinned: Speed is set to 0/.test(pinButton.dataset.tooltip)
      && igniteButton.hasAttribute("data-counter") && !igniteButton.querySelector(".status-x") && !/Right-click/.test(igniteButton.dataset.tooltip));

  const toggleStatus = IropActorSheet.DEFAULT_OPTIONS.actions.toggleStatus;
  const mara = someone("Mara");
  const onSheet = new OperativeSheet(mara);
  const pressed = id => ({ dataset: { status: id } });
  let prompts = 0;
  api.DialogV2.input = async options => { prompts++; asked = options; return { value: 3 }; };
  await toggleStatus.call(onSheet, {}, pressed("ignited"));
  check("status toggle: one with an (X) asks for it, naming whose it is, then goes on with it",
    (prompts === 1) && /: Mara$/.test(asked.window.title) && (statuses.statusValue(mara, "ignited") === 3) && !mara.toggled.length);
  await toggleStatus.call(onSheet, {}, pressed("ignited"));
  check("status toggle: a click while it is on takes it off, with no popup", (prompts === 1) && (mara.toggled.join() === "ignited"));
  await toggleStatus.call(onSheet, {}, pressed("pinned"));
  check("status toggle: one without an (X) goes straight on, no popup", (prompts === 1) && (mara.toggled.join() === "ignited,pinned"));
  api.DialogV2.input = async () => null;
  await toggleStatus.call(onSheet, {}, pressed("bleeding"));
  check("status toggle: the popup dismissed, nothing goes on", !mara.statuses.has("bleeding") && !statuses.statusEffectOn(mara, "bleeding"));

  // A right-click on one that is on changes its X, starting from the one it has.
  const markedSheet = new OperativeSheet(marked);
  markedSheet.element = sdoc.querySelector("section");
  await IropActorSheet.prototype._onRender.call(markedSheet, { accent: "" }, {});
  api.DialogV2.input = async options => { asked = options; return { value: 1 }; };
  sdoc.querySelector('[data-status="bleeding"]').dispatchEvent(new sdoc.defaultView.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));
  check("status right-click: changes the X in the same popup, starting from the X it has",
    /value="2"/.test(asked?.content ?? "") && (marked.effects[0].name === "Bleeding (1)") && (statuses.statusValue(marked, "bleeding") === 1),
    asked?.content);
  asked = null;
  sdoc.querySelector('[data-status="ignited"]').dispatchEvent(new sdoc.defaultView.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 0));
  check("status right-click: nothing on one that is off", asked === null);

  // From a chat card's Apply: the card's X goes with it.
  game.user = { id: "gm", isGM: true, name: "GM" };
  const trooper = someone("GENESIS Trooper");
  foundry.utils = { ...saved.utils, fromUuidSync: uuid => ((uuid === "Actor.t") ? trooper : null) };
  const applyFrom = async (status, answer = null) => {
    api.DialogV2.input = async options => { asked = options; return answer; };
    asked = null;
    const card = new JSDOM('<div><button type="button" data-irop-action="applyStatus">Apply</button></div>').window.document;
    const flags = [];
    const message = { rolls: [{ options: { status, targetUuid: "Actor.t" } }], isOwner: true, setFlag: async (scope, key) => flags.push(key) };
    onRenderChatMessage(message, card.body);
    card.querySelector("button").dispatchEvent(new card.defaultView.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    return flags;
  };
  let flags = await applyFrom({ id: "ignited", value: 3 });
  check("status from chat: Apply puts the card's X on the target, no popup, and marks the card",
    (statuses.statusValue(trooper, "ignited") === 3) && (asked === null) && (flags.join() === "statusApplied"));
  await applyFrom({ id: "ignited", value: 2 });
  check("status from chat: a target that has it already keeps the larger X", statuses.statusValue(trooper, "ignited") === 3);
  await applyFrom({ id: "ignited", value: 5 });
  check("status from chat: and takes a larger one", statuses.statusValue(trooper, "ignited") === 5);
  flags = await applyFrom({ id: "frostbite", value: 0 }, { value: 2 });
  check("status from chat: a card with no X for a status that has one asks for it",
    (asked !== null) && (statuses.statusValue(trooper, "frostbite") === 2) && (flags.join() === "statusApplied"));
  flags = await applyFrom({ id: "poisoned", value: 0 }, null);
  check("status from chat: that popup dismissed, nothing goes on and the card is not marked",
    !trooper.statuses.has("poisoned") && !flags.length);

  api.DialogV2.input = saved.input;
  foundry.utils = saved.utils;
  globalThis.CONFIG = saved.config;
  game.user = saved.user;
  globalThis.ui = saved.ui;
}

// Background perks (Johnald, 2026-10-10): each background offers perks, a new character takes one,
// and a GM edits the perks in the game.
{
  const bgRules = await import("../module/rules/backgrounds.mjs");
  const { ownedPerks } = await import("../module/rules/skill-trees.mjs");
  const api = foundry.applications.api;
  const saved = { input: api.DialogV2.input, confirm: api.DialogV2.confirm, utils: foundry.utils, user: game.user, ui: globalThis.ui,
    items: game.items, folders: game.folders, config: globalThis.CONFIG };
  const notes = [];
  globalThis.ui = { notifications: { info: m => notes.push(m), warn: m => notes.push(m) } };

  // The rules.
  const fence = { uuid: "Item.p1", name: "Fence", img: "fence.svg" };
  const listed = bgRules.withPerk([], fence, "n1");
  check("background perks: an ability joins the list by uuid, with its name and picture",
    JSON.stringify(listed) === JSON.stringify([{ id: "n1", uuid: "Item.p1", name: "Fence", img: "fence.svg" }]));
  check("background perks: not twice", bgRules.withPerk(listed, fence, "n2") === null);
  check("background perks: one comes off the list", JSON.stringify(bgRules.withoutPerk(listed, "n1")) === "[]");
  const source = { _id: "abc", name: "Fence", type: "ability", folder: "f1", sort: 5, ownership: { default: 0 },
    system: { kind: "passive", source: "generalist", tree: "", description: "<p>Sell hot goods.</p>" }, flags: { core: { x: 1 } } };
  const copy = bgRules.perkCopy(source, "Criminal", { id: "n1", uuid: "Item.p1" });
  check("background perks: the operative's copy is the ability, filed under Background with its background, and marked",
    !("_id" in copy) && !("folder" in copy) && !("sort" in copy) && !("ownership" in copy) && (copy.system.source === "background")
      && (copy.system.tree === "Criminal") && (copy.system.description === "<p>Sell hot goods.</p>") && (copy.flags.core.x === 1)
      && (JSON.stringify(copy.flags.irop.backgroundPerk) === JSON.stringify({ background: "Criminal", perk: "n1", uuid: "Item.p1" })));
  check("background perks: copying leaves the ability itself alone", (source._id === "abc") && (source.system.source === "generalist") && !source.flags.irop);
  check("background perks: the one taken is found by its background's name",
    (bgRules.takenPerk([{ type: "ability", flags: { irop: { backgroundPerk: { background: "Criminal" } } }, name: "Fence" }], "Criminal")?.name === "Fence")
      && (bgRules.takenPerk([{ type: "ability", flags: { irop: { backgroundPerk: { background: "Veteran" } } } }], "Criminal") === null)
      && bgRules.isBackgroundPerk(copy) && !bgRules.isBackgroundPerk(source));
  const tree = { tiers: [{ nodes: [{ id: "t1", name: "Fence" }] }] };
  check("background perks: a background's perk does not count as a tree's perk of the same name",
    !ownedPerks([tree], [{ id: "a1", name: "Fence", flags: { irop: { backgroundPerk: { background: "Criminal" } } } }]).has("t1")
      && ownedPerks([tree], [{ id: "a2", name: "Fence", flags: {} }]).has("t1"));
  const model = new itemModels.BackgroundData({ perks: [{ uuid: "Item.p1", name: "Fence" }] });
  check("background perks: the background keeps the list, each entry with an id of its own",
    (model.perks.length === 1) && (model.perks[0].uuid === "Item.p1") && (typeof model.perks[0].id === "string") && (model.perks[0].id.length === 16)
      && (new itemModels.BackgroundData({}).perks.length === 0));

  // The abilities the perks point at.
  const abilities = {
    "Item.p1": { uuid: "Item.p1", name: "Fence", img: "fence.svg", type: "ability", parent: null,
      system: { kind: "passive", actionType: "single", energyCost: 0, description: "<p>Sell hot goods for more.</p>" } },
    "Item.p2": { uuid: "Item.p2", name: "Street Smarts", img: "street.svg", type: "ability", parent: null,
      system: { kind: "active", actionType: "single", energyCost: 3, description: "<p>Read a room.</p>" } },
    "Item.w1": { uuid: "Item.w1", name: "Knife", type: "weapon", parent: null },
    "Actor.k.Item.p9": { uuid: "Actor.k.Item.p9", name: "Kael's Fence", type: "ability", parent: { id: "k" } }
  };
  const opened = [];
  for ( const a of Object.values(abilities) ) {
    a.toObject = () => ({ name: a.name, img: a.img, type: a.type, system: foundry.utils.deepClone(a.system ?? {}), flags: {} });
    a.sheet = { render: () => opened.push(a.name) };
  }
  foundry.utils = { ...saved.utils, fromUuid: async uuid => abilities[uuid] ?? null, fromUuidSync: uuid => abilities[uuid] ?? null };

  // The background's sheet: the list, and a GM's tools for it.
  const updates = [];
  const makeBackground = perks => {
    const bg = new FakeDoc({});
    Object.assign(bg, { id: "bg1", name: "Criminal", type: "background", img: "criminal.svg", uuid: "Item.bg1", isOwner: true, effects: [], actor: null });
    bg.getRollData = () => ({});
    bg.system = new itemModels.BackgroundData({ startingSkills: "Stealth, Insight, Lockpicking, Coercion, Deception", perks }, { parent: bg });
    bg.update = async data => {
      updates.push(data);
      if ( data["system.perks"] ) bg.system = new itemModels.BackgroundData({ ...bg.system._source, perks: data["system.perks"] }, { parent: bg });
      return bg;
    };
    return bg;
  };
  const criminal = makeBackground([
    { id: "n1", uuid: "Item.p1", name: "Fence", img: "fence.svg" },
    { id: "n2", uuid: "Item.p2", name: "Street Smarts", img: "street.svg" },
    { id: "n3", uuid: "Item.gone", name: "Old Perk", img: "old.svg" }
  ]);
  game.user = { id: "gm", isGM: true, name: "GM" };
  const gmView = await renderSheet(IropItemSheet, criminal);
  const gdoc = new JSDOM(`<section class="application irop item-sheet">${gmView.out.details}</section>`).window.document;
  const entries = [...gdoc.querySelectorAll(".background-perks .perk-entry")];
  check("background sheet: lists its perks with each ability's name and picture, a missing one marked",
    (entries.map(e => e.querySelector(".perk-name").textContent).join() === "Fence,Street Smarts,Old Perk")
      && (entries[0].querySelector("img").getAttribute("src") === "fence.svg") && entries[2].classList.contains("missing")
      && /Missing from the world/.test(entries[2].textContent), gmView.out.details);
  check("background sheet: a GM gets the drop zone, a remove on each, and New perk",
    !!gdoc.querySelector(".perk-list[data-perk-drop]") && (gdoc.querySelectorAll('[data-action="deletePerk"]').length === 3)
      && !!gdoc.querySelector('[data-action="newPerk"]') && entries.every(e => e.querySelector('[data-action="openPerk"]')));
  check("background sheet: the GM has the Details tab, the Paraphysical box and the perk list on it",
    ("details" in gmView.out) && !!gmView.context.tabs.details && !!gdoc.querySelector('input[name="system.paraphysical"][type="checkbox"]'));
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  // Johnald, 2026-10-10: "make sure players cannot access the details tab of backgrounds".
  const playerSheet = await renderSheet(IropItemSheet, criminal);
  check("background sheet: players get no Details tab at all, so nothing there to change, and it opens on Description",
    !("details" in playerSheet.out) && !playerSheet.context.tabs.details && !!playerSheet.context.tabs.description?.active
      && !("effects" in playerSheet.out) && (Object.keys(playerSheet.context.tabs).join() === "description"));
  const sheetForPlayer = new IropItemSheet(criminal);
  check("background sheet: for players the tab list itself has no Details, and Description comes first",
    (sheetForPlayer._getTabsConfig("primary").tabs.map(t => t.id).join() === "description,effects")
      && (sheetForPlayer._getTabsConfig("primary").initial === "description"));
  // An item players may still change: a perk tree (abilities, boons and mutations joined the GM's list too).
  const openItem = new FakeDoc({});
  Object.assign(openItem, { id: "tree1", name: "Pointman", type: "skillTree", img: "tree.svg", uuid: "Item.tree1", isOwner: true, effects: [], actor: null });
  openItem.getRollData = () => ({});
  openItem.system = new itemModels.SkillTreeData({}, { parent: openItem });
  const abilityView = await renderSheet(IropItemSheet, openItem);
  check("background sheet: other items keep their Details tab for players", ("details" in abilityView.out) && !!abilityView.context.tabs.details);
  // Foundry sets a sheet's opening tab from TABS when it is made (application.mjs: tabGroups), so it
  // would start a player on the Details tab they do not get.
  const opening = new IropItemSheet(criminal);
  opening.tabGroups = { primary: "details" };
  const openTabs = opening._prepareTabs("primary");
  check("background sheet: a player's background, which Foundry starts on Details, opens on Description instead",
    (opening.tabGroups.primary === "description") && openTabs.description?.active && !openTabs.details);
  const abilityOpening = new IropItemSheet(openItem);
  abilityOpening.tabGroups = { primary: "details" };
  abilityOpening._prepareTabs("primary");
  game.user = { id: "gm", isGM: true, name: "GM" };
  const gmOpening = new IropItemSheet(criminal);
  gmOpening.tabGroups = { primary: "details" };
  const gmTabs = gmOpening._prepareTabs("primary");
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  check("background sheet: the GM's still opens on Details, and so does any other item for a player",
    (gmOpening.tabGroups.primary === "details") && gmTabs.details?.active && (abilityOpening.tabGroups.primary === "details"));
  // The perks as banners under the description (Johnald, 2026-10-10), for players and GM alike.
  const playerDesc = new JSDOM((await renderSheet(IropItemSheet, criminal)).out.description).window.document;
  const bannerEls = [...playerDesc.querySelectorAll(".perk-banners .perk-banner")];
  check("background banners: each perk that exists is a banner under the description, with its picture, name, kind and text",
    (bannerEls.map(b => b.querySelector("h4").textContent).join() === "Fence,Street Smarts")
      && (bannerEls[0].querySelector(".perk-banner-meta").textContent === "Passive") && /3 EN/.test(bannerEls[1].querySelector(".perk-banner-meta").textContent)
      && /Sell hot goods for more/.test(bannerEls[0].querySelector(".perk-banner-text").innerHTML)
      && (bannerEls[0].querySelector("img").getAttribute("src") === "fence.svg") && !playerDesc.querySelector(".perk-banner.taken")
      && (playerDesc.querySelector(".perk-banners .description-section-title")?.textContent === "Background perks"), playerDesc.body.innerHTML);
  const gmDescFirst = new JSDOM(gmView.out.description).window.document;
  check("background banners: the description above them is as tall as its text",
    gmDescFirst.querySelector("section.tab.description").classList.contains("has-extras") && gmDescFirst.querySelector("prose-mirror").classList.contains("content-sized"));
  // Johnald, 2026-10-10: "lets have the skills to pick from above the Background perks as well".
  const skillsBox = playerDesc.querySelector(".background-skills");
  check("background skills: between the description and the perks, each skill by name, the headings bare (Johnald, 2026-10-10: no subtext)",
    (gmDescFirst.querySelector("prose-mirror").nextElementSibling?.classList.contains("background-skills"))
      && (playerDesc.querySelector("section.tab.description").firstElementChild === skillsBox) && (skillsBox?.nextElementSibling?.classList.contains("perk-banners"))
      && ([...skillsBox.querySelectorAll(".skill-chips li")].map(li => li.textContent).join() === "Stealth,Insight,Lock Picking,Coercion,Deception")
      && (skillsBox.querySelector(".description-section-title").textContent === "Starting skills") && !playerDesc.querySelector(".description-section-title span"), skillsBox?.outerHTML);
  const gmDesc = new JSDOM(gmView.out.description).window.document;
  check("background banners: the GM sees them too", gmDesc.querySelectorAll(".perk-banner").length === 2);
  // Johnald, 2026-10-10: "Players should also not be capable of editing the description text of backgrounds".
  const written = makeBackground([]);
  written.system = new itemModels.BackgroundData({ description: "<p>Life in the megacities was great.</p>", startingSkills: "Stealth" }, { parent: written });
  const readDesc = new JSDOM((await renderSheet(IropItemSheet, written)).out.description).window.document;
  check("background description: a player reads it, with no editor to open",
    !readDesc.querySelector("prose-mirror") && !readDesc.querySelector('[name="system.description"]')
      && (readDesc.querySelector(".item-description-read")?.innerHTML === "<p>Life in the megacities was great.</p>")
      && (readDesc.querySelector(".item-description-read").nextElementSibling?.classList.contains("background-skills")));
  check("background description: an empty one shows nothing to a player, not an empty box",
    !playerDesc.querySelector(".item-description-read, prose-mirror"));
  const abilityDesc = new JSDOM((await renderSheet(IropItemSheet, openItem)).out.description).window.document;
  // Johnald, 2026-10-10: "I dont want players editing any items".
  check("item description: every item's is read only for players, a perk tree's too (no editor at all)",
    !abilityDesc.querySelector("prose-mirror"));
  const lockedSheet = new IropItemSheet(openItem);
  const lockedContext = await lockedSheet._prepareContext({});
  const lockedHeader = new JSDOM((await renderSheet(IropItemSheet, openItem)).out.header).window.document;
  // An item's effects, on the character's Effects tab (Edit mode): read, not changed, by a player.
  const effectsAs = async gm => {
    game.user = gm ? { id: "gm", isGM: true, name: "GM" } : { id: "p1", isGM: false, name: "Johnald" };
    const { out } = await renderSheet(OperativeSheet, operative, { editMode: true });
    return new JSDOM(out.effects ?? "").window.document.querySelector('[data-effect-id="e1"]');
  };
  const playerEffect = await effectsAs(false);
  const gmEffect = await effectsAs(true);
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  check("items: a player reads an item's effect on the Effects tab, its name and changes, but cannot open or switch it",
    !!playerEffect && !playerEffect.querySelector('[data-action="editEffect"], [data-action="toggleEffect"]')
      && /Resilience/.test(playerEffect.querySelector(".effect-name")?.textContent ?? "") && /hp/.test(playerEffect.textContent)
      && !!gmEffect?.querySelector('[data-action="editEffect"]') && !!gmEffect.querySelector('[data-action="toggleEffect"]'), playerEffect?.outerHTML);
  const effectRow = new JSDOM('<li data-effect-id="e1" data-parent-id="i0"><button></button></li>').window.document.querySelector("button");
  let effectTouched = 0;
  const effectSheet = new OperativeSheet({ ...operative, items: { get: () => ({ effects: { get: () => ({ disabled: false, update: () => effectTouched++, sheet: { render: () => effectTouched++ } }) } }) } });
  await IropActorSheet.DEFAULT_OPTIONS.actions.toggleEffect.call(effectSheet, {}, effectRow);
  await IropActorSheet.DEFAULT_OPTIONS.actions.editEffect.call(effectSheet, {}, effectRow);
  check("items: and pressing them anyway does nothing", effectTouched === 0);
  check("items: no item sheet is editable for a player, not even their own copy; name and picture locked too",
    (lockedSheet.isEditable === false) && (lockedContext.editable === false) && lockedHeader.querySelector('input[name="name"]').disabled
      && !lockedHeader.querySelector('[data-action="editImage"]'));
  game.user = { id: "gm", isGM: true, name: "GM" };
  const gmHeader = new JSDOM((await renderSheet(IropItemSheet, openItem)).out.header).window.document;
  check("items: the GM edits any item sheet, name and picture included",
    (new IropItemSheet(openItem).isEditable === true) && !gmHeader.querySelector('input[name="name"]').disabled && !!gmHeader.querySelector('[data-action="editImage"]'));
  const gmRead = new JSDOM((await renderSheet(IropItemSheet, written)).out.description).window.document;
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  check("background description: the GM still writes it", !!gmRead.querySelector('prose-mirror[name="system.description"]') && !gmRead.querySelector(".item-description-read"));
  const plainDesc = new JSDOM((await renderSheet(IropItemSheet, makeBackground([]))).out.description).window.document;
  check("background banners: none for a background with no perks; its skills still show",
    !plainDesc.querySelector(".perk-banners") && !!plainDesc.querySelector(".background-skills") && !!plainDesc.querySelector("section.has-extras"));
  const bareBg = makeBackground([]);
  bareBg.system = new itemModels.BackgroundData({ startingSkills: "" }, { parent: bareBg });
  const bareDesc = new JSDOM((await renderSheet(IropItemSheet, bareBg)).out.description).window.document;
  check("background skills: with neither skills nor perks, just the usual description box",
    !bareDesc.querySelector(".background-skills, .perk-banners") && !bareDesc.querySelector("section.has-extras") && !bareDesc.querySelector("prose-mirror.content-sized"));
  const oddBg = makeBackground([]);
  oddBg.system = new itemModels.BackgroundData({ startingSkills: "Stealth, Basket Weaving", skillPicks: 3 }, { parent: oddBg });
  const oddPlayer = new JSDOM((await renderSheet(IropItemSheet, oddBg)).out.description).window.document;
  game.user = { id: "gm", isGM: true, name: "GM" };
  const oddGm = new JSDOM((await renderSheet(IropItemSheet, oddBg)).out.description).window.document;
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  check("background skills: a GM alone sees what is not a skill",
    !oddPlayer.querySelector(".background-skills .warn") && /Not a skill, so never offered: "Basket Weaving"/.test(oddGm.querySelector(".background-skills .warn")?.textContent ?? ""));
  game.user = { id: "gm", isGM: true, name: "GM" };

  const itemSheet = new IropItemSheet(criminal);
  const itemActions = IropItemSheet.DEFAULT_OPTIONS.actions;
  await itemActions.openPerk.call(itemSheet, {}, entries[1].querySelector(".perk-name"));
  await itemActions.openPerk.call(itemSheet, {}, entries[2].querySelector(".perk-name"));
  check("background sheet: clicking a perk opens its ability to edit; a missing one says so",
    (opened.join() === "Street Smarts") && /missing from the world/.test(notes.at(-1) ?? ""));
  await itemActions.deletePerk.call(itemSheet, {}, entries[2].querySelector('[data-action="deletePerk"]'));
  check("background sheet: a GM takes one off the list", JSON.stringify(updates.at(-1)["system.perks"].map(p => p.id)) === JSON.stringify(["n1", "n2"]));
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  updates.length = 0;
  await itemActions.deletePerk.call(itemSheet, {}, entries[0].querySelector('[data-action="deletePerk"]'));
  await itemActions.newPerk.call(itemSheet);
  check("background sheet: a player cannot take one off or make one", !updates.length);
  game.user = { id: "gm", isGM: true, name: "GM" };

  // New perk: a passive ability in a Background Perks folder, on the list, opened.
  const createdItems = [], createdFolders = [];
  globalThis.CONFIG = { ...(saved.config ?? {}),
    Folder: { documentClass: { create: async data => { const f = { id: "fold1", ...data }; createdFolders.push(f); folders.push(f); return f; } } },
    Item: { documentClass: { create: async data => {
      const a = { ...data, uuid: `Item.new${createdItems.length}`, img: "icons/svg/item-bag.svg", parent: null, sheet: { render: () => opened.push(data.name) } };
      createdItems.push(a);
      return a;
    } } } };
  const folders = [];
  game.folders = { find: fn => folders.find(fn) };
  opened.length = 0;
  await itemActions.newPerk.call(itemSheet);
  await itemActions.newPerk.call(itemSheet);
  check("background sheet: New perk makes a passive Background ability named for its background, in one Background Perks folder",
    (createdFolders.length === 1) && (createdFolders[0].name === "Background Perks") && (createdFolders[0].type === "Item")
      && (createdItems.length === 2) && createdItems.every(a => (a.type === "ability") && (a.folder === "fold1") && (a.system.kind === "passive")
        && (a.system.source === "background") && (a.system.tree === "Criminal")), JSON.stringify(createdItems));
  check("background sheet: and puts it on the list and opens it to be written",
    criminal.system.perks.some(p => p.uuid === "Item.new0") && criminal.system.perks.some(p => p.uuid === "Item.new1")
      && (opened.join() === "New Perk,New Perk"));

  // Dropping abilities on the list.
  criminal.system = new itemModels.BackgroundData({ perks: [{ id: "n1", uuid: "Item.p1", name: "Fence" }] }, { parent: criminal });
  const dropView = await renderSheet(IropItemSheet, criminal);
  const ddoc = new JSDOM(`<section class="application irop item-sheet">${dropView.out.details}</section>`).window.document;
  itemSheet.element = ddoc.querySelector("section");
  await IropItemSheet.prototype._onRender.call(itemSheet, { accent: null }, {});
  const dropOn = async uuid => {
    const event = new ddoc.defaultView.Event("drop", { bubbles: true, cancelable: true });
    event.dataTransfer = { getData: () => JSON.stringify({ type: "Item", uuid }) };
    ddoc.querySelector("[data-perk-drop]").dispatchEvent(event);
    await new Promise(r => setTimeout(r, 0));
  };
  updates.length = 0;
  await dropOn("Item.p2");
  check("background sheet: an ability dropped on the list joins it",
    JSON.stringify(updates.at(-1)?.["system.perks"]?.map(p => p.name)) === JSON.stringify(["Fence", "Street Smarts"]));
  updates.length = 0;
  notes.length = 0;
  await dropOn("Item.p1");
  await dropOn("Item.w1");
  await dropOn("Actor.k.Item.p9");
  check("background sheet: not one already there, not a weapon, not a character's copy, each saying why",
    !updates.length && /already one of Criminal's perks/.test(notes[0] ?? "") && /Only abilities/.test(notes[1] ?? "")
      && /not from a character/.test(notes[2] ?? ""), JSON.stringify(notes));

  // The character: picked after the starting skills, shown on the Background row.
  const recruit = makeActor("operative", OperativeData, {}, [
    { type: "background", name: "Criminal", id: "crim", system: { startingSkills: "Stealth, Insight", skillPicks: 0,
      perks: [{ id: "n1", uuid: "Item.p1", name: "Fence" }, { id: "n2", uuid: "Item.p2", name: "Street Smarts" }, { id: "n3", uuid: "Item.gone" }] } }
  ]);
  const made = [];
  recruit.createEmbeddedDocuments = async (type, list) => list.map((d, i) => {
    const it = new FakeDoc({});
    Object.assign(it, { id: `perk${made.length}`, type: d.type, name: d.name, img: d.img, flags: d.flags, actor: recruit, sort: 9 });
    it.system = new itemModels.AbilityData(d.system ?? {}, { parent: it });
    it.delete = async () => { recruit.items.splice(recruit.items.indexOf(it), 1); it.deleted = true; };
    recruit.items.push(it);
    made.push(d);
    return it;
  });
  const pickSheet = new OperativeSheet(recruit);
  const actorActions = IropActorSheet.DEFAULT_OPTIONS.actions;
  let shown = null;
  const chipOf = async editMode => new JSDOM((await renderSheet(OperativeSheet, recruit, { editMode })).out.header).window.document
    .querySelector('.identity-row[data-item-id="crim"]');
  let row = await chipOf(true);
  check("character: a background with perks and none taken offers Pick on its row in Edit mode",
    !!row.querySelector('[data-action="pickBackgroundPerk"]') && !row.querySelector(".identity-btn.perk"));
  check("character: not in Play mode", !(await chipOf(false)).querySelector('[data-action="pickBackgroundPerk"]'));

  api.DialogV2.input = async options => { shown = options; return null; };
  await actorActions.pickBackgroundPerk.call(pickSheet);
  const pdoc = new JSDOM(shown.content).window.document;
  check("character: the pick shows each perk that exists, its name, what kind and its text, one to take",
    (shown.window.title === "Criminal: background perk") && ([...pdoc.querySelectorAll(".perk-choice strong")].map(e => e.textContent).join() === "Fence,Street Smarts")
      && (pdoc.querySelectorAll('input[type="radio"][name="perk"]').length === 2) && /Sell hot goods for more/.test(shown.content)
      && /Passive/.test(pdoc.querySelectorAll(".perk-choice-meta")[0].textContent) && /3 EN/.test(pdoc.querySelectorAll(".perk-choice-meta")[1].textContent)
      && (shown.ok.label === "Take it"), shown.content);
  check("character: dismissed, nothing is taken", !made.length);
  api.DialogV2.input = async () => ({});
  notes.length = 0;
  await actorActions.pickBackgroundPerk.call(pickSheet);
  check("character: none picked, nothing taken, and it says where to pick again", !made.length && /Background row in Edit mode/.test(notes.at(-1) ?? ""));
  api.DialogV2.input = async () => ({ perk: "n2" });
  await actorActions.pickBackgroundPerk.call(pickSheet);
  const taken = bgRules.takenPerk(recruit.items, "Criminal");
  check("character: the perk picked goes on as a copy of its ability, under Background, marked with where it came from",
    (made.length === 1) && (taken?.name === "Street Smarts") && (taken.system.source === "background") && (taken.system.tree === "Criminal")
      && (taken.flags.irop.backgroundPerk.perk === "n2"));
  shown = null;
  api.DialogV2.input = async options => { shown = options; return { perk: "n1" }; };
  await actorActions.pickBackgroundPerk.call(pickSheet);
  check("character: one perk per background: no second offer once taken", (shown === null) && (made.length === 1));
  row = await chipOf(false);
  check("character: the Background row shows a star for the perk taken, in Play mode too, opening it",
    (row.querySelector(".identity-btn.perk")?.dataset.itemId === taken.id) && /Background perk: Street Smarts/.test(row.querySelector(".identity-btn.perk").dataset.tooltip)
      && (row.querySelector(".identity-btn.perk").dataset.action === "editItem"));
  row = await chipOf(true);
  check("character: in Edit mode a GM can take it off to pick again; no Pick while it is on",
    !!row.querySelector('[data-action="resetBackgroundPerk"]') && !row.querySelector('[data-action="pickBackgroundPerk"]'));
  const abilitiesTab = (await renderSheet(OperativeSheet, recruit)).out.abilities;
  check("character: the perk is on the Abilities tab, filed as Background, Criminal", /Street Smarts/.test(abilitiesTab) && /Background · Criminal/.test(abilitiesTab));
  const ownBackground = recruit.items.find(i => i.type === "background");
  Object.assign(ownBackground, { uuid: "Actor.test.Item.crim", isOwner: true, effects: [] });
  ownBackground.getRollData = () => ({});
  const ownDesc = new JSDOM((await renderSheet(IropItemSheet, ownBackground)).out.description).window.document;
  check("background banners: on a character's own background, the perk they took is marked",
    ([...ownDesc.querySelectorAll(".perk-banner.taken h4")].map(h => h.textContent).join() === "Street Smarts")
      && /Taken/.test(ownDesc.querySelector(".perk-banner.taken .perk-banner-taken")?.textContent ?? "")
      && (ownDesc.querySelectorAll(".perk-banner").length === 2), ownDesc.body.innerHTML);

  game.user = { id: "p1", isGM: false, name: "Johnald" };
  check("character: a player has no reset", !(await chipOf(true)).querySelector('[data-action="resetBackgroundPerk"]'));
  await actorActions.resetBackgroundPerk.call(pickSheet);
  check("character: and pressing it anyway does nothing", !taken.deleted);
  game.user = { id: "gm", isGM: true, name: "GM" };
  api.DialogV2.confirm = async () => false;
  await actorActions.resetBackgroundPerk.call(pickSheet);
  check("character: a GM who thinks better of it keeps the perk", !taken.deleted);
  let asked = null;
  api.DialogV2.confirm = async options => { asked = options; return true; };
  await actorActions.resetBackgroundPerk.call(pickSheet);
  check("character: a GM's reset takes the perk off, saying what and from whom, and Pick comes back",
    taken.deleted && /Take Street Smarts off Test Operative/.test(asked?.content ?? "") && !!(await chipOf(true)).querySelector('[data-action="pickBackgroundPerk"]'));

  // The GM's list in the Items sidebar is the one offered, even to a character whose copy is older.
  const worldCriminal = makeBackground([{ id: "w1", uuid: "Item.p1", name: "Fence" }]);
  game.items = { find: fn => [worldCriminal].find(fn) };
  api.DialogV2.input = async options => { shown = options; return null; };
  await actorActions.pickBackgroundPerk.call(pickSheet);
  check("character: the pick offers the GM's current list for that background, not the character's older copy",
    /Fence/.test(shown.content) && !/Street Smarts/.test(shown.content));
  game.items = { find: () => undefined };
  check("character: with no world background of that name, the character's own copy's list",
    !!(await chipOf(true)).querySelector('[data-action="pickBackgroundPerk"]'));
  const bare = makeActor("operative", OperativeData, {}, [{ type: "background", name: "Veteran", id: "vet", system: {} }]);
  const bareRow = new JSDOM((await renderSheet(OperativeSheet, bare, { editMode: true })).out.header).window.document.querySelector('.identity-row[data-item-id="vet"]');
  check("character: a background with no perks offers none", !bareRow.querySelector('[data-action="pickBackgroundPerk"], .identity-btn.perk'));
  check("character: the drop that adds a background offers its perk after its starting skills",
    /#offerStartingSkills\(created\);\s*\n\s*if \( created\?\.type === "background" \) await this\.#offerBackgroundPerk\(created\);/
      .test(fs.readFileSync(path.join(ROOT, "module/sheets/actor-sheet.mjs"), "utf8")));

  api.DialogV2.input = saved.input;
  api.DialogV2.confirm = saved.confirm;
  foundry.utils = saved.utils;
  game.user = saved.user;
  game.items = saved.items;
  game.folders = saved.folders;
  globalThis.CONFIG = saved.config;
  globalThis.ui = saved.ui;
}

// The Background skills macro (Johnald, 2026-10-10: "scan the backgrounds and tell me which skills
// are and are not an option for the backgrounds"), run as Foundry runs a script macro.
{
  const startingSkills = await import("../module/rules/starting-skills.mjs");
  const code = fs.readFileSync(path.join(ROOT, "dev/background-skills-macro.js"), "utf8");
  const AsyncFunction = (async () => {}).constructor;
  const api = foundry.applications.api;
  const saved = { wait: api.DialogV2.wait, system: game.system, user: game.user, items: game.items, packs: game.packs,
    irop: game.irop, ui: globalThis.ui, config: globalThis.CONFIG, utils: foundry.utils };
  const notes = [];
  globalThis.ui = { notifications: { error: m => notes.push(m), warn: m => notes.push(m), info: m => notes.push(m) } };
  game.system = { ...(saved.system ?? {}), id: "irop" };
  game.user = { id: "gm", isGM: true };
  game.irop = { config: IROP, rules: { startingSkills } };
  const bg = (name, text, picks = 3, folder = null) => ({ type: "background", name, folder: folder ? { name: folder } : null,
    system: { startingSkills: text, skillPicks: picks } });
  game.items = [
    bg("Criminal", "Stealth, Insight, Lock Picking, Coercion, Deception, Hacking"),
    bg("Survivalist", "Survival, Awareness, Mechanics, Technology, Stealth, Medical"),
    bg("Awakened", "Paraphysics, Persuasion, Awareness, Insight, Deception Starting Boon: Minor Powers Unlocked"),
    bg("Odd One", "Stealth, Basket Weaving", 3, "Drafts"),
    { type: "weapon", name: "Knife", system: {} }
  ];
  game.packs = [
    { documentName: "Item", metadata: { label: "Backgrounds" }, getIndex: async () => [
      { type: "background", name: "Criminal", system: { startingSkills: "Stealth, Coercion", skillPicks: 3 } },
      { type: "weapon", name: "Pistol" }] },
    { documentName: "Actor", metadata: { label: "NPCs" }, getIndex: async () => { throw new Error("an Actor pack is not read"); } }
  ];
  let shown = null;
  const whispers = [];
  api.DialogV2.wait = async options => { shown = options; return "chat"; };
  globalThis.CONFIG = { ...(saved.config ?? {}), ChatMessage: { documentClass: { create: async data => whispers.push(data) } } };
  // Run as Foundry 14 runs a script macro (client/documents/macro.mjs): the command in a block, in an async function.
  const runMacro = () => new AsyncFunction("speaker", "actor", "token", "character", "scope", `{${code}
}`)(null, null, null, null, {});
  await runMacro();
  const doc = new JSDOM(shown?.content ?? "").window.document;
  const text = doc.body.textContent.replace(/\s+/g, " ");
  const offered = ["stealth", "insight", "lockpicking", "coercion", "deception", "hacking", "survival", "awareness", "mechanics",
    "technology", "medical", "paraphysics", "persuasion"];
  const total = Object.keys(IROP.skills).length;
  const missing = Object.keys(IROP.skills).filter(k => !offered.includes(k));
  check("background macro: the fixture's skills are all real skills", offered.every(k => IROP.skills[k]));
  check("background macro: scans the Items sidebar's backgrounds and the Item compendiums', nothing else",
    /5 backgrounds scanned \(4 in the Items sidebar, 1 in compendiums\)/.test(text) && !notes.length, text.slice(0, 200));
  const headings = [...doc.querySelectorAll("h3")].map(h => h.textContent);
  check("background macro: the skills no background offers, all of them and none offered",
    (headings[0] === `Not offered by any background (${missing.length})`)
      && missing.every(k => text.includes(IROP.skills[k].label)) && (headings[1] === `Offered (${total - missing.length} of ${total})`), headings.join(" | "));
  const rowFor = labelText => [...doc.querySelectorAll("tbody tr")].find(r => r.querySelector("td strong")?.textContent === labelText);
  const stealth = rowFor("Stealth");
  check("background macro: each skill offered, with how many backgrounds offer it and which; two of a name told apart",
    (stealth?.children[1].textContent === "4") && /Criminal \(Items\)/.test(stealth.children[2].textContent)
      && /Criminal \(Compendium: Backgrounds\)/.test(stealth.children[2].textContent) && /Odd One/.test(stealth.children[2].textContent)
      && (rowFor("Paraphysics")?.children[1].textContent === "1") && !rowFor(IROP.skills[missing[0]].label), stealth?.outerHTML);
  const each = [...doc.querySelectorAll("li")].map(li => li.textContent.replace(/\s+/g, " "));
  check("background macro: each background's own list, read as the sheet reads it",
    each.some(t => /^Survivalist: picks 3 of 6: Survivalism, Awareness, Mechanics, Technology, Stealth, Medical$/.test(t))
      && each.some(t => /^Awakened: picks 3 of 5: Paraphysics, Persuasion, Awareness, Insight, Deception$/.test(t)), each.join(" | "));
  check("background macro: flags what the sheet would never offer, and a list shorter than its picks",
    each.some(t => /^Odd One: picks 3 of 1: Stealth/.test(t) && /lists only 1, fewer than its 3 picks/.test(t)
      && /not a skill, so never offered: "Basket Weaving"/.test(t)), each.join(" | "));
  check("background macro: shown in a window, and whispered to the GM on request",
    (shown.window.title === "Background skills") && (whispers.length === 1) && (whispers[0].whisper.join() === "gm")
      && whispers[0].content.includes("Not offered by any background"));
  game.user = { id: "p1", isGM: false };
  shown = null;
  await runMacro();
  check("background macro: GM only", (shown === null) && /GM only/.test(notes.at(-1) ?? ""));
  game.user = { id: "gm", isGM: true };

  // A world not reloaded since the update (Johnald, 2026-10-10: "the macro is not executing"): the
  // system in memory has no reader to hand, so the macro loads it from the system's own files.
  game.irop = { config: IROP, rules: {} };
  const routed = [];
  foundry.utils = { ...saved.utils, getRoute: p => { routed.push(p); return pathToFileURL(path.join(ROOT, p.replace(/^systems\/irop\//, ""))).href; } };
  shown = null;
  await runMacro();
  check("background macro: in a world not reloaded since the update, it loads the reader from the system's files and still reports",
    (routed.join() === "systems/irop/module/rules/starting-skills.mjs") && /5 backgrounds scanned/.test(shown?.content ?? ""), notes.at(-1));
  // Anything that goes wrong is said on screen, since Foundry keeps a script macro's failure to the console.
  foundry.utils = { ...saved.utils, getRoute: () => { throw new Error("no route"); } };
  const consoleError = console.error;
  console.error = () => {};
  shown = null;
  await runMacro();
  console.error = consoleError;
  check("background macro: a failure is put on screen, not left in the console",
    (shown === null) && /Background skills macro failed: no route\. The console \(F12\) has the details\./.test(notes.at(-1) ?? ""), notes.at(-1));
  foundry.utils = saved.utils;
  game.irop = { config: IROP, rules: { startingSkills } };

  game.items = [];
  game.packs = [];
  await runMacro();
  check("background macro: says so when there are no backgrounds", (shown === null) && /No backgrounds found/.test(notes.at(-1) ?? ""));
  api.DialogV2.wait = saved.wait;
  Object.assign(game, { system: saved.system, user: saved.user, items: saved.items, packs: saved.packs, irop: saved.irop });
  globalThis.ui = saved.ui;
  globalThis.CONFIG = saved.config;
}

// Bug, Johnald, 2026-10-10: "players are capable of rolling dodge checks even if they have an empty dodge pool".
{
  const rollsMod = await import("../module/rolls.mjs");
  const savedUi = globalThis.ui;
  const notes = [];
  globalThis.ui = { notifications: { warn: m => notes.push(m), info: m => notes.push(m), error: m => notes.push(m) } };
  const spent = [];
  const tired = { name: "Kael", uuid: "Actor.k", statuses: new Set(), update: d => spent.push(d),
    system: { attributes: { agi: { value: 45 } }, vitals: { dodges: { value: 0, max: 2 } } } };
  const result = await rollsMod.rollDodge(tired);
  check("dodge: with none left this round, no dodge is rolled, nothing spent, and the player is told",
    (result === null) && !spent.length && notes.includes("Kael has no dodges left this round."), JSON.stringify(notes));
  check("dodge: the pool is checked again when the window closes, and the dodge spent from what is left then",
    /if \( !data \) return null;\s*\/\/ Spent elsewhere while the window was open\.\s*if \( noneLeft\(\) \) return null;/.test(fs.readFileSync(path.join(ROOT, "module/rolls.mjs"), "utf8"))
      && /const left = Number\(actor\.system\.vitals\.dodges\.value\) \|\| 0;/.test(fs.readFileSync(path.join(ROOT, "module/rolls.mjs"), "utf8")));
  const before = operative.system.vitals.dodges.value;
  operative.system.vitals.dodges.value = 0;
  const { context, out } = await renderSheet(OperativeSheet, operative);
  const combatBtn = new JSDOM(out.combat).window.document.querySelector('.defense-bar [data-action="rollDodge"]');
  check("dodge: with none left, the Dodge button is greyed out and says when dodges come back",
    (context.canDodge === false) && combatBtn.disabled
      && /No dodges left this round\. They come back at the start of the round, or with Reset dodges/.test(combatBtn.dataset.tooltip)
      && !combatBtn.closest(".defense-bar").querySelector('[data-action="resetDodges"]').disabled);
  operative.system.vitals.dodges.value = before;
  globalThis.ui = savedUi;
}

// Concealment of carried gear (Johnald, 2026-10-10): pass or fail by what shows against carry
// capacity, Slums 50% and Megacities 25%; caught, hand over items of your choice to carry on.
{
  const conceal = await import("../module/rules/concealment.mjs");
  const cp = await import("../module/concealment.mjs");
  const { onRenderChatMessage } = await import("../module/chat.mjs");
  const { itemStats } = await import("../module/sheets/store-sheet.mjs");
  const api = foundry.applications.api;
  const saved = { input: api.DialogV2.input, user: game.user, actors: game.actors, messages: game.messages, socket: game.socket,
    users: game.users, ui: globalThis.ui, chat: globalThis.ChatMessage, utils: foundry.utils, settings: game.settings };
  const notes = [];
  globalThis.ui = { notifications: { warn: m => notes.push(m), info: m => notes.push(m), error: m => notes.push(m) } };

  check("concealment: the places and their limits, Slums 50% and Megacity 25%",
    (IROP.concealment.places.slums.limit === 50) && (IROP.concealment.places.megacity.limit === 25));
  const it = (id, type, system, name = id) => ({ id, type, name, img: `${id}.svg`, system: { quantity: 1, ...system } });
  const kitItems = () => [
    it("rifle", "weapon", { weight: 4 }, "T2 Rifle"),
    it("scope", "mod", { weight: 0.5, installedOn: "rifle" }, "Scope"),
    it("knife", "weapon", { weight: 1, concealable: true }, "Knife"),
    it("pistol", "weapon", { weight: 2 }, "Holdout"),
    it("silencer", "mod", { weight: 0.5, installedOn: "pistol", concealsHost: true }, "Silencer"),
    it("cryo", "gear", { weight: 0.5, quantity: 2, kind: "ammunition", loadedIn: "pistol" }, "Cryo Rounds"),
    it("vest", "armor", { weight: 6, equipped: true }, "Medium Vest"),
    it("grenades", "weapon", { weight: 1, quantity: 3 }, "Frag Grenade"),
    it("tent", "gear", { weight: 5, stowed: true }, "Tent"),
    it("rally", "ability", {}, "Rally")
  ];
  const kit = kitItems();
  const load = conceal.concealmentLoad(kit, 40);
  check("concealment: what shows leaves out the concealable, what a mod conceals with all that is on it, and what is stowed",
    (load.visible === 13.5) && (load.hidden === 4.5) && (load.capacity === 40) && (load.pct === 34)
      && (JSON.stringify([...conceal.hiddenItems(kit)].sort()) === JSON.stringify(["cryo", "knife", "pistol", "silencer"])), JSON.stringify(load));
  const slums = conceal.placeCheck(load, "slums");
  const city = conceal.placeCheck(load, "megacity");
  check("concealment: pass or fail by place, the share of capacity allowed and how far over",
    slums.pass && (slums.allowed === 20) && !city.pass && (city.allowed === 10) && (city.over === 3.5) && (city.label === "Megacity"));
  check("concealment: right at the limit passes", conceal.placeCheck({ visible: 10, capacity: 40 }, "megacity").pass);
  // Johnald, 2026-10-10: "For humans lets add a species ability that allots them an additional 10% of concealment".
  const humanCity = conceal.placeCheck({ visible: 13.5, capacity: 40, bonus: 10 }, "megacity");
  const humanSlums = conceal.placeCheck({ visible: 13.5, capacity: 40, bonus: 10 }, "slums");
  check("concealment: a Human's 10% more makes the Slums 60% and a Megacity 35%",
    (IROP.concealment.speciesBonus.Human === 10) && (humanCity.base === 25) && (humanCity.limit === 35) && (humanCity.allowed === 14) && humanCity.pass
      && (humanSlums.limit === 60) && (humanSlums.allowed === 24), JSON.stringify(humanCity));
  check("concealment: the operative's bonus comes from their species, here a Human, and effects can add more",
    (operative.items.find(i => i.type === "species")?.name === "Human") && (operative.system.concealment.speciesBonus === 10)
      && (operative.system.concealment.bonus === 10) && (operative.system.concealment.species === "Human")
      && (new OperativeData({}).bonuses.concealment === 0), JSON.stringify(operative.system.concealment));
  const handable = conceal.surrenderables(kit);
  check("concealment: what can be handed over: what shows, a fitted mod going with its weapon, a stack by how many",
    JSON.stringify(handable.map(o => [o.id, o.unitWeight, o.quantity, o.stack, o.attached])) === JSON.stringify([
      ["rifle", 4.5, 1, false, ["scope"]], ["vest", 6, 1, false, []], ["grenades", 1, 3, true, []]]), JSON.stringify(handable));
  check("concealment: items take a Concealable tick, mods a Conceals its host tick, both off at first; the operative works out what shows",
    (new itemModels.WeaponData({}).concealable === false) && (new itemModels.GearData({ concealable: true }).concealable === true)
      && (new itemModels.ModData({}).concealsHost === false) && (operative.system.concealment?.capacity === operative.system.carry.max));
  check("concealment: the stats a shop or a player reads say so",
    itemStats({ type: "weapon", system: { category: "melee", concealable: true } }).some(st => (st.label === "Concealment") && /Hidden by nature/.test(st.value))
      && itemStats({ type: "mod", system: { target: "ranged", concealsHost: true } }).some(st => (st.label === "Concealment") && /Hides what it is fitted to/.test(st.value)));

  // The sheet's header: what shows, and where it passes.
  const { out: headOut } = await renderSheet(OperativeSheet, operative);
  const line = new JSDOM(headOut.header).window.document.querySelector(".conceal-line");
  check("concealment: the header shows what shows, with a chip for each place, passed or caught, the numbers on hover",
    !!line && (line.querySelector(".mono-label")?.textContent === "Concealment") && (line.querySelectorAll(".conceal-chip").length === 2) && line.querySelector(".conceal-chip").textContent.includes("Slums")
      && !line.querySelector(":scope > .carry-value") && !/\d/.test(line.querySelector(".conceal-checks").textContent)
      && /^Slums allow [\d.]+ \(60%: 50% \+10% as a Human\)/.test(line.querySelector(".conceal-chip").dataset.tooltip)
      && /^Megacity allow [\d.]+ \(35%: 25% \+10% as a Human\)/.test(line.querySelectorAll(".conceal-chip")[1].dataset.tooltip)
      && /Slums allow/.test(line.querySelector(".conceal-label").dataset.tooltip) && /Concealable items/.test(line.querySelector(".conceal-label").dataset.tooltip), line?.outerHTML);
  game.user = { id: "gm", isGM: true, name: "GM" };
  const weaponDetails = new JSDOM((await renderSheet(IropItemSheet, (() => {
    const w = new FakeDoc({});
    Object.assign(w, { id: "cw", name: "Knife", type: "weapon", img: "k.svg", uuid: "Item.cw", isOwner: true, effects: [], actor: null });
    w.getRollData = () => ({});
    w.system = new itemModels.WeaponData({ concealable: true }, { parent: w });
    return w;
  })())).out.details).window.document;
  const modDetails = new JSDOM((await renderSheet(IropItemSheet, (() => {
    const m = new FakeDoc({});
    Object.assign(m, { id: "cm", name: "Silencer", type: "mod", img: "s.svg", uuid: "Item.cm", isOwner: true, effects: [], actor: null });
    m.getRollData = () => ({});
    m.system = new itemModels.ModData({ concealsHost: true }, { parent: m });
    return m;
  })())).out.details).window.document;
  check("concealment: the GM ticks an item Concealable, or a mod Conceals its host, on its Details tab",
    weaponDetails.querySelector('input[name="system.concealable"]')?.checked && modDetails.querySelector('input[name="system.concealsHost"]')?.checked
      && !!modDetails.querySelector('input[name="system.concealable"]'));

  // A checkpoint, run by the GM.
  const owned = [];
  const makeOperative = (id, name, items) => {
    const list = Object.assign(items, { get: i => items.find(x => x.id === i) ?? null });
    const a = { id, uuid: `Actor.${id}`, name, type: "operative", isOwner: true, hasPlayerOwner: true, items: list,
      system: { carry: { max: 40 } },
      testUserPermission: user => user.isGM || (user.id === "p1"),
      deleteEmbeddedDocuments: async (type, ids) => {
        for ( const i of ids ) items.splice(items.findIndex(x => x.id === i), 1);
        owned.push(["delete", ids]);
      }
    };
    for ( const x of items ) x.update = async d => { for ( const [k, v] of Object.entries(d) ) saved.utils.setProperty(x, k, v); owned.push(["update", x.id, d]); };
    return a;
  };
  const kael = makeOperative("cp1", "Kael", kitItems());
  const human = makeOperative("cp3", "Ava", kitItems());
  human.system.concealment = { bonus: 10 };
  check("checkpoint: a Human is checked with their 10% more: 13.5 showing gets through a Megacity at 35%",
    cp.checkFor(human, "megacity").pass && (cp.checkFor(human, "megacity").allowed === 14) && !cp.checkFor(kael, "megacity").pass);
  const humanCard = new JSDOM(cp.checkpointHTML({ place: "megacity", results: [{ actorUuid: "Actor.cp3", name: "Ava", ...cp.checkFor(human, "megacity"), surrendered: [] }] })).window.document;
  check("checkpoint: the card notes a Human's own share beside what they are allowed",
    /Showing 13.5 of 14 allowed \(35% for them\)/.test(humanCard.querySelector(".checkpoint-load")?.textContent ?? ""), humanCard.body.innerHTML);
  const mara = makeOperative("cp2", "Mara", [it("dagger", "weapon", { weight: 1 }, "Dagger")]);
  const cards = [];
  globalThis.ChatMessage = { implementation: { create: async d => { cards.push(d); return d; } } };
  game.actors = Object.assign([kael, mara], { get: id => [kael, mara].find(a => a.id === id) });
  foundry.utils = { ...saved.utils, fromUuidSync: uuid => ({ "Actor.cp1": kael, "Actor.cp2": mara })[uuid] ?? null };
  game.settings = { get: (scope, key) => ((key === "squad") ? [] : saved.settings?.get?.(scope, key)), set: async () => null };
  let asked = null;
  api.DialogV2.input = async options => { asked = options; return { place: "megacity", who: { cp1: true, cp2: true } }; };
  await cp.openCheckpoint();
  const card = cards.at(-1);
  const cardDoc = new JSDOM(card?.content ?? "").window.document;
  check("checkpoint: the GM picks the place and who goes through (every player's operative, with no squad set)",
    /Megacity, 25% of capacity/.test(asked?.content ?? "") && /name="who\.cp1" checked/.test(asked.content) && /name="who\.cp2" checked/.test(asked.content));
  check("checkpoint: the card says who is through and who is caught, by how much, with Surrender items for the caught",
    (card.flags.irop.checkpoint.place === "megacity") && /Megacity: 25% of capacity/.test(cardDoc.querySelector(".card-sub").textContent)
      && (cardDoc.querySelector(".checkpoint-row.caught strong").textContent === "Kael") && /Showing 13.5 of 10 allowed: 3.5 over/.test(cardDoc.querySelector(".checkpoint-row.caught").textContent)
      && (cardDoc.querySelector(".checkpoint-row.pass strong").textContent === "Mara") && !cardDoc.querySelector(".checkpoint-row.pass [data-irop-action]")
      && (cardDoc.querySelector('.checkpoint-row.caught [data-irop-action="checkpointSurrender"]')?.dataset.actorUuid === "Actor.cp1"), card?.content);
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  notes.length = 0;
  await cp.openCheckpoint();
  check("checkpoint: players cannot run one", /GM's to run/.test(notes.at(-1) ?? ""));

  // The card in chat: Surrender items for the caught one's player.
  const message = { id: "cpm", isAuthor: false, flags: structuredClone(card.flags), content: card.content };
  message.update = async d => { message.content = d.content; message.flags.irop.checkpoint = d["flags.irop.checkpoint"]; return message; };
  game.messages = { get: id => ((id === "cpm") ? message : null) };
  const shownCard = new JSDOM(`<div>${card.content}</div>`).window.document;
  onRenderChatMessage(message, shownCard.body);
  check("checkpoint: in chat, the caught one's player can press Surrender items",
    !shownCard.querySelector('[data-irop-action="checkpointSurrender"]').disabled);

  // The surrender dialog: what can go, and a running count against what is over.
  cp.registerConcealmentActions();
  const emitted = [];
  game.socket = { emit: (channel, data) => emitted.push(data) };
  game.users = { activeGM: { id: "gm" } };
  let surrenderDialog = null;
  api.DialogV2.input = async options => { surrenderDialog = options; return { give: { rifle: true, grenades: "1" } }; };
  await cp.surrenderAtCheckpoint(message, "Actor.cp1");
  const sd = new JSDOM(`<div>${surrenderDialog?.content ?? ""}</div>`).window.document;
  check("checkpoint: the player picks what to hand over from what shows, a stack by how many, told how far over they are",
    ([...sd.querySelectorAll(".surrender-name")].map(n => n.textContent).join() === "T2 Rifle,Medium Vest,Frag Grenade")
      && !!sd.querySelector('input[type="checkbox"][name="give.rifle"]') && (sd.querySelector('input[type="number"][name="give.grenades"]')?.getAttribute("max") === "3")
      && /3.5 over/.test(sd.querySelector(".lede").textContent) && /gone/.test(sd.querySelector(".lede").textContent));
  check("checkpoint: a player's hand over goes to the GM's client, who holds the card",
    (emitted.length === 1) && (emitted[0].action === "checkpointSurrender") && (emitted[0].payload.actorUuid === "Actor.cp1")
      && (JSON.stringify(emitted[0].payload.give) === JSON.stringify({ rifle: 1, grenades: 1 })) && !owned.length, JSON.stringify(emitted));
  cp.wireSurrender(sd.body);
  const sum = sd.querySelector(".surrender-sum");
  sd.querySelector('input[name="give.grenades"]').value = "2";
  sd.querySelector('input[name="give.grenades"]').dispatchEvent(new sd.defaultView.Event("input", { bubbles: true }));
  const partway = sum.textContent;
  sd.querySelector('input[name="give.rifle"]').checked = true;
  sd.querySelector('input[name="give.rifle"]').dispatchEvent(new sd.defaultView.Event("change", { bubbles: true }));
  check("checkpoint: the dialog keeps count, still caught until enough is picked",
    (partway === "Handing over 2. Still caught, 1.5 over.") && (sum.textContent === "Handing over 6.5. Through.") && sum.classList.contains("through"), partway);

  // On the GM's client: the items go, the card is written again.
  const other = await cp.performSurrender({ messageId: "cpm", actorUuid: "Actor.cp1", give: { rifle: 1 } }, { id: "p2", isGM: false, name: "Mara's player" });
  check("checkpoint: only the operative's player or the GM hands over their things", /cannot hand over Kael's things/.test(other.error ?? ""));
  const done = await cp.performSurrender({ messageId: "cpm", actorUuid: "Actor.cp1", give: { rifle: 1, grenades: 1 } }, { id: "p1", isGM: false, name: "Johnald" });
  const after = new JSDOM(message.content).window.document;
  const kaelRow = message.flags.irop.checkpoint.results.find(r => r.actorUuid === "Actor.cp1");
  check("checkpoint: handed over, the rifle goes with its scope, one grenade of three, and the card says through",
    !done.error && !kael.items.get("rifle") && !kael.items.get("scope") && (kael.items.get("grenades").system.quantity === 2)
      && kaelRow.pass && (kaelRow.visible === 8) && (JSON.stringify(kaelRow.surrendered) === JSON.stringify(["T2 Rifle", "1 x Frag Grenade"]))
      && /Through, after handing over/.test(after.querySelector(".checkpoint-row.pass")?.textContent ?? "")
      && /Handed over: T2 Rifle, 1 x Frag Grenade/.test(after.body.textContent) && !after.querySelector('[data-irop-action="checkpointSurrender"]'), JSON.stringify(kaelRow));

  // The GM's button, in the Actors sidebar.
  const sidebar = new JSDOM('<section><div class="header-actions"></div></section>').window.document;
  game.user = { id: "p1", isGM: false, name: "Johnald" };
  cp.addCheckpointButton({}, sidebar.querySelector("section"));
  const playerSees = !!sidebar.querySelector(".irop-checkpoint-button");
  game.user = { id: "gm", isGM: true, name: "GM" };
  cp.addCheckpointButton({}, sidebar.querySelector("section"));
  check("checkpoint: the GM has a Checkpoint button in the Actors sidebar; players do not",
    !playerSees && /Checkpoint/.test(sidebar.querySelector(".irop-checkpoint-button")?.textContent ?? ""));

  api.DialogV2.input = saved.input;
  Object.assign(game, { user: saved.user, actors: saved.actors, messages: saved.messages, socket: saved.socket, users: saved.users, settings: saved.settings });
  globalThis.ui = saved.ui;
  globalThis.ChatMessage = saved.chat;
  foundry.utils = saved.utils;
}

// Foundry 14 alone (2026-10-11): rolls post with its message modes, effects keep their changes under system.
{
  const rollsMod = await import("../module/rolls.mjs");
  const effects = await import("../module/rules/effects.mjs");
  const savedConfig = globalThis.CONFIG;
  const savedSettings = game.settings;
  globalThis.CONFIG = { ...(savedConfig ?? {}), ChatMessage: { modes: { public: { label: "Public" }, gm: { label: "Private GM" }, blind: { label: "Blind GM" }, self: { label: "Self" } } } };
  game.settings = { get: (scope, key) => { if ( (scope === "core") && (key === "messageMode") ) return "gm"; throw new Error("no such setting"); } };
  const modes = rollsMod.messageModeChoices();
  check("rolls: the roll window offers Foundry's message modes, the user's last one picked",
    (modes.options.map(o => o.value).join() === "public,gm,blind,self") && (modes.options[1].label === "Private GM") && (modes.current === "gm"));
  game.settings = { get: () => { throw new Error("no such setting"); } };
  check("rolls: with no message mode saved yet, the first", rollsMod.messageModeChoices().current === "public");
  check("rolls: a chosen mode goes to the message as messageMode; none chosen, nothing",
    (JSON.stringify(rollsMod.messageOptions("gm")) === '{"messageMode":"gm"}') && (JSON.stringify(rollsMod.messageOptions("")) === "{}"));
  check("effects: changes are read from under system, and none is an empty list",
    (effects.effectChanges({ system: { changes: [{ key: "system.vitals.hp.bonus", type: "add", value: "2" }] } }).length === 1)
      && (effects.effectChanges({ changes: [{ key: "k" }] }).length === 0) && (effects.effectChanges(null).length === 0));
  check("effects: a change reads as its key without system, then its value",
    effects.describeChange({ key: "system.vitals.hp.bonus", type: "add", value: 2 }) === "vitals.hp.bonus 2");
  // The data the system carries is all in Foundry 14's shape: the imported abilities and the test kit.
  const abilityData = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/data/sandbox-abilities.json"), "utf8"));
  const kitLine = fs.readFileSync(path.join(ROOT, "dev/test-kit-macro.js"), "utf8").split("\n").find(l => l.startsWith("const KIT = "));
  const kit = JSON.parse(kitLine.slice("const KIT = ".length).replace(/;\s*$/, ""));
  const allEffects = [...abilityData.flatMap(a => a.effects ?? []), ...Object.values(kit).flat().flatMap(i => i?.effects ?? [])];
  check("effects: every effect the system ships has its changes under system, each with a type, none with an old numeric mode",
    (allEffects.length >= 36) && allEffects.every(e => !("changes" in e) && Array.isArray(e.system?.changes) && e.system.changes.length
      && e.system.changes.every(c => (typeof c.type === "string") && !("mode" in c))), String(allEffects.length));
  check("system: Foundry 14 and up", JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8")).compatibility.minimum === "14"
    && !fs.existsSync(path.join(ROOT, "module/compat.mjs")));
  globalThis.CONFIG = savedConfig;
  game.settings = savedSettings;
}

// The turn order ribbon (Johnald, 2026-10-11): the cards each viewer sees, the controls, the settings.
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  const { TurnRibbon, ribbonContext, cardFor, portraitFor, statusesFor } = await import("../module/apps/turn-ribbon.mjs");
  const SHOW = CONST.ACTIVE_EFFECT_SHOW_ICON;
  const player = { id: "p1", isGM: false };
  const gm = { id: "gm", isGM: true };
  const effect = (name, img, more = {}) => ({ name, img, showIcon: SHOW.ALWAYS, isTemporary: false, flags: {}, ...more });
  const actor = (type, system, { img = "art/portrait.webp", effects = [], observers = [] } = {}) => ({
    type, img, system, appliedEffects: effects,
    testUserPermission: (user, level) => user.isGM || observers.includes(user.id)
  });
  const vit = (hp, armor = [0, 0], barrier = [0, 0], dodges = [1, 1]) => ({ hp: { value: hp[0], max: hp[1] },
    armor: { value: armor[0], max: armor[1] }, barrier: { value: barrier[0], max: barrier[1] },
    energy: { value: 9, max: 9 }, dodges: { value: dodges[0], max: dodges[1] } });
  const combatant = (id, name, a, { disposition = 1, initiative = 10, owner = false, hidden = false, defeated = false, tokenImg = "tokens/t.webp" } = {}) => ({
    id, name, actor: a, initiative, isOwner: owner, hidden, isDefeated: defeated, img: null,
    get visible() { return this.isOwner || !this.hidden; },
    token: { disposition, texture: { src: tokenImg } }
  });
  const wraith = combatant("wraith", "Wraith", actor("operative", { vitals: vit([14, 18], [6, 8], [0, 4], [1, 2]), accent: "#d64f4f", roleKey: "outrider" },
    { effects: [effect("Ignited (1)", "icons/svg/fire.svg", { flags: { irop: { counter: 1 } } }),
      effect("Strong Back", "icons/perk.svg", { showIcon: SHOW.CONDITIONAL }), effect("Hidden aura", "icons/aura.svg", { showIcon: SHOW.NEVER })] }),
    { initiative: 21, owner: true });
  const enforcer = combatant("enforcer", "Enforcer", actor("npc", { vitals: vit([12, 30], [4, 6]), details: { faction: "" } },
    { effects: [effect("Pinned", "icons/svg/net.svg")] }), { disposition: -1, initiative: 18 });
  const sniper = combatant("sniper", "Sniper", actor("npc", { vitals: vit([20, 20]), details: { faction: "GENESIS" } }), { disposition: -1, initiative: 16, hidden: true });
  const bastion = combatant("bastion", "Bastion", actor("operative", { vitals: vit([22, 24], [10, 10], [5, 5], [0, 1]), accent: "#4a90d9", roleKey: "warmachine" },
    { img: "icons/svg/mystery-man.svg" }), { initiative: 15, tokenImg: "tokens/bastion.webp" });
  const drone = combatant("drone", "Hound drone", actor("npc", { vitals: vit([0, 10]) }), { disposition: -1, initiative: 7, defeated: true });
  const rookie = combatant("rookie", "Rookie", actor("operative", { vitals: vit([12, 12]), accent: null, roleKey: null }), { initiative: null, owner: true });
  const turns = [wraith, enforcer, sniper, bastion, drone, rookie];
  const combat = (current, { round = 2 } = {}) => ({
    turns, round, started: round > 0,
    combatant: turns.find(c => c.id === current) ?? null,
    // Foundry's next, skipping the defeated.
    get nextCombatant() {
      const at = turns.findIndex(c => c.id === current);
      for ( let i = 1; i <= turns.length; i++ ) { const c = turns[(at + i) % turns.length]; if ( !c.isDefeated ) return c; }
      return null;
    }
  });
  const draw = (ctx) => new JSDOM(tpl("templates/apps/turn-ribbon.hbs")(ctx)).window.document;

  // A player's view, Bastion acting, the line turning.
  let doc = draw(ribbonContext(combat("bastion"), player, "actingFirst"));
  const cardIds = d => [...d.querySelectorAll(".rb-line > *")].map(el => el.classList.contains("rb-marker") ? "|" : el.dataset.combatantId).join(" ");
  check("ribbon card: compiles to one strip, the round first, the acting card leading the line",
    doc.body.children.length === 1 && !!doc.querySelector(".rb-strip > .rb-round + .rb-more.left + .rb-line") && (cardIds(doc) === "bastion rookie | wraith enforcer drone"), cardIds(doc));
  const active = doc.querySelector(".rb-card.active");
  check("ribbon card: the acting card has the large portrait, its name, its doctrine and its numbers in full",
    active?.dataset.combatantId === "bastion" && (active.querySelector(".rb-portrait img")?.getAttribute("src") === "tokens/bastion.webp")
      && /Acting/.test(active.querySelector(".rb-tag")?.textContent) && /Init 15/.test(active.textContent)
      && (active.querySelector(".rb-name")?.textContent === "Bastion") && (active.querySelector(".rb-label")?.textContent === "Warmachine")
      && ([...active.querySelectorAll(".rb-vl")].map(v => v.textContent.replace(/\s+/g, "")).join() === "H22/24,A10/10,B5/5")
      && /--rb-edge: #4a90d9/.test(active.getAttribute("style")) && (active.querySelectorAll(".rb-pip").length === 1) && !active.querySelector(".rb-pip.full"));
  check("ribbon card: a player who does not own the acting combatant has no End turn; nor the round controls, nor End combat",
    !doc.querySelector('[data-action="endTurn"]') && !doc.querySelector(".rb-gm") && !doc.querySelector('[data-action="endCombat"]'));
  check("ribbon: a tab at each end of the line, hidden until cards are out of sight that way",
    !!doc.querySelector('.rb-strip > .rb-more.left[data-action="scrollMore"][hidden] + .rb-line')
      && !!doc.querySelector('.rb-line + .rb-more.right[data-action="scrollMore"][data-dir="right"][hidden] .rb-more-n'));
  const enf = doc.querySelector('[data-combatant-id="enforcer"]');
  check("ribbon card: a player reads a hostile's condition in a word, not its numbers, in GENESIS red",
    enf.classList.contains("side-hostile") && (enf.querySelector(".rb-condition")?.textContent === "Wounded") && !enf.querySelector(".rb-bar, .rb-pip")
      && /--rb-edge: #c4121c/.test(enf.getAttribute("style")) && (enf.querySelector(".rb-status")?.dataset.tooltip === "Pinned"));
  check("ribbon card: the hidden sniper is not there for a player; the defeated drone is a stub",
    !doc.querySelector('[data-combatant-id="sniper"]') && doc.querySelector('[data-combatant-id="drone"]').classList.contains("down"));
  const wr = doc.querySelector('[data-combatant-id="wraith"]');
  check("ribbon card: a waiting operative shows its Health line, dodges and the statuses its token shows, with X",
    (wr.querySelector(".rb-bar.hp i")?.getAttribute("style") === "width: 78%") && (wr.querySelectorAll(".rb-pip").length === 2)
      && (wr.querySelectorAll(".rb-pip.full").length === 1) && (wr.querySelectorAll(".rb-status").length === 1)
      && (wr.querySelector(".rb-status b")?.textContent === "1") && (wr.querySelector(".rb-status")?.dataset.tooltip === "Ignited (1)"));
  const rk = doc.querySelector('[data-combatant-id="rookie"]');
  check("ribbon card: next is marked; an owner with no initiative rolls from the card; no doctrine is ODR sky",
    rk.classList.contains("next") && /Next/.test(rk.querySelector(".rb-init")?.textContent ?? "") && /--rb-edge: #42abf2/.test(rk.getAttribute("style")));
  // Johnald, 2026-10-11: players roll initiative from the ribbon if they want, wherever their card is in line.
  check("ribbon card: next and not yet rolled, the owner has both Next and Roll, Roll in the bottom right corner",
    !!rk.querySelector('.rb-foot > [data-action="rollInitiative"]:last-child') && /Roll/.test(rk.querySelector(".rb-roll")?.textContent ?? ""));
  const actingUnrolled = draw(ribbonContext(combat("rookie"), player, "actingFirst")).querySelector(".rb-card.active");
  check("ribbon card: acting without an initiative, its owner rolls from the acting card's bottom row, before End turn",
    actingUnrolled?.dataset.combatantId === "rookie" && !!actingUnrolled.querySelector('.rb-foot > .rb-roll + .rb-end') && !actingUnrolled.querySelector('.rb-top [data-action="rollInitiative"]') && !/Init/.test(actingUnrolled.querySelector(".rb-top")?.textContent ?? ""));
  const stranger = cardFor(combatant("x1", "Stranger", actor("npc", { vitals: vit([5, 5]) }), { initiative: null, owner: false }), player);
  const mine = cardFor(combatant("x2", "Mine", actor("operative", { vitals: vit([5, 5]) }), { initiative: null, owner: true }), player);
  check("ribbon card: Roll only on a card the viewer owns, and only before it has an initiative",
    !stranger.canRoll && mine.canRoll && !cardFor(combatant("x3", "Done", actor("operative", { vitals: vit([5, 5]) }), { initiative: 0, owner: true }), player).canRoll);
  check("ribbon: the round, and the acting card's place among those standing",
    (doc.querySelector(".rb-round-n")?.textContent === "2") && /1 of 4/.test(doc.querySelector(".rb-count")?.textContent ?? ""),
    doc.querySelector(".rb-count")?.textContent);

  // The owner's own turn: End turn. Rookie has no initiative yet: a Roll button, when it is not next.
  doc = draw(ribbonContext(combat("wraith"), player, "fixed"));
  check("ribbon card: the acting combatant's owner can end the turn from the card",
    !!doc.querySelector('.rb-card.active[data-combatant-id="wraith"] [data-action="endTurn"]'));
  check("ribbon, fixed order: the line keeps initiative order", cardIds(doc) === "wraith enforcer bastion drone rookie", cardIds(doc));
  check("ribbon card: an owner rolls initiative from a card that has none",
    !!doc.querySelector('[data-combatant-id="rookie"] [data-action="rollInitiative"]'));

  // The GM sees everything: the hidden sniper marked, the hostile's numbers, the round controls.
  doc = draw(ribbonContext(combat("enforcer"), gm, "fixed"));
  const sn = doc.querySelector('[data-combatant-id="sniper"]');
  const en = doc.querySelector('[data-combatant-id="enforcer"]');
  check("ribbon card: the GM sees the hidden sniper, faded and marked, and next",
    sn?.classList.contains("rb-hidden") && !!sn.querySelector(".rb-hidden-mark") && sn.classList.contains("next") && (sn.querySelector(".rb-condition") === null));
  check("ribbon card: the GM reads a hostile's numbers, its faction or Hostile beneath its name, and can end its turn",
    [...en.querySelectorAll(".rb-vl")].map(v => v.textContent.replace(/\s+/g, "")).join() === "H12/30,A4/6" && (en.querySelector(".rb-label")?.textContent === "Hostile")
      && !!en.querySelector('[data-action="endTurn"]'));
  check("ribbon: the GM has previous and next turn on the round, and End combat (Johnald, 2026-10-11)",
    !!doc.querySelector('.rb-gm [data-action="previousTurn"]') && !!doc.querySelector('.rb-gm [data-action="nextTurn"]') && !doc.querySelector('[data-action="beginCombat"]')
      && /End combat/.test(doc.querySelector('.rb-round [data-action="endCombat"]')?.textContent ?? ""));
  check("ribbon, fixed order: those who have acted are dimmed", doc.querySelector('[data-combatant-id="wraith"]').classList.contains("acted")
    && !doc.querySelector('[data-combatant-id="bastion"]').classList.contains("acted"));

  // Before it starts.
  doc = draw(ribbonContext(combat(null, { round: 0 }), gm, "actingFirst"));
  check("ribbon: before the fight, Ready, how many are in it, and the GM's Begin",
    /Ready/.test(doc.querySelector(".rb-round")?.textContent ?? "") && (doc.querySelector(".rb-round-n")?.textContent === "5")
      && !!doc.querySelector('[data-action="beginCombat"]') && !!doc.querySelector('[data-action="endCombat"]') && !doc.querySelector(".rb-card.active")
      && doc.querySelector('[data-combatant-id="wraith"]').classList.contains("next"));

  // Pieces.
  check("ribbon: the portrait is the actor's art, or the token's when the actor has Foundry's blank figure",
    (portraitFor(wraith) === "art/portrait.webp") && (portraitFor(bastion) === "tokens/bastion.webp"));
  check("ribbon: statuses as the token shows them: always, or temporary ones set to show while temporary",
    statusesFor(wraith.actor).map(s => s.name).join() === "Ignited (1)"
      && statusesFor({ appliedEffects: [effect("Stunned", "s.svg", { showIcon: SHOW.CONDITIONAL, isTemporary: true })] }).length === 1);
  check("ribbon: an observer of an NPC reads its numbers", cardFor(enforcer, { id: "p2", isGM: false }).numbers === false
    && cardFor(combatant("e2", "Guard", actor("npc", { vitals: vit([5, 5]) }, { observers: ["p2"] })), { id: "p2", isGM: false }).numbers === true);
  check("ribbon: nothing to show with no combat, or none a player may see",
    (ribbonContext(null, player) === null) && (ribbonContext({ turns: [sniper], round: 1, started: true, combatant: sniper, nextCombatant: sniper }, player) === null));

  // The window: frameless, in Foundry's top area, its actions; the settings.
  const o = TurnRibbon.DEFAULT_OPTIONS;
  check("ribbon window: frameless, with its actions and template",
    (o.id === "irop-turn-ribbon") && (o.window.frame === false) && ["endTurn", "previousTurn", "nextTurn", "beginCombat", "endCombat", "rollInitiative", "scrollMore"].every(a => a in o.actions)
      && fs.existsSync(path.join(ROOT, TurnRibbon.PARTS.body.template.replace("systems/irop/", ""))));
  const { registerSettings } = await import("../module/settings.mjs");
  const registered = {};
  const oldSettings = game.settings;
  game.settings = { register: (ns, key, data) => { registered[key] = data; } };
  registerSettings();
  game.settings = oldSettings;
  check("ribbon settings: each person shows it or not; the GM picks the order, acting first by default",
    (registered.turnRibbonShown?.scope === "client") && registered.turnRibbonShown.config && (registered.turnRibbonShown.default === true)
      && (registered.turnRibbonOrder?.scope === "world") && (registered.turnRibbonOrder.default === "actingFirst")
      && (Object.keys(registered.turnRibbonOrder.choices).join() === "actingFirst,fixed"));
  const css = fs.readFileSync(path.join(ROOT, "styles/irop.css"), "utf8");
  check("ribbon styles: no class Foundry hides (.hidden), and buttons free of core's fixed height",
    !/\.rb-card\.hidden\b/.test(css) && /\.irop-turn-ribbon button \{[^}]*height: auto;[^}]*min-height: 0;/.test(css));
}

// The turn marker (Johnald, 2026-10-11): the segmented bezel with ACTING in its gaps, white for Foundry to tint by side.
{
  const markerPath = path.join(ROOT, IROP.turnMarker.replace("systems/irop/", ""));
  const svg = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8") : "";
  const mdoc = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;
  const glyphs = mdoc.querySelectorAll("g[transform^='rotate'] > path");
  check("turn marker: the image is there, drawn in white, with the word as strokes not text (no web font reaches an image)",
    !!svg && !mdoc.querySelector("text") && (glyphs.length === 18)
      && [...mdoc.querySelectorAll("[stroke]")].every(el => el.getAttribute("stroke") === "#fff")
      && (mdoc.documentElement.getAttribute("viewBox") === "-100 -100 200 200"));
  const bezel = mdoc.querySelector("circle[stroke-dasharray][transform]");
  const [dash, gap] = (bezel?.getAttribute("stroke-dasharray") ?? "").split(" ").map(Number);
  const r = Number(bezel?.getAttribute("r"));
  check("turn marker: three arcs and three gaps around the bezel, just outside the token's edge (radius 66.7 of 100)",
    Math.abs(3 * (dash + gap) - (2 * Math.PI * r)) < 0.1 && (r - (Number(bezel.getAttribute("stroke-width")) / 2) > 66.7));
  const entry = fs.readFileSync(path.join(ROOT, "module/irop.mjs"), "utf8");
  check("turn marker: Foundry's fallback marker, and the sides' colors the ribbon's own",
    /CONFIG\.Combat\.fallbackTurnMarker = IROP\.turnMarker;/.test(entry)
      && /PARTY: sideColor\("operative"\), FRIENDLY: sideColor\("ally"\), NEUTRAL: sideColor\("neutral"\), HOSTILE: sideColor\("hostile"\)/.test(entry)
      && (IROP.turnOrder.sides.hostile.color === "#c4121c") && (IROP.turnOrder.sides.operative.color === "#42abf2"));
}

// The turn marker in the sides' colors (bug fix, Johnald, 2026-10-11: with Disposition Tint ticked it stayed white).
{
  const tm = await import("../module/canvas/turn-marker.mjs");
  const savedConfig = globalThis.CONFIG;
  const savedCanvas = globalThis.canvas;
  const shared = { src: "", disposition: true };
  globalThis.CONFIG = { ...(savedConfig ?? {}), Combat: { settings: { turnMarker: shared }, fallbackTurnMarker: IROP.turnMarker } };
  const token = (color, own = { mode: 1, src: null, disposition: false }) => ({
    document: { turnMarker: own }, getDispositionColor: () => color,
    turnMarker: { mesh: { destroyed: false, tint: 0xFFFFFF } }
  });
  const hostile = token(0xc4121c);
  const operative = token(0x42abf2);
  const added = [];
  globalThis.canvas = { tokens: { turnMarkers: new Set([hostile, operative]) }, app: { ticker: { add: fn => added.push(fn), remove: fn => { const i = added.indexOf(fn); if ( i >= 0 ) added.splice(i, 1); } } } };
  tm.syncTurnMarkerTints();
  check("turn marker color: with Disposition Tint on, each marker takes its side's exact color",
    (hostile.turnMarker.mesh.tint === 0xc4121c) && (operative.turnMarker.mesh.tint === 0x42abf2));
  shared.disposition = false;
  tm.syncTurnMarkerTints();
  check("turn marker color: turned off, back to white at once", (hostile.turnMarker.mesh.tint === 0xFFFFFF) && (operative.turnMarker.mesh.tint === 0xFFFFFF));
  const custom = token(0xb9c4c8, { mode: 2, src: null, disposition: true });
  canvas.tokens.turnMarkers.add(custom);
  tm.syncTurnMarkerTints();
  check("turn marker color: a token set to custom with its own Disposition Tint follows its own setting", custom.turnMarker.mesh.tint === 0xb9c4c8);
  shared.disposition = true;
  shared.src = "worlds/x/my-marker.webp";
  const theirs = token(0x42abf2);
  theirs.turnMarker.mesh.tint = 0x123456;
  canvas.tokens.turnMarkers.add(theirs);
  tm.syncTurnMarkerTints();
  check("turn marker color: an image the GM set is left as Foundry draws it", theirs.turnMarker.mesh.tint === 0x123456);
  check("turn marker source: the token's own when custom, the GM's, else the fallback",
    (tm.markerSource({ turnMarker: { mode: 2, src: null } }) === IROP.turnMarker) && (tm.markerSource({ turnMarker: { mode: 2, src: "t.webp" } }) === "t.webp")
      && (tm.markerSource({ turnMarker: { mode: 1, src: "t.webp" } }) === "worlds/x/my-marker.webp"));
  const gone = token(0xc4121c);
  gone.turnMarker.mesh = { destroyed: true, tint: 0xFFFFFF };
  canvas.tokens.turnMarkers.add(gone);
  tm.syncTurnMarkerTints();
  check("turn marker color: a mesh already gone is not touched", gone.turnMarker.mesh.tint === 0xFFFFFF);
  tm.watchTurnMarkers();
  tm.watchTurnMarkers();
  check("turn marker color: it runs each frame, once however many scenes are drawn", (added.length === 1) && (added[0] === tm.syncTurnMarkerTints));
  globalThis.CONFIG = savedConfig;
  globalThis.canvas = savedCanvas;
}

// Background perks' numbers (Johnald, 2026-10-11): the fields their effects raise, and where they show.
{
  const { concealmentLine } = await import("../module/sheets/actor-sheet.mjs");
  const b = operative.system.bonuses;
  check("perk fields: every operative has the Strategy Layer bonuses and the per place concealment, all at 0",
    (b.strategy.mission.logistics === 0) && (b.strategy.mission.intel === 0) && (b.strategy.mission.reputation.megacity === 0)
      && (b.strategy.mission.reputation.rural === 0) && (b.strategy.perRank.research.technology === 0) && (b.strategy.perRank.intelligence.deception === 0)
      && (b.strategy.laborToughness === 0) && (b.strategy.intelMegacity === 0) && (b.concealmentAt.megacity === 0)
      && (operative.system.concealment.bonusAt.megacity === 0) && (operative.system.concealment.bonusAt.slums === 0));
  const line = concealmentLine({ visible: 14, hidden: 0, capacity: 40, bonus: 10, bonusAt: { megacity: 5 }, speciesBonus: 10, species: "Human" });
  check("perk fields: the Concealment tooltip says a bonus at one place applies there only",
    /Megacity allow 16 \(40%: 25% \+10% as a Human, \+5% here from effects\): passes/.test(line.tip) && /Slums allow 24 \(60%: 50% \+10% as a Human\): passes/.test(line.tip), line.tip);
  const card = new JSDOM(tpl("templates/chat/mission-debrief.hbs")({ label: "Scavenge", territory: "Neo Seattle", outcomeLabel: "Success", week: 3,
    perks: ["Kael (Supply Run): +10 Logistics", "Vale (Wake Them Up): +1 Reputation"] })).window.document;
  check("perk fields: the debrief card lists what each operative's perks brought back",
    [...card.querySelectorAll(".perk-line")].map(li => li.textContent).join(" | ") === "Kael (Supply Run): +10 Logistics | Vale (Wake Them Up): +1 Reputation");
  const dialog = new JSDOM(tpl("templates/dialog/debrief.hbs")({ label: "Scavenge", territory: "Neo Seattle", defaults: {}, outcomes: {}, heatClasses: {}, reputationSteps: {},
    perks: ["Kael (Supply Run): +10 Logistics"] })).window.document;
  const none = new JSDOM(tpl("templates/dialog/debrief.hbs")({ label: "Scavenge", territory: "Neo Seattle", defaults: {}, outcomes: {}, heatClasses: {}, reputationSteps: {}, perks: [] })).window.document;
  check("perk fields: the debrief dialog says what the perks will add on a success, and says nothing with none",
    /On a success, background perks add/.test(dialog.querySelector(".debrief-perks")?.textContent ?? "") && /Supply Run/.test(dialog.body.textContent) && !none.querySelector(".debrief-perks"));
}

// Hover previews (Johnald, 2026-10-16): a portrait or token's picture full size in the lower left.
{
  const hp = await import("../module/hover-preview.mjs");
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const player = { id: "p1", isGM: false };
  const actor = (img, may) => ({ img, name: "Wraith", testUserPermission: () => may });
  const token = (a, src = "tokens/wraith.webp") => ({ actor: a, document: { name: "Wraith", texture: { src } } });
  check("hover preview: a token shows its actor's portrait to whoever may see the actor, with its name",
    eq(hp.tokenPreview(token(actor("art/wraith-hd.webp", true)), player), { src: "art/wraith-hd.webp", name: "Wraith" }));
  check("hover preview: an actor kept from the player shows only the token's own art, unnamed; a blank portrait falls back too",
    eq(hp.tokenPreview(token(actor("art/secret.webp", false)), player), { src: "tokens/wraith.webp", name: "" })
      && (hp.tokenPreview(token(actor("icons/svg/mystery-man.svg", true)), player).src === "tokens/wraith.webp")
      && (hp.tokenPreview(token(null, ""), player) === null));
  const win = new JSDOM("<body><div class=\"adjusting\"><img id=\"framing\" src=\"b.webp\" data-irop-preview></div><img id=\"p\" src=\"a.webp\" alt=\"Ghost\" data-irop-preview><img id=\"icon\" src=\"i.webp\"></body>").window;
  const keep = { document: globalThis.document, Hooks: globalThis.Hooks, setTimeout: globalThis.setTimeout };
  const hooks = {};
  globalThis.document = win.document;
  globalThis.Hooks = { on: (name, fn) => { hooks[name] = fn; } };
  globalThis.setTimeout = fn => { fn(); return 0; };
  hp.registerHoverPreview();
  const over = (el, from = null) => el.dispatchEvent(new win.MouseEvent("pointerover", { bubbles: true, relatedTarget: from }));
  over(win.document.getElementById("p"));
  const panel = win.document.getElementById("irop-hover-preview");
  check("hover preview: resting on an opted in picture shows it full size with its name",
    panel?.classList.contains("on") && /a\.webp$/.test(panel.querySelector("img").src) && panel.querySelector("figcaption").textContent === "Ghost");
  win.document.getElementById("p").dispatchEvent(new win.MouseEvent("pointerout", { bubbles: true }));
  check("hover preview: moving off hides it", !panel.classList.contains("on"));
  over(win.document.getElementById("icon"));
  over(win.document.getElementById("framing"));
  check("hover preview: item icons and a photo being framed show nothing", !panel.classList.contains("on"));
  hooks.hoverToken(token(actor("art/wraith-hd.webp", true)), true);
  check("hover preview: hovering a token shows it; leaving hides it",
    panel.classList.contains("on") && /wraith-hd/.test(panel.querySelector("img").src) && (hooks.hoverToken(null, false), !panel.classList.contains("on")));
  Object.assign(globalThis, keep);
  check("hover preview: the sheet portrait, record photo and store picture opt in",
    [["templates/actor/header.hbs", 'class="portrait"'], ["templates/actor/record.hbs", 'class="record-portrait"'], ["templates/actor/store.hbs", 'class="store-img"']]
      .every(([f, c]) => new RegExp(`<img ${c}[^>]*data-irop-preview`).test(fs.readFileSync(path.join(ROOT, f), "utf8"))));
}

// The enlistment terminal (Johnald, 2026-10-12, mockup A): every step rendered, the picks, and the operative made.
{
  foundry.applications.api.ApplicationV2 ??= class { constructor(options = {}) { this.options = options; } render() { return this; } };
  const { EnlistmentApp, enlistmentItems, createOperative, registerEnlistment, addEnlistButton, mutationTables, enlistmentStores } = await import("../module/apps/enlistment.mjs");
  const oldActors = game.actors;
  const oldUser = game.user;
  const oldUsers = game.users;
  const oldItems = game.items;
  const oldUi = globalThis.ui;
  const oldActor = globalThis.Actor;
  const oldSocket = game.socket;
  const oldUtils = foundry.utils;
  const said = [];
  globalThis.ui = { notifications: { warn: m => said.push(m), info: m => said.push(m) } };
  const mk = (id, name, type, system, img = `${id}.webp`) => {
    const d = new FakeDoc({});
    Object.assign(d, { id, name, type, img, uuid: `Item.${id}`, flags: {} });
    d.system = new ({ ...MODELS, skillTree: itemModels.SkillTreeData })[type](system, { parent: d });
    d.toObject = () => ({ _id: id, name, type, img, folder: null, system: d.system.toObject(), flags: {} });
    return d;
  };
  const world = [
    mk("hu", "Human", "species", { health: 8, energy: 10, boons: true, description: "<p>Earth's own. Adaptable above all.</p>" }),
    mk("mu", "Mutant", "species", { health: 10, energy: 6, mutations: true, attributes: { str: 35, agi: 35, tgh: 40, cha: 45, lck: 20, int: 40, per: 35 } }),
    mk("ge", "GENESIS", "species", { playable: false }),
    mk("lg", "Legionary", "role", { role: "legionary", startingSkills: "Awareness, Investigate or Athletics" }),
    mk("mr", "Marauder", "role", { role: "marauder", startingSkills: "Awareness, Athletics or Survivalism", weaponSpecialties: "Shotguns, SMGs, Shields, Axes",
      description: "<p>The Marauder doctrine did not emerge from a planning room. It emerged from a wheat field.</p>" }),
    mk("sd", "Slum Dweller", "background", { startingSkills: "Awareness, Deception, Coercion, Insight, Atheltics, Lock Picking", skillPicks: 3,
      perks: [{ id: "pk1", uuid: "Item.ab1", name: "One of Us", img: "" }, { id: "pk2", uuid: "Item.gone", name: "Lost Perk", img: "" }] }),
    mk("ab1", "One of Us", "ability", { description: "<p>Reputation in the slums rises by 2 extra points.</p>", kind: "passive" }),
    // Unticked "Offered at enlistment" (2026-10-16): kept out of the creator.
    mk("hp", "Hidden Past", "background", { enlist: false }),
    // Player mutations (2026-10-16), and the test kit's placeholder, which is never rolled.
    mk("m1", "Armored Hide", "mutation", { polarity: "positive", description: "<p>Gain +3 Defense.</p>" }),
    mk("m2", "Twin Hearts", "mutation", { polarity: "positive" }),
    mk("m3", "Iron Gut", "mutation", { polarity: "positive" }),
    mk("mt", "Positive Mutation (test)", "mutation", { polarity: "positive" }),
    mk("n1", "Frayed Focus", "mutation", { polarity: "negative" }),
    mk("n2", "Molt Cycle", "mutation", { polarity: "negative" }),
    // A Boon item for Charisma (2026-10-16); Agility has none, so one is made to the rules.
    mk("bc", "Charisma Boon", "boon", { attribute: "cha", amount: 10 }),
    mk("ow", "Old Warmachine", "role", { role: "warmachine", enlist: false }),
    // Training (2026-10-16): the Marauder's Primary tree, two tiers, the second needing Toughness 45;
    // and a specialization, which opens later and stays out of the terminal.
    mk("ab2", "Hard Charger", "ability", { kind: "passive", description: "<p>Charge through cover.</p>" }),
    mk("ab3", "Thick Hide", "ability", { kind: "passive", prerequisites: "Toughness 45", description: "<p>Shrug off the first hit.</p>" }),
    mk("tp", "Marauder Primary", "skillTree", { role: "marauder", kind: "primary", gated: true, tiers: [
      { exclusive: false, nodes: [{ id: "nhc", uuid: "Item.ab2", name: "Hard Charger", xp: 20 }] },
      { exclusive: false, nodes: [{ id: "nth", uuid: "Item.ab3", name: "Thick Hide", xp: 30 }] },
      { exclusive: false, nodes: [] },
      { exclusive: false, nodes: [{ id: "nt4", uuid: "Item.ab2", name: "Tier Four", xp: 10 }] }] }),
    mk("ab4", "Jack of All Trades", "ability", { kind: "passive" }),
    mk("tg", "Generalist", "skillTree", { role: "", kind: "general", gated: false, tiers: [
      { exclusive: false, nodes: [{ id: "ngn", uuid: "Item.ab4", name: "Jack of All Trades", xp: 10 }] }] }),
    mk("ts", "Breacher", "skillTree", { role: "marauder", kind: "specialization", gated: true, tiers: [
      { exclusive: false, nodes: [{ id: "nsp", uuid: "Item.ab2", name: "Hard Charger", xp: 10 }] }] })
  ];
  world.get = id => world.find(d => d.id === id) ?? null;
  game.items = world;
  // The client's uuid lookups, over this world (the common utils are a frozen module).
  foundry.utils = { ...oldUtils, fromUuidSync: uuid => world.find(d => d.uuid === uuid) ?? null, fromUuid: async uuid => world.find(d => d.uuid === uuid) ?? null };
  const player = { id: "p1", name: "Johnald", isGM: false, character: null, updates: [], update(d) { this.updates.push(d); return this; } };
  const gm = { id: "gm", name: "GM", isGM: true };
  const users = [gm, player];
  users.get = id => users.find(u => u.id === id);
  users.activeGM = gm;
  game.users = users;
  game.user = gm;
  const made = [];
  globalThis.Actor = { implementation: { create: async data => { made.push(data); return { id: `a${made.length}`, name: data.name, img: data.img, system: data.system, flags: data.flags }; } } };
  // Foundry's dice, on a list we choose (each u in 0 to 1); and chat, collected.
  const oldConfig = globalThis.CONFIG;
  const oldChat = globalThis.ChatMessage;
  const uniforms = [];
  globalThis.CONFIG = { ...(oldConfig ?? {}), Dice: { randomUniform: () => uniforms.shift() ?? 0.01 } };
  const posted = [];
  globalThis.ChatMessage = { implementation: { create: async m => { posted.push(m); return m; } } };
  const ACTIONS = new Set(Object.keys(EnlistmentApp.DEFAULT_OPTIONS.actions));
  const act = (app, name, dataset = {}) => EnlistmentApp.DEFAULT_OPTIONS.actions[name].call(app, {}, { dataset });
  const show = async (app, label) => inspect(`enlistment ${label}`, tpl("templates/apps/enlistment.hbs")(await app._prepareContext({})), { actions: ACTIONS, source: {} });
  const texts = (doc, sel) => [...doc.querySelectorAll(sel)].map(e => e.textContent.replace(/\s+/g, " ").trim());
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  const fromTable = mutationTables({ items: world, tables: [{ name: "Positive mutations (d20)",
    results: [{ range: [1, 10], documentUuid: "Item.m2" }, { range: [11, 20], documentUuid: "Item.m1" }, { range: [21, 21], documentUuid: "Item.gone" }] }] });
  check("enlistment: mutations roll on the world's d20 table when there, its ranges kept; otherwise on the items, placeholder left out",
    fromTable.fromTables && eq(fromTable.positive.map(r => `${r.lo}-${r.hi} ${r.name}`), ["1-10 Twin Hearts", "11-20 Armored Hide"])
      && eq(fromTable.negative.map(r => r.name), ["Frayed Focus", "Molt Cycle"]) && fromTable.ready
      && eq(mutationTables({ items: world, tables: [] }).positive.map(r => r.name), ["Armored Hide", "Iron Gut", "Twin Hearts"])
      && !mutationTables({ items: [], tables: [] }).ready);
  const app = new EnlistmentApp();
  check("enlistment: playable species, roles in doctrine order, backgrounds; none the GM took off the offer", eq(Object.fromEntries(Object.entries(enlistmentItems()).map(([k, v]) => [k, v.map(i => i.id)])),
    { species: ["hu", "mu"], roles: ["lg", "mr"], backgrounds: ["sd"] }));
  let d = await show(app, "species");
  check("enlistment: it opens on species: six steps down the rail, the first lit, the record a blank draft",
    texts(d, ".en-step .t").join() === "Species,Role,Background,Skills and perk,Training,Identity,Review" && d.querySelector(".en-step.on")?.dataset.index === "0"
      && /SELECT SPECIES|Select species/.test(d.querySelector(".en-prompt-text").textContent) && d.querySelector(".en-ds-name").textContent === "Unidentified recruit"
      && /Choose a species to see your attributes/.test(d.querySelector(".en-dossier").textContent) && !d.querySelector('[data-action="back"]'));
  check("enlistment: species cards, without the unplayable", texts(d, ".en-card .en-name").join() === "Human,Mutant" && /Takes boons/.test(d.querySelector('[data-id="hu"]').textContent));
  await act(app, "pick", { kind: "species", id: "mu" });
  d = await show(app, "species picked");
  const mutant = d.querySelector('[data-id="mu"]');
  check("enlistment: a species picked: its card lit, attributes against the baseline, the record shows its health, energy and bars",
    mutant.classList.contains("on") && mutant.querySelector(".en-stats .hi")?.textContent === "CHA45" && [...mutant.querySelectorAll(".en-stats .lo")].length === 4
      && /Health\s*10/.test(d.querySelector(".en-vitals").textContent) && d.querySelectorAll(".en-bar").length === 7 && /Carries mutations/.test(mutant.textContent));
  await act(app, "next");
  d = await show(app, "role");
  const mr = d.querySelector('[data-id="mr"]');
  check("enlistment: roles in their colors, with the free skill, the pick and the weapons; species marked done on the rail",
    mr.getAttribute("style") === "--c: #e08a3c" && mr.querySelector(".en-hex").textContent === "MR" && /Awareness, then Athletics or Survivalism/.test(mr.textContent)
      && /Shotguns, SMGs/.test(mr.textContent) && /wheat field|planning room/.test(mr.querySelector(".en-blurb").textContent)
      && d.querySelector('.en-step[data-index="0"]').classList.contains("done") && /Mutant/.test(d.querySelector('.en-step[data-index="0"] .v').textContent));
  await act(app, "pick", { kind: "role", id: "mr" });
  d = await show(app, "role picked");
  check("enlistment: a role picked colors the record", /--rc: #e08a3c/.test(d.querySelector(".en-dossier").getAttribute("style")) && /Marauder/.test(d.querySelector(".en-ds-line b").textContent));
  await act(app, "goStep", { index: "2" });
  d = await show(app, "background");
  check("enlistment: backgrounds with their skills to pick and their perks", /Skills, pick 3/.test(d.querySelector('[data-id="sd"]').textContent)
    && texts(d, '[data-id="sd"] .en-perks > span').join() === "One of Us,Lost Perk");
  await act(app, "pick", { kind: "background", id: "sd" });
  await act(app, "next");
  d = await show(app, "skills");
  check("enlistment: the skills step: the role's free skill fixed, its pick, the background's six, and its perks with their text",
    texts(d, ".en-chip.fixed").join() === "Awareness, free" && texts(d, '[data-action="roleSkill"]').join() === "Athletics,Survivalism"
      && d.querySelectorAll('[data-action="backgroundSkill"]').length === 6 && texts(d, ".en-perk-name").join() === "One of Us,Lost Perk"
      && /rises by 2 extra points/.test(d.querySelector('[data-perk="pk1"] .en-perk-text').textContent) && /missing from this world/.test(d.querySelector('[data-perk="pk2"]').textContent)
      && /Pick 1 of Marauder/.test(d.querySelector(".en-issue").textContent));
  await act(app, "roleSkill", { skill: "athletics" });
  for ( const skill of ["athletics", "deception", "insight", "coercion"] ) await act(app, "backgroundSkill", { skill });
  check("enlistment: no more background skills than it gives; a fourth is refused with a word why",
    eq(app.choices.backgroundSkills, ["athletics", "deception", "insight"]) && /gives 3\. Take one off/.test(said.at(-1) ?? ""));
  await act(app, "backgroundSkill", { skill: "deception" });
  await act(app, "backgroundSkill", { skill: "coercion" });
  await act(app, "perk", { perk: "pk1" });
  d = await show(app, "skills picked");
  check("enlistment: picks can change; the record lists the ranks, Athletics from both at 2, and the perk",
    eq(app.choices.backgroundSkills, ["athletics", "insight", "coercion"]) && /Athletics 2/.test(d.querySelector(".en-dossier").textContent)
      && /One of Us/.test(d.querySelector(".en-dossier").textContent) && !d.querySelector(".en-issue"));
  await act(app, "next");
  d = await show(app, "mutations");
  check("enlistment: a Mutant's Mutations step, after skills, with nothing rolled yet",
    texts(d, ".en-step .t").join() === "Species,Role,Background,Skills and perk,Mutations,Training,Identity,Review" && d.querySelector(".en-step.on")?.dataset.index === "4"
      && !!d.querySelector('[data-action="rollMutations"]') && /Roll your mutations/.test(d.querySelector(".en-issue")?.textContent ?? "")
      && /Mutations\s*Pending/.test(d.querySelector(".en-dossier").textContent) && /equally likely/.test(d.querySelector(".en-pane").textContent));
  // Positive die of 3 (the placeholder left out): 2, 2 again, then 3; Negative die of 2: 1.
  uniforms.push(0.5, 0.5, 0.9, 0.1);
  await act(app, "rollMutations");
  d = await show(app, "mutations rolled");
  check("enlistment: rolled: two different Positives, the duplicate rerolled, and a Negative, each shown with its roll and text",
    texts(d, ".en-mut .en-perk-name").join() === "Iron Gut,Twin Hearts,Frayed Focus" && texts(d, ".en-mut-roll").join() === "Positive 02,Positive 03,Negative 01"
      && d.querySelector(".en-mut.negative .en-perk-name")?.textContent === "Frayed Focus", texts(d, ".en-mut .en-perk-name").join());
  check("enlistment: the rolls are logged, the duplicate named, and posted to chat",
    texts(d, ".en-mut-log p").join(" | ") === "Positive 02: Iron Gut | Positive 02: Iron Gut, duplicate, rerolled | Positive 03: Twin Hearts | Negative 01: Frayed Focus"
      && /Mutations, d20/.test(posted.at(-1)?.content ?? "") && /duplicate, rerolled/.test(posted.at(-1).content), texts(d, ".en-mut-log p").join(" | "));
  check("enlistment: the record lists them; one reroll of the Negative is offered",
    /Iron Gut, Twin Hearts, Frayed Focus/.test(d.querySelector(".en-dossier").textContent) && !!d.querySelector('[data-action="rerollNegative"]')
      && !d.querySelector('[data-action="rollMutations"]') && !d.querySelector(".en-issue"));
  uniforms.push(0.9);
  await act(app, "rerollNegative");
  await act(app, "rollMutations");
  d = await show(app, "mutations rerolled");
  check("enlistment: Controlled Mutation: the Negative rerolled once, the second outcome kept, no third chance and no fresh roll",
    /Molt Cycle/.test(d.querySelector(".en-dossier").textContent) && !/Frayed Focus/.test(d.querySelector(".en-dossier").textContent)
      && !d.querySelector('[data-action="rerollNegative"]') && /second outcome stands/.test(d.querySelector(".en-pane").textContent)
      && /replacing Frayed Focus/.test(posted.at(-1).content) && (app.choices.mutations.log.length === 5));
  await act(app, "next");
  d = await show(app, "training");
  check("enlistment: Training, after Mutations: 100 XP, seven attributes, every skill at its starting rank, and the role's Primary perks, no specialization",
    d.querySelector(".en-step.on .t")?.textContent === "Training" && /100 of 100 left/.test(d.querySelector(".en-xp-left").textContent)
      && d.querySelectorAll(".en-train-cols .en-block:first-child .en-train-row").length === 7
      && d.querySelectorAll(".en-train-cols .en-block:last-child .en-train-row").length === Object.keys(IROP.skills).length
      && texts(d, ".en-tperk .en-perk-name").join() === "Hard Charger,Thick Hide" && !d.querySelector('[data-node="nt4"]')
      && texts(d, ".en-tree-tab").join() === "Marauder Primary,Generalist" && d.querySelector(".en-tree-tab.on")?.dataset.tree === "tp"
      && /first 3 tiers/.test(d.querySelector(".en-train-tree .hint")?.textContent ?? "") && (d.querySelector('[data-action="trainSkill"][data-key="athletics"]')?.closest(".en-train-row").querySelectorAll("i.start").length === 2)
      && /Tier 1 first/.test(d.querySelector('[data-node="nth"] .en-tperk-why')?.textContent ?? "") && !d.querySelector('[data-node="nsp"]') && !d.querySelector(".en-issue"));
  // A middle click on a role shows its perk trees (Johnald, 2026-10-17), in a window of their own.
  {
    const { RoleTreesViewer } = await import("../module/apps/role-trees.mjs");
    const viewer = new RoleTreesViewer();
    viewer.role = world.get("mr");
    const vd = new JSDOM(tpl("templates/item/role-trees.hbs")(await viewer._prepareContext({}))).window.document;
    check("enlistment: a role's perk trees in their own window: its Primary and specialization, each tier's perks, read only",
      texts(vd, ".tree-tab").join() === "Marauder Primary,Breacher" && /Hard Charger/.test(vd.querySelector('.tree-view[data-tree-id="tp"]').textContent)
        && /Opens at 300 XP earned/.test(vd.querySelector('.tree-view[data-tree-id="ts"]').textContent) && vd.querySelector("section.tab.trees.active")
        && Object.keys(RoleTreesViewer.DEFAULT_OPTIONS.actions).join() === "roleTree,openTreePerk,openTree");
  }
  await act(app, "perkTab", { tree: "tg" });
  d = await show(app, "training general");
  check("enlistment: the General tree on its own tab, without the role's tier note",
    texts(d, ".en-tperk .en-perk-name").join() === "Jack of All Trades" && d.querySelector(".en-tree-tab.on")?.dataset.tree === "tg" && !d.querySelector(".en-train-tree .hint"));
  await act(app, "perkTab", { tree: "tp" });
  await act(app, "trainPerk", { node: "nth" });
  check("enlistment: a perk not open yet is refused, saying why", /Tier 1 first/.test(said.at(-1) ?? ""));
  await act(app, "trainAttribute", { key: "lck", delta: "1" });
  check("enlistment: Luck is locked in Training, saying so", !app.choices.training.attributes?.lck && /Luck cannot be raised/.test(said.at(-1) ?? "")
    && /Locked/.test(d.querySelector('[data-action="trainAttribute"][data-key="lck"]')?.closest(".en-train-row")?.textContent ?? "")
    && !!d.querySelector('[data-action="trainAttribute"][data-key="lck"][data-delta="1"]')?.disabled);
  await act(app, "trainPerk", { node: "nt4" });
  check("enlistment: a perk below the first three tiers cannot be planned", !app.choices.training.perks.includes("nt4"));
  await act(app, "trainAttribute", { key: "tgh", delta: "1" });
  await act(app, "trainPerk", { node: "nhc" });
  await act(app, "trainPerk", { node: "nth" });
  await act(app, "trainSkill", { key: "awareness", delta: "1" });
  await act(app, "trainAttribute", { key: "str", delta: "1" });
  check("enlistment: training a Toughness rank, two perks and Awareness 2 spends all 100; one more rank is refused with the cost",
    eq(app.choices.training, { attributes: { tgh: 1 }, skills: { awareness: 1 }, perks: ["nhc", "nth"] }) && /costs 10 XP; 0 left/.test(said.at(-1) ?? ""), JSON.stringify(app.choices.training));
  d = await show(app, "trained");
  check("enlistment: trained: the meter empty, the pips and perks lit, the record and the rail showing it",
    /0 of 100 left/.test(d.querySelector(".en-xp-left").textContent) && texts(d, ".en-tperk.on .en-perk-name").join() === "Hard Charger,Thick Hide"
      && d.querySelectorAll(".en-pips i.bought").length === 2 && !!d.querySelector('[data-action="resetTraining"]')
      && /Toughness \+1, Awareness 2, Hard Charger, Thick Hide/.test(d.querySelector(".en-dossier").textContent) && /100 spent, 0 left/.test(d.querySelector(".en-dossier").textContent)
      && /100 of 100 XP/.test(d.querySelector(".en-step.on .v").textContent) && texts(d, ".en-bar.boosted em").join() === "45");
  await act(app, "trainAttribute", { key: "tgh", delta: "-1" });
  check("enlistment: taking off the rank a perk needed takes the perk off too, with a word", eq(app.choices.training.perks, ["nhc"]) && /Thick Hide came off/.test(said.at(-1) ?? ""));
  await act(app, "resetTraining");
  check("enlistment: Reset starts the plan over", eq(app.choices.training, { attributes: {}, skills: {}, perks: [] }));
  for ( const [name, dataset] of [["trainAttribute", { key: "tgh", delta: "1" }], ["trainPerk", { node: "nhc" }], ["trainPerk", { node: "nth" }], ["trainSkill", { key: "awareness", delta: "1" }]] ) {
    await act(app, name, dataset);
  }
  await act(app, "next");
  d = await show(app, "identity");
  check("enlistment: identity: names, callsign, a portrait, and for the GM, who it is for",
    ["firstName", "lastName", "callsign", "owner"].every(f => !!d.querySelector(`[data-field="${f}"]`)) && texts(d, '[data-field="owner"] option').join() === "GM (you),Johnald"
      && !d.querySelector('[data-action="browse"]') && !d.querySelector(".en-portrait-pick"));
  Object.assign(app.choices, { firstName: "Kael", lastName: "Hart", callsign: "Ghost", owner: "p1" });
  await act(app, "next");
  d = await show(app, "review");
  check("enlistment: review: the whole file, and Enlist", /Ghost/.test(d.querySelector(".en-kv").textContent) && /Marauder/.test(d.querySelector(".en-kv").textContent)
    && !!d.querySelector('[data-action="enlist"]') && !d.querySelector('[data-action="next"]') && !d.querySelector(".en-issues"));

  // As the GM: made at once, for the player picked, and theirs as their character.
  await act(app, "enlist");
  const data = made.at(-1);
  check("enlistment: the GM enlists for a player: the operative is theirs, named by callsign, with the picks applied",
    data?.name === "Ghost" && eq(data.ownership, { default: 0, p1: 3 }) && data.system.skills.athletics.rank === 2 && data.system.attributes.cha.base === 45
      && data.items.map(i => i.name).join() === "Mutant,Marauder,Slum Dweller,One of Us,Iron Gut,Twin Hearts,Molt Cycle,Hard Charger,Thick Hide" && data.system.details.record.firstName === "Kael");
  check("enlistment: the training goes on the operative and its ledger: the rank, Awareness 2, the perks marked with their tree",
    (data.system.attributes.tgh.advances === 1) && (data.system.skills.awareness.rank === 2) && (data.system.xp.earned === 100)
      && eq(data.system.xp.log.map(e => `${e.kind} ${e.ref} ${e.xp}`), ["attribute tgh 10", "skill awareness 40", "perk nhc 20", "perk nth 30"])
      && eq(data.items.find(i => i.name === "Thick Hide").flags.irop.perk, { tree: "tp", node: "nth", xp: 30 }), JSON.stringify(data.system.xp));
  check("enlistment: a player with no character gets this one", player.updates.at(-1)?.character === "a1");
  d = await show(app, "finish");
  check("enlistment: the finish: the record printed and stamped, the rail locked, the sheet a click away",
    /ENLISTED|Enlisted/.test(d.querySelector(".en-stamp").textContent) && /Kael Hart/.test(d.querySelector(".en-record").textContent) && /One of Us/.test(d.querySelector(".en-record").textContent)
      && [...d.querySelectorAll(".en-step")].every(b => b.disabled) && !!d.querySelector('[data-action="openSheet"]') && !!d.querySelector('[data-action="again"]')
      && /Iron Gut, Twin Hearts, Molt Cycle/.test(d.querySelector(".en-record").textContent) && /Training\s*Toughness \+1/.test(d.querySelector(".en-record").textContent));

  // Requisition (2026-10-16): the stores the GM opened at enlistment, once the record is filed.
  const opened = [];
  const store = (id, name, enlist, players) => ({ id, name, type: "store", img: `${id}.webp`, system: { enlist, description: "<p>Guns, mostly. Some ammunition.</p>" },
    items: [{ flags: {} }, { flags: { irop: { shelf: { hidden: true } } } }], testUserPermission: u => u.isGM || players,
    sheet: { setBuyer(b) { opened.push(`${id}:${b}`); }, render() { opened.push(`${id}:open`); return this; } } });
  const actors = [store("s2", "Back Room", true, false), store("s1", "Armory", true, true), store("s3", "Closed Shop", false, true)];
  actors.get = id => actors.find(a => a.id === id);
  game.actors = actors;
  check("enlistment: the stores open at enlistment, by name; a player sees only those they may open",
    eq(enlistmentStores(gm).map(s => `${s.store.name} ${s.open}`), ["Armory true", "Back Room true"]) && eq(enlistmentStores(player).filter(s => s.open).map(s => s.store.name), ["Armory"]));
  d = await show(app, "finish with stores");
  check("enlistment: with stores open, the finish leads on to Requisition, the last step on the rail",
    !!d.querySelector('.en-foot [data-action="requisition"]') && !d.querySelector('.en-step-req').disabled && /Requisition/.test(d.querySelector(".en-step-req").textContent));
  await act(app, "requisition");
  d = await show(app, "requisition");
  check("enlistment: Requisition: the purse, each store with what is on show, and a word when players cannot open one",
    texts(d, ".en-store .en-name").join() === "Armory,Back Room" && /1 on the shelf/.test(d.querySelector('[data-id="s1"]').textContent)
      && d.querySelectorAll(".en-coin").length === 3 && /Players cannot open Back Room yet/.test(d.querySelector(".en-pane").textContent)
      && /Nothing yet/.test(d.querySelector(".en-kit").textContent) && !!d.querySelector('.en-foot [data-action="openSheet"]'));
  await act(app, "openStore", { id: "s1" });
  check("enlistment: a store opens in its own window, buying for the recruit", eq(opened, ["s1:a1", "s1:open"]));
  await act(app, "record");
  check("enlistment: back to the record", app.phase === "record");
  game.actors = oldActors;
  await act(app, "again");
  check("enlistment: Enlist another starts a fresh recruit, rolls and all", app.step === 0 && !app.result && !app.choices.species && !app.choices.mutations);
  const forged = await createOperative({ ...app.choices, species: "mu", role: "mr", background: "sd", roleSkill: "athletics", backgroundSkills: ["athletics", "insight", "coercion"],
    perk: "pk1", callsign: "Forge", mutations: { positive: [{ n: 1, id: "m1" }, { n: 1, id: "m1" }], negative: { n: 1, id: "n1" }, rerolled: false, log: [] } }, gm);
  check("enlistment: the GM's client refuses mutations that are not two different Positives and a Negative", /not two different Positives and one Negative/.test(forged.error ?? ""), forged.error);

  // A refused file: the GM's client says what is missing.
  const refused = await createOperative({ species: "mu", role: "mr", background: "sd", roleSkill: "", backgroundSkills: [], perk: "", callsign: "X" }, gm);
  check("enlistment: an incomplete file is refused, saying what is missing", /Pick 1 of Marauder/.test(refused.error ?? ""));

  const oldHooks = globalThis.Hooks;
  const hooked = [];
  globalThis.Hooks = { on: (name, fn) => hooked.push(name), callAll() {} };
  registerEnlistment();
  check("enlistment: the GM's client takes players' files, and every client listens for its operative", hooked.includes("createActor"));
  globalThis.Hooks = oldHooks;
  // As a player: the file goes to the GM's client, and the operative arriving finishes it here.
  const sent = [];
  game.socket = { on() {}, emit: (channel, payload) => sent.push(payload) };
  game.user = player;
  const mine = new EnlistmentApp();
  Object.assign(mine.choices, { species: "hu", role: "mr", background: "sd", roleSkill: "survival", backgroundSkills: ["awareness", "insight", "coercion"], perk: "pk1", callsign: "Vale", owner: "gm",
    boons: ["agi", "cha"] });
  mine.step = 7;
  await act(mine, "enlist");
  check("enlistment: a player's Enlist goes to the GM's client with the file and a request to wait on",
    sent[0]?.action === "enlist.create" && sent[0].payload.choices.callsign === "Vale" && !!mine.waiting && sent[0].payload.request === mine.waiting);
  d = await show(mine, "waiting");
  check("enlistment: while it waits, the button says so", /Filing with the GM/.test(d.querySelector('[data-action="enlist"]').textContent));
  const request = mine.waiting;
  game.user = gm;
  const handled = await createOperative(sent[0].payload.choices, player, request);
  check("enlistment: on the GM's client a player's file is always for that player", eq(made.at(-1).ownership, { default: 0, p1: 3 }) && made.at(-1).flags.irop.enlistment.request === request);
  const vale = made.at(-1).items.filter(i => i.type === "boon");
  check("enlistment: a Human's boons come along: the world's Charisma Boon, and an Agility Boon made to the rules",
    eq(vale.map(b => `${b.name} ${b.system.attribute} +${b.system.amount}`), ["Agility Boon agi +10", "Charisma Boon cha +10"]) && !vale.some(b => "_id" in b), JSON.stringify(vale.map(b => b.name)));
  EnlistmentApp.received(handled.actor);
  check("enlistment: the operative arriving finishes the player's terminal", !mine.waiting && mine.result?.name === "Vale");

  // Boons (2026-10-16): a Human picks two attributes, none twice.
  game.user = gm;
  const human = new EnlistmentApp();
  await act(human, "pick", { kind: "species", id: "hu" });
  for ( const attribute of ["agi", "agi", "cha", "agi"] ) await act(human, "boon", { attribute });
  await act(human, "boon", { attribute: "per" });
  check("enlistment: boons toggle, never the same attribute twice and never more than two", eq(human.choices.boons, ["cha", "agi"]) && /2 boons, no attribute twice/.test(said.at(-1) ?? ""),
    JSON.stringify(human.choices.boons));
  human.choices.boons = ["agi", "cha"];
  human.step = 4;
  d = await show(human, "boons");
  check("enlistment: a Human's Boons step, after skills: seven attribute cards, the picks lit, each showing where it lands",
    texts(d, ".en-step .t").join() === "Species,Role,Background,Skills and perk,Boons,Training,Identity,Review" && d.querySelectorAll(".en-boon").length === 7
      && texts(d, ".en-boon.on .en-name").join() === "Agility,Charisma" && /40\s*50/.test(d.querySelector('[data-attribute="agi"] .en-boon-value').textContent)
      && /Charisma Boon/.test(d.querySelector('[data-attribute="cha"]').textContent) && /2 of 2 picked/.test(d.querySelector(".en-sub").textContent));
  check("enlistment: the record lists the boons and its bars rise with them",
    /Agility \+10, Charisma \+10/.test(d.querySelector(".en-dossier").textContent) && d.querySelectorAll(".en-bar.boosted").length === 2
      && texts(d, ".en-bar.boosted em").join() === "50,50");
  human.choices.boons = ["agi"];
  d = await show(human, "boons short");
  check("enlistment: one boon short, the step says so", /Pick 2 attributes for your boons \(1 picked\)/.test(d.querySelector(".en-issue")?.textContent ?? ""));

  // Mutations that ask for a choice (2026-10-17): the pickers on the Mutations step, and the choice filed.
  {
    const ap = mk("ap", "Aberrant Potential", "mutation", { polarity: "positive", choice: { attribute: 5, skill: 1 } });
    world.push(ap);
    game.user = gm;
    const baron = new EnlistmentApp();
    Object.assign(baron.choices, { species: "mu", role: "mr", background: "sd", roleSkill: "athletics", backgroundSkills: ["athletics", "insight", "coercion"], perk: "pk1", callsign: "Baron",
      mutations: { positive: [{ n: 1, id: "ap", name: "Aberrant Potential" }, { n: 2, id: "m3", name: "Iron Gut" }], negative: { n: 1, id: "n1", name: "Frayed Focus" }, rerolled: false, log: [] } });
    baron.step = 4;
    let bd = await show(baron, "mutation choice");
    const attrPick = bd.querySelector('[data-mutation-pick="ap"][data-part="attribute"]');
    const skillPick = bd.querySelector('[data-mutation-pick="ap"][data-part="skill"]');
    check("enlistment: a rolled mutation that asks for a choice gets its pickers; no skill already at rank 2; the step waits on it",
      (attrPick?.querySelectorAll("option").length === 8) && !!skillPick && !skillPick.querySelector('option[value="athletics"]') && !!skillPick.querySelector('option[value="stealth"]')
        && /Choose an attribute for Aberrant Potential/.test(bd.querySelector(".en-issue")?.textContent ?? "") && !bd.querySelector('[data-mutation-pick="m3"]'));
    baron.choices.mutationPicks = { ap: { attribute: "per", skill: "stealth" } };
    bd = await show(baron, "mutation chosen");
    check("enlistment: chosen, the step is complete and the record's Perception bar rises by 5",
      !bd.querySelector(".en-issue") && texts(bd, ".en-bar.boosted").some(t => /PER.*40/.test(t)));
    await createOperative(baron.choices, gm);
    const filed = made.at(-1);
    check("enlistment: the operative's Aberrant Potential carries the choice, and Stealth is rank 1",
      eq(filed.items.find(i => i.name === "Aberrant Potential")?.system.chosen, { attribute: "per", skill: "stealth" }) && (filed.system.skills.stealth.rank === 1));
    world.splice(world.indexOf(ap), 1);
  }

  // The sidebar button.
  const sideWindow = new JSDOM('<section><div class="header-actions"><button>Create Actor</button></div></section>').window;
  const side = sideWindow.document;
  const oldElement = globalThis.HTMLElement;
  globalThis.HTMLElement = sideWindow.HTMLElement;
  addEnlistButton(null, side.body.firstElementChild);
  addEnlistButton(null, side.body.firstElementChild);
  globalThis.HTMLElement = oldElement;
  check("enlistment: an Enlist button in the Actors sidebar, once", side.querySelectorAll(".irop-enlist-button").length === 1 && /Enlist/.test(side.querySelector(".irop-enlist-button").textContent));

  foundry.utils = oldUtils;
  game.user = oldUser;
  game.users = oldUsers;
  game.items = oldItems;
  game.socket = oldSocket;
  globalThis.ui = oldUi;
  globalThis.Actor = oldActor;
  globalThis.CONFIG = oldConfig;
  globalThis.ChatMessage = oldChat;
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * Build the Sandbox abilities import from a Sandbox world dump (2026-10-08).
 * Run: node dev/build-abilities.mjs <dump dir with items.json and folders.json> <icons dir>
 *   <icons dir> is docs/foundry-icons: manifest.json (item id to icon) and dist/*.webp.
 *
 * Converts every ability, perk and paraphysics power from the old world (the
 * Sandbox cItems in the ablts, passperks, paraphys and paraphys_attack groups)
 * into this system's ability items, checks each against the real data model, and
 * writes:
 *   assets/data/sandbox-abilities.json   the items, each with its folder path
 *   assets/icons/abilities/<role>/*.webp the 373 class ability icons
 * The GM brings them into a world with game.irop.importAbilities().
 *
 * Each item keeps its Sandbox id, so it lines up with the icon manifest and with
 * the old Skill Tree journal pages that the tree import reads next.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [dumpDir, iconsDir] = process.argv.slice(2);
if ( !dumpDir || !iconsDir ) throw new Error("Pass the dump folder (items.json, folders.json) and the foundry-icons folder.");

const common = await import("file:///C:/Program%20Files/Foundry%20Virtual%20Tabletop/resources/app/common/server.mjs");
globalThis.foundry = { ...common };
globalThis.CONST = common.CONST;
globalThis.game = { settings: { get() { throw new Error("none"); } } };
const { AbilityData } = await import("../module/data/item.mjs");
const { IROP } = await import("../module/config.mjs");

const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const all = read(path.join(dumpDir, "items.json")).filter(i => i._key.startsWith("!items!") && (i.type === "cItem"));
const folders = new Map(read(path.join(dumpDir, "folders.json")).map(f => [f._id, f]));
const manifest = new Map(read(path.join(iconsDir, "manifest.json")).map(m => [m.id, m.file]));

const GROUPS = ["ablts", "passperks", "paraphys", "paraphys_attack"];
const groupOf = i => (i.system.groups ?? []).map(g => g.ikey).find(k => GROUPS.includes(k));

/* -------------------------------------------- */
/*  Parsing helpers                             */
/* -------------------------------------------- */

const attr = (i, k) => i.system.attributes?.[k]?.value;
const num = v => {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};
const clean = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Old formula syntax to new: @{int_mod} to @int.mod, @{telekinesis_rank} to @paraphysics.telekinesis. */
function formula(f) {
  if ( !f ) return "";
  return String(f)
    .replace(/@\{(str|agi|tgh|cha|lck|int|per)_mod\}/g, "@$1.mod")
    .replace(/@\{(\w+)_rank\}/g, "@paraphysics.$1")
    .replace(/\s*([+-])\s*/g, " $1 ").trim();
}

/** Descriptions pasted from Google Sheets carry wrapper spans; unwrap them, keep everything else. */
function tidy(html) {
  let s = String(html ?? "");
  let before;
  do {
    before = s;
    s = s.replace(/<span\s+data-sheets-[^>]*>((?:(?!<span)[\s\S])*?)<\/span>/g, "$1");
  } while ( s !== before );
  return s.trim();
}

/** The folder path of a Sandbox item, as names. */
function folderPath(id) {
  const out = [];
  for ( let f = folders.get(id); f; f = folders.get(f.folder) ) out.unshift(f.name);
  return out;
}

const ROLES = Object.keys(IROP.roles);
const TYPO = { gunsllinger: "Gunslinger" };

/**
 * Where an ability sits, from its Sandbox folder:
 *   Abilities/Active Abilities/1. Legionary/1.2 Pointman      Legionary, tree Pointman
 *   Abilities/Passive Perks/1. Legionary/1.1 Passive Legionary Legionary, tree Primary
 *   Abilities/Passive Perks/Generalist                        Generalist
 *   .../7. Archive/Heavy, .../7. Passive Archive/Heavy        the old classes, kept apart
 */
function placeOf(parts) {
  const role = ROLES.find(r => parts.some(p => p.toLowerCase().replace(/^\d+\.\s*/, "") === r));
  if ( role ) {
    const leaf = parts.at(-1).replace(/^\d+\.\d+\s*/, "").replace(/^passive\s+/i, "").trim();
    const lower = leaf.toLowerCase();
    const tree = (/primary/i.test(leaf) || (lower === role)) ? "Primary" : (TYPO[lower] ?? leaf);
    return { source: role, tree, folder: ["Abilities", IROP.roles[role].label, tree] };
  }
  if ( parts.includes("Generalist") ) return { source: "generalist", tree: "Generalist", folder: ["Abilities", "Generalist"] };
  if ( parts.some(p => /archive/i.test(p)) ) {
    const old = parts.at(-1).replace(/\s*\d+\.\d+$/, "");
    return { source: "other", tree: "", folder: ["Abilities", "Archive (old classes)", old] };
  }
  if ( parts.some(p => /enemy/i.test(p)) ) return { source: "other", tree: "", folder: ["Abilities", "Enemy Abilities"] };
  if ( parts.includes("Paraphysics") ) return { source: "other", tree: "", folder: ["Abilities", "Paraphysics"] };
  return { source: "other", tree: "", folder: ["Abilities", "Other"] };
}

/** "Legionaries Adaptability III" is rank 3, "Strong Back (2)" rank 2. */
function rankOf(name) {
  const roman = name.match(/\s(I{1,3}|IV|V)$/);
  if ( roman ) return { I: 1, II: 2, III: 3, IV: 4, V: 5 }[roman[1]];
  const paren = name.match(/\((\d)\)$/);
  return paren ? Number(paren[1]) : 1;
}

/** "Pre-Requisites: Tireless (1), Intelligence 45" from the description; blank for None. */
function prerequisitesOf(html) {
  const m = String(html ?? "").match(/<p>\s*(?:<strong>)?\s*Pre-?Requisites?\s*:?\s*(?:<\/strong>)?([\s\S]*?)<\/p>/i);
  const text = m ? clean(m[1]).replace(/^:\s*/, "") : "";
  return /^none\.?$/i.test(text) ? "" : text;
}

/**
 * Sandbox had no action types, so actives default to a Single Action. Only a plain
 * "Turn Ending" in the text is read; "not turn ending", "non turn ending" and "no
 * longer turn ending" are not, and nor are reactions, which the text names too
 * loosely to trust. These want a GM's eye.
 */
function actionOf(text, kind) {
  if ( kind === "passive" ) return "passive";
  return /(?<!(?:not|non|longer)[\s-]+)turn[\s-]ending/i.test(text) ? "turnEnding" : "single";
}

/**
 * The Sandbox stat boosts on passive perks become effects: HP, Energy and carry
 * weight. (The "Energy Cost" mods on actives were Sandbox's way to spend Energy,
 * which this system does itself.) Values were written "2+@{hp.max}" or "2"; the
 * number is the boost.
 */
const STAT_KEYS = { "hp.max": "system.vitals.hp.bonus", "ener.max": "system.vitals.energy.bonus", mxwght: "system.bonuses.carry" };
const effectNotes = [];
function effectsOf(i, img) {
  const changes = [];
  for ( const m of i.system.mods ?? [] ) {
    let attribute = m.attribute;
    // One perk lost its attribute in Sandbox; its value still names it.
    if ( !attribute && /hp\.max/.test(m.value ?? "") ) attribute = "hp.max";
    const key = STAT_KEYS[attribute];
    if ( !key ) continue;
    let value = parseInt(String(m.value ?? ""), 10);
    if ( !Number.isFinite(value) ) {
      // And one lost its value; its text says it: "Increase your Energy by 5 points."
      value = Number(clean(i.system.description).match(/by (\d+)/i)?.[1]);
      effectNotes.push(`${i.name}: ${attribute} value missing in Sandbox, read ${value} from its text`);
    }
    if ( Number.isFinite(value) && value ) changes.push({ key, type: "add", value: String(value) });
  }
  if ( !changes.length ) return undefined;
  // Foundry 14's shape: the changes under system, each with a string type.
  return [{ name: i.name, img, transfer: true, system: { changes } }];
}

/* -------------------------------------------- */
/*  Convert                                     */
/* -------------------------------------------- */

const DEFAULT_IMG = { active: "icons/svg/lightning.svg", passive: "icons/svg/upgrade.svg", para: "icons/svg/aura.svg" };
const DISCIPLINE = { telepathy: "telepathy", telekinesis: "telekinesis", aegis: "energy", energy: "energy", spatial: "spatial" };

const out = [];
const skipped = [];
const icons = [];
for ( const i of all ) {
  const group = groupOf(i);
  if ( !group ) continue;
  if ( /template/i.test(i.name) ) { skipped.push(`${i.name} (Sandbox template)`); continue; }
  const parts = folderPath(i.folder);
  const place = placeOf(parts);
  const para = group.startsWith("paraphys");
  const kind = group === "passperks" ? "passive" : "active";
  let description = tidy(i.system.description);
  if ( !clean(description) && attr(i, "abil_desc") ) description = `<p>${attr(i, "abil_desc")}</p>`;
  const text = clean(description);

  let img = DEFAULT_IMG[para ? "para" : kind];
  const file = manifest.get(i._id);
  if ( file ) {
    const [role, png] = file.split("/");
    const slug = png.replace(/\.png$/, "");
    img = `systems/irop/assets/icons/abilities/${role}/${slug}.webp`;
    icons.push({ from: `${role}-${slug}.webp`, to: `${role}/${slug}.webp` });
  }

  const system = {
    description,
    kind,
    source: place.source,
    tree: place.tree,
    rank: rankOf(i.name.trim()),
    energyCost: num(attr(i, "enercost")),
    actionType: actionOf(text, kind),
    range: num(attr(i, "tilerange")),
    area: num(attr(i, "tile_aoe")),
    prerequisites: prerequisitesOf(i.system.description)
  };
  if ( para ) {
    const discipline = parts.map(p => DISCIPLINE[p.toLowerCase()]).find(Boolean) ?? "";
    system.paraphysics = { discipline };
    if ( group === "paraphys_attack" ) {
      Object.assign(system.paraphysics, { attack: true, accuracy: num(attr(i, "accu_bonus")),
        damage: { formula: formula(attr(i, "dmgrollparaphys")), type: "psychic" } });
    }
  }
  const item = { _id: i._id, name: i.name.trim(), type: "ability", img, system, folder: place.folder };
  const effects = effectsOf(i, img);
  if ( effects ) item.effects = effects;
  out.push(item);
}

// Check every item against the real data model.
const problems = [];
for ( const item of out ) {
  const failure = AbilityData.schema.validate(item.system, { partial: true });
  if ( failure ) problems.push(`${item.name}: ${failure}`);
  try { new AbilityData(item.system, { strict: true }); }
  catch(err) { problems.push(`${item.name}: ${err.message.split("\n").slice(0, 3).join(" ")}`); }
}

// Write the data, sorted by folder then name, and copy the icons.
out.sort((a, b) => a.folder.join("/").localeCompare(b.folder.join("/")) || a.name.localeCompare(b.name));
const dataDir = path.join(ROOT, "assets", "data");
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, "sandbox-abilities.json"), JSON.stringify(out));
let copied = 0;
for ( const { from, to } of icons ) {
  const dst = path.join(ROOT, "assets", "icons", "abilities", to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(iconsDir, "dist", from), dst);
  copied++;
}

// Report.
const tally = {};
for ( const item of out ) {
  const k = item.folder.slice(1, 3).join("/");
  tally[k] ??= { active: 0, passive: 0 };
  tally[k][item.system.kind]++;
}
for ( const [k, t] of Object.entries(tally) ) console.log(`${k.padEnd(40)} ${String(t.active).padStart(3)} active ${String(t.passive).padStart(3)} passive`);
const actions = {};
for ( const item of out ) actions[item.system.actionType] = (actions[item.system.actionType] ?? 0) + 1;
console.log("action types:", JSON.stringify(actions));
console.log(`${out.length} abilities, ${out.filter(i => i.effects).length} with effects, ${copied} icons, `
  + `${out.filter(i => i.system.prerequisites).length} with prerequisites, ${problems.length} validation problems`);
skipped.forEach(s => console.log("  skipped " + s));
effectNotes.forEach(s => console.log("  note " + s));
problems.forEach(p => console.log("  PROBLEM " + p));
const dupes = Object.entries(out.reduce((m, i) => ((m[i.name] = (m[i.name] ?? 0) + 1), m), {})).filter(([, n]) => n > 1);
if ( dupes.length ) console.log("  same name twice (one usually in the Archive): " + dupes.map(([n]) => n).join(", "));

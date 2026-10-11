/**
 * Build the territories import from the campaign vault's region notes (2026-10-08).
 * Run: node dev/build-territories.mjs <vault regions folder, e.g. Documents/IROP/40 Places/Regions>
 *
 * The vault's sixteen region notes carry an older pass of the Strategy Layer from
 * the Foundry Lore journal: GENESIS strength and vigilance as five tiers of five
 * boxes, and a type. This turns each into a territory with STARTING values only
 * (the rules doc outranks these tracks; the GM sets the real ones):
 *   category          the territory's type and who holds it
 *   genesis_strength  Strength: the share of the 25 boxes, on the 0 to 10 scale
 *   genesis_vigilance Heat: the tier less one (Tier 1 None, Tier 2 Low, Tier 3 Medium)
 *   modifiers, art    carried over; the Lore journal text becomes the description
 * Reputation starts Neutral (the old track was never used). Neighbours are left
 * empty: the vault does not record them, and the map will.
 * Writes assets/data/territories.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [dir] = process.argv.slice(2);
if ( !dir ) throw new Error("Pass the vault's Regions folder.");

const common = await import("file:///C:/Program%20Files/Foundry%20Virtual%20Tabletop/resources/app/common/server.mjs");
globalThis.foundry = { ...common };
globalThis.CONST = common.CONST;
globalThis.game = { settings: { get() { throw new Error("none"); } } };
const { TerritoryData } = await import("../module/data/item.mjs");
const { IROP } = await import("../module/config.mjs");
const { strengthFromTrack, heatFromTrack } = await import("../module/rules/strategy.mjs");

/** Each territory's climate, for the weather on its card (2026-10-08): a reading of the names. */
const CLIMATE = {"Black Hills": "continental", "Blackrock Desert": "arid", "Eclipse Headquarters": "temperate", "Eight Forests": "wet", "Malmstrom": "continental", "Neo Denver": "alpine", "Neo LA": "coastal", "Neo Seattle": "wet", "No Man's Land": "temperate", "Old Victoria": "wet", "Portlandia": "wet", "Redwood Havens": "wet", "Reno Subsector": "arid", "SLC Subsector": "continental", "Spokane Subsector": "continental", "The Glasslands": "arid"};

/** Vault category to territory type and holder. Eclipse HQ is the ODR's hidden base: contested. */
const CATEGORY = {
  "genesis megacity": { kind: "megacity", control: "genesis" },
  "genesis subsector": { kind: "slums", control: "genesis" },
  "havens": { kind: "rural", control: "genesis" },
  "tomb city": { kind: "wildland", control: "genesis" },
  "tomb town": { kind: "wildland", control: "genesis" },
  "wildlands": { kind: "wildland", control: "genesis" },
  "eclipse": { kind: "rural", control: "contested" }
};

/** A note's front matter, as plain values and lists. */
function frontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if ( !m ) return out;
  let key = null;
  for ( const line of m[1].split(/\r?\n/) ) {
    const kv = line.match(/^([\w]+):\s*(.*)$/);
    if ( kv ) {
      key = kv[1];
      const raw = kv[2].trim();
      if ( raw.startsWith("[") ) out[key] = JSON.parse(raw);
      else out[key] = raw.replace(/^"(.*)"$/, "$1");
    }
    else if ( key && /^\s+-\s+/.test(line) ) {
      if ( !Array.isArray(out[key]) ) out[key] = [];
      out[key].push(line.replace(/^\s+-\s+/, "").trim());
    }
  }
  return out;
}

/** The "From the Lore journal" section, as HTML paragraphs, without its callout. */
function loreHtml(text) {
  const m = text.match(/## From the Lore journal\r?\n([\s\S]*?)(?:\r?\n## |\s*$)/);
  if ( !m ) return "";
  const body = m[1].split(/\r?\n/).filter(l => !l.startsWith(">")).join("\n").trim();
  const escape = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return body.split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean)
    .map(p => `<p>${escape(p.replace(/\[\[([^\]#|]+)(?:[#|][^\]]*)?\]\]/g, "$1"))}</p>`).join("");
}

const out = [];
const problems = [];
for ( const file of fs.readdirSync(dir).filter(f => f.endsWith(".md") && (f !== "REGIONS.md")).sort() ) {
  const text = fs.readFileSync(path.join(dir, file), "utf8");
  const fm = frontMatter(text);
  const name = file.replace(/\.md$/, "");
  const place = CATEGORY[String(fm.category ?? "").toLowerCase()];
  if ( !place ) { problems.push(`${name}: unknown category ${fm.category}`); continue; }
  const system = {
    description: loreHtml(text),
    kind: place.kind,
    control: place.control,
    strength: strengthFromTrack(fm.genesis_strength),
    heat: heatFromTrack(fm.genesis_vigilance),
    reputation: 0,
    modifiers: (Array.isArray(fm.modifiers) ? fm.modifiers : []).join(", "),
    climate: CLIMATE[name] ?? "temperate",
    art: fm.art ?? ""
  };
  try { new TerritoryData(system, { strict: true }); }
  catch(err) { problems.push(`${name}: ${err.message.split("\n")[0]}`); }
  out.push({ name, type: "territory", img: IROP.territoryKinds[place.kind].icon, system, folder: ["Territories"] });
}

fs.mkdirSync(path.join(ROOT, "assets", "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "assets", "data", "territories.json"), JSON.stringify(out));
for ( const t of out ) {
  const s = t.system;
  console.log(`${t.name.padEnd(22)} ${s.kind.padEnd(9)} ${s.control.padEnd(10)} Strength ${String(s.strength).padStart(2)}  Heat ${IROP.heatLevels[s.heat].label.padEnd(7)} ${s.modifiers}`);
}
console.log(`${out.length} territories, ${problems.length} problems`);
problems.forEach(p => console.log("  PROBLEM " + p));

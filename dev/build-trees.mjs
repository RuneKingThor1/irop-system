/**
 * Build the Sandbox perk trees import from a Sandbox world dump (2026-10-08).
 * Run: node dev/build-trees.mjs <dump dir with journal.json> [role pages dir]
 *   (after dev/build-abilities.mjs, whose assets/data/sandbox-abilities.json it links to)
 *
 * The live game kept its trees in the Skill Tree module (TheRipper93): each tree a
 * journal entry flagged skill-tree.isSkillTree, its groups the Primary and three
 * specializations, each perk a page with flags {row, col, groupId, points,
 * lockoutSkills, connectedSkills, itemUuids}. This turns each group into a Skill
 * Tree item:
 *   row               tier (rows renumbered from 1, gaps closed)
 *   col               order within the tier
 *   points            XP, at 10 XP a point (RULED 2026-10-08, Johnald)
 *   lockoutSkills     a lock between perks of the same row makes the tier Pick one
 *   connectedSkills   the perk's prerequisite (Strong Back (2) needs Strong Back (1))
 *   page name         the ability, matched by name within the role and tree
 * The Attributes and Skills trees are left out: attribute and skill ranks are
 * bought on the sheet now. Writes assets/data/sandbox-trees.json.
 *
 * The published role pages (docs/role-pages/<role>.html, from the Role Perk
 * Editor) mark Exclusive perks too. Where a page marks a tier Exclusive and the
 * live tree never set its locks (Ghost, Guardian, three others), the tier is made
 * Pick one; where the two place perks differently, the live tree is kept and the
 * difference reported.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [dumpDir, rolePagesDir] = process.argv.slice(2);
if ( !dumpDir ) throw new Error("Pass the dump folder holding journal.json.");

const common = await import("file:///C:/Program%20Files/Foundry%20Virtual%20Tabletop/resources/app/common/server.mjs");
globalThis.foundry = { ...common };
globalThis.CONST = common.CONST;
globalThis.game = { settings: { get() { throw new Error("none"); } } };
const { SkillTreeData } = await import("../module/data/item.mjs");
const { IROP } = await import("../module/config.mjs");
const { perkKey } = await import("../module/rules/skill-trees.mjs");

/** RULED 2026-10-08: the live trees priced perks in points; one point is 10 XP. */
const XP_PER_POINT = 10;
const SKIP = ["Attributes", "Skills"];

const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const journal = read(path.join(dumpDir, "journal.json"));
const pages = new Map(journal.filter(e => e._key?.startsWith("!journal.pages!")).map(p => [p._id, p]));
const sources = journal.filter(e => e.flags?.["skill-tree"]?.isSkillTree && !SKIP.includes(e.name));
const abilities = read(path.join(ROOT, "assets", "data", "sandbox-abilities.json"));
const pageId = uuid => String(uuid ?? "").split(".").pop();

/* -------------------------------------------- */
/*  Matching perks to abilities                 */
/* -------------------------------------------- */

/** Tree spellings that differ from the ability's (from the icon sync work, 2026-10-06). */
const ALIASES = {
  "ammo connoisseur": "ammo connoiseur", "rear line": "stratagem rear lines",
  "chemical stabilization": "chemical stablization", "combined arms": "combine arms", "rocksteady": "rock steady",
  "this aint sh t": "they aint sh t", "teleheath": "telehealth", "reinforced habits": "reinforcing habits",
  "put the fear in them": "put the fear in the them", "warmachine spirit": "warmachines spirit",
  "knights of the round": "knights of round",
  "warmachine spirit i": "warmachines spirit"
};
const keyOf = name => {
  const k = perkKey(name);
  return ALIASES[k] ?? k;
};

/** The current (not archived) abilities, by role or Generalist. */
const live = abilities.filter(a => !/archive/i.test(a.folder[1] ?? ""));
const byId = new Map(abilities.map(a => [a._id, a]));

/**
 * The ability a perk page means. The current copy wins: the same name in the same
 * role and tree, else anywhere in the role (or the Generalist perks). The live
 * pages' item links were made when the old classes were current, so most point at
 * what is now the Archive; a link is used only when no current copy exists. Last,
 * the name without its rank numeral.
 */
function matchAbility(page, role, tree) {
  const key = keyOf(page.name);
  const inRole = live.filter(a => (a.system.source === role) && (keyOf(a.name) === key));
  const exact = inRole.find(a => a.system.tree === tree) ?? inRole[0];
  if ( exact ) return { ability: exact, how: "name" };
  for ( const uuid of page.flags["skill-tree"].itemUuids ?? [] ) {
    const linked = byId.get(pageId(uuid));
    if ( linked ) return { ability: linked, how: "linked" };
  }
  const bare = key.replace(/\s+(i|ii|iii|iv|v|\d)$/, "");
  const loose = live.find(a => (a.system.source === role) && (keyOf(a.name).replace(/\s+(i|ii|iii|iv|v|\d)$/, "") === bare));
  if ( loose ) return { ability: loose, how: "rankless" };
  return { ability: null, how: "none" };
}

/* -------------------------------------------- */
/*  The published role pages                    */
/* -------------------------------------------- */

/** Each role page's trees: tab name to tiers, each a list of {name, excl}. */
function readRolePages(dir) {
  const out = {};
  if ( !dir ) return out;
  for ( const role of Object.keys(IROP.roles) ) {
    const html = fs.readFileSync(path.join(dir, `${role}.html`), "utf8");
    const tabs = [...html.matchAll(/<button class="tree-tab[^"]*">([^<]+)<\/button>/g)].map(m => m[1]);
    const panels = html.split(/<div class="tree-panel[^"]*">/).slice(1);
    out[role] = {};
    panels.forEach((panel, i) => {
      out[role][tabs[i]] = panel.split(/<div class="tier">/).slice(1).map(tier => [...tier.matchAll(
        /<div class="(perk[^"]*)">\s*<div class="perk-head"><div class="perk-name">([^<]+)<\/div>/g)]
        .map(m => ({ name: m[2].replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").trim(), excl: /\bexcl\b/.test(m[1]) })));
    });
  }
  return out;
}
const rolePages = readRolePages(rolePagesDir);

/** Letters apart: how many single edits turn one string into the other. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for ( let i = 1; i <= a.length; i++ ) {
    let prev = row[0];
    row[0] = i;
    for ( let j = 1; j <= b.length; j++ ) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

/**
 * The same perk under two spellings: the role pages carry typos ("Adaptibility",
 * "Commad") and notes ("Sapping Sting (Shrapnel rename)"); the live tree, Sandbox's.
 */
function sameName(a, b) {
  const x = keyOf(a);
  const y = keyOf(b);
  if ( (x === y) || x.startsWith(y) || y.startsWith(x) || x.endsWith(y) || y.endsWith(x) ) return true;
  return (Math.min(x.length, y.length) >= 6) && (distance(x, y) <= 2);
}

/* -------------------------------------------- */
/*  Convert                                     */
/* -------------------------------------------- */

const trees = [];
/** What the trees tell us about their abilities: tier, and a move out of the Archive. */
const abilityUpdates = {};
const report = { linked: 0, name: 0, rankless: 0, none: [], crossLocks: [], oneWay: [], fromPages: [], placement: [] };

for ( const entry of sources ) {
  const general = entry.name === "Generalist";
  const role = general ? "" : entry.name.toLowerCase();
  if ( !general && !IROP.roles[role] ) throw new Error(`Unknown role tree ${entry.name}`);
  const entryPages = entry.pages.map(id => pages.get(id)).filter(Boolean);
  entry.flags["skill-tree"].groups.forEach((group, order) => {
    const primary = !general && (order === 0);
    const treeName = general ? "Generalist" : (primary ? "Primary" : group.name);
    const groupPages = entryPages.filter(p => p.flags["skill-tree"].groupId === group.id);
    const rowNumbers = [...new Set(groupPages.map(p => p.flags["skill-tree"].row))].sort((a, b) => a - b);
    const inTree = new Set(groupPages.map(p => p._id));
    const pageTiers = rolePages[role]?.[treeName] ?? null;
    const tiers = rowNumbers.map((row, tierIndex) => {
      const rowPages = groupPages.filter(p => p.flags["skill-tree"].row === row)
        .sort((a, b) => a.flags["skill-tree"].col - b.flags["skill-tree"].col);
      const rowIds = new Set(rowPages.map(p => p._id));
      let exclusive = false;
      for ( const p of rowPages ) {
        for ( const uuid of p.flags["skill-tree"].lockoutSkills ?? [] ) {
          const other = pages.get(pageId(uuid));
          if ( rowIds.has(pageId(uuid)) ) {
            exclusive = true;
            const back = other.flags["skill-tree"].lockoutSkills ?? [];
            if ( !back.some(u => pageId(u) === p._id) ) report.oneWay.push(`${entry.name} ${treeName}: ${p.name} locks ${other.name}, not back`);
          }
          else report.crossLocks.push(`${entry.name} ${treeName}: ${p.name} (Tier ${rowNumbers.indexOf(row) + 1}) locks ${other?.name ?? "?"}`
            + ` (Tier ${rowNumbers.indexOf(other?.flags["skill-tree"].row) + 1}), different tiers, not carried over`);
        }
      }
      const nodes = rowPages.map(p => {
        const f = p.flags["skill-tree"];
        const { ability, how } = matchAbility(p, general ? "generalist" : role, treeName);
        if ( how === "none" ) report.none.push(`${entry.name} ${treeName}: ${p.name}`);
        else report[how]++;
        if ( ability && !abilityUpdates[ability._id] ) {
          const update = { tier: rowNumbers.indexOf(row) + 1 };
          // An old class ability a live tree still uses moves out of the Archive, to its tree.
          if ( /archive/i.test(ability.folder[1] ?? "") ) {
            const label = general ? null : IROP.roles[role].label;
            update.move = { source: general ? "generalist" : role, tree: treeName,
              folder: general ? ["Abilities", "Generalist"] : ["Abilities", label, treeName] };
          }
          abilityUpdates[ability._id] = update;
        }
        const requires = (f.connectedSkills ?? []).map(pageId).find(id => inTree.has(id)) ?? "";
        return {
          id: p._id,
          uuid: ability ? `Item.${ability._id}` : "",
          name: ability?.name ?? p.name,
          img: ability?.img ?? "icons/svg/item-bag.svg",
          xp: (Number(f.points) || 0) * XP_PER_POINT,
          requires
        };
      });
      // The role page's Exclusive marks fill in locks the live tree never set.
      const pagePerks = pageTiers?.[tierIndex] ?? [];
      if ( !exclusive && (nodes.length > 1) && (pagePerks.length > 1) && pagePerks.some(x => x.excl) ) {
        exclusive = true;
        report.fromPages.push(`${entry.name} ${treeName} Tier ${tierIndex + 1}: ${nodes.map(n => n.name).join(" or ")}`);
      }
      if ( pageTiers ) {
        const onlyLive = nodes.filter(n => !pagePerks.some(x => sameName(n.name, x.name))).map(n => n.name);
        const onlyPage = pagePerks.filter(x => !nodes.some(n => sameName(n.name, x.name))).map(x => x.name);
        if ( onlyLive.length || onlyPage.length ) report.placement.push(`${entry.name} ${treeName} Tier ${tierIndex + 1}: `
          + `live tree has ${onlyLive.join(", ") || "nothing else"}; role page has ${onlyPage.join(", ") || "nothing else"}`);
      }
      return { exclusive, nodes };
    });
    const label = IROP.roles[role]?.label;
    trees.push({
      _id: group.id,
      name: general ? "Generalist" : `${label}: ${treeName}`,
      type: "skillTree",
      img: "icons/svg/oak.svg",
      system: {
        role,
        kind: general ? "general" : (primary ? "primary" : "specialization"),
        tab: treeName,
        order: general ? 0 : order,
        // The Generalist perks are rows of ranks, not tiers to climb (rules for them TBD).
        gated: !general,
        tiers
      },
      folder: general ? ["Perk Trees"] : ["Perk Trees", label]
    });
  });
}

/**
 * Perks the live trees lacked, added by ruling. Each goes in as its own line at the
 * end of its tree; its node id is the ability's id, so it is stable across builds.
 *   Quick Recovery (Johnald, 2026-10-08): a Generalist perk that was never placed;
 *   20 XP, like Strong Arm, the other single attribute perk.
 */
const EXTRA = [
  { tree: "Generalist", ability: "Quick Recovery", xp: 20 }
];
for ( const extra of EXTRA ) {
  const tree = trees.find(t => t.name === extra.tree);
  const ability = live.find(a => a.name === extra.ability);
  if ( !tree || !ability ) throw new Error(`Extra perk not placed: ${extra.ability} in ${extra.tree}`);
  if ( tree.system.tiers.some(t => t.nodes.some(n => n.uuid === `Item.${ability._id}`)) ) continue;
  tree.system.tiers.push({ exclusive: false, nodes: [{
    id: ability._id, uuid: `Item.${ability._id}`, name: ability.name, img: ability.img, xp: extra.xp, requires: ""
  }] });
  abilityUpdates[ability._id] ??= { tier: tree.system.tiers.length };
  console.log(`  ADDED ${extra.ability} to ${extra.tree}, ${extra.xp} XP`);
}

// Check every tree against the real data model.
const problems = [];
for ( const t of trees ) {
  try { new SkillTreeData(t.system, { strict: true }); }
  catch(err) { problems.push(`${t.name}: ${err.message.split("\n").slice(0, 3).join(" ")}`); }
  if ( !/^[A-Za-z0-9]{16}$/.test(t._id) ) problems.push(`${t.name}: id ${t._id}`);
}

fs.writeFileSync(path.join(ROOT, "assets", "data", "sandbox-trees.json"), JSON.stringify({ trees, abilityUpdates }));

// The same into the abilities data, so a fresh import has them from the start.
for ( const a of abilities ) {
  const update = abilityUpdates[a._id];
  if ( !update ) continue;
  a.system.tier = update.tier;
  if ( update.move ) {
    Object.assign(a.system, { source: update.move.source, tree: update.move.tree });
    a.folder = update.move.folder;
  }
}
fs.writeFileSync(path.join(ROOT, "assets", "data", "sandbox-abilities.json"), JSON.stringify(abilities));
const moved = Object.entries(abilityUpdates).filter(([, u]) => u.move).map(([id, u]) => `${byId.get(id).name} to ${u.move.folder.slice(1).join("/")}`);
console.log(`${Object.keys(abilityUpdates).length} abilities given their tier; moved out of the Archive: ${moved.join(", ")}`);

for ( const t of trees ) {
  const nodes = t.system.tiers.flatMap(x => x.nodes);
  console.log(`${t.name.padEnd(28)} ${String(t.system.tiers.length).padStart(2)} tiers ${String(nodes.length).padStart(2)} perks `
    + `${String(t.system.tiers.filter(x => x.exclusive).length).padStart(2)} Pick one  ${nodes.reduce((s, n) => s + n.xp, 0)} XP to own all`);
}
console.log(`${trees.length} trees; perks matched: ${report.linked} by link, ${report.name} by name, ${report.rankless} without the rank numeral, `
  + `${report.none.length} unmatched; ${problems.length} validation problems`);
report.none.forEach(s => console.log("  UNMATCHED " + s));
report.crossLocks.forEach(s => console.log("  CROSS TIER " + s));
report.oneWay.forEach(s => console.log("  ONE WAY " + s));
report.fromPages.forEach(s => console.log("  PICK ONE FROM ROLE PAGE " + s));
report.placement.forEach(s => console.log("  PLACEMENT " + s));
problems.forEach(s => console.log("  PROBLEM " + s));

/**
 * Bringing content from the old Sandbox world into an Insurrection world.
 *
 * importAbilities (2026-10-08): every ability, perk and paraphysics power from the
 * Sandbox game, converted by dev/build-abilities.mjs into assets/data. They land
 * in the Items sidebar under Abilities, by role and tree, as ordinary world items
 * the GM can edit.
 *
 * importTrees (2026-10-08): the live game's 25 perk trees (each role's Primary and
 * three specializations, and the Generalist perks), converted by
 * dev/build-trees.mjs. They land under Perk Trees and point at the abilities by
 * id, so any abilities not yet imported come in first.
 *
 * Everything keeps its Sandbox id, so running either again skips what is there. A
 * tree already in the world is left as the GM has it, except that perks new to the
 * import (Quick Recovery, added to the Generalist tree 2026-10-08) are offered and,
 * if accepted, added to it.
 */

const ABILITIES = "systems/irop/assets/data/sandbox-abilities.json";
const TREES = "systems/irop/assets/data/sandbox-trees.json";

/** A data file shipped with the system, or null (and an error shown) if missing. */
async function load(url) {
  const response = await fetch(url);
  if ( response.ok ) return response.json();
  ui.notifications.error("Import data is missing from the system. Reinstall the Insurrection system.");
  return null;
}

/** Find or make an Item folder by its path of names, e.g. ["Abilities", "Legionary", "Primary"]. */
async function folderFor(names, cache) {
  const key = names.join("/");
  if ( cache.has(key) ) return cache.get(key);
  const parent = names.length > 1 ? await folderFor(names.slice(0, -1), cache) : null;
  const name = names.at(-1);
  let folder = game.folders.find(f => (f.type === "Item") && (f.name === name) && ((f.folder?.id ?? null) === (parent?.id ?? null)));
  folder ??= await Folder.create({ name, type: "Item", folder: parent?.id ?? null, sorting: "a" });
  cache.set(key, folder);
  return folder;
}

/** Create items filed by their folder path, keeping their ids, in batches. */
async function createFiled(list) {
  const cache = new Map();
  const data = [];
  for ( const { folder, ...d } of list ) {
    const f = await folderFor(folder, cache);
    data.push({ ...d, folder: f.id });
  }
  let created = 0;
  for ( let i = 0; i < data.length; i += 100 ) {
    const docs = await Item.createDocuments(data.slice(i, i + 100), { keepId: true });
    created += docs.length;
  }
  return created;
}

function gmOnly(what) {
  if ( game.user.isGM ) return true;
  ui.notifications.error(`Only a GM can import ${what}.`);
  return false;
}

/**
 * GM: import the Sandbox abilities into this world's Items.
 * @param {object} [options]
 * @param {boolean} [options.confirm=true]   Ask first
 * @returns {Promise<{created: number, skipped: number}|null>}
 */
export async function importAbilities({ confirm = true } = {}) {
  if ( !gmOnly("abilities") ) return null;
  const list = await load(ABILITIES);
  if ( !list ) return null;
  const fresh = list.filter(d => !game.items.has(d._id));
  if ( !fresh.length ) {
    if ( confirm ) ui.notifications.info(`All ${list.length} Sandbox abilities are already in this world.`);
    return { created: 0, skipped: list.length };
  }
  if ( confirm ) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Import Sandbox abilities" },
      content: `<p>Add ${fresh.length} abilities from the Sandbox game to the Items sidebar, under Abilities, by role and tree?</p>`
        + (fresh.length < list.length ? `<p>${list.length - fresh.length} already here are left as they are.</p>` : "")
    });
    if ( !ok ) return null;
  }
  const created = await createFiled(fresh);
  ui.notifications.info(`Imported ${created} abilities from the Sandbox game into Items, under Abilities.`);
  return { created, skipped: list.length - fresh.length };
}

/**
 * Perks in the import's version of a tree that the world's copy lacks: not there by
 * node id, nor by the ability they point at (a GM may have dropped it in already).
 * Each goes into the tier at the same place, or a new one at the end.
 * @param {object[]} worldTiers   The world tree's tiers (source data)
 * @param {object[]} dataTiers    The import's tiers
 * @returns {{tiers: object[], added: object[]}}  The new tiers, and the nodes added
 */
export function addMissingPerks(worldTiers, dataTiers) {
  const tiers = foundry.utils.deepClone(worldTiers);
  const have = new Set(tiers.flatMap(t => t.nodes.flatMap(n => [n.id, n.uuid].filter(Boolean))));
  const added = [];
  dataTiers.forEach((tier, index) => {
    // The world tier at the same place, or (made once, for all this tier's new perks) a new one.
    let target = (index < worldTiers.length) ? index : null;
    for ( const node of tier.nodes ) {
      if ( have.has(node.id) || (node.uuid && have.has(node.uuid)) ) continue;
      if ( target === null ) {
        tiers.push({ exclusive: !!tier.exclusive, nodes: [] });
        target = tiers.length - 1;
      }
      tiers[target].nodes.push(foundry.utils.deepClone(node));
      added.push(node);
    }
  });
  return { tiers, added };
}

/**
 * GM: import the Sandbox perk trees, and first any abilities they use that are not
 * here yet. Abilities imported before the trees get their tier from them (only
 * where it is still the default 1, so a GM's own edit stands).
 * @param {object} [options]
 * @param {boolean} [options.confirm=true]   Ask first
 * @returns {Promise<{created: number, skipped: number, abilities: number, tiers: number}|null>}
 */
export async function importTrees({ confirm = true } = {}) {
  if ( !gmOnly("perk trees") ) return null;
  const data = await load(TREES);
  const abilities = await load(ABILITIES);
  if ( !data || !abilities ) return null;
  const fresh = data.trees.filter(t => !game.items.has(t._id));
  const missing = abilities.filter(a => !game.items.has(a._id)).length;
  // Trees already here that lack perks the import now has.
  const grow = data.trees.filter(t => game.items.has(t._id)).map(t => {
    const item = game.items.get(t._id);
    return { item, ...addMissingPerks(item.system._source?.tiers ?? item.system.tiers ?? [], t.system.tiers) };
  }).filter(g => g.added.length);
  if ( !fresh.length && !grow.length ) {
    if ( confirm ) ui.notifications.info(`All ${data.trees.length} perk trees are already in this world.`);
    return { created: 0, skipped: data.trees.length, abilities: 0, tiers: 0, grown: 0 };
  }
  if ( confirm ) {
    const growing = grow.flatMap(g => g.added.map(n => `${n.name} (${g.item.name})`));
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Import Sandbox perk trees" },
      content: (fresh.length ? `<p>Add ${fresh.length} perk trees from the Sandbox game to the Items sidebar, under Perk Trees?</p>` : "")
        + (growing.length ? `<p>Add perks new to the import to trees already here: ${growing.join(", ")}?</p>` : "")
        + (missing ? `<p>The ${missing} abilities they use are imported first, under Abilities.</p>` : "")
        + ((fresh.length && (fresh.length < data.trees.length)) ? `<p>Trees already here are otherwise left as they are.</p>` : "")
    });
    if ( !ok ) return null;
  }
  const added = missing ? ((await importAbilities({ confirm: false }))?.created ?? 0) : 0;

  // Abilities imported earlier learn their tier, and any the trees moved out of the Archive move.
  const updates = [];
  const cache = new Map();
  for ( const [id, u] of Object.entries(data.abilityUpdates ?? {}) ) {
    const item = game.items.get(id);
    if ( !item ) continue;
    const update = {};
    if ( (item.system.tier === 1) && (u.tier !== 1) ) update["system.tier"] = u.tier;
    if ( u.move && (item.system.source === "other") ) {
      Object.assign(update, { "system.source": u.move.source, "system.tree": u.move.tree,
        folder: (await folderFor(u.move.folder, cache)).id });
    }
    if ( Object.keys(update).length ) updates.push({ _id: id, ...update });
  }
  if ( updates.length ) await Item.updateDocuments(updates);

  for ( const g of grow ) await g.item.update({ "system.tiers": g.tiers });
  const grown = grow.reduce((sum, g) => sum + g.added.length, 0);
  const created = fresh.length ? await createFiled(fresh) : 0;
  ui.notifications.info([
    created ? `Imported ${created} perk trees into Items, under Perk Trees.` : "",
    grown ? `Added ${grown} new perk${grown === 1 ? "" : "s"} to trees already here.` : "",
    added ? `Imported ${added} abilities under Abilities.` : ""
  ].filter(Boolean).join(" "));
  return { created, skipped: data.trees.length - fresh.length, abilities: added, tiers: updates.length, grown };
}

/**
 * GM: import the campaign's territories (2026-10-08), built by
 * dev/build-territories.mjs from the vault's sixteen region notes. They land in the
 * Items sidebar under Territories with STARTING values from the old Lore journal
 * tracks; the GM sets the real Strength, Heat, Reputation and neighbours. A
 * territory already here by name is left as it is.
 * @param {object} [options]
 * @param {boolean} [options.confirm=true]   Ask first
 * @returns {Promise<{created: number, skipped: number}|null>}
 */
export async function importTerritories({ confirm = true } = {}) {
  if ( !gmOnly("territories") ) return null;
  const list = await load("systems/irop/assets/data/territories.json");
  if ( !list ) return null;
  const have = new Set(game.items.filter(i => i.type === "territory").map(i => i.name));
  const fresh = list.filter(t => !have.has(t.name));
  if ( !fresh.length ) {
    if ( confirm ) ui.notifications.info(`All ${list.length} territories are already in this world.`);
    return { created: 0, skipped: list.length };
  }
  if ( confirm ) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Import territories" },
      content: `<p>Add ${fresh.length} territories to the Items sidebar, under Territories?</p>`
        + "<p>Their Strength and Heat are starting values from the old Lore journal tracks. Set the real ones, and each territory's neighbors, on its sheet.</p>"
    });
    if ( !ok ) return null;
  }
  const cache = new Map();
  const data = [];
  for ( const { folder, ...t } of fresh ) data.push({ ...t, folder: (await folderFor(folder, cache)).id });
  const docs = await Item.createDocuments(data);
  ui.notifications.info(`Imported ${docs.length} territories into Items, under Territories.`);
  return { created: docs.length, skipped: list.length - fresh.length };
}

/**
 * GM: import the doc's example projects (Strategy Layer step 5, 2026-10-08): Armory
 * Refit, the SAM Site and Training Facility, and the twelve Intelligence Actions,
 * under Projects. Their costs, and what each Intelligence Action reveals, are
 * PLACEHOLDERS (the doc leaves costs to the GM): set your own on each project.
 * @param {object} [options]
 * @param {boolean} [options.confirm=true]   Ask first
 * @returns {Promise<{created: number, skipped: number}|null>}
 */
export async function importProjects({ confirm = true } = {}) {
  if ( !gmOnly("projects") ) return null;
  const list = await load("systems/irop/assets/data/projects.json");
  if ( !list ) return null;
  const have = new Set(game.items.filter(i => i.type === "project").map(i => i.name));
  const fresh = list.filter(p => !have.has(p.name));
  if ( !fresh.length ) {
    if ( confirm ) ui.notifications.info(`All ${list.length} example projects are already in this world.`);
    return { created: 0, skipped: list.length };
  }
  if ( confirm ) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Import projects" },
      content: `<p>Add ${fresh.length} projects from the rules doc to the Items sidebar, under Projects?</p>`
        + "<p>Their costs, and the Tactical Action each Intelligence Action reveals, are placeholders. Set your own on each project.</p>"
    });
    if ( !ok ) return null;
  }
  const cache = new Map();
  const data = [];
  for ( const { folder, ...p } of fresh ) data.push({ ...p, folder: (await folderFor(folder, cache)).id });
  const docs = await Item.createDocuments(data);
  ui.notifications.info(`Imported ${docs.length} projects into Items, under Projects.`);
  return { created: docs.length, skipped: list.length - fresh.length };
}

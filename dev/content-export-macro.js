/**
 * Export this world's game content to a file (Johnald, 2026-10-11), for
 * dev/content-import-macro.js to bring into another world, such as the one on Sqyre.
 * Run as the GM, as a script macro, in the world that has the content.
 *
 * You pick the kinds of item: species, roles, backgrounds, abilities and perks, perk
 * trees, boons, mutations, weapons, armor, gear and mods by default, and territories and
 * projects if you want the campaign's too. Each item goes with its effects, its flags and
 * its folder, and keeps its id, so backgrounds and perk trees still point at their perks
 * on the other side. Who owns what is left out, as the other world has its own players.
 *
 * The file lands in your Downloads as irop-content-<date>.json. The summary lists any
 * pictures outside the system's and Foundry's own folders: those must be uploaded to the
 * other world under the same paths, or its items show a broken picture.
 */
(async () => {
  const KINDS = {
    species: { label: "Species", on: true },
    role: { label: "Roles", on: true },
    background: { label: "Backgrounds", on: true },
    ability: { label: "Abilities and perks", on: true },
    skillTree: { label: "Perk trees", on: true },
    boon: { label: "Boons", on: true },
    mutation: { label: "Mutations", on: true },
    weapon: { label: "Weapons", on: true },
    armor: { label: "Armor", on: true },
    gear: { label: "Gear", on: true },
    mod: { label: "Mods", on: true },
    territory: { label: "Territories (the campaign's map)", on: false },
    project: { label: "Projects (Research, Engineering, Intelligence)", on: false }
  };
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  if ( game.system.id !== "irop" ) return ui.notifications.error("This world is not on the Insurrection system.");
  const esc = s => foundry.utils.escapeHTML(String(s));

  // Pick what goes.
  const count = type => game.items.filter(i => i.type === type).length;
  const rows = Object.entries(KINDS).map(([type, k]) => {
    const n = count(type);
    return `<label class="check-row"><input type="checkbox" name="${type}" ${k.on && n ? "checked" : ""} ${n ? "" : "disabled"}> ${esc(k.label)} <span class="hint">(${n})</span></label>`;
  }).join("");
  const picked = await foundry.applications.api.DialogV2.input({
    window: { title: "Export game content" },
    position: { width: 420 },
    content: `<p>What goes in the file? Each item keeps its id, effects and folder.</p>${rows}`,
    ok: { label: "Export", icon: "fa-solid fa-file-export" },
    rejectClose: false
  });
  if ( !picked ) return null;
  const types = Object.keys(KINDS).filter(t => picked[t]);
  if ( !types.length ) return ui.notifications.warn("Nothing picked to export.");

  // The items, as Foundry exports a document, keeping the id, folder and order.
  const items = game.items.filter(i => types.includes(i.type))
    .sort((a, b) => (Object.keys(KINDS).indexOf(a.type) - Object.keys(KINDS).indexOf(b.type)) || a.name.localeCompare(b.name))
    .map(i => {
      const data = i.toCompendium(null, { keepId: true, clearSort: false, clearFolder: false, clearOwnership: true, clearSource: true });
      delete data._stats;
      for ( const e of data.effects ?? [] ) delete e._stats;
      return data;
    });

  // Their folders, and every folder above them.
  const folders = new Map();
  const addFolder = id => {
    const f = id ? game.folders.get(id) : null;
    if ( !f || folders.has(f.id) ) return;
    folders.set(f.id, { _id: f.id, name: f.name, type: f.type, folder: f.folder?.id ?? null, sorting: f.sorting, sort: f.sort, color: f.color ? (f.color.css ?? String(f.color)) : null });
    addFolder(f.folder?.id);
  };
  for ( const i of items ) addFolder(i.folder);

  // What points at another item (background perks, perk tree nodes) and is not in the file.
  const ids = new Set(items.map(i => i._id));
  const dangling = [];
  for ( const i of items ) {
    const refs = [...(i.system?.perks ?? []), ...(i.system?.tiers ?? []).flatMap(t => t.nodes ?? [])];
    for ( const r of refs ) {
      const m = String(r.uuid ?? "").match(/^Item\.([A-Za-z0-9]{16})$/);
      if ( m && !ids.has(m[1]) ) dangling.push(`${i.name}: ${r.name || m[1]}`);
    }
  }

  // Pictures the other world must have under the same path.
  const own = p => !p || /^(icons|systems|modules|ui|cards)\//.test(p) || /^(https?:|data:)/.test(p);
  const images = new Set();
  const look = p => { if ( !own(p) ) images.add(p); };
  for ( const i of items ) {
    look(i.img);
    for ( const e of i.effects ?? [] ) look(e.img);
    for ( const r of [...(i.system?.perks ?? []), ...(i.system?.tiers ?? []).flatMap(t => t.nodes ?? [])] ) look(r.img);
    look(i.system?.art);
  }

  const file = {
    format: "irop-content", version: 1,
    exported: new Date().toISOString(), world: game.world.title, system: game.system.version,
    types, folders: [...folders.values()], items, images: [...images].sort()
  };
  const stamp = new Date().toISOString().slice(0, 10);
  foundry.utils.saveDataToFile(JSON.stringify(file), "application/json", `irop-content-${stamp}.json`);

  const byType = types.map(t => `<li>${esc(KINDS[t].label)}: ${items.filter(i => i.type === t).length}</li>`).join("");
  const list = (title, arr) => (arr.length ? `<p><strong>${title}</strong></p><ul>${arr.slice(0, 40).map(x => `<li>${esc(x)}</li>`).join("")}${arr.length > 40 ? `<li>and ${arr.length - 40} more</li>` : ""}</ul>` : "");
  await foundry.applications.api.DialogV2.prompt({
    window: { title: "Exported" },
    position: { width: 520 },
    content: `<p>${items.length} items in ${folders.size} folders, saved as <strong>irop-content-${stamp}.json</strong> in your Downloads.</p><ul>${byType}</ul>`
      + list(`${images.size} pictures outside the system's folders. The other world needs them under the same paths:`, [...images].sort())
      + list(`${dangling.length} perks point at items not in the file, so they will not resolve there:`, dangling),
    ok: { label: "Done" }
  });
  return file;
})();

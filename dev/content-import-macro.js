/**
 * Import game content from a file made by dev/content-export-macro.js (Johnald, 2026-10-11),
 * for example into the world on Sqyre. Run as the GM, as a script macro, and pick the file.
 *
 * Each item in the file is matched to one already here, by id first, then by kind and name:
 *   - New ones are created in the file's folders (made here if missing), keeping their ids.
 *   - Matches are updated to the file (name, picture, rules, effects, flags), or left as they
 *     are if you choose; either way they stay in the folder you keep them in.
 *   - A match found by name has another id here, so everything in the file that points at it
 *     (a background's perks, a perk tree's nodes, links in descriptions) is pointed at the
 *     one here instead. Nothing ends up pointing at an item that is not in this world.
 * Before anything changes it shows what it will do, and waits for you to say go.
 * At the end it lists any pictures the file uses that this world does not have.
 */
(async () => {
  const LABELS = {
    species: "Species", role: "Roles", background: "Backgrounds", ability: "Abilities and perks", skillTree: "Perk trees",
    boon: "Boons", mutation: "Mutations", weapon: "Weapons", armor: "Armor", gear: "Gear", mod: "Mods",
    territory: "Territories", project: "Projects"
  };
  const esc = s => foundry.utils.escapeHTML(String(s));
  const { DialogV2 } = foundry.applications.api;

  /**
   * What to do with each item in the file, given the items already here. Pure, so it can be
   * tested: world is a list of {id, type, name}.
   * @returns {{create: object[], update: object[], keep: object[], remap: Map<string, string>}}
   *   remap: an id in the file to the id of its match here, where they differ
   */
  function planImport(fileItems, world, { update = true } = {}) {
    const byId = new Map(world.map(w => [w.id, w]));
    const byName = new Map();
    for ( const w of world ) {
      const key = `${w.type}|${w.name}`;
      byName.set(key, byName.has(key) ? null : w); // two of the same name: no match by name
    }
    const taken = new Set(world.map(w => w.id));
    const plan = { create: [], update: [], keep: [], remap: new Map() };
    for ( const item of fileItems ) {
      const same = byId.get(item._id);
      let match = (same && (same.type === item.type)) ? same : null;
      if ( !match ) match = byName.get(`${item.type}|${item.name}`) ?? null;
      if ( match ) {
        if ( match.id !== item._id ) plan.remap.set(item._id, match.id);
        (update ? plan.update : plan.keep).push({ item, id: match.id });
        continue;
      }
      // New. Its id is kept unless something else here already has it.
      if ( taken.has(item._id) ) {
        const id = foundry.utils.randomID();
        plan.remap.set(item._id, id);
        plan.create.push({ item, id });
        taken.add(id);
      }
      else {
        plan.create.push({ item, id: item._id });
        taken.add(item._id);
      }
    }
    return plan;
  }

  /** An item's data with every "Item.<old id>" pointed at the id it has here (whole ids only). */
  function remapped(data, remap) {
    if ( !remap.size ) return data;
    const json = JSON.stringify(data).replace(/Item\.([A-Za-z0-9]+)/g, (all, id) => (remap.has(id) ? `Item.${remap.get(id)}` : all));
    return JSON.parse(json);
  }

  // Tests load this file with this hook set; in Foundry it is never there.
  if ( globalThis.__iropContentImportTest ) return globalThis.__iropContentImportTest({ planImport, remapped });

  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  if ( game.system.id !== "irop" ) return ui.notifications.error("This world is not on the Insurrection system.");

  // The file, and what to do with matches.
  const picked = await DialogV2.prompt({
    window: { title: "Import game content" },
    position: { width: 460 },
    content: `<p>Pick a file made by the Export game content macro.</p>
      <p><input type="file" name="file" accept=".json,application/json"></p>
      <p><strong>Items already in this world</strong></p>
      <label class="check-row"><input type="radio" name="mode" value="update" checked> Update them to match the file</label>
      <label class="check-row"><input type="radio" name="mode" value="keep"> Leave them as they are</label>`,
    ok: {
      label: "Read the file", icon: "fa-solid fa-file-import",
      callback: async (event, button) => {
        const f = button.form.elements.file.files?.[0];
        return f ? { text: await f.text(), name: f.name, update: button.form.elements.mode.value === "update" } : { text: null };
      }
    },
    rejectClose: false
  });
  if ( !picked ) return null;
  if ( !picked.text ) return ui.notifications.warn("No file picked.");
  let file;
  try { file = JSON.parse(picked.text); }
  catch { return ui.notifications.error(`${picked.name} is not a JSON file.`); }
  if ( (file?.format !== "irop-content") || !Array.isArray(file.items) ) {
    return ui.notifications.error(`${picked.name} was not made by the Export game content macro.`);
  }

  const world = game.items.map(i => ({ id: i.id, type: i.type, name: i.name }));
  const plan = planImport(file.items, world, { update: picked.update });
  const kinds = [...new Set(file.items.map(i => i.type))];
  const rows = kinds.map(t => {
    const n = list => list.filter(x => x.item.type === t).length;
    return `<tr><td>${esc(LABELS[t] ?? t)}</td><td>${n(plan.create)}</td><td>${picked.update ? n(plan.update) : n(plan.keep)}</td></tr>`;
  }).join("");
  const unknown = kinds.filter(t => !CONFIG.Item.dataModels?.[t]);
  const go = await DialogV2.confirm({
    window: { title: "Import game content" },
    position: { width: 480 },
    content: `<p>${esc(picked.name)}: ${file.items.length} items from ${esc(file.world ?? "another world")}, Insurrection ${esc(file.system ?? "")} (this world: ${esc(game.system.version)}).</p>
      <table><thead><tr><th></th><th>New</th><th>${picked.update ? "Updated" : "Left as they are"}</th></tr></thead><tbody>${rows}</tbody></table>
      ${plan.remap.size ? `<p>${plan.remap.size} match items here under another id; what points at them is pointed at the ones here.</p>` : ""}
      ${unknown.length ? `<p><strong>This system has no ${esc(unknown.join(", "))}; those are skipped.</strong></p>` : ""}
      <p>Go ahead?</p>`,
    rejectClose: false
  });
  if ( !go ) return null;
  const known = entry => !unknown.includes(entry.item.type);

  // Folders, matched by their path of names, made where missing.
  const fileFolders = new Map((file.folders ?? []).map(f => [f._id, f]));
  const madeFolders = new Map();
  const folderHere = async id => {
    const f = fileFolders.get(id);
    if ( !f ) return null;
    if ( madeFolders.has(id) ) return madeFolders.get(id);
    const parent = f.folder ? await folderHere(f.folder) : null;
    let here = game.folders.find(x => (x.type === "Item") && (x.name === f.name) && ((x.folder?.id ?? null) === (parent?.id ?? null)));
    here ??= await Folder.create({ name: f.name, type: "Item", folder: parent?.id ?? null, sorting: f.sorting ?? "a", sort: f.sort ?? 0, color: f.color ?? null });
    madeFolders.set(id, here);
    return here;
  };

  // New items, keeping their ids where they can.
  const createData = [];
  for ( const { item, id } of plan.create.filter(known) ) {
    const data = remapped(item, plan.remap);
    data._id = id;
    data.folder = (await folderHere(item.folder))?.id ?? null;
    delete data._stats;
    for ( const e of data.effects ?? [] ) delete e._stats;
    createData.push(data);
  }
  let created = 0;
  for ( let i = 0; i < createData.length; i += 100 ) {
    const docs = await Item.createDocuments(createData.slice(i, i + 100), { keepId: true });
    created += docs.length;
  }

  // Matches, brought up to the file: rules, picture and flags; effects made to match. They keep their folder.
  let updated = 0;
  let unchanged = 0;
  const strip = list => (list ?? []).map(e => { const c = foundry.utils.deepClone(e); delete c._stats; return c; });
  for ( const { item, id } of plan.update.filter(known) ) {
    const doc = game.items.get(id);
    if ( !doc ) continue;
    const data = remapped(item, plan.remap);
    const now = doc.toObject();
    const effects = strip(data.effects);
    const same = (now.name === data.name) && (now.img === data.img)
      && (JSON.stringify(now.system) === JSON.stringify(data.system))
      && (JSON.stringify(strip(now.effects)) === JSON.stringify(effects));
    if ( same ) { unchanged++; continue; }
    await doc.update({ name: data.name, img: data.img, system: data.system, flags: data.flags ?? {} });
    const want = new Map(effects.map(e => [e._id, e]));
    const gone = doc.effects.filter(e => !want.has(e.id)).map(e => e.id);
    if ( gone.length ) await doc.deleteEmbeddedDocuments("ActiveEffect", gone);
    const change = effects.filter(e => doc.effects.has(e._id));
    if ( change.length ) await doc.updateEmbeddedDocuments("ActiveEffect", change);
    const add = effects.filter(e => !doc.effects.has(e._id));
    if ( add.length ) await doc.createEmbeddedDocuments("ActiveEffect", add, { keepId: true });
    updated++;
  }

  // Pictures the file uses that this world does not have.
  const missing = [];
  for ( const path of file.images ?? [] ) {
    try {
      const r = await fetch(encodeURI(path), { method: "HEAD" });
      if ( !r.ok ) missing.push(path);
    }
    catch { missing.push(path); }
  }

  const kept = plan.keep.filter(known).length;
  const lines = [
    `${created} created`,
    picked.update ? `${updated} updated` : "",
    (picked.update && unchanged) ? `${unchanged} already matched the file` : "",
    kept ? `${kept} left as they are` : ""
  ].filter(Boolean).join(", ");
  ui.notifications.info(`Imported game content: ${lines}.`);
  await DialogV2.prompt({
    window: { title: "Imported" },
    position: { width: 520 },
    content: `<p>${esc(lines)}.</p>`
      + (missing.length ? `<p><strong>${missing.length} pictures are not in this world.</strong> Upload them under the same paths, or those items show a broken picture:</p>
        <ul>${missing.slice(0, 40).map(p => `<li>${esc(p)}</li>`).join("")}${missing.length > 40 ? `<li>and ${missing.length - 40} more</li>` : ""}</ul>`
        : "<p>Every picture the file uses is here.</p>"),
    ok: { label: "Done" }
  });
  return { created, updated, unchanged, kept, missing };
})();

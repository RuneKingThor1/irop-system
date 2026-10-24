/**
 * Export the creatures from the old Sandbox world (Johnald, 2026-10-22), so they can be brought
 * into the irop system. Run as the GM, as a script macro, in the Sandbox world.
 *
 * You pick a folder of actors (or all of them, or only the tokens you have selected). For each
 * actor the file keeps everything as it is: its name, picture, type, folder, its whole system
 * data, its items and its token. Sandbox keys are whatever the world's templates named them, so
 * nothing is translated here; each actor also gets a flat "attributes" list (key: value) of its
 * Sandbox properties, which is the easy part to read when mapping them to irop fields.
 *
 * The file lands in your Downloads as sandbox-creatures-<date>.json.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const { DialogV2 } = foundry.applications.api;
  const esc = s => foundry.utils.escapeHTML(String(s));

  const folders = game.folders.filter(f => f.type === "Actor").sort((a, b) => a.name.localeCompare(b.name));
  const selected = canvas?.tokens?.controlled?.map(t => t.actor).filter(Boolean) ?? [];
  const options = [
    `<option value="__all">All actors (${game.actors.size})</option>`,
    selected.length ? `<option value="__selected">Selected tokens (${selected.length})</option>` : "",
    ...folders.map(f => `<option value="${f.id}">${esc(f.name)} (${f.contents.length})</option>`)
  ].join("");
  const pick = await DialogV2.prompt({
    window: { title: "Export creatures" },
    content: `<p>Which actors?</p><select name="which" style="width:100%">${options}</select>
      <label style="display:flex;gap:6px;margin-top:8px"><input type="checkbox" name="sub" checked> Include folders inside it</label>
      <label style="display:flex;gap:6px"><input type="checkbox" name="noPlayers" checked> Leave out player characters</label>`,
    ok: { label: "Export", callback: (event, button) => ({
      which: button.form.elements.which.value, sub: button.form.elements.sub.checked, noPlayers: button.form.elements.noPlayers.checked
    }) },
    rejectClose: false
  });
  if ( !pick ) return;

  const inFolder = (actor, folder) => {
    for ( let f = actor.folder; f; f = pick.sub ? f.folder : null ) if ( f.id === folder.id ) return true;
    return false;
  };
  let actors;
  if ( pick.which === "__all" ) actors = [...game.actors];
  else if ( pick.which === "__selected" ) actors = [...new Set(selected)];
  else { const folder = game.folders.get(pick.which); actors = game.actors.filter(a => inFolder(a, folder)); }
  if ( pick.noPlayers ) actors = actors.filter(a => !a.hasPlayerOwner);
  if ( !actors.length ) return ui.notifications.warn("No actors to export.");

  // Sandbox keeps a sheet's properties in system.attributes as {key: {value, max, ...}}.
  const flat = attrs => Object.fromEntries(Object.entries(attrs ?? {}).map(([k, v]) => {
    if ( (v === null) || (typeof v !== "object") ) return [k, v];
    const out = { value: v.value };
    if ( (v.max !== undefined) && (v.max !== "") ) out.max = v.max;
    return [k, (Object.keys(out).length === 1) ? out.value : out];
  }));
  const folderPath = f => { const parts = []; for ( ; f; f = f.folder ) parts.unshift(f.name); return parts.join(" / "); };

  const data = actors.map(a => {
    const raw = a.toObject();
    return {
      id: a.id, name: a.name, type: a.type, img: a.img, folder: folderPath(a.folder),
      template: a.system?.template ?? null,
      attributes: flat(a.system?.attributes),
      items: a.items.map(i => ({ name: i.name, type: i.type, img: i.img, template: i.system?.template ?? null,
        attributes: flat(i.system?.attributes), system: i.toObject().system })),
      // Sandbox also lists its sheet items in system.citems.
      citems: (a.system?.citems ?? []).map(c => ({ name: c.name, id: c.id, ciKey: c.ciKey, number: c.number })),
      token: { name: raw.prototypeToken?.name, img: raw.prototypeToken?.texture?.src, width: raw.prototypeToken?.width, height: raw.prototypeToken?.height },
      system: raw.system,
      effects: raw.effects
    };
  });
  const file = { exported: new Date().toISOString(), world: game.world.id, system: game.system.id,
    systemVersion: game.system.version, count: data.length, actors: data };
  const date = new Date().toISOString().slice(0, 10);
  foundry.utils.saveDataToFile(JSON.stringify(file, null, 2), "application/json", `sandbox-creatures-${date}.json`);
  ui.notifications.info(`Exported ${data.length} creature${data.length === 1 ? "" : "s"}.`);
})();

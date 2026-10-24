/**
 * Import the creatures exported from the old Sandbox world (Johnald, 2026-10-22), from the file
 * dev/sandbox-creatures-export-macro.js made, as irop NPCs. Run as the GM, as a script macro, in
 * the irop world, and pick the file.
 *
 * For each creature it makes an NPC (or rewrites the one already named so, if you choose) with:
 *   - its seven attributes, skill ranks and discipline ranks (Sandbox's "Energy" is Astrokinesis);
 *   - its items: every Sandbox item is matched by name to one in this world's Items sidebar and
 *     copied on (species, weapons, armor, abilities). One with no match is listed at the end;
 *   - Health, Energy, Armor HP and DR as the Sandbox sheet had them: whatever the species, armor
 *     and attributes do not already give is made up on the sheet's bonus, so the totals match;
 *   - its folder (under "Sandbox Imports"), picture, token, faction (from the folder), caste
 *     (Serf, Vassal, Baron, Monarch from its role), threat (Chaff is a Minion, else Soldier), and
 *     its Sandbox role in the notes.
 * Before anything changes it shows what it will do, and waits for you to say go.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const { DialogV2 } = foundry.applications.api;
  const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // Pick the file.
  const text = await new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.onchange = () => input.files[0] ? input.files[0].text().then(resolve) : resolve(null);
    input.click();
  });
  if ( !text ) return;
  let file;
  try { file = JSON.parse(text); } catch ( e ) { return ui.notifications.error("That file is not JSON."); }
  const list = file?.actors;
  if ( !Array.isArray(list) || !list.length ) return ui.notifications.error("No creatures in that file.");

  // Sandbox keys to irop.
  const SKILLS = { acro: "acrobatics", athl: "athletics", awre: "awareness", stlh: "stealth", hist: "history",
    cybr: "cybernetics", biol: "biology", xbio: "xenobiology", tech: "technology", xtec: "xenotech", para: "paraphysics",
    mech: "mechanics", hack: "hacking", medi: "medical", lock: "lockpicking", tact: "tactics", surv: "survival",
    invs: "investigation", pers: "persuasion", coer: "coercion", dece: "deception", insi: "insight" };
  const DR = { ballistic: "ballistic", physical: "physical", laser: "laser", plasma: "plasma", fire: "fire", cold: "cold",
    acid: "acid", lightning: "electric", sonic: "sonic", explosive: "explosive", psychic: "psychic", cosmic: "cosmic" };
  const DISCIPLINES = { telepathy: "telepathy", telekinesis: "telekinesis", spatial: "spatial", energy: "astrokinesis" };
  const val = (a, k) => { const v = a.attributes?.[k]; return Number((v && typeof v === "object") ? v.value : v) || 0; };
  const maxOf = (a, k) => { const v = a.attributes?.[k]; return Number((v && typeof v === "object") ? (v.max ?? v.value) : v) || 0; };
  const casteOf = role => ["serf", "vassal", "baron", "monarch"].find(c => fold(role).includes(c)) ?? "";

  const worldItems = game.items.contents;
  const findItem = name => worldItems.find(i => fold(i.name) === fold(name)) ?? null;

  // The plan, shown first.
  const rows = list.map(a => {
    const names = (a.citems?.length ? a.citems.map(c => c.name) : (a.items ?? []).map(i => i.name)).filter(Boolean);
    const found = names.map(n => ({ name: n, item: findItem(n) }));
    return { a, found, missing: found.filter(f => !f.item).map(f => f.name), existing: game.actors.find(x => (x.type === "npc") && (x.name === a.name)) };
  });
  const missingAll = [...new Set(rows.flatMap(r => r.missing))];
  const go = await DialogV2.wait({
    window: { title: "Import Sandbox creatures" },
    content: `<p>${rows.length} creatures. ${rows.filter(r => r.existing).length} already have an NPC of the same name here.</p>
      ${missingAll.length ? `<p>These items are not in this world's Items sidebar, so they will be left off (listed again at the end):</p>
        <p style="font-size:12px">${missingAll.map(esc).join(", ")}</p>` : "<p>Every item has a match here.</p>"}`,
    buttons: [
      { action: "update", label: "Import, rewrite existing", default: true },
      { action: "skip", label: "Import, skip existing" },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if ( !go || (go === "cancel") ) return;

  const root = game.folders.find(f => (f.type === "Actor") && (f.name === "Sandbox Imports") && !f.folder)
    ?? await Folder.create({ name: "Sandbox Imports", type: "Actor" });
  const folderFor = async path => {
    let parent = root;
    for ( const name of String(path ?? "").split(" / ").filter(Boolean).filter(n => !/^\d+\.\s/.test(n)) ) {
      parent = game.folders.find(f => (f.type === "Actor") && (f.name === name) && (f.folder?.id === parent.id))
        ?? await Folder.create({ name, type: "Actor", folder: parent.id });
    }
    return parent;
  };

  const done = [];
  for ( const { a, found, missing, existing } of rows ) {
    if ( existing && (go === "skip") ) { done.push(`${a.name}: skipped`); continue; }
    const folder = await folderFor(a.folder);
    const role = typeof a.attributes?.npc_role === "string" ? a.attributes.npc_role : "";
    const system = {
      attributes: Object.fromEntries(["str", "agi", "tgh", "cha", "lck", "int", "per"]
        .map(k => [k, { base: val(a, k), advances: 0 }])),
      skills: Object.fromEntries(Object.entries(SKILLS).map(([s, k]) => [k, { rank: Math.min(4, Math.max(0, val(a, s))) }])),
      paraphysics: Object.fromEntries(Object.entries(DISCIPLINES).map(([s, k]) => [k, val(a, `${s}_rank`)])),
      details: {
        threat: /chaff|swarm/i.test(role) ? "minion" : "soldier",
        caste: casteOf(role),
        faction: String(a.folder ?? "").split(" / ").pop() ?? "",
        notes: role ? `<p>Sandbox role: ${esc(role)}</p>` : ""
      }
    };
    const data = { name: a.name, type: "npc", img: a.img, folder: folder.id, system,
      prototypeToken: { name: a.token?.name ?? a.name, texture: { src: a.token?.img || a.img }, width: a.token?.width ?? 1, height: a.token?.height ?? 1 } };
    let actor = existing;
    if ( actor ) {
      await actor.deleteEmbeddedDocuments("Item", actor.items.map(i => i.id));
      await actor.update(data);
    }
    else actor = await Actor.create(data);
    const copies = found.filter(f => f.item).map(f => {
      const c = f.item.toObject();
      for ( const k of ["_id", "folder", "sort", "ownership", "_stats"] ) delete c[k];
      if ( c.system && ("equipped" in c.system) ) c.system.equipped = true;
      return c;
    });
    if ( copies.length ) await actor.createEmbeddedDocuments("Item", copies);

    // Make the totals match the Sandbox sheet, through the bonuses.
    const s = actor.system;
    const update = {};
    const fit = (path, have, bonus, want) => { if ( want && (have !== want) ) update[path] = bonus + (want - have); };
    fit("system.vitals.hp.bonus", s.vitals.hp.max, s.vitals.hp.bonus, maxOf(a, "hp"));
    fit("system.vitals.energy.bonus", s.vitals.energy.max, s.vitals.energy.bonus, maxOf(a, "ener"));
    fit("system.vitals.armor.bonus", s.vitals.armor.max, s.vitals.armor.bonus, maxOf(a, "armor_hp"));
    for ( const [sk, k] of Object.entries(DR) ) fit(`system.dr.${k}`, s.drTotal?.[k] ?? s.dr[k], s.dr[k], val(a, `${sk}_dr`));
    if ( Object.keys(update).length ) await actor.update(update);
    const v = actor.system.vitals;
    await actor.update({ "system.vitals.hp.value": v.hp.max, "system.vitals.energy.value": v.energy.max, "system.vitals.armor.value": v.armor.max });
    done.push(`${a.name}: ${existing ? "rewritten" : "made"}, ${copies.length} items${missing.length ? `, missing ${missing.join(", ")}` : ""}`);
  }

  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Sandbox import" },
    content: `<div class="irop-card"><header class="card-head"><h3>Sandbox creatures</h3><span class="card-sub">${done.length} handled</span></header>
      <ul>${done.map(d => `<li>${esc(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info(`Sandbox import: ${done.length} creatures handled. The list is in chat.`);
})();

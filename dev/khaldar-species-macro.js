/**
 * The Khaldar (Johnald, 2026-10-30), from the Khaldar xenology file. Run once as the GM, as a script
 * macro; safe to run again. It:
 *   - makes the Khaldar species, or sets its block on the one there: STR 50, AGI 35, TGH 50, CHA 35,
 *     LCK 30, INT 40, PER 40, base Health 10 and Energy 7, and cannot be paraphysical;
 *   - makes Rock and Roll, Through the Fire and Flames, Crystalwright, Stone Gut and Paraphysically
 *     Null as Species abilities in the Species Perks folder, and puts them on the species' perk list;
 *   - gives every existing Khaldar character the species perks they are missing.
 *
 * Through the Fire and Flames carries its +2 Fire DR as an effect, so the system counts it. Shred is
 * ruled at the table, so "cannot be shredded" is too. The others are the record on the sheet.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const p = (...lines) => lines.map(l => `<p>${l}</p>`).join("");
  const PERKS = [
    { name: "Rock and Roll", img: "icons/skills/movement/ball-spinning-blue.webp",
      text: p("When you sprint you curl into a ball and roll to your destination. Reaction fire triggered by your movement takes an additional +5.",
        "Until the end of your next turn, you gain +1 DR for every 4 tiles rolled. This DR applies to all damage types except Psychic and Cosmic.") },
    { name: "Through the Fire and Flames", img: "icons/magic/fire/explosion-fireball-large-orange.webp",
      text: p("Your kind has lived in some of the hottest caves and locations, and thanks to this you are particularly hardy against fire. You gain +2 Fire DR innate to your species, and this cannot be shredded."),
      changes: { "system.dr.fire": 2 } },
    { name: "Crystalwright", img: "icons/commodities/gems/gem-faceted-rough-blue.webp",
      text: p("You gain 1 Assistance die on checks to identify, assess, repair, modify, or salvage materials, gear, and structures, including crystal tech and xenotech.",
        "You can also repair armor mid battle: once per scene, spend an action to restore 1 point of shredded DR on yourself or an adjacent ally.") },
    { name: "Stone Gut", img: "icons/commodities/stone/ore-pile-grey.webp",
      text: p("You can draw sustenance from minerals and never need rations where stone is available. You gain -10 D.M. on tests to resist ingested poisons and disease.") },
    { name: "Paraphysically Null", img: "icons/magic/control/debuff-energy-hold-blue-yellow.webp",
      text: p("The Khaldar cannot harness paraphysics. They cannot become paraphysically enabled by any means, including Awakening. A Khaldar may still train the Paraphysics skill for identification and knowledge.") }
  ];
  const BLOCK = { "system.attributes": { str: 50, agi: 35, tgh: 50, cha: 35, lck: 30, int: 40, per: 40 }, "system.health": 10, "system.energy": 7,
    "system.paraphysical": false, "system.noParaphysics": true, "system.playable": true };
  if ( !("noParaphysics" in (CONFIG.Item.dataModels.species?.schema?.fields ?? {})) ) {
    return ui.notifications.error("This macro needs system version 0.1.24 or later.");
  }
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const done = [];
  let species = game.items.find(i => (i.type === "species") && (fold(i.name) === "khaldar"));
  if ( species ) await species.update(BLOCK);
  else species = await Item.implementation.create({ name: "Khaldar", type: "species", img: "icons/environment/wilderness/cave-entrance.webp" });
  await species.update(BLOCK);
  done.push("Khaldar: Health 10, Energy 7, STR 50, AGI 35, TGH 50, CHA 35, LCK 30, INT 40, PER 40; cannot be paraphysical");
  const folder = game.folders?.find(f => (f.type === "Item") && (f.name === "Species Perks"))
    ?? await CONFIG.Folder.documentClass.create({ name: "Species Perks", type: "Item" });
  const list = foundry.utils.deepClone(species.system._source.perks ?? []);
  for ( const perk of PERKS ) {
    const system = { kind: "passive", source: "species", tree: species.name, description: perk.text };
    let item = game.items.find(i => (i.type === "ability") && (fold(i.name) === fold(perk.name)) && (i.system.source === "species"));
    if ( item ) await item.update({ system });
    else item = await Item.implementation.create({ name: perk.name, type: "ability", img: perk.img, folder: folder?.id ?? null, system });
    // Its numbers, as an effect made afresh each run.
    const old = item.effects.filter(e => e.getFlag("irop", "perkNumbers")).map(e => e.id);
    if ( old.length ) await item.deleteEmbeddedDocuments("ActiveEffect", old);
    const changes = Object.entries(perk.changes ?? {}).map(([key, value]) => ({ key, type: "add", value: String(value) }));
    if ( changes.length ) {
      await item.createEmbeddedDocuments("ActiveEffect", [{ name: perk.name, img: item.img, transfer: true,
        system: { changes }, flags: { irop: { perkNumbers: true } } }]);
    }
    if ( !list.some(e => e.uuid === item.uuid) ) list.push({ id: foundry.utils.randomID(), uuid: item.uuid, name: item.name, img: item.img });
  }
  await species.update({ "system.perks": list });
  done.push(`Khaldar perks: ${PERKS.map(x => x.name).join(", ")}`);
  for ( const actor of game.actors.filter(a => a.items.some(i => (i.type === "species") && (fold(i.name) === "khaldar"))) ) {
    const copies = [];
    for ( const entry of list ) {
      if ( actor.items.some(i => (i.flags?.irop?.speciesPerk?.uuid === entry.uuid) || ((i.type === "ability") && (fold(i.name) === fold(entry.name)))) ) continue;
      const ability = entry.uuid ? await foundry.utils.fromUuid(entry.uuid) : null;
      if ( ability?.type !== "ability" ) continue;
      const copy = ability.toObject();
      for ( const key of ["_id", "folder", "sort", "ownership", "_stats"] ) delete copy[key];
      copy.system = { ...copy.system, source: "species", tree: species.name };
      copy.flags = { ...(copy.flags ?? {}), irop: { ...(copy.flags?.irop ?? {}), speciesPerk: { species: species.name, perk: entry.id, uuid: entry.uuid } } };
      copies.push(copy);
    }
    if ( copies.length ) {
      await actor.createEmbeddedDocuments("Item", copies);
      done.push(`${actor.name}: given ${copies.map(c => c.name).join(", ")}`);
    }
  }
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Khaldar" },
    content: `<div class="irop-card"><header class="card-head"><h3>Khaldar</h3><span class="card-sub">Species block and perks</span></header>
      <ul>${done.map(d => `<li>${foundry.utils.escapeHTML(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info("Khaldar set.");
})();

/**
 * Reticulon racial perks (Johnald, 2026-10-20), from the Reticulon xenology file: the gills of an
 * amphibious people, the natural form's second pair of eyes, and a species of scientists. Run once
 * as the GM, as a script macro. It makes the three as Species abilities in the Items sidebar, or
 * rewrites them if they are there already; safe to run again.
 *
 * Scientists by Nature carries its numbers as an effect (as Innovator's divisions do), so the
 * system counts Technology and Xenotechnology at +10 per rank on Research projects.
 *
 * It also puts the three on the Reticulon species' perk list (2026-10-20), so every Reticulon gets
 * them at enlistment and when the species is dropped on a sheet.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const p = (...lines) => lines.map(l => `<p>${l}</p>`).join("");
  const R = "system.bonuses.strategy.perRank.research";
  const PERKS = [
    { name: "Freshwater Gills", img: "icons/magic/water/bubbles-air-water-blue.webp",
      text: p("Gills at your ribcage, the inheritance of an amphibious people. You breathe fresh water as easily as air, and swim at your Run speed.",
        "Salt water you cannot breathe: in it you hold your breath like anyone else.") },
    { name: "Four Eyes", img: "icons/magic/perception/eye-ringed-glow-angry-teal.webp",
      text: p("Your second, smaller pair of eyes sits a little above the first, made for seeing underwater. Smoke, fog, murky water and dim light never hide a target from you within 8 tiles.") },
    { name: "Scientists by Nature", img: "icons/tools/laboratory/alembic-glass-ball-blue.webp",
      text: p("Humans are explorers by nature; Reticulons are scientists by nature. When you are assigned to a Research project, you count Technology and Xenotechnology at +10 per skill rank instead of +5."),
      changes: { [`${R}.technology`]: 5, [`${R}.xenotech`]: 5 } }
  ];
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const done = [];
  const made = [];
  for ( const perk of PERKS ) {
    const system = { kind: "passive", source: "species", tree: "Reticulon", description: perk.text };
    let item = game.items.find(i => (i.type === "ability") && (fold(i.name) === fold(perk.name)));
    if ( item ) {
      await item.update({ system });
      done.push(`${perk.name} rewritten`);
    }
    else {
      item = await Item.implementation.create({ name: perk.name, type: "ability", img: perk.img, system });
      done.push(`${perk.name} made`);
    }
    made.push(item);
    // Its numbers, as an effect made afresh each run.
    const old = item.effects.filter(e => e.getFlag("irop", "perkNumbers")).map(e => e.id);
    if ( old.length ) await item.deleteEmbeddedDocuments("ActiveEffect", old);
    const changes = Object.entries(perk.changes ?? {}).map(([key, value]) => ({ key, type: "add", value: String(value) }));
    if ( changes.length ) {
      await item.createEmbeddedDocuments("ActiveEffect", [{ name: perk.name, img: item.img, transfer: true,
        system: { changes }, flags: { irop: { perkNumbers: true } } }]);
    }
  }
  // On the Reticulon species' list, each once.
  for ( const species of game.items.filter(i => (i.type === "species") && (fold(i.name) === "reticulon")) ) {
    const perks = foundry.utils.deepClone(species.system._source.perks ?? []);
    let added = 0;
    for ( const item of made ) {
      if ( perks.some(p => p.uuid === item.uuid) ) continue;
      perks.push({ id: foundry.utils.randomID(), uuid: item.uuid, name: item.name, img: item.img });
      added++;
    }
    if ( added ) {
      await species.update({ "system.perks": perks });
      done.push(`${added} added to the ${species.name} species' perks`);
    }
  }
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Reticulon perks" },
    content: `<div class="irop-card"><header class="card-head"><h3>Reticulon perks</h3><span class="card-sub">Species abilities</span></header>
      <ul>${done.map(d => `<li>${foundry.utils.escapeHTML(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info(`Reticulon perks: ${done.length} ready in the Items sidebar.`);
})();

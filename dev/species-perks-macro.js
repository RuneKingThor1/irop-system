/**
 * Species perks as items (Johnald, 2026-10-20: "Brilliance should be a species perk and we should
 * make perk items for the mutants and humans for what they get as well so there is consistency").
 * The species bonuses written in each species' own text, as Species abilities, each put on its
 * species' perk list so every character of the species gets it. Run once as the GM, as a script
 * macro; safe to run again.
 *
 * It also gives every existing character of these species the species perks they are missing
 * (new characters get them at enlistment, or when the species is dropped on them).
 *
 * The rules these describe are already in the system (Intelligence casting, Murk-Eye, boons,
 * mutations, a Human's concealment): the items are the record on the sheet, not new numbers.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const p = (...lines) => lines.map(l => `<p>${l}</p>`).join("");
  const SPECIES = {
    Reticulon: [
      { name: "Brilliance", img: "icons/magic/perception/third-eye-blue-red.webp",
        text: p("Reticulons utilize Intelligence for the casting of any paraphysics.") }
    ],
    Mutant: [
      { name: "Murk-Eye", img: "icons/magic/perception/eye-slit-orange.webp",
        text: p("A mutant's eyes have a special adaptation to poor light. They suffer no D.M. penalty or skill check penalty due to low light conditions. Complete darkness still applies any standard penalties.") },
      { name: "Controlled Mutations", img: "icons/magic/life/heart-pink.webp",
        text: p("Roll twice on the Positive Mutation Table and once on the Negative Mutation Table at character creation. Because a Baron's mutations are bestowed under a Monarch's careful guidance, you may reroll the Negative result once and take the second outcome. All results are permanent. If a mutation grants a skill you already have, increase that skill by one rank instead.") },
      { name: "Human Passing", img: "icons/magic/control/silhouette-hold-change-blue.webp",
        text: p("A Baron reads as an ordinary (if slightly off-putting) human under normal observation. Gain a bonus to Deception and disguise checks to maintain a human cover, and move through human settlements and most GENESIS checkpoints without automatic suspicion. Openly using overt mutations (wings, bared natural weapons, acid spit and the like) immediately blows this cover to any human witnesses.") }
    ],
    Human: [
      { name: "Adaptable", img: "icons/magic/life/crosses-trio-red.webp",
        text: p("Two Attribute boons. You may select two attributes and increase them by +10 each. You cannot pick the same attribute twice. (You can find these in the Items tab, in the Boons folder.)") },
      { name: "One Face Among Many", img: "icons/magic/perception/silhouette-stealth-shadow.webp",
        text: p("Humans blend in where humans live. Your concealment thresholds are 10% higher in the slums and in megacities.") }
    ]
  };
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const folder = game.folders?.find(f => (f.type === "Item") && (f.name === "Species Perks"))
    ?? await CONFIG.Folder.documentClass.create({ name: "Species Perks", type: "Item" });
  const done = [];
  for ( const [speciesName, perks] of Object.entries(SPECIES) ) {
    const species = game.items.find(i => (i.type === "species") && (fold(i.name) === fold(speciesName)));
    if ( !species ) {
      done.push(`No ${speciesName} species in the Items sidebar: skipped`);
      continue;
    }
    const list = foundry.utils.deepClone(species.system._source.perks ?? []);
    for ( const perk of perks ) {
      const system = { kind: "passive", source: "species", tree: species.name, description: perk.text };
      let item = game.items.find(i => (i.type === "ability") && (fold(i.name) === fold(perk.name)) && (i.system.source === "species"));
      if ( item ) await item.update({ system });
      else item = await Item.implementation.create({ name: perk.name, type: "ability", img: perk.img, folder: folder?.id ?? null, system });
      if ( !list.some(e => e.uuid === item.uuid) ) list.push({ id: foundry.utils.randomID(), uuid: item.uuid, name: item.name, img: item.img });
    }
    await species.update({ "system.perks": list });
    done.push(`${species.name}: ${perks.map(x => x.name).join(", ")}`);
    // Characters of this species already made get what they are missing.
    for ( const actor of game.actors.filter(a => a.items.some(i => (i.type === "species") && (fold(i.name) === fold(species.name)))) ) {
      const copies = [];
      for ( const entry of list ) {
        const has = actor.items.some(i => (i.flags?.irop?.speciesPerk?.uuid === entry.uuid) || ((i.type === "ability") && (fold(i.name) === fold(entry.name))));
        if ( has ) continue;
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
  }
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Species perks" },
    content: `<div class="irop-card"><header class="card-head"><h3>Species perks</h3><span class="card-sub">On each species' list</span></header>
      <ul>${done.map(d => `<li>${foundry.utils.escapeHTML(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info("Species perks set.");
})();

/**
 * Telestoi species perks and stats (Johnald, 2026-10-20), from the Telestoi xenology file. Run once
 * as the GM, as a script macro; safe to run again. It:
 *   - sets the Telestoi species' starting attributes to the ruled block: Intelligence 30 and Luck 40
 *     (was 40 and 30), the rest unchanged (STR 30, AGI 30, TGH 40, CHA 50, PER 40), and its base
 *     Health 7 and Energy 11 (was 6 and 10);
 *   - sets their paraphysics: Charisma, three disciplines, rank 1 granted in Optics and Telepathy;
 *   - makes Telestoian Glamor, Memory Sharing, Empath, Gifted Mind and Telesma as Species abilities
 *     in the Species Perks folder and puts them on the Telestoi species' perk list. Glamor is an
 *     active ability: its Use raises the Glamor (3 Energy committed) or lets it fall;
 *   - gives every existing Telestoi character the species perks they are missing.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const p = (...lines) => lines.map(l => `<p>${l}</p>`).join("");
  const PERKS = [
    { name: "Telestoian Glamor", img: "icons/magic/perception/silhouette-stealth-shadow.webp",
      text: p("You impose a chosen self-image on the minds around you: a disguise as a humanoid near your own build. It cannot make you invisible, or show something far from your true shape.",
        "It holds as long as you are conscious and keep 3 Energy committed to it: while it holds, those 3 cannot be spent, and it falls if you have fewer than 3 left. Disorientated does not break it.",
        "It is a paraphysical effect on minds, so it does nothing to mind-immune creatures, and cameras and recordings show your true face. Other means can see through it, as the GM rules: a Paraphysics check to notice an anomaly, or another's paraphysical senses.",
        "Use this ability to raise the Glamor, and again to let it fall."), active: true, glamor: true },
    { name: "Memory Sharing", img: "icons/magic/perception/third-eye-blue-red.webp",
      text: p("Out of combat, with a willing creature you touch, you give or receive one memory, lived as if it were their own: a face, a route walked, a conversation, what happened in a room.",
        "Like all Telestoi gifts, it does nothing to mind-immune creatures.") },
    { name: "Empath", img: "icons/magic/control/hypnosis-mesmerism-swirl.webp",
      text: p("You feel the emotions around you, and can lean on them. Once per session, choose one:") + `<ul>
        <li>Add Assistance dice equal to your Paraphysics skill rank to a Persuasion or Insight check.</li>
        <li>Grant an ally -20 D.M. on their check to break out of the Panicked state.</li></ul>`
        + p("It does nothing to mind-immune creatures.") },
    { name: "Gifted Mind", img: "icons/magic/perception/eye-ringed-glow-angry-teal.webp",
      text: p("Your people's gift runs deeper than most. You start with rank 1 in Optics and in Telepathy, and in those two disciplines your rank can reach 6 where others stop at 5.",
        "Both count toward the three disciplines a Telestoi can hold, so your third is yours to choose.") },
    { name: "Telesma", img: "icons/magic/light/orb-lightbulb-gray.webp",
      text: p("The bioluminescent organ that wraps your head shows what you are: bright in youth and dim with age, cool colors when you are well and hot ones when you are hurt or sick.",
        "It pulses when you use paraphysics: casting a power ends any Concealment you have. Your Glamor holds through it.") }
  ];
  const ATTRIBUTES = { str: 30, agi: 30, tgh: 40, cha: 50, lck: 40, int: 30, per: 40 };
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const done = [];
  const species = game.items.find(i => (i.type === "species") && (fold(i.name) === "telestoi"));
  if ( !species ) return ui.notifications.warn("No Telestoi species in the Items sidebar.");
  await species.update({ "system.attributes": ATTRIBUTES, "system.health": 7, "system.energy": 11, "system.paraphysical": true, "system.paraphysics.attribute": "cha",
    "system.paraphysics.schools": 3, "system.paraphysics.bonus.optics": 1, "system.paraphysics.bonus.telepathy": 1 });
  done.push("Telestoi: Health 7, Energy 11, INT 30, LCK 40; Charisma casting, three disciplines, rank 1 in Optics and Telepathy");
  const folder = game.folders?.find(f => (f.type === "Item") && (f.name === "Species Perks"))
    ?? await CONFIG.Folder.documentClass.create({ name: "Species Perks", type: "Item" });
  const list = foundry.utils.deepClone(species.system._source.perks ?? []);
  for ( const perk of PERKS ) {
    const system = { kind: perk.active ? "active" : "passive", source: "species", tree: species.name, description: perk.text,
      ...(perk.active ? { actionType: "single", energyCost: 0 } : {}) };
    const flags = perk.glamor ? { irop: { glamor: true } } : {};
    let item = game.items.find(i => (i.type === "ability") && (fold(i.name) === fold(perk.name)) && (i.system.source === "species"));
    if ( item ) await item.update({ system, flags });
    else item = await Item.implementation.create({ name: perk.name, type: "ability", img: perk.img, folder: folder?.id ?? null, system, flags });
    if ( !list.some(e => e.uuid === item.uuid) ) list.push({ id: foundry.utils.randomID(), uuid: item.uuid, name: item.name, img: item.img });
  }
  await species.update({ "system.perks": list });
  done.push(`Telestoi perks: ${PERKS.map(x => x.name).join(", ")}`);
  for ( const actor of game.actors.filter(a => a.items.some(i => (i.type === "species") && (fold(i.name) === "telestoi"))) ) {
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
    // The character's own copy of the species: Health, Energy and paraphysics follow the ruling. Their
    // attributes are their own (set when the species was taken), so those are left alone.
    for ( const own of actor.items.filter(i => (i.type === "species") && (fold(i.name) === "telestoi")) ) {
      await own.update({ "system.health": 7, "system.energy": 11, "system.paraphysical": true, "system.paraphysics.attribute": "cha",
        "system.paraphysics.schools": 3, "system.paraphysics.bonus.optics": 1, "system.paraphysics.bonus.telepathy": 1 });
      done.push(`${actor.name}: species copy updated (Health 7, Energy 11)`);
    }
    // A Glamor taken before it became an active ability gets its Use button.
    for ( const g of actor.items.filter(i => (i.type === "ability") && (fold(i.name) === "telestoianglamor") && (i.system.kind !== "active")) ) {
      await g.update({ "system.kind": "active", "system.actionType": "single", "flags.irop.glamor": true });
      done.push(`${actor.name}: Glamor made usable`);
    }
    if ( copies.length ) {
      await actor.createEmbeddedDocuments("Item", copies);
      done.push(`${actor.name}: given ${copies.map(c => c.name).join(", ")}`);
    }
  }
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Telestoi" },
    content: `<div class="irop-card"><header class="card-head"><h3>Telestoi</h3><span class="card-sub">Species perks and stats</span></header>
      <ul>${done.map(d => `<li>${foundry.utils.escapeHTML(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info("Telestoi set.");
})();

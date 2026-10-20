/**
 * Two Reticulon backgrounds (Johnald, 2026-10-20), from the Reticulon xenology file: the Enduring
 * Calm, an initiate of the Ishelûvae order, and Flotilla Born, raised aboard the Ithelû flotilla.
 * Run once as the GM, as a script macro. It makes (or rewrites) both backgrounds, open to Reticulons
 * only, and their three perks each as Background abilities in the Background Perks folder, with the
 * project bonuses as effects the system applies. Safe to run again.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const p = (...lines) => lines.map(l => `<p>${l}</p>`).join("");
  const S = "system.bonuses.strategy.perRank";
  const BACKGROUNDS = [
    {
      name: "The Enduring Calm", img: "icons/magic/water/wave-water-blue.webp",
      description: p("An initiate of the Ishelûvae, the order the old Vaeshelûn monks became in the flight. You were trained the way your people learned they must be: martial discipline first, because paraphysics used wrongly is devastating. You will fight, but you will not ruin a living place for nothing."),
      skills: "Paraphysics, Athletics, Acrobatics, Insight, Tactics, Medical",
      perks: [
        { name: "Still Water", img: "icons/magic/water/water-drop-swirl-blue.webp",
          text: p("The order teaches the gift's dangers before its uses. Once per mission, reroll a failed Paraphysics improvisation check, and a Defeat on it counts as a plain failure.") },
        { name: "Tidecraft", img: "icons/magic/water/barrier-ice-water-cube.webp",
          text: p("Out of combat, once per mission, you shape a body of water you can see, up to the size of a room: part it, still it, or draw it into a wall or a bridge for a few minutes.") },
        { name: "Calm Under Pressure", img: "icons/magic/perception/silhouette-stealth-shadow.webp",
          text: p("When you are assigned to an Intelligence Action, you count Insight and Paraphysics at +10 per skill rank instead of +5."),
          changes: { [`${S}.intelligence.insight`]: 5, [`${S}.intelligence.paraphysics`]: 5 } }
      ]
    },
    {
      name: "Flotilla Born", img: "icons/environment/settlement/ship.webp",
      description: p("Sixty years between the stars, running from system to system ahead of the Xargryr. You grew up aboard the Ithelû flotilla: patching ships that should have died, staying silent, and listening to enemy traffic. That is how your people found Earth."),
      skills: "Technology, Mechanics, Xenotechnology, Hacking, Stealth, Survivalism",
      perks: [
        { name: "Patch It Till It Flies", img: "icons/tools/hand/wrench-steel-grey.webp",
          text: p("Once per mission, outside combat, you get one broken machine working again for the rest of the scene: a vehicle, a door mechanism, a generator, a radio. It fails for good afterward.") },
        { name: "Signal Intercept", img: "icons/magic/sonic/scream-wail-shout-teal.webp",
          text: p("Once per mission, you listen in on Xargryr or GENESIS traffic nearby, and the GM tells you one thing it says: a patrol route, a reinforcement time, or an order.") },
        { name: "Shipwright", img: "icons/tools/smithing/hammer-sledge-steel-grey.webp",
          text: p("When you are assigned to an Engineering project, you count Mechanics and Xenotechnology at +10 per skill rank instead of +5."),
          changes: { [`${S}.engineering.mechanics`]: 5, [`${S}.engineering.xenotech`]: 5 } }
      ]
    }
  ];
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const folder = game.folders?.find(f => (f.type === "Item") && (f.name === "Background Perks"))
    ?? await CONFIG.Folder.documentClass.create({ name: "Background Perks", type: "Item" });
  const done = [];
  for ( const bg of BACKGROUNDS ) {
    const list = [];
    for ( const perk of bg.perks ) {
      const system = { kind: "passive", source: "background", tree: bg.name, description: perk.text };
      let item = game.items.find(i => (i.type === "ability") && (fold(i.name) === fold(perk.name)));
      if ( item ) await item.update({ system });
      else item = await Item.implementation.create({ name: perk.name, type: "ability", img: perk.img, folder: folder?.id ?? null, system });
      const old = item.effects.filter(e => e.getFlag("irop", "perkNumbers")).map(e => e.id);
      if ( old.length ) await item.deleteEmbeddedDocuments("ActiveEffect", old);
      const changes = Object.entries(perk.changes ?? {}).map(([key, value]) => ({ key, type: "add", value: String(value) }));
      if ( changes.length ) {
        await item.createEmbeddedDocuments("ActiveEffect", [{ name: perk.name, img: item.img, transfer: true,
          system: { changes }, flags: { irop: { perkNumbers: true } } }]);
      }
      list.push(item);
    }
    let item = game.items.find(i => (i.type === "background") && (fold(i.name) === fold(bg.name)));
    const keep = item ? (item.system._source.perks ?? []) : [];
    const perks = list.map(a => keep.find(k => k.uuid === a.uuid) ?? { id: foundry.utils.randomID(), uuid: a.uuid, name: a.name, img: a.img });
    const system = { description: bg.description, startingSkills: bg.skills, skillPicks: 3, enlist: true, species: "Reticulon", perks };
    if ( item ) {
      await item.update({ system });
      done.push(`${bg.name} rewritten`);
    }
    else {
      await Item.implementation.create({ name: bg.name, type: "background", img: bg.img, system });
      done.push(`${bg.name} made, with ${perks.length} perks`);
    }
  }
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Reticulon backgrounds" },
    content: `<div class="irop-card"><header class="card-head"><h3>Reticulon backgrounds</h3><span class="card-sub">Open to Reticulons only</span></header>
      <ul>${done.map(d => `<li>${foundry.utils.escapeHTML(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info("Reticulon backgrounds ready in the Items sidebar.");
})();

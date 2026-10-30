/**
 * Two Khaldar backgrounds (Johnald, 2026-10-30): the Heat Caller, raised among the Khalgir, and the
 * Crystal Smith, trained at the clan forges. Run once as the GM, as a script macro. It makes (or
 * rewrites) both backgrounds, open to Khaldar only, and their three perks each as Background
 * abilities in the Background Perks folder, with Nothing Left Behind's and Material Scientist's
 * numbers as effects the system applies. Safe to run again.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const p = (...lines) => lines.map(l => `<p>${l}</p>`).join("");
  const S = "system.bonuses.strategy";
  const BACKGROUNDS = [
    {
      name: "Heat Caller", img: "icons/magic/fire/explosion-fireball-large-orange.webp",
      description: p("You were raised among the Khalgir, and the stone speaks to you more clearly than it does to most. Your clan trusted you with their lives, because you told them when to run. You still feel it when a place is about to turn on you."),
      skills: "Survivalism, Awareness, Investigation, Insight, History, Stealth",
      perks: [
        { name: "Feel the Stone", img: "icons/commodities/stone/ore-pile-grey.webp",
          text: p("Once per mission, you read the heat through a wall or floor. The GM tells you how many living creatures and running machines are within 10 tiles, and roughly where.") },
        { name: "The Long Warning", img: "icons/magic/perception/eye-ringed-glow-angry-teal.webp",
          text: p("Once per mission, you feel the response before it arrives. The GM tells you how long until GENESIS reinforcements reach the squad, and from which direction.") },
        { name: "Nothing Left Behind", img: "icons/commodities/gems/gem-faceted-rough-red.webp",
          text: p("Once per strategy layer turn, after a successful mission, you bring back an additional 5 Logistics worth of supplies."),
          changes: { [`${S}.mission.logistics`]: 5 } }
      ]
    },
    {
      name: "Crystal Smith", img: "icons/commodities/gems/gem-faceted-rough-blue.webp",
      description: p("You learned the craft at the clan forges, where the crystals are handled with reverence and a mistake is a shame carried for life. Everything you make is built to be carried, repaired, and carried again. Now you put that craft to work against the people who took your world."),
      skills: "Mechanics, Technology, Xenotechnology, Paraphysics, Investigation, Athletics",
      perks: [
        { name: "Reading the Grain", img: "icons/commodities/gems/gem-faceted-rough-green.webp",
          text: p("Once per session, you study a piece of gear, a material or a crystal, and the GM tells you what it is, what it was made for, and one thing wrong with it.") },
        { name: "Field Forge", img: "icons/tools/smithing/hammer-sledge-steel-grey.webp",
          text: p("Once per mission, out of combat, you rework one ally's weapon or armor. Until the mission ends, a weapon deals +1 damage or a suit of armor gains +1 DR to one damage type.") },
        { name: "Material Scientist", img: "icons/tools/laboratory/alembic-glass-ball-blue.webp",
          text: p("When you are assigned to a Research project, you count Mechanics and Xenotechnology at +10 per skill rank instead of +5."),
          changes: { [`${S}.perRank.research.mechanics`]: 5, [`${S}.perRank.research.xenotech`]: 5 } }
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
    const system = { description: bg.description, startingSkills: bg.skills, skillPicks: 3, enlist: true, species: "Khaldar", perks };
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
    whisper: [game.user.id], speaker: { alias: "Khaldar backgrounds" },
    content: `<div class="irop-card"><header class="card-head"><h3>Khaldar backgrounds</h3><span class="card-sub">Open to Khaldar only</span></header>
      <ul>${done.map(d => `<li>${foundry.utils.escapeHTML(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info("Khaldar backgrounds ready in the Items sidebar.");
})();

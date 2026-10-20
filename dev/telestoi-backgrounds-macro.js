/**
 * Two Telestoi backgrounds (Johnald, 2026-10-20), from the Telestoi xenology file: the House Scion,
 * born to a city-state's noble family, and the Door Warden, raised in the service that keeps the
 * Stellar Doors and the drones that watched Earth. (An Altered Telestoi cannot defect by normal
 * standards, so there is no Altered background.) Run once as the GM, as a script macro. It makes (or
 * rewrites) both backgrounds, open to Telestoi only, and their three perks each as Background
 * abilities in the Background Perks folder, with Envoy's and Silent Watchers' numbers as effects
 * the system applies. Safe to run again.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const p = (...lines) => lines.map(l => `<p>${l}</p>`).join("");
  const S = "system.bonuses.strategy";
  const BACKGROUNDS = [
    {
      name: "House Scion", img: "icons/sundries/documents/document-sealed-signatures-red.webp",
      description: p("Born to the noble family of a Telestoi city-state. You were raised on debate, sport and art, the arenas where your people settled every quarrel for five thousand years instead of going to war. You know how to win without a weapon. You are still learning that sometimes you cannot."),
      skills: "Persuasion, Insight, Deception, History, Tactics, Awareness",
      perks: [
        { name: "Settled by Contest", img: "icons/skills/social/diplomacy-handshake.webp",
          text: p("Once per session, you can challenge a willing rival who is not GENESIS to settle a dispute by contest instead of violence: debate, sport or art, at the GM's check. Win, and they honor the terms.") },
        { name: "Court Sense", img: "icons/skills/social/diplomacy-peace-alliance.webp",
          text: p("Once per session, ask the GM who truly holds power in a room or a group, and what they want.") },
        { name: "Envoy", img: "icons/sundries/flags/banner-flag-white.webp",
          text: p("Your people's statecraft carries. When a faction task you worked on succeeds, or partly succeeds, that faction's standing rises by 2 extra points."),
          changes: { [`${S}.factionStanding`]: 2 } }
      ]
    },
    {
      name: "Door Warden", img: "icons/environment/wilderness/portal.webp",
      description: p("Raised on the temporary homeworld after the Exodus, in the service that keeps the Stellar Doors and the drones that watched Earth for a quarter century. You came through the Earth Door knowing this planet's last twenty five years better than most of the people living on it."),
      skills: "Technology, Xenotechnology, History, Investigation, Awareness, Survivalism",
      perks: [
        { name: "The Watchers' Record", img: "icons/sundries/scrolls/scroll-bound-blue-tan.webp",
          text: p("Once per session, ask the GM one thing about a place's history since the invasion: who held it, what happened there, or who passed through.") },
        { name: "Stellar Cartographer", img: "icons/tools/navigation/map-chart-tan.webp",
          text: p("Once per mission, you plot the squad's route through a region so that it avoids one GENESIS patrol or one hazard of your choice.") },
        { name: "Silent Watchers", img: "icons/magic/perception/eye-ringed-glow-angry-teal.webp",
          text: p("When you are assigned to an Intelligence Action, you count Investigation and Awareness at +10 per skill rank instead of +5."),
          changes: { [`${S}.perRank.intelligence.investigation`]: 5, [`${S}.perRank.intelligence.awareness`]: 5 } }
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
    const system = { description: bg.description, startingSkills: bg.skills, skillPicks: 3, enlist: true, species: "Telestoi", perks };
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
    whisper: [game.user.id], speaker: { alias: "Telestoi backgrounds" },
    content: `<div class="irop-card"><header class="card-head"><h3>Telestoi backgrounds</h3><span class="card-sub">Open to Telestoi only</span></header>
      <ul>${done.map(d => `<li>${foundry.utils.escapeHTML(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info("Telestoi backgrounds ready in the Items sidebar.");
})();

/**
 * Paraphysics setup (Paraphysics Framework Draft 0.6, Johnald, 2026-10-18 and 19). Run once as the
 * GM, as a script macro, after updating the system. Safe to run again. It:
 *   - makes Gravbolt an Astrokinesis power (tier 1, Accuracy and Damage tracks, Cosmic damage, 3
 *     Energy, no built in accuracy), in the Items sidebar and on every character who knows it.
 *     Characters keep the rank they have;
 *   - moves Barrier Restoration to Vitakinesis (the old "Energy" discipline became Astrokinesis on
 *     its own when the system updated);
 *   - sets the species: Reticulons cast on Intelligence and hold 4 disciplines, Telestoi hold 3 with
 *     a granted rank in Telepathy and Optics, Humans hold 5 on Charisma.
 * Change the numbers below before running if they are not what you want.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const GRAVBOLT = {
    "system.energyCost": 3,
    "system.paraphysics.discipline": "astrokinesis",
    "system.paraphysics.attack": true,
    "system.paraphysics.accuracy": 0,
    "system.paraphysics.damage.formula": "2d4 + @cha.mod",
    "system.paraphysics.damage.type": "cosmic",
    "system.paraphysics.tier": 1,
    "system.paraphysics.trackA": "accuracy",
    "system.paraphysics.trackB": "damage",
    "system.paraphysics.concentration": false,
    "system.paraphysics.save": ""
  };
  const SPECIES = {
    human: { "system.paraphysics.attribute": "cha", "system.paraphysics.schools": 5 },
    reticulon: { "system.paraphysical": true, "system.paraphysics.attribute": "int", "system.paraphysics.schools": 4 },
    telestoi: { "system.paraphysical": true, "system.paraphysics.attribute": "cha", "system.paraphysics.schools": 3,
      "system.paraphysics.bonus.telepathy": 1, "system.paraphysics.bonus.optics": 1 }
  };
  const done = [];
  const everywhere = type => [...game.items.filter(i => i.type === type).map(item => ({ item, owner: "Items" })),
    ...game.actors.contents.flatMap(a => a.items.filter(i => i.type === type).map(item => ({ item, owner: a.name })))];

  for ( const { item, owner } of everywhere("ability") ) {
    if ( fold(item.name) === "gravbolt" ) {
      const change = { ...GRAVBOLT };
      // Its Rank 3 options, as editable copies of the library's, where it has none yet (2026-10-19).
      if ( !item.system.paraphysics.options?.length ) {
        change["system.paraphysics.options"] = ["chain", "piercing", "overload"].map(key => {
          const a = CONFIG.IROP?.powerArchetypes?.[key] ?? {};
          return { id: key, archetype: key, label: a.label ?? key, text: a.text ?? "", ...(a.changes ?? {}) };
        });
      }
      // Its text only where it says nothing yet.
      if ( !item.system.description?.replace(/<[^>]*>|&nbsp;|Costs \d+ energy/gi, "").trim() ) {
        change["system.description"] = "<p>Single target cosmic damage. Bypasses Armor HP: barrier first, then HP.</p>";
      }
      await item.update(change);
      done.push(`${owner}: Gravbolt made an Astrokinesis power`);
    }
    else if ( fold(item.name) === "barrierrestoration" && (item.system.paraphysics.discipline !== "vitakinesis") ) {
      await item.update({ "system.paraphysics.discipline": "vitakinesis" });
      done.push(`${owner}: Barrier Restoration moved to Vitakinesis`);
    }
  }
  for ( const { item, owner } of everywhere("species") ) {
    const change = SPECIES[fold(item.name)];
    if ( !change ) continue;
    await item.update(change);
    done.push(`${owner}: ${item.name} species set`);
  }
  const list = done.map(d => `<li>${foundry.utils.escapeHTML(d)}</li>`).join("");
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Paraphysics setup" },
    content: `<div class="irop-card"><header class="card-head"><h3>Paraphysics setup</h3><span class="card-sub">Framework Draft 0.6</span></header>
      ${done.length ? `<ul>${list}</ul>` : "<p>Nothing found to change.</p>"}</div>`
  });
  ui.notifications.info(`Paraphysics setup: ${done.length} changes.`);
})();

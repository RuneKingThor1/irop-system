/**
 * Reflex Sight (Johnald, 2026-10-17): -5 D.M. on attacks at Medium range while fitted to a ranged
 * weapon, and a weight of 0.5. Run once as the GM, as a script macro: it sets both on every Reflex
 * Sight in the world, the Items sidebar's, the copies operatives and NPCs carry, and those on store
 * shelves. Safe to run again.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const fold = s => String(s ?? "").toLowerCase().replace(/\(test\)/g, "").replace(/[^a-z0-9]/g, "");
  const isSight = i => (i.type === "mod") && (fold(i.name) === "reflexsight");
  const changes = { "system.rangeDm.medium": -5, "system.weight": 0.5 };
  const done = [];
  for ( const item of game.items.filter(isSight) ) {
    await item.update(changes);
    done.push(`Items: ${item.name}`);
  }
  for ( const actor of game.actors ) {
    for ( const item of actor.items.filter(isSight) ) {
      await item.update(changes);
      done.push(`${actor.name}: ${item.name}`);
    }
  }
  const list = done.map(d => `<li>${foundry.utils.escapeHTML(d)}</li>`).join("");
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Reflex Sight" },
    content: `<div class="irop-card"><header class="card-head"><h3>Reflex Sight</h3><span class="card-sub">-5 D.M. at Medium, weight 0.5</span></header>
      ${done.length ? `<p>Updated ${done.length}:</p><ul>${list}</ul>` : "<p>No Reflex Sight found. Check the mod's name.</p>"}</div>`
  });
  ui.notifications.info(`Reflex Sight: ${done.length} updated.`);
})();

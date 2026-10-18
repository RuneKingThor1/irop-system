/**
 * Ability renames (Johnald, 2026-10-18: "Eat Lead is being renamed to Walk'em Down"). Run once as the
 * GM, as a script macro. For each rename below it:
 *   - renames the ability in the Items sidebar and every copy characters and NPCs carry;
 *   - changes the old name to the new in every ability's text (the upgrade perks that say "Eat Lead: ...");
 *   - renames the node on any perk tree that points at it.
 * Safe to run again; add later renames to the list.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const RENAMES = [
    { from: "Eat Lead", to: "Walk'em Down", text: /Eat Lead!?/g }
  ];
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const done = [];
  const abilities = [...game.items.filter(i => i.type === "ability").map(item => ({ item, owner: "Items" })),
    ...game.actors.contents.flatMap(a => a.items.filter(i => i.type === "ability").map(item => ({ item, owner: a.name })))];
  for ( const r of RENAMES ) {
    for ( const { item, owner } of abilities ) {
      const changes = {};
      if ( fold(item.name) === fold(r.from) ) changes.name = r.to;
      const text = item.system.description ?? "";
      const next = text.replace(r.text, r.to);
      if ( next !== text ) changes["system.description"] = next;
      if ( !Object.keys(changes).length ) continue;
      await item.update(changes);
      done.push(`${owner}: ${changes.name ? `${r.from} renamed` : `${item.name}'s text`}`);
    }
    for ( const tree of game.items.filter(i => i.type === "skillTree") ) {
      const tiers = foundry.utils.deepClone(tree.system._source.tiers ?? []);
      let changed = false;
      for ( const tier of tiers ) for ( const node of tier.nodes ?? [] ) {
        if ( fold(node.name) === fold(r.from) ) { node.name = r.to; changed = true; }
      }
      if ( changed ) {
        await tree.update({ "system.tiers": tiers });
        done.push(`Perk tree ${tree.name}: node renamed`);
      }
    }
  }
  const list = done.map(d => `<li>${foundry.utils.escapeHTML(d)}</li>`).join("");
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Ability renames" },
    content: `<div class="irop-card"><header class="card-head"><h3>Ability renames</h3><span class="card-sub">${RENAMES.map(r => `${r.from} to ${r.to}`).join(", ")}</span></header>
      ${done.length ? `<ul>${list}</ul>` : "<p>Nothing to rename: already done.</p>"}</div>`
  });
  ui.notifications.info(`Ability renames: ${done.length} changes.`);
})();

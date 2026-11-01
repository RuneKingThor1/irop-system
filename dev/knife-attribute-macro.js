/**
 * Knives roll Agility (Johnald, 2026-11-01). Run once as the GM, as a script macro: it sets Attack roll
 * to Agility on the melee and thrown knives on the Items sidebar and the ones characters and NPCs carry.
 * It only fills in weapons left at By category, so a choice set by hand is never changed; run it again
 * after adding knives. It whispers a list of what it set.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const isKnife = w => (w.system.weaponType === "knife")
    || (!w.system.weaponType && /knife|dagger|kiritsuke|shiv|bayonet/i.test(w.name));
  const set = [];
  const fix = async (w, where) => {
    if ( (w.type !== "weapon") || w.system.attackAttr ) return;
    if ( !["melee", "thrown"].includes(w.system.category) || !isKnife(w) ) return;
    await w.update({ "system.attackAttr": "agi" });
    set.push(`${where}: ${w.name}`);
  };
  for ( const w of game.items ) await fix(w, "Items");
  for ( const actor of game.actors ) for ( const w of actor.items ) await fix(w, actor.name);
  const list = set.map(r => `<li>${foundry.utils.escapeHTML(r)}</li>`).join("");
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Knife attribute" },
    content: `<div class="irop-card"><header class="card-head"><h3>Knife attribute</h3><span class="card-sub">${set.length} set</span></header>
      ${set.length ? `<ul>${list}</ul>` : "<p>Every knife is already set.</p>"}</div>`
  });
  ui.notifications.info(`Knife attribute: ${set.length} set to Agility.`);
})();

/**
 * Two text fixes in the world (Johnald, 2026-11-01). The Door Warden background no longer says the drones
 * watched Earth for a quarter century: they sat dark while agents stayed and reported. The Reticulon species
 * says the Reti System, not Rigel. Run once as the GM, as a script macro: it fixes the Items sidebar and the
 * copies characters and NPCs carry, and whispers a list of what it changed. Safe to run again.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const OLD = "keeps the Stellar Doors and the drones that watched Earth for a quarter century.";
  const NEW = "keeps the Stellar Doors and the drones, and has read the reports of the agents on Earth for a quarter century.";
  const set = [];
  const fix = async (i, where) => {
    let text = null;
    if ( (i.type === "background") && (i.name === "Door Warden") ) text = i.system.description.replace(OLD, NEW);
    if ( (i.type === "species") && (i.name === "Reticulon") ) text = i.system.description.replaceAll("Rigel", "Reti");
    if ( (text === null) || (text === i.system.description) ) return;
    await i.update({ "system.description": text });
    set.push(`${where}: ${i.name}`);
  };
  for ( const i of game.items ) await fix(i, "Items");
  for ( const actor of game.actors ) for ( const i of actor.items ) await fix(i, actor.name);
  const list = set.map(r => `<li>${foundry.utils.escapeHTML(r)}</li>`).join("");
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Text fixes" },
    content: `<div class="irop-card"><header class="card-head"><h3>Text fixes</h3><span class="card-sub">${set.length} changed</span></header>
      ${set.length ? `<ul>${list}</ul>` : "<p>Nothing needed changing.</p>"}</div>`
  });
  ui.notifications.info(`Text fixes: ${set.length} changed.`);
})();

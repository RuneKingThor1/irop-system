/**
 * Faction census (Johnald, 2026-11-01). Run it as the GM, as a script macro: it reads the Factions tab and
 * saves irop-factions-<date>.json to your downloads, for Claude to file into the vault's 30 Factions and
 * 35 Minor Factions. It takes every faction, hidden ones included, with its standing, stance, notes and home,
 * plus the tasks they offer and the log of standing changes. It changes nothing in the world.
 */
(async () => {
  if ( game.system.id !== "irop" ) return ui.notifications.error("This macro is for the Insurrection system.");
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const api = game.irop?.strategy?.factions;
  if ( !api ) return ui.notifications.error("This world's irop system has no Factions.");

  const IROP = game.irop.config;
  const levels = IROP.factionLevels;
  const label = n => levels[String(n)]?.label ?? String(n);
  const homeName = id => (id ? (game.items.get(id)?.name ?? `(missing territory ${id})`) : "");

  const raw = api.list();
  const names = new Map(raw.map(f => [f.id, f.name]));
  const factions = raw.map(f => ({
    id: f.id,
    name: f.name,
    tier: f.tier,
    standing: f.standing,
    standingLabel: label(f.standing),
    points: f.points,
    stance: f.stance,
    home: homeName(f.home),
    hidden: f.hidden,
    notes: f.notes,
    image: f.img
  })).sort((a, b) => a.tier.localeCompare(b.tier) || a.name.localeCompare(b.name));
  const tasks = api.tasks().map(t => ({ ...t, faction: names.get(t.faction) ?? t.faction,
    rival: names.get(t.rival) ?? t.rival }));
  const log = api.log().map(e => ({ ...e, faction: names.get(e.faction) ?? e.faction }));

  const date = new Date().toISOString().slice(0, 10);
  const file = {
    kind: "irop-faction-census",
    format: 1,
    exported: new Date().toISOString(),
    world: game.world.title,
    system: game.system.version,
    factions,
    tasks,
    log
  };
  const filename = `irop-factions-${date}.json`;
  foundry.utils.saveDataToFile(JSON.stringify(file, null, 2), "application/json", filename);

  const esc = foundry.utils.escapeHTML;
  const list = factions.map(f => `<li>${esc(f.name)}: ${esc(f.standingLabel)}${f.hidden ? " (hidden)" : ""}</li>`).join("");
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Faction census" },
    content: `<div class="irop-card"><header class="card-head"><h3>Faction census</h3><span class="card-sub">${factions.length} saved</span></header>
      <p>Saved to your downloads as ${esc(filename)}, with ${tasks.length} tasks and ${log.length} log entries.</p><ul>${list}</ul></div>`
  });
  ui.notifications.info(`Faction census: ${factions.length} saved.`);
})();

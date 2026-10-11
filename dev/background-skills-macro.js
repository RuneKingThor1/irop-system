/**
 * Background skills (GM script macro, Insurrection system only). Johnald, 2026-10-10.
 *
 * Scans every background in the Items sidebar and in Item compendiums, and shows which skills the
 * backgrounds offer as starting skills (and how many backgrounds offer each), which skills none
 * of them offer, and each background's own list. Every list is read the way the character sheet
 * reads it, so an entry the sheet would not take as a skill is flagged too.
 *
 * To use: Macro Directory, Create Macro, Type: Script, paste this whole file, save, run.
 * Foundry shows nothing when a script macro fails, so any failure here is put on screen.
 */
if ( game.system.id !== "irop" ) return ui.notifications.error("This macro is for the Insurrection system.");
if ( !game.user.isGM ) return ui.notifications.error("This macro is GM only.");

try {
  // The sheet's own reader of skill lists. Loaded straight from the system when the system in
  // memory predates it (a world not reloaded since the update), so the macro never depends on that.
  const IROP = game.irop?.config ?? CONFIG.IROP;
  const startingSkills = game.irop?.rules?.startingSkills
    ?? await import(foundry.utils.getRoute("systems/irop/module/rules/starting-skills.mjs"));
  const { parseSkillNames } = startingSkills;
  const esc = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
  const label = key => IROP.skills[key]?.label ?? key;

  // Every background: the Items sidebar's, then the compendiums'.
  const found = [];
  for ( const item of game.items ) {
    if ( item.type !== "background" ) continue;
    found.push({ name: item.name, where: item.folder?.name ? `Items: ${item.folder.name}` : "Items",
      text: item.system.startingSkills ?? "", picks: item.system.skillPicks ?? 3 });
  }
  let fromPacks = 0;
  for ( const pack of game.packs ) {
    if ( pack.documentName !== "Item" ) continue;
    const index = await pack.getIndex({ fields: ["system.startingSkills", "system.skillPicks"] });
    for ( const entry of index ) {
      if ( entry.type !== "background" ) continue;
      fromPacks++;
      found.push({ name: entry.name, where: `Compendium: ${pack.metadata.label}`,
        text: entry.system?.startingSkills ?? "", picks: entry.system?.skillPicks ?? 3 });
    }
  }
  if ( !found.length ) return ui.notifications.warn("No backgrounds found in the Items sidebar or in any compendium.");

  // Two backgrounds of the same name are told apart by where they are.
  const nameCount = {};
  for ( const b of found ) nameCount[b.name] = (nameCount[b.name] ?? 0) + 1;
  const backgrounds = found.map(b => ({ ...b, ...parseSkillNames(b.text),
    title: (nameCount[b.name] > 1) ? `${b.name} (${b.where})` : b.name }));

  // Which backgrounds offer each skill.
  const offeredBy = Object.fromEntries(Object.keys(IROP.skills).map(key => [key, []]));
  for ( const b of backgrounds ) for ( const key of b.keys ) offeredBy[key]?.push(b.title);

  const groups = Object.entries(IROP.skillGroups).map(([group, g]) => ({
    label: g.label,
    keys: Object.keys(IROP.skills).filter(key => IROP.skills[key].group === group)
  }));
  const total = Object.keys(IROP.skills).length;
  const missing = Object.keys(IROP.skills).filter(key => !offeredBy[key].length);

  const cell = "padding: 3px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); vertical-align: top;";
  const head = "padding: 3px 8px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.75;";

  const missingHTML = missing.length
    ? groups.map(g => {
      const keys = g.keys.filter(key => missing.includes(key));
      return keys.length ? `<p style="margin: 2px 0;"><strong>${esc(g.label)}</strong>: ${keys.map(k => esc(label(k))).join(", ")}</p>` : "";
    }).join("")
    : "<p>Every skill is offered by at least one background.</p>";

  const offeredRows = groups.map(g => {
    const keys = g.keys.filter(key => offeredBy[key].length);
    if ( !keys.length ) return "";
    return `<tr><th colspan="3" style="${head} padding-top: 10px;">${esc(g.label)}</th></tr>`
      + keys.map(key => `<tr><td style="${cell} white-space: nowrap;"><strong>${esc(label(key))}</strong></td>
        <td style="${cell} text-align: center;">${offeredBy[key].length}</td>
        <td style="${cell}">${offeredBy[key].map(esc).join(", ")}</td></tr>`).join("");
  }).join("");

  const eachHTML = backgrounds.map(b => {
    const notes = [];
    if ( !b.keys.length ) notes.push("no starting skills listed");
    else if ( b.picks > b.keys.length ) notes.push(`lists only ${b.keys.length}, fewer than its ${b.picks} picks`);
    if ( b.unknown.length ) notes.push(`not a skill, so never offered: ${b.unknown.map(u => `"${esc(u)}"`).join(", ")}`);
    const list = b.keys.length ? b.keys.map(k => esc(label(k))).join(", ") : "";
    return `<li style="margin: 3px 0;"><strong>${esc(b.title)}</strong>: picks ${b.picks} of ${b.keys.length}${list ? `: ${list}` : ""}`
      + (notes.length ? `<br><span style="color: #d9b234;">${notes.join("; ")}</span>` : "") + "</li>";
  }).join("");

  const content = `<div class="background-skills-report">
    <p style="margin: 0 0 8px; opacity: 0.8;">${backgrounds.length} background${backgrounds.length === 1 ? "" : "s"} scanned
      (${backgrounds.length - fromPacks} in the Items sidebar, ${fromPacks} in compendiums). ${total} skills in all.</p>
    <h3 style="margin: 10px 0 4px;">Not offered by any background (${missing.length})</h3>
    ${missingHTML}
    <h3 style="margin: 14px 0 4px;">Offered (${total - missing.length} of ${total})</h3>
    <table style="width: 100%; border-collapse: collapse;">
      <thead><tr><th style="${head}">Skill</th><th style="${head} text-align: center;">Backgrounds</th><th style="${head}">Which</th></tr></thead>
      <tbody>${offeredRows}</tbody>
    </table>
    <h3 style="margin: 14px 0 4px;">Each background</h3>
    <ul style="margin: 0; padding-left: 18px;">${eachHTML}</ul>
  </div>`;

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Background skills", resizable: true },
    classes: ["irop"],
    position: { width: 720 },
    // A long report scrolls inside the window, which Foundry keeps from scrolling itself.
    content: `<div style="max-height: 65vh; overflow-y: auto; padding-right: 6px;">${content}</div>`,
    buttons: [
      { action: "chat", label: "Whisper it to me", icon: "fa-solid fa-comment" },
      { action: "close", label: "Close", icon: "fa-solid fa-xmark", default: true }
    ],
    rejectClose: false
  });
  if ( choice === "chat" ) {
    await CONFIG.ChatMessage.documentClass.create({ content, whisper: [game.user.id], speaker: { alias: "Background skills" } });
  }
}
catch(err) {
  console.error("irop | Background skills macro", err);
  ui.notifications.error(`Background skills macro failed: ${err.message}. The console (F12) has the details.`);
}

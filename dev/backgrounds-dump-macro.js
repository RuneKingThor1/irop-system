/**
 * Backgrounds, in full (GM script macro, Insurrection system only). Johnald, 2026-10-11.
 *
 * Gathers every background in the Items sidebar and in Item compendiums: its name, where it
 * is, its description, its starting skills, whether it is paraphysical, any effects, and each
 * of its background perks with the perk's own text (read from the ability each perk points at).
 *
 * Saves it all as irop-backgrounds.md in your downloads folder, for Claude to read, and shows
 * it in a window as well, to copy from.
 *
 * To use: Macro Directory, Create Macro, Type: Script, paste this whole file, save, run.
 * Foundry shows nothing when a script macro fails, so any failure here is put on screen.
 */
if ( game.system.id !== "irop" ) return ui.notifications.error("This macro is for the Insurrection system.");
if ( !game.user.isGM ) return ui.notifications.error("This macro is GM only.");

try {
  const IROP = game.irop?.config ?? CONFIG.IROP;
  const esc = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

  /** Rich text as plain text: paragraphs and list items on lines of their own, links as their names. */
  const plain = html => {
    const div = document.createElement("div");
    div.innerHTML = String(html ?? "").replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@\w+\[([^\]]*)\]/g, "$1");
    div.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
    div.querySelectorAll("li").forEach(li => li.prepend("* "));
    div.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, tr, blockquote").forEach(el => el.append("\n"));
    return div.textContent.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  };

  /** An effect's changes in a line: "vitals.hp.bonus add 2". */
  const effectLines = doc => [...(doc?.effects ?? [])].map(effect => {
    const changes = effect.system?.changes ?? effect.changes ?? [];
    const what = changes.map(c => `${String(c.key ?? "").replace(/^system\./, "")} ${c.type ?? ""} ${c.value}`.replace(/\s+/g, " ").trim());
    return `${effect.name}${effect.disabled ? " (off)" : ""}${what.length ? `: ${what.join("; ")}` : ""}`;
  });

  /** A perk, read from the ability it points at. */
  const perkText = async perk => {
    const ability = perk.uuid ? await fromUuid(perk.uuid).catch(() => null) : null;
    const lines = [`#### ${perk.name || ability?.name || "Unnamed perk"}`];
    if ( !ability ) {
      lines.push(perk.uuid ? `(Its ability could not be found: ${perk.uuid})` : "(No ability linked.)");
      return lines.join("\n");
    }
    const s = ability.system;
    const facts = [
      s.kind === "passive" ? "Passive" : "Active",
      IROP.abilitySources?.[s.source] ? `source ${IROP.abilitySources[s.source]}` : "",
      (s.kind !== "passive" && IROP.actionTypes?.[s.actionType]) ? IROP.actionTypes[s.actionType] : "",
      s.energyCost ? `${s.energyCost} Energy` : "",
      s.uses?.max ? `${s.uses.max} uses` : "",
      s.range ? `range ${s.range}` : "",
      s.area ? `area ${s.area}` : "",
      s.paraphysics?.discipline ? `paraphysics: ${IROP.disciplines?.[s.paraphysics.discipline] ?? s.paraphysics.discipline}` : "",
      s.prerequisites ? `needs ${s.prerequisites}` : ""
    ].filter(Boolean);
    if ( ability.name !== perk.name ) lines.push(`Ability: ${ability.name}`);
    lines.push(`(${facts.join(", ")})`);
    lines.push(plain(s.description) || "(No text.)");
    const effects = effectLines(ability);
    if ( effects.length ) lines.push(`Effects: ${effects.join(" | ")}`);
    return lines.join("\n");
  };

  // Every background: the Items sidebar's, then the compendiums'.
  const found = [];
  for ( const item of game.items ) {
    if ( item.type === "background" ) found.push({ item, where: item.folder?.name ? `Items, folder ${item.folder.name}` : "Items" });
  }
  for ( const pack of game.packs ) {
    if ( pack.documentName !== "Item" ) continue;
    const index = await pack.getIndex();
    if ( !index.some(e => e.type === "background") ) continue;
    for ( const item of await pack.getDocuments({ type: "background" }) ) found.push({ item, where: `Compendium ${pack.metadata.label}` });
  }
  if ( !found.length ) return ui.notifications.warn("No backgrounds found in the Items sidebar or in any Item compendium.");
  found.sort((a, b) => a.item.name.localeCompare(b.item.name));

  const out = [
    "# Insurrection backgrounds",
    `World: ${game.world.title}. System version ${game.system.version}. Scanned ${new Date().toLocaleString()}.`,
    `${found.length} backgrounds: ${found.filter(f => f.where.startsWith("Items")).length} in the Items sidebar, ${found.filter(f => f.where.startsWith("Compendium")).length} in compendiums.`,
    ""
  ];
  for ( const { item, where } of found ) {
    const s = item.system;
    out.push(`## ${item.name}`);
    out.push(`Where: ${where}. Id: ${item.uuid}.`);
    out.push(`Starting skills (pick ${s.skillPicks ?? 3}): ${s.startingSkills || "(none listed)"}`);
    out.push(`Paraphysical: ${s.paraphysical ? "yes" : "no"}`);
    const effects = effectLines(item);
    if ( effects.length ) out.push(`Effects: ${effects.join(" | ")}`);
    out.push("", "### Description", plain(s.description) || "(No description.)", "");
    const perks = s.perks ?? [];
    out.push(`### Background perks (${perks.length})`);
    if ( !perks.length ) out.push("(None.)");
    for ( const perk of perks ) out.push(await perkText(perk), "");
    out.push("");
  }
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n");

  foundry.utils.saveDataToFile(text, "text/markdown", "irop-backgrounds.md");
  await foundry.applications.api.DialogV2.prompt({
    window: { title: `Backgrounds: ${found.length} found` },
    position: { width: 720 },
    content: `<p>Saved as <strong>irop-backgrounds.md</strong> in your downloads folder. Everything is below too, to copy.</p>
      <textarea readonly rows="22" style="width:100%;font-family:monospace;font-size:12px">${esc(text)}</textarea>`,
    ok: { label: "Close" },
    rejectClose: false
  });
} catch ( err ) {
  console.error("Backgrounds macro failed", err);
  ui.notifications.error(`The backgrounds macro failed: ${err.message}. The console (F12) has the details.`);
}

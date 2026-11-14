/**
 * Operative census (Johnald, 2026-11-01). The Sandbox era census cannot read this system's sheets, so this
 * is its replacement. Run it as the GM, as a script macro: it reads every operative sheet in the world and
 * saves irop-operatives-<date>.json to your downloads, for Claude to file into the vault's 20 Operatives.
 * It changes nothing in the world. Sheets in a test folder are left out; a sheet that cannot be read is
 * listed under warnings in the file, and the rest still save. Set includeNpcs to take NPC sheets as well.
 */
(async () => {
  if ( game.system.id !== "irop" ) return ui.notifications.error("This macro is for the Insurrection system.");
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");

  const CFG = {
    includeNpcs: false,
    skipFolders: /test kit/i
  };

  const IROP = game.irop.config;
  const warnings = [];

  /** Rich text as plain text: paragraphs and list items on lines of their own, links as their names. */
  const plain = html => {
    const div = document.createElement("div");
    div.innerHTML = String(html ?? "").replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@\w+\[([^\]]*)\]/g, "$1");
    div.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
    div.querySelectorAll("li").forEach(li => li.prepend("* "));
    div.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, tr, blockquote").forEach(el => el.append("\n"));
    return div.textContent.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  };

  const folderPath = doc => {
    const names = [];
    for ( let f = doc.folder; f; f = f.folder ) names.unshift(f.name);
    return names;
  };

  const players = actor => game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.name);

  /** What every item on a sheet shares, then what its type adds. */
  const item = i => {
    const s = i.system;
    const out = { name: i.name, type: i.type };
    if ( "quantity" in s ) Object.assign(out, { quantity: s.quantity, equipped: s.equipped, stowed: s.stowed });
    if ( i.type === "ability" ) {
      Object.assign(out, { kind: s.kind, source: s.source, tree: s.tree, discipline: s.paraphysics?.discipline ?? "" });
    }
    if ( i.type === "boon" ) Object.assign(out, { attribute: s.attribute, amount: s.amount });
    if ( i.type === "mutation" ) out.chosen = s.chosen ?? null;
    if ( ["species", "role", "background", "mutation"].includes(i.type) ) out.description = plain(s.description);
    return out;
  };

  const record = r => {
    const out = {};
    for ( const f of [...IROP.record.identity, ...IROP.record.service] ) out[f.key] = r[f.key] ?? "";
    out.marks = r.marks;
    out.nextOfKin = r.nextOfKin;
    out.medals = r.medals;
    out.timeline = r.timeline;
    return out;
  };

  const sheet = actor => {
    const s = actor.system;
    const all = actor.items.map(item);
    const ofType = type => all.filter(i => i.type === type);
    const one = type => ofType(type)[0]?.name ?? null;
    const common = {
      id: actor.id,
      name: actor.name,
      type: actor.type,
      folder: folderPath(actor),
      players: players(actor),
      portrait: actor.img,
      species: one("species"),
      role: one("role"),
      background: one("background"),
      statuses: [...(actor.statuses ?? [])],
      attributes: Object.fromEntries(Object.keys(IROP.attributes).map(k => [k, {
        value: s.attributes[k].value, base: s.attributes[k].base, advances: s.attributes[k].advances,
        boons: s.attributes[k].boons ?? 0, mutation: s.attributes[k].mutation ?? 0, perks: s.attributes[k].perks ?? 0
      }])),
      skills: Object.fromEntries(Object.keys(IROP.skills).filter(k => s.skills[k].rank > 0)
        .map(k => [IROP.skills[k].label, s.skills[k].rank])),
      vitals: {
        hp: s.vitals.hp.value, hpMax: s.vitals.hp.max, energy: s.vitals.energy.value, energyMax: s.vitals.energy.max,
        armor: s.vitals.armor.value, armorMax: s.vitals.armor.max, barrier: s.vitals.barrier.value, barrierMax: s.vitals.barrier.max
      },
      paraphysics: {
        paraphysical: s.isParaphysical,
        awakened: s.psi.awakened,
        crystals: s.psi.crystals,
        casting: s.casting?.attribute ?? null,
        disciplines: Object.fromEntries(Object.entries(s.disciplines ?? {}).filter(([, d]) => d.rank > 0)
          .map(([k, d]) => [IROP.disciplines[k] ?? k, d.rank]))
      },
      boons: ofType("boon"),
      mutations: ofType("mutation"),
      perks: ofType("ability").filter(a => !a.discipline),
      powers: ofType("ability").filter(a => a.discipline),
      weapons: ofType("weapon"),
      armor: ofType("armor"),
      gear: ofType("gear"),
      mods: ofType("mod"),
      speciesText: ofType("species")[0]?.description ?? "",
      roleText: ofType("role")[0]?.description ?? "",
      backgroundText: ofType("background")[0]?.description ?? "",
      biography: plain(s.details.biography),
      gmNotes: plain(s.details.notes)
    };
    if ( actor.type === "npc" ) {
      return { ...common, threat: s.details.threat, caste: s.details.caste, faction: s.details.faction };
    }
    return {
      ...common,
      callsign: s.details.callsign,
      rank: s.serviceRank?.label ?? "",
      xp: { earned: s.xp.earned, spent: s.xp.spent, unspent: s.xp.unspent, log: s.xp.log },
      wealth: s.wealth,
      record: record(s.details.record)
    };
  };

  const types = CFG.includeNpcs ? ["operative", "npc"] : ["operative"];
  const operatives = [];
  let skipped = 0;
  for ( const actor of game.actors ) {
    if ( !types.includes(actor.type) ) continue;
    if ( folderPath(actor).some(name => CFG.skipFolders.test(name)) ) {
      skipped += 1;
      continue;
    }
    try {
      operatives.push(sheet(actor));
    }
    catch(err) {
      warnings.push(`${actor.name}: ${err.message}`);
    }
  }
  operatives.sort((a, b) => a.name.localeCompare(b.name));

  const date = new Date().toISOString().slice(0, 10);
  const file = {
    kind: "irop-operative-census",
    format: 1,
    exported: new Date().toISOString(),
    world: game.world.title,
    system: game.system.version,
    skippedTestSheets: skipped,
    warnings,
    operatives
  };
  const filename = `irop-operatives-${date}.json`;
  foundry.utils.saveDataToFile(JSON.stringify(file, null, 2), "application/json", filename);

  const esc = foundry.utils.escapeHTML;
  const list = operatives.map(o => `<li>${esc(o.name)}: ${esc(o.role ?? "no role")}, ${esc(o.species ?? "no species")}</li>`).join("");
  const warned = warnings.map(w => `<li>${esc(w)}</li>`).join("");
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Operative census" },
    content: `<div class="irop-card"><header class="card-head"><h3>Operative census</h3><span class="card-sub">${operatives.length} saved</span></header>
      <p>Saved to your downloads as ${esc(filename)}.</p><ul>${list}</ul>
      ${warned ? `<p>Could not read:</p><ul>${warned}</ul>` : ""}</div>`
  });
  ui.notifications.info(`Operative census: ${operatives.length} saved${warnings.length ? `, ${warnings.length} could not be read` : ""}.`);
})();

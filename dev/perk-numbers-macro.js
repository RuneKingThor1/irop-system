/**
 * Background perk numbers only (GM script macro, Insurrection system 0.1.3 or later). 2026-11-14.
 *
 * Bug 2026-11-14 (Johnald): Smuggler did not add its +10% concealment. The +10 lives in an effect on
 * the perk, which dev/background-perks-fix-macro.js was to add; a perk without that effect does
 * nothing. This puts the numbers on, and nothing else: unlike that macro it never touches a perk's
 * name or text, so wording edited since is safe.
 *
 * For each perk below, on the world's copy (the one the background points at, or any world ability of
 * that name) and on every character's copy:
 *   - an effect carrying its numbers is made afresh (the old one, flagged irop.perkNumbers, replaced)
 *   - a hand made effect with the same change already on it is left alone, and nothing is added
 * Then it reports, for each character with Smuggler or Model Citizen, the concealment bonus the
 * system now sees.
 *
 * Safe to run again. To use: Macro Directory, Create Macro, Type: Script, paste this whole file,
 * save, run.
 */
if ( game.system.id !== "irop" ) return ui.notifications.error("This macro is for the Insurrection system.");
if ( !game.user.isGM ) return ui.notifications.error("This macro is GM only.");

try {
  const B = "system.bonuses";
  const S = `${B}.strategy`;
  // Each perk with numbers: the names it may go by, and its changes. From background-perks-fix-macro.js.
  const NUMBERS = [
    { names: ["Information Connoisseur", "Infomation Connessiour"], changes: { [`${S}.mission.intel`]: 10 } },
    { names: ["Smuggler"], changes: { [`${B}.concealment`]: 10 } },
    { names: ["Wake Them Up", "Wake them Up"], changes: { [`${S}.mission.reputation.megacity`]: 2 } },
    { names: ["Insider Knowledge"], changes: { [`${S}.intelMegacity`]: 5 } },
    { names: ["Model Citizen"], changes: { [`${B}.concealmentAt.megacity`]: 5 } },
    { names: ["Engineering Division"], changes: { [`${S}.perRank.engineering.technology`]: 5, [`${S}.perRank.engineering.mechanics`]: 5, [`${S}.perRank.engineering.cybernetics`]: 5 } },
    { names: ["Science Division"], changes: { [`${S}.perRank.research.technology`]: 5, [`${S}.perRank.research.cybernetics`]: 5, [`${S}.perRank.research.biology`]: 5 } },
    { names: ["Supply Run"], changes: { [`${S}.mission.logistics`]: 10 } },
    { names: ["Boots on the Ground"], changes: { [`${S}.laborToughness`]: 1 } },
    { names: ["One of Us"], changes: { [`${S}.mission.reputation.slums`]: 2 } },
    { names: ["Know Their Ways", "Know their ways"], changes: { [`${S}.perRank.intelligence.deception`]: 5, [`${S}.perRank.intelligence.coercion`]: 5 } },
    { names: ["Community Focused"], changes: { [`${S}.mission.reputation.rural`]: 2 } },
    { names: ["Waste Not"], changes: { [`${S}.mission.logistics`]: 5, [`${S}.mission.intel`]: 5 } },
    { names: ["Man of Tomorrow"], changes: { [`${S}.mission.intel`]: 5, [`${S}.mission.reputation.megacity`]: 1, [`${S}.mission.reputation.slums`]: 1,
      [`${S}.mission.reputation.rural`]: 1, [`${S}.mission.reputation.wildland`]: 1 } },
    { names: ["Weird Science"], changes: { [`${S}.perRank.research.xenotech`]: 5, [`${S}.perRank.research.paraphysics`]: 5, [`${S}.perRank.research.xenobiology`]: 5 } }
  ];
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const specFor = name => NUMBERS.find(n => n.names.some(x => fold(x) === fold(name))) ?? null;

  /** The changes on an item's effects that the macro did not make: [key, value]. */
  const handMade = item => {
    const out = [];
    for ( const e of item.effects ) {
      if ( e.getFlag("irop", "perkNumbers") ) continue;
      for ( const c of (e.system?.changes ?? e.changes ?? []) ) out.push(`${c.key}=${Number(c.value)}`);
    }
    return out;
  };

  /** Give one ability its numbers. Returns what happened. */
  const apply = async (item, spec) => {
    const wanted = Object.entries(spec.changes);
    const already = handMade(item);
    if ( wanted.every(([k, v]) => already.includes(`${k}=${Number(v)}`)) ) return "kept";
    const old = [];
    for ( const e of item.effects ) if ( e.getFlag("irop", "perkNumbers") ) old.push(e.id);
    if ( old.length ) await item.deleteEmbeddedDocuments("ActiveEffect", old);
    await item.createEmbeddedDocuments("ActiveEffect", [{
      name: item.name, img: item.img, transfer: true, disabled: false,
      system: { changes: wanted.map(([key, value]) => ({ key, type: "add", value: String(value) })) },
      flags: { irop: { perkNumbers: true } }
    }]);
    return old.length ? "replaced" : "added";
  };

  const tally = { added: [], replaced: [], kept: [] };
  for ( const item of game.items ) {
    if ( item.type !== "ability" ) continue;
    const spec = specFor(item.name);
    if ( spec ) tally[await apply(item, spec)].push(`${item.name} (world)`);
  }
  const report = [];
  for ( const actor of game.actors ) {
    let concealmentPerk = false;
    for ( const item of actor.items ) {
      if ( item.type !== "ability" ) continue;
      const spec = specFor(item.name);
      if ( !spec ) continue;
      tally[await apply(item, spec)].push(`${item.name} (${actor.name})`);
      if ( ["smuggler", "modelcitizen"].includes(fold(item.name)) ) concealmentPerk = true;
    }
    if ( concealmentPerk ) {
      const c = actor.system?.concealment ?? {};
      const at = Object.entries(c.bonusAt ?? {}).filter(([, n]) => n).map(([k, n]) => `${k} +${n}%`).join(", ");
      report.push(`${actor.name}: +${Number(c.bonus) || 0}% everywhere${at ? `, ${at}` : ""}`);
    }
  }

  const lines = [
    `Numbers added to ${tally.added.length}, replaced on ${tally.replaced.length}, already there on ${tally.kept.length}.`,
    report.length ? `Concealment now: ${report.join("; ")}.` : "No character has Smuggler or Model Citizen."
  ];
  console.log("irop | perk numbers", tally, report);
  ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients("GM"), content: `<p><b>Background perk numbers</b></p>${lines.map(l => `<p>${l}</p>`).join("")}` });
  ui.notifications.info(lines[0]);
} catch ( err ) {
  console.error("Perk numbers macro failed", err);
  ui.notifications.error(`The perk numbers macro failed: ${err.message}. The console (F12) has the details.`);
}

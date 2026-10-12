/**
 * Seed the Factions tab from the campaign archive (2026-10-11). Run once as the GM, as
 * a script macro, after updating the system. Safe to run again: a faction already on
 * the board (by name) is left as it is.
 *
 * Starting standings come from WORLD STATE's Faction posture table (as of OP-008), read
 * onto the factions' ladder (RULED 2026-10-11: -4 At War to +4 Allied, each level a bar of
 * 10 points, every faction starting mid bar). The vault's word picks the level where the
 * ladder has it: Hostile -3, Neutral and Business only 0, Friendly +2, Allied +4. The shades
 * between are ASSUMPTIONS for Johnald to adjust on the board: Dangerous ally +2 (Friendly),
 * Willing, not trustworthy +1 (Cordial).
 * Left off: GENESIS (the enemy, not a standing), Eclipse (the ODR itself), and
 * Perkins' Crew (destroyed to the last member).
 * Homes are matched to territory items by name; a missing one is left blank.
 */
(async () => {
  const api = game.irop?.strategy?.factions;
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  if ( !api ) return ui.notifications.error("This world's irop system has no Factions yet. Update the system, then run this again.");

  const FACTIONS = [
    // Tier 1 groups: humanity's major players.
    { name: "GIA", tier: "major", standing: -3, stance: "Pro alien. The Xargryr's deniable assets",
      notes: "The Global Integration Agency. An element was at the safehouse on OP-003 Baited Hook. Malas Divide defected from them, and his badge still opens doors." },
    { name: "Zaibatsu", tier: "major", standing: 0, stance: "Business only. Will deal with anyone but GENESIS",
      notes: "Criminal cartels, smugglers and mercenaries. No confirmed contact." },
    { name: "The Ark Society", tier: "major", standing: 0, stance: "Neutral. Thinks resistance is futile",
      notes: "Scientists and engineers building a colony ship. Harun, the engineer rescued on OP-001 Older Yeller, is with Eclipse." },
    { name: "Terra Firma", tier: "major", standing: 2, stance: "Dangerous ally. Xenophobes",
      notes: "Want the Xargryr annihilated at any cost to themselves. Perkins' Crew died working for them; Eclipse holds the journal. No direct contact." },
    { name: "The Invisible Hand", tier: "major", standing: 1, stance: "Willing, not trustworthy",
      notes: "Opportunists who want to rule. Ran the heist on OP-003 Baited Hook, with ZeRoReZ as an unwitting pawn. Never made contact." },
    // Minor factions.
    { name: "Copperhides", tier: "minor", standing: 4, stance: "Allied. No Monarch", home: "Malmstrom",
      notes: "Mutant clan of Malmstrom. Their home at Ryan Dam was cleared on OP-008 Operation Eviction and returned to them. They work with Fort Benton." },
    { name: "Mutants of Earth", tier: "minor", standing: 4, stance: "Allied. The first non human alliance", home: "Malmstrom",
      notes: "Peace talks at The Docks on OP-006 Friends in Dead Places were disrupted by a Pale Son, recovered, and concluded." },
    { name: "Whitewater Police", tier: "minor", standing: 4, stance: "Allied. Relocating and rebuilding Whitewater", home: "Black Hills",
      notes: "Small town police of the Black Hills. Two officers fought beside the cell at the crash site on OP-007 and went home to help the town rebuild." },
    { name: "Fort Benton", tier: "minor", standing: 2, stance: "Friendly. Never visited", home: "Malmstrom",
      notes: "A human settlement in Montana under its own mayor, Simon Pepper. Works with the Copperhides. Treating Aidai." },
    { name: "Scrap Hounds", tier: "minor", standing: 0, stance: "Neutral. Never seen", home: "Eight Forests",
      notes: "Scavengers working the aftermath of fights in the north. They stripped The Eights before Eclipse arrived on OP-002." },
    { name: "Pale Sons", tier: "minor", standing: -3, stance: "Hostile. They collect paraphysical humans", home: "Malmstrom",
      notes: "Mutant clan of Malmstrom under the Pale Sovereign. Lost a camp, a forward position and an Image of the Master at Ryan Dam on OP-008." },
    { name: "The Mongrels", tier: "minor", standing: -3, stance: "Hostile. Broken and scattered",
      notes: "A slum gang of Slum Sector Grid 12-B, broken on OP-001 Older Yeller. Not an occupation asset: a human problem in an occupied city." }
  ];

  const have = new Set(api.list().map(f => f.name.toLowerCase()));
  const territory = name => game.items.find(i => (i.type === "territory") && (i.name.toLowerCase() === String(name ?? "").toLowerCase()))?.id ?? "";
  const added = [];
  const noHome = [];
  for ( const f of FACTIONS ) {
    if ( have.has(f.name.toLowerCase()) ) continue;
    const home = territory(f.home);
    if ( f.home && !home ) noHome.push(`${f.name} (${f.home})`);
    await api.save({ ...f, home });
    added.push(f.name);
  }
  const skipped = FACTIONS.length - added.length;
  ui.notifications.info(`Factions: ${added.length} added${skipped ? `, ${skipped} already on the board` : ""}.`);
  if ( noHome.length ) ui.notifications.warn(`No territory found for: ${noHome.join(", ")}. Set their homes on the board.`);
  api.open();
})();

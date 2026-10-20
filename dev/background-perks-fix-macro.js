/**
 * Background perks: spelling, grammar, schedules and numbers (GM script macro, Insurrection
 * system 0.1.3 or later). Johnald, 2026-10-11.
 *
 * For every background perk (the ability each background's perk points at):
 *   - the name and text with their spelling and grammar fixed, names in title case
 *   - the resource perks set to once per strategy layer turn
 *   - the numbers as effects, so the system applies them: concealment (Smuggler, Model Citizen),
 *     project contributions (the Divisions, Weird Science, Know Their Ways, Insider Knowledge,
 *     Boots on the Ground), and what a successful mission brings back (Information Connoisseur,
 *     Supply Run, Waste Not, and the Reputation perks)
 * The same goes for the copies operatives have already taken. Innovater becomes Innovator,
 * on the background and on every operative who has it, with their perk still linked.
 * Awakened's three perks were written 2026-10-20 (Johnald): Weird World, Power Overwhelming and
 * Man of Tomorrow. The backgrounds' own descriptions are left alone.
 *
 * Safe to run again: it finds perks by their old name or their new one, and replaces the effects
 * it made before rather than adding more.
 *
 * To use: Macro Directory, Create Macro, Type: Script, paste this whole file, save, run.
 */
if ( game.system.id !== "irop" ) return ui.notifications.error("This macro is for the Insurrection system.");
if ( !game.user.isGM ) return ui.notifications.error("This macro is GM only.");
if ( !CONFIG.Actor.dataModels?.operative?.schema?.getField?.("bonuses.strategy") ) {
  return ui.notifications.error("Update the Insurrection system first (0.1.3 or later): these perks' numbers need it.");
}

try {
  const p = (...lines) => lines.map(l => `<p>${l}</p>`).join("");
  const list = (items) => `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
  const B = "system.bonuses";
  const S = `${B}.strategy`;

  // Background name, then each perk: the names it may go by now, its new name, its text, its numbers.
  const PERKS = {
    "Agent": [
      { from: ["Master of Disguise"], name: "Master of Disguise",
        text: p("As a master of disguise, you rarely have trouble blending in with or infiltrating a group or place. Once per session, you can ask the GM one question about how best to blend in with a group or a place, and the GM must answer honestly.") },
      { from: ["Nothing's Safe"], name: "Nothing's Safe",
        text: p("You are a master of subtlety in lock picking and hacking. If you are opening a secured object by hacking or lock picking and an alarm would trip, the GM tells you, and you can cancel that alarm. Usable once per session.") },
      { from: ["Infomation Connessiour", "Information Connoisseur"], name: "Information Connoisseur",
        text: p("You are a master at gathering information where others find none. Once per strategy layer turn, after a successful mission, you bring back 10 bonus Intel for your faction."),
        changes: { [`${S}.mission.intel`]: 10 } }
    ],
    "Criminal": [
      { from: ["Breaking and Entering"], name: "Breaking and Entering",
        text: p("You can always find some way into a building, no matter how secure it is. Once per session, you learn about one non-obvious physical entrance into a location.") },
      { from: ["Smuggler"], name: "Smuggler",
        text: p("You are used to smuggling items into and out of places they shouldn't be. Your concealment thresholds are 10% higher in the slums and in megacities."),
        changes: { [`${B}.concealment`]: 10 } },
      { from: ["Now you listen to me.", "Now You Listen to Me"], name: "Now You Listen to Me",
        text: p("Once per session, you can force a civilian or a captive to answer one question truthfully.", "This does not work on GENESIS.") }
    ],
    "Former Citizen": [
      { from: ["Wake them Up", "Wake Them Up"], name: "Wake Them Up",
        text: p("You know what it took to open your own eyes to the wrongs of GENESIS and their overlords. Once per strategy layer turn, after a successful mission in a megacity region, Reputation there rises by 2 extra points."),
        changes: { [`${S}.mission.reputation.megacity`]: 2 } },
      { from: ["Insider Knowledge"], name: "Insider Knowledge",
        text: p("Having lived in a megacity, you know the lay of the land and the schedules its people keep. When you are assigned to an Intelligence Action that affects something within a megacity, add 5 Intel per turn, even if you do not have a skill suited to the action."),
        changes: { [`${S}.intelMegacity`]: 5 } },
      { from: ["Model Citizen"], name: "Model Citizen",
        text: p("You know the rhythm of city life. Once per session, the GM tells you how a megacity institution runs: shift changes, inspection times, which entrance the staff use. Furthermore, your concealment threshold in megacities is 5% higher."),
        changes: { [`${B}.concealmentAt.megacity`]: 5 } }
    ],
    "Innovator": [
      { from: ["Field Tinkering"], name: "Field Tinkering",
        text: p("Once per mission, outside of combat, you can make a simple tool from what's lying around: a lock bypass, a radio relay, a hacking tool, a noisemaker, and the like. These tools work once and cannot be sold.") },
      { from: ["Engineering Division"], name: "Engineering Division",
        text: p("When you are assigned to an Engineering project, you count Technology, Mechanics and Cybernetics at +10 per skill rank instead of +5."),
        changes: { [`${S}.perRank.engineering.technology`]: 5, [`${S}.perRank.engineering.mechanics`]: 5, [`${S}.perRank.engineering.cybernetics`]: 5 } },
      { from: ["Science Division"], name: "Science Division",
        text: p("When you are assigned to a Research project, you count Technology, Cybernetics and Biology at +10 per skill rank instead of +5."),
        changes: { [`${S}.perRank.research.technology`]: 5, [`${S}.perRank.research.cybernetics`]: 5, [`${S}.perRank.research.biology`]: 5 } }
    ],
    "Leader": [
      { from: ["Fallback Plan"], name: "Fallback Plan",
        text: p("Once per mission, if a plan of action collapses, declare a fallback point you briefed beforehand. As long as the GM agrees it is reachable, your squad can fall back to that point and wait for the HEAT response to die down.") },
      { from: ["Snap out of it!", "Snap Out of It!"], name: "Snap Out of It!",
        text: p("Once per mission, you can snap someone out of a panicked state, whether its cause is ordinary or paraphysical.") },
      { from: ["Read the Room"], name: "Read the Room",
        text: p("Once per mission, you can do one of the following:") + list([
          "Read the emotional state of a group.",
          "Learn what someone wants in a negotiation.",
          "Understand which social skill would work best on a particular person."]) }
    ],
    "Long War Veteran": [
      { from: ["We can do this all day!", "We Can Do This All Day!"], name: "We Can Do This All Day!",
        text: p("You've held the line since the First War, and you have no intention of letting it fall. Once per combat, as a quick action, you rally yourself and every ally you can see: each of you regains 3 Energy.") },
      { from: ["Know your Enemy", "Know Your Enemy"], name: "Know Your Enemy",
        text: p("You're sure you've seen every trick the aliens and GENESIS have pulled. Once per mission, you may ask the GM the purpose or tactical use of any alien building, vehicle or unit.", "This covers the aliens, not GENESIS.") },
      { from: ["I remember this Place", "I Remember This Place"], name: "I Remember This Place",
        text: p("You knew the Earth well before the fall. Once per mission, you can ask the GM to reveal one old-world feature of the location you are in: an old bunker, a service tunnel, a hunting lodge, and so on. Such places may hold another way through a mission, or rare resources and items.") }
    ],
    "Resistance Soldier": [
      { from: ["Supply Run"], name: "Supply Run",
        text: p("You always manage to bring back a little something extra. Once per strategy layer turn, after a successful mission, you bring back an additional 10 Logistics worth of supplies."),
        changes: { [`${S}.mission.logistics`]: 10 } },
      { from: ["Keep your head on a Swivel", "Keep Your Head on a Swivel"], name: "Keep Your Head on a Swivel",
        text: p("You are always alert to your surroundings. Once per mission, you and your squad cannot be caught unaware by an enemy ambush, as long as the enemy is not cloaked.") },
      { from: ["Boots on the Ground"], name: "Boots on the Ground",
        text: p("When you are assigned to give labor to an Engineering project, you add both your Toughness and your Strength modifiers to your labor."),
        changes: { [`${S}.laborToughness`]: 1 } }
    ],
    "Slum Dweller": [
      { from: ["Rooftops and Alleys"], name: "Rooftops and Alleys",
        text: p("You know the slums like the back of your hand. Once per mission in a slums region, you can lead the squad out of a cordon or pursuit unseen.") },
      { from: ["Word on the Street"], name: "Word on the Street",
        text: p("Once per session in a slums region, ask the GM one question about local gossip:") + list([
          "Who informs for GENESIS.", "Where the patrols aren't going.", "Who's selling what."]) + p("The GM must answer honestly.") },
      { from: ["One of Us"], name: "One of Us",
        text: p("Once per strategy layer turn, after a successful mission in a slums region, Reputation there rises by 2 extra points."),
        changes: { [`${S}.mission.reputation.slums`]: 2 } }
    ],
    "Survivalist": [
      { from: ["Home Remedy"], name: "Home Remedy",
        text: p("Once per mission, outside of combat, in a wildlands or havens region, you can craft one single-use basic medical item, such as a Medkit, an Antidote or a Warming Balm.") },
      { from: ["Theres always a Way", "There's Always a Way"], name: "There's Always a Way",
        text: p("During any mission, you can recover an enemy's corpse without it counting against anyone's carry capacity.") },
      { from: ["Ranger"], name: "Ranger",
        text: p("Once per mission in a wildlands region or a tomb city, you can ask the GM one question:") + list([
          "About any natural hazards ahead.",
          "Who or what has passed through an area in the last day or so, and how many.",
          "About any unique or interesting landmarks nearby that might hold extra supplies or rare finds."]) + p("The GM must answer honestly.") }
    ],
    "Turncoat": [
      { from: ["Know their ways", "Know Their Ways"], name: "Know Their Ways",
        text: p("After working with groups that collaborate with GENESIS, you know how to turn their techniques to Intel operations. On short or long term Intelligence Actions against GENESIS, you count Deception and Coercion at +10 per skill rank instead of +5."),
        changes: { [`${S}.perRank.intelligence.deception`]: 5, [`${S}.perRank.intelligence.coercion`]: 5 } },
      { from: ["GENESIS Insight"], name: "GENESIS Insight",
        text: p("Having worked with GENESIS in one way or another, you've gained some insight into how they operate. Once per session, in combat, you can ask the GM what any GENESIS unit you can see will do next. The GM must answer honestly.") },
      { from: ["Voice of Authority"], name: "Voice of Authority",
        text: p("You still carry the voice of authority you had when you worked with 'them', and you can sometimes use it to get what you want. Once per session, you can force a civilian to comply with one reasonable order you give.") }
    ],
    "Wildlander": [
      { from: ["Community Focused"], name: "Community Focused",
        text: p("Once per strategy layer turn, after a successful mission in a havens region, Reputation there rises by 2 extra points."),
        changes: { [`${S}.mission.reputation.rural`]: 2 } },
      { from: ["Nomads Tongue", "Nomad's Tongue"], name: "Nomad's Tongue",
        text: p("Once per session, you can ask fellow Wildlanders, nomads, or the GM any question about:") + list([
          "New trading posts that have sprung up.",
          "Recent unusual activity nearby, such as GENESIS movements or paraphysical storms.",
          "Any havens in some sort of trouble, and what that trouble is."]) + p("The GM must answer honestly.") },
      { from: ["Waste Not"], name: "Waste Not",
        text: p("Once per strategy layer turn, after a successful mission, you recover 5 Logistics and 5 Intel."),
        changes: { [`${S}.mission.logistics`]: 5, [`${S}.mission.intel`]: 5 } }
    ],
    // Awakened (Johnald, 2026-10-20): nothing combat focused.
    "Awakened": [
      { from: ["Weird World"], name: "Weird World",
        text: p("The world stopped making sense for you long before it did for everyone else. Once per mission, the GM tells you about one paraphysical anomaly at your location, such as a live object, a storm's residue or a ritual site, and roughly where it is.") },
      { from: ["Power Overwhelming"], name: "Power Overwhelming",
        text: p("Your gift comes easier than it should. Once per session, an improvised paraphysical effect costs no Energy.",
          "Improvisation keeps its rules: outside combat, within a discipline you hold, and never a cheaper copy of a power.") },
      { from: ["Man of Tomorrow"], name: "Man of Tomorrow",
        text: p("Others like you are surfacing everywhere, and word of them reaches you first. Once per strategy layer turn, after a successful mission, you bring back 5 extra Intel on paraphysical activity (sightings, defectors, GENESIS pickups), and Reputation in that region rises by 1 extra point."),
        changes: { [`${S}.mission.intel`]: 5, [`${S}.mission.reputation.megacity`]: 1, [`${S}.mission.reputation.slums`]: 1,
          [`${S}.mission.reputation.rural`]: 1, [`${S}.mission.reputation.wildland`]: 1 } }
    ],
    "Xenospecialist": [
      { from: ["Field Analysis"], name: "Field Analysis",
        text: p("Once per mission, examine an alien body, device or structure. The GM tells you what it is for and how to salvage materials from it (genetic material, alloys and the like). You may also learn how to disable it, or how it can be used outside of combat.") },
      { from: ["Specimen Collector"], name: "Specimen Collector",
        text: p("From a mission against alien or mutant forces, you can bring back a free sample, which counts as Specialized Salvage for a Biology or Xenobiology project. A sample can also count as 1 Genetic Material for the appropriate genetic modifications.") },
      { from: ["Weird Science"], name: "Weird Science",
        text: p("When you are assigned to a Research project, you count Xenotechnology, Paraphysics and Xenobiology at +10 per skill rank instead of +5."),
        changes: { [`${S}.perRank.research.xenotech`]: 5, [`${S}.perRank.research.paraphysics`]: 5, [`${S}.perRank.research.xenobiology`]: 5 } }
    ]
  };
  const RENAMES = { "Innovater": "Innovator" };
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const specFor = (background, abilityName) =>
    (PERKS[background] ?? []).find(s => [...s.from, s.name].some(n => fold(n) === fold(abilityName))) ?? null;

  /** Rewrite one ability: name, text, and the effect carrying its numbers (made afresh). */
  const fix = async (ability, spec) => {
    await ability.update({ name: spec.name, "system.description": spec.text });
    const old = ability.effects.filter(e => e.getFlag("irop", "perkNumbers")).map(e => e.id);
    if ( old.length ) await ability.deleteEmbeddedDocuments("ActiveEffect", old);
    const changes = Object.entries(spec.changes ?? {}).map(([key, value]) => ({ key, type: "add", value: String(value) }));
    if ( changes.length ) {
      await ability.createEmbeddedDocuments("ActiveEffect", [{
        name: spec.name, img: ability.img, transfer: true,
        system: { changes }, flags: { irop: { perkNumbers: true } }
      }]);
    }
  };

  const done = [];
  const missing = [];

  // The world's backgrounds and the abilities their perks point at.
  for ( const bg of game.items.filter(i => i.type === "background") ) {
    if ( RENAMES[bg.name] ) {
      done.push(`Background ${bg.name} renamed ${RENAMES[bg.name]}`);
      await bg.update({ name: RENAMES[bg.name] });
    }
    if ( !PERKS[bg.name] ) continue;
    const perks = foundry.utils.deepClone(bg.system.perks ?? []);
    for ( const perk of perks ) {
      const ability = perk.uuid ? await fromUuid(perk.uuid).catch(() => null) : null;
      const spec = ability ? specFor(bg.name, ability.name) : null;
      if ( !ability || !spec ) { missing.push(`${bg.name}: ${ability?.name ?? perk.name ?? "a perk with no ability"}`); continue; }
      await fix(ability, spec);
      perk.name = spec.name;
      perk.img = ability.img;
      done.push(`${bg.name}: ${spec.name}`);
    }
    await bg.update({ "system.perks": perks });
  }

  // Operatives: a renamed background, and the perks they have already taken.
  let copies = 0;
  for ( const actor of game.actors ) {
    for ( const item of actor.items ) {
      if ( (item.type === "background") && RENAMES[item.name] ) await item.update({ name: RENAMES[item.name] });
      const taken = item.getFlag("irop", "backgroundPerk");
      if ( (item.type !== "ability") || !taken ) continue;
      const background = RENAMES[taken.background] ?? taken.background;
      if ( background !== taken.background ) await item.setFlag("irop", "backgroundPerk", { ...taken, background });
      const spec = specFor(background, item.name);
      if ( spec ) { await fix(item, spec); copies++; }
    }
  }

  const text = [
    `${done.length} perks and renames done, and ${copies} taken copies on operatives brought in line.`,
    missing.length ? `Not matched, left as they were: ${missing.join("; ")}.` : "Every perk matched."
  ];
  console.log("irop | background perks fixed", { done, missing, copies });
  ui.notifications.info(text.join(" "));
} catch ( err ) {
  console.error("Background perks macro failed", err);
  ui.notifications.error(`The background perks macro failed: ${err.message}. The console (F12) has the details.`);
}

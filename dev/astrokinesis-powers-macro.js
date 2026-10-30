/**
 * The Astrokinesis powers (Johnald, 2026-10-29), from "Wave 1 Paraphysics Powers (Draft)" rev 5585 by
 * way of ASTROKINESIS_BUILD_HANDOFF.md. Run once as the GM, as a script macro; safe to run again
 * after editing the numbers below. Needs system 0.1.22 or later: reload (F5) after updating first.
 *
 *   - makes the 14 Astrokinesis powers as ability items in the Items sidebar's Astrokinesis folder,
 *     each with Ranks 1 to 4, its three Rank 3 options and its two Rank 5 evolutions. A power that
 *     exists already (matched on name and discipline) is updated, not made twice: Gravbolt is
 *     updated in place. Its picture is kept if it has one;
 *   - updates the copies characters hold the same way, keeping each one's rank, its Rank 3 choice
 *     and its evolution where the power still offers them;
 *   - Black Hole and Supernova are a pick one group: a character holds one of them.
 *
 * Damage uses @casting.mod, the caster's species casting modifier (Charisma, Intelligence for a
 * Reticulon). Areas are radii in tiles unless a power says line; Pulsar Lance is a line 2 wide.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const fields = CONFIG.Item.dataModels?.ability?.schema?.fields?.paraphysics?.fields;
  if ( !fields?.evolutions?.element?.fields?.bend || !fields?.options?.element?.fields?.steadfast || !fields?.modes ) {
    return ui.notifications.error("This world is not running system 0.1.22 or later yet. Update the system, reload (F5), then run this again.", { permanent: true });
  }
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
  const p = (...lines) => lines.map(l => `<p>${l}</p>`).join("");
  const opt = (id, label, archetype, text, changes = {}) => ({ id, label, archetype, text, ...changes });
  const evo = (name, text, changes = {}) => ({ id: fold(name), name, text, ...changes });
  const PAY = { optionalEnergy: true };
  // Partial Anchored (Johnald, 2026-10-29): the Concentration can only be dropped by the caster at will.
  const STEADFAST = { steadfast: true };

  /* ---------------- The powers ---------------- */
  const POWERS = [
    // Tier 1
    { name: "Gravbolt", img: "icons/svg/target.svg", tier: 1, attack: true, tracks: ["accuracy", "damage"],
      flavor: "Harnessing the forces of gravity and weaponizing it a little bit gets you the gravbolt. It's scarily effective with crushing cosmic forces despite being one of the first things that an Astrokinetic learns.",
      text: "Single target. Skips Armor HP.",
      energy: 3, range: 10, damage: "2d4 + @casting.mod",
      r2: { text: "Damage +1.", damage: "1" },
      r4: { text: "Damage +1d4.", damage: "1d4" },
      options: [
        opt("chain", "Chain", "chain", "A second target within 4 tiles for half damage."),
        opt("piercing", "Piercing", "piercing", "Ignores 2 Cosmic DR."),
        opt("overload", "Overload", "overload", "+2 Energy for +1d4.", { energy: 2, damage: "1d4", ...PAY })
      ],
      evolutions: [
        evo("Crushing Bolt", "On a hit the target is Suppressed until the start of your next turn. Energy +1.", { energy: 1, ...PAY }),
        evo("Graviton Burst", "On a hit, enemies directly adjacent to the primary target take half damage.")
      ] },
    { name: "Gravitic Rip", img: "icons/svg/falling.svg", tier: 1, save: "agi", tracks: ["potency", "range"],
      flavor: "Utilizing and manipulating the gravity close to a foe, you effectively make them fall out of cover towards you should their agility fail them.",
      text: "On a failed save the target is dragged 2 tiles straight toward you, losing any cover it leaves.",
      energy: 2, range: 6,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Range +2.", range: 2 },
      options: [
        opt("adaptive", "Adaptive", "adaptive", "You may for the added cost of +1 energy change the attribute required to save from this power.", { energy: 1, adaptive: true, ...PAY }),
        opt("overload", "Overload", "overload", "Energy +1. The target's save D.M. worsens by +5 (Potency +5).", { energy: 1, potency: 5, ...PAY }),
        opt("reflexive", "Reflexive", "reflexive", "Usable as a reaction when an enemy moves into cover.")
      ],
      evolutions: [
        evo("Tidal Pull", "Up to 2 targets within 2 tiles of each other; each saves separately."),
        evo("Gravitic Currents", "You may drag the target toward an ally within range instead of toward you.")
      ] },
    { name: "Penumbra", img: "icons/svg/aura.svg", tier: 1, tracks: ["duration"],
      flavor: "Harnessing the dark matter that makes up the vacuum of space to create a personal twilight around you. It makes it harder to hit you and possibly your allies. It dispels when the protected creature moves.",
      text: "Range Self. You count as half cover against ranged attacks wherever you stand. Does not add to real cover; take the better. Dispels when moved.",
      energy: 2, range: 0, duration: 1,
      r2: { text: "Duration +1.", duration: 1 },
      r4: { text: "Duration +1.", duration: 1 },
      options: [
        opt("reflexive", "Reflexive", "reflexive", "Trigger: you are targeted by a ranged attack."),
        opt("overload", "Overload", "overload", "+1 Energy: an additional +5 to your defense.", { energy: 1, defense: 5, ...PAY }),
        opt("wide", "Wide", "wide", "Covers allies within 1 tile of the target as well. Energy 3 (+1).", { energy: 1, ...PAY })
      ],
      evolutions: [
        evo("Protective Dark", "You may instead cast this directly onto an ally."),
        evo("Umbral Counter", "When a ranged attack against the target misses, the shooter loses its cover against your squad until the start of its next turn.")
      ] },

    // Tier 2
    { name: "Umbral Veil", img: "icons/svg/shield.svg", tier: 2, concentration: true, tracks: ["duration", "range"],
      flavor: "Call upon dark matter to once more protect yourself and your allies. This resonance is tricky to master and utilize, but when done correctly it is indispensable to the caster and their allies.",
      text: "Area radius 1, centered on you and moving with you. Allies inside count as half cover against ranged attacks.",
      energy: 4, range: 0, area: 1, duration: 3,
      r2: { text: "Radius +1.", area: 1 },
      r4: { text: "Duration +1.", duration: 1 },
      options: [
        opt("anchored", "Anchored", "anchored", "Concentration can only be dropped by the caster at will.", STEADFAST),
        opt("wide", "Wide", "wide", "Radius +1. Energy cost +1.", { area: 1, energy: 1, ...PAY }),
        opt("overcharge", "Overcharge", "", "Grants allies +2 DR against all damage types while inside. Energy cost +3.", { energy: 3, ...PAY })
      ],
      evolutions: [
        evo("Starless Mantle", "Allies inside count as full cover against ranged attacks from more than 6 tiles away."),
        evo("Quiet March", "Allies inside do not trigger overwatch from beyond 6 tiles.")
      ] },
    { name: "Starfall", img: "icons/svg/sun.svg", tier: 2, attack: true, tracks: ["damage", "range"],
      flavor: "For ages mankind has looked up and admired shooting stars; now they have the ability to call upon some of that awe and power themselves.",
      text: "One attack roll per target in the area. Cover bonuses do not apply; armor Defense still does.",
      energy: 5, range: 10, area: 1, damage: "3d4 + @casting.mod",
      r2: { text: "Damage +1.", damage: "1" },
      r4: { text: "Damage +1d4.", damage: "1d4" },
      options: [
        opt("wide", "Wide", "wide", "Radius 2. Energy 6.", { area: 1, energy: 1, ...PAY }),
        opt("overload", "Overload", "overload", "+2 Energy for +2d4.", { energy: 2, damage: "2d4", ...PAY }),
        opt("efficient", "Efficient", "efficient", "Energy 4.", { energy: -1 })
      ],
      evolutions: [
        evo("Shower of Stars", "Two separate radius 1 strikes in one cast. Energy +2.", { energy: 2, ...PAY }),
        evo("Deep Impact", "Targets hit are Vulnerable (3).")
      ] },
    { name: "Coronal Lensing", img: "icons/svg/light.svg", tier: 2, tracks: ["duration", "range"],
      flavor: "A handy trick using gravity to bend cosmic rays around their cover. People think that the light helps them ignore some of that target's cover, while the cosmic rays help you know that the gravity is the truth here.",
      text: "Duration 1 (until the start of your next turn). Target one piece of cover. Anyone using it counts one step lower against your squad (full to half, half to none).",
      energy: 5, range: 8, duration: 1,
      r2: { text: "Range +2, to a total of 10.", range: 2 },
      r4: { text: "Range +4, to a total of 12.", range: 4 },
      options: [
        opt("lingering", "Lingering", "lingering", "Duration 2.", { duration: 1 }),
        opt("wide", "Wide", "wide", "Every piece of cover within 2 tiles of the target. Energy 7.", { area: 2, energy: 2, ...PAY }),
        opt("chain", "Chain", "chain", "A second piece of cover within 6 tiles of the first.")
      ],
      evolutions: [
        evo("Glass Bastion", "Dodges made from the lensed cover are rolled as out of cover (+30)."),
        evo("Burning Glass", "Anyone ending its turn in the lensed cover takes 1d6 Cosmic.")
      ] },

    // Tier 3
    { name: "Sanctuary of the Aurora", img: "icons/svg/regen.svg", tier: 3, concentration: true, tracks: ["duration", "range"], modes: "Ward, Calm",
      flavor: "When cosmic rays hit the atmosphere just right, they produce beautiful aurora to admire. Yours comforts and protects those under your vigil.",
      text: "Area radius 2 on you. Mode chosen at cast, never both:</p><ul><li><strong>Ward:</strong> each ally starting a turn inside gains Barrier 5 (never stacks).</li><li><strong>Calm:</strong> each ally starting a turn inside sheds one mental debuff.</li></ul><p>",
      energy: 6, range: 0, area: 2, duration: 2, barrier: 5,
      r2: { text: "Duration +1.", duration: 1 },
      r4: { text: "Radius +1.", area: 1 },
      options: [
        opt("anchored", "Anchored", "anchored", "Concentration can only be dropped by the caster at will. Energy +1.", { energy: 1, ...STEADFAST, ...PAY }),
        opt("wide", "Wide", "wide", "Radius +1. Energy +1.", { area: 1, energy: 1, ...PAY }),
        opt("efficient", "Efficient", "efficient", "Energy 5.", { energy: -1 })
      ],
      evolutions: [
        evo("Active Aurora", "Switch mode once per cast as a quick action. Still never both at once."),
        evo("Vigil of the Northern Lights", "When it ends, every ally still inside gains Barrier 5 and sheds a mental debuff.")
      ] },
    { name: "Event Horizon", img: "icons/svg/daze.svg", tier: 3, save: "str", tracks: ["potency", "range"],
      flavor: "Black holes are inescapable once you've passed the Event Horizon. Utilize a small portion of that cosmic power against your foes and watch them burn with cosmic energy as they are pulled towards certain doom.",
      text: "On a failed save, each creature is pulled 2 tiles toward the center, out of cover if it lands in the open, and takes 1d6 Cosmic damage per tile moved. On a success, it is pulled only 1 tile, for 1d6 damage.",
      energy: 6, range: 8, area: 2, damage: "2d6",
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Pull distance +1 (and so +1d6 on a failed save).", damage: "1d6" },
      options: [
        opt("wide", "Wide", "wide", "Radius 3. Energy 8.", { area: 1, energy: 2, ...PAY }),
        opt("efficient", "Efficient", "efficient", "Energy 5.", { energy: -1 }),
        opt("adaptive", "Adaptive", "adaptive", "You may for the added cost of +1 energy change the attribute required to save from this power.", { energy: 1, adaptive: true, ...PAY })
      ],
      evolutions: [
        evo("Accretion", "Creatures that fail end Suppressed until the start of your next turn."),
        evo("Hawking Radiation", "Creatures that fail now gain Poisoned (2).")
      ] },
    { name: "Pulsar Lance", img: "icons/svg/lightning.svg", tier: 3, attack: true, tracks: ["accuracy", "damage"], shape: "line", width: 2,
      flavor: "A line drawn through the world. Anything standing in its way is on the wrong side of physics.",
      text: "A line 2 wide and 6 long from you. Attack each target in the line; cover bonuses are ignored.",
      energy: 6, range: 6, area: 6, damage: "4d4 + @casting.mod",
      r2: { text: "Damage +1.", damage: "1" },
      r4: { text: "Damage +1d4.", damage: "1d4" },
      options: [
        opt("wide", "Wide", "wide", "Line 2x8. Energy +2.", { area: 2, range: 2, energy: 2, ...PAY }),
        opt("overload", "Overload", "overload", "+2 Energy for +2d4.", { energy: 2, damage: "2d4", ...PAY }),
        opt("efficient", "Efficient", "efficient", "Energy 4.", { energy: -2 })
      ],
      evolutions: [
        evo("Rail of Light", "The line becomes 2x8 tiles, or 2x10 if using Wide; the first enemy hit is Vulnerable (3).", { area: 2, range: 2 }),
        evo("Bent Light", "The line may turn once, up to a right angle.", { bend: true })
      ] },

    // Tier 4
    { name: "Collapse", img: "icons/svg/explosion.svg", tier: 4, save: "tgh", tracks: ["damage", "potency"],
      flavor: "Creating a localized collapse of gravity at a point of your choosing, you will watch as your targets writhe and try to fight against cosmic forces at your command.",
      text: "4d6 Cosmic damage, half on a save. A failed save also Pins until the end of the target's next turn.",
      energy: 8, range: 8, area: 2, damage: "4d6",
      r2: { text: "Damage +2.", damage: "2" },
      r4: { text: "Damage +1d6.", damage: "1d6" },
      options: [
        opt("wide", "Wide", "wide", "Radius 3. Energy 9.", { area: 1, energy: 1, ...PAY }),
        opt("overload", "Overload", "overload", "+2 Energy for +2d6.", { energy: 2, damage: "2d6", ...PAY }),
        opt("lingering", "Lingering", "lingering", "Pinned lasts one turn longer.")
      ],
      evolutions: [
        evo("Gravitic Ruin", "Pinned targets cannot take any reactions."),
        evo("Downforce", "Elevated targets that fail are pulled to ground level and lose high ground, taking appropriate fall damage where applicable.")
      ] },
    { name: "Aura of Weightlessness", img: "icons/svg/wing.svg", tier: 4, concentration: true, tracks: ["duration", "range"],
      flavor: "Recruits always laugh the first time they feel the weightlessness. Then they quickly learn to take advantage of it.",
      text: "Area radius 2 on you. Allies that move through your aura ignore difficult terrain and gain +2 Run. Allies in the aura can also freely climb up to 2 storeys' worth of height.",
      energy: 6, range: 0, area: 2, duration: 3,
      r2: { text: "Radius +1.", area: 1 },
      r4: { text: "Duration +1.", duration: 1 },
      options: [
        opt("anchored", "Anchored", "anchored", "No Concentration, Duration 2.", { anchored: true, duration: -1 }),
        opt("wide", "Wide", "wide", "Radius +1. Energy 7.", { area: 1, energy: 1, ...PAY }),
        opt("lingering", "Lingering", "lingering", "Duration +1.", { duration: 1 })
      ],
      evolutions: [
        evo("Momentum", "An ally who moves 3 or more tiles inside gets -10 D.M. on their next ranged attack this turn."),
        evo("Zero Point", "Enemies inside move at half speed.")
      ] },
    { name: "Orbit", img: "icons/svg/ice-aura.svg", tier: 4, concentration: true, tracks: ["duration", "range"],
      flavor: "Inspired by the great rings of Saturn, you utilize what you can on the battlefield or rip it out of the ground (bricks, rocks, the shrapnel of a destroyed drone) to create an orbiting shield around yourself or an ally.",
      text: "Self or one ally. They count as half cover from every direction while it lasts, even moving.",
      energy: 7, range: 6, duration: 3, barrier: 10,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Duration +1, Barrier +2.", duration: 1, barrier: 2 },
      options: [
        opt("anchored", "Anchored", "anchored", "No Concentration, Duration 2.", { anchored: true, duration: -1 }),
        opt("lingering", "Lingering", "lingering", "Duration +1.", { duration: 1 }),
        opt("chain", "Chain", "chain", "A second ally within 3 tiles of the first, Barrier 5.")
      ],
      evolutions: [
        evo("Satellite Ring", "Counts as full cover against attacks from beyond 6 tiles."),
        evo("Shrapnel Halo", "Enemies ending their turn adjacent to the ally take 1d6 Cosmic.")
      ] },

    // Tier 5: pick one of the two
    { name: "Black Hole", img: "icons/svg/skull.svg", tier: 5, save: "str", concentration: true, tracks: ["damage", "duration"], exclusive: "astrokinesis-tier5",
      flavor: "Black holes are the known apex of celestial predators, and you have found the ability to replicate one on a small scale, creating a tiny black hole to rip and tear at anyone unlucky enough to be in its range.",
      text: "At the start of each of your turns, creatures inside take 3d6 Cosmic (half on a save) and are pulled 1 tile toward the center.",
      energy: 9, range: 10, area: 3, duration: 3, damage: "3d6",
      r2: { text: "Damage +2.", damage: "2" },
      r4: { text: "Damage +1d6.", damage: "1d6" },
      options: [
        opt("anchored", "Anchored", "anchored", "No Concentration, Duration 2.", { anchored: true, duration: -1 }),
        opt("wide", "Wide", "wide", "Radius 4. Energy 10.", { area: 1, energy: 1, ...PAY }),
        opt("adaptive", "Adaptive", "adaptive", "You may for the added cost of +1 energy change the attribute required to save from this power.", { energy: 1, adaptive: true, ...PAY })
      ],
      evolutions: [
        evo("Collapsar", "When it ends it detonates for 5d6 Cosmic in radius 3, Toughness save for half. This is a separate save: Adaptive does not change it."),
        evo("Point of No Return", "A creature that fails cannot leave the area on its next turn. They also take Shredding 2.", { shred: 2 })
      ] },
    { name: "Supernova", img: "icons/svg/fire.svg", tier: 5, save: "tgh", tracks: ["damage", "range"], exclusive: "astrokinesis-tier5",
      extraSave: { save: "tgh", label: "Disorientated (2), anyone who saw it unprotected" },
      flavor: "An extremely powerful ability, it causes a brilliant, supernova-like explosion at a point of your choice. Those that die in its radius are left as nothing but cosmic dust. Use with care and caution.",
      text: "Creatures inside its radius must make a Toughness save. On a failure they take 10d8 Cosmic damage, or half on a success.</p><p>Any creature that sees the supernova unprotected must also make the save or become Disorientated (2), whether friendly or hostile. The caster is exempt from the Disorientated save.",
      energy: 10, range: 8, area: 4, damage: "10d8",
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Damage +2d8.", damage: "2d8" },
      options: [
        opt("adaptive", "Adaptive", "adaptive", "You may for the added cost of +1 energy change the attribute required to save from this power.", { energy: 1, adaptive: true, ...PAY }),
        opt("wide", "Wide", "wide", "Radius 6. Energy 12.", { area: 2, energy: 2, ...PAY }),
        opt("overload", "Overload", "overload", "+2 Energy for +2d8.", { energy: 2, damage: "2d8", ...PAY })
      ],
      evolutions: [
        evo("Core-Collapse", "Any surviving creatures that failed their saving throw are now Panicked and Pinned."),
        evo("Stellar Cradle", "The remnants of deceased creatures can now sustain life to a point. Until the start of your next turn, any being that runs through the field left behind heals 1 HP per tile moved, to a maximum of your casting modifier.")
      ] }
  ];

  /* ---------------- Building the item data ---------------- */
  const NUMBERS = ["accuracy", "potency", "energy", "range", "duration", "area", "barrier", "defense", "shred"];
  const changes = src => ({ ...Object.fromEntries(NUMBERS.map(k => [k, Number(src[k]) || 0])), damage: String(src.damage ?? "") });
  // A Rank 2 or 4 step: Accuracy and Potency left null take the track default.
  const step = src => ({ ...changes(src), text: src.text ?? "", accuracy: src.accuracy ?? null, potency: src.potency ?? null });
  const systemOf = w => ({
    description: p(`<em>${w.flavor}</em>`) + p(w.text),
    kind: "active", source: "generalist", actionType: "single",
    energyCost: w.energy, range: w.range ?? 0, area: w.area ?? 0,
    "paraphysics.discipline": "astrokinesis",
    "paraphysics.attack": !!w.attack,
    "paraphysics.accuracy": 0,
    "paraphysics.damage": { formula: w.damage ?? "", type: "cosmic" },
    "paraphysics.tier": w.tier,
    "paraphysics.trackA": w.tracks[0] ?? "",
    "paraphysics.trackB": w.tracks[1] ?? "",
    "paraphysics.duration": w.duration ?? 0,
    "paraphysics.barrier": w.barrier ?? 0,
    "paraphysics.rank2": step(w.r2),
    "paraphysics.rank4": step(w.r4),
    "paraphysics.options": w.options.map(o => ({ id: o.id, archetype: o.archetype ?? "", label: o.label, text: o.text, ...changes(o),
      anchored: !!o.anchored, steadfast: !!o.steadfast, optionalEnergy: !!o.optionalEnergy, adaptive: !!o.adaptive })),
    "paraphysics.evolutions": w.evolutions.map(e => ({ id: e.id, name: e.name, text: p(e.text), ...changes(e),
      damageType: "", concentration: "", optionalEnergy: !!e.optionalEnergy, rename: false, bend: !!e.bend })),
    "paraphysics.concentration": !!w.concentration,
    "paraphysics.learnable": true,
    "paraphysics.save": w.save ?? "",
    "paraphysics.exclusive": w.exclusive ?? "",
    "paraphysics.shape": w.shape ?? "radius",
    "paraphysics.width": w.width ?? 0,
    "paraphysics.modes": w.modes ?? "",
    "paraphysics.extraSave": w.extraSave ?? { save: "", label: "" }
  });
  // As an update: every field under system, by path.
  const asUpdate = w => Object.fromEntries(Object.entries(systemOf(w)).map(([k, v]) => [`system.${k}`, v]));
  const isPower = (i, w) => (i.type === "ability") && (fold(i.name) === fold(w.name))
    && (!i.system.paraphysics?.discipline || (i.system.paraphysics.discipline === "astrokinesis"));
  const keepImg = (i, w) => (!i.img || /mystery-man|icons\/svg\/item-bag/.test(i.img)) ? { img: w.img } : {};

  const done = [];
  const folder = game.folders.find(f => (f.type === "Item") && (f.name === "Astrokinesis"))
    ?? await Folder.implementation.create({ name: "Astrokinesis", type: "Item" });

  for ( const w of POWERS ) {
    const update = asUpdate(w);
    // The Items sidebar.
    const found = game.items.filter(i => isPower(i, w));
    if ( !found.length ) {
      await Item.implementation.create({ name: w.name, type: "ability", img: w.img, folder: folder.id,
        system: foundry.utils.expandObject(Object.fromEntries(Object.entries(systemOf(w)).map(([k, v]) => [k, v]))) });
      done.push(`${w.name}: made in the Astrokinesis folder`);
    }
    for ( const item of found ) {
      await item.update({ ...update, ...keepImg(item, w) });
      done.push(`${w.name}: updated in the Items sidebar`);
    }
    // Characters' copies keep their rank, and their picks where the power still offers them.
    for ( const actor of game.actors ) {
      for ( const item of actor.items.filter(i => isPower(i, w)) ) {
        const ps = item.system.paraphysics;
        const keep = {
          "system.paraphysics.rank": ps.rank,
          "system.paraphysics.choice": w.options.some(o => o.id === ps.choice) ? ps.choice : "",
          "system.paraphysics.evolved": w.evolutions.some(e => e.id === ps.evolved) ? ps.evolved : ""
        };
        await item.update({ ...update, ...keep, ...keepImg(item, w) });
        const lost = [ps.choice && !keep["system.paraphysics.choice"] ? "its Rank 3 choice" : "", ps.evolved && !keep["system.paraphysics.evolved"] ? "its evolution" : ""].filter(Boolean);
        done.push(`${actor.name}: ${w.name} updated, rank ${ps.rank} kept${lost.length ? `; ${lost.join(" and ")} no longer offered, pick again` : ""}`);
      }
    }
  }

  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Astrokinesis" },
    content: `<div class="irop-card"><header class="card-head"><h3>Astrokinesis powers</h3><span class="card-sub">${POWERS.length} powers</span></header>
      <ul>${done.map(d => `<li>${esc(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info("Astrokinesis powers set. The list is in chat.");
})();

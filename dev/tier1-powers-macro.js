/**
 * Every Tier 1 power of Wave 1 (Johnald, 2026-11-04), from "Wave 1 Paraphysics Powers (Draft)" rev 6631:
 * Astrokinesis, Telekinesis, Telepathy, Pyrokinesis, Vitakinesis and Optics, three each. Run once as the
 * GM, as a script macro; safe to run again after editing the numbers below. Needs system 0.1.25 or later.
 *
 *   - makes each power as an ability item in the Items sidebar's folder for its discipline, with
 *     Ranks 1 to 4, its three Rank 3 options and its two Rank 5 evolutions. A power there already
 *     (matched on name and discipline) is updated, not made twice, and its picture is kept;
 *   - updates the copies characters hold the same way, keeping each one's rank, its Rank 3 choice
 *     and its evolution where the power still offers them.
 *
 * This carries the rulings of 2026-11-04: base Energy in Tiers 1 to 4 raised by 1, and the Tier 1
 * damage and healing ladder (half the casting mod at Rank 1, rounded down; +1d4 at Rank 2; the full
 * casting mod at Rank 4, Mend excepted, which takes another +1d4). The casting mod is Charisma,
 * Intelligence for a Reticulon. Gravbolt, Gravitic Rip, Penumbra and the Vitakinesis and Optics
 * powers are already in the world: this updates them to the new numbers.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const fields = CONFIG.Item.dataModels?.ability?.schema?.fields?.paraphysics?.fields;
  if ( !fields?.armorHp || !fields?.heal || !fields?.modes ) {
    return ui.notifications.error("This world is not running system 0.1.25 or later yet. Update the system, reload (F5), then run this again.", { permanent: true });
  }
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
  const p = (...lines) => lines.map(l => `<p>${l}</p>`).join("");
  const opt = (id, label, archetype, text, changes = {}) => ({ id, label, archetype, text, ...changes });
  const evo = (name, text, changes = {}) => ({ id: fold(name), name, text, ...changes });
  const PAY = { optionalEnergy: true };
  const ADAPTIVE = "You may for the added cost of +1 Energy change the attribute required to save from this power.";

  // The Tier 1 ladder (2026-11-04). Rank 4's ceil adds back the half the floor left out, so the total is the full mod.
  const HALF = "floor(@casting.mod / 2)";
  const TO_FULL = "ceil(@casting.mod / 2)";
  const LADDER_R2 = { text: "Damage +1d4.", damage: "1d4" };
  const LADDER_R4 = { text: "Damage adds your full casting mod instead of half.", damage: TO_FULL };

  /* ---------------- The powers ---------------- */
  const POWERS = [
    // Astrokinesis
    { name: "Gravbolt", discipline: "astrokinesis", img: "icons/svg/target.svg", attack: true, type: "cosmic", tracks: ["accuracy", "damage"],
      flavor: "Harnessing the forces of gravity and weaponizing it a little bit gets you the gravbolt. It's scarily effective with crushing cosmic forces despite being one of the first things that an Astrokinetic learns.",
      text: "2d4 + half casting mod Cosmic. Single target. Skips Armor HP.",
      energy: 4, range: 10, damage: `2d4 + ${HALF}`,
      r2: LADDER_R2, r4: LADDER_R4,
      options: [
        opt("chain", "Chain", "chain", "A second target within 4 tiles for half damage."),
        opt("piercing", "Piercing", "piercing", "Ignores 2 Cosmic DR."),
        opt("overload", "Overload", "overload", "+2 Energy for +1d4.", { energy: 2, damage: "1d4", ...PAY })
      ],
      evolutions: [
        evo("Crushing Bolt", "On a hit the target is Suppressed until the start of your next turn. Energy +1.", { energy: 1, ...PAY }),
        evo("Graviton Burst", "On a hit, enemies directly adjacent to the primary target take half damage.")
      ] },
    { name: "Gravitic Rip", discipline: "astrokinesis", img: "icons/svg/falling.svg", save: "agi", tracks: ["potency", "range"],
      flavor: "Utilizing and manipulating the gravity close to a foe, you effectively make them fall out of cover towards you should their agility fail them.",
      text: "On a failed save the target is dragged 2 tiles straight toward you, losing any cover it leaves. No damage.",
      energy: 3, range: 6,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Range +2.", range: 2 },
      options: [
        opt("adaptive", "Adaptive", "adaptive", ADAPTIVE, { energy: 1, adaptive: true, ...PAY }),
        opt("overload", "Overload", "overload", "Energy cost +1. The target's save D.M. worsens by +5.", { energy: 1, potency: 5, ...PAY }),
        opt("reflexive", "Reflexive", "reflexive", "You may use this ability as a reaction if an enemy moves into cover.")
      ],
      evolutions: [
        evo("Tidal Pull", "Up to 2 targets within 2 tiles of each other; each saves separately."),
        evo("Gravitic Currents", "You may drag the target toward an ally within range instead of toward you.")
      ] },
    { name: "Penumbra", discipline: "astrokinesis", img: "icons/svg/aura.svg", tracks: ["duration", ""],
      flavor: "Harnessing the dark matter that makes up the vacuum of space to create a personal twilight around you. It makes it harder to hit you and possibly your allies. It dispels when the protected creature moves.",
      text: "Self, Duration 1. You count as half cover against ranged attacks wherever you stand. Does not add to real cover; take the better. Dispels when moved.",
      energy: 3, range: 0, duration: 1,
      r2: { text: "Duration +1.", duration: 1 },
      r4: { text: "Duration +1.", duration: 1 },
      options: [
        opt("reflexive", "Reflexive", "reflexive", "Trigger: you are targeted by a ranged attack."),
        opt("overload", "Overload", "overload", "+1 Energy: an additional +5 to your defense.", { energy: 1, defense: 5, ...PAY }),
        opt("wide", "Wide", "wide", "Covers allies within 1 tile of the target as well. Energy 4.", { energy: 1, ...PAY })
      ],
      evolutions: [
        evo("Protective Dark", "You may instead cast this directly onto an ally."),
        evo("Umbral Counter", "When a ranged attack against the target misses, the shooter loses its cover against your squad until the start of its next turn.")
      ] },

    // Telekinesis
    { name: "Kinetic Dart", discipline: "telekinesis", img: "icons/svg/dice-target.svg", attack: true, type: "ballistic", tracks: ["accuracy", "damage"],
      flavor: "Any loose bolt, shard of rubble or spent casing on the battlefield is ammunition to you. Fling it at your target with your gifts and bend its path right around their cover. They won't see it coming until it's too late!",
      text: "2d4 + half casting mod Ballistic. The dart curves in flight and ignores half cover. Meets DR and Armor HP like a bullet.",
      energy: 3, range: 8, damage: `2d4 + ${HALF}`,
      r2: LADDER_R2, r4: LADDER_R4,
      options: [
        opt("piercing", "Piercing", "piercing", "Ignores 2 Ballistic DR."),
        opt("chain", "Chain", "chain", "A second target within 3 tiles of the first, half damage."),
        opt("overload", "Overload", "overload", "+2 Energy for +1d4.", { energy: 2, damage: "1d4", ...PAY })
      ],
      evolutions: [
        evo("Flechette Swarm", "Three darts, 1d4 + 1 each, each with its own roll; split them across targets as you like."),
        evo("Rail Spike", "One heavy bolt, +1d6, and the target is pushed 1 tile.", { damage: "1d6" })
      ] },
    { name: "Throw", discipline: "telekinesis", img: "icons/svg/wingfoot.svg", save: "str", type: "physical", tracks: ["potency", "range"],
      flavor: "Reach out, take hold of an enemy, and throw them. Gravity only drags, but telekinesis gives you the finer control to send them flying away from you or yank them straight toward you, out of cover and into the open. Whatever they slam into on the way hurts.",
      text: "On a failed save you move the target 3 tiles in a straight line, either away from you or toward you. If it strikes a wall, cover or a creature it takes 1d4 Physical.",
      energy: 3, range: 6, damage: "1d4",
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Distance +1." },
      options: [
        opt("chain", "Chain", "chain", "A second target within 3 tiles of the first also saves."),
        opt("reflexive", "Reflexive", "reflexive", "Trigger: an enemy moves adjacent to you or to an ally in range."),
        opt("efficient", "Efficient", "efficient", "Energy 2.", { energy: -1 })
      ],
      evolutions: [
        evo("Bowling", "A target thrown into another creature knocks it 1 tile too; both take the impact damage."),
        evo("Launch", "Distance doubles; a target that strikes a wall, cover or a creature lands Pinned.")
      ] },
    { name: "Kinetic Brace", discipline: "telekinesis", img: "icons/svg/shield.svg", tracks: ["duration", "range"],
      flavor: "You can't stop every bullet, but with your gifts you can sure slow them down. Wrap yourself or an ally in a field of kinetic force that takes the bite out of bullets and blows before they ever land.",
      text: "You or one ally, until the start of your next turn. DR +3 against Ballistic and Physical damage.",
      energy: 3, range: 6, duration: 1,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "DR +1 (DR +4)." },
      options: [
        opt("reflexive", "Reflexive", "reflexive", "Trigger: the ally is targeted by an attack."),
        opt("wide", "Wide", "wide", "Every ally within 1 tile of the target. Energy 4.", { energy: 1, ...PAY }),
        opt("lingering", "Lingering", "lingering", "Until the start of your turn after next.", { duration: 1 })
      ],
      evolutions: [
        evo("Bullet Catcher", "The first Ballistic hit against them deals 0 damage; the round drops at their feet."),
        evo("Kinetic Shell", "They are also immune to forced movement while it lasts.")
      ] },

    // Telepathy
    { name: "Psychic Spike", discipline: "telepathy", img: "icons/svg/daze.svg", save: "int", type: "psychic", tracks: ["damage", "potency"],
      flavor: "Your mind sends a single sharp pulse through the Eidolon-9 around your target and straight into their head. It is the first thing most telepaths learn, and the target feels every bit of it unless their wits hold firm.",
      text: "2d4 + half casting mod Psychic, half on a save.",
      energy: 3, range: 8, damage: `2d4 + ${HALF}`,
      r2: LADDER_R2, r4: LADDER_R4,
      options: [
        opt("chain", "Chain", "chain", "A second target within 3 tiles of the first, half damage."),
        opt("overload", "Overload", "overload", "+2 Energy for +1d4.", { energy: 2, damage: "1d4", ...PAY }),
        opt("efficient", "Efficient", "efficient", "Energy 2.", { energy: -1 })
      ],
      evolutions: [
        evo("Spike of Doubt", "On a failed save the target also loses its reaction until its next turn."),
        evo("Echo Spike", "On a failed save, the spike repeats at the start of your next turn for half damage.")
      ] },
    { name: "Forewarn", discipline: "telepathy", img: "icons/svg/eye.svg", action: "reaction", tracks: ["range", ""],
      flavor: "You catch the intent behind a shooter's aim the moment before they fire and push it into your ally's head. They don't hear words, they just know to move.",
      text: "Reaction, trigger: an ally in range is targeted by an attack. Against that attack the ally cannot be Unaware, and their Dodge takes -10 D.M. and does not spend Dodge Pool.",
      energy: 4, range: 8,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "The Dodge bonus rises to -15 D.M." },
      options: [
        opt("overload", "Overload", "overload", "+2 Energy for a further -10 D.M. on the Dodge.", { energy: 2, ...PAY }),
        opt("efficient", "Efficient", "efficient", "Energy 3.", { energy: -1 }),
        opt("wide", "Wide", "wide", "Every ally the same attack targets is warned. Energy 5.", { energy: 1, ...PAY })
      ],
      evolutions: [
        evo("Beat Them to It", "The ally may spend their own reaction to attack the attacker before its attack resolves."),
        evo("Step Aside", "If the Dodge succeeds, the ally may Shift at once.")
      ] },
    { name: "Unease", discipline: "telepathy", img: "icons/svg/terror.svg", save: "cha", tracks: ["potency", "range"],
      flavor: "Slip a thread of doubt into an enemy's mind right as they line up their shot. A strong will can shake it off. A weak one second guesses the trigger pull.",
      text: "On a failed save, +10 D.M. on the target's next attack.",
      energy: 3, range: 8,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Potency default step." },
      options: [
        opt("wide", "Wide", "wide", "Radius 1 around the target. Energy 4.", { area: 1, energy: 1, ...PAY }),
        opt("lingering", "Lingering", "lingering", "Its next two attacks."),
        opt("efficient", "Efficient", "efficient", "Energy 2.", { energy: -1 })
      ],
      evolutions: [
        evo("Hesitation", "The target also cannot fire overwatch until the start of its next turn."),
        evo("Crippling Doubt", "A target that fails also cannot Dodge until its next turn.")
      ] },

    // Pyrokinesis
    { name: "Flare", discipline: "pyrokinesis", img: "icons/svg/fire.svg", attack: true, type: "fire", tracks: ["accuracy", "damage"],
      flavor: "Snap your fingers and hurl a burst of flame at your target! It is not the hardest hitting thing you will ever learn, but it sets them alight, and they keep burning a little bit after it lands.",
      text: "2d4 + half casting mod Fire and Ignited (1).",
      energy: 4, range: 8, damage: `2d4 + ${HALF}`,
      r2: LADDER_R2, r4: LADDER_R4,
      options: [
        opt("chain", "Chain", "chain", "A second target within 3 tiles of the first, half damage and Ignited (1)."),
        opt("overload", "Overload", "overload", "+2 Energy for +1d4 and Ignited (2).", { energy: 2, damage: "1d4", ...PAY }),
        opt("piercing", "Piercing", "piercing", "Ignores 2 Fire DR.")
      ],
      evolutions: [
        evo("Signal Fire", "While Ignited, the target cannot benefit from Concealment or smoke."),
        evo("Flashburn", "The target's tile also becomes burning ground (Ignited 1) for 1 round.")
      ] },
    { name: "Kindle", discipline: "pyrokinesis", img: "icons/svg/hazard.svg", tracks: ["range", "duration"],
      flavor: "Using your gifts you heat a patch of ground until it catches. Anyone who tries to walk through it, or is foolish enough to stand in it, is going to catch fire too.",
      text: "One tile of burning ground (Ignited 3), Duration 2. A creature entering it or starting a turn in it gains Ignited (3).",
      energy: 4, range: 8, duration: 2,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Duration +1.", duration: 1 },
      options: [
        opt("wide", "Wide", "wide", "Radius 1. Energy 5.", { area: 1, energy: 1, ...PAY }),
        opt("lingering", "Lingering", "lingering", "Duration +1.", { duration: 1 }),
        opt("overload", "Overload", "overload", "+2 Energy for Ignited (4).", { energy: 2, ...PAY })
      ],
      evolutions: [
        evo("Wildfire", "At the start of each of your turns it spreads to one adjacent tile of your choice."),
        evo("Kindling Trap", "The first creature to trigger it sets off a 2d4 Fire burst in radius 1.")
      ] },
    { name: "Ember Ward", discipline: "pyrokinesis", img: "icons/svg/fire-shield.svg", tracks: ["duration", "range"],
      flavor: "Wrap yourself in a cloak of embers that does not harm you one bit. Anyone who gets close enough to lay a hand on you learns that lesson the hard way!",
      text: "Self, Duration 2. Melee attackers who hit you gain Ignited (2). You are immune to Ignited while it lasts.",
      energy: 4, range: 0, duration: 2,
      r2: { text: "Range 3: may target one ally instead.", range: 3 },
      r4: { text: "Duration +1.", duration: 1 },
      options: [
        opt("reflexive", "Reflexive", "reflexive", "Trigger: the target is attacked in melee."),
        opt("wide", "Wide", "wide", "Every ally within 1 tile of the target. Energy 5.", { energy: 1, ...PAY }),
        opt("lingering", "Lingering", "lingering", "Duration 3.", { duration: 1 })
      ],
      evolutions: [
        evo("Backblast", "When it ends, adjacent enemies take 1d6 Fire."),
        evo("Fireproof", "The target also has 2 Fire DR while it lasts.")
      ] },

    // Vitakinesis
    { name: "Mend", discipline: "vitakinesis", img: "icons/magic/life/cross-beam-green.webp", heal: true, type: "", tracks: ["damage", "range"],
      flavor: "No matter the wound, so long as it is not a killing blow you can stitch it with your gifts at least minorly. The best part, is you can manage it from a distance too.",
      text: "You or one ally heals 1d4 + half casting mod. An ally bleeding out who is healed above 0 HP stops bleeding out.",
      energy: 4, range: 3, damage: `1d4 + ${HALF}`,
      r2: { text: "Healing +1d4.", damage: "1d4" },
      r4: { text: "Healing +1d4.", damage: "1d4" },
      options: [
        opt("overload", "Overload", "overload", "+2 Energy for +1d4 healing.", { energy: 2, damage: "1d4", ...PAY }),
        opt("chain", "Chain", "chain", "A second ally within 3 tiles of the first heals half."),
        opt("efficient", "Efficient", "efficient", "Energy 3.", { energy: -1 })
      ],
      evolutions: [
        evo("Second Life", "An ally lifted from 0 HP or below also gains 5 additive Armor HP."),
        evo("Lingering Mend", "Also heals 1d4 at the start of their next turn.")
      ] },
    { name: "Vigor", discipline: "vitakinesis", img: "icons/magic/life/heart-cross-green.webp", tracks: ["duration", "range"],
      flavor: "Fill an ally with vim and vigor! Watch them achieve athletic feats easier than before. Remind them, with you they can do it all day.",
      text: "You or one ally, Duration 1. -10 D.M. on Strength, Agility and Toughness saves.",
      energy: 3, range: 6, duration: 1,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Duration +1.", duration: 1 },
      options: [
        opt("lingering", "Lingering", "lingering", "Duration +1.", { duration: 1 }),
        opt("chain", "Chain", "chain", "A second ally within 3 tiles of the first, at -5 D.M."),
        opt("efficient", "Efficient", "efficient", "Energy 2.", { energy: -1 })
      ],
      evolutions: [
        evo("Peak Form", "-15 D.M. instead."),
        evo("Overclock", "Once while it lasts, the ally may reroll a failed Strength, Agility or Toughness save.")
      ] },
    { name: "Crystalline Skin", discipline: "vitakinesis", img: "icons/commodities/gems/gem-faceted-rough-green.webp", tracks: ["range", ""],
      flavor: "Crystalize the Eidolon-9 in an ally's skin, hardening it against any attack that threatens them!",
      text: "You or one ally gains 5 additive Armor HP. It lasts until the end of the fight or until depleted. It does not stack with itself, but stacks on Armor HP from non-paraphysical sources.",
      energy: 3, range: 6, armorHp: 5,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Armor HP +1.", armorHp: 1 },
      options: [
        opt("reflexive", "Reflexive", "reflexive", "Trigger: the ally is targeted by an attack."),
        opt("wide", "Wide", "wide", "Every ally within 1 tile of the target. Energy 4.", { energy: 1, ...PAY }),
        opt("chain", "Chain", "chain", "A second ally within 3 tiles of the first, Armor HP 4.")
      ],
      evolutions: [
        evo("Chitin", "While this Armor HP holds, the ally also has DR 1."),
        evo("Reactive Plating", "When this Armor HP is gone, the attacker takes 1d6 Psychic.")
      ] },

    // Optics
    { name: "Dazzle", discipline: "optics", img: "icons/magic/light/beam-rays-yellow-blue.webp", save: "cha", tracks: ["potency", "range"],
      flavor: "A temporary burst of perceived light that your target is hit with. It has the potential to slightly partially blind them.",
      text: "On a failed save, until the end of its next turn the target takes +10 D.M. on ranged attacks against anything more than 5 tiles away.",
      energy: 3, range: 8,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Potency default step." },
      options: [
        opt("adaptive", "Adaptive", "adaptive", ADAPTIVE, { energy: 1, adaptive: true, ...PAY }),
        opt("lingering", "Lingering", "lingering", "Duration +1."),
        opt("efficient", "Efficient", "efficient", "Energy 2.", { energy: -1 })
      ],
      evolutions: [
        evo("Blinding Glint", "A target that fails cannot fire overwatch until its next turn."),
        evo("Spots", "The penalty applies to all its ranged attacks, at any distance.")
      ] },
    { name: "Blur", discipline: "optics", img: "icons/magic/perception/silhouette-stealth-shadow.webp", tracks: ["duration", "range"],
      flavor: "Using your gifts you cause yourself or a willing ally to seemingly blur in all of their movements. It prevents any hostile creatures eyes from ever really settling on them.",
      text: "You or one ally, Duration 1. Attacks against them take +5 D.M.",
      energy: 3, range: 3, duration: 1,
      r2: { text: "Range +1.", range: 1 },
      r4: { text: "Duration +1.", duration: 1 },
      options: [
        opt("reflexive", "Reflexive", "reflexive", "Trigger: the target is shot at."),
        opt("wide", "Wide", "wide", "Every ally within 1 tile of the target. Energy 4.", { energy: 1, ...PAY }),
        opt("lingering", "Lingering", "lingering", "Duration 2.", { duration: 1 })
      ],
      evolutions: [
        evo("Ghost Step", "While blurred, their movement does not trigger overwatch."),
        evo("Double Image", "The first attack against them each round rolls 1d2; on a 1 it misses outright.")
      ] },
    { name: "Reveal", discipline: "optics", img: "icons/magic/light/beam-rays-teal.webp", tracks: ["range", "duration"],
      flavor: "Bend and reflect light in area revealing anything that would otherwise be concealed!",
      text: "Area radius 2, squad-wide. Concealed creatures inside are revealed to the whole squad.",
      energy: 5, range: 8, area: 2,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Range +4.", range: 4 },
      options: [
        opt("wide", "Wide", "wide", "Radius 3. Energy 6.", { area: 1, energy: 1, ...PAY }),
        opt("lingering", "Lingering", "lingering", "The area keeps revealing for 1 more round.", { duration: 1 }),
        opt("efficient", "Efficient", "efficient", "Energy cost 1 less, never below half its base.", { energy: -1 })
      ],
      evolutions: [
        evo("Thermal Ghost", "Also shows the positions of creatures behind walls in the area. Positions only: it gives no line of sight to shoot."),
        evo("Exposed", "The squad's attacks against revealed creatures get -5 D.M. for 1 round.")
      ] }
  ];

  /* ---------------- Building the item data ---------------- */
  const NUMBERS = ["accuracy", "potency", "energy", "range", "duration", "area", "barrier", "defense", "shred", "armorHp"];
  const changes = src => ({ ...Object.fromEntries(NUMBERS.map(k => [k, Number(src[k]) || 0])), damage: String(src.damage ?? "") });
  // A Rank 2 or 4 step: Accuracy and Potency left null take the track default.
  const step = src => ({ ...changes(src), text: src.text ?? "", accuracy: src.accuracy ?? null, potency: src.potency ?? null });
  const systemOf = w => ({
    description: p(`<em>${w.flavor}</em>`) + p(w.text),
    kind: "active", source: "generalist", actionType: w.action ?? "single",
    energyCost: w.energy, range: w.range ?? 0, area: w.area ?? 0,
    "paraphysics.discipline": w.discipline,
    "paraphysics.attack": !!w.attack,
    "paraphysics.accuracy": 0,
    "paraphysics.damage": { formula: w.damage ?? "", type: w.type ?? "" },
    "paraphysics.heal": !!w.heal,
    "paraphysics.tier": 1,
    "paraphysics.trackA": w.tracks[0] ?? "",
    "paraphysics.trackB": w.tracks[1] ?? "",
    "paraphysics.duration": w.duration ?? 0,
    "paraphysics.barrier": 0,
    "paraphysics.armorHp": w.armorHp ?? 0,
    "paraphysics.rank2": step(w.r2),
    "paraphysics.rank4": step(w.r4),
    "paraphysics.options": w.options.map(o => ({ id: o.id, archetype: o.archetype ?? "", label: o.label, text: o.text, ...changes(o),
      anchored: false, steadfast: false, optionalEnergy: !!o.optionalEnergy, adaptive: !!o.adaptive })),
    "paraphysics.evolutions": w.evolutions.map(e => ({ id: e.id, name: e.name, text: p(e.text), ...changes(e),
      damageType: "", concentration: "", optionalEnergy: !!e.optionalEnergy, rename: false, bend: false })),
    "paraphysics.concentration": false,
    "paraphysics.learnable": true,
    "paraphysics.save": w.save ?? "",
    "paraphysics.exclusive": "",
    "paraphysics.shape": "radius",
    "paraphysics.width": 0,
    "paraphysics.modes": "",
    "paraphysics.extraSave": { save: "", label: "" }
  });
  // As an update: every field under system, by path.
  const asUpdate = w => Object.fromEntries(Object.entries(systemOf(w)).map(([k, v]) => [`system.${k}`, v]));
  // Matched on discipline too, so a role ability that happens to share a name is never touched. The
  // first Astrokinesis build left Gravbolt with no discipline in some worlds, so a blank one counts there.
  const isPower = (i, w) => (i.type === "ability") && (fold(i.name) === fold(w.name))
    && ((i.system.paraphysics?.discipline === w.discipline) || ((w.discipline === "astrokinesis") && !i.system.paraphysics?.discipline));
  const keepImg = (i, w) => (!i.img || /mystery-man|icons\/svg\/item-bag/.test(i.img)) ? { img: w.img } : {};

  const done = [];
  const folders = {};
  const folderFor = async label => folders[label] ??= (game.folders.find(f => (f.type === "Item") && (f.name === label))
    ?? await Folder.implementation.create({ name: label, type: "Item" }));

  for ( const w of POWERS ) {
    const update = asUpdate(w);
    const label = CONFIG.IROP?.disciplines?.[w.discipline] ?? game.irop?.config?.disciplines?.[w.discipline]
      ?? (w.discipline.charAt(0).toUpperCase() + w.discipline.slice(1));
    // The Items sidebar.
    const found = game.items.filter(i => isPower(i, w));
    if ( !found.length ) {
      const folder = await folderFor(label);
      await Item.implementation.create({ name: w.name, type: "ability", img: w.img, folder: folder.id, system: foundry.utils.expandObject(systemOf(w)) });
      done.push(`${w.name}: made in the ${label} folder`);
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
    whisper: [game.user.id], speaker: { alias: "Wave 1 powers" },
    content: `<div class="irop-card"><header class="card-head"><h3>Tier 1 powers</h3><span class="card-sub">${POWERS.length} powers, six disciplines</span></header>
      <ul>${done.map(d => `<li>${esc(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info(`Tier 1 powers set: ${POWERS.length}. The list is in chat.`);
})();

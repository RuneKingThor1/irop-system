/**
 * The Tier 1 Vitakinesis and Optics powers (Johnald, 2026-10-30), from "Wave 1 Paraphysics Powers
 * (Draft)" as ruled that day. Run once as the GM, as a script macro; safe to run again after editing
 * the numbers below. Needs system 0.1.25 or later: reload (F5) after updating first.
 *
 *   - makes Mend, Vigor, Crystalline Skin, Dazzle, Blur and Reveal as ability items in the Items
 *     sidebar's Vitakinesis and Optics folders, each with Ranks 1 to 4, its three Rank 3 options and
 *     its two Rank 5 evolutions. A power there already (matched on name and discipline) is updated,
 *     not made twice, and its picture is kept;
 *   - updates the copies characters hold the same way, keeping each one's rank, its Rank 3 choice
 *     and its evolution where the power still offers them.
 *
 * Healing uses half the caster's casting modifier, rounded down: Charisma, Intelligence for a
 * Reticulon. Mend's card has a Roll healing button and Crystalline Skin's a Grant Armor HP button,
 * both for the tokens the presser has targeted, or the caster when none are.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const fields = CONFIG.Item.dataModels?.ability?.schema?.fields?.paraphysics?.fields;
  if ( !fields?.armorHp || !fields?.heal ) {
    return ui.notifications.error("This world is not running system 0.1.25 or later yet. Update the system, reload (F5), then run this again.", { permanent: true });
  }
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
  const p = (...lines) => lines.map(l => `<p>${l}</p>`).join("");
  const opt = (id, label, archetype, text, changes = {}) => ({ id, label, archetype, text, ...changes });
  const evo = (name, text, changes = {}) => ({ id: fold(name), name, text, ...changes });
  const PAY = { optionalEnergy: true };
  const ADAPTIVE = "You may for the added cost of +1 Energy change the attribute required to save from this power.";

  /* ---------------- The powers ---------------- */
  const POWERS = [
    // Vitakinesis
    { name: "Mend", discipline: "vitakinesis", img: "icons/magic/life/cross-beam-green.webp", tier: 1, heal: true, tracks: ["damage", "range"],
      flavor: "No matter the wound, so long as it is not a killing blow you can stitch it with your gifts at least minorly. The best part, is you can manage it from a distance too.",
      text: "You or one ally heals 1d4 + half casting mod. An ally bleeding out who is healed above 0 HP stops bleeding out.",
      energy: 3, range: 3, damage: "1d4 + floor(@casting.mod / 2)",
      r2: { text: "Healing +1.", damage: "1" },
      r4: { text: "Healing +1d4.", damage: "1d4" },
      options: [
        opt("overload", "Overload", "overload", "+2 Energy for +1d4 healing.", { energy: 2, damage: "1d4", ...PAY }),
        opt("chain", "Chain", "chain", "A second ally within 3 tiles of the first heals half."),
        opt("efficient", "Efficient", "efficient", "Energy 2.", { energy: -1 })
      ],
      evolutions: [
        evo("Second Life", "An ally lifted from 0 HP or below also gains 5 additive Armor HP."),
        evo("Lingering Mend", "Also heals 1d4 at the start of their next turn.")
      ] },
    { name: "Vigor", discipline: "vitakinesis", img: "icons/magic/life/heart-cross-green.webp", tier: 1, tracks: ["duration", "range"],
      flavor: "Fill an ally with vim and vigor! Watch them achieve athletic feats easier than before. Remind them, with you they can do it all day.",
      text: "You or one ally, Duration 1. -10 D.M. on Strength, Agility and Toughness saves.",
      energy: 2, range: 6, duration: 1,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Duration +1.", duration: 1 },
      options: [
        opt("lingering", "Lingering", "lingering", "Duration +1.", { duration: 1 }),
        opt("chain", "Chain", "chain", "A second ally within 3 tiles of the first, at -5 D.M."),
        opt("efficient", "Efficient", "efficient", "Energy 1.", { energy: -1 })
      ],
      evolutions: [
        evo("Peak Form", "-15 D.M. instead."),
        evo("Overclock", "Once while it lasts, the ally may reroll a failed Strength, Agility or Toughness save.")
      ] },
    { name: "Crystalline Skin", discipline: "vitakinesis", img: "icons/commodities/gems/gem-faceted-rough-green.webp", tier: 1, tracks: ["range", ""],
      flavor: "Crystalize the Eidolon-9 in an ally's skin, hardening it against any attack that threatens them!",
      text: "You or one ally gains 5 additive Armor HP. It lasts until the end of the fight or until depleted. It does not stack with itself, but stacks on Armor HP from non-paraphysical sources.",
      energy: 2, range: 6, armorHp: 5,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Armor HP +1.", armorHp: 1 },
      options: [
        opt("reflexive", "Reflexive", "reflexive", "Usable as a reaction when the ally is targeted by an attack."),
        opt("wide", "Wide", "wide", "Every ally within 1 tile of the target. Energy 3.", { energy: 1, ...PAY }),
        opt("chain", "Chain", "chain", "A second ally within 3 tiles of the first, Armor HP 4.")
      ],
      evolutions: [
        evo("Chitin", "While this Armor HP holds, the ally also has DR 1."),
        evo("Reactive Plating", "When this Armor HP is gone, the attacker takes 1d6 Psychic.")
      ] },
    // Optics
    { name: "Dazzle", discipline: "optics", img: "icons/magic/light/beam-rays-yellow-blue.webp", tier: 1, save: "cha", tracks: ["potency", "range"],
      flavor: "A temporary burst of perceived light that your target is hit with. It has the potential to slightly partially blind them.",
      text: "On a failed save, until the end of its next turn the target takes +10 D.M. on ranged attacks against anything more than 5 tiles away.",
      energy: 2, range: 8,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Potency default step." },
      options: [
        opt("adaptive", "Adaptive", "adaptive", ADAPTIVE, { energy: 1, adaptive: true, ...PAY }),
        opt("lingering", "Lingering", "lingering", "Duration +1."),
        opt("efficient", "Efficient", "efficient", "Energy 1.", { energy: -1 })
      ],
      evolutions: [
        evo("Blinding Glint", "A target that fails cannot fire overwatch until its next turn."),
        evo("Spots", "The penalty applies to all its ranged attacks, at any distance.")
      ] },
    { name: "Blur", discipline: "optics", img: "icons/magic/perception/silhouette-stealth-shadow.webp", tier: 1, tracks: ["duration", "range"],
      flavor: "Using your gifts you cause yourself or a willing ally to seemingly blur in all of their movements. It prevents any hostile creatures eyes from ever really settling on them.",
      text: "You or one ally, Duration 1. Attacks against them take +5 D.M.",
      energy: 2, range: 3, duration: 1,
      r2: { text: "Range +1.", range: 1 },
      r4: { text: "Duration +1.", duration: 1 },
      options: [
        opt("reflexive", "Reflexive", "reflexive", "Usable as a reaction when the target is shot at."),
        opt("wide", "Wide", "wide", "Every ally within 1 tile of the target. Energy 3.", { energy: 1, ...PAY }),
        opt("lingering", "Lingering", "lingering", "Duration 2.", { duration: 1 })
      ],
      evolutions: [
        evo("Ghost Step", "While blurred, their movement does not trigger overwatch."),
        evo("Double Image", "The first attack against them each round rolls 1d2; on a 1 it misses outright.")
      ] },
    { name: "Reveal", discipline: "optics", img: "icons/magic/light/beam-rays-teal.webp", tier: 1, tracks: ["range", "duration"],
      flavor: "Bend and reflect light in area revealing anything that would otherwise be concealed!",
      text: "Concealed creatures inside are revealed to the whole squad.",
      energy: 4, range: 8, area: 2,
      r2: { text: "Range +2.", range: 2 },
      r4: { text: "Range +4.", range: 4 },
      options: [
        opt("wide", "Wide", "wide", "Radius 3. Energy 5.", { area: 1, energy: 1, ...PAY }),
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
    kind: "active", source: "generalist", actionType: "single",
    energyCost: w.energy, range: w.range ?? 0, area: w.area ?? 0,
    "paraphysics.discipline": w.discipline,
    "paraphysics.attack": false,
    "paraphysics.accuracy": 0,
    "paraphysics.damage": { formula: w.damage ?? "", type: "" },
    "paraphysics.heal": !!w.heal,
    "paraphysics.tier": w.tier,
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
      damageType: "", concentration: "", optionalEnergy: false, rename: false, bend: false })),
    "paraphysics.concentration": false,
    "paraphysics.learnable": true,
    "paraphysics.save": w.save ?? ""
  });
  // As an update: every field under system, by path.
  const asUpdate = w => Object.fromEntries(Object.entries(systemOf(w)).map(([k, v]) => [`system.${k}`, v]));
  // Matched on discipline too, so a role ability that happens to share a name is never touched.
  const isPower = (i, w) => (i.type === "ability") && (fold(i.name) === fold(w.name)) && (i.system.paraphysics?.discipline === w.discipline);
  const keepImg = (i, w) => (!i.img || /mystery-man|icons\/svg\/item-bag/.test(i.img)) ? { img: w.img } : {};

  const done = [];
  const folderFor = async name => game.folders.find(f => (f.type === "Item") && (f.name === name))
    ?? await Folder.implementation.create({ name, type: "Item" });

  for ( const w of POWERS ) {
    const update = asUpdate(w);
    const label = (w.discipline === "optics") ? "Optics" : "Vitakinesis";
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
        done.push(`${actor.name}: ${w.name} updated, rank ${ps.rank} kept`);
      }
    }
  }

  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Wave 1 powers" },
    content: `<div class="irop-card"><header class="card-head"><h3>Tier 1 powers</h3><span class="card-sub">Vitakinesis and Optics</span></header>
      <ul>${done.map(d => `<li>${esc(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info(`Tier 1 powers ready: ${POWERS.length}.`);
})();

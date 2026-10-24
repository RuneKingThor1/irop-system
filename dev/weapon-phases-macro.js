/**
 * Weapon phases (Johnald, 2026-10-23). Run once as the GM, as a script macro; safe to run again.
 * Needs the system with weapon phases loaded: after updating it, reload the world (F5) first.
 *
 *   - Bio-Spike Launcher: a natural ranged weapon with three phases, Assault Rifle, DMR and Shotgun,
 *     each with the damage dice, accuracy, critical and range of this world's lowest tier weapon of
 *     that type in the Items sidebar. Switching between them is an action. If the world has the
 *     launcher only as a mutation, the weapon is made in the Items sidebar (with the mutation's
 *     picture), and given to every actor that has the mutation but not the weapon.
 *   - Riot Sword (2H), the GENESIS Warden's phased greatsword: a Phased phase that can Cleave (an arc
 *     1 tile deep in front), and an Electrified phase whose hit makes each target save on Toughness
 *     or be Stunned (2), its damage Electric. If the world has no Riot Sword it is made, with the
 *     damage of the lowest tier sword in the Items sidebar (2d8 if there is none: check it), and
 *     given to every GENESIS Warden that lacks it.
 *
 * Existing copies, in the Items sidebar and on actors, get the phases too.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  if ( !CONFIG.Item.dataModels?.weapon?.schema?.fields?.phases ) {
    return ui.notifications.error("This world is not running the system with weapon phases yet. Update the system, reload (F5), then run this again.", { permanent: true });
  }
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
  const done = [];
  const id = key => key.padEnd(16, "0").slice(0, 16);
  const strip = obj => { const c = foundry.utils.deepClone(obj); for ( const k of ["_id", "folder", "sort", "ownership", "_stats"] ) delete c[k]; return c; };

  // The lowest tier weapon in the sidebar of a type.
  const model = type => game.items.filter(i => (i.type === "weapon") && (i.system.weaponType === type) && !i.system.phases?.length)
    .sort((a, b) => (a.system.tier - b.system.tier) || a.name.localeCompare(b.name))[0] ?? null;

  /* ---------------- Bio-Spike Launcher ---------------- */
  const SPIKE = "biospikelauncher";
  const spikePhases = [["Assault Rifle", "rifle"], ["DMR", "dmr"], ["Shotgun", "shotgun"]].map(([label, type]) => {
    const m = model(type);
    const key = id(`biospike${type}`);
    if ( !m ) { done.push(`No ${label} in the Items sidebar: the Bio-Spike's ${label} phase is blank, fill it on its sheet`); return { id: key, label }; }
    const s = m.system;
    done.push(`Bio-Spike ${label} phase copied from ${m.name}`);
    // A phase adds to the weapon's own accuracy and critical, which the launcher keeps at zero.
    return { id: key, label, text: `Grown as a ${label}`, damage: { formula: s.damage.formula, type: "" },
      accuracy: Number(s.accuracy) || 0, critChance: Number(s.critical?.chance) || 0, critDamage: Number(s.critical?.damage) || 0,
      range: foundry.utils.deepClone(s.range) };
  });
  const spikeSystem = phase => ({
    category: "ranged", weaponClass: "natural", weaponType: "natural", accuracy: 0,
    critical: { chance: 0, damage: 0 }, damage: { formula: spikePhases[0].damage?.formula ?? "", type: "physical" },
    phase: phase || spikePhases[0].id, phases: spikePhases, equipped: true
  });
  const mutation = game.items.find(i => (i.type === "mutation") && (fold(i.name) === SPIKE));
  let spike = game.items.find(i => (i.type === "weapon") && (fold(i.name) === SPIKE));
  if ( !spike ) {
    spike = await Item.implementation.create({ name: "Bio-Spike Launcher", type: "weapon", img: mutation?.img ?? "icons/svg/sword.svg",
      system: { ...spikeSystem(""), description: mutation?.system?.description ?? "" } });
    done.push("Bio-Spike Launcher made as a weapon in the Items sidebar");
  }
  else { await spike.update({ system: spikeSystem(spike.system.phase) }); done.push("Bio-Spike Launcher (Items sidebar) given its phases"); }

  /* ---------------- Riot Sword ---------------- */
  const isSword = i => (i.type === "weapon") && /riotsword/.test(fold(i.name)) && !/energized/.test(fold(i.name));
  const swordPhases = [
    { id: id("phasededge"), label: "Phased", text: "A greatsword's edge: it can Cleave an arc in front", cleave: 1 },
    { id: id("phasedshock"), label: "Electrified", text: "Each target hit saves on Toughness or is Stunned (2)",
      damage: { formula: "", type: "electric" }, save: "tgh", saveDm: 0, status: "stunned", statusValue: 2 }
  ];
  let sword = game.items.find(isSword);
  if ( !sword ) {
    const m = model("sword");
    sword = await Item.implementation.create({ name: "Riot Sword (2H)", type: "weapon", img: "icons/weapons/swords/greatsword-crossguard-steel.webp",
      system: { category: "melee", weaponClass: "twoHanded", weaponType: "sword", handling: "standard", tier: 2,
        damage: { formula: m?.system.damage.formula || "2d8", type: "physical" }, phase: swordPhases[0].id, phases: swordPhases,
        description: "<p>The GENESIS Warden's phased greatsword. In its Phased state it can Cleave; switched to Electrified (an action), each target it hits saves on Toughness or is Stunned (2).</p>" } });
    done.push(`Riot Sword (2H) made in the Items sidebar, damage ${m ? `from ${m.name}` : "2d8 (no sword in the sidebar to copy: check it)"}`);
  }
  else { await sword.update({ "system.phase": sword.system.phase || swordPhases[0].id, "system.phases": swordPhases }); done.push(`${sword.name} (Items sidebar) given Phased and Electrified`); }

  /* ---------------- Actors ---------------- */
  for ( const actor of game.actors ) {
    const give = [];
    const ownSpike = actor.items.filter(i => (i.type === "weapon") && (fold(i.name) === SPIKE));
    for ( const w of ownSpike ) await w.update({ system: spikeSystem(w.system.phase) });
    if ( !ownSpike.length && actor.items.some(i => (i.type === "mutation") && (fold(i.name) === SPIKE)) ) give.push(strip(spike.toObject()));
    const ownSword = actor.items.filter(isSword);
    for ( const w of ownSword ) await w.update({ "system.phase": w.system.phase || swordPhases[0].id, "system.phases": swordPhases });
    if ( !ownSword.length && (fold(actor.name) === "genesiswarden") ) give.push({ ...strip(sword.toObject()), system: { ...sword.toObject().system, equipped: true } });
    if ( give.length ) await actor.createEmbeddedDocuments("Item", give);
    const touched = ownSpike.length + ownSword.length + give.length;
    if ( touched ) done.push(`${actor.name}: ${[ownSpike.length || ownSword.length ? "phases set" : "", give.length ? `given ${give.map(g => g.name).join(", ")}` : ""].filter(Boolean).join(", ")}`);
  }

  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Weapon phases" },
    content: `<div class="irop-card"><header class="card-head"><h3>Weapon phases</h3><span class="card-sub">Bio-Spike Launcher, Riot Sword</span></header>
      <ul>${done.map(d => `<li>${esc(d)}</li>`).join("")}</ul></div>`
  });
  ui.notifications.info("Weapon phases set. The list is in chat.");
})();

/**
 * ROLE PERK RULES, the numbers behind each perk's text (Johnald, 2026-10-18: "get all of the role perks
 * operable"). Keyed by perk name, compared loosely (case and punctuation ignored); the perk's own text
 * stays the rule of record, this is what the rolls and the sheet do with it. ASSUMPTIONS are marked;
 * check them against the text on each perk. Read by rules/perks.mjs. A perk not listed here, or a part
 * of one the system cannot see (squad buffs and zones, cover, movement, reactions), stays text.
 *
 * An entry may hold:
 *   mods      bonuses the rolls add, each {stat, value, ...conditions}:
 *               stat     attack (D.M. to hit, minus easier), critical (D.M. on the critical roll),
 *                        damage, critDamage, shred, penetration, damagePct (% more damage),
 *                        blast (blast radius), drBypass (DR the hit ignores), enemyDodge (D.M. on the
 *                        target's dodge against this hit), dodge (D.M. on this character's own dodges)
 *               types    weapon types it needs (rules/weapon-types.mjs); classes: weapon classes
 *                        (oneHanded, twoHanded...); melee / ranged: true for that kind of attack only
 *               bands    range bands it needs; orMelee: true also counts melee attacks
 *               ammo     "special": only with special ammunition loaded
 *               wornArmor  an armor class worn; byTier: [values by that armor's tier]
 *               equippedType  a weapon type in hand (a shield)
 *               valueFrom {attrs, factor}: the value is that many times the best of those attribute mods
 *               hpBelow  only against a target under this share of its HP (pre-ticked when it shows)
 *               situation  a tick box in the roll window, for what the system cannot see
 *               scale    {label, max | maxFrom, every, cap}: a number box, the value per (every) count
 *   attack    an active made as an attack: {accuracy, critical, critDamage, damagePct, halfDamage,
 *             noCrit, autoHit, noDefense, ammo, blast, types, byType: {weaponType: accuracy}};
 *             Use opens the weapon's attack with these
 *   ammoOnly  an active that spends this much ammo from the weapon in hand, with no attack roll
 *   upgrades  numbers it changes on other abilities: {"Ability": {accuracy, accuracyTo, critical, energy,
 *             ammo (sets), ammoDelta, blast, damagePct, crit (lifts no critical), fullDamage}}. Text in
 *             the form "Ability: ..." is added to that ability's card on its own.
 *   uses      {max | maxFrom, per: "mission"}: limited uses, refilled at Session start
 *   armor     worn armor: {pct: {class: % armor HP}, drAll: {class: DR}, drByTier: {class: [DR by tier]},
 *             fullRegalia}
 *   actor     on the character: {bonuses: {path under system.bonuses: n}, attributes: {key: n},
 *             critical: [attribute mods added to Critical]}
 *   slots     extra mod slots: [{types | classes | armorClass, value}]
 *   chem      chemthrowers: {fuelCost, dieUp, statusUp, saveDm, drBypass, damageTypes}
 *   aka       older names the perk still answers to (a world renamed later)
 *   roles     the same name in another doctrine with other numbers: {roleKey: entry}, by the perk's Source
 *   (a mod's byWeaponTier: [values by the weapon's Tier] is read off the weapon attacking)
 */

const OUT_OF_TURN = "Overwatch or out of turn attack";
const IN_A_DUEL = "In a duel with the target";
const ONE_HAND_FREE = "One handed weapon, other hand free";
const WITHIN_4 = "Attacker within 4 tiles";
const VS_MELEE = "Against a melee attack";
const THROUGH_COVER = "Attack through your cover, not flanked";
const PISTOLS = ["pistol", "magnum"];
const PRECISION = ["dmr", "sniper"];
const GRENADES = ["grenade", "grenadeLauncher"];
const ROCKETS = ["rocketLauncher", "rocket"];
const BURST = ["smg", "shotgun"];
const BURST_AXES = ["smg", "shotgun", "axe"];
// ASSUMPTION: "hone" is a melee weapon's critical chance (a sharper edge crits more); "pierce" is penetration.
const hone = (value, conditions) => ({ stat: "critical", value, ...conditions });

export const PERK_RULES = {

  /* ================= Legionary ================= */
  /* ---- Primary ---- */
  "Ammo Connoiseur": { mods: [{ stat: "damage", value: 2, ammo: "special" }] },
  "Chained Shot": { attack: { accuracy: 10, noCrit: true, ammo: 1 } },
  "Effective Fire": { mods: [{ stat: "enemyDodge", value: 15 }] },
  "Executioner": { mods: [{ stat: "attack", value: -10, hpBelow: 25 }, { stat: "critical", value: -10, hpBelow: 25 }] },
  "Full Regalia": { armor: { fullRegalia: true } },
  "Medium Armor Mastery I": { armor: { pct: { medium: 50 } } },
  "Medium Armor Mastery II": { slots: [{ armorClass: "medium", value: 1 }] },
  "Pour it On!": { attack: { autoHit: true, ammo: 3 } },
  "Rifle and SAW Specialist I": { mods: [{ stat: "attack", value: -4, types: ["rifle", "saw"], bands: ["medium"] }, { stat: "critDamage", value: 1, types: ["rifle", "saw"] }] },
  "Rifle and SAW Specialist II": { mods: [{ stat: "attack", value: -3, types: ["rifle", "saw"], bands: ["short", "medium"] }, { stat: "critDamage", value: 1, types: ["rifle", "saw"] }] },
  "SMG and Shotgun Specialist I": { mods: [{ stat: "attack", value: -4, types: BURST, bands: ["short"] }, { stat: "critDamage", value: 1, types: BURST }] },
  "SMG and Shotgun Specialist II": { mods: [{ stat: "attack", value: -5, types: BURST, bands: ["short"] }, { stat: "critDamage", value: 1, types: BURST }] },
  "Universal Soldier": { uses: { max: 1, per: "mission" } },
  "Locked On": { upgrades: { "Pour it On!": { ammo: 2 }, "Chained Shot": { accuracyTo: 0, crit: true } } },
  "Over the Top": { upgrades: { "Rally": { energy: -1 } } },
  "Superior Training": { upgrades: { "Pour it On!": { energy: -1, ammo: 1 }, "Chained Shot": { accuracyTo: -10, energy: -1 } } },
  /* ---- Field Tactician ---- */
  "Efficient Tactical Command": { upgrades: { "Forward Operations": { energy: -1 }, "Stratagem: Rear Lines": { energy: -1 } } },
  "Pincer Manuever": { attack: { noCrit: true } },
  "Tactical Brilliance": { uses: { max: 1, per: "mission" } },
  /* ---- Pointman ---- */
  // ASSUMPTION: "Rifles" here are assault rifles, as in the Legionary's weapon specialties.
  "Center Mass": { mods: [{ stat: "damage", value: 1, types: ["rifle"] }, { stat: "enemyDodge", value: 20, types: ["rifle"] }] },
  "Clear the Room": { attack: { accuracy: -15 } },
  "Lock in, Lock on": { mods: [{ stat: "attack", value: -1, scale: { label: "Foes in sight", max: 10 } }] },
  "Swift Hands": { uses: { max: 2, per: "mission" } },
  "Watch my Six": { mods: [{ stat: "dodge", value: -15, situation: "Reaction fire, an ally stacked up with you" }] },
  "Weapon Expert": { mods: [{ stat: "damage", value: 1 }, { stat: "critDamage", value: 1 }] },
  /* ---- Punisher ---- */
  // ASSUMPTION: reaction fire's +15 D.M. is added by hand (or the Situational D.M.); this ticks it back off.
  "Anger Management": { mods: [{ stat: "attack", value: -15, situation: "Reaction fire (no +15 penalty)" }] },
  "Drop'em fast!": { mods: [{ stat: "critDamage", value: 3, situation: OUT_OF_TURN }] },
  "Judge and Jury": { mods: [{ stat: "damage", value: 1, situation: OUT_OF_TURN }] },
  "Interdiction": { attack: { noCrit: true } },
  "You won't get away with it!": { attack: { noCrit: true } },
  "Vengeance": { upgrades: { "You won't get away with it!": { crit: true } } },

  /* ================= Marauder ================= */
  /* ---- Primary ---- */
  "Axe Specialist I": { mods: [hone(-5, { types: ["axe"] }), { stat: "damage", value: 1, types: ["axe"] }] },
  "Axe Specialist II": { mods: [hone(-5, { types: ["axe"] }), { stat: "damage", value: 1, types: ["axe"] }] },
  "Shotgun Specialist I": { mods: [{ stat: "attack", value: -3, types: ["shotgun"], bands: ["short", "medium"] }] },
  "Shotgun Specialist II": { mods: [{ stat: "attack", value: -5, types: ["shotgun"], bands: ["short", "medium"] }] },
  "SMG Specialist I": { mods: [{ stat: "attack", value: -3, types: ["smg"], bands: ["short", "medium"] }] },
  "Bring'em On": { mods: [{ stat: "critDamage", value: 1, scale: { label: "Enemies you can see", max: 99, every: 2, cap: 8 } }] },
  "Concussive Strike": { attack: { types: BURST_AXES } },
  "Infighter": { mods: [{ stat: "dodge", value: -10, situation: WITHIN_4 }] },
  "Raid Time": { mods: [{ stat: "damagePct", value: 25, situation: "Raid Time is active" }] },
  "Trench Warfare": { attack: { types: BURST_AXES, noCrit: true } },
  "Up Close and Personal": { mods: [{ stat: "critical", value: -10, bands: ["short"], orMelee: true }] },
  // Marauder's Will to Survive is -5 to dodge through cover; the Warmachine's, -10.
  "Will to Survive": { mods: [{ stat: "dodge", value: -5, situation: THROUGH_COVER }],
    roles: { warmachine: { mods: [{ stat: "dodge", value: -10, situation: THROUGH_COVER }] } } },
  "SMG Specialist II": { mods: [{ stat: "attack", value: -5, types: ["smg"], bands: ["short", "medium"] }],
    roles: { specialist: { mods: [{ stat: "attack", value: -5, types: ["smg"], bands: ["short", "medium"] }, { stat: "critDamage", value: 1, types: ["smg"] }] } } },
  "Killer Instinct": { mods: [{ stat: "critical", value: -10, situation: "Raid Time is active, a target you hit" }] },
  "Armageddon": { upgrades: { "Run and Gun*": { energy: -1 }, "Run and Gun": { energy: -1 } } },
  /* ---- Commando ---- */
  "Blood Oath": { mods: [{ stat: "attack", value: -30, situation: "Against your Blood Oath target" }, { stat: "critical", value: -30, situation: "Against your Blood Oath target" }] },
  "Fluid Motions": { mods: [{ stat: "critical", value: -10, types: ["axe"], classes: ["oneHanded"] }, { stat: "penetration", value: 2, types: ["axe"], classes: ["oneHanded"] }] },
  "Furious Assault": { attack: { accuracy: -15, critical: -25, critDamage: 5, types: BURST_AXES } },
  "Go Low, Go Loud": { slots: [{ types: BURST, value: 1 }] },
  "Hard as Nails": { mods: [{ stat: "shred", value: 1, types: ["axe"], classes: ["twoHanded"] }] },
  "Long Distance Conditioning": { actor: { bonuses: { "move.run": 1, "move.sprint": 1 } } },
  "Munnr": { slots: [{ types: ["axe"], value: 1 }] },
  "Path of Blood": { mods: [{ stat: "critDamage", value: 1, scale: { label: "Tiles moved this turn", max: 99, every: 3 } }] },
  "Till Valhalla": { mods: [{ stat: "attack", value: -1, scale: { label: "Missing HP (one check a turn)", max: 99 } }] },
  "Vikingr": { mods: [{ stat: "critical", value: -10, types: ["axe"], classes: ["twoHanded"] }] },
  /* ---- Defender ---- */
  "Deflection": { mods: [{ stat: "dodge", value: -2, equippedType: "shield", scale: { label: "Tiles to the attacker", max: 99 } }] },
  "It's a Riot": { mods: [{ stat: "attack", value: -10, situation: "Defending an ally" }] },
  "Swatting": { attack: { types: ["pistol", "shotgun"] } },
  /* ---- Liquidator ---- */
  "Chemical Stablization": { chem: { dieUp: 1 } },
  "Chemical Volatility": { chem: { statusUp: 1 } },
  "Fire and Ice": { chem: { drBypass: 3, saveDm: 10, damageTypes: ["fire", "cold"] } },
  "Toxic Avenger": { chem: { drBypass: 3, saveDm: 10, damageTypes: ["acid", "electric"] } },
  "Fuel Efficiency": { chem: { fuelCost: -5 } },
  "JP-8": { upgrades: { "Someone call an Exterminator?": { energy: -3 } } },

  /* ================= Specialist ================= */
  /* ---- Primary ---- */
  "Focus": { mods: [{ stat: "enemyDodge", value: 20, situation: OUT_OF_TURN }, { stat: "attack", value: -20, situation: "Focus: 5 Energy spent on this reaction shot" }] },
  "Opportunist": { mods: [{ stat: "attack", value: -15, situation: "Reaction fire (no +15 penalty)" }] },
  "Pistol Specialist I": { mods: [{ stat: "attack", value: -5, types: ["pistol"], bands: ["short", "medium"] }, { stat: "critDamage", value: 1, types: ["pistol"] }] },
  "Pistol Specialist II": { mods: [{ stat: "attack", value: -5, types: ["pistol"], bands: ["short", "medium"] }, { stat: "critDamage", value: 1, types: ["pistol"] }] },
  "Rifle Specialist I": { mods: [{ stat: "attack", value: -3, types: ["rifle"], bands: ["medium", "long"] }] },
  "Rifle Specialist II": { mods: [{ stat: "attack", value: -5, types: ["rifle"], bands: ["medium", "long"] }, { stat: "critDamage", value: 1, types: ["rifle"] }] },
  "Supreme Potency": { upgrades: { "Paramedic": { energy: -1 } } },
  "Mad Science!": { upgrades: { "Jury Rig": { energy: -1 } } },
  /* ---- Sapper ---- */
  "Blast Radius": { mods: [{ stat: "blast", value: 1, types: GRENADES }] },
  "Follower of the Booms": { mods: [{ stat: "shred", value: 1, types: GRENADES }, { stat: "damage", value: 2, types: GRENADES }] },
  "They aint sh*t!": { mods: [{ stat: "critDamage", value: 4, types: GRENADES }] },

  /* ================= Outrider ================= */
  /* ---- Primary ---- */
  "Alpha Strike": { mods: [{ stat: "critical", value: -10, situation: "The target is exposed to you" }, { stat: "critical", value: -10, situation: "The target has not taken its first turn" }] },
  "Angle of Attack": { mods: [{ stat: "attack", value: -5, scale: { label: "Degrees of elevation over the target", max: 9 } }] },
  "Called Shot": { attack: { accuracy: 15 } },
  "Disabling Shot": { attack: { accuracy: 15, halfDamage: true } },
  "Flush": { attack: { accuracy: -30, halfDamage: true, noCrit: true, ammo: 3 } },
  "I Never Miss": { uses: { max: 1, per: "mission" } },
  "Knives Specialization I": { mods: [hone(-5, { types: ["knife"] }), { stat: "critDamage", value: 1, types: ["knife"] }] },
  "Knives Specialization II": { mods: [hone(-5, { types: ["knife"] }), { stat: "critDamage", value: 1, types: ["knife"] }] },
  "Pistol/Magnum Specialization I": { mods: [{ stat: "attack", value: -5, types: PISTOLS, bands: ["short", "medium"] }] },
  "Pistol/Magnum Specialization II": { mods: [{ stat: "attack", value: -5, types: PISTOLS, bands: ["short", "medium", "long"] }] },
  "Precision Weapons Specialization I": { mods: [{ stat: "attack", value: -3, types: PRECISION, bands: ["medium", "long"] }] },
  "Precision Weapons Specialization II": { mods: [{ stat: "attack", value: -3, types: PRECISION, bands: ["short", "medium", "long"] }] },
  "Sharp Senses": { mods: [{ stat: "dodge", value: -20, situation: "Against explosives or traps" }] },
  "Cats Grace": { upgrades: { "Disabling Shot": { energy: -1 }, "Hit and Run": { energy: -1 } } },
  "Eagle Eyes": { upgrades: { "Disabling Shot": { accuracy: -10 }, "Called Shot": { accuracy: -10 } } },
  "Pound Concrete": { upgrades: { "Disabling Shot": { energy: -1 }, "Hit and Run": { energy: -1 } } },
  /* ---- Ghost ---- */
  "Ghost Stepping": { uses: { maxFrom: { attrs: ["agi"], factor: 0.5 }, per: "mission" } },
  "Horror Movie Slasher": { mods: [{ stat: "critical", value: -5, scale: { label: "Kills this mission", maxFrom: { attrs: ["agi"], factor: 0.5 } } }] },
  "Kiritsuke": { attack: { accuracy: -15, critical: -15, types: ["knife"] } },
  "Light Armor Specialist": { mods: [{ stat: "dodge", wornArmor: "light", byTier: [-5, -10, -15] }] },
  "Lunge": { attack: { types: ["knife"] } },
  "Shadowborn": { mods: [{ stat: "attack", value: -10, situation: "First attack while concealed" }, { stat: "critical", value: -10, situation: "First attack while concealed" }] },
  "Shinobi": { mods: [{ stat: "attack", value: -10, situation: "Attacking from concealment" }, { stat: "dodge", value: -10, situation: "Against an area effect" }] },
  "Shurikenjutsu": { mods: [{ stat: "penetration", value: 3, types: ["knife"], categories: ["thrown"] }] },
  "Where it Hurts": { mods: [{ stat: "critical", value: -5, types: ["knife"] }, { stat: "penetration", value: 2, types: ["knife"] }] },
  "Whetstone": { mods: [{ stat: "critDamage", value: 2, types: ["knife"], melee: true }] },
  /* ---- Gunslinger ---- */
  "Bandito": { mods: [{ stat: "penetration", value: 1, scale: { label: "Allies within 6 tiles", max: 5 } }] },
  "Fan the Hammer": { attack: { accuracy: -10, noCrit: true } },
  "Gunslingers Instincts": { mods: [{ stat: "damage", value: 2, types: PISTOLS }, { stat: "penetration", value: 2, types: PISTOLS }] },
  "I'm the Law here": { uses: { maxFrom: { attrs: ["cha"], factor: 0.5 }, per: "mission" } },
  "Lone Ranger": { mods: [{ stat: "attack", value: -10, situation: "Fewer than 2 allies within 6 tiles" }, { stat: "critical", value: -10, situation: "Fewer than 2 allies within 6 tiles" }] },
  "Speed Loader": { uses: { max: 1, per: "mission" } },
  "The Big Iron": { mods: [{ stat: "critDamage", value: 2, types: ["magnum"] }, { stat: "penetration", value: 2, types: ["magnum"] }] },
  "This world ain't big enough.": { mods: [{ stat: "attack", value: -5, types: ["pistol"], situation: "Against the foe you called out" }, { stat: "critical", value: -5, types: ["pistol"], situation: "Against the foe you called out" }] },
  /* ---- Sharpshooter ---- */
  "Boom! Headshot!": { attack: { accuracy: -10, critical: -10 } },
  "Extra Penetration": { mods: [{ stat: "penetration", value: 3, ranged: true }] },
  "High Caliber": { mods: [{ stat: "damage", value: 1, valueFrom: { attrs: ["per"], factor: 0.5 } }] },
  "Snipers Nest": { mods: [{ stat: "dodge", value: -10, situation: "In your sniper's nest" }, { stat: "critDamage", value: 2, situation: "In your sniper's nest" }] },
  "Surgeons Hands": { mods: [{ stat: "attack", value: -10, situation: "You did not move last turn" }, { stat: "critical", value: -10, situation: "You did not move last turn" }] },
  "Vital Shot": { attack: { accuracy: 10, critical: -30, byType: { sniper: 20 } } },

  /* ================= Warmachine ================= */
  /* ---- Primary ---- */
  "Area Suppression": { ammoOnly: 5 },
  // Renamed from Eat Lead (Johnald, 2026-10-18); a world not yet renamed still matches the old name.
  "Walk'em Down": { aka: ["Eat Lead"], attack: { accuracy: 10, ammo: 3 } },
  // ASSUMPTION: "your chosen Primary Role ability" is Walk'em Down, whose own text names Efficient Fire.
  "Efficient Fire": { upgrades: { "Walk'em Down": { energy: -1, ammoDelta: -1 } } },
  "Efficient Packing": { actor: { bonuses: { carry: 10 } } },
  "Get Some!": { upgrades: { "Area Suppression": { ammoDelta: -1 }, "Walk'em Down": { accuracyTo: -10 } } },
  "One Man Army": { upgrades: { "Walk'em Down": { accuracyTo: 0 }, "Area Suppression": { energy: -1 } } },
  "Heavy Armor Mastery I": { armor: { pct: { heavy: 50 } } },
  "Heavy Armor Mastery II": { armor: { drAll: { heavy: 1 } } },
  "LMG Specialist I": { mods: [{ stat: "attack", value: -3, types: ["lmg"], bands: ["medium", "long"] }, { stat: "critDamage", value: 1, types: ["lmg"] }] },
  "LMG Specialist II": { mods: [{ stat: "attack", value: -3, types: ["lmg"], bands: ["medium", "long"] }] },
  "SAW Specialist I": { mods: [{ stat: "attack", value: -3, types: ["saw"], bands: ["short", "medium"] }, { stat: "critDamage", value: 1, types: ["saw"] }] },
  "SAW Specialist II": { mods: [{ stat: "attack", value: -5, types: ["saw"], bands: ["short", "medium"] }] },
  // ASSUMPTION: "1/2/3 depending on the tech level" is by the weapon's Tier: 1 at Tiers 1 and 2, 2 at 3 and 4, 3 at 5.
  "Shredder": { mods: [{ stat: "shred", types: ["lmg", "saw"], byWeaponTier: [1, 1, 2, 2, 3] }] },
  "Strongest Avenger": { actor: { attributes: { str: 5, tgh: 5 } } },
  "Sweeping Fire": { attack: { ammo: 4 } },
  /* ---- Guardian ---- */
  "Heavy Armor Paragon": { armor: { drByTier: { heavy: [1, 2, 3] } } },
  "Iron Jaw": { uses: { max: 2, per: "mission" } },
  "Point Break": { attack: {} },
  /* ---- Rocketeer ---- */
  "Fragmentation": { mods: [{ stat: "shred", value: 2, types: ROCKETS }] },
  "Javelin Rockets": { mods: [{ stat: "attack", value: -10, types: ROCKETS }] },
  "Kaboom": { mods: [{ stat: "critDamage", value: 2, types: ROCKETS }] },
  "Nuclear Option": { attack: { blast: 2, damagePct: 50, types: ROCKETS } },
  "Warheads": { mods: [{ stat: "damage", value: 1, types: ROCKETS, valueFrom: { attrs: ["per"], factor: 0.5 } }] },

  /* ================= Vanguard ================= */
  /* ---- Primary ---- */
  "Charge": { attack: { melee: true } },
  "Cross Strike": { attack: { accuracy: -10, critical: -10 } },
  "Flow of Battle": { mods: [{ stat: "dodge", value: -10, situation: WITHIN_4 }] },
  "Inescapable Strikes": { mods: [{ stat: "enemyDodge", value: 5, melee: true }] },
  "Master at Arms": { mods: [{ stat: "dodge", value: -10, situation: VS_MELEE }] },
  "One Handed Melee Specialist I": { mods: [hone(-5, { classes: ["oneHanded"], melee: true }), { stat: "damage", value: 1, classes: ["oneHanded"], melee: true }] },
  "One Handed Melee Specialist II": { mods: [hone(-5, { classes: ["oneHanded"], melee: true }), { stat: "damage", value: 2, classes: ["oneHanded"], melee: true }] },
  "Power Attack": { attack: { accuracy: 15, damagePct: 50 } },
  "Two Handed Melee Specialist I": { mods: [hone(-5, { classes: ["twoHanded"], melee: true }), { stat: "damage", value: 1, classes: ["twoHanded"], melee: true }] },
  "Two Handed Melee Specialist II": { mods: [hone(-5, { classes: ["twoHanded"], melee: true }), { stat: "damage", value: 2, classes: ["twoHanded"], melee: true }] },
  "Warrior Species": { upgrades: { "Bladestorm": { energy: -1 } } },
  "Within Deaths Reach": { upgrades: { "Cross Strike": { accuracy: -5, critical: -5 } } },
  /* ---- Duelist ---- */
  "Capo Ferro": { mods: [{ stat: "attack", value: -1, valueFrom: { attrs: ["per", "agi"] }, situation: IN_A_DUEL }] },
  "En Garde": { mods: [{ stat: "dodge", value: -10, situation: VS_MELEE }] },
  "Feint": { attack: {} },
  "Fell Deeds Awake": { attack: { noDefense: true } },
  "Fencer": { mods: [{ stat: "attack", value: -15, classes: ["oneHanded"], melee: true, situation: ONE_HAND_FREE }, { stat: "critical", value: -15, classes: ["oneHanded"], melee: true, situation: ONE_HAND_FREE }] },
  "Got an Eye for this": { actor: { critical: ["per"] } },
  "Piercing Offence": { mods: [{ stat: "penetration", value: 1, valueFrom: { attrs: ["per", "agi"], factor: 0.5 }, situation: IN_A_DUEL }] },
  "Strong Blows": { mods: [{ stat: "damage", value: 2, classes: ["oneHanded"], melee: true }] },
  "Swashbuckler": { mods: [{ stat: "damage", value: 1, valueFrom: { attrs: ["cha"] }, classes: ["oneHanded"], melee: true, situation: `${IN_A_DUEL}, other hand free` }] },
  /* ---- Frontbreaker ---- */
  "Honed Edge": { mods: [hone(-5, { melee: true })] },
  "Oceans of Xeno Blood": { mods: [{ stat: "damage", value: 1, valueFrom: { attrs: ["str"], factor: 0.5 }, situation: "Against your chosen alien species" }] },
  "Whirlwind Strike": { attack: { melee: true } },
  /* ---- Knight ---- */
  "Open them Up": { attack: {} }
};

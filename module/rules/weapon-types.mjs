/**
 * Weapon types (Johnald, 2026-10-18): what a weapon is, finer than its class, because the role
 * perks name them: an SMG perk is not a pistol perk, though both are Small Arms. Blank is untyped.
 * Kept apart from Foundry so it can be tested.
 */
export const WEAPON_TYPES = {
  "": "Untyped",
  pistol: "Pistol",
  magnum: "Magnum",
  smg: "SMG",
  rifle: "Assault Rifle",
  saw: "SAW",
  lmg: "LMG",
  dmr: "DMR",
  sniper: "Sniper Rifle",
  shotgun: "Shotgun",
  knife: "Knife",
  axe: "Axe",
  sword: "Sword",
  spear: "Spear",
  hammer: "Hammer",
  mace: "Mace",
  shield: "Shield",
  natural: "Natural weapon",
  grenadeLauncher: "Grenade Launcher",
  rocketLauncher: "Rocket Launcher",
  grenade: "Grenade",
  rocket: "Rocket",
  explosive: "Explosive",
  chemthrower: "Chemthrower",
  turret: "Turret"
};

/** Name patterns, most specific first: the first that matches a weapon's name gives its type. */
const BY_NAME = [
  [/grenade launcher|\bgl\b/i, "grenadeLauncher"],
  [/rocket launcher|\blaw\b|launcher/i, "rocketLauncher"],
  [/chem ?thrower|flame ?thrower|cryo ?thrower/i, "chemthrower"],
  [/turret/i, "turret"],
  [/sniper|anti[- ]materiel/i, "sniper"],
  [/\bdmr\b|marksman/i, "dmr"],
  [/\bsaw\b|squad automatic/i, "saw"],
  [/\blmg\b|light machine|machine ?gun|minigun|chaingun/i, "lmg"],
  [/\bsmg\b|sub ?machine|machine pistol|\bpdw\b/i, "smg"],
  [/shotgun|sawn[- ]?off|scattergun/i, "shotgun"],
  [/magnum|revolver|hand ?cannon/i, "magnum"],
  [/pistol|sidearm/i, "pistol"],
  [/assault rifle|battle rifle|carbine|\brifle\b|\bar\b/i, "rifle"],
  [/knife|dagger|kiritsuke|shiv|bayonet/i, "knife"],
  [/axe|hatchet|tomahawk/i, "axe"],
  [/sword|blade|katana|rapier|claymore|sabre|saber|machete/i, "sword"],
  [/spear|pike|halberd|glaive/i, "spear"],
  [/hammer|maul/i, "hammer"],
  [/mace|club|baton/i, "mace"],
  [/shield/i, "shield"],
  [/grenade|flashbang|frag\b|smoke/i, "grenade"],
  [/rocket|\brpg\b|missile/i, "rocket"],
  [/c4|charge|mine|explosive|satchel/i, "explosive"]
];

/** By class, when the name says nothing. */
const BY_CLASS = { natural: "natural", chemthrower: "chemthrower", grenade: "grenade", rocket: "rocket", explosive: "explosive" };

/** A best guess at a weapon's type from its name, then its class; "" when neither says. */
export function guessWeaponType(name, weaponClass = "") {
  for ( const [rx, type] of BY_NAME ) if ( rx.test(String(name ?? "")) ) return type;
  return BY_CLASS[weaponClass] ?? "";
}

/**
 * A weapon's type as the perks read it (bug, Johnald, 2026-10-18: the Warmachine's perks did nothing):
 * its Type when set, else the guess from its name and class, so a weapon nobody has typed still counts.
 */
export function weaponTypeOf(weapon) {
  const s = weapon?.system ?? {};
  return s.weaponType || guessWeaponType(weapon?.name, s.weaponClass);
}

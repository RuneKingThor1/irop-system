/**
 * Weapon types (Johnald, 2026-10-18): the role perks need to know an SMG from a Pistol. Run once as
 * the GM, as a script macro: it guesses each weapon's Type from its name (then its class), on the
 * Items sidebar's weapons, the ones characters and NPCs carry, and those on store shelves. It only
 * fills in weapons with no Type yet, so a Type set by hand is never changed; run it again after adding
 * weapons. It whispers a list of what it set, and of what it could not guess, to set by hand on the
 * weapon's Details tab.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
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
  const guess = w => {
    for ( const [rx, type] of BY_NAME ) if ( rx.test(w.name) ) return type;
    return BY_CLASS[w.system.weaponClass] ?? "";
  };
  const label = t => CONFIG.IROP?.weaponTypes?.[t] ?? t;
  const set = [];
  const unknown = [];
  const fix = async (w, where) => {
    if ( (w.type !== "weapon") || w.system.weaponType ) return;
    const type = guess(w);
    if ( !type ) { unknown.push(`${where}: ${w.name}`); return; }
    await w.update({ "system.weaponType": type });
    set.push(`${where}: ${w.name} is a ${label(type)}`);
  };
  for ( const w of game.items ) await fix(w, "Items");
  for ( const actor of game.actors ) for ( const w of actor.items ) await fix(w, actor.name);
  const list = rows => `<ul>${rows.map(r => `<li>${foundry.utils.escapeHTML(r)}</li>`).join("")}</ul>`;
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Weapon types" },
    content: `<div class="irop-card"><header class="card-head"><h3>Weapon types</h3><span class="card-sub">${set.length} set, ${unknown.length} to set by hand</span></header>
      ${set.length ? `<p>Set:</p>${list(set)}` : "<p>Every weapon already has a Type.</p>"}
      ${unknown.length ? `<p>Could not tell from the name; set these on the weapon's Details tab:</p>${list(unknown)}` : ""}</div>`
  });
  ui.notifications.info(`Weapon types: ${set.length} set, ${unknown.length} to set by hand.`);
})();

import { IROP } from "./config.mjs";
import { DICE, DICE_ORDER, DIFFICULTY, BANK_CAP } from "./rules/dynosrs.mjs";
import { rangesWithMods } from "./rules/mods.mjs";
import { weaponTypeOf } from "./rules/weapon-types.mjs";
import { perkOptions, perkResult, perkRule, perkUses, abilityAsUpgraded, perkBlast, attackAccuracy, chemPerks, dieUp, weaponPerkSummary, gearCharges, requiredAbility } from "./rules/perks.mjs";
import { perkKey } from "./rules/skill-trees.mjs";
import { powerAccuracy, powerSaveDm, needsConcentration, trackText, powerTotals } from "./rules/paraphysics.mjs";
import { isFocus } from "./rules/concealment.mjs";
import { COVER, MODIFIERS, ENGAGED_BY_HANDLING, SCATTER, collectModifiers } from "./rules/combat.mjs";
import { DynosrsRoll } from "./dice/dynosrs-roll.mjs";
import { D100Roll, DamageRoll } from "./dice/d100-roll.mjs";
import { adjustGmBanks, getSquad, setSquad } from "./settings.mjs";
import { placeBlast, removeBlast, scatterBlast } from "./canvas/blast.mjs";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;
const TEMPLATES = "systems/irop/templates/dialog";

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

function speakerFor(actor) {
  return ChatMessage.implementation.getSpeaker({ actor });
}

/** Who sees a roll: Foundry's message modes, and the one this user last picked. */
export function messageModeChoices() {
  const entries = CONFIG.ChatMessage.modes;
  let current;
  try { current = game.settings.get("core", "messageMode"); }
  catch { current = Object.keys(entries)[0]; }
  const options = Object.entries(entries).map(([value, v]) => ({
    value, label: game.i18n.localize(typeof v === "string" ? v : (v.label ?? value))
  }));
  return { options, current };
}

/** Options for Roll#toMessage that apply a chosen message mode. */
export function messageOptions(mode) {
  return mode ? { messageMode: mode } : {};
}

/**
 * Show a form dialog and return its data, or null if dismissed.
 * @param {string} title
 * @param {string} template
 * @param {object} data
 * @param {Function} [render]   called with the dialog's root element after render
 */
async function formDialog(title, template, data, render) {
  const modes = messageModeChoices();
  const content = await renderTemplate(`${TEMPLATES}/${template}`, {
    ...data, modes: modes.options, mode: modes.current
  });
  return DialogV2.input({
    window: { title },
    classes: ["irop", "irop-roll-dialog"],
    position: { width: 460 },
    content,
    ok: { label: "Roll", icon: "fa-solid fa-dice" },
    render: render ? (event, dialog) => render(dialog.element) : undefined
  });
}

/** Evaluate a roll and post it, with the visibility chosen in the dialog. */
async function toChat(roll, actor, mode, flavor) {
  await roll.evaluate();
  return roll.toMessage({ speaker: speakerFor(actor), flavor }, messageOptions(mode));
}

/** Status ids the actor currently carries. */
function statusesOf(actor) {
  return actor?.statuses ?? new Set();
}

/**
 * Area weapons need no target (RULED 2026-10-08): grenades, rockets and explosives,
 * the launchers, and the chemthrowers.
 */
export function isAreaWeapon(item) {
  if ( item?.type !== "weapon" ) return false;
  const s = item.system;
  return ["grenade", "rocket", "explosive", "launcher", "chemthrower"].includes(s.weaponClass)
    || ["thrown", "explosive"].includes(s.category);
}

/**
 * The special ammunition loaded in a weapon, as plain data for an attack, or
 * null. RULED 2026-10-08 (Johnald): its effects apply only while it is loaded.
 */
export function specialAmmoOf(item) {
  const loaded = (item?.type === "weapon") ? item.system.specialAmmo : null;
  if ( !loaded ) return null;
  return { id: loaded.id, name: loaded.name, ...loaded.system.ammo };
}

/**
 * The one token targeted for an attack, with its Defense. RULED 2026-10-07: an
 * attack needs exactly one target, so the Defense can go on the roll unasked.
 * A token with no actor, or no armor, has a Defense of 0.
 *
 * RULED 2026-10-08: area weapons (grenades, launchers, chemthrowers) need no
 * target. For them, `optional` lets the attack go ahead with none (aimed at an
 * area) or several (all in the blast); one target still brings its Defense.
 * @param {Iterable<Token>} [targets]    Defaults to the user's targets
 * @param {object} [options]
 * @param {boolean} [options.optional]   An area weapon: no target is fine
 * @returns {{name?: string|null, uuid?: string|null, defense?: number, warning?: string, area?: boolean}}
 */
export function attackTarget(targets = game.user.targets, { optional = false } = {}) {
  const list = Array.from(targets ?? []);
  if ( optional && (list.length !== 1) ) {
    return { name: list.length ? list.map(t => t.name ?? t.actor?.name).join(", ") : null, uuid: null, defense: 0, area: true };
  }
  if ( !list.length ) return { warning: "Target an enemy first: hover over its token and press T." };
  if ( list.length > 1 ) return { warning: "Target one enemy at a time: each attack is rolled against a single target." };
  const token = list[0];
  const actor = token.actor;
  return {
    name: token.name ?? actor?.name ?? "Target",
    uuid: actor?.uuid ?? token.document?.uuid ?? null,
    defense: Number(actor?.system?.defense) || 0
  };
}

/* -------------------------------------------- */
/*  d100 checks                                 */
/* -------------------------------------------- */

/**
 * A plain attribute check: d100, situational D.M., meet or roll under.
 * @param {Actor} actor
 * @param {string} key   attribute key
 */
export async function rollAttributeCheck(actor, key) {
  const attr = actor.system.attributes[key];
  const data = await formDialog(`${attr.label} check`, "check.hbs", {
    targetLabel: `${attr.label} ${attr.value}`
  });
  if ( !data ) return null;
  const modifiers = collectModifiers({ extra: Number(data.dm) || 0 });
  const roll = D100Roll.create({
    kind: "check", label: `${attr.label} check`, target: attr.value, targetLabel: `${attr.abbr} ${attr.value}`,
    modifiers, actorUuid: actor.uuid
  });
  return toChat(roll, actor, data.mode);
}

/**
 * Dodge: d100 against Agility (LIVE: the dodge roll was made against Agility),
 * with the cover table's Dodge column. Unaware forces the open-cover reading.
 */
export async function rollDodge(actor) {
  const s = actor.system;
  const agi = s.attributes.agi;
  // No dodge with none left this round (bug, Johnald, 2026-10-10: dodges were rolled from an
  // empty pool). They come back at the start of the round, or with Reset dodges.
  const noneLeft = () => {
    if ( (Number(actor.system.vitals?.dodges?.value) || 0) > 0 ) return false;
    ui.notifications.warn(`${actor.name} has no dodges left this round.`);
    return true;
  };
  if ( noneLeft() ) return null;
  const statuses = statusesOf(actor);
  // Role perks on their own dodges (Watch my Six), and the attacker's on this one (Effective Fire).
  const perks = perkOptions((actor.items?.filter?.(i => i.type === "ability") ?? []), { roll: "dodge", ...perkContext(actor) });
  const against = lastAttackOn(actor);
  if ( against?.lines.length ) {
    perks.situations.unshift({ key: "against", label: `Against ${against.from}`, checked: true,
      mods: against.lines.map(l => ({ stat: "dodge", value: l.value, from: l.label })), text: against.lines.map(l => `${l.label} ${signed(l.value)}`).join("; ") });
    perks.any = true;
  }
  const data = await formDialog("Dodge", "dodge.hbs", {
    perks,
    targetLabel: `Agility ${agi.value}`,
    covers: Object.entries(COVER).map(([k, c]) => ({ key: k, label: `${c.name} (${signed(c.dodge)})`, checked: k === "none" })),
    disorientated: statuses.has("disorientated"),
    dodgesLeft: s.vitals.dodges.value,
    dodgesMax: s.vitals.dodges.max
  });
  if ( !data ) return null;
  // Spent elsewhere while the window was open.
  if ( noneLeft() ) return null;
  const keys = [];
  if ( data.unaware ) keys.push("unaware");
  if ( data.disorientated ) keys.push("disorientated");
  const modifiers = collectModifiers({ keys, cover: data.cover, role: "dodge", extra: Number(data.dm) || 0 });
  const pick = (group, key) => data[`${group}.${key}`] ?? data[group]?.[key];
  modifiers.push(...perkResult(perks, {
    ticked: perks.situations.filter(t => pick("perk", t.key)).map(t => t.key),
    counts: Object.fromEntries(perks.scales.map(t => [t.key, Number(pick("perkCount", t.key)) || 0]))
  }).dodge);
  const roll = D100Roll.create({
    kind: "dodge", label: "Dodge", target: agi.value, targetLabel: `AGI ${agi.value}`, modifiers, actorUuid: actor.uuid
  });
  const msg = await toChat(roll, actor, data.mode);
  const left = Number(actor.system.vitals.dodges.value) || 0;
  if ( left > 0 ) await actor.update({ "system.vitals.dodges.value": left - 1 });
  return msg;
}

function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

/* -------------------------------------------- */
/*  Attacks                                     */
/* -------------------------------------------- */

/**
 * The attack profile of a weapon or a paraphysical ability, in one shape.
 * @param {Item} item
 */
export function attackProfile(item, { projectile = 0 } = {}) {
  const s = item.system;
  if ( item.type === "weapon" ) {
    const attribute = s.attackAttribute;
    const special = specialAmmoOf(item);
    // A launcher fires one loaded grenade or rocket: the launcher aims, the projectile
    // brings the damage and blast (RULED 2026-10-08).
    const shot = s.projectileSlots ? (s.loaded[projectile] ?? null) : null;
    const source = shot ? shot.system : s;
    const formula = source.damage?.formula;
    const hasDamage = !!formula && (String(formula).trim() !== "0");
    const damage = hasDamage ? {
      formula, type: source.damage.type, critDamage: source.critical?.damage ?? 0,
      shred: source.shred ?? 0, penetration: source.penetration ?? 0, destruction: source.destruction ?? 0,
      blast: source.blast ?? 0, drBypass: 0
    } : null;
    // Loaded special ammo changes the damage (RULED 2026-10-08): its type replaces the
    // weapon's, its bonus adds on, and its armor effects stack with the weapon's.
    if ( damage && special ) {
      if ( special.damageType ) damage.type = special.damageType;
      if ( special.damageBonus ) damage.formula = `${damage.formula} + ${special.damageBonus}`;
      damage.shred += special.shred;
      damage.penetration += special.penetration;
      damage.drBypass = special.drBypass;
      if ( special.status ) damage.status = { id: special.status, value: special.statusValue, ammo: special.name };
    }
    return {
      kind: "weapon",
      category: s.category,
      attribute,
      accuracy: s.accuracy,
      handling: s.handling,
      ranged: s.category === "ranged",
      thrown: s.category === "thrown",
      paraphysical: false,
      // The bands with the fitted mods' D.M. added: a Reflex Sight is -5 at Medium (2026-10-17).
      ranges: s.category === "ranged" ? rangesWithMods(s.range, fittedMods(item)) : null,
      critChance: s.critical.chance,
      damage,
      ammo: special,
      projectile: s.projectileSlots ? (shot ? { index: projectile, name: shot.name, img: shot.img,
        description: shot.system.description ?? "", hasDamage } : null) : undefined,
      scatter: s.weaponClass === "launcher" ? "launched" : (s.category === "thrown" ? "thrown" : null),
      // The blast radius in tiles, the launched projectile's for a launcher (blast markers, 2026-10-09).
      blast: Math.max(0, Number(source.blast) || 0),
      template: source.template ?? "circle"
    };
  }
  if ( (item.type === "ability") && s.paraphysics.attack ) {
    const p = s.paraphysics;
    // What its ranks, choice and evolution add (2026-10-19): damage parts, a new damage type, an area.
    const t = powerTotals(p);
    const formula = [p.damage.formula, ...t.damage].filter(f => String(f ?? "").trim()).join(" + ");
    const area = (Number(s.area) || 0) + t.area;
    return {
      kind: "paraphysics",
      category: "paraphysics",
      // The species' casting attribute: Charisma, Intelligence for a Reticulon (2026-10-19).
      attribute: item.actor?.system?.casting?.attribute ?? "cha",
      accuracy: p.accuracy,
      handling: "light",
      ranged: true,
      thrown: false,
      paraphysical: true,
      ranges: null,
      critChance: 0,
      damage: formula ? { formula, type: t.damageType || p.damage.type, critDamage: 0, shred: 0, penetration: 0 } : null,
      scatter: null,
      blast: area,
      template: "circle"
    };
  }
  return null;
}

/**
 * Attack with a weapon or a paraphysical ability.
 * HANDOFF: ranged against Perception, melee against Strength, paraphysics
 * against Charisma; accuracy, cover, range and battlefield modifiers are D.M.s
 * on the roll.
 */
/**
 * What the perk engine reads off a character (2026-10-18): its attribute mods, its worn armor and the
 * weapon types in its hands.
 */
export function perkContext(actor) {
  const items = actor?.items?.filter?.(() => true) ?? [];
  return {
    attributes: Object.fromEntries(Object.entries(actor?.system?.attributes ?? {}).map(([k, a]) => [k, Number(a.mod) || 0])),
    gear: {
      armor: items.filter(i => (i.type === "armor") && i.system.equipped && !i.system.stowed).map(i => ({ armorClass: i.system.armorClass, tier: i.system.tier })),
      equipped: items.filter(i => (i.type === "weapon") && i.system.equipped && !i.system.stowed).map(i => i.system.weaponType)
    }
  };
}

/**
 * What a power brings to its attack roll (Paraphysics Framework Draft 0.6, 2026-10-19): its rank's
 * Accuracy, a focus (-20 under the shared -25 ceiling, if one is carried) and the In Optimal Range
 * bonus, twice the casting modifier. The Out of Optimal Range penalty is not set yet.
 */
export function powerAttack(actor, item) {
  const p = item.system.paraphysics;
  const hasFocus = !!actor?.items?.some?.(i => isFocus(i) && !i.system.stowed);
  const mod = actor?.system?.casting?.mod ?? actor?.system?.attributes?.cha?.mod ?? 0;
  const track = powerAccuracy(p).track;
  const focusValue = powerAccuracy(p, { focus: true }).focus;
  const optimal = -(IROP.paraphysics.optimalRangeTimes * mod);
  return {
    rank: p.rank, track, trackText: signed(track), hasFocus, focusValue, focusText: signed(focusValue),
    optimal, optimalText: signed(optimal), range: (Number(item.system.range) || 0) + powerTotals(p).range,
    concentration: needsConcentration(p)
  };
}

export async function rollAttack(actor, item, { projectile = 0, ability = null, abilityAttack = null } = {}) {
  // A fuel weapon burns instead of rolling to hit (RULED 2026-10-08).
  if ( (item.type === "weapon") && (item.system.feed === "fuel") ) return rollBurn(actor, item);
  const profile = attackProfile(item, { projectile });
  if ( !profile ) return ui.notifications.warn(`${item.name} has no attack.`);
  if ( profile.projectile === null ) {
    const noun = IROP.weaponFeeds[item.system.feed]?.noun ?? "round";
    return ui.notifications.warn(`${item.name} has no ${noun} loaded. Load one in its slots first.`);
  }
  if ( !profile.attribute ) return useExplosive(actor, item);

  const s = item.system;
  if ( (item.type === "weapon") && (s.feed === "singleUse") && (s.quantity <= 0) ) {
    return ui.notifications.warn(`${actor.name} has no ${item.name} left.`);
  }
  if ( (item.type === "weapon") && s.usesAmmo && (s.ammo.value <= 0) ) {
    return ui.notifications.warn(`${item.name} is empty. Reload first.`);
  }
  if ( (item.type === "weapon") && (s.weaponClass === "grenade") && (s.quantity <= 0) ) {
    return ui.notifications.warn(`${actor.name} has no ${item.name} left.`);
  }

  // RULED 2026-10-07: an attack is made against one targeted token, and the
  // target's Defense (its worn armor's Armor Bonus) goes onto the roll by itself.
  // Area weapons need no target (2026-10-08).
  const target = attackTarget(undefined, { optional: isAreaWeapon(item) });
  if ( target.warning ) return ui.notifications.warn(target.warning);

  const label = profile.projectile ? `${item.name}: ${profile.projectile.name}` : item.name;

  // Blast markers (Johnald, 2026-10-09): anything with a blast radius is set down on the map
  // first, before the attack window. Backing out of it calls the attack off.
  // Perks that widen it (Blast Radius, Nuclear Option), before it is set down (2026-10-18).
  const blastRadius = profile.blast ? (profile.blast + ((item.type === "weapon") ? perkBlast((actor.items?.filter?.(i => i.type === "ability") ?? []), { name: item.name, system: item.system }) : 0)
    + (Number(abilityAttack?.blast) || 0)) : 0;
  if ( profile.blast ) profile.blast = blastRadius;
  const marker = profile.blast ? await placeBlast({ name: label, radius: profile.blast, template: profile.template, actor, item }) : undefined;
  if ( marker === null ) return null;

  const attr = actor.system.attributes[profile.attribute];
  const statuses = statusesOf(actor);
  const engagedKey = ENGAGED_BY_HANDLING[profile.handling] ?? "engaged";

  const toggles = [
    { key: "high_ground", hint: "Target below you" },
    { key: "low_ground", hint: "Target above you" },
    { key: "smoke_fog", hint: "Shooting into or through smoke" },
    { key: "unaware", hint: "The target has not seen you" },
    { key: "exposed", hint: "Flanked or ambushed: easier to crit, not to hit" }
  ];
  if ( profile.ranged || profile.thrown ) toggles.push({ key: engagedKey, hint: "You are engaged in melee" });
  if ( !profile.paraphysical ) toggles.push({ key: "suppressed", hint: "You are suppressed", checked: statuses.has("suppressed") });
  toggles.push({ key: "disorientated", hint: "You are disorientated", checked: statuses.has("disorientated") });

  for ( const t of toggles ) {
    const m = MODIFIERS[t.key];
    const v = m.values.accuracy ?? m.values.critical ?? 0;
    t.label = m.name;
    t.value = t.key === "exposed" ? `${signed(v)} crit` : signed(v);
  }

  const ranges = profile.ranges ? Object.entries(IROP.rangeBands).map(([k, label]) => ({
    key: k, label: `${label}${profile.ranges[k].tiles ? `, ${profile.ranges[k].tiles} tiles` : ""} (${signed(profile.ranges[k].dm)}${profile.ranges[k].mods?.length ? `, with ${profile.ranges[k].mods.map(m => m.name).join(" and ")}` : ""})`,
    checked: k === "short"
  })) : null;

  // Role perks (2026-10-18): what applies to this weapon, tick boxes for what the system cannot see.
  const abilities = (actor.items?.filter?.(i => i.type === "ability") ?? []);
  const targetActor = target.uuid ? foundry.utils.fromUuidSync(target.uuid) : null;
  const hp = targetActor?.system?.vitals?.hp;
  const perks = (item.type === "weapon")
    ? perkOptions(abilities, { roll: "attack", weapon: { name: item.name, system: s, special: !!profile.ammo }, targetHpPct: hp?.max ? (hp.value / hp.max) * 100 : null, ...perkContext(actor) })
    : { auto: [], situations: [], scales: [], any: false };
  // An attack made through an active (Chained Shot, Pour it On!), with its numbers as upgraded; Vital
  // Shot's accuracy is its own with a sniper rifle.
  const throughAccuracy = abilityAttack ? attackAccuracy(abilityAttack, weaponTypeOf(item)) : 0;
  const through = abilityAttack ? { name: ability?.name ?? "", ...abilityAttack, accuracy: throughAccuracy,
    accuracyText: throughAccuracy ? signed(throughAccuracy) : "" } : null;
  if ( through && (item.type === "weapon") && s.usesAmmo && (s.ammo.value < (through.ammo ?? 1)) ) {
    await removeBlast(marker);
    return ui.notifications.warn(`${through.name} needs ${through.ammo} ammo; ${item.name} has ${s.ammo.value}.`);
  }

  const power = profile.paraphysical ? powerAttack(actor, item) : null;
  const data = await formDialog(`Attack: ${through ? `${through.name}, ` : ""}${label}`, "attack.hbs", {
    perks, through, power,
    itemName: label,
    img: item.img,
    targetLabel: `${attr.label} ${attr.value}`,
    accuracy: profile.accuracy,
    accuracyText: signed(-profile.accuracy),
    ammo: (item.type === "weapon") && s.usesAmmo ? `${s.ammo.value} / ${s.ammo.max}` : null,
    covers: Object.entries(COVER).map(([k, c]) => ({ key: k, label: c.name, value: signed(c.accuracy), checked: k === "none" })),
    ranges,
    toggles,
    target: { name: target.name, defense: target.defense, defenseText: signed(target.defense),
      ignoredBy: profile.ammo?.ignoreDefense ? profile.ammo.name : null, single: !!target.uuid },
    ammoName: profile.ammo?.name ?? null
  });
  if ( !data ) {
    await removeBlast(marker);
    return null;
  }

  const keys = toggles.map(t => t.key).filter(k => data[`mod.${k}`] ?? data.mod?.[k]);
  const band = ranges ? (data.range || "short") : null;
  const modifiers = collectModifiers({
    keys: keys.filter(k => k !== "exposed"),
    cover: data.cover,
    role: "accuracy",
    range: band ? profile.ranges[band].dm : null,
    rangeLabel: band ? `${IROP.rangeBands[band]} range` : "Range",
    accuracy: -profile.accuracy,
    extra: Number(data.dm) || 0,
    // On unless the attacker unticks it, for an attack that ignores armor (or made through one that does).
    defense: (target.uuid && !abilityAttack?.noDefense && (data.defense ?? !profile.ammo?.ignoreDefense)) ? target.defense : 0,
    defenseLabel: `${target.name}'s Defense`
  });
  // Special ammo's accuracy D.M., on its own labelled line.
  if ( profile.ammo?.accuracy ) modifiers.push({ label: profile.ammo.name, value: profile.ammo.accuracy });
  // The perks chosen, and the active it was made through.
  const pick = (group, key) => data[`${group}.${key}`] ?? data[group]?.[key];
  // A power's own lines (2026-10-19): its rank, the focus, optimal range. Its damage skips the Armor
  // HP pool: barrier first, then HP (Framework PSI-07).
  if ( power ) {
    if ( power.track ) modifiers.push({ label: `${item.name} rank ${power.rank}`, value: power.track });
    if ( power.focusValue && pick("psi", "focus") ) modifiers.push({ label: "Paraphysical focus", value: power.focusValue });
    if ( power.optimal && pick("psi", "optimal") ) modifiers.push({ label: "In optimal range", value: power.optimal });
  }
  const perk = perkResult(perks, {
    band, melee: s.category === "melee",
    ticked: perks.situations.filter(t => pick("perk", t.key)).map(t => t.key),
    counts: Object.fromEntries(perks.scales.map(t => [t.key, Number(pick("perkCount", t.key)) || 0]))
  });
  modifiers.push(...perk.attack);
  if ( power ) perk.notes.push("Paraphysical: skips Armor HP; barrier first, then HP");
  if ( through?.accuracy ) modifiers.push({ label: through.name, value: through.accuracy });
  if ( through?.autoHit ) modifiers.push({ label: `${through.name}: cannot miss`, value: -200 });
  if ( through?.critical ) perk.critical.push({ label: through.name, value: through.critical });
  perk.noCrit = !!through?.noCrit;
  perk.through = through?.name ?? "";
  // The active's own damage: Furious Assault's crit damage, Power Attack's +50%, Disabling Shot's half.
  if ( through?.critDamage ) { perk.critDamage += through.critDamage; perk.notes.push(`${through.name} +${through.critDamage} critical damage`); }
  if ( through?.damagePct ) { perk.damagePct += through.damagePct; perk.notes.push(`${through.name} ${signed(through.damagePct)}% damage`); }
  perk.half = !!through?.halfDamage;
  if ( perk.half ) perk.notes.push(`${through.name}: half damage`);
  // Fell Deeds Awake: no Defense on the roll, no DR from armor on the hit.
  if ( through?.noDefense ) { perk.drBypass += 99; perk.notes.push(`${through.name}: no armor DR`); }

  const attack = {
    actorUuid: actor.uuid,
    targetUuid: target.uuid,
    targetName: target.name,
    ammo: profile.ammo ? { name: profile.ammo.name, critical: profile.ammo.critical } : null,
    itemUuid: item.uuid,
    itemName: label,
    cover: data.cover,
    exposed: keys.includes("exposed"),
    critChance: profile.critChance,
    damage: profile.damage,
    // What the perks add to the critical and the damage, and what they do to the target's dodge (2026-10-18).
    perk,
    scatter: profile.scatter,
    // Where the blast was set down, for Scatter to move.
    blast: marker ? { uuid: marker.uuid, radius: profile.blast } : null
  };

  const roll = D100Roll.create({
    kind: "attack",
    label,
    subtitle: `${profile.paraphysical ? "Paraphysics" : IROP.weaponCategories[profile.category]?.label ?? ""} attack${target.name ? ` on ${target.name}` : ""}${profile.ammo ? `, ${profile.ammo.name}` : ""}`,
    target: attr.value,
    targetLabel: `${attr.abbr} ${attr.value}`,
    modifiers,
    actorUuid: actor.uuid,
    attack
  });
  const msg = await toChat(roll, actor, data.mode);

  // Spend what the attack used: an active may spend more ammo than one (Pour it On! takes 3).
  if ( item.type === "weapon" ) {
    if ( s.usesAmmo ) await item.update({ "system.ammo.value": Math.max(0, s.ammo.value - Math.max(1, through?.ammo ?? 1)) });
    if ( s.weaponClass === "grenade" ) await spendOne(item);
    // A LAW is launched and tossed away; the last one is gone (RULED 2026-10-08).
    if ( s.feed === "singleUse" ) {
      if ( s.quantity > 1 ) await item.update({ "system.quantity": s.quantity - 1 });
      else await item.delete();
    }
    // A launched grenade or rocket leaves its slot. One with no damage (smoke, a
    // flashbang) posts what it does instead.
    if ( profile.projectile ) {
      const loaded = s.loaded.filter((_, i) => i !== profile.projectile.index);
      await item.update({ "system.loaded": loaded });
      if ( !profile.projectile.hasDamage ) await postProjectileCard(actor, item, profile.projectile);
    }
  }
  return msg;
}

/** A launched grenade or rocket that does no damage: post what it is and does. */
async function postProjectileCard(actor, launcher, projectile) {
  const description = await foundry.applications.ux.TextEditor.implementation.enrichHTML(projectile.description ?? "",
    { rollData: actor?.getRollData() });
  const content = `<div class="irop-card"><header class="card-head with-img"><img src="${projectile.img}" alt="">
    <h3>${projectile.name}</h3><span class="card-sub">Launched from ${launcher.name}</span></header>
    <div class="card-description">${description}</div></div>`;
  return ChatMessage.implementation.create({ speaker: speakerFor(actor), content });
}

/**
 * Add damage dice to a formula's first dice term: "2d4 + 2" with two more reads
 * "4d4 + 2". A chemthrower adds one die for every burn past the first.
 */
export function addDice(formula, extra) {
  if ( !extra ) return formula;
  return String(formula).replace(/(\d*)d(\d+)/i, (m, count, faces) => `${(Number(count) || 1) + extra}d${faces}`);
}

/**
 * A chemthrower attack (RULED 2026-10-08, from the Flame Chemthrower's text). The
 * wielder picks how many burns to spend, each costing fuel and each past the first
 * adding a damage die. There is no attack roll: damage is rolled now, and the
 * target makes a save, adjusted by the range band. A failure takes it all and the
 * status; a success takes half and no status.
 */
export async function rollBurn(actor, item) {
  const s = item.system;
  // Liquidator perks (2026-10-18): cheaper burns, a bigger die, a stronger status, a harder save, DR bypassed.
  const chem = chemPerks((actor.items?.filter?.(i => i.type === "ability") ?? []), s.damage.type);
  const fuel = { ...s.fuel, cost: Math.max(1, (Number(s.fuel.cost) || 1) + chem.fuelCost) };
  const baseFormula = dieUp(s.damage.formula, chem.dieUp);
  const affordable = Math.min(fuel.maxBurns, Math.floor(fuel.value / fuel.cost));
  if ( affordable < 1 ) return ui.notifications.warn(`${item.name} is out of fuel. Refuel it first.`);
  if ( !s.damage.formula ) return ui.notifications.warn(`${item.name} has no damage formula.`);
  // No target needed (2026-10-08); the save can be rolled for whoever is targeted later.
  const target = attackTarget(undefined, { optional: true });

  const save = IROP.attributes[s.burn.save] ?? IROP.attributes.agi;
  const burns = Array.from({ length: affordable }, (_, i) => ({
    value: i + 1,
    label: `${i + 1} ${i ? "burns" : "burn"}: ${(i + 1) * fuel.cost} fuel, ${addDice(baseFormula, i)}`,
    selected: i === 0
  }));
  const ranges = Object.entries(IROP.rangeBands).filter(([k]) => s.range[k]?.tiles || (k === "short")).map(([k, label]) => ({
    key: k, label: `${label}${s.range[k].tiles ? `, ${s.range[k].tiles} tiles` : ""} (save ${signed(s.range[k].dm)})`,
    checked: k === "short"
  }));
  const data = await formDialog(`Burn: ${item.name}`, "burn.hbs", {
    itemName: item.name, img: item.img, fuel: `${fuel.value} / ${fuel.max}`, burns, ranges,
    targetName: target.name ?? "The target", saveLabel: save.label
  });
  if ( !data ) return null;

  const count = Math.max(1, Math.min(affordable, Number(data.burns) || 1));
  const band = data.range || "short";
  const dm = (s.range[band]?.dm ?? 0) + chem.saveDm;
  const spent = count * fuel.cost;
  await item.update({ "system.fuel.value": fuel.value - spent });
  const roll = new DamageRoll(addDice(baseFormula, count - 1), actor.getRollData(), {
    label: item.name,
    damageType: s.damage.type,
    damageTypeLabel: IROP.damageTypes[s.damage.type]?.label ?? s.damage.type,
    shred: s.shred, penetration: s.penetration, destruction: s.destruction,
    drBypass: chem.drBypass, perkNotes: chem.notes.length ? [`Perks: ${chem.notes.join(", ")}`] : [],
    burn: {
      burns: count, spent, save: s.burn.save, saveLabel: save.label, saveAbbr: save.abbr,
      dm, bandLabel: IROP.rangeBands[band],
      status: s.burn.status ? { id: s.burn.status, value: (Number(s.burn.statusValue) || 0) + chem.statusUp, ammo: item.name } : null
    },
    targetUuid: target.uuid, targetName: target.name
  });
  return toChat(roll, actor, data.mode);
}

/**
 * The target's save against a chemthrower burn, from the button on the burn card.
 * Posts the save, then the outcome: half damage on a success, or full damage and
 * the status (with an Apply button) on a failure.
 */
export async function rollBurnSave(message, roll) {
  const o = roll?.options ?? {};
  const burn = o.burn;
  // Burned with no target: the save is rolled for the token the presser has targeted.
  let targetUuid = o.targetUuid;
  if ( !targetUuid ) {
    const picked = Array.from(game.user.targets ?? []);
    if ( picked.length !== 1 ) return ui.notifications.warn("Target the one token that must save, then press the button again.");
    targetUuid = picked[0].actor?.uuid ?? null;
  }
  const target = targetUuid ? foundry.utils.fromUuidSync(targetUuid) : null;
  if ( !burn || !target ) return ui.notifications.warn("The target of this burn no longer exists.");
  if ( !target.isOwner ) return ui.notifications.warn(`Only ${target.name}'s owner or the GM can roll its save.`);
  const attr = target.system.attributes[burn.save];
  const saveRoll = D100Roll.create({
    kind: "check", label: `${burn.saveLabel} save`, subtitle: `against ${o.label}`,
    target: attr.value, targetLabel: `${attr.abbr} ${attr.value}`,
    modifiers: burn.dm ? [{ label: `${burn.bandLabel} range`, value: burn.dm }] : [], actorUuid: target.uuid
  });
  await toChat(saveRoll, target);
  return ChatMessage.implementation.create({
    speaker: speakerFor(target),
    content: burnOutcome({ label: o.label, typeLabel: o.damageTypeLabel ?? "", target: target.name,
      full: roll.total, failed: !saveRoll.success, status: burn.status }),
    flags: { irop: { status: saveRoll.success ? null : burn.status, targetUuid } }
  });
}

/** The burn's outcome card: half on a save; on a failure, all of it and the status with an Apply button. */
export function burnOutcome({ label, typeLabel, target, full, failed, status }) {
  const half = Math.floor(full / 2);
  const statusName = status ? (IROP.statusEffects.find(e => e.id === status.id)?.name ?? status.id) : "";
  const line = failed
    ? `<strong>${target}</strong> fails: takes <strong>${full}</strong> ${typeLabel}${status
      ? ` and gains <strong>${statusName}${status.value ? ` (${status.value})` : ""}</strong>` : ""}.`
    : `<strong>${target}</strong> saves: takes <strong>${half}</strong> ${typeLabel} (half), no status.`;
  const button = (failed && status) ? `<button type="button" data-irop-action="applyStatus" data-tooltip="Apply it to the target">Apply</button>` : "";
  return `<div class="irop-card burn-outcome"><header class="card-head"><h3>${label}</h3>
    <span class="card-sub">${failed ? "Save failed" : "Saved"}</span></header><div class="damage-status"><span>${line}</span>${button}</div></div>`;
}

/** Explosives with no attack roll (charges, mines): post a card with damage and scatter. */
async function useExplosive(actor, item) {
  const s = item.system;
  if ( s.quantity <= 0 ) return ui.notifications.warn(`${actor.name} has no ${item.name} left.`);
  // Set down where it goes off first (blast markers, 2026-10-09); backing out calls it off.
  const marker = (Number(s.blast) > 0) ? await placeBlast({ name: item.name, radius: Number(s.blast), template: s.template, actor, item }) : undefined;
  if ( marker === null ) return null;
  const attack = {
    blast: marker ? { uuid: marker.uuid, radius: Number(s.blast) } : null,
    actorUuid: actor.uuid, itemUuid: item.uuid, itemName: item.name,
    cover: "none", exposed: false, critChance: s.critical.chance,
    damage: s.damage.formula ? { formula: s.damage.formula, type: s.damage.type, critDamage: s.critical.damage,
      shred: s.shred, penetration: s.penetration, destruction: s.destruction } : null,
    scatter: s.weaponClass === "launcher" ? "launched" : "thrown"
  };
  if ( attack.damage ) await rollDamage(attack);
  await spendOne(item);
  return null;
}

/**
 * Use up one grenade, rocket or explosive. The last one is gone from the sheet,
 * as a fired LAW is, rather than lingering at a count of 0 (Johnald, 2026-10-08).
 */
export async function spendOne(item) {
  const q = item.system.quantity;
  if ( q > 1 ) return item.update({ "system.quantity": q - 1 });
  return item.delete();
}

async function consumeOne(item) {
  const q = item.system.quantity;
  if ( q > 1 ) return item.update({ "system.quantity": q - 1 });
  if ( q === 1 ) return item.update({ "system.quantity": 0 });
  return null;
}

/**
 * The critical roll after a hit. CANON (2026-08-13): roll 1d100 and meet or roll
 * under the Critical stat, with D.M.s on the roll; cover adds its Critical
 * column, Exposed adds -15, and (LIVE) the weapon's crit chance is subtracted.
 */
export async function rollCritical(attack) {
  const actor = foundry.utils.fromUuidSync(attack.actorUuid);
  if ( !actor ) return ui.notifications.warn("The attacker no longer exists.");
  if ( attack.perk?.noCrit ) return ui.notifications.info(`${attack.perk.through || "This attack"} cannot critically hit.`);
  const modifiers = collectModifiers({
    keys: attack.exposed ? ["exposed"] : [],
    cover: attack.cover,
    role: "critical",
    critical: -(attack.critChance || 0)
  });
  if ( attack.ammo?.critical ) modifiers.push({ label: attack.ammo.name, value: attack.ammo.critical });
  modifiers.push(...(attack.perk?.critical ?? []));
  const target = actor.system.critical;
  const roll = D100Roll.create({
    kind: "critical", label: attack.itemName, subtitle: "Critical", target, targetLabel: `Critical ${target}`,
    modifiers, actorUuid: actor.uuid, attack
  });
  return toChat(roll, actor);
}

/** Roll damage for an attack context. A critical adds the weapon's crit damage. */
export async function rollDamage(attack, { critical = false } = {}) {
  // Support fire (a Mortar Strike) has no attacker.
  const actor = attack.actorUuid ? foundry.utils.fromUuidSync(attack.actorUuid) : null;
  const dmg = attack.damage;
  if ( !dmg?.formula ) return ui.notifications.warn("This attack has no damage formula.");
  let formula = dmg.formula;
  if ( critical && dmg.critDamage ) formula = `${formula} + ${dmg.critDamage}`;
  // Role perks (2026-10-18): Weapon Expert's +1, a Specialist's crit damage.
  const perk = attack.perk ?? {};
  if ( perk.damage ) formula = `${formula} + ${perk.damage}`;
  if ( critical && perk.critDamage ) formula = `${formula} + ${perk.critDamage}`;
  // Raid Time's +25%, Power Attack's +50%, Disabling Shot's half: on the whole, rounded down.
  const factor = (1 + ((Number(perk.damagePct) || 0) / 100)) * (perk.half ? 0.5 : 1);
  if ( factor !== 1 ) formula = `floor((${formula}) * ${factor})`;
  const roll = new DamageRoll(formula, actor?.getRollData() ?? {}, {
    label: attack.itemName,
    damageType: dmg.type,
    damageTypeLabel: IROP.damageTypes[dmg.type]?.label ?? dmg.type,
    critical,
    shred: (dmg.shred ?? 0) + (perk.shred ?? 0),
    penetration: (dmg.penetration ?? 0) + (perk.penetration ?? 0),
    perkNotes: perk.notes ?? [],
    destruction: dmg.destruction,
    drBypass: (dmg.drBypass ?? 0) + (perk.drBypass ?? 0),
    status: dmg.status ?? null,
    targetUuid: attack.targetUuid ?? null,
    targetName: attack.targetName ?? null,
    // The blast marker on the map, for the card's Clear marker button (2026-10-09).
    blastUuid: attack.blast?.uuid ?? null
  });
  return toChat(roll, actor);
}

/** What a scatter card says about the blast marker. */
const MARKER_NOTES = {
  moved: "The blast marker has moved there.",
  already: "The blast marker has already scattered once.",
  permission: "Only the thrower or a GM can move the blast marker.",
  gone: "The blast marker is gone: place the blast by hand."
};

/**
 * Scatter, canon: direction 1d8 from North clockwise, distance by delivery. A blast that
 * was set down on the map moves there by itself (blast markers, 2026-10-09).
 * @param {string} method                 thrown or launched
 * @param {Actor} [actor]
 * @param {{blast?: {uuid: string}}} [options]   The attack's blast marker
 */
export async function rollScatter(method = "thrown", actor = null, { blast = null } = {}) {
  const m = SCATTER.methods[method] ?? SCATTER.methods.thrown;
  const dir = await new foundry.dice.Roll("1d8").evaluate();
  const dist = await new foundry.dice.Roll(m.formula).evaluate();
  const direction = SCATTER.directions[dir.total - 1];
  let note = "";
  if ( blast?.uuid ) {
    const result = await scatterBlast(blast.uuid, dir.total, dist.total);
    note = MARKER_NOTES[result.moved ? "moved" : result.reason] ?? "";
  }
  const content = `<div class="irop-card irop-scatter">
    <header class="card-head"><h3>Scatter</h3><span class="card-sub">${m.name}, ${m.formula}</span></header>
    <div class="scatter-result"><i class="fa-solid fa-location-arrow scatter-arrow" style="--dir:${(dir.total - 1) * 45 - 45}deg"></i>
    <strong>${direction}</strong>, <strong>${dist.total}</strong> ${dist.total === 1 ? "tile" : "tiles"}</div>
    ${note ? `<p class="scatter-note"><i class="fa-solid fa-bullseye"></i> ${note}</p>` : ""}</div>`;
  return ChatMessage.implementation.create({ speaker: speakerFor(actor), content, rolls: [dir, dist] });
}

/* -------------------------------------------- */
/*  DYNOSRS                                     */
/* -------------------------------------------- */

/** Does anyone in the deployed squad hold a Victory? Needed for Nigh Impossible. */
function squadHoldsVictory() {
  return getSquad().some(a => a.system.banks.victory > 0);
}

/**
 * The pool dialog. Six dice counts, prefilled, with a difficulty picker that
 * sets the Difficulty dice and a live preview of the pool.
 */
async function poolDialog(title, { pool, difficulty = "normal", lede = "" }) {
  const difficulties = [{ key: "", label: "Set by hand", dice: null }]
    .concat(Object.entries(DIFFICULTY).map(([k, d]) => ({ key: k, label: `${d.name} (${d.dice})`, dice: d.dice })));
  const start = { ...pool };
  if ( difficulty && DIFFICULTY[difficulty] ) start.difficulty = DIFFICULTY[difficulty].dice + (pool.difficulty || 0);

  const data = await formDialog(title, "pool.hbs", {
    lede,
    difficulties: difficulties.map(d => ({ ...d, selected: d.key === difficulty })),
    dice: DICE_ORDER.map(k => ({ key: k, name: DICE[k].name, sides: DICE[k].sides, polarity: DICE[k].polarity, count: start[k] || 0 })),
    victoryHeld: squadHoldsVictory()
  }, root => {
    const form = root.querySelector("form") ?? root;
    const select = form.querySelector("select[name=difficulty]");
    const preview = form.querySelector(".pool-preview");
    const warn = form.querySelector(".nigh-warning");
    const draw = () => {
      if ( !preview ) return;
      preview.innerHTML = DICE_ORDER.map(k => {
        const n = Math.max(0, Number(form.querySelector(`[name="pool.${k}"]`)?.value) || 0);
        return Array.from({ length: Math.min(n, 12) }, () => `<span class="irop-die die-${k}" data-tooltip="${DICE[k].name}"></span>`).join("");
      }).join("") || `<em>Empty pool</em>`;
      if ( warn ) warn.hidden = select?.value !== "nighImpossible";
    };
    select?.addEventListener("change", () => {
      const d = DIFFICULTY[select.value];
      const input = form.querySelector(`[name="pool.difficulty"]`);
      if ( d && input ) input.value = d.dice + (pool.difficulty || 0);
      draw();
    });
    form.addEventListener("input", draw);
    draw();
  });
  if ( !data ) return null;
  const counts = {};
  for ( const k of DICE_ORDER ) counts[k] = Math.max(0, Math.min(20, Number(data[`pool.${k}`] ?? data.pool?.[k]) || 0));
  return { pool: counts, difficulty: data.difficulty, mode: data.mode };
}

/**
 * A skill check for an actor: the pool is built from the linked attribute and
 * the skill rank, then the player sets difficulty and any extra dice.
 */
export async function rollSkill(actor, key) {
  const skill = actor.system.skills[key];
  const attr = actor.system.attributes[skill.attribute];
  const p = skill.pool;
  const lede = `${attr.abbr} mod ${attr.mod}, rank ${skill.rank}: ${p.skill} Skill, ${p.aptitude} Aptitude`
    + (p.floored ? " (pool floor)" : "");
  const result = await poolDialog(`${skill.label} check`, { pool: { aptitude: p.aptitude, skill: p.skill }, lede });
  if ( !result ) return null;
  const diff = DIFFICULTY[result.difficulty];
  const roll = DynosrsRoll.fromPool(result.pool, {
    label: `${skill.label} check`,
    subtitle: diff ? diff.name : "",
    actorUuid: actor.uuid,
    skill: key,
    difficulty: result.difficulty
  });
  return toChat(roll, actor, result.mode);
}

/** A free DYNOSRS pool, for the GM or anything the sheet does not cover. */
export async function rollFreePool(actor = null) {
  const result = await poolDialog("DYNOSRS pool", { pool: { aptitude: 2 }, difficulty: "normal" });
  if ( !result ) return null;
  const diff = DIFFICULTY[result.difficulty];
  const roll = DynosrsRoll.fromPool(result.pool, {
    label: "DYNOSRS check", subtitle: diff ? diff.name : "", actorUuid: actor?.uuid, difficulty: result.difficulty
  });
  return toChat(roll, actor, result.mode);
}

/* -------------------------------------------- */
/*  Using items                                 */
/* -------------------------------------------- */

/**
 * Use an ability: spend Energy and uses, post the card, and if it is a
 * paraphysical attack, go straight to the attack.
 */
export async function useAbility(actor, item) {
  // Role perks (2026-10-18): limited uses from the perk's rule, set the first time it is used.
  const ruled = perkUses(item, perkContext(actor).attributes);
  if ( ruled && (item.system.uses.max !== ruled.max) ) await item.update({ "system.uses.max": ruled.max, "system.uses.value": ruled.max });
  const s = item.system;
  const energy = actor.system.vitals.energy;
  // Its numbers as the character's other perks leave them (Superior Training: -1 Energy).
  const upgraded = abilityAsUpgraded(item, (actor.items?.filter?.(i => i.type === "ability") ?? []));
  const cost = upgraded.energy;
  if ( cost > energy.value ) {
    return ui.notifications.warn(`${item.name} costs ${cost} Energy; ${actor.name} has ${energy.value}.`);
  }
  if ( s.uses.max && (s.uses.value <= 0) ) return ui.notifications.warn(`${item.name} has no uses left.`);

  const spend = async () => {
    if ( cost ) await actor.update({ "system.vitals.energy.value": actor.system.vitals.energy.value - cost });
    if ( s.uses.max ) await item.update({ "system.uses.value": s.uses.value - 1 });
  };

  // An active that only spends ammo (Area Suppression): from the weapon in hand, then its card.
  if ( upgraded.ammoOnly ) {
    const weapon = await weaponFor(actor, item, { types: [] });
    if ( !weapon ) return null;
    if ( weapon.system.usesAmmo && (weapon.system.ammo.value < upgraded.ammoOnly) ) {
      return ui.notifications.warn(`${item.name} needs ${upgraded.ammoOnly} ammo; ${weapon.name} has ${weapon.system.ammo.value}.`);
    }
    if ( weapon.system.usesAmmo ) await weapon.update({ "system.ammo.value": weapon.system.ammo.value - upgraded.ammoOnly });
    await spend();
    return postItemCard(actor, item, { spent: cost, upgrades: upgraded.upgrades, ammoSpent: `${upgraded.ammoOnly} ammo from ${weapon.name}` });
  }

  // An active made as an attack (Chained Shot, Pour it On!): the weapon's attack, with its numbers.
  if ( upgraded.attack ) {
    const weapon = await weaponFor(actor, item, upgraded.attack);
    if ( !weapon ) return null;
    const message = await rollAttack(actor, weapon, { ability: item, abilityAttack: upgraded.attack });
    if ( message ) await spend();
    return message ?? null;
  }

  // A paraphysical attack spends only once the attack is actually rolled, so
  // cancelling the attack dialog costs nothing. The attack card is the record.
  if ( s.paraphysics.attack ) {
    const message = await rollAttack(actor, item);
    if ( message ) await spend();
    return message ?? null;
  }
  await spend();
  return postItemCard(actor, item, { spent: cost, upgrades: upgraded.upgrades, ...powerCard(actor, item) });
}

/**
 * The weapon an active is made with: the only one in hand that fits, or the one picked. Fits means
 * equipped, not stowed, a weapon type the active allows (any, if it names none) and an attack.
 */
async function weaponFor(actor, ability, attack) {
  const fits = (actor.items?.filter?.(i => (i.type === "weapon") && i.system.equipped && !i.system.stowed
    && (!attack.types?.length || attack.types.includes(weaponTypeOf(i)))
    && (!attack.classes?.length || attack.classes.includes(i.system.weaponClass))
    && (!attack.melee || (i.system.category === "melee")) && !!attackProfile(i)?.attribute) ?? []);
  if ( !fits.length ) {
    ui.notifications.warn(`${ability.name} needs ${attack.melee ? "a melee weapon" : "a weapon"} in hand${attack.types?.length ? ` (${attack.types.map(t => IROP.weaponTypes[t] ?? t).join(", ")})` : ""}. Equip one first.`);
    return null;
  }
  if ( fits.length === 1 ) return fits[0];
  const data = await DialogV2.input({
    window: { title: ability.name },
    classes: ["irop", "irop-roll-dialog"],
    content: `<label class="irop-choose"><span>With</span><select name="weapon">${fits.map(w => `<option value="${w.id}">${foundry.utils.escapeHTML(w.name)}</option>`).join("")}</select></label>`,
    ok: { label: "Attack", icon: "fa-solid fa-crosshairs" }
  });
  return data ? actor.items.get(data.weapon) ?? null : null;
}

/**
 * The last attack card on this character, a few messages back, and what its perks do to dodging it
 * (Effective Fire's +15): {from, lines: [{label, value}]}, or null.
 */
function lastAttackOn(actor) {
  const messages = game.messages?.contents?.slice(-12).reverse() ?? [];
  for ( const m of messages ) {
    const attack = m.rolls?.[0]?.options?.attack;
    if ( !attack?.targetUuid ) continue;
    const target = foundry.utils.fromUuidSync(attack.targetUuid);
    if ( (target?.id !== actor.id) && (target?.actor?.id !== actor.id) ) continue;
    const lines = attack.perk?.enemyDodge ?? [];
    return { from: `${foundry.utils.fromUuidSync(attack.actorUuid)?.name ?? "the attacker"}'s ${attack.itemName}`, lines };
  }
  return null;
}

/** Use gear: roll its formula if it has one, and consume one if it is consumable. */
export async function useGear(actor, item) {
  const s = item.system;
  if ( s.quantity <= 0 ) return ui.notifications.warn(`${actor.name} has no ${item.name} left.`);
  // Gear that names an ability it needs (the Field Medikit: "Requires : Field Medic"), checked when that
  // ability exists in the world (2026-10-18).
  const needs = requiredAbility(s.description);
  if ( needs ) {
    const key = perkKey(needs);
    const known = (game.items?.some?.(i => (i.type === "ability") && (perkKey(i.name) === key))) ?? false;
    const has = actor.items?.some?.(i => (i.type === "ability") && (perkKey(i.name) === key));
    if ( known && !has ) return ui.notifications.warn(`${item.name} requires ${needs}; ${actor.name} does not have it.`);
  }
  if ( s.formula ) {
    const roll = new foundry.dice.Roll(s.formula, actor.getRollData());
    await roll.evaluate();
    await roll.toMessage({ speaker: speakerFor(actor), flavor: `${item.name}` });
  }
  else await postItemCard(actor, item);
  if ( s.consumable ) {
    // Field Medic: a medikit gives two more uses before it is spent.
    const per = 1 + gearCharges((actor.items?.filter?.(i => i.type === "ability") ?? []), item);
    const used = (Number(s.used) || 0) + 1;
    if ( used < per ) await item.update({ "system.used": used });
    else {
      if ( s.used ) await item.update({ "system.used": 0 });
      await consumeOne(item);
    }
  }
  return null;
}

/** Post an item's card to chat. */
/**
 * A power's lines on its card (2026-10-19): its rank and tracks, the D.M. a save power puts on its
 * target, Concentration, the modification taken and its evolution.
 */
export function powerCard(actor, item) {
  const p = item.system?.paraphysics;
  if ( !p?.discipline ) return {};
  const tracks = trackText(p);
  const totals = powerTotals(p);
  const lines = [`Rank ${p.rank} of 5${tracks ? `: ${tracks}` : ""}`, ...totals.lines];
  if ( p.save ) {
    const attr = IROP.attributes[p.save]?.label ?? p.save;
    lines.push(`Target saves on ${attr} at ${signed(powerSaveDm(p, actor?.system?.casting?.mod ?? 0))}`);
  }
  if ( totals.concentration ) lines.push("Concentration: Disorientated breaks it");
  return { powerLines: lines };
}

export async function postItemCard(actor, item, extra = {}) {
  // A weapon's card lists what the poster's perks do with it (2026-10-18).
  const perkLines = ((item.type === "weapon") && actor) ? weaponPerkSummary((actor.items?.filter?.(i => i.type === "ability") ?? []), item, perkContext(actor)).lines : [];
  const content = await renderTemplate("systems/irop/templates/chat/item-card.hbs", {
    perkLines,
    item,
    system: item.system,
    typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
    accent: IROP.roles[item.system.source]?.color ?? actor?.system.accent ?? null,
    description: await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.description ?? "", {
      rollData: actor?.getRollData(), relativeTo: item
    }),
    actionType: IROP.actionTypes[item.system.actionType],
    discipline: IROP.disciplines[item.system.paraphysics?.discipline],
    ...extra
  });
  return ChatMessage.implementation.create({ speaker: speakerFor(actor), content });
}

/* -------------------------------------------- */
/*  Session economy                             */
/* -------------------------------------------- */

/**
 * HANDOFF Section 7, session start: the GM rolls 1d6 for banked Danger, and the
 * squad flips for Edge (1d2: on a 1 every character starts with 1 Edge). Banks
 * are reset to zero first, since all banks reset at the end of a session.
 * @param {object} [options]
 * @param {boolean} [options.perCharacter=false]  one Edge flip per operative instead of one for the squad
 */
export async function startSession({ perCharacter = false } = {}) {
  if ( !game.user.isGM ) return ui.notifications.warn("Only the GM can start a session.");
  // Only the deployed squad gets the opening Edge (RULED 2026-10-07).
  const operatives = getSquad();
  if ( !operatives.length ) {
    return ui.notifications.warn("Deploy the squad first: drag this mission's operatives from the Actors sidebar into the Banks window.");
  }

  const danger = await new foundry.dice.Roll("1d6").evaluate();
  await game.settings.set("irop", "gmBanks", { danger: 0, defeat: 0 });
  await adjustGmBanks({ danger: danger.total });

  const lines = [`<p>Banked Danger: <strong>${danger.total}</strong> (1d6).</p>`];
  const rolls = [danger];
  if ( perCharacter ) {
    for ( const a of operatives ) {
      const flip = await new foundry.dice.Roll("1d2").evaluate();
      rolls.push(flip);
      const edge = flip.total === 1 ? 1 : 0;
      await a.update({ "system.banks.edge": edge, "system.banks.victory": 0 });
      lines.push(`<p>${a.name}: ${edge ? "starts with 1 Edge" : "no Edge"} (1d2 = ${flip.total}).</p>`);
    }
  }
  else {
    const flip = await new foundry.dice.Roll("1d2").evaluate();
    rolls.push(flip);
    const edge = flip.total === 1 ? 1 : 0;
    for ( const a of operatives ) await a.update({ "system.banks.edge": edge, "system.banks.victory": 0 });
    lines.push(`<p>Squad Edge flip: ${edge ? "every operative starts with 1 Edge" : "no starting Edge"} (1d2 = ${flip.total}).</p>`);
  }
  // Role perks used per mission (Swift Hands, Universal Soldier) are refilled (2026-10-18).
  let refilled = 0;
  for ( const a of operatives ) {
    for ( const item of a.items.filter(i => i.type === "ability") ) {
      const uses = perkUses(item, perkContext(a).attributes);
      if ( (uses?.per !== "mission") || ((item.system.uses.value === uses.max) && (item.system.uses.max === uses.max)) ) continue;
      await item.update({ "system.uses.max": uses.max, "system.uses.value": uses.max });
      refilled++;
    }
  }
  if ( refilled ) lines.push(`<p>Per mission perks refilled: ${refilled}.</p>`);
  const content = `<div class="irop-card"><header class="card-head"><h3>Session start</h3>
    <span class="card-sub">Banks reset, opening economy rolled</span></header>${lines.join("")}</div>`;
  return ChatMessage.implementation.create({ content, rolls, whisper: [] });
}

/**
 * Clear every bank, for the end of a mission or session. Every operative still
 * holding Edge or Victory is cleared, deployed or not, so nothing carries over;
 * the rest are left alone rather than updating the whole roster.
 * @param {object} [options]
 * @param {boolean} [options.standDown=true]    Also empty the deployed squad
 */
export async function endSession({ standDown = true } = {}) {
  if ( !game.user.isGM ) return ui.notifications.warn("Only the GM can end a session.");
  await game.settings.set("irop", "gmBanks", { danger: 0, defeat: 0 });
  const holding = game.actors.filter(a => (a.type === "operative") && (a.system.banks.edge || a.system.banks.victory));
  for ( const a of holding ) await a.update({ "system.banks.edge": 0, "system.banks.victory": 0 });
  if ( standDown ) await setSquad([]);
  ui.notifications.info(`All Edge, Danger, Victory and Defeat banks reset to 0.${standDown ? " The squad stands down." : ""}`);
}

export { BANK_CAP };

/** The mods fitted to a weapon on its owner's sheet. */
function fittedMods(item) {
  return item.actor?.items?.filter?.(i => (i.type === "mod") && (i.system.installedOn === item.id)) ?? [];
}

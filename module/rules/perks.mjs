import { IROP } from "../config.mjs";
import { PERK_RULES } from "./perk-rules.mjs";
import { perkKey } from "./skill-trees.mjs";
import { weaponTypeOf } from "./weapon-types.mjs";

/**
 * The perk engine (Johnald, 2026-10-18): what a character's role perks do to their rolls and their
 * sheet, from the rules in perk-rules.mjs. Each roll asks for its options (bonuses that always apply,
 * tick boxes for what the system cannot see, number boxes for counts), then for what the choices come
 * to. Kept apart from Foundry so it can be tested.
 */

const RULES = new Map(Object.entries(PERK_RULES).map(([name, rule]) => [perkKey(name), { name, ...rule }]));

const signed = n => ((n > 0) ? `+${n}` : `${n}`);
const bandLabel = b => IROP.rangeBands[b] ?? b;

/** The rule for a perk, by its name, or null. */
export function perkRule(name) {
  return RULES.get(perkKey(name)) ?? null;
}

/**
 * A character's perks that have rules: [{item, rule}]. A name shared by two doctrines with other
 * numbers (Will to Survive) takes the rule for the perk's own Source.
 */
export function perksOf(abilities = []) {
  return abilities.map(item => ({ item, rule: ruleFor(item) })).filter(p => p.rule);
}

/** The rule for one ability, for its doctrine. */
function ruleFor(item) {
  const rule = perkRule(item?.name);
  const own = rule?.roles?.[item?.system?.source];
  return own ? { ...rule, ...own } : rule;
}

/**
 * Whether a modifier's weapon conditions fit a weapon: its types, classes, categories, melee or
 * ranged only, and special ammunition loaded.
 */
export function fitsWeapon(mod, weapon) {
  const s = weapon?.system ?? {};
  if ( mod.types?.length && !mod.types.includes(weaponTypeOf(weapon)) ) return false;
  if ( mod.classes?.length && !mod.classes.includes(s.weaponClass ?? "") ) return false;
  if ( mod.categories?.length && !mod.categories.includes(s.category ?? "") ) return false;
  if ( mod.melee && (s.category !== "melee") ) return false;
  if ( mod.ranged && (s.category !== "ranged") ) return false;
  if ( (mod.ammo === "special") && !weapon?.special ) return false;
  return true;
}

/**
 * Whether the character's gear meets a modifier's other conditions: worn armor of a class, a weapon
 * of a type in hand.
 * @param {object} gear    {armor: [{armorClass, tier}], equipped: [weaponType]}
 */
export function fitsGear(mod, gear = {}) {
  if ( mod.wornArmor && !(gear.armor ?? []).some(a => a.armorClass === mod.wornArmor) ) return false;
  if ( mod.equippedType && !(gear.equipped ?? []).includes(mod.equippedType) ) return false;
  return true;
}

/** An attribute value a modifier reads: the highest (or only) of its attributes' mods, times a factor, rounded down. */
export function attributeValue(from, attributes = {}) {
  const values = (from.attrs ?? []).map(k => Number(attributes[k]) || 0);
  const best = values.length ? Math.max(...values) : 0;
  return Math.floor(best * (from.factor ?? 1));
}

/** A modifier's value for this character: fixed, by armor tier, or read from attributes. */
function resolveValue(mod, { attributes = {}, gear = {}, weapon = null } = {}) {
  if ( mod.byWeaponTier ) {
    const tier = Math.max(1, Number(weapon?.system?.tier) || 1);
    return mod.byWeaponTier[Math.min(mod.byWeaponTier.length, tier) - 1] ?? 0;
  }
  if ( mod.byTier ) {
    const tier = Math.max(0, ...(gear.armor ?? []).filter(a => !mod.wornArmor || (a.armorClass === mod.wornArmor)).map(a => Number(a.tier) || 1));
    return mod.byTier[Math.max(0, Math.min(mod.byTier.length, tier) - 1)] ?? 0;
  }
  if ( mod.valueFrom ) return (mod.value ?? 1) * attributeValue(mod.valueFrom, attributes);
  return mod.value;
}

/** What a modifier does, in a few words: "-4 to hit at Medium". */
export function modText(mod) {
  const what = {
    attack: "to hit", critical: "critical chance", damage: "damage", critDamage: "critical damage",
    shred: "shred", penetration: "penetration", enemyDodge: "to the target's dodge", dodge: "to dodge",
    damagePct: "% damage", blast: "blast radius", drBypass: "DR bypassed"
  }[mod.stat] ?? mod.stat;
  const from = mod.valueFrom ? ` (${(mod.valueFrom.factor ?? 1) === 1 ? "" : "half "}${mod.valueFrom.attrs.map(a => a.toUpperCase()).join(" or ")} mod)` : "";
  const tiers = mod.byTier ?? mod.byWeaponTier;
  const amount = tiers ? `${tiers.map(signed).join("/")}${mod.byWeaponTier ? " by weapon Tier," : " by armor Tier,"}` : (mod.scale ? `${signed(mod.value)} each${mod.scale.every ? ` ${mod.scale.every}` : ""}` : signed(mod.value));
  const sep = (mod.stat === "damagePct") ? "" : " ";
  const bands = mod.bands?.length ? ` at ${mod.bands.map(bandLabel).join(" and ")}${mod.orMelee ? " or in melee" : ""}` : "";
  return `${amount}${sep}${what}${from}${bands}`;
}

/** The stats each roll takes. */
const ATTACK_STATS = new Set(["attack", "critical", "damage", "critDamage", "shred", "penetration", "enemyDodge", "damagePct", "blast", "drBypass"]);

/**
 * The perk options for a roll: bonuses that always apply, tick boxes (one per situation, gathering
 * every perk that names it), and number boxes.
 * @param {object[]} abilities   The character's abilities: {name}
 * @param {object} context
 * @param {"attack"|"dodge"} context.roll
 * @param {object} [context.weapon]     For an attack: {system: {weaponType, weaponClass, category}, special}
 * @param {number|null} [context.targetHpPct]   The target's HP as a share, when it can be read
 * @param {Record<string, number>} [context.attributes]   The character's attribute mods
 * @param {object} [context.gear]       {armor: [{armorClass, tier}], equipped: [weaponType]}
 */
export function perkOptions(abilities, { roll = "attack", weapon = null, targetHpPct = null, attributes = {}, gear = {} } = {}) {
  const wants = roll === "attack" ? (m => ATTACK_STATS.has(m.stat)) : (m => m.stat === "dodge");
  const auto = [];
  const situations = new Map();
  const scales = [];
  for ( const { item, rule } of perksOf(abilities) ) {
    for ( const [i, mod] of (rule.mods ?? []).entries() ) {
      if ( !wants(mod) ) continue;
      if ( (roll === "attack") && !fitsWeapon(mod, weapon) ) continue;
      if ( !fitsGear(mod, gear) ) continue;
      const value = resolveValue(mod, { attributes, gear, weapon });
      if ( !value ) continue;
      const entry = { ...mod, value, from: item.name, id: `${perkKey(item.name).replace(/\s+/g, "-")}-${i}` };
      if ( mod.scale ) {
        const max = mod.scale.maxFrom ? Math.max(0, attributeValue(mod.scale.maxFrom, attributes)) : (mod.scale.max ?? 99);
        scales.push({ key: entry.id, label: `${item.name}: ${mod.scale.label}`, max, mods: [entry] });
      }
      else if ( mod.hpBelow ) {
        const label = `Target under ${mod.hpBelow}% HP`;
        const s = situations.get(label) ?? { key: `hp-${mod.hpBelow}`, label, checked: (targetHpPct !== null) && (targetHpPct < mod.hpBelow), mods: [] };
        s.mods.push(entry);
        situations.set(label, s);
      }
      else if ( mod.situation ) {
        const s = situations.get(mod.situation) ?? { key: `s-${perkKey(mod.situation).replace(/\s+/g, "-")}`, label: mod.situation, checked: false, mods: [] };
        s.mods.push(entry);
        situations.set(mod.situation, s);
      }
      else auto.push(entry);
    }
  }
  const describe = list => list.map(m => `${m.from}: ${modText(m)}`).join("; ");
  return {
    auto: auto.map(m => ({ ...m, text: `${m.from}: ${modText(m)}` })),
    situations: [...situations.values()].map(s => ({ ...s, text: describe(s.mods) })),
    scales: scales.map(s => ({ ...s, text: describe(s.mods) })),
    any: !!(auto.length || situations.size || scales.length)
  };
}

/**
 * What the choices come to.
 * @param {object} options    From perkOptions
 * @param {object} choices
 * @param {string|null} [choices.band]       The range band picked; null for a melee attack
 * @param {boolean} [choices.melee]          A melee attack (meets a band condition marked orMelee)
 * @param {Set<string>|string[]} [choices.ticked]   Situation keys ticked
 * @param {Record<string, number>} [choices.counts]   Number box values, by key
 */
export function perkResult(options, { band = null, melee = false, ticked = [], counts = {} } = {}) {
  const on = new Set(ticked);
  const out = { attack: [], critical: [], dodge: [], enemyDodge: [], damage: 0, critDamage: 0, shred: 0, penetration: 0,
    damagePct: 0, blast: 0, drBypass: 0, notes: [] };
  const noun = { damage: "damage", critDamage: "critical damage", shred: "shred", penetration: "penetration", damagePct: "% damage", blast: "blast radius", drBypass: "DR bypassed" };
  const apply = (mod, times = 1, label = mod.from) => {
    if ( mod.bands?.length && !mod.bands.includes(band) && !(mod.orMelee && melee) ) return;
    const value = mod.value * times;
    if ( !value ) return;
    if ( ["attack", "critical", "dodge", "enemyDodge"].includes(mod.stat) ) out[mod.stat].push({ label, value });
    else {
      out[mod.stat] += value;
      out.notes.push(`${label} ${signed(value)}${mod.stat === "damagePct" ? "" : " "}${noun[mod.stat]}`);
    }
  };
  for ( const mod of options.auto ?? [] ) apply(mod);
  for ( const s of options.situations ?? [] ) if ( on.has(s.key) ) for ( const mod of s.mods ) apply(mod, 1, `${mod.from} (${s.label})`);
  for ( const s of options.scales ?? [] ) {
    const n = Math.max(0, Math.min(s.max, Math.floor(Number(counts[s.key]) || 0)));
    if ( !n ) continue;
    for ( const mod of s.mods ) {
      const times = mod.scale.every ? Math.floor(n / mod.scale.every) : n;
      let value = mod.value * times;
      if ( mod.scale.cap ) value = Math.sign(value) * Math.min(Math.abs(value), mod.scale.cap);
      if ( value ) apply({ ...mod, value }, 1, `${mod.from} (${n} ${mod.scale.label.toLowerCase()})`);
    }
  }
  return out;
}

/** The blast radius perks add to a weapon before it is thrown or fired (Blast Radius), from the always-on ones. */
export function perkBlast(abilities, weapon) {
  return perkResult(perkOptions(abilities, { roll: "attack", weapon })).blast;
}

/** An attack active's numbers before its upgrades. */
const ATTACK_DEFAULTS = { accuracy: 0, critical: 0, critDamage: 0, damagePct: 0, halfDamage: false, noCrit: false,
  autoHit: false, noDefense: false, ammo: 1, blast: 0, types: [], classes: [], melee: false, byType: {} };

/**
 * An ability's numbers as the character's other perks leave them: its attack, its energy cost, the
 * ammo it spends without an attack, and the upgrade text other perks add to it ("Pour it On!: ..."
 * in their own text).
 * @param {object} ability       {name, system: {energyCost, description}}
 * @param {object[]} abilities   All the character's abilities
 * @param {(html: string) => string} [plain]   HTML to plain text
 */
export function abilityAsUpgraded(ability, abilities = [], plain = h => String(h ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()) {
  const rule = ruleFor(ability);
  const attack = rule?.attack ? { ...ATTACK_DEFAULTS, ...rule.attack, byType: { ...(rule.attack.byType ?? {}) } } : null;
  let ammoOnly = rule?.ammoOnly ?? 0;
  let energy = Number(ability.system?.energyCost) || 0;
  const setTo = [];
  const upgrades = [];
  const key = perkKey(ability.name);
  const names = abilities.map(a => a.name).filter(n => perkKey(n) !== key);
  for ( const other of abilities ) {
    if ( perkKey(other.name) === key ) continue;
    const up = ruleFor(other)?.upgrades;
    const change = up ? Object.entries(up).find(([n]) => perkKey(n) === key)?.[1] : null;
    if ( change ) {
      energy += Number(change.energy) || 0;
      if ( ammoOnly ) ammoOnly = Math.max(0, ammoOnly + (Number(change.ammoDelta) || 0));
      if ( attack ) {
        attack.accuracy += Number(change.accuracy) || 0;
        attack.critical += Number(change.critical) || 0;
        attack.blast += Number(change.blast) || 0;
        attack.damagePct += Number(change.damagePct) || 0;
        if ( change.accuracyTo !== undefined ) setTo.push(change.accuracyTo);
        if ( change.ammo !== undefined ) attack.ammo = Math.min(attack.ammo, change.ammo);
        if ( change.ammoDelta ) attack.ammo = Math.max(1, attack.ammo + change.ammoDelta);
        if ( change.crit ) attack.noCrit = false;
        if ( change.fullDamage ) attack.halfDamage = false;
      }
    }
    const text = upgradeText(plain(other.system?.description), ability.name, names);
    if ( text ) upgrades.push({ from: other.name, text });
  }
  // "Now made at +0", "-10 instead": the best of what the upgrades set it to, then what they add.
  if ( attack && setTo.length ) attack.accuracy = Math.min(...setTo) + (attack.accuracy - (rule.attack.accuracy ?? 0));
  return { attack, energy: Math.max(0, energy), ammoOnly, upgrades };
}

/** An active's accuracy with the weapon it is made with (Vital Shot is +20 with a sniper rifle). */
export function attackAccuracy(attack, weaponType) {
  const by = attack?.byType?.[weaponType];
  return (by !== undefined) ? by : (attack?.accuracy ?? 0);
}

/**
 * The part of an upgrade perk's text about one ability: "Pour it On!: After using this ability, ..."
 * up to the next ability named the same way, or the end.
 */
export function upgradeText(text, name, otherNames = []) {
  const at = findLabel(text, name);
  if ( at < 0 ) return "";
  const start = text.indexOf(":", at) + 1;
  let end = text.length;
  for ( const other of otherNames ) {
    const next = findLabel(text, other, start);
    if ( (next >= 0) && (next < end) ) end = next;
  }
  return text.slice(start, end).trim();
}

/** Where "Name:" or "Name :" starts in a text, from a position, or -1. */
function findLabel(text, name, from = 0) {
  const rx = new RegExp(`${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/!$/, "!?")}\\s?:`, "gi");
  rx.lastIndex = from;
  const m = rx.exec(text);
  return m ? m.index : -1;
}

/**
 * The derived armor rules a character's perks bring: {pct: {armorClass: n}, fullRegalia, drAll:
 * {armorClass: n}, drByTier: {armorClass: [n by tier]}}.
 */
export function armorPerks(abilities = []) {
  const out = { pct: {}, fullRegalia: false, drAll: {}, drByTier: {} };
  for ( const { rule } of perksOf(abilities) ) {
    const a = rule.armor ?? {};
    for ( const [cls, n] of Object.entries(a.pct ?? {}) ) out.pct[cls] = (out.pct[cls] ?? 0) + n;
    for ( const [cls, n] of Object.entries(a.drAll ?? {}) ) out.drAll[cls] = (out.drAll[cls] ?? 0) + n;
    for ( const [cls, list] of Object.entries(a.drByTier ?? {}) ) out.drByTier[cls] = list;
    if ( a.fullRegalia ) out.fullRegalia = true;
  }
  return out;
}

/** A worn armor's DR from perks, all types: Heavy Armor Mastery II's +1, Heavy Armor Paragon's 1/2/3 by tier. */
export function armorDrAll(perks, armor) {
  const cls = armor?.armorClass;
  const byTier = perks.drByTier?.[cls];
  const tier = Math.max(1, Number(armor?.tier) || 1);
  return (perks.drAll?.[cls] ?? 0) + (byTier ? (byTier[Math.min(byTier.length, tier) - 1] ?? 0) : 0);
}

/**
 * Bonuses perks put straight on the character: {bonuses: {path under system.bonuses: n},
 * attributes: {key: n}, critical: [attribute keys whose mod adds to the Critical stat]}.
 */
export function actorPerks(abilities = []) {
  const out = { bonuses: {}, attributes: {}, critical: [] };
  for ( const { rule } of perksOf(abilities) ) {
    const a = rule.actor ?? {};
    for ( const [path, n] of Object.entries(a.bonuses ?? {}) ) out.bonuses[path] = (out.bonuses[path] ?? 0) + n;
    for ( const [key, n] of Object.entries(a.attributes ?? {}) ) out.attributes[key] = (out.attributes[key] ?? 0) + n;
    out.critical.push(...(a.critical ?? []));
  }
  return out;
}

/** The extra mod slots perks give a weapon or armor: Munnr's axes, Medium Armor Mastery II's armor. */
export function slotPerks(abilities = [], item) {
  let n = 0;
  for ( const { rule } of perksOf(abilities) ) {
    for ( const s of rule.slots ?? [] ) {
      if ( item.type === "armor" ) { if ( s.armorClass && (s.armorClass === item.system.armorClass) ) n += s.value; }
      else if ( (item.type === "weapon") && !s.armorClass && fitsWeapon(s, item) ) n += s.value;
    }
  }
  return n;
}

/** Chemthrower perks: {fuelCost, dieUp, statusUp, saveDm, drBypass} for a chemthrower of this damage type. */
export function chemPerks(abilities = [], damageType = "") {
  const out = { fuelCost: 0, dieUp: 0, statusUp: 0, saveDm: 0, drBypass: 0, notes: [] };
  for ( const { item, rule } of perksOf(abilities) ) {
    const c = rule.chem;
    if ( !c ) continue;
    if ( c.damageTypes?.length && !c.damageTypes.includes(damageType) ) continue;
    for ( const k of ["fuelCost", "dieUp", "statusUp", "saveDm", "drBypass"] ) out[k] += Number(c[k]) || 0;
    out.notes.push(item.name);
  }
  return out;
}

/** A damage formula with its first die a size bigger per step: 1d4 to 1d6 (Chemical Stablization). */
export function dieUp(formula, steps = 1) {
  if ( !steps ) return formula;
  const sizes = [4, 6, 8, 10, 12, 20];
  return String(formula).replace(/(\d*)d(\d+)/i, (m, count, faces) => {
    const i = sizes.indexOf(Number(faces));
    return `${count}d${(i < 0) ? faces : sizes[Math.min(sizes.length - 1, i + steps)]}`;
  });
}

/** Uses a perk's rule gives it, or null: {max, per}. A max read from an attribute uses its mod. */
export function perkUses(name, attributes = {}) {
  const uses = (typeof name === "string" ? perkRule(name) : ruleFor(name))?.uses;
  if ( !uses ) return null;
  return { ...uses, max: uses.maxFrom ? Math.max(1, attributeValue(uses.maxFrom, attributes)) : uses.max };
}

/** What a perk does on its own, for its tooltip: "Automated: -4 to hit at Medium (rifle, saw); ...". */
export function automationText(name) {
  const rule = (typeof name === "string") ? perkRule(name) : ruleFor(name);
  if ( !rule ) return "";
  const parts = (rule.mods ?? []).map(m => {
    const types = (m.types?.length || m.classes?.length) ? ` (${[...(m.types ?? []), ...(m.classes ?? [])].join(", ")})` : "";
    const when = m.situation ? `, when ticked: ${m.situation}` : (m.hpBelow ? `, vs a target under ${m.hpBelow}% HP` : (m.scale ? `, per ${m.scale.label.toLowerCase()}` : ""));
    return `${modText(m)}${types}${when}`;
  });
  if ( rule.attack ) {
    const a = rule.attack;
    parts.push(`Use opens an attack${a.accuracy ? ` at ${signed(a.accuracy)} to hit` : ""}${a.critical ? `, ${signed(a.critical)} critical chance` : ""}${a.autoHit ? " that cannot miss" : ""}`
      + `${a.noCrit ? ", no critical" : ""}${a.halfDamage ? ", half damage" : ""}${a.damagePct ? `, ${signed(a.damagePct)}% damage` : ""}${a.noDefense ? ", ignoring Defense and armor DR" : ""}`
      + `${(a.ammo ?? 1) !== 1 ? `, ${a.ammo} ammo` : ""}${a.blast ? `, ${signed(a.blast)} blast radius` : ""}`);
  }
  if ( rule.ammoOnly ) parts.push(`Use spends ${rule.ammoOnly} ammo from the weapon in hand`);
  if ( rule.uses ) parts.push(`${rule.uses.maxFrom ? `half your ${rule.uses.maxFrom.attrs[0].toUpperCase()} mod in` : rule.uses.max} use${rule.uses.max === 1 ? "" : "s"} per ${rule.uses.per}, refilled at Session start`);
  if ( rule.upgrades ) parts.push(`changes ${Object.keys(rule.upgrades).join(" and ")}`);
  if ( rule.armor?.pct ) parts.push(Object.entries(rule.armor.pct).map(([c, n]) => `+${n}% armor HP on worn ${c} armor`).join(", "));
  if ( rule.armor?.drAll ) parts.push(Object.entries(rule.armor.drAll).map(([c, n]) => `+${n} DR to all damage in worn ${c} armor`).join(", "));
  if ( rule.armor?.drByTier ) parts.push(Object.entries(rule.armor.drByTier).map(([c, l]) => `+${l.join("/")} DR to all damage by ${c} armor tier`).join(", "));
  if ( rule.armor?.fullRegalia ) parts.push("+1 DR per slot on a full set of medium armor");
  if ( rule.actor?.bonuses ) parts.push(Object.entries(rule.actor.bonuses).map(([k, n]) => `${signed(n)} ${k.replace(/^move\./, "").replace(/\./g, " ")}`).join(", "));
  if ( rule.actor?.attributes ) parts.push(Object.entries(rule.actor.attributes).map(([k, n]) => `${signed(n)} ${k.toUpperCase()}`).join(", "));
  if ( rule.actor?.critical ) parts.push(`${rule.actor.critical.map(k => k.toUpperCase()).join(", ")} mod added again to Critical`);
  if ( rule.slots ) parts.push(rule.slots.map(s => `+${s.value} mod slot on ${s.armorClass ? `${s.armorClass} armor` : [...(s.types ?? []), ...(s.classes ?? [])].join(", ")}`).join(", "));
  if ( rule.chem ) {
    const c = rule.chem;
    parts.push([c.fuelCost ? `${signed(c.fuelCost)} fuel per burn` : "", c.dieUp ? "damage die one size up" : "", c.statusUp ? `status ${signed(c.statusUp)}` : "",
      c.saveDm ? `${signed(c.saveDm)} to the save` : "", c.drBypass ? `bypasses ${c.drBypass} DR` : ""].filter(Boolean).join(", ")
      + (c.damageTypes?.length ? ` (${c.damageTypes.join(", ")} chemthrowers)` : " (chemthrowers)"));
  }
  return parts.length ? `Automated: ${parts.join("; ")}.` : "";
}

/**
 * What a character's perks do with one weapon, for its row and its card (Johnald, 2026-10-18: "added
 * shred from shredder ... anywhere on the weapon card"): the totals of what always applies (whatever the
 * range band), and every perk in words, the band and tick box ones included.
 * @returns {{damage, critDamage, shred, penetration, attack, critical, blast, lines: string[]}}
 */
export function weaponPerkSummary(abilities, weapon, context = {}) {
  const options = perkOptions(abilities, { roll: "attack", weapon, ...context });
  const always = perkResult({ ...options, auto: options.auto.filter(m => !m.bands?.length) });
  const sum = list => list.reduce((s, l) => s + l.value, 0);
  const lines = [
    ...options.auto.map(m => m.text),
    ...options.situations.map(s => `When ticked, ${s.label}: ${s.text}`),
    ...options.scales.map(s => `Per ${s.label.split(": ").pop().toLowerCase()}: ${s.text}`)
  ];
  return { damage: always.damage, critDamage: always.critDamage, shred: always.shred, penetration: always.penetration,
    attack: sum(always.attack), critical: sum(always.critical), blast: always.blast, lines };
}

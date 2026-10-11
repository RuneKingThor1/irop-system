import { IROP } from "../config.mjs";
import { attackProfile } from "../rolls.mjs";
import { ENGAGED_BY_HANDLING } from "../rules/combat.mjs";
import { houseRules } from "../settings.mjs";
import { statusLabel, statusValue } from "../statuses.mjs";

/**
 * ARTEMIS (Johnald, 2026-10-10): the site's Discord bot that rolls from a character's
 * Foundry sheet, the way Avrae rolls from D&D Beyond. This file builds the sheet ARTEMIS
 * reads: every number worked out here, by this system's own rules (skill pools with the
 * world's house rules, attack targets and D.M.s, damage formulas with the character's
 * numbers filled in), so a roll in Discord can never disagree with one in Foundry.
 *
 * The format is the one the site checks (irop/functions/_lib/artemis/sheet.js). Change
 * one, change both, and raise SNAPSHOT_VERSION on both sides.
 */
export const SNAPSHOT_VERSION = 1;

/** "1d6 + @str.mod" with the character's numbers: "1d6 + 4". As the sheet shows formulas. */
export function resolveFormula(formula, data = {}) {
  return String(formula ?? "")
    .replace(/@([\w.]+)/g, (match, path) => {
      const v = foundry.utils.getProperty(data, path);
      return ((typeof v === "number") && Number.isFinite(v)) ? String(v) : match;
    })
    .replace(/\+\s*-\s*/g, "- ")
    .trim();
}

/** A picture's absolute address, for Discord to fetch. None for one only this machine can reach. */
export function absoluteImage(path, origin = "") {
  if ( !path ) return "";
  try {
    const url = new URL(path, origin || undefined);
    if ( !/^https?:$/.test(url.protocol) || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname) ) return "";
    return url.href;
  }
  catch {
    return "";
  }
}

/** One attack: a weapon, or a paraphysical ability that attacks. */
function attackEntry(item, rollData) {
  const s = item.system;
  const profile = attackProfile(item);
  if ( !profile ) return null;
  const weapon = item.type === "weapon";
  const damage = profile.damage ? {
    formula: resolveFormula(profile.damage.formula, rollData),
    type: profile.damage.type,
    typeLabel: IROP.damageTypes[profile.damage.type]?.label ?? profile.damage.type ?? "",
    critDamage: profile.damage.critDamage ?? 0,
    shred: profile.damage.shred ?? 0,
    penetration: profile.damage.penetration ?? 0,
    destruction: profile.damage.destruction ?? 0
  } : null;
  const counted = weapon && ((["grenade", "rocket", "explosive"].includes(s.weaponClass)) || (s.feed === "singleUse"));
  return {
    id: item.id,
    name: item.name,
    kind: profile.paraphysical ? "paraphysics" : "weapon",
    category: profile.category,
    classLabel: weapon ? (IROP.weaponClasses[s.weaponClass] ?? "") : "Paraphysics",
    equipped: weapon ? !!s.equipped : true,
    attribute: profile.attribute ?? null,
    // The D.M. it puts on the roll: the sheet's accuracy 30 is -30, easier.
    accuracy: -(profile.accuracy ?? 0),
    ranges: profile.ranges ? Object.fromEntries(Object.keys(IROP.rangeBands).map(band => [band, {
      tiles: profile.ranges[band]?.tiles ?? 0, dm: profile.ranges[band]?.dm ?? 0
    }])) : null,
    engaged: (profile.ranged || profile.thrown) ? (ENGAGED_BY_HANDLING[profile.handling] ?? "engaged") : null,
    critChance: profile.critChance ?? 0,
    special: profile.ammo ? { name: profile.ammo.name, accuracy: profile.ammo.accuracy ?? 0, critical: profile.ammo.critical ?? 0 } : null,
    damage,
    ammo: (weapon && s.usesAmmo) ? { value: s.ammo.value, max: s.ammo.max } : null,
    quantity: counted ? (s.quantity ?? 0) : null,
    loaded: (weapon && s.projectileSlots) ? s.loaded.map(l => l.name) : null,
    projectile: profile.projectile?.name ?? null,
    scatter: profile.scatter ?? null,
    blast: profile.blast ?? 0,
    // A chemthrower burns rather than rolls to hit: the target saves (RULED 2026-10-08).
    burn: (weapon && (s.feed === "fuel")) ? { save: s.burn.save, saveLabel: IROP.attributes[s.burn.save]?.label ?? "" } : null
  };
}

/**
 * The sheet ARTEMIS reads, for one operative.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {string} [options.origin]   This Foundry's address, to make picture paths absolute
 * @param {{id: string, title: string}} [options.world]
 * @param {string} [options.systemVersion]
 */
export function buildSnapshot(actor, { origin = "", world = null, systemVersion = "" } = {}) {
  const s = actor.system;
  const items = [...(actor.items ?? [])];
  const first = type => items.find(i => i.type === type) ?? null;
  const role = first("role");
  const rollData = actor.getRollData?.() ?? actor.system.getRollData?.() ?? {};
  // A rocket is ammunition for a launcher, not fired on its own (RULED 2026-10-08): carried, not an attack.
  const rocket = i => (i.type === "weapon") && (i.system.weaponClass === "rocket");
  const pool = p => ({ value: p?.value ?? 0, max: p?.max ?? 0 });

  return {
    v: SNAPSHOT_VERSION,
    system: { id: "irop", version: systemVersion },
    world: { id: world?.id ?? "", title: world?.title ?? "" },
    actor: { id: actor.id, name: actor.name, img: absoluteImage(actor.img, origin) },
    details: {
      callsign: s.details?.callsign ?? "",
      role: { key: role?.system.role ?? "", label: role?.name ?? "" },
      species: first("species")?.name ?? "",
      background: first("background")?.name ?? "",
      rank: IROP.ranks[s.details?.record?.rank]?.label ?? ""
    },
    attributes: Object.fromEntries(Object.entries(s.attributes).map(([key, a]) => [key, { value: a.value, mod: a.mod }])),
    skills: Object.entries(s.skills).map(([key, k]) => ({
      key, label: k.label, attribute: k.attribute, rank: k.rank,
      skill: k.pool?.skill ?? 0, aptitude: k.pool?.aptitude ?? 0, floored: !!k.pool?.floored
    })),
    vitals: {
      hp: pool(s.vitals.hp), energy: pool(s.vitals.energy), armor: pool(s.vitals.armor),
      barrier: pool(s.vitals.barrier), luck: pool(s.vitals.luck), dodges: pool(s.vitals.dodges)
    },
    combat: {
      critical: s.critical ?? 0,
      defense: s.defense ?? 0,
      initiativeBonus: s.initiativeBonus ?? 0,
      movement: { ...(s.movement ?? { shift: 0, run: 0, sprint: 0 }) },
      throwRange: s.throwRange ?? 0
    },
    banks: { edge: s.banks?.edge ?? 0, victory: s.banks?.victory ?? 0 },
    wealth: { credits: s.wealth?.credits ?? 0, valuables: s.wealth?.valuables ?? 0, alloys: s.wealth?.alloys ?? 0 },
    // A status's X in its name, "Ignited (3)", as the sheet keeps it (2026-10-10).
    statuses: [...(actor.statuses ?? [])].map(id => ({ id, name: statusLabel(id, statusValue(actor, id)) })),
    attacks: items
      .filter(i => ((i.type === "weapon") && !i.system.stowed && !rocket(i)) || ((i.type === "ability") && i.system.paraphysics?.attack))
      .map(i => attackEntry(i, rollData))
      .filter(Boolean),
    armor: items.filter(i => (i.type === "armor") && i.system.equipped && !i.system.stowed)
      .map(i => ({ name: i.name, defense: i.system.defense ?? 0, points: i.system.points ?? 0 })),
    gear: items.filter(i => (["gear", "mod"].includes(i.type) && !((i.type === "mod") && i.system.installedOn)) || rocket(i))
      .map(i => ({ name: i.name, quantity: i.system.quantity ?? 1, stowed: !!i.system.stowed })),
    carry: { value: s.carry?.value ?? 0, max: s.carry?.max ?? 0 },
    // The world's DYNOSRS house rule, so a stalemate in Discord breaks as it would here.
    rules: { tiebreak: houseRules().tiebreakWithEdgeAndDanger !== false },
    updatedAt: new Date().toISOString()
  };
}

/** The sheet's content, without the time it was taken, to tell whether anything changed. */
export function snapshotKey(snapshot) {
  const { updatedAt, ...rest } = snapshot;
  return JSON.stringify(rest);
}

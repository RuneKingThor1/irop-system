/**
 * Weapon phases (Johnald, 2026-10-23): a weapon with more than one way to fight. The Bio-Spike
 * Launcher grows as an Assault Rifle, a DMR or a Shotgun; a GENESIS phased weapon is a greatsword
 * that can cleave, or be switched to an electrified phase that stuns. A weapon with phases holds
 * one at a time, and switching is an action. Pure, so it can be tested.
 *
 * A phase leaves blank whatever it does not change: a blank damage formula or type, or a range
 * with no tiles, keeps the weapon's own. Cleave is the reach of an arc (a cone) in front of the
 * wielder, offered as its own attack. A save is made by each target hit, against the status.
 */

/** The phase the weapon is in: the one picked, else its first. Null when it has none. */
export function activePhase(system) {
  const phases = system?.phases ?? [];
  if ( !phases.length ) return null;
  return phases.find(p => p.id === system.phase) ?? phases[0];
}

/** Whether a range has any tiles in it. */
function hasRange(range) {
  return Object.values(range ?? {}).some(b => Number(b?.tiles) > 0);
}

/**
 * The weapon's numbers in its current phase: damage, accuracy, critical, range, and the phase's
 * cleave and save. With no phases, the weapon's own.
 */
export function phasedStats(system) {
  const p = activePhase(system);
  const base = {
    phase: null, label: "",
    damage: { formula: system?.damage?.formula ?? "", type: system?.damage?.type ?? "ballistic" },
    accuracy: Number(system?.accuracy) || 0,
    critical: { chance: Number(system?.critical?.chance) || 0, damage: Number(system?.critical?.damage) || 0 },
    range: system?.range ?? {},
    cleave: 0, save: null, text: ""
  };
  if ( !p ) return base;
  const formula = String(p.damage?.formula ?? "").trim();
  return {
    phase: p.id, label: p.label || "Phase",
    damage: { formula: formula || base.damage.formula, type: p.damage?.type || base.damage.type },
    accuracy: base.accuracy + (Number(p.accuracy) || 0),
    critical: { chance: base.critical.chance + (Number(p.critChance) || 0), damage: base.critical.damage + (Number(p.critDamage) || 0) },
    range: hasRange(p.range) ? p.range : base.range,
    cleave: Math.max(0, Number(p.cleave) || 0),
    save: p.save ? { attribute: p.save, dm: Number(p.saveDm) || 0, status: p.status || "", statusValue: Number(p.statusValue) || 0 } : null,
    text: p.text ?? ""
  };
}

/** The phase to switch to, by id: null if the weapon has no such phase or is already in it. */
export function nextPhase(system, id) {
  const phases = system?.phases ?? [];
  const to = phases.find(p => p.id === id);
  if ( !to ) return null;
  return (activePhase(system)?.id === to.id) ? null : to;
}

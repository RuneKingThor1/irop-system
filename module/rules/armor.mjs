/**
 * The armor pool follows what is worn (bug fix, Johnald, 2026-10-10: "unequip armor and equip
 * it, the armor bar doesn't fill and unfill"). The pool's max is the points of the armor worn;
 * its value is stored. Putting armor on adds its points to the value; taking it off takes its
 * points away (and with them any damage it had taken: the damage was in that armor). Swapping
 * one suit for another takes the old one off first, so the new one goes on fresh. Changing the
 * points of armor being worn moves the value by the difference. Kept apart from Foundry so it can
 * be tested on its own.
 */

/** Whether an armor item is worn: equipped and not stowed. */
export function isWorn(item) {
  return (item?.type === "armor") && !!item.system?.equipped && !item.system?.stowed;
}

/** An armor item's points. */
export function armorPoints(item) {
  return Math.max(0, Number(item?.system?.points) || 0);
}

/**
 * What a change to one piece of armor does to the pool.
 * @param {{worn: boolean, points: number}} before
 * @param {{worn: boolean, points: number}} after
 * @returns {{removed: number, added: number}}
 */
export function armorChange(before, after) {
  if ( before.worn && after.worn ) return { removed: 0, added: after.points - before.points };
  if ( after.worn ) return { removed: 0, added: after.points };
  if ( before.worn ) return { removed: before.points, added: 0 };
  return { removed: 0, added: 0 };
}

/**
 * The pool's value after armor comes off and goes on: what came off first (never below 0),
 * then what went on, held to the new max.
 */
export function nextArmorValue(value, { removed = 0, added = 0 } = {}, max = Infinity) {
  const left = Math.max(0, (Number(value) || 0) - removed);
  return Math.max(0, Math.min(Math.max(0, Number(max) || 0), left + added));
}

/** The pool's max once the change lands: the points worn (leaving out any pieces going), plus its bonus. */
export function wornArmorMax(actor, { without = [] } = {}) {
  const worn = (actor?.items ?? []).filter(i => isWorn(i) && !without.includes(i.id));
  return worn.reduce((n, i) => n + armorPoints(i), 0) + (Number(actor?.system?.vitals?.armor?.bonus) || 0);
}

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

/**
 * Additive Armor HP (Johnald, 2026-10-30: Crystalline Skin). It sits on top of what is worn in one
 * pool and is spent first, so whatever stands above the worn points is what is left of it. It does
 * not stack with itself, and lasts until the end of the fight or until depleted.
 */

/** The pool's top: the worn points, plus the grant while any of it is left. */
export function armorHpMax(worn, value, granted) {
  const w = Math.max(0, Number(worn) || 0);
  return ((Number(value) || 0) > w) ? w + Math.max(0, Number(granted) || 0) : w;
}

/** Granting Armor HP: replaces what is left of an earlier grant. Null if that much or more is left. */
export function armorHpGrant(pool, amount) {
  const n = Math.max(0, Number(amount) || 0);
  const value = Math.max(0, Number(pool?.value) || 0);
  const worn = Math.max(0, Number(pool?.worn) || 0);
  if ( !n || ((value - worn) >= n) ) return null;
  return { value: Math.min(value, worn) + n, granted: n };
}

/** The end of the fight: what is left of a grant goes. Null if there is nothing to clear. */
export function armorHpClear(pool) {
  if ( !(Number(pool?.granted) > 0) ) return null;
  const value = Math.max(0, Number(pool?.value) || 0);
  return { value: Math.min(value, Math.max(0, Number(pool?.worn) || 0)), granted: 0 };
}

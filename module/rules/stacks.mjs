/**
 * What stacks on a character sheet: things counted rather than kept one by one. Gear always
 * has (stacked by name); weapons used up by count joined it (Johnald, 2026-10-10: grenades
 * dragged from the sidebar did not stack). Guns, blades and launchers stay one item each, since
 * each carries its own mods, ammo and loaded slots. Kept apart from Foundry so it can be tested.
 */

/** Weapon classes used up one at a time: thrown or launched, then gone. */
export const COUNTED_WEAPON_CLASSES = ["grenade", "rocket", "explosive"];

/** Whether a weapon is used up by count: a grenade, rocket or explosive, or a single-use launcher (the LAW). */
export function isCountedWeapon(item) {
  if ( item?.type !== "weapon" ) return false;
  const s = item.system ?? {};
  return COUNTED_WEAPON_CLASSES.includes(s.weaponClass) || (s.feed === "singleUse");
}

/** Whether an item stacks: gear, or a weapon used up by count. */
export function isStackable(item) {
  return (item?.type === "gear") || isCountedWeapon(item);
}

/**
 * The stack an item dropped on the sheet joins: one of the same type and name, preferring one
 * not stowed away. None for things that do not stack.
 * @param {Iterable<Item>} items   The character's items
 * @param {Item} item              The item dropped
 * @returns {Item|null}
 */
export function stackFor(items, item) {
  if ( !isStackable(item) ) return null;
  // Not by id: an item from the sidebar can share its id with the copy it made on the sheet.
  const same = [...(items ?? [])].filter(i => (i !== item) && (i.type === item.type) && (i.name === item.name) && isStackable(i));
  return same.find(i => !i.system?.stowed) ?? same[0] ?? null;
}

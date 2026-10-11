/**
 * Whether an owned item's effects are switched off on its owner.
 *
 * Weapons and armor work only while equipped (worn armor, a weapon in hand) and
 * not stowed. RULED 2026-10-08 (Johnald, a bug report): a mod works only while
 * fitted to a weapon or armor that is itself in use, so mods on spare armor, an
 * unequipped weapon or anything stowed do nothing; a loose mod, or one whose host
 * is gone, does nothing either. Special ammo loaded into a weapon follows its
 * weapon the same way. Other gear works unless it is stowed.
 *
 * @param {Item} item    The item that owns the effect
 * @returns {boolean|null}    null when the rule does not cover the item type
 */
export function itemEffectsSuppressed(item) {
  const s = item.system;
  const inUse = host => !!host && !!host.system?.equipped && !host.system?.stowed;
  switch ( item.type ) {
    case "mod": return !inUse(s.host);
    case "weapon":
    case "armor": return !s.equipped || !!s.stowed;
    case "gear":
      if ( s.stowed ) return true;
      if ( s.loadedHost ) return !inUse(s.loadedHost);
      return false;
    default: return null;
  }
}

/**
 * SQUAD SIGHT (Johnald, 2026-10-08)
 * =================================
 *
 * A player sees what every friendly token on the scene can see, not only through
 * their own. Hostile, neutral and secret tokens never share their sight, and nor
 * does a token the GM has hidden. The GM's view is unchanged. A world setting
 * (Squad sight, on by default) turns it off.
 *
 * Foundry decides, token by token, whether a token is one of this user's vision
 * sources (Token#_isVisionSource): a token they control, or else one they can
 * observe. Squad sight adds: any friendly token with sight. Everything else about
 * vision (light, darkness, detection modes, fog) then follows on its own.
 */

/** The setting's key. */
export const SQUAD_SIGHT = "squadSight";

/** Whether this world plays with squad sight; on if settings are not ready. */
export function squadSightOn() {
  try {
    return game.settings.get("irop", SQUAD_SIGHT);
  }
  catch {
    return true;
  }
}

/**
 * Whether a token lends its sight to this user under squad sight.
 * @param {Token} token                 A token on the canvas
 * @param {object} [options]
 * @param {boolean} [options.enabled]   The setting
 * @param {User} [options.user]         Whose view
 */
export function sharesSquadSight(token, { enabled = squadSightOn(), user = game.user } = {}) {
  if ( !enabled || !user || user.isGM ) return false;
  if ( !canvas?.visibility?.tokenVision || !token?.hasSight ) return false;
  const doc = token.document;
  if ( !doc || doc.hidden ) return false;
  // Only tokens on the level being viewed can see.
  if ( canvas.level && ("level" in doc) && (doc.level !== canvas.level.id) ) return false;
  return doc.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
}

/**
 * The canvas Token class with squad sight: Foundry's own vision sources, plus every
 * friendly token. Built on whatever Token class is configured, so a module that
 * replaced it first keeps its changes.
 * @param {typeof Token} Base
 */
export function squadSightToken(Base) {
  return class IropToken extends Base {
    /** @override */
    _isVisionSource() {
      return super._isVisionSource() || sharesSquadSight(this);
    }
  };
}

/** Recompute every token's vision on the scene, as Foundry does when control changes. */
export function refreshSquadSight() {
  if ( !canvas?.ready ) return;
  for ( const token of canvas.tokens.placeables ) token.initializeVisionSource();
  canvas.perception.update({ refreshVision: true, refreshSounds: true, refreshOcclusion: true });
}

/**
 * A token turned friendly, or turned away from friendly, starts or stops lending
 * its sight. Foundry does not recompute vision for a disposition change, so this does.
 */
export function onTokenDisposition(doc, changed) {
  if ( !("disposition" in (changed ?? {})) || game.user?.isGM || !squadSightOn() ) return;
  const token = doc.object;
  if ( !token ) return;
  token.initializeVisionSource();
  canvas.perception.update({ refreshVision: true, refreshSounds: true, refreshOcclusion: true });
}

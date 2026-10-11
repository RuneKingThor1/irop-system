import { IROP } from "../config.mjs";

/**
 * The turn marker in the sides' colors (bug fix, Johnald, 2026-10-11: "I tried with the Color by
 * Side ticked and its all still white").
 *
 * Foundry's Disposition Tint colors a marker with a shader that keeps bright parts bright: pure white
 * stays white whatever the side's color, and a grey image comes out darker or paler than the color
 * itself. So for the system's own marker, which is drawn in white, the side's color is also put on
 * the marker as a plain tint: white times the color is the color, exactly.
 *
 * Kept true on every frame for the few markers on the scene (one, as a rule), so a redraw by any
 * path, a token changing sides, or the setting turned on or off shows at once. Only when Disposition
 * Tint is on, and only for the system's marker; another image is left as Foundry draws it.
 */

const MODES = () => globalThis.CONST?.TOKEN_TURN_MARKER_MODES ?? { DISABLED: 0, DEFAULT: 1, CUSTOM: 2 };

/** A token's marker settings as Foundry merges them: the GM's, or the token's own over them when custom. */
function markerConfig(tokenDoc) {
  const own = tokenDoc?.turnMarker ?? {};
  const shared = CONFIG.Combat?.settings?.turnMarker ?? {};
  return (own.mode === MODES().CUSTOM) ? { ...shared, ...own } : { ...shared };
}

/** The image a token's turn marker shows, as Foundry picks it: the token's own, the GM's, or the fallback. */
export function markerSource(tokenDoc) {
  return markerConfig(tokenDoc).src || CONFIG.Combat?.fallbackTurnMarker || "";
}

/** Whether Disposition Tint is on for a token's marker. */
export function dispositionTintOn(tokenDoc) {
  return !!markerConfig(tokenDoc).disposition;
}

/** The tint for a token's marker: its side's color by Disposition Tint, white otherwise; null to leave it be. */
export function markerTint(token) {
  const doc = token?.document;
  if ( markerSource(doc) !== IROP.turnMarker ) return null;
  return dispositionTintOn(doc) ? token.getDispositionColor() : 0xFFFFFF;
}

/** Each frame: every marker on the scene in its side's color. */
export function syncTurnMarkerTints() {
  for ( const token of globalThis.canvas?.tokens?.turnMarkers ?? [] ) {
    const mesh = token.turnMarker?.mesh;
    if ( !mesh || mesh.destroyed ) continue;
    const tint = markerTint(token);
    if ( (tint !== null) && (mesh.tint !== tint) ) mesh.tint = tint;
  }
}

/** Run the sync on the canvas's ticker, once, from each scene's first draw. */
export function watchTurnMarkers() {
  const ticker = globalThis.canvas?.app?.ticker;
  if ( !ticker ) return;
  ticker.remove(syncTurnMarkerTints);
  ticker.add(syncTurnMarkerTints);
}

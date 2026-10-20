import { setStatus, statusEffectOn } from "./statuses.mjs";

/**
 * Telestoian Glamor (Johnald, 2026-10-20): a disguise held on the minds around the Telestoi. It
 * holds while they are conscious and keep 3 Energy committed: raising it takes 3 Energy out of
 * reach (the Energy and its maximum each 3 lower), and letting it go gives them back. It falls on
 * its own if they go down (Bleeding Out or Dead). Disorientated does not break it, and neither does
 * the Telesma's pulse when they cast. The Glamor ability toggles it; the token shows the status.
 */

export const GLAMOR_COST = 3;

const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** Is this ability the Glamor? Marked by the macro that made it, or by its name. */
export function isGlamor(item) {
  if ( item?.flags?.irop?.glamor ) return true;
  return String(item?.name ?? "").toLowerCase().replace(/[^a-z]/g, "") === "telestoianglamor";
}

/** The Glamor effect on a character, if it is up. */
export function glamorOn(actor) {
  return statusEffectOn(actor, "glamor");
}

async function say(actor, html) {
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<div class="irop-card glamor-card"><p><i class="fa-solid fa-masks-theater"></i> ${html}</p></div>`
  });
}

/** Raise the Glamor: 3 Energy committed. Refused with fewer than 3, or while down. */
export async function raiseGlamor(actor) {
  if ( glamorOn(actor) ) return null;
  if ( actor.statuses?.has?.("bleedingOut") || actor.statuses?.has?.("dead") ) return ui.notifications.warn(`${actor.name} cannot hold a Glamor while down.`);
  const energy = Number(actor.system?.vitals?.energy?.value) || 0;
  if ( energy < GLAMOR_COST ) return ui.notifications.warn(`The Glamor needs ${GLAMOR_COST} Energy committed; ${actor.name} has ${energy}.`);
  await actor.update({ "system.vitals.energy.value": energy - GLAMOR_COST });
  const effect = await setStatus(actor, "glamor");
  await effect?.update?.({ "system.changes": [{ key: "system.vitals.energy.bonus", type: "add", value: String(-GLAMOR_COST) }] });
  return say(actor, `<strong>${escape(actor.name)}</strong> raises a Glamor (${GLAMOR_COST} Energy committed).`);
}

/** Let the Glamor go, or lose it ("down"): the committed Energy comes back. */
export async function dropGlamor(actor, why = "") {
  const effect = glamorOn(actor);
  if ( !effect ) return null;
  await effect.delete();
  const energy = Number(actor.system?.vitals?.energy?.value) || 0;
  await actor.update({ "system.vitals.energy.value": energy + GLAMOR_COST });
  return say(actor, (why === "down")
    ? `<strong>${escape(actor.name)}</strong> goes down, and the Glamor falls.`
    : `<strong>${escape(actor.name)}</strong> lets the Glamor fall.`);
}

/** The Glamor ability's Use: up if down, down if up. */
export async function toggleGlamor(actor) {
  return glamorOn(actor) ? dropGlamor(actor) : raiseGlamor(actor);
}

/** Going down (Bleeding Out or Dead) drops the Glamor, on the client that put the status on. */
export function registerGlamor() {
  Hooks.on("createActiveEffect", (effect, options, userId) => {
    if ( userId !== game.user?.id ) return;
    if ( !(effect.statuses?.has?.("bleedingOut") || effect.statuses?.has?.("dead")) ) return;
    const actor = effect.parent;
    if ( actor && glamorOn(actor) ) dropGlamor(actor, "down");
  });
}

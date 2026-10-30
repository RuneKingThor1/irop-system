import { setStatus, statusEffectOn } from "./statuses.mjs";

/**
 * Concentration (Paraphysics Framework Draft 0.6, PSI-07; built 2026-10-20). A power that needs
 * Concentration puts the Concentrating status on its caster, naming the power on the status. One
 * at a time: concentrating on a new power lets the old one go. Disorientated breaks it the moment
 * it lands, which is what makes a flashbang the universal counter; the caster can also let it go
 * from the Paraphysics tab, or by taking the status off.
 */

const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** What a character is concentrating on: {effect, itemId, name}, or null. */
export function concentrationOn(actor) {
  const effect = statusEffectOn(actor, "concentrating");
  if ( !effect ) return null;
  const c = effect.flags?.irop?.concentration ?? {};
  return { effect, itemId: c.itemId ?? "", name: c.name ?? "a power", steadfast: !!c.steadfast };
}

/** A chat line about a character's Concentration. */
async function say(actor, html) {
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<div class="irop-card concentration-card"><p><i class="fa-solid fa-brain"></i> ${html}</p></div>`
  });
}

/** Start concentrating on a power; a power already held is let go, and said so. */
export async function startConcentration(actor, item, name = item?.name, { steadfast = false } = {}) {
  if ( !actor || !item ) return null;
  const now = concentrationOn(actor);
  if ( now && (now.itemId === item.id) ) return now.effect;
  if ( now ) await say(actor, `<strong>${escape(actor.name)}</strong> lets go of <strong>${escape(now.name)}</strong> to concentrate on <strong>${escape(name)}</strong>.`);
  const effect = now?.effect ?? await setStatus(actor, "concentrating");
  // A new power's Concentration starts fresh: any rounds the last one had go (2026-10-20).
  // Steadfast (2026-10-29): only the caster drops it; Disorientated does not break it.
  await effect?.update?.({ "flags.irop.concentration": { itemId: item.id, name, steadfast: !!steadfast }, "flags.irop.rounds": null, "flags.irop.timedName": "", "system.changes": [] });
  return effect;
}

/** End a character's Concentration, saying why: "Disorientated", "let go". */
export async function endConcentration(actor, why = "") {
  const now = concentrationOn(actor);
  if ( !now ) return null;
  await now.effect.delete();
  return say(actor, why === "Disorientated"
    ? `<strong>${escape(actor.name)}</strong> is Disorientated: Concentration on <strong>${escape(now.name)}</strong> breaks.`
    : `<strong>${escape(actor.name)}</strong> lets go of <strong>${escape(now.name)}</strong>.`);
}

/**
 * Disorientated landing on a concentrating character breaks it. Run by whoever put the status on,
 * so it happens once and by someone allowed to change that character.
 */
export function registerConcentration() {
  Hooks.on("createActiveEffect", (effect, options, userId) => {
    if ( userId !== game.user?.id ) return;
    if ( !effect.statuses?.has?.("disorientated") ) return;
    const actor = effect.parent;
    const now = actor ? concentrationOn(actor) : null;
    if ( !now ) return;
    if ( now.steadfast ) return say(actor, `<strong>${escape(actor.name)}</strong> is Disorientated, but Concentration on <strong>${escape(now.name)}</strong> holds: only the caster can drop it.`);
    endConcentration(actor, "Disorientated");
  });
}

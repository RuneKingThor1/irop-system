import { IROP } from "./config.mjs";

/**
 * Status effects with an (X) (Johnald, 2026-10-10: "when applying it from a character sheet you
 * get a popup that will let you fill in the number for X"). X is kept on the status's effect, as
 * flags.irop.counter, and in its name, "Ignited (3)", so it reads wherever Foundry shows the
 * effect. Nothing counts X down yet: that is changed by hand (a right-click on the sheet).
 */

const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** A status's entry in IROP.statusEffects, by id. */
export function statusDef(id) {
  return IROP.statusEffects.find(s => s.id === id) ?? null;
}

/** A status's name with its X, "Ignited (3)"; the plain name without one. */
export function statusLabel(id, value) {
  const name = statusDef(id)?.name ?? id;
  return value ? `${name} (${value})` : name;
}

/** An X as typed: a whole number of at least 1, or null. */
export function cleanStatusValue(value) {
  const n = Math.round(Number(value));
  return (Number.isFinite(n) && (n >= 1)) ? n : null;
}

/** The effect that carries a status by itself on an actor, as Foundry's own toggle finds it. */
export function statusEffectOn(actor, id) {
  for ( const effect of actor?.effects ?? [] ) {
    if ( (effect.statuses?.size === 1) && effect.statuses.has(id) ) return effect;
  }
  return null;
}

/** An actor's X for a status: 0 when the status is off or carries none. */
export function statusValue(actor, id) {
  return Number(statusEffectOn(actor, id)?.flags?.irop?.counter) || 0;
}

/**
 * Put a status on an actor with its X, or change the X of one it already has. A status without
 * an (X) goes on plain.
 */
export async function setStatus(actor, id, value) {
  const counter = statusDef(id)?.counter ? (cleanStatusValue(value) ?? 1) : null;
  const update = { name: statusLabel(id, counter), "flags.irop.counter": counter };
  const existing = statusEffectOn(actor, id);
  if ( existing ) return existing.update(update);
  const cls = CONFIG.ActiveEffect.documentClass;
  const effect = await cls.fromStatusEffect(id, { parent: actor });
  effect.updateSource(update);
  return cls.create(effect.toObject(), { parent: actor, keepId: true });
}

/**
 * Ask for a status's X in a popup, with the status's rules above it.
 * @returns {Promise<number|null>}  The X, or null if dismissed or left empty.
 */
export async function askStatusValue(id, { current = 1, actorName = "" } = {}) {
  const def = statusDef(id);
  if ( !def ) return null;
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: actorName ? `${def.name} (X): ${actorName}` : `${def.name} (X)` },
    classes: ["irop", "irop-status-dialog"],
    position: { width: 420 },
    content: `<p class="hint">${escape(def.text)}</p>
      <label class="wide-field"><span>X${def.counterHint ? `, ${escape(def.counterHint)}` : ""}</span>
      <input type="number" name="value" value="${cleanStatusValue(current) ?? 1}" min="1" step="1" autofocus></label>`,
    ok: { label: "Apply", icon: "fa-solid fa-check" },
    rejectClose: false
  });
  return data ? cleanStatusValue(data.value) : null;
}

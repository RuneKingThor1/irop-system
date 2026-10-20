import { tickEffects, timedName } from "./rules/durations.mjs";

/**
 * Durations counting down in play (2026-10-20; the rules in rules/durations.mjs). When a combatant's
 * turn starts, the active GM's client ticks what that character carries, and the chat says what
 * happened: damage the status deals now, X dropping, effects ending. A character with a player
 * owner gets it in the open; an NPC's goes to the GM alone. Going back a turn ticks nothing.
 */

const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** A character's effects as the countdown reads them. */
export function effectsFor(actor) {
  return (actor?.effects?.contents ?? Array.from(actor?.effects ?? [])).map(e => ({
    id: e.id, name: e.name, statuses: Array.from(e.statuses ?? []),
    counter: e.flags?.irop?.counter ?? null,
    rounds: (e.flags?.irop?.rounds ?? null),
    timedName: e.flags?.irop?.timedName ?? ""
  }));
}

/** Tick one character's effects, and say so. */
export async function tickActor(actor) {
  if ( !actor ) return null;
  const { ops, lines } = tickEffects(effectsFor(actor));
  if ( !ops.length ) return null;
  const remove = ops.filter(o => o.remove).map(o => o.id);
  const update = ops.filter(o => o.update).map(o => ({ _id: o.id, ...o.update }));
  if ( update.length ) await actor.updateEmbeddedDocuments("ActiveEffect", update);
  if ( remove.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", remove);
  if ( !lines.length ) return null;
  const gm = ChatMessage.implementation.getWhisperRecipients?.("GM") ?? [];
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<div class="irop-card turn-start-card"><header class="card-head"><h3>${escape(actor.name)}'s turn</h3><span class="card-sub">Start of turn</span></header>
      ${lines.map(l => `<p>${escape(l)}</p>`).join("")}</div>`,
    ...(actor.hasPlayerOwner ? {} : { whisper: gm.map(u => u.id) })
  });
}

/**
 * Give a character something that lasts a number of rounds: a power's Duration (2026-10-20). A
 * power held in Concentration carries its rounds on the Concentrating status, so the two end
 * together; anything else gets an effect of its own, shown on the Effects tab.
 */
export async function startTimed(actor, { name, img = "icons/svg/clockwork.svg", rounds, effect = null } = {}) {
  const n = Math.max(0, Math.floor(Number(rounds) || 0));
  if ( !actor || !n ) return null;
  if ( effect ) return effect.update({ "flags.irop.rounds": n, "flags.irop.timedName": name });
  const cls = CONFIG.ActiveEffect.documentClass;
  return cls.create({ name: timedName(name, n), img, flags: { irop: { rounds: n, timedName: name } } }, { parent: actor });
}

/** At the start of each turn, the active GM's client ticks the combatant whose turn it is. */
export function registerDurations() {
  Hooks.on("updateCombat", (combat, changed, options) => {
    if ( !(("turn" in changed) || ("round" in changed)) ) return;
    if ( (options?.direction ?? 1) < 0 ) return;
    const gm = game.users?.activeGM;
    if ( gm ? !gm.isSelf : !game.user?.isGM ) return;
    tickActor(combat.combatant?.actor ?? null);
  });
}

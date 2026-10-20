import { resetSystem, resetItems, keptWords } from "./rules/reset.mjs";

/**
 * Reset an operative in one go (Johnald, 2026-10-08), from the ⋮ menu on its sheet, after a
 * confirm. The owner or a GM; only a GM may keep the XP earned, since players cannot
 * retrain their perks themselves (RULED 2026-10-08: picks are soft permanent).
 */

const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** Whether this user may reset an operative. */
export function canReset(actor, user = game.user) {
  return (actor?.type === "operative") && !!(user?.isGM || actor.isOwner);
}

/**
 * Ask whether to reset, and what to keep, then reset.
 * @param {Actor} actor
 * @returns {Promise<Actor|null>}
 */
export async function confirmReset(actor) {
  if ( !canReset(actor) ) return null;
  const isGM = !!game.user.isGM;
  const name = escape(actor.name);
  const keep = await foundry.applications.api.DialogV2.wait({
    window: { title: `Reset ${actor.name}?`, icon: "fa-solid fa-rotate-left" },
    classes: ["irop", "irop-roll-dialog", "irop-reset-dialog"],
    content: `<div class="irop-dialog">
      <p>This makes <strong>${name}</strong> a new operative again. Attributes, skills, health, banks and XP go back to
        their starting values, and every role, species, background, ability, perk, boon and mutation is removed, with
        anything they were doing to the sheet.</p>
      <p class="reset-warning"><i class="fa-solid fa-triangle-exclamation"></i> Are you sure? This cannot be undone.</p>
      <label class="check"><input type="checkbox" name="identity"> Keep who they are: callsign, Personnel Record, biography and notes</label>
      <label class="check"><input type="checkbox" name="gear"> Keep their weapons, armor, gear and wealth</label>
      ${isGM ? "<label class=\"check\"><input type=\"checkbox\" name=\"xp\"> Keep the XP earned and psycrystals, refunding everything spent</label>" : ""}
      <p class="hint">The name, portrait, token and owners stay.</p>
    </div>`,
    buttons: [
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark", default: true },
      {
        action: "reset", label: `Reset ${actor.name}`, icon: "fa-solid fa-rotate-left", class: "irop-danger",
        callback: (event, button) => {
          const f = button.form?.elements ?? {};
          return { identity: !!f.identity?.checked, gear: !!f.gear?.checked, xp: isGM && !!f.xp?.checked };
        }
      }
    ],
    rejectClose: false
  });
  if ( !keep || (typeof keep !== "object") ) return null;
  return resetOperative(actor, keep);
}

/**
 * Reset an operative: its items (but any gear kept), its own effects, and its system data.
 * @param {Actor} actor
 * @param {{identity?: boolean, gear?: boolean, xp?: boolean}} [keep]
 * @returns {Promise<Actor|null>}
 */
export async function resetOperative(actor, keep = {}) {
  if ( !canReset(actor) ) return null;
  const kept = { identity: !!keep.identity, gear: !!keep.gear, xp: !!game.user.isGM && !!keep.xp };
  const blank = new actor.system.constructor({}).toObject();
  const system = resetSystem(blank, actor.toObject().system, kept);
  const items = resetItems(actor.items.contents.map(i => ({ id: i.id, type: i.type })), kept);
  const effects = actor.effects.contents.map(e => e.id);
  if ( items.length ) await actor.deleteEmbeddedDocuments("Item", items);
  if ( effects.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", effects);
  await actor.update({ system });
  ui.notifications.info(`${actor.name} is a new operative again.`);
  // A note for the GMs, since it cannot be undone.
  const gms = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
  if ( gms.length ) {
    await ChatMessage.implementation.create({
      speaker: { alias: "Eclipse Personnel" },
      whisper: gms,
      content: `<div class="irop-card reset-card"><p><strong>${escape(actor.name)}</strong> was reset by ${escape(game.user.name)}. ${keptWords(kept)}</p></div>`
    });
  }
  return actor;
}

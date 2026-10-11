import { BANK_CAP } from "./rules/dynosrs.mjs";
import { adjustGmBanks } from "./settings.mjs";
import { rollCritical, rollDamage, rollScatter, rollBurnSave } from "./rolls.mjs";
import { approveSupport, declineSupport, fireMortar, mortarDamage } from "./apps/resources.mjs";
import { clearBlast } from "./canvas/blast.mjs";
import { askStatusValue, setStatus, statusDef, statusValue } from "./statuses.mjs";
import { undoDeal } from "./store.mjs";
import { surrenderAtCheckpoint } from "./concealment.mjs";

/**
 * Wire the buttons on Insurrection chat cards. Buttons carry data-irop-action;
 * the roll on the message carries everything the follow up needs, so a card
 * still works after a reload.
 */
export function onRenderChatMessage(message, html) {
  for ( const button of html.querySelectorAll("[data-irop-action]") ) {
    const action = button.dataset.iropAction;
    // The GM's own buttons (approving Support) are not shown to players at all.
    if ( button.hasAttribute("data-gm-only") && !game.user.isGM ) {
      button.remove();
      continue;
    }
    // A store deal undone already says so in place of its button (2026-10-10).
    if ( (action === "storeUndo") && message.flags?.irop?.storeDeal?.undone ) {
      const note = button.ownerDocument.createElement("span");
      note.className = "deal-undone";
      note.textContent = (message.flags.irop.storeDeal.kind === "buy") ? "Refunded" : "Bought back";
      button.replaceWith(note);
      continue;
    }
    // A blast marker already cleared from the map has nothing left to clear.
    if ( (action === "clearBlast") && !foundry.utils.fromUuidSync(message.rolls?.[0]?.options?.blastUuid ?? "") ) {
      button.remove();
      continue;
    }
    if ( !canUse(message, action, button) ) {
      button.disabled = true;
      continue;
    }
    button.addEventListener("click", event => {
      event.preventDefault();
      button.disabled = true;
      handle(message, action, button).finally(() => { button.disabled = false; });
    });
  }
  for ( const row of html.querySelectorAll(".card-buttons") ) {
    if ( !row.children.length ) row.remove();
  }
}

/** Who may press what. GM symbols are the GM's; everything else is the roller's or a GM's. */
function canUse(message, action, button) {
  if ( game.user.isGM ) return true;
  if ( action === "applyDefeat" ) return false;
  // A store deal is undone by the character's player (or a GM).
  if ( action === "storeUndo" ) return !!foundry.utils.fromUuidSync(message.flags?.irop?.storeDeal?.whoUuid ?? "")?.isOwner;
  // A checkpoint's Surrender items: the caught operative's player (or a GM).
  if ( action === "checkpointSurrender" ) return !!foundry.utils.fromUuidSync(button.dataset.actorUuid ?? "")?.isOwner;
  // A status lands on the target, and a save is the target's to roll, so only
  // whoever owns the target may press these.
  if ( (action === "applyStatus") || (action === "burnSave") ) {
    const uuid = message.rolls[0]?.options?.targetUuid ?? message.getFlag?.("irop", "targetUuid") ?? "";
    // A burn with no target: anyone may press, and the save goes to the token they target.
    if ( !uuid && (action === "burnSave") ) return true;
    const target = uuid ? foundry.utils.fromUuidSync(uuid) : null;
    return !!target?.isOwner;
  }
  if ( (action === "bank") && ["DANGER", "DEFEAT"].includes(button.dataset.symbol) ) return false;
  const roll = message.rolls[0];
  const uuid = roll?.options?.actorUuid ?? roll?.options?.attack?.actorUuid;
  const actor = uuid ? foundry.utils.fromUuidSync(uuid) : null;
  return actor ? actor.isOwner : message.isAuthor;
}

async function handle(message, action, button) {
  const roll = message.rolls[0];
  const attack = roll?.options?.attack;
  switch ( action ) {
    case "damage": return rollDamage(attack, { critical: button.dataset.critical === "true" });
    case "critical": return rollCritical(attack);
    case "scatter": return rollScatter(attack?.scatter, foundry.utils.fromUuidSync(attack?.actorUuid), { blast: attack?.blast });
    case "bank": return bank(message, roll, button.dataset.symbol, Number(button.dataset.amount) || 0);
    case "applyDefeat": return applyDefeat(message);
    case "applyStatus": return applyStatus(message, roll);
    case "burnSave": return rollBurnSave(message, roll);
    case "supportApprove": return approveSupport(message);
    case "supportDecline": return declineSupport(message);
    case "mortarFire": return fireMortar(message);
    case "mortarDamage": return mortarDamage(Number(button.dataset.strike) || 1, message);
    case "storeUndo": return undoDeal(message);
    case "checkpointSurrender": return surrenderAtCheckpoint(message, button.dataset.actorUuid);
    case "clearBlast": {
      const result = await clearBlast(roll?.options?.blastUuid);
      if ( result === "permission" ) return ui.notifications.warn("Only the thrower or a GM can clear the blast marker.");
      button.remove();
      if ( result === "gone" ) ui.notifications.info("The blast marker is already gone.");
      return result;
    }
  }
}

/**
 * Bank a symbol from a resolved roll. Edge and Victory go to the rolling
 * operative, capped (Edge 3, Victory 1); Danger and Defeat go to the GM banks
 * (Danger 6, Defeat 1). A card can bank each symbol once.
 */
async function bank(message, roll, symbol, amount) {
  if ( message.getFlag("irop", `banked.${symbol}`) ) return;
  if ( ["EDGE", "VICTORY"].includes(symbol) ) {
    const actor = foundry.utils.fromUuidSync(roll.options.actorUuid);
    if ( !actor || (actor.type !== "operative") ) return ui.notifications.warn("Only an operative can bank Edge or Victory.");
    const path = symbol === "EDGE" ? "edge" : "victory";
    const before = actor.system.banks[path];
    const after = Math.min(BANK_CAP[symbol], before + amount);
    await actor.update({ [`system.banks.${path}`]: after });
    if ( after - before < amount ) ui.notifications.info(`${actor.name}'s ${path} bank is capped at ${BANK_CAP[symbol]}.`);
  }
  else {
    await adjustGmBanks(symbol === "DANGER" ? { danger: amount } : { defeat: amount });
  }
  return setCardFlag(message, `banked.${symbol}`, true);
}

/** HANDOFF: Defeat lets the GM turn a passed check into a failure. */
/**
 * Special ammo's status on hit (2026-10-08): put it on the attack's target, with the X the card
 * shows (2026-10-10: X is kept on the status). A status with an (X) but no number on the card
 * asks for one. A target that has the status already keeps the larger X.
 */
async function applyStatus(message, roll) {
  // From special ammo the status rides on the damage roll; from a burn outcome, on the card's flags.
  const { status, targetUuid } = roll?.options?.status ? roll.options : (message.flags?.irop ?? {});
  const target = targetUuid ? foundry.utils.fromUuidSync(targetUuid) : null;
  if ( !status?.id || !target ) return ui.notifications.warn("The target of this attack no longer exists.");
  let value = Number(status.value) || 0;
  if ( statusDef(status.id)?.counter && !value ) {
    value = await askStatusValue(status.id, { actorName: target.name });
    if ( value === null ) return;
  }
  await setStatus(target, status.id, Math.max(value, statusValue(target, status.id)));
  return setCardFlag(message, "statusApplied", true);
}

async function applyDefeat(message) {
  await setCardFlag(message, "defeatApplied", true);
}

/**
 * Write a flag on a card. The author or a GM can do it directly; otherwise ask
 * a GM, since a player cannot update another user's message.
 */
async function setCardFlag(message, key, value) {
  if ( message.isOwner ) return message.setFlag("irop", key, value);
  ui.notifications.warn("Only the author of this card or a GM can mark it.");
}

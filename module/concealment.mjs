import { IROP } from "./config.mjs";
import { asGM, registerAction } from "./socket.mjs";
import { getSquad } from "./settings.mjs";
import { concealmentLoad, placeCheck, surrenderables } from "./rules/concealment.mjs";

/**
 * Concealment checkpoints (Johnald, 2026-10-10; the rules in rules/concealment.mjs). The GM picks
 * the place, Slums or Megacity, and who goes through; the card says who passes and who is caught.
 * A caught operative's player may hand over items of their choice until they are under the
 * limit, and carry on; what they hand over is gone. The card is the GM's, so handing over is done
 * on the GM's client, which removes the items and writes the card.
 */

const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** A character's result at a place, from what they carry now, with their bonus (a Human's, effects'). */
export function checkFor(actor, place) {
  const load = concealmentLoad(actor.items, actor.system?.carry?.max ?? 0);
  return placeCheck({ ...load, bonus: actor.system?.concealment?.bonus ?? 0 }, place);
}

/** The checkpoint card, from its flags. */
export function checkpointHTML({ place, results }) {
  const p = IROP.concealment.places[place] ?? { label: place, limit: 0 };
  const rows = results.map(r => {
    const handed = r.surrendered?.length ? `<p class="checkpoint-handed">Handed over: ${r.surrendered.map(escape).join(", ")}</p>` : "";
    const verdict = r.pass
      ? `<em class="verdict">${r.surrendered?.length ? "Through, after handing over" : "Through"}</em>`
      : `<em class="verdict">Caught</em>`;
    const button = r.pass ? ""
      : `<div class="card-buttons"><button type="button" data-irop-action="checkpointSurrender" data-actor-uuid="${escape(r.actorUuid)}" data-tooltip="Hand over items of your choice until you are under the limit, and carry on; they are gone"><i class="fa-solid fa-hand-holding"></i> Surrender items</button></div>`;
    return `<li class="checkpoint-row ${r.pass ? "pass" : "caught"}">
      <div class="checkpoint-line"><strong>${escape(r.name)}</strong>${verdict}</div>
      <span class="checkpoint-load">Showing ${r.visible} of ${r.allowed} allowed${((r.limit ?? r.base) !== r.base) ? ` (${r.limit}% for them)` : ""}${r.pass ? "" : `: ${r.over} over`}</span>${handed}${button}</li>`;
  }).join("");
  return `<div class="irop-card checkpoint-card">
    <header class="card-head"><h3><i class="fa-solid fa-eye"></i> Checkpoint</h3><span class="card-sub">${escape(p.label)}: ${p.limit}% of capacity</span></header>
    <ol class="checkpoint-rows">${rows}</ol></div>`;
}

/** Put a checkpoint to chat: each operative checked at the place. */
export function postCheckpoint(place, actors) {
  const results = actors.map(a => ({ actorUuid: a.uuid, name: a.name, ...checkFor(a, place), surrendered: [] }));
  const data = { place, results };
  return ChatMessage.implementation.create({
    speaker: { alias: "Checkpoint" },
    content: checkpointHTML(data),
    flags: { irop: { checkpoint: data } }
  });
}

/** The GM's Checkpoint: where, and who goes through (the squad, else every player's operative). */
export async function openCheckpoint() {
  if ( !game.user.isGM ) return ui.notifications.warn("Checkpoints are the GM's to run.");
  const all = game.actors.filter(a => a.type === "operative");
  if ( !all.length ) return ui.notifications.warn("There are no operatives to check.");
  const squad = new Set(getSquad().map(a => a.id));
  const chosen = squad.size ? squad : new Set(all.filter(a => a.hasPlayerOwner).map(a => a.id));
  const places = Object.entries(IROP.concealment.places);
  const content = `<div class="irop-dialog checkpoint-dialog">
    <fieldset><legend>Where</legend>${places.map(([key, p], i) => `<label class="check"><input type="radio" name="place" value="${key}" ${i === 0 ? "checked" : ""}><span>${escape(p.label)}, ${p.limit}% of capacity</span></label>`).join("")}</fieldset>
    <fieldset><legend>Who goes through</legend>${all.map(a => `<label class="check"><input type="checkbox" name="who.${a.id}" ${chosen.has(a.id) ? "checked" : ""}><span>${escape(a.name)}</span></label>`).join("")}</fieldset>
  </div>`;
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Checkpoint" }, classes: ["irop", "irop-checkpoint-dialog"], position: { width: 420 }, content,
    ok: { label: "Check them", icon: "fa-solid fa-eye" }, rejectClose: false
  });
  if ( !data ) return null;
  const place = (data.place in IROP.concealment.places) ? data.place : places[0][0];
  const who = all.filter(a => data[`who.${a.id}`] ?? data.who?.[a.id]);
  if ( !who.length ) return ui.notifications.warn("Pick at least one to go through.");
  return postCheckpoint(place, who);
}

/**
 * From the card: a caught operative's player (or the GM) picks what to hand over. The dialog keeps
 * a running count against what is over the limit.
 */
export async function surrenderAtCheckpoint(message, actorUuid) {
  const data = message.flags?.irop?.checkpoint;
  const actor = foundry.utils.fromUuidSync(actorUuid);
  if ( !data || !actor ) return ui.notifications.warn("That checkpoint or character is gone.");
  const now = checkFor(actor, data.place);
  const options = surrenderables(actor.items);
  if ( now.pass || !options.length ) {
    return asGM("checkpointSurrender", { messageId: message.id, actorUuid, give: {} }, { offline: "No GM is connected. A checkpoint needs one online." });
  }
  const rows = options.map(o => `<label class="surrender-row" data-weight="${o.unitWeight}">
      ${o.img ? `<img src="${escape(o.img)}" alt="">` : "<span></span>"}
      <span class="surrender-name">${escape(o.name)}</span>
      <span class="surrender-weight">${o.unitWeight}${o.stack ? " each" : ""}</span>
      ${o.stack
        ? `<input type="number" name="give.${o.id}" value="0" min="0" max="${o.quantity}" step="1" data-tooltip="How many to hand over, of ${o.quantity}">`
        : `<input type="checkbox" name="give.${o.id}">`}
    </label>`).join("");
  const content = `<div class="irop-dialog surrender-dialog" data-over="${now.over}">
    <p class="lede">${escape(actor.name)} shows ${now.visible} where ${now.allowed} is allowed: <strong>${now.over} over</strong>. Hand over enough to get under, and carry on. What is handed over is gone.</p>
    <div class="surrender-list">${rows}</div>
    <p class="surrender-sum">Handing over 0. Still caught.</p>
  </div>`;
  const choice = await foundry.applications.api.DialogV2.input({
    window: { title: `Surrender items: ${actor.name}` }, classes: ["irop", "irop-surrender-dialog"], position: { width: 460 }, content,
    ok: { label: "Hand them over", icon: "fa-solid fa-hand-holding" }, rejectClose: false,
    render: (event, dialog) => wireSurrender(dialog.element ?? dialog)
  });
  if ( !choice ) return null;
  const give = {};
  for ( const o of options ) {
    const v = choice[`give.${o.id}`] ?? choice.give?.[o.id];
    const n = (v === true) ? 1 : Math.floor(Number(v) || 0);
    if ( n > 0 ) give[o.id] = n;
  }
  if ( !Object.keys(give).length ) return null;
  return asGM("checkpointSurrender", { messageId: message.id, actorUuid, give }, { offline: "No GM is connected. A checkpoint needs one online." });
}

/** The surrender dialog's running count: what is picked, against what is over. */
export function wireSurrender(root) {
  const box = root?.querySelector?.(".surrender-dialog");
  if ( !box ) return;
  const over = Number(box.dataset.over) || 0;
  const sum = box.querySelector(".surrender-sum");
  const update = () => {
    let total = 0;
    for ( const row of box.querySelectorAll(".surrender-row") ) {
      const input = row.querySelector("input");
      const n = (input.type === "checkbox") ? (input.checked ? 1 : 0) : Math.max(0, Math.floor(Number(input.value) || 0));
      total += n * (Number(row.dataset.weight) || 0);
    }
    total = Math.round(total * 10) / 10;
    sum.textContent = `Handing over ${total}. ${(total >= over) ? "Through." : `Still caught, ${Math.round((over - total) * 10) / 10} over.`}`;
    sum.classList.toggle("through", total >= over);
  };
  box.addEventListener("input", update);
  box.addEventListener("change", update);
  update();
}

/**
 * On the GM's client: take what was handed over off the operative (a fitted mod or loaded
 * ammunition goes with what it is on), check them again, and write the card.
 */
export async function performSurrender({ messageId, actorUuid, give = {} }, user) {
  const message = game.messages?.get(messageId);
  const data = message?.flags?.irop?.checkpoint;
  const actor = foundry.utils.fromUuidSync(actorUuid);
  if ( !data || !actor ) return { error: "That checkpoint or character is gone." };
  if ( !user?.isGM && !actor.testUserPermission?.(user, "OWNER") ) return { error: `${user?.name ?? "Someone"} cannot hand over ${actor.name}'s things.` };
  if ( !data.results.some(r => r.actorUuid === actorUuid) ) return { error: `${actor.name} did not go through that checkpoint.` };
  const options = new Map(surrenderables(actor.items).map(o => [o.id, o]));
  const handed = [];
  const gone = [];
  for ( const [id, asked] of Object.entries(give) ) {
    const o = options.get(id);
    const n = Math.min(o?.quantity ?? 0, Math.max(0, Math.floor(Number(asked) || 0)));
    if ( !o || !n ) continue;
    if ( o.stack && (n < o.quantity) ) await actor.items.get(id).update({ "system.quantity": o.quantity - n });
    else gone.push(id, ...o.attached);
    handed.push(o.stack ? `${n} x ${o.name}` : o.name);
  }
  if ( gone.length ) await actor.deleteEmbeddedDocuments("Item", gone);
  const now = checkFor(actor, data.place);
  const results = data.results.map(r => ((r.actorUuid === actorUuid) ? { ...r, ...now, surrendered: [...(r.surrendered ?? []), ...handed] } : r));
  const next = { ...data, results };
  await message.update({ content: checkpointHTML(next), "flags.irop.checkpoint": next });
  return handed.length ? { notice: `${actor.name} handed over ${handed.join(", ")}.` } : {};
}

/** The GM's Checkpoint button, in the Actors sidebar's header beside Banks and Support. */
export function addCheckpointButton(app, html) {
  if ( !game.user?.isGM ) return;
  const root = html?.querySelector ? html : html?.[0];
  const actions = root?.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".irop-checkpoint-button") ) return;
  const button = root.ownerDocument.createElement("button");
  button.type = "button";
  button.className = "irop-checkpoint-button";
  button.innerHTML = `<i class="fa-solid fa-eye"></i> Checkpoint`;
  button.addEventListener("click", () => openCheckpoint());
  actions.append(button);
}

/** What players may ask the GM's client to do: hand over items at a checkpoint. Called once, at init. */
export function registerConcealmentActions() {
  registerAction("checkpointSurrender", (payload, user) => performSurrender(payload, user));
}

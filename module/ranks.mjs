import { serviceRank } from "./rules/ranks.mjs";

/**
 * Promotions in chat (Johnald, 2026-10-17): when an operative's XP earned carries them into a new
 * ODR rank, or the GM sets one, the table hears it, with the new insignia. Posted by the client
 * that made the change, once.
 */

const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** The rank an update leaves an operative at, worked out before it lands. */
function rankAfter(actor, changes) {
  const earned = foundry.utils.getProperty(changes, "system.xp.earned") ?? actor.system.xp?.earned;
  const set = foundry.utils.getProperty(changes, "system.details.record.rank") ?? actor.system.details?.record?.rank;
  return serviceRank(earned, set);
}

/** The chat card: promoted, or now holding a lower rank. */
export function promotionHTML(name, before, after) {
  const up = after.from > before.from;
  return `<div class="irop-card rank-card ${up ? "up" : "down"}">
    <header class="card-head"><h3><i class="fa-solid ${up ? "fa-angles-up" : "fa-angles-down"}"></i> ${up ? "Promotion" : "Change of rank"}</h3><span class="card-sub">ODR personnel</span></header>
    <p class="rank-line"><img src="${escape(after.insignia)}" alt=""><span><strong>${escape(name)}</strong> ${up ? "is promoted to" : "now holds the rank of"} <strong>${escape(after.label)}</strong>, from ${escape(before.label)}.</span></p>
  </div>`;
}

export function registerRankWatch() {
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    if ( actor.type !== "operative" ) return;
    const touches = foundry.utils.hasProperty(changes, "system.xp.earned") || foundry.utils.hasProperty(changes, "system.details.record.rank");
    if ( !touches ) return;
    const before = actor.system.serviceRank;
    const after = rankAfter(actor, changes);
    if ( before && (before.key !== after.key) ) options.iropRank = { before, after };
  });
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    const change = options.iropRank;
    if ( !change || (userId !== game.user?.id) ) return;
    ChatMessage.implementation.create({ speaker: { alias: "ODR Command" }, content: promotionHTML(actor.name, change.before, change.after) });
  });
}

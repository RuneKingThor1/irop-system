import { IROP, rankLocked } from "../config.mjs";

/**
 * XP, RULED 2026-10-08 (Johnald). One ledger: attribute ranks, skill ranks and
 * (next) perk tree perks all spend from it. Attribute pips cost 10, 20, 40, 60,
 * 80, 100 and skill pips 20, 40, 60, 80, by which pip is bought. In Play mode a
 * player buys the next pip if they have the XP; Edit mode stays free for GM
 * corrections and setup. Earned is set by the GM.
 */

/** What buying pip `n` (1 based) of an attribute or a skill costs. */
export function rankCost(kind, n) {
  const table = (kind === "attribute") ? IROP.attributeAdvance.xpCost : IROP.skillRanks.xpCost;
  return table[n - 1] ?? null;
}

/**
 * Can this pip be bought? Only the next one up, never past the top, and only with
 * the XP to pay for it.
 * @returns {{ok: boolean, cost?: number, reason?: string}}
 */
export function checkRankPurchase({ kind, key = "", label, current, n, unspent }) {
  // Luck is never raised (RULED 2026-10-17).
  if ( (kind === "attribute") && rankLocked(key) ) return { ok: false, reason: `${label} cannot be raised.` };
  const max = (kind === "attribute") ? IROP.attributeAdvance.maxRanks : IROP.skillRanks.max;
  if ( n !== current + 1 ) return { ok: false, reason: "Ranks are bought one at a time, the next one up." };
  if ( n > max ) return { ok: false, reason: `${label} is already at its top rank.` };
  const cost = rankCost(kind, n);
  if ( unspent < cost ) return { ok: false, cost, reason: `Rank ${n} ${label} costs ${cost} XP; ${unspent} unspent.` };
  return { ok: true, cost };
}

/** Total XP spent: every ledger entry except awards. */
export function xpSpent(log = []) {
  return log.reduce((sum, e) => sum + ((e.kind === "award") ? 0 : (Number(e.xp) || 0)), 0);
}

/** A ledger line as the Dossier shows it. */
export function xpLine(entry) {
  const xp = Number(entry.xp) || 0;
  // An award, or a refund (spent going back down), is XP coming in.
  const credit = (entry.kind === "award") || (xp < 0);
  return { ...entry, amount: `${credit ? "+" : "-"}${Math.abs(xp)}`, award: credit };
}

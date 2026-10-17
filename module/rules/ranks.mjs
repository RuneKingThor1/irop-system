import { IROP } from "../config.mjs";

/**
 * ODR ranks (Johnald, 2026-10-17): ten, set by XP earned, so a character's rank measures how far
 * they have come. A GM may set one by hand on the Personnel Record (a field promotion, or a
 * demotion); "By XP" goes back to the bands. Kept apart from Foundry so it can be tested.
 */

/** The ranks, lowest first: [{key, label, from, ...}]. */
export function rankList() {
  return Object.entries(IROP.ranks).map(([key, r]) => ({ key, ...r })).sort((a, b) => a.from - b.from);
}

/** The rank XP earned reaches: the highest whose band starts at or below it. */
export function rankFor(earned) {
  const list = rankList();
  const xp = Number(earned) || 0;
  return list.filter(r => r.from <= xp).at(-1) ?? list[0];
}

/** The rank after this one, or null at the top. */
export function nextRank(key) {
  const list = rankList();
  const i = list.findIndex(r => r.key === key);
  return (i >= 0) ? (list[i + 1] ?? null) : null;
}

/**
 * A character's rank: the GM's, when one is set and still a rank, else by XP earned.
 * @returns {{key: string, label: string, insignia: string, from: number, to: number|null, set: boolean, next: object|null}}
 */
export function serviceRank(earned, override = "") {
  const set = !!override && !!IROP.ranks[override];
  const rank = set ? { key: override, ...IROP.ranks[override] } : rankFor(earned);
  const next = nextRank(rank.key);
  return { ...rank, set, next, to: next ? next.from - 1 : null };
}

/** Old saved ranks, before the ladder (2026-10-17): Squaddie was the only one, now Initiate by XP. */
export function migrateRankKey(key) {
  return (key === "squaddie") ? "" : (key ?? "");
}

import { IROP } from "../config.mjs";
import { getList, setList } from "../settings.mjs";

/**
 * World data moved to new rules, once per world, on the GM's client at ready.
 *
 * Reputation (RULED 2026-10-11): from five levels (-2 to +2) to nine (-4 to +4), each with a bar
 * of points. A territory's old level doubles, so every name it had keeps its place (Hostile -2
 * to -4, Wary -1 to -2, Friendly +1 to +2, Devoted +2 to +4), and its bar starts at the middle.
 * Rules a GM saved for Reputation in the old units go back to the new defaults. Factions from
 * the first build (standing -10 to +10, never released) come onto the factions' ladder.
 *
 * Strength (RULED 2026-10-11): from 0 to 10 to 0 to 25. Every territory's Strength scales by 2.5,
 * rounded, so each keeps its place on the bar and its Low, Moderate or High band; the Strength
 * rules a GM saved on the old scale go back to the new defaults.
 *
 * Either way the turns kept for Undo move too, so taking a turn back after the move does not
 * put old numbers onto the new scale.
 */

/** Change "system.<path>" values in the turns kept for Undo. */
async function migrateHistory(path, fn) {
  const history = getList("turnHistory");
  if ( !history.some(h => (h.before ?? []).some(b => path in b)) ) return;
  await setList("turnHistory", history.map(h => ({
    ...h,
    before: (h.before ?? []).map(b => ((path in b) ? { ...b, [path]: fn(b[path]) } : b))
  })));
}

/** Strength's scale this world's data is in: 0 the old 0 to 10, 25 the new. */
export const STRENGTH_SCALE = 25;

/** Move this world onto Strength 0 to 25, if it is not there yet. GM only. */
export async function migrateStrength() {
  if ( !game.user?.isGM ) return null;
  let version = 0;
  try { version = Number(game.settings.get(SYSTEM, "strengthScale")) || 0; }
  catch { return null; }
  if ( version >= STRENGTH_SCALE ) return null;
  const scale = n => Math.max(0, Math.min(STRENGTH_SCALE, Math.round((Number(n) || 0) * 2.5)));
  const updates = (game.items?.filter(i => i.type === "territory") ?? [])
    .filter(t => (Number(t.flags?.irop?.strengthScale) || 0) < STRENGTH_SCALE)
    .map(t => ({ _id: t.id, "system.strength": scale(t.system.strength), "flags.irop.strengthScale": STRENGTH_SCALE }));
  if ( updates.length ) await Item.updateDocuments(updates);
  await migrateHistory("system.strength", scale);

  // Strength rules saved on the old scale: the new defaults instead.
  let saved = {};
  try { saved = game.settings.get(SYSTEM, "strategyRules") ?? {}; }
  catch { saved = {}; }
  const old = ["strengthMax", "strengthMoves", "incursionStrength", "incursionMoves", "incursionLoss"].filter(k => k in saved);
  if ( old.length ) await game.settings.set(SYSTEM, "strategyRules", Object.fromEntries(Object.entries(saved).filter(([k]) => !old.includes(k))));

  await game.settings.set(SYSTEM, "strengthScale", STRENGTH_SCALE);
  if ( updates.some(u => u["system.strength"]) || old.length ) {
    ui.notifications?.info("GENESIS Strength now runs 0 to 25. Every territory scaled with it, so each keeps its place on the bar.");
  }
  return { territories: updates.length, resetRules: old };
}

/** The Reputation scale this world's data is in: 0 or 1 the old one, 2 the nine levels. */
export const REPUTATION_SCALE = 2;

const SYSTEM = "irop";

/** Move this world onto the nine level Reputation, if it is not there yet. GM only. */
export async function migrateReputation() {
  if ( !game.user?.isGM ) return null;
  let version = 0;
  try { version = Number(game.settings.get(SYSTEM, "reputationScale")) || 0; }
  catch { return null; }
  if ( version >= REPUTATION_SCALE ) return null;
  const { levels, entry } = IROP.reputationScale;
  const clamp = n => Math.max(-levels, Math.min(levels, Math.round(Number(n) || 0)));

  // Territories, each marked as it moves so nothing doubles twice.
  const updates = (game.items?.filter(i => i.type === "territory") ?? [])
    .filter(t => (Number(t.flags?.irop?.reputationScale) || 0) < REPUTATION_SCALE)
    .map(t => ({
      _id: t.id,
      "system.reputation": clamp((Number(t.system.reputation) || 0) * 2),
      "system.reputationPoints": entry,
      "flags.irop.reputationScale": REPUTATION_SCALE
    }));
  if ( updates.length ) await Item.updateDocuments(updates);
  await migrateHistory("system.reputation", n => clamp(n * 2));

  // Reputation rules saved in the old units: the new defaults instead.
  let saved = {};
  try { saved = game.settings.get(SYSTEM, "strategyRules") ?? {}; }
  catch { saved = {}; }
  const resetRules = !!(saved.missionReputation || saved.factions);
  if ( resetRules ) {
    const { missionReputation, factions, ...rest } = saved;
    await game.settings.set(SYSTEM, "strategyRules", rest);
  }

  // Factions from the first build: -10 to +10 read onto -4 to +4, mid bar; open tasks' numbers doubled.
  const factions = getList("factions");
  const oldFactions = factions.filter(f => (f.points === undefined) || (f.points === null));
  if ( oldFactions.length ) {
    const level = n => clamp((Number(n) || 0) * 0.4);
    await setList("factions", factions.map(f => (((f.points === undefined) || (f.points === null)) ? { ...f, standing: level(f.standing), points: entry } : f)));
    const state = v => ((typeof v === "number") ? { level: level(v), points: entry } : v);
    await setList("factionLog", getList("factionLog").map(l => ({ ...l, from: state(l.from), to: state(l.to) })));
    const double = n => Math.max(0, Math.round(Number(n) || 0) * 2);
    await setList("factionTasks", getList("factionTasks").map(t => (["draft", "offered", "accepted"].includes(t.status)
      ? { ...t, standing: double(t.standing), failure: double(t.failure), rivalLoss: double(t.rivalLoss) } : t)));
  }

  await game.settings.set(SYSTEM, "reputationScale", REPUTATION_SCALE);
  if ( updates.length || resetRules || oldFactions.length ) {
    ui.notifications?.info("Reputation now runs on nine levels with a bar of points each. Territories kept their names: Friendly is +2, Devoted +4.");
  }
  return { territories: updates.length, resetRules, factions: oldFactions.length };
}

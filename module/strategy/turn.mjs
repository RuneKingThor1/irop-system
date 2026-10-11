import { planTurn, resolvePlan } from "../rules/turn.mjs";
import { getWarRoom, setWarRoom, getStrategyRules, getList, setList, undoResource } from "../settings.mjs";
import { worldProjects, soldierOf, completeProject } from "./odr.mjs";
import { cardsForPlan, applyCardOps, snapshotStacks, restoreStacks, applyLedger } from "./events.mjs";
import { applyIncursionOps } from "./losing-ground.mjs";
import { turnDays, advanceDays, worldTime, dateInfo, onStrategyLayer } from "../calendar.mjs";

/**
 * Advance week and its undo (Strategy Layer step 4, 2026-10-08). The plan comes
 * from rules/turn.mjs; this file reads the world into it and writes the result back,
 * keeping the last few turns as they were so a turn can be taken back.
 */

/** How many turns can be undone, one after another. */
export const HISTORY_KEPT = 5;

/** The turn that would start if the week advanced now. */
export function currentPlan() {
  const state = getWarRoom();
  const items = game.items ?? [];
  return planTurn({
    week: state.week,
    territories: items.filter(i => i.type === "territory").map(t => ({ id: t.id, name: t.name, system: t.system })),
    projects: worldProjects().map(p => ({ id: p.id, name: p.name, system: p.system })),
    soldierOf,
    rules: getStrategyRules(),
    tactical: state.tactical,
    cards: cardsForPlan(),
    incursions: getList("incursions")
  });
}

/**
 * What the week report card says. The cards dealt show as small cards (step 6); the
 * calendar's date heads it (2026-10-08) when the GM shows the date on the Strategy Layer.
 */
export function weekReportContext(plan, ticked, choices = new Map(), { date = "" } = {}) {
  const kept = plan.lines.filter(l => !l.hidden && ticked.has(l.id));
  const where = id => (id ? (game.items?.get(id)?.name ?? "") : "");
  const cards = kept.filter(l => ["draw", "dark"].includes(l.card?.op)).map(l => ({
    name: l.card.name, img: l.card.img, kind: l.card.kind, dark: l.card.kind === "dark",
    where: (l.card.op === "dark") ? (l.card.discretionary ? "held" : where(choices.get(l.id)))
      : (l.card.territory ? where(l.card.territory) : "everywhere")
  }));
  const count = section => kept.filter(l => l.section === section).length;
  return {
    week: plan.week,
    date,
    lines: kept.map(l => ({ text: l.text, tone: l.tone })),
    growth: count("growth"),
    moves: count("strength"),
    heat: count("heat"),
    projects: count("projects"),
    quiet: !kept.length,
    due: plan.due,
    cards
  };
}

/**
 * Apply a turn: the ticked lines' changes, the new week in the ODR phase with no
 * Tactical Action yet, any projects finished, and a report card for the table.
 * GM only.
 * Step 6: the cards move too, and their Logistics and Intel go through the ledger; the
 * card stacks and those ledger lines are kept for Undo. The calendar (2026-10-08): the
 * date moves on by the GM's days a turn, and Undo takes them back.
 * @param {object} plan
 * @param {Set<string>} ticked
 * @param {Map<string, string>} [choices]   Dark Event line to the territory it hits
 */
export async function applyTurn(plan, ticked, choices = new Map()) {
  if ( !game.user.isGM ) return null;
  const state = getWarRoom();
  if ( plan.week !== state.week + 1 ) {
    ui.notifications.warn(`The War Room is at turn ${state.week} now. Open Advance turn again for a fresh report.`);
    return null;
  }
  const docs = new Map((game.items ?? []).filter(i => ["territory", "project"].includes(i.type))
    .map(i => [i.id, { system: i.system.toObject() }]));
  const { updates, before, completes, cardOps, ledger, incursionOps } = resolvePlan(plan, ticked, docs, { choices, rules: getStrategyRules() });
  const days = turnDays();
  const entry = {
    week: state.week, phase: state.phase, tactical: state.tactical, to: plan.week,
    before, revealed: getList("revealedActions"), incursions: getList("incursions"), cards: snapshotStacks(), ledgerIds: [], time: Date.now(), days
  };
  if ( updates.length ) await Item.updateDocuments(updates);
  entry.ledgerIds = await applyLedger(ledger);
  await applyCardOps(cardOps, plan.week);
  await applyIncursionOps(incursionOps, plan.week);
  await setList("turnHistory", [...getList("turnHistory"), entry].slice(-HISTORY_KEPT));
  await setWarRoom({ week: plan.week, phase: "odr", tactical: null });
  const now = days ? await advanceDays(days) : worldTime();
  for ( const id of completes ) {
    const item = game.items.get(id);
    if ( item ) await completeProject(item, { alreadySaved: true });
  }
  await ChatMessage.implementation.create({
    speaker: { alias: "ODR Command" },
    content: await foundry.applications.handlebars.renderTemplate("systems/irop/templates/chat/week-report.hbs", weekReportContext(plan, ticked, choices, { date: onStrategyLayer() ? dateInfo(now).long : "" }))
  });
  return { updates, completes };
}

/** The turn Undo would take back, if any. */
export function lastTurn() {
  const last = getList("turnHistory").at(-1);
  return (last && (last.to === getWarRoom().week)) ? last : null;
}

/**
 * Take back the last Advance week: territories and projects as they were, the
 * week, its phase and Tactical Action, the revealed actions, the card stacks, the
 * ledger lines its cards made, and the days it moved the date. GM only.
 */
export async function undoTurn() {
  if ( !game.user.isGM ) return null;
  const history = getList("turnHistory");
  const last = lastTurn();
  if ( !last ) {
    ui.notifications.warn("There is no turn to undo.");
    return null;
  }
  const restore = last.before.filter(b => game.items?.has(b._id));
  if ( restore.length ) await Item.updateDocuments(restore);
  await setList("revealedActions", last.revealed ?? []);
  await setList("incursions", last.incursions ?? []);
  await restoreStacks(last.cards);
  for ( const id of [...(last.ledgerIds ?? [])].reverse() ) {
    const result = await undoResource(id);
    if ( result && !result.ok ) ui.notifications.warn(result.reason);
  }
  await setWarRoom({ week: last.week, phase: last.phase, tactical: last.tactical ?? null });
  if ( last.days ) await advanceDays(-last.days);
  await setList("turnHistory", history.slice(0, -1));
  return last;
}

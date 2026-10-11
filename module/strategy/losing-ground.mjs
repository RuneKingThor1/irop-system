import { IROP } from "../config.mjs";
import {
  liberationArea, liberationSpike, liberationUpdates, megacityCount, incursionChoice, objectivesTaken
} from "../rules/losing-ground.mjs";
import { getStrategyRules, getList, setList, getWarRoom } from "../settings.mjs";

/**
 * Losing Ground in the world (Strategy Layer step 7, 2026-10-08): the Incursions under
 * way, breaking one, and liberating a Megacity. GM only; players reach the Tactical
 * Action through the ODR board like any other.
 */

const CARDS = "systems/irop/templates/chat";
const territories = () => game.items?.filter(i => i.type === "territory") ?? [];
const nameOf = id => game.items?.get(id)?.name ?? "a lost territory";

/** The Incursions under way. */
export function incursions() {
  return getList("incursions");
}

/** The Incursion against a territory, if one is under way. */
export function incursionAgainst(territoryId) {
  return incursions().find(i => i.target === territoryId) ?? null;
}

/** The Incursions as Tactical Actions, high priority. */
export function incursionChoices() {
  const rules = getStrategyRules();
  return incursions().map(i => incursionChoice(i, nameOf, rules));
}

/**
 * A turn's Incursion changes (from resolvePlan): open new ones, take away the ones that
 * landed or have nothing left to retake.
 * @param {object[]} ops
 * @param {number} week    The week starting
 */
export async function applyIncursionOps(ops, week) {
  if ( !ops.length ) return incursions();
  let list = incursions();
  for ( const op of ops ) {
    if ( op.op === "open" ) {
      if ( list.some(i => i.target === op.target) ) continue;
      list = [...list, { id: foundry.utils.randomID(), target: op.target, source: op.source, week }];
    }
    else list = list.filter(i => i.id !== op.id);
  }
  await setList("incursions", list);
  return list;
}

/**
 * The squad stopped an Incursion: it is over, and where GENESIS massed loses
 * incursionLoss Strength (ASSUMPTION). GM only.
 * @returns {Promise<object|null>}   The Incursion broken
 */
export async function breakIncursion(id) {
  if ( !game.user.isGM ) return null;
  const incursion = incursions().find(i => i.id === id);
  if ( !incursion ) return null;
  await setList("incursions", incursions().filter(i => i.id !== id));
  const source = game.items?.get(incursion.source);
  const loss = Math.max(0, Math.round(Number(getStrategyRules().incursionLoss) || 0));
  if ( source && loss ) await source.update({ "system.strength": Math.max(0, source.system.strength - loss) });
  return incursion;
}

/* -------------------------------------------- */
/*  Liberation                                  */
/* -------------------------------------------- */

/** What the liberation dialog shows for a Megacity. */
export function liberationContext(megacity) {
  const all = territories();
  const area = liberationArea(megacity, all);
  const rules = getStrategyRules();
  return {
    name: megacity.name,
    taken: objectivesTaken(megacity.system),
    area: area.map((t, i) => ({ id: t.id, name: t.name, kind: IROP.territoryKinds[t.system.kind]?.label ?? "", fixed: i === 0 })),
    spike: liberationSpike(area.map(t => t.id), all, rules).map(s => ({
      ...s, fromLabel: IROP.heatLevels[s.from]?.label ?? s.from, toLabel: IROP.heatLevels[s.to]?.label ?? s.to
    })),
    heat: rules.liberationHeat,
    reach: rules.liberationReach
  };
}

/**
 * Liberate a Megacity and the territories around it the GM keeps ticked: their GENESIS
 * Strength is gone, the territories near them spike in Heat, the table hears of it, and
 * if it was the last Megacity, of the victory. GM only.
 * @param {string} megacityId
 * @param {string[]} areaIds     The Megacity and the neighbours freed with it
 */
export async function liberate(megacityId, areaIds) {
  if ( !game.user.isGM ) return null;
  const megacity = game.items?.get(megacityId);
  if ( !megacity ) return null;
  const ids = [...new Set([megacityId, ...areaIds])];
  const all = territories();
  const spike = liberationSpike(ids, all, getStrategyRules());
  await Item.updateDocuments(liberationUpdates(ids, spike));
  // An Incursion against a territory just freed, or massing in one, is over.
  const freed = new Set(ids);
  const over = i => freed.has(i.target) || freed.has(i.source);
  if ( incursions().some(over) ) await setList("incursions", incursions().filter(i => !over(i)));
  const count = megacityCount(territories());
  const render = data => foundry.applications.handlebars.renderTemplate(`${CARDS}/liberation.hbs`, data);
  await ChatMessage.implementation.create({
    speaker: { alias: "ODR Command" },
    content: await render({
      name: megacity.name, week: getWarRoom().week,
      freed: ids.filter(id => id !== megacityId).map(nameOf),
      spike: spike.map(s => ({ name: s.name, to: IROP.heatLevels[s.to]?.label ?? s.to })),
      landmark: megacity.system.landmark, landmarkBonus: megacity.system.landmarkBonus,
      count, victory: false
    })
  });
  if ( count.total && (count.liberated === count.total) ) {
    await ChatMessage.implementation.create({
      speaker: { alias: "ODR Command" },
      content: await render({ victory: true, count, week: getWarRoom().week })
    });
  }
  return { ids, spike, count };
}

/** Ask, then liberate: the area with its neighbours ticked, the Heat spike it brings. GM only. */
export async function confirmLiberation(megacity) {
  if ( !game.user.isGM || (megacity?.system?.kind !== "megacity") ) return null;
  const context = liberationContext(megacity);
  const content = await foundry.applications.handlebars.renderTemplate("systems/irop/templates/dialog/liberation.hbs", context);
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: `Liberate ${megacity.name}` },
    classes: ["irop", "irop-liberation-dialog"],
    position: { width: 460 },
    content,
    ok: { label: "Liberate", icon: "fa-solid fa-flag" },
    rejectClose: false
  });
  if ( !data ) return null;
  const kept = context.area.filter(a => a.fixed || data[`free.${a.id}`] || data.free?.[a.id]).map(a => a.id);
  return liberate(megacity.id, kept);
}

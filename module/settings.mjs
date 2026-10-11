import { HOUSE_RULE_DEFAULTS, BANK_CAP } from "./rules/dynosrs.mjs";
import { SPECIALIZATION_RULES, parseUnlocks } from "./rules/skill-trees.mjs";
import { SQUAD_SIGHT, refreshSquadSight } from "./canvas/squad-sight.mjs";
import { IROP } from "./config.mjs";
import { strategyRules, warRoomState } from "./rules/strategy.mjs";
import { addEntry, removeEntry, resourceTotals } from "./rules/resources.mjs";

const SYSTEM = "irop";

export function registerSettings() {
  game.settings.register(SYSTEM, "tiebreakWithEdgeAndDanger", {
    name: "House rule: Edge and Danger break ties",
    hint: "On a DYNOSRS stalemate, leftover Edge becomes successes or leftover Danger becomes failures. Off restores canon, where the conversion is only offered.",
    scope: "world",
    config: true,
    type: Boolean,
    default: HOUSE_RULE_DEFAULTS.tiebreakWithEdgeAndDanger
  });

  game.settings.register(SYSTEM, "minimumPoolDice", {
    name: "House rule: minimum skill pool",
    hint: "A skill pool never drops below this many dice; any added dice are Aptitude dice. Set to 0 for canon.",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 4, step: 1 },
    default: HOUSE_RULE_DEFAULTS.minimumPoolDice,
    onChange: () => game.actors?.forEach(a => a.reset())
  });

  // Specializations (RULED 2026-10-08), changeable per table (Johnald, 2026-10-08).
  const treeRules = () => Hooks.callAll("irop.skillTreeRulesChanged");
  game.settings.register(SYSTEM, "specializationXP", {
    name: "Specializations: unlock XP",
    hint: "XP earned at which each specialization opens, in order, separated by commas. One number per specialization a character may hold: 300, 900 allows two; 300, 900, 1500 allows three. Leave it blank to play without specializations.",
    scope: "world",
    config: true,
    type: String,
    default: SPECIALIZATION_RULES.unlockXP.join(", "),
    onChange: treeRules
  });
  game.settings.register(SYSTEM, "specializationOwnRoleFirst", {
    name: "Specializations: own role first",
    hint: "A character's first specialization must come from their own role.",
    scope: "world",
    config: true,
    type: Boolean,
    default: SPECIALIZATION_RULES.ownRoleFirst,
    onChange: treeRules
  });
  game.settings.register(SYSTEM, "specializationCrossRole", {
    name: "Specializations: cross training",
    hint: "Specializations may come from other roles (after the first, if the setting above is on). Off keeps every specialization within the character's own role.",
    scope: "world",
    config: true,
    type: Boolean,
    default: SPECIALIZATION_RULES.crossRole,
    onChange: treeRules
  });

  // Squad sight (Johnald, 2026-10-08): players see what every friendly token sees.
  game.settings.register(SYSTEM, SQUAD_SIGHT, {
    name: "Squad sight",
    hint: "Players see what every friendly token on the scene can see, not only their own. Hostile, neutral and secret tokens never share, nor do hidden ones. The GM's view is unchanged.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshSquadSight()
  });

  // The Strategy Layer (2026-10-08). The scale names the campaign's territories; the
  // GENESIS phase runs itself unless the GM turns that off (Johnald: a toggle).
  const strategyChanged = () => Hooks.callAll("irop.strategyChanged");
  game.settings.register(SYSTEM, "strategyScale", {
    name: "Strategy: campaign scale",
    hint: "How big the campaign's map is: Global, Super region, Region or City. It names the territories (regions, sectors, districts).",
    scope: "world",
    // Set in the Strategy Layer settings window, with the rest (Johnald, 2026-10-08).
    config: false,
    type: String,
    choices: () => Object.fromEntries(Object.entries(IROP.strategyScales).map(([k, v]) => [k, v.label])),
    default: "superRegion",
    onChange: strategyChanged
  });
  game.settings.register(SYSTEM, "genesisAutomatic", {
    name: "Strategy: automatic GENESIS phase",
    hint: "Advance turn runs the GENESIS phase from the rules and shows its report before anything is saved. Off: the GM runs each step by hand.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    onChange: strategyChanged
  });
  // The numbers the Strategy Layer runs on; only what a GM changed is stored (Strategy Layer rules window).
  game.settings.register(SYSTEM, "strategyRules", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: strategyChanged
  });
  // The War Room's running state: the week, the phase, this week's Tactical Action.
  game.settings.register(SYSTEM, "warRoom", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: value => {
      strategyChanged();
      Hooks.callAll("irop.warRoomChanged", warRoomState(value));
    }
  });
  // The Resistance's Logistics and Intel as a ledger (step 3, 2026-10-08): the stock is its sum.
  game.settings.register(SYSTEM, "resourceLedger", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: strategyChanged
  });
  // The last few turns as they were before Advance week, so a turn can be undone (step 4).
  game.settings.register(SYSTEM, "turnHistory", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: strategyChanged
  });
  // Tactical Actions revealed by Intelligence Actions, open until taken (step 5).
  game.settings.register(SYSTEM, "revealedActions", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: strategyChanged
  });
  // GENESIS Incursions under way against liberated territories (step 7): {id, target, source, week}.
  game.settings.register(SYSTEM, "incursions", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: strategyChanged
  });
  // Every debriefed mission, newest last (step 5).
  game.settings.register(SYSTEM, "missionLog", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: strategyChanged
  });

  // Which overlay this user sees on a War Room map (2026-10-08): each viewer picks their own.
  game.settings.register(SYSTEM, "warRoomLayer", {
    scope: "client",
    config: false,
    type: String,
    default: "heat",
    onChange: () => Hooks.callAll("irop.warRoomLayerChanged")
  });

  // ARTEMIS, the Discord bot that rolls from these sheets (Johnald, 2026-10-10): where it lives.
  game.settings.register(SYSTEM, "artemisUrl", {
    name: "ODR ARTEMIS address",
    hint: "The site ODR ARTEMIS answers from. Linked characters send their sheets here. Leave it unless the site moves.",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: "https://75th-eclipse.com"
  });

  // Each browser's ARTEMIS sync tokens, by world and character. Never in world data, which every player can read.
  game.settings.register(SYSTEM, "artemisTokens", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  // The system's token bars, or Foundry's plain ones (Johnald, 2026-10-10): each user's own choice.
  game.settings.register(SYSTEM, "styledTokenBars", {
    name: "Token bars: Insurrection style",
    hint: "Health with its armor blade and barrier field, and a green Energy bar. Off shows Foundry's plain bars. Each person chooses their own.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Hooks.callAll("irop.tokenBarsChanged")
  });

  // Celsius or Fahrenheit for the weather (Johnald, 2026-10-08): each user's own choice.
  game.settings.register(SYSTEM, "temperatureUnit", {
    name: "Temperature",
    hint: "How the weather on territory cards and mission briefings shows temperatures. The other unit shows smaller beside it.",
    scope: "client",
    config: true,
    type: String,
    choices: { F: "Fahrenheit", C: "Celsius" },
    default: "F",
    onChange: () => Hooks.callAll("irop.unitsChanged")
  });

  // The calendar (Johnald, 2026-10-08): the GM's calendar, where the date shows, and how far
  // a turn moves it. All set in the Calendar settings window, not the Configure Settings list.
  const calendarChanged = () => Hooks.callAll("irop.calendarChanged");
  game.settings.register(SYSTEM, "calendar", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: calendarChanged
  });
  game.settings.register(SYSTEM, "calendarWarRoom", {
    name: "Calendar: on the Strategy Layer",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    onChange: calendarChanged
  });
  game.settings.register(SYSTEM, "calendarDateBar", {
    name: "Calendar: date bar on other scenes",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    onChange: calendarChanged
  });
  game.settings.register(SYSTEM, "calendarTurnDays", {
    name: "Calendar: days a turn moves the date",
    scope: "world",
    config: false,
    type: Number,
    default: 7,
    onChange: calendarChanged
  });
  // Set once a new world has been put on the campaign's date (IROP.calendarStart).
  game.settings.register(SYSTEM, "calendarStarted", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  // Where this user dragged the date bar (Johnald, 2026-10-09); empty for the top centre.
  game.settings.register(SYSTEM, "dateBarPosition", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  // Whether the Training tab's ledger is open, each user's own choice (2026-10-08).
  game.settings.register(SYSTEM, "ledgerOpen", {
    scope: "client",
    config: false,
    type: Boolean,
    default: true
  });

  // The GM's banked Danger and Defeat. Players bank Edge and Victory on their own sheets.
  // RULED 2026-10-06: the Danger bank is visible to players as well as the GM, for
  // fairness. The Banks window shows it to everyone; only the GM can change it.
  game.settings.register(SYSTEM, "gmBanks", {
    scope: "world",
    config: false,
    type: Object,
    default: { danger: 0, defeat: 0 },
    onChange: () => Hooks.callAll("irop.gmBanksChanged")
  });

  // RULED 2026-10-07: the squad is the operatives deployed on the current mission,
  // which the GM drags into the Banks window, not every player owned operative.
  // Only they show in the Banks window and get the opening Edge, and only their
  // Victory opens a Nigh Impossible check. Stored as actor ids.
  game.settings.register(SYSTEM, "squad", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => Hooks.callAll("irop.squadChanged")
  });
}

/** The deployed squad, as operative actors. Ids of deleted or non operative actors drop out. */
export function getSquad() {
  let ids;
  try {
    ids = game.settings.get(SYSTEM, "squad") ?? [];
  }
  catch {
    ids = [];
  }
  return ids.map(id => game.actors.get(id)).filter(a => a?.type === "operative");
}

/**
 * Replace the deployed squad. GM only, as a world setting.
 * @param {string[]} ids    Actor ids; duplicates are dropped
 */
export async function setSquad(ids) {
  if ( !game.user.isGM ) throw new Error("Only a GM can deploy operatives.");
  return game.settings.set(SYSTEM, "squad", [...new Set(ids)]);
}

/** The house rules in force, safe to call before settings exist. */
export function houseRules() {
  try {
    return {
      tiebreakWithEdgeAndDanger: game.settings.get(SYSTEM, "tiebreakWithEdgeAndDanger"),
      minimumPoolDice: game.settings.get(SYSTEM, "minimumPoolDice")
    };
  }
  catch {
    return { ...HOUSE_RULE_DEFAULTS };
  }
}

/** The table's specialization rules, safe to call before settings exist (see SPECIALIZATION_RULES). */
export function specializationRules() {
  try {
    return {
      unlockXP: parseUnlocks(game.settings.get(SYSTEM, "specializationXP")),
      ownRoleFirst: game.settings.get(SYSTEM, "specializationOwnRoleFirst"),
      crossRole: game.settings.get(SYSTEM, "specializationCrossRole")
    };
  }
  catch {
    return { ...SPECIALIZATION_RULES, unlockXP: [...SPECIALIZATION_RULES.unlockXP] };
  }
}

/** The Strategy Layer rules in force: the defaults with this world's changes (2026-10-08). */
export function getStrategyRules() {
  try {
    return strategyRules(game.settings.get(SYSTEM, "strategyRules"));
  }
  catch {
    return strategyRules({});
  }
}

/** The War Room's running state: week, phase, and Logistics and Intel from the ledger. */
export function getWarRoom() {
  let saved = {};
  try { saved = game.settings.get(SYSTEM, "warRoom"); }
  catch { /* settings not ready */ }
  return warRoomState(saved, getLedger());
}

/**
 * Change the War Room state. GM only, as a world setting. Logistics or Intel set
 * here go through the ledger, as a GM adjustment for the difference.
 */
export async function setWarRoom(changes = {}) {
  if ( !game.user.isGM ) throw new Error("Only a GM can change the War Room.");
  const { logistics, intel, ...rest } = changes;
  const now = getWarRoom();
  for ( const [resource, value] of [["logistics", logistics], ["intel", intel]] ) {
    if ( (value === undefined) || !Number.isFinite(Number(value)) ) continue;
    const diff = Math.max(0, Math.round(Number(value))) - now[resource];
    if ( diff ) await recordResource({ resource, amount: diff, reason: "Set by the GM" });
  }
  const { week, phase, tactical } = warRoomState({ ...now, ...rest });
  return game.settings.set(SYSTEM, "warRoom", { week, phase, tactical });
}

/** A world setting holding a list, or an empty list before settings exist. */
export function getList(key) {
  try {
    return game.settings.get(SYSTEM, key) ?? [];
  }
  catch {
    return [];
  }
}

/** Replace a world list setting (turnHistory, revealedActions, missionLog, incursions). GM only. */
export async function setList(key, list) {
  if ( !game.user.isGM ) throw new Error("Only a GM can change the War Room.");
  return game.settings.set(SYSTEM, key, list);
}

/** Whether Advance week runs the GENESIS phase itself (the GM's toggle). */
export function genesisAutomatic() {
  try {
    return game.settings.get(SYSTEM, "genesisAutomatic") !== false;
  }
  catch {
    return true;
  }
}

/** The Logistics and Intel ledger, oldest entry first. */
export function getLedger() {
  try {
    return game.settings.get(SYSTEM, "resourceLedger") ?? [];
  }
  catch {
    return [];
  }
}

/**
 * Record a gain (a positive amount) or a spend (negative) of Logistics or Intel. GM
 * only, as a world setting. A spend larger than the stock is refused, unless
 * `clamp`, when it takes what is left.
 * @param {{resource: string, amount: number, reason?: string}} change
 * @param {{clamp?: boolean}} [options]
 * @returns {Promise<{ok: boolean, entry?: object, clamped?: boolean, totals?: object, reason?: string}>}
 */
export async function recordResource({ resource, amount, reason }, { clamp = false } = {}) {
  if ( !game.user.isGM ) throw new Error("Only a GM can change Logistics and Intel.");
  let week = 1;
  try { week = warRoomState(game.settings.get(SYSTEM, "warRoom")).week; }
  catch { /* settings not ready */ }
  const result = addEntry(getLedger(), {
    resource, amount, reason, week, by: game.user.name, id: foundry.utils.randomID(), time: Date.now()
  }, { clamp });
  if ( !result.ok ) return result;
  await game.settings.set(SYSTEM, "resourceLedger", result.ledger);
  return { ...result, totals: resourceTotals(result.ledger) };
}

/** Take an entry out of the ledger, reversing it. GM only. */
export async function undoResource(id) {
  if ( !game.user.isGM ) throw new Error("Only a GM can change Logistics and Intel.");
  const result = removeEntry(getLedger(), id);
  if ( !result.ok ) return result;
  await game.settings.set(SYSTEM, "resourceLedger", result.ledger);
  return { ...result, totals: resourceTotals(result.ledger) };
}

/** The campaign's scale and what it calls a territory. */
export function getStrategyScale() {
  let key = "superRegion";
  try { key = game.settings.get(SYSTEM, "strategyScale") || key; }
  catch { /* settings not ready */ }
  return { key, ...(IROP.strategyScales[key] ?? IROP.strategyScales.superRegion) };
}

/** This user's temperature unit: "F" or "C". */
export function temperatureUnit() {
  try {
    return (game.settings.get(SYSTEM, "temperatureUnit") === "C") ? "C" : "F";
  }
  catch {
    return "F";
  }
}

/** Whether this user keeps the ledger open; open if settings are not ready. */
export function isLedgerOpen() {
  try {
    return game.settings.get(SYSTEM, "ledgerOpen");
  }
  catch {
    return true;
  }
}

/** Remember this user's ledger open or folded. */
export function setLedgerOpen(open) {
  try {
    return game.settings.set(SYSTEM, "ledgerOpen", !!open);
  }
  catch {
    return null;
  }
}

export function getGmBanks() {
  return { danger: 0, defeat: 0, ...game.settings.get(SYSTEM, "gmBanks") };
}

/**
 * Add to (or spend from) the GM banks, clamped to the caps. GM only, since a
 * world setting can only be written by a GM.
 * @param {{danger?: number, defeat?: number}} delta
 */
export async function adjustGmBanks(delta) {
  if ( !game.user.isGM ) throw new Error("Only a GM can change the Danger and Defeat banks.");
  const banks = getGmBanks();
  const clamp = (n, cap) => Math.max(0, Math.min(cap, n));
  banks.danger = clamp(banks.danger + (delta.danger ?? 0), BANK_CAP.DANGER);
  banks.defeat = clamp(banks.defeat + (delta.defeat ?? 0), BANK_CAP.DEFEAT);
  await game.settings.set(SYSTEM, "gmBanks", banks);
  return banks;
}

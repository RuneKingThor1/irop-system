/**
 * FOUNDRY 13 AND 14 COMPATIBILITY
 * ===============================
 *
 * The system runs on Foundry 13 (the live game on Sqyre) and Foundry 14 (the
 * current stable line). The places where the two differ are kept here, so every
 * call site uses one contract and the rest of the system never branches on version.
 *
 *   Effect changes   v13 ActiveEffect#changes, each change with a numeric `mode`.
 *                    v14 ActiveEffect#system#changes, each change with a string `type`.
 *   Message modes    v13 CONFIG.Dice.rollModes, setting core.rollMode, toMessage({rollMode}).
 *                    v14 CONFIG.ChatMessage.modes, setting core.messageMode, toMessage({messageMode}).
 *                    The v13 names still work on 14 but are deprecated.
 */

/** The running Foundry generation, 13 or 14. */
export function generation() {
  return game.release?.generation ?? 13;
}

/* -------------------------------------------- */
/*  Active Effect changes                       */
/* -------------------------------------------- */

/** v13 numeric change modes and their v14 string types. */
const MODE_TO_TYPE = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };

/** The changes of an effect, wherever this Foundry keeps them. */
export function effectChanges(effect) {
  const v14 = effect?.system?.changes;
  if ( Array.isArray(v14) ) return v14;
  return effect?.changes ?? [];
}

/** A change as display text: "vitals.hp.bonus +2". */
export function describeChange(change) {
  const key = String(change.key ?? "").replace(/^system\./, "");
  return `${key} ${change.value}`;
}

/**
 * Effect creation data in the shape this Foundry expects. Takes the v13 shape
 * (root `changes`, numeric `mode`) and moves it under system with a string type on 14.
 * @param {object} data   effect data, possibly with v13 style `changes`
 */
export function effectData(data) {
  if ( (generation() < 14) || !data.changes ) return data;
  const { changes, ...rest } = data;
  return {
    ...rest,
    system: {
      ...(rest.system ?? {}),
      changes: changes.map(({ mode, type, ...c }) => ({ ...c, type: type ?? MODE_TO_TYPE[mode] ?? "add" }))
    }
  };
}

/* -------------------------------------------- */
/*  Chat message visibility                     */
/* -------------------------------------------- */

function usesMessageModes() {
  return (generation() >= 14) && !!CONFIG.ChatMessage?.modes;
}

/** The visibility choices for a roll dialog, and the one currently selected. */
export function messageModeChoices() {
  let entries;
  let current;
  if ( usesMessageModes() ) {
    entries = CONFIG.ChatMessage.modes;
    try { current = game.settings.get("core", "messageMode"); }
    catch { current = Object.keys(entries)[0]; }
  }
  else {
    entries = CONFIG.Dice.rollModes;
    current = game.settings.get("core", "rollMode");
  }
  const options = Object.entries(entries).map(([value, v]) => ({
    value, label: game.i18n.localize(typeof v === "string" ? v : (v.label ?? value))
  }));
  return { options, current };
}

/** Options for Roll#toMessage that apply a chosen visibility mode. */
export function messageOptions(mode) {
  if ( !mode ) return {};
  return usesMessageModes() ? { messageMode: mode } : { rollMode: mode };
}

/**
 * Foundry 13 and 14 compatibility tests. Run: node test/compat.test.mjs
 * Pretends to be each generation in turn and checks the shapes compat.mjs produces.
 */
import * as compat from "../module/compat.mjs";

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if ( cond ) pass++;
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

const settings = {};
globalThis.game = {
  release: { generation: 13 },
  i18n: { localize: k => `L(${k})` },
  settings: { get: (ns, key) => { if ( !(key in settings) ) throw new Error(`no setting ${key}`); return settings[key]; } }
};
globalThis.CONFIG = {
  Dice: { rollModes: { publicroll: { label: "CHAT.RollPublic" }, gmroll: { label: "CHAT.RollPrivate" } } },
  ChatMessage: {}
};
settings.rollMode = "gmroll";

const v13Effect = { name: "Backpack", transfer: true, changes: [{ key: "system.bonuses.carry", mode: 2, value: "5" }] };

/* -------------------------------------------- */
/*  Foundry 13                                  */
/* -------------------------------------------- */

check("v13: generation", compat.generation() === 13);
check("v13: effect data unchanged", compat.effectData(v13Effect) === v13Effect);
check("v13: reads root changes", compat.effectChanges(v13Effect).length === 1);
check("v13: an empty system does not hide root changes", compat.effectChanges({ ...v13Effect, system: {} }).length === 1);
let modes = compat.messageModeChoices();
check("v13: roll modes from CONFIG.Dice", modes.options.map(o => o.value).join() === "publicroll,gmroll");
check("v13: labels localized", modes.options[0].label === "L(CHAT.RollPublic)");
check("v13: current from core.rollMode", modes.current === "gmroll");
check("v13: toMessage gets rollMode", JSON.stringify(compat.messageOptions("gmroll")) === '{"rollMode":"gmroll"}');
check("describe change", compat.describeChange({ key: "system.vitals.hp.bonus", value: 2 }) === "vitals.hp.bonus 2");

/* -------------------------------------------- */
/*  Foundry 14                                  */
/* -------------------------------------------- */

game.release.generation = 14;
CONFIG.ChatMessage.modes = { public: { label: "CHAT.MODES.public" }, gm: { label: "CHAT.MODES.gm" },
  blind: { label: "CHAT.MODES.blind" }, self: { label: "CHAT.MODES.self" } };
settings.messageMode = "self";

check("v14: generation", compat.generation() === 14);
const fitted = compat.effectData(v13Effect);
check("v14: changes moved under system", !("changes" in fitted) && Array.isArray(fitted.system?.changes));
check("v14: mode 2 becomes type add", fitted.system.changes[0].type === "add" && !("mode" in fitted.system.changes[0]),
  JSON.stringify(fitted.system.changes[0]));
check("v14: key and value kept", fitted.system.changes[0].key === "system.bonuses.carry" && fitted.system.changes[0].value === "5");
check("v14: other effect fields kept", fitted.name === "Backpack" && fitted.transfer === true);
check("v14: input not mutated", Array.isArray(v13Effect.changes) && v13Effect.changes[0].mode === 2);
check("v14: every mode maps", [0, 1, 2, 3, 4, 5].map(m => compat.effectData({ changes: [{ key: "k", mode: m, value: 1 }] })
  .system.changes[0].type).join() === "custom,multiply,add,downgrade,upgrade,override");
check("v14: an existing type is respected",
  compat.effectData({ changes: [{ key: "k", type: "override", value: 1 }] }).system.changes[0].type === "override");
check("v14: effect without changes untouched", compat.effectData({ name: "x" }).name === "x");
check("v14: reads system changes", compat.effectChanges(fitted).length === 1);
modes = compat.messageModeChoices();
check("v14: modes from CONFIG.ChatMessage.modes", modes.options.map(o => o.value).join() === "public,gm,blind,self");
check("v14: labels localized", modes.options[1].label === "L(CHAT.MODES.gm)");
check("v14: current from core.messageMode", modes.current === "self");
check("v14: toMessage gets messageMode", JSON.stringify(compat.messageOptions("gm")) === '{"messageMode":"gm"}');
check("no mode chosen, no option", JSON.stringify(compat.messageOptions("")) === "{}");

delete settings.messageMode;
check("v14: missing messageMode setting falls back to the first mode", compat.messageModeChoices().current === "public");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

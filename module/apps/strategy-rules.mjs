import { IROP } from "../config.mjs";
import { strategyRules } from "../rules/strategy.mjs";
import { getStrategyRules, getStrategyScale } from "../settings.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Every number the Strategy Layer runs on, grouped as the turn runs. RULED
 * 2026-10-08 (Johnald): the defaults stand and a GM can change any of them in game.
 * Each entry is the rule's path in IROP.strategyRules and how the form names it.
 */
export const RULE_FIELDS = [
  { section: "GENESIS", fields: [
    ["strengthMax", "Highest Strength"],
    ["megacityGrowthEvery", "Megacities grow every (turns)"],
    ["megacityGrowth", "Megacity Strength gained"],
    ["strengthMoves", "Strength moved a turn"],
    ["heatRise.minor", "Heat from a minor action"],
    ["heatRise.major", "Heat from a major action"],
    ["heatRise.critical", "Heat from a critical action"],
    ["heatQuietWeeks", "Quiet turns before Heat falls"],
    ["heatFall", "Heat lost when quiet"]
  ] },
  { section: "Losing Ground", fields: [
    ["incursionStrength", "Incursion at Strength"],
    ["incursionWeeks", "Turns to stop an Incursion"],
    ["incursionMoves", "Strength an Incursion brings"],
    ["incursionLoss", "Strength lost when one is broken"],
    ["liberationHeat", "Heat spike near a liberation"],
    ["liberationReach", "Heat spike reach (borders)"]
  ] },
  { section: "ODR", fields: [
    ["researchPassive", "Research progress a turn"],
    ["engineeringPassive", "Engineering progress a turn"],
    ["engineeringSlots", "Engineering projects at once"],
    ["intelPassive", "Intelligence progress a turn"],
    ["salvagePercent", "Salvage, % of project cost"]
  ] },
  { section: "Events", fields: [
    ["eventEvery", "Event Phase every (turns)"],
    ["eventDraw", "Event cards drawn"],
    ["darkEventEvery", "Dark Events every (turns)"],
    ["darkEventDraw", "Dark Events drawn"],
    ["darkEventKeep", "Dark Events used"],
    ["worldEventEvery", "World Events every (turns)"],
    ["worldEventDraw", "World Event cards drawn"]
  ] },
  { section: "Missions", fields: [
    ["missionReputation.success", "Reputation for a success"],
    ["missionReputation.failure", "Reputation for a failure"]
  ] },
  { section: "Support (Logistics)", fields: [
    ["support.reinforcements", "Reinforcements"],
    ["support.insideJobMin", "Inside Job, least"],
    ["support.insideJobMax", "Inside Job, most"],
    ["support.hiddenCache", "Hidden Cache"],
    ["support.mortarStrike", "Mortar Strike"],
    ["support.emergencyExtraction", "Emergency Extraction"]
  ] }
];

/**
 * The Strategy Layer settings window, from Configure Settings. GM only. Johnald,
 * 2026-10-08: all the Strategy Layer settings together, so the campaign scale and
 * the automatic GENESIS switch sit here, above the numbers, not elsewhere in the list.
 */
export class StrategyRulesConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-strategy-rules",
    tag: "form",
    classes: ["irop", "irop-strategy-rules"],
    window: { title: "Strategy Layer settings", icon: "fa-solid fa-chess-rook", resizable: true },
    position: { width: 520, height: 640 },
    form: { handler: StrategyRulesConfig.#onSubmit, closeOnSubmit: true },
    actions: { reset: StrategyRulesConfig.#onReset }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/strategy-rules.hbs", scrollable: [".rules-body"] }
  };

  /** The rules as this world has them, read from its setting. */
  static current() {
    return getStrategyRules();
  }

  /** @override */
  async _prepareContext(options) {
    const rules = StrategyRulesConfig.current();
    let automatic = true;
    try { automatic = game.settings.get("irop", "genesisAutomatic") !== false; }
    catch { automatic = true; }
    return {
      campaign: {
        scale: getStrategyScale().key,
        scales: Object.fromEntries(Object.entries(IROP.strategyScales).map(([k, v]) => [k, v.label])),
        automatic
      },
      sections: RULE_FIELDS.map(s => ({
        section: s.section,
        fields: s.fields.map(([path, label]) => ({
          path, label,
          value: foundry.utils.getProperty(rules, path),
          initial: foundry.utils.getProperty(IROP.strategyRules, path)
        }))
      }))
    };
  }

  /** Save the campaign settings and the numbers the form holds. */
  static async #onSubmit(event, form, formData) {
    if ( !game.user.isGM ) return;
    const { campaign, ...numbers } = foundry.utils.expandObject(formData.object);
    if ( campaign?.scale && IROP.strategyScales[campaign.scale] ) await game.settings.set("irop", "strategyScale", campaign.scale);
    await game.settings.set("irop", "genesisAutomatic", !!campaign?.automatic);
    const saved = {};
    for ( const [path, value] of Object.entries(foundry.utils.flattenObject(numbers)) ) {
      const n = Math.round(Number(value));
      if ( Number.isFinite(n) ) foundry.utils.setProperty(saved, path, n);
    }
    await game.settings.set("irop", "strategyRules", strategyRules(saved));
  }

  /** Put every number back to the defaults; the campaign settings stay as they are. */
  static async #onReset() {
    if ( !game.user.isGM ) return;
    await game.settings.set("irop", "strategyRules", {});
    this.render();
  }
}

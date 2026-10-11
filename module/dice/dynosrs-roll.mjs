import { DICE, DICE_ORDER, BANK_CAP, SYMBOL_LABEL, symbolsFor, resolve, poolSize } from "../rules/dynosrs.mjs";
import { houseRules } from "../settings.mjs";

/** Font Awesome glyph per symbol, matching the bot's check, X, triangles, star and skull. */
export const SYMBOL_ICON = {
  SUCCESS: "fa-solid fa-check",
  FAILURE: "fa-solid fa-xmark",
  EDGE: "fa-solid fa-caret-up",
  DANGER: "fa-solid fa-caret-down",
  VICTORY: "fa-solid fa-star",
  DEFEAT: "fa-solid fa-skull"
};

const KEY_BY_NAME = Object.fromEntries(Object.values(DICE).map(d => [d.name.toLowerCase(), d.key]));

/**
 * Which DYNOSRS die a rolled term is, from its flavor and its size together.
 * Skill and Aptitude swapped sizes on 2026-10-06, so a card rolled before that
 * says "1d12[Aptitude]". When the named die has a different size, take the die
 * of the same polarity that has this size; old cards then read as the die they
 * really were.
 */
export function dieKeyForTerm(flavor, faces) {
  const named = DICE[KEY_BY_NAME[String(flavor ?? "").toLowerCase()]];
  if ( !named ) return null;
  if ( !faces || (named.sides === faces) ) return named.key;
  return Object.values(DICE).find(d => (d.polarity === named.polarity) && (d.sides === faces))?.key ?? null;
}

/**
 * A DYNOSRS pool rolled with real Foundry dice. Each die is an ordinary d8, d10
 * or d12 term carrying its die name as flavor, so Dice So Nice and roll logs see
 * real dice, and the face that came up is read back through the canon tables.
 *
 * The house rules in force when the pool was built are stored on the roll, so a
 * card renders the same result forever even if the settings change later.
 */
export class DynosrsRoll extends foundry.dice.Roll {

  static CHAT_TEMPLATE = "systems/irop/templates/chat/dynosrs-roll.hbs";

  /**
   * @param {Record<string, number>} pool   dice counts keyed by DICE key
   * @param {object} [options]              label, actorUuid, skill, difficulty and other card details
   */
  static fromPool(pool, options = {}) {
    const terms = DICE_ORDER.filter(k => pool[k] > 0).map(k => `${pool[k]}d${DICE[k].sides}[${DICE[k].name}]`);
    if ( !terms.length ) throw new Error("A DYNOSRS pool needs at least one die.");
    const clean = Object.fromEntries(DICE_ORDER.map(k => [k, Math.max(0, pool[k] || 0)]));
    return new this(terms.join(" + "), {}, { houseRules: houseRules(), ...options, pool: clean });
  }

  /** Every physical die rolled, with its DYNOSRS key, face and symbols. */
  get symbolDice() {
    const out = [];
    for ( const term of this.dice ) {
      const key = dieKeyForTerm(term.flavor, term.faces);
      if ( !key ) continue;
      for ( const r of term.results ) {
        if ( r.active === false ) continue;
        out.push({ key, name: DICE[key].name, polarity: DICE[key].polarity, face: r.result,
          symbols: symbolsFor(key, r.result) });
      }
    }
    return out.sort((a, b) => DICE[a.key].order - DICE[b.key].order);
  }

  /** The full resolution, recomputed from the faces. */
  get resolution() {
    return resolve(this.symbolDice, this.options.houseRules ?? houseRules());
  }

  /** @override */
  async _prepareChatRenderContext({ flavor, isPrivate = false, message, ...options } = {}) {
    const context = await super._prepareChatRenderContext({ flavor, isPrivate, ...options });
    if ( isPrivate ) return { ...context, isPrivate };

    const res = this.resolution;
    const flags = message?.flags?.irop ?? {};
    const defeatApplied = !!flags.defeatApplied;
    const outcome = defeatApplied ? "fail" : res.outcome;

    const dice = this.symbolDice.map(d => ({
      ...d,
      symbols: d.symbols.map(s => ({ key: s, icon: SYMBOL_ICON[s], label: SYMBOL_LABEL[s] })),
      tooltip: `${d.name} d${DICE[d.key].sides}: face ${d.face}`
    }));

    const net = Object.entries(res.net).filter(([, n]) => n > 0)
      .map(([s, n]) => ({ key: s, count: n, icon: SYMBOL_ICON[s], label: SYMBOL_LABEL[s] }));

    const banked = flags.banked ?? {};
    const banking = res.banking.map(b => ({
      ...b,
      label: SYMBOL_LABEL[b.symbol],
      icon: SYMBOL_ICON[b.symbol],
      gm: b.owner === "gm",
      done: !!banked[b.symbol]
    }));

    // Counted from the dice actually rolled, so the line always matches the faces shown.
    const rolled = {};
    for ( const d of this.symbolDice ) rolled[d.key] = (rolled[d.key] ?? 0) + 1;
    const poolText = DICE_ORDER.filter(k => rolled[k]).map(k => `${rolled[k]} ${DICE[k].name}`).join(", ");

    let summary;
    if ( defeatApplied ) summary = "Failed: the GM spent the Defeat.";
    else if ( res.totalWash ) summary = "Total wash: nothing left on the table. Reroll fresh.";
    else if ( res.stalemate ) summary = res.tiebreak
      ? `Stalemate. If the moment is time sensitive, the leftover ${SYMBOL_LABEL[res.tiebreak.from]} decides it.`
      : "Stalemate: the check needs more time.";
    else if ( res.tiebreak?.applied ) summary = `Tie broken by leftover ${SYMBOL_LABEL[res.tiebreak.from]}.`;

    return {
      ...context,
      isPrivate,
      label: this.options.label ?? "DYNOSRS check",
      subtitle: this.options.subtitle ?? "",
      poolText,
      dice,
      net,
      outcome,
      outcomeLabel: { pass: "Passed", fail: "Failed", stalemate: "Stalemate" }[outcome],
      summary,
      victoriesSpent: res.victoriesSpent,
      banking,
      canBank: !!this.options.actorUuid,
      showDefeat: res.defeatIsGmOption && (res.outcome === "pass") && !defeatApplied,
      messageId: message?.id ?? ""
    };
  }

  /** Total dice in this roll's pool. */
  get size() {
    return poolSize(this.options.pool ?? {});
  }

  /** Banking caps, re-exported for the chat handlers. */
  static BANK_CAP = BANK_CAP;
}

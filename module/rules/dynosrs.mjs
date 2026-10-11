/**
 * DYNOSRS RULES CORE
 * ==================
 *
 * Ported from the Discord bot library (irop/functions/_lib/dynosrs), which is
 * the single source of truth for these rules. The face layouts, pool building
 * and resolution order are copied, not rewritten, so Foundry and Discord can
 * never disagree. If one changes, change both and rerun the test harness.
 *
 * This file is pure: no Foundry globals, no randomness. Foundry rolls the
 * physical dice; this file turns faces into symbols and symbols into outcomes.
 *
 * CANON: the per face layouts are the real ones from the Foundry macro that ran
 * the live game, cross checked against the handoff's symbol totals on
 * 2026-08-13. testTotals() below asserts them.
 *
 * RULED 2026-10-06 (Johnald): Skill and Aptitude swap definitions. Skill is now
 * the d12 (the die with Victory) and Aptitude the d10. The faces stay with the
 * die sizes; only the names moved. So the dice an attribute grants are Aptitude
 * dice (d10), and training that matches the attribute upgrades them to Skill
 * dice (d12). Until the bot library is updated to match, it still uses the old
 * names; the test harness compares across the rename.
 */

export const SYMBOL = {
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
  EDGE: "EDGE",
  DANGER: "DANGER",
  VICTORY: "VICTORY",
  DEFEAT: "DEFEAT"
};

export const SYMBOL_LABEL = {
  SUCCESS: "Success",
  FAILURE: "Failure",
  EDGE: "Edge",
  DANGER: "Danger",
  VICTORY: "Victory",
  DEFEAT: "Defeat"
};

const S = SYMBOL.SUCCESS;
const F = SYMBOL.FAILURE;
const E = SYMBOL.EDGE;
const D = SYMBOL.DANGER;
const V = SYMBOL.VICTORY;
const X = SYMBOL.DEFEAT;

/**
 * The six dice. `faces` is indexed by face minus one; an empty array is blank.
 * `order` is the display order, positives first.
 */
export const DICE = {
  skill: {
    key: "skill", name: "Skill", sides: 12, polarity: "positive", order: 0,
    canonTotals: { SUCCESS: 12, EDGE: 9, VICTORY: 1 },
    faces: [[], [S], [S], [S, S], [S, S, S], [E], [E, E], [S, E], [S, E, E], [S, S, E], [S, E, E], [V]]
  },
  aptitude: {
    key: "aptitude", name: "Aptitude", sides: 10, polarity: "positive", order: 1,
    canonTotals: { SUCCESS: 7, EDGE: 9 },
    faces: [[], [S], [S], [S, S], [E], [E], [E, E], [E, E], [S, E, E], [S, S, E]]
  },
  assistance: {
    key: "assistance", name: "Assistance", sides: 8, polarity: "positive", order: 2,
    canonTotals: { SUCCESS: 3, EDGE: 6 },
    faces: [[], [], [E], [S], [E, E], [S, E], [E], [S, E]]
  },
  obstacle: {
    key: "obstacle", name: "Obstacle", sides: 12, polarity: "negative", order: 3,
    canonTotals: { FAILURE: 10, DANGER: 11, DEFEAT: 1 },
    faces: [[], [F], [F], [F, F], [F, F, D], [D], [D, D], [F, D], [F, D, D], [D, D, D], [F, F, D], [X]]
  },
  difficulty: {
    key: "difficulty", name: "Difficulty", sides: 10, polarity: "negative", order: 4,
    canonTotals: { FAILURE: 6, DANGER: 9 },
    faces: [[], [F], [F, F], [D], [F, D], [D, D], [D], [D, D], [D], [F, F, D]]
  },
  hindrance: {
    key: "hindrance", name: "Hindrance", sides: 8, polarity: "negative", order: 5,
    canonTotals: { FAILURE: 3, DANGER: 5 },
    faces: [[], [], [D], [F], [F], [D, D], [D], [F, D]]
  }
};

/** Dice keys in display order. */
export const DICE_ORDER = Object.values(DICE).sort((a, b) => a.order - b.order).map(d => d.key);

/** HANDOFF Section 7: check difficulty to number of Difficulty dice. */
export const DIFFICULTY = {
  easy: { name: "Easy", dice: 1 },
  normal: { name: "Normal", dice: 2 },
  hard: { name: "Hard", dice: 3 },
  challenging: { name: "Challenging", dice: 4 },
  formidable: { name: "Formidable", dice: 5 },
  nighImpossible: { name: "Nigh Impossible", dice: 6, requiresVictory: true }
};

/** HANDOFF Section 7: banking caps. All reset to 0 at end of mission or session. */
export const BANK_CAP = { EDGE: 3, DANGER: 6, VICTORY: 1, DEFEAT: 1 };

/**
 * HOUSE RULES, adopted 2026-08-13 to cut the stalemate rate. In Foundry these
 * are world settings; these are the defaults the settings start from.
 *   tiebreakWithEdgeAndDanger  leftover Edge or Danger breaks a stalemate
 *   minimumPoolDice            a skill pool never drops below this many dice
 */
export const HOUSE_RULE_DEFAULTS = {
  tiebreakWithEdgeAndDanger: true,
  minimumPoolDice: 2
};

/** Attribute modifier is the tens digit of the attribute. HANDOFF Section 5. */
export function attributeModifier(value) {
  return Math.floor(Math.max(0, Number(value) || 0) / 10);
}

/**
 * Build a skill pool from an attribute modifier and a skill rank.
 *
 * CANON (handoff Section 7), with the 2026-10-06 renaming: base = floor(modifier / 2)
 * Aptitude dice (d10); training adds dice up to the modifier total; past it adds
 * Aptitude dice; once base reaches the rank, those dice upgrade to Skill dice (d12).
 * The bot's reading, which reproduces all three canon data points (mod 4 rank 0
 * is 2 Aptitude; mod 5 rank 3 is 2 Skill + 1 Aptitude; mod 6 rank 3 is 3 Skill):
 *
 *     total    = max(base, rank)
 *     skill    = min(base, rank)        the upgraded d12s
 *     aptitude = total - skill          the d10s
 *
 * The minimum pool house rule tops the pool up with Aptitude dice, never Skill.
 */
export function buildPool(modifier, rank, { minimumPoolDice = HOUSE_RULE_DEFAULTS.minimumPoolDice } = {}) {
  const base = Math.floor(modifier / 2);
  const derived = Math.max(base, rank);
  const total = Math.max(derived, minimumPoolDice || 0);
  const skill = Math.min(base, rank);
  return { base, skill, aptitude: total - skill, total, derived, floored: total > derived };
}

/**
 * Opposed check. HANDOFF: an NPC's dice become the player's opposition, size for
 * size: its Aptitude dice (d10) become Difficulty dice (d10), and its Skill dice
 * (d12) become Obstacle dice (d12).
 */
export function opposedPool(playerPool, npc) {
  return {
    ...playerPool,
    difficulty: (playerPool.difficulty || 0) + (npc.aptitude || 0),
    obstacle: (playerPool.obstacle || 0) + (npc.skill || 0)
  };
}

/** Symbols on one face of one die. Face is 1 based, as the die reads. */
export function symbolsFor(key, face) {
  const die = DICE[key];
  if ( !die ) throw new Error(`Unknown DYNOSRS die: ${key}`);
  const symbols = die.faces[face - 1];
  if ( !symbols ) throw new Error(`${die.name} has no face ${face}`);
  return symbols;
}

function emptyTally() {
  return { SUCCESS: 0, FAILURE: 0, EDGE: 0, DANGER: 0, VICTORY: 0, DEFEAT: 0 };
}

/** @param {Array<{symbols: string[]}>} rolls */
export function tallySymbols(rolls) {
  const tally = emptyTally();
  for ( const roll of rolls ) for ( const s of roll.symbols ) tally[s] += 1;
  return tally;
}

const CANCELS = [
  [SYMBOL.SUCCESS, SYMBOL.FAILURE],
  [SYMBOL.EDGE, SYMBOL.DANGER],
  [SYMBOL.VICTORY, SYMBOL.DEFEAT]
];

/** Cancel opposing symbols pairwise. Returns a new tally. */
export function cancel(tally) {
  const net = { ...tally };
  for ( const [pos, neg] of CANCELS ) {
    const n = Math.min(net[pos], net[neg]);
    net[pos] -= n;
    net[neg] -= n;
  }
  return net;
}

/**
 * Resolve rolled dice to an outcome. Same order of operations as the bot:
 *   1. tally raw symbols, 2. cancel pairwise,
 *   3. while failing and Victory remains, spend Victory to turn a failure into
 *      a success (Victory auto applies; the handoff states it as a rule),
 *   4. Defeat is never auto applied, it is surfaced as a GM option,
 *   5. a stalemate with Edge or Danger left is broken by the tiebreak house
 *      rule, or offered if the rule is off; a total wash is rerolled fresh.
 *
 * @param {Array<{symbols: string[]}>} rolls
 * @param {{tiebreakWithEdgeAndDanger?: boolean}} [houseRules]
 */
export function resolve(rolls, houseRules = HOUSE_RULE_DEFAULTS) {
  const raw = tallySymbols(rolls);
  let net = cancel(raw);

  let victoriesSpent = 0;
  while ( (net.FAILURE > 0) && (net.VICTORY > 0) ) {
    net.VICTORY -= 1;
    net.FAILURE -= 1;
    net.SUCCESS += 1;
    victoriesSpent += 1;
    net = cancel(net);
  }

  let stalemate = (net.SUCCESS === 0) && (net.FAILURE === 0);
  const totalWash = stalemate && !net.EDGE && !net.DANGER && !net.VICTORY && !net.DEFEAT;

  let tiebreak = null;
  if ( stalemate && !totalWash && (net.EDGE > 0 || net.DANGER > 0) ) {
    const converting = net.EDGE > 0
      ? { from: "EDGE", to: "SUCCESS", amount: net.EDGE, outcome: "pass" }
      : { from: "DANGER", to: "FAILURE", amount: net.DANGER, outcome: "fail" };
    if ( houseRules.tiebreakWithEdgeAndDanger ) {
      net[converting.to] += converting.amount;
      net[converting.from] -= converting.amount;
      tiebreak = { ...converting, applied: true };
      stalemate = false;
    }
    else tiebreak = { ...converting, applied: false };
  }

  const passed = net.SUCCESS > 0;
  const failed = net.FAILURE > 0;
  return {
    raw,
    net,
    victoriesSpent,
    passed,
    failed,
    stalemate,
    totalWash,
    tiebreak,
    defeatIsGmOption: net.DEFEAT > 0,
    banking: bankingNotes(net),
    outcome: passed ? "pass" : (failed ? "fail" : "stalemate")
  };
}

/** What a resolved roll makes available to bank, and against which cap. */
export function bankingNotes(net) {
  const notes = [];
  if ( net.EDGE > 0 ) notes.push({ symbol: "EDGE", amount: net.EDGE, cap: BANK_CAP.EDGE, owner: "player" });
  if ( net.DANGER > 0 ) notes.push({ symbol: "DANGER", amount: net.DANGER, cap: BANK_CAP.DANGER, owner: "gm" });
  if ( net.VICTORY > 0 ) notes.push({ symbol: "VICTORY", amount: net.VICTORY, cap: BANK_CAP.VICTORY, owner: "player" });
  if ( net.DEFEAT > 0 ) notes.push({ symbol: "DEFEAT", amount: net.DEFEAT, cap: BANK_CAP.DEFEAT, owner: "gm" });
  return notes;
}

/**
 * Competitive check. HANDOFF: "each party rolls; count Successes, most
 * Successes wins. Ties break by Victory, then Edge."
 * @param {Array<{name: string, resolution: object}>} entrants already resolved
 */
export function rankCompetitive(entrants) {
  const score = r => [r.resolution.net.SUCCESS, r.resolution.net.VICTORY, r.resolution.net.EDGE];
  const ranked = [...entrants].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for ( let i = 0; i < sa.length; i++ ) if ( sb[i] !== sa[i] ) return sb[i] - sa[i];
    return 0;
  });
  const best = score(ranked[0]);
  const tied = ranked.filter(r => score(r).every((v, i) => v === best[i]));
  return { ranked, winner: tied.length === 1 ? ranked[0] : null, tiedAt: tied.length > 1 ? tied : null };
}

/** Total dice in a pool. */
export function poolSize(pool) {
  return DICE_ORDER.reduce((n, k) => n + (pool[k] || 0), 0);
}

/** Assert every die reproduces the handoff's canon symbol totals. Returns a list of problems. */
export function testTotals() {
  const problems = [];
  for ( const die of Object.values(DICE) ) {
    if ( die.faces.length !== die.sides ) problems.push(`${die.name}: ${die.faces.length} faces, expected ${die.sides}`);
    const totals = tallySymbols(die.faces.map(symbols => ({ symbols })));
    for ( const [sym, n] of Object.entries(totals) ) {
      if ( (die.canonTotals[sym] || 0) !== n ) problems.push(`${die.name}: ${sym} ${n}, canon ${die.canonTotals[sym] || 0}`);
    }
  }
  return problems;
}

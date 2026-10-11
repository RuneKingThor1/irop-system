/**
 * d100 COMBAT RULES CORE
 * ======================
 *
 * Ported from the Discord bot library (irop/functions/_lib/combat), the single
 * source of truth. Pure: no Foundry globals and no randomness.
 *
 * CANON (handoff Section 6): roll a d100 and meet or roll under the relevant
 * attribute. Difficulty Modifiers apply to the ROLL: negative is easier,
 * positive is harder. Worked example: Alan, Perception 45, fires an Assault
 * Rifle at a trooper in half cover (+30) with weapon accuracy -15. Rolls 45:
 * 45 + 30 - 15 = 60, over 45, a miss.
 *
 * ASSUMPTION (bot, kept): the modified total is compared raw, with no clamp,
 * no automatic hit and no automatic miss. Out of band totals are reported.
 */

/**
 * COVER (canon). Cover applies a different D.M. depending on the roll:
 * accuracy to the attacker's hit, critical to the critical roll, dodge to the
 * defender's Dodge. The dodge row runs opposite: the open is the penalty.
 */
export const COVER = {
  none: { name: "No cover", accuracy: 0, critical: 0, dodge: 30 },
  half: { name: "Half cover", accuracy: 30, critical: 30, dodge: -15 },
  full: { name: "Full cover", accuracy: 45, critical: 45, dodge: -30 }
};

/**
 * Battlefield modifiers (canon, handoff Section 6). `values` holds the D.M. per
 * roll role (accuracy, critical, dodge). A modifier with no value for a role
 * contributes nothing to that roll, which is not an error.
 */
export const MODIFIERS = {
  exposed: {
    name: "Exposed",
    values: { critical: -15 },
    note: "A critical modifier, not an accuracy one: an exposed target is easier to crit, not to hit."
  },
  engaged_light: { name: "Engaged in melee, Light weapon", values: { accuracy: 0 } },
  engaged: { name: "Engaged in melee, ranged attack", values: { accuracy: 20 } },
  engaged_cumbersome: { name: "Engaged in melee, Cumbersome weapon", values: { accuracy: 40 } },
  high_ground: { name: "High ground, target below", values: { accuracy: -10 } },
  low_ground: { name: "Low ground, target above", values: { accuracy: 10 } },
  disorientated: {
    name: "Disorientated",
    values: { accuracy: 20, dodge: 20 },
    note: "The only modifier that penalises the same character on offence and defence."
  },
  smoke_fog: { name: "Smoke or fog", values: { accuracy: 20 } },
  suppressed: {
    name: "Suppressed",
    values: { accuracy: 20 },
    note: "Paraphysical abilities are unaffected by suppression."
  },
  unaware: {
    name: "Unaware",
    values: { accuracy: -20 },
    forcesNoCoverOnDodge: true,
    note: "An unaware character can still dodge, but dodges as though out of cover."
  }
};

/** Which engaged modifier key applies to a weapon's handling. */
export const ENGAGED_BY_HANDLING = {
  light: "engaged_light",
  standard: "engaged",
  cumbersome: "engaged_cumbersome"
};

/** The modifier keys that can apply to a given roll role. */
export function modifiersFor(role) {
  return Object.entries(MODIFIERS)
    .filter(([, m]) => (m.values[role] !== undefined) || ((role === "dodge") && m.forcesNoCoverOnDodge))
    .map(([key]) => key);
}

/**
 * Turn chosen modifier keys, a cover choice and loose numbers into a labelled
 * list of D.M.s for one roll.
 *
 * @param {object} options
 * @param {string[]} [options.keys]        MODIFIERS keys
 * @param {string|null} [options.cover]    COVER key
 * @param {"accuracy"|"critical"|"dodge"} [options.role]
 * @param {number|null} [options.range]    the range band D.M. read off the weapon
 * @param {string} [options.rangeLabel]
 * @param {number} [options.accuracy]      weapon accuracy, already signed as a D.M.
 * @param {number} [options.critical]      weapon critical chance, already signed as a D.M.
 * @param {number} [options.extra]         situational D.M.
 * @param {number} [options.defense]       the target's Defense, from its worn armor (RULED 2026-10-07)
 * @param {string} [options.defenseLabel]
 * @returns {Array<{label: string, value: number}>}
 */
export function collectModifiers({ keys = [], cover = null, role = "accuracy", range = null, rangeLabel = "Range",
  accuracy = 0, critical = 0, extra = 0, defense = 0, defenseLabel = "Target's Defense" } = {}) {
  const list = [];
  const chosen = keys.map(k => MODIFIERS[k]).filter(Boolean);

  if ( (range !== null) && (range !== undefined) ) list.push({ label: rangeLabel, value: Number(range) || 0 });

  // An unaware character dodges as though in the open, whatever it is behind.
  const forcedOpen = (role === "dodge") && chosen.some(m => m.forcesNoCoverOnDodge);
  const coverKey = forcedOpen ? "none" : cover;
  const coverEntry = coverKey ? COVER[coverKey] : null;
  if ( coverEntry ) {
    const value = coverEntry[role] ?? 0;
    if ( value !== 0 ) {
      list.push({
        label: forcedOpen ? `${coverEntry.name} (unaware, dodging as if in the open)` : coverEntry.name,
        value
      });
    }
  }

  for ( const mod of chosen ) {
    const value = mod.values[role];
    if ( value === undefined ) continue;
    list.push({ label: mod.name, value });
  }

  // Defense makes the shot harder, as cover does: it adds to the roll.
  if ( defense ) list.push({ label: defenseLabel, value: defense });
  if ( accuracy ) list.push({ label: "Weapon accuracy", value: accuracy });
  if ( critical ) list.push({ label: "Weapon critical chance", value: critical });
  if ( extra ) list.push({ label: "Situational D.M.", value: extra });
  return list;
}

/** Sum of a modifier list. */
export function totalModifier(modifiers) {
  return modifiers.reduce((sum, m) => sum + (Number(m.value) || 0), 0);
}

/** The roll formula as the handoff writes it, for example "1d100 + 30 - 15". */
export function formula(modifiers) {
  const parts = ["1d100"];
  for ( const m of modifiers ) {
    const v = Number(m.value) || 0;
    if ( v === 0 ) continue;
    parts.push(v < 0 ? `- ${Math.abs(v)}` : `+ ${v}`);
  }
  return parts.join(" ");
}

/**
 * Resolve a d100 check from a die result already rolled.
 * Success when the modified total is less than or equal to the target.
 */
export function resolveCheck({ roll, modifiers = [], target }) {
  const mod = totalModifier(modifiers);
  const total = roll + mod;
  return {
    roll,
    totalModifier: mod,
    total,
    target,
    success: total <= target,
    margin: target - total,
    outOfBand: (total < 1) || (total > 100)
  };
}

/**
 * SCATTER (canon, supplied 2026-08-13). Direction 1d8 with North on a 1, then
 * clockwise. Distance in tiles: thrown 1d6, launched 1d8+3.
 */
export const SCATTER = {
  directions: ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"],
  methods: {
    thrown: { name: "Thrown", formula: "1d6" },
    launched: { name: "Launched", formula: "1d8 + 3" }
  }
};

/** One tile's step in each scatter direction on the map, North first, clockwise: x right, y down. */
const SCATTER_STEPS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/**
 * How far a scatter moves the blast, in tiles across and down (blast markers, 2026-10-09).
 * On a square grid a diagonal tile is one square along the diagonal, as tiles are counted
 * on the map; on any other grid the distance is measured straight along the direction.
 * @param {number} direction   The 1d8: 1 North, then clockwise
 * @param {number} distance    Tiles
 * @param {{square?: boolean}} [options]
 * @returns {{dx: number, dy: number}}
 */
export function scatterOffset(direction, distance, { square = true } = {}) {
  const i = ((Math.round(Number(direction) || 1) - 1) % 8 + 8) % 8;
  const d = Math.max(0, Number(distance) || 0);
  const [x, y] = SCATTER_STEPS[i];
  const k = (square || !(x && y)) ? d : d / Math.SQRT2;
  return { dx: x * k, dy: y * k };
}

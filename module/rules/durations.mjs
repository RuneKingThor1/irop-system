import { IROP } from "../config.mjs";

/**
 * Durations counting down (Johnald, 2026-10-20: "this will apply to more than just paraphysics").
 * At the start of each combatant's turn, what they carry ticks:
 *   - a status with an (X) drops by 1, as the field guide says ("every X effect ticks down by 1
 *     each turn except Stunned and Vulnerable"); one that deals damage at the start of a turn says
 *     so first, with the X it had; at 0 it comes off;
 *   - an effect that lasts a number of rounds (a power's Duration, or any effect a GM gives rounds)
 *     loses one; at 0 it ends, and a Concentration it carries ends with it.
 * Kept apart from Foundry so it can be tested: this says what changes, durations.mjs does it.
 */

const label = (def, x) => (x ? `${def.name} (${x})` : def.name);

/**
 * What a turn's start does to a character's effects.
 * @param {object[]} effects   Each: {id, name, statuses: string[], counter: number|null, rounds: number|null, timedName?: string}
 * @returns {{ops: {id: string, update?: object, remove?: true}[], lines: string[]}}
 */
export function tickEffects(effects = []) {
  const ops = [];
  const lines = [];
  for ( const e of effects ) {
    const statusId = (e.statuses?.length === 1) ? e.statuses[0] : null;
    const def = statusId ? IROP.statusEffects.find(s => s.id === statusId) : null;
    const rounds = Number(e.rounds);
    // A timed effect: rounds left.
    if ( Number.isFinite(rounds) && (rounds > 0) && (e.rounds !== null) ) {
      const name = e.timedName || e.name;
      const left = rounds - 1;
      if ( left <= 0 ) {
        ops.push({ id: e.id, remove: true });
        lines.push(`${name} ends.`);
      }
      else {
        ops.push({ id: e.id, update: { "flags.irop.rounds": left, ...(def ? {} : { name: `${name} (${left} ${left === 1 ? "round" : "rounds"})` }) } });
        lines.push(`${name}: ${left} ${left === 1 ? "round" : "rounds"} left.`);
      }
      continue;
    }
    // A status with an (X) that ticks.
    if ( !def?.counter || (def.ticks === false) ) continue;
    const x = Math.max(0, Number(e.counter) || 0);
    if ( !x ) continue;
    if ( def.onTurn ) lines.push(`${label(def, x)}: ${def.onTurn.replace(/X/g, String(x))}.`);
    const next = x - 1;
    if ( next <= 0 ) {
      ops.push({ id: e.id, remove: true });
      lines.push(`${def.name} wears off.`);
    }
    else {
      ops.push({ id: e.id, update: { "flags.irop.counter": next, name: label(def, next) } });
      if ( !def.onTurn ) lines.push(`${label(def, x)} ticks down to ${next}.`);
    }
  }
  return { ops, lines };
}

/** The name a timed effect wears: "Umbral Veil (2 rounds)". */
export function timedName(name, rounds) {
  const n = Math.max(0, Number(rounds) || 0);
  return n ? `${name} (${n} ${n === 1 ? "round" : "rounds"})` : name;
}

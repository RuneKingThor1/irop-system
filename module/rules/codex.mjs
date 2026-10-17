/**
 * The Threat Codex (Johnald, 2026-10-17): a journal page per enemy, linked to its NPC actor. Players
 * start with the enemy's name and art and nothing else; the GM reveals the rest as the cell learns it,
 * a section at a time (classification, attributes, vitals, defenses, paraphysics, field notes) and a
 * weapon, perk or mutation at a time. What players see is a copy of only what was revealed, kept on
 * the page, so nothing hidden ever reaches their client. Kept apart from Foundry so it can be tested.
 */

/** The sections a GM reveals whole, in page order. */
export const CODEX_SECTIONS = [
  { key: "classification", label: "Classification" },
  { key: "attributes", label: "Attributes" },
  { key: "vitals", label: "Vitals" },
  { key: "defenses", label: "Defenses" },
  { key: "paraphysics", label: "Paraphysics" }
];

/** The lists a GM reveals an entry at a time. */
export const CODEX_LISTS = [
  { key: "weapons", label: "Weapons" },
  { key: "abilities", label: "Abilities and perks" },
  { key: "mutations", label: "Mutations" }
];

/**
 * What players may see: the revealed sections whole, and from each list only the revealed entries.
 * @param {object} facts     Everything about the enemy (codex.mjs actorFacts)
 * @param {Record<string, boolean>} reveal   By section key, and lore
 * @param {string[]} items   Item ids revealed
 */
export function codexSnapshot(facts, reveal = {}, items = []) {
  const out = {};
  for ( const { key } of CODEX_SECTIONS ) if ( reveal[key] && facts?.[key] ) out[key] = structuredClone(facts[key]);
  const shown = new Set(items);
  for ( const { key } of CODEX_LISTS ) {
    const list = (facts?.[key] ?? []).filter(e => shown.has(e.id));
    if ( list.length ) out[key] = structuredClone(list);
  }
  return out;
}

/** How much of the file is known, as a share: sections revealed and entries revealed, of all there are. */
export function codexProgress(facts, reveal = {}, items = []) {
  const shown = new Set(items);
  let total = 0;
  let known = 0;
  for ( const { key } of CODEX_SECTIONS ) {
    if ( !facts?.[key] ) continue;
    total++;
    if ( reveal[key] ) known++;
  }
  for ( const { key } of CODEX_LISTS ) for ( const e of facts?.[key] ?? [] ) {
    total++;
    if ( shown.has(e.id) ) known++;
  }
  return total ? Math.round((known / total) * 100) : 0;
}

/** A file number for the page's header, steady for the same page: "TC-4F2A". */
export function codexNumber(id) {
  let h = 2166136261;
  for ( const ch of String(id ?? "") ) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `TC-${(h & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
}

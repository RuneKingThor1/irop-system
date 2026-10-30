/**
 * The Rules journal (Johnald, 2026-10-30): G opens a journal holding the game's rules, the site's
 * Combat Survival Guide page for page (assets/rules/rules.json, built by dev/build-rules.mjs).
 *
 * The journal lives in the world so every player can read it. The active GM's client writes it when
 * it is missing, and rewrites its pages whenever the bundled rules change (a new system version or a
 * rebuilt guide), so it never drifts from the release.
 */

export const RULES_JOURNAL = "Insurrection Rules";
const RULES_URL = "systems/irop/assets/rules/rules.json";

/** The world's rules journal, found by its flag so a rename does not lose it. */
export function rulesJournal() {
  return game.journal?.find(j => j.getFlag?.("irop", "rules")) ?? null;
}

/** A short fingerprint of the bundled rules, so the journal is rewritten only when they change. */
export function rulesStamp(text) {
  let h = 0;
  for ( let i = 0; i < text.length; i++ ) h = ((h * 31) + text.charCodeAt(i)) | 0;
  return `${text.length}.${(h >>> 0).toString(36)}`;
}

/** The pages as journal page data, in guide order. */
export function rulesPageData(pages) {
  return pages.map((p, i) => ({
    name: p.name,
    type: "text",
    sort: (i + 1) * 100000,
    title: { show: false, level: 1 },
    text: { content: p.html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 }
  }));
}

/** Write the journal, or rewrite its pages when the bundled rules have changed (GM). */
export async function syncRulesJournal({ force = false } = {}) {
  if ( !game.user?.isGM ) return null;
  let text;
  try {
    const res = await fetch(foundry.utils.getRoute(RULES_URL));
    if ( !res.ok ) throw new Error(`${res.status} ${res.statusText}`);
    text = await res.text();
  }
  catch(err) {
    console.warn("irop | The rules could not be read.", err);
    return null;
  }
  const stamp = rulesStamp(text);
  let journal = rulesJournal();
  if ( journal && !force && (journal.getFlag("irop", "rulesStamp") === stamp) ) return journal;
  const { pages } = JSON.parse(text);
  if ( !journal ) {
    journal = await JournalEntry.implementation.create({
      name: RULES_JOURNAL,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      flags: { irop: { rules: true } }
    });
  }
  else if ( journal.pages.size ) await journal.deleteEmbeddedDocuments("JournalEntryPage", journal.pages.map(p => p.id));
  await journal.createEmbeddedDocuments("JournalEntryPage", rulesPageData(pages));
  await journal.setFlag("irop", "rulesStamp", stamp);
  return journal;
}

/** G: open the rules, or close them if they are open. */
export async function toggleRules() {
  let journal = rulesJournal();
  if ( journal?.sheet?.rendered ) return journal.sheet.close();
  if ( !journal && game.user?.isGM ) journal = await syncRulesJournal();
  if ( !journal ) return ui.notifications?.info("The rules journal appears once a GM has logged in to this world.");
  if ( !journal.testUserPermission(game.user, "OBSERVER") ) return ui.notifications?.warn("You do not have permission to read the rules journal.");
  return journal.sheet.render({ force: true });
}

/** The G keybinding (init). */
export function registerRulesKey() {
  game.keybindings.register("irop", "openRules", {
    name: "Open the rules",
    hint: "Opens the Insurrection Rules journal, or closes it if it is open.",
    editable: [{ key: "KeyG" }],
    onDown: () => { toggleRules(); return true; },
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
}

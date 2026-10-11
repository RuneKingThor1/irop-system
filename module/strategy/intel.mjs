import { findJournal } from "../rules/war-room-map.mjs";

/**
 * A territory's intel on its card (Johnald, 2026-10-08): the journal linked on its
 * sheet, or one named like it, else the lore on its own sheet. A user sees only what
 * they could open themselves, so journal permissions work as fog of war: a page the
 * players cannot see reads "No intel on file".
 */

const byOrder = (a, b) => (a.sort ?? 0) - (b.sort ?? 0);

/** The world's journals as plain data, and their documents by UUID. */
function worldJournals() {
  const docs = new Map();
  const list = (game.journal?.contents ?? []).map(j => {
    docs.set(j.uuid, j);
    const pages = [...(j.pages?.contents ?? [])].sort(byOrder);
    for ( const p of pages ) docs.set(p.uuid, p);
    return { uuid: j.uuid, name: j.name, pages: pages.map(p => ({ uuid: p.uuid, name: p.name })) };
  });
  return { list, docs };
}

/** The journal entry or page a UUID names: from the world's journals, else Foundry's lookup. */
function resolve(uuid, docs = worldJournals().docs) {
  if ( !uuid ) return null;
  if ( docs.has(uuid) ) return docs.get(uuid);
  try {
    return foundry.utils.fromUuidSync?.(uuid) ?? null;
  }
  catch {
    return null;
  }
}

/** The page shown for a journal: a page itself, or an entry's first page. */
function pageOf(doc) {
  if ( doc?.documentName === "JournalEntry" ) return [...(doc.pages?.contents ?? [])].sort(byOrder)[0] ?? null;
  return doc ?? null;
}

/** A page as HTML: a text page's text, an image page's picture. */
function pageHTML(page) {
  if ( !page ) return "";
  if ( (page.type === "image") && page.src ) return `<p><img src="${String(page.src).replace(/"/g, "&quot;")}" alt=""></p>`;
  return page.text?.content ?? "";
}

const canSee = (doc, user) => !!user?.isGM || !!doc?.testUserPermission?.(user, "OBSERVER");

/**
 * What a territory's card shows as intel.
 * @param {Item} territory
 * @param {User} [user]
 * @returns {Promise<{html: string, title: string, source: "linked"|"name"|"sheet", uuid: string, hidden: boolean}|null>}
 */
export async function territoryIntel(territory, user = game.user) {
  if ( !territory ) return null;
  const enrich = (html, relativeTo) => foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { relativeTo, secrets: !!user?.isGM });
  const { list, docs } = worldJournals();
  const found = findJournal(territory, list);
  const doc = found ? resolve(found.uuid, docs) : null;
  if ( doc ) {
    const page = pageOf(doc);
    const shown = page ?? doc;
    if ( !canSee(shown, user) ) return { hidden: true, html: "", title: "", source: found.how, uuid: "" };
    return { hidden: false, html: await enrich(pageHTML(page), shown), title: shown.name ?? "", source: found.how, uuid: shown.uuid };
  }
  const own = territory.system?.description ?? "";
  if ( !own.trim() ) return null;
  if ( !canSee(territory, user) ) return { hidden: true, html: "", title: "", source: "sheet", uuid: "" };
  return { hidden: false, html: await enrich(own, territory), title: "", source: "sheet", uuid: "" };
}

/** What the territory sheet says about its journal: linked, matched by name, or neither. */
export function journalLink(territory) {
  const { list, docs } = worldJournals();
  const found = findJournal(territory, list);
  if ( !found ) return { linked: false, matched: false, name: "", uuid: "" };
  const doc = resolve(found.uuid, docs);
  const name = doc ? ((doc.documentName === "JournalEntryPage") && doc.parent ? `${doc.parent.name}: ${doc.name}` : doc.name) : "A journal no longer here";
  return { linked: found.how === "linked", matched: found.how === "name", name, uuid: found.uuid };
}

/** Open a journal entry, or the entry at a page. */
export function openJournal(uuid) {
  const doc = resolve(uuid);
  if ( !doc ) return null;
  if ( doc.documentName === "JournalEntryPage" ) return doc.parent?.sheet?.render({ force: true, pageId: doc.id });
  return doc.sheet?.render({ force: true });
}

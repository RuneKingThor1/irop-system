import { buildSnapshot, snapshotKey } from "./snapshot.mjs";

/**
 * ARTEMIS link and sync (Johnald, 2026-10-10). A player asks ARTEMIS for a code with /link
 * in Discord and enters it on their character's sheet here. The site answers with a sync
 * token for that character, which stays in this browser only (a client setting): world
 * data is readable by every player, and the token is what lets a sheet be written. From
 * then on, a few seconds after the character changes, its sheet is sent again, but only if
 * something ARTEMIS reads actually changed.
 *
 * Nothing comes back from Discord: ARTEMIS rolls from the sheet and never edits it.
 */

const SYSTEM = "irop";

/** How long a burst of changes settles before the sheet is sent, in milliseconds. */
export const SYNC_DELAY = 4000;

/** The sheet last sent for each actor, by uuid, so an unchanged one is not sent again. */
const sent = new Map();

/** Waiting sends, by actor uuid. */
const timers = new Map();

/** The site ARTEMIS answers from: the world setting, without a trailing slash. */
export function artemisUrl() {
  const url = String(game.settings.get(SYSTEM, "artemisUrl") ?? "").trim().replace(/\/+$/, "");
  return url || "https://75th-eclipse.com";
}

/**
 * This user's sync tokens, by world and actor uuid. A client setting is shared by every
 * world opened in this browser, so the world is part of the key.
 */
function allTokens() {
  return { ...(game.settings.get(SYSTEM, "artemisTokens") ?? {}) };
}

function keyOf(uuid) {
  return `${game.world?.id ?? ""}:${uuid}`;
}

function tokenFor(uuid) {
  return uuid ? (allTokens()[keyOf(uuid)] ?? null) : null;
}

/** The uuids of this world's actors linked from this browser. */
function linkedUuids() {
  const prefix = `${game.world?.id ?? ""}:`;
  return Object.keys(allTokens()).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
}

function setToken(uuid, token) {
  const all = allTokens();
  if ( token ) all[keyOf(uuid)] = token;
  else delete all[keyOf(uuid)];
  return game.settings.set(SYSTEM, "artemisTokens", all);
}

/** Whether this user has linked the actor (from this browser). */
export function isLinked(actor) {
  return !!tokenFor(actor?.uuid);
}

/** The actor's sheet as ARTEMIS reads it. */
export function snapshotOf(actor) {
  return buildSnapshot(actor, {
    origin: globalThis.window?.location?.origin ?? "",
    world: { id: game.world?.id ?? "", title: game.world?.title ?? "" },
    systemVersion: game.system?.version ?? ""
  });
}

async function call(path, { method = "POST", token = null, body = null } = {}) {
  const headers = { "Content-Type": "application/json" };
  if ( token ) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${artemisUrl()}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  }
  catch(err) {
    return { ok: false, status: 0, error: `ODR ARTEMIS could not be reached (${err.message}).` };
  }
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  return { ok: response.ok, status: response.status, error: data.error ?? (response.ok ? "" : `ODR ARTEMIS answered ${response.status}.`), data };
}

/**
 * Link an actor with a code from ARTEMIS.
 * @returns {Promise<boolean>}
 */
export async function linkActor(actor, code) {
  if ( !actor?.isOwner ) {
    ui.notifications.warn("Only the character's owner can link it to ODR ARTEMIS.");
    return false;
  }
  const clean = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if ( !clean ) {
    ui.notifications.warn("Enter the code ODR ARTEMIS gave you with /link in Discord.");
    return false;
  }
  const snapshot = snapshotOf(actor);
  const result = await call("/api/artemis/link", { body: { code: clean, snapshot } });
  if ( !result.ok || !result.data.token ) {
    ui.notifications.error(result.error || "ODR ARTEMIS did not link the character.");
    return false;
  }
  await setToken(actor.uuid, result.data.token);
  sent.set(actor.uuid, snapshotKey(snapshot));
  ui.notifications.info(`${actor.name} is linked to ODR ARTEMIS${result.data.discordName ? ` for ${result.data.discordName}` : ""}. Roll for them in Discord.`);
  return true;
}

/**
 * Send an actor's sheet to ARTEMIS, if it is linked from here and something changed.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.force]   Send it even if nothing changed
 * @param {boolean} [options.notify]  Say so when it is done
 */
export async function syncActor(actor, { force = false, notify = false } = {}) {
  const token = tokenFor(actor?.uuid);
  if ( !token || !actor.isOwner ) return false;
  const snapshot = snapshotOf(actor);
  const key = snapshotKey(snapshot);
  if ( !force && (sent.get(actor.uuid) === key) ) return false;
  const result = await call("/api/artemis/sync", { token, body: { snapshot } });
  if ( result.status === 401 ) {
    // Unlinked from Discord, or linked again elsewhere: this browser's token is dead.
    await setToken(actor.uuid, null);
    sent.delete(actor.uuid);
    ui.notifications.warn(`${actor.name} is no longer linked to ODR ARTEMIS from here. Link it again from its sheet to keep it up to date.`);
    return false;
  }
  if ( !result.ok ) {
    console.warn(`irop | ARTEMIS sync for ${actor.name} failed:`, result.error);
    if ( notify ) ui.notifications.error(result.error);
    return false;
  }
  sent.set(actor.uuid, key);
  if ( notify ) ui.notifications.info(`${actor.name}'s sheet is up to date in ODR ARTEMIS.`);
  return true;
}

/** Unlink an actor, from its sheet. */
export async function unlinkActor(actor) {
  const token = tokenFor(actor?.uuid);
  if ( !token ) return false;
  const result = await call("/api/artemis/sync", { method: "DELETE", token });
  await setToken(actor.uuid, null);
  sent.delete(actor.uuid);
  if ( !result.ok && result.status !== 401 ) ui.notifications.warn(`ODR ARTEMIS could not be told (${result.error}); the link is forgotten here.`);
  else ui.notifications.info(`${actor.name} is unlinked from ODR ARTEMIS.`);
  return true;
}

/** Send an actor's sheet once its changes settle. */
export function scheduleSync(actor) {
  if ( !actor?.uuid || !isLinked(actor) ) return;
  clearTimeout(timers.get(actor.uuid));
  timers.set(actor.uuid, setTimeout(() => {
    timers.delete(actor.uuid);
    syncActor(actor).catch(err => console.warn("irop | ARTEMIS sync failed", err));
  }, SYNC_DELAY));
}

/** The actor a changed document belongs to: an actor, or the actor of an item or effect. */
function ownerActor(doc) {
  if ( doc?.documentName === "Actor" ) return doc;
  const parent = doc?.parent;
  if ( parent?.documentName === "Actor" ) return parent;
  // An effect on an item on an actor.
  if ( parent?.parent?.documentName === "Actor" ) return parent.parent;
  return null;
}

/** Hooks that send a linked character's sheet when it changes, and once at ready. Called at init. */
export function registerArtemis() {
  const changed = doc => {
    const actor = ownerActor(doc);
    if ( actor && (actor.type === "operative") ) scheduleSync(actor);
  };
  for ( const hook of ["updateActor", "createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    Hooks.on(hook, changed);
  }
  Hooks.once("ready", () => {
    // Catch up anything changed while this browser was away, a few seconds in.
    for ( const uuid of linkedUuids() ) {
      const actor = foundry.utils.fromUuidSync(uuid);
      if ( actor ) scheduleSync(actor);
    }
  });
}

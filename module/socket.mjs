/**
 * Players acting on world data (Strategy Layer step 5, 2026-10-08). Johnald: the
 * players drive the ODR phase (which research, how Logistics and Intel are used,
 * the week's Tactical Action), but only a GM can write world items and settings.
 * So a player's action travels over the system socket to the active GM's client,
 * which checks it and does it. If something is refused, the player is told why.
 */

const CHANNEL = "system.irop";
const HANDLERS = {};

/**
 * Name an action the GM's client can run for a player.
 * @param {string} name
 * @param {(payload: object, user: User) => Promise<{error?: string, notice?: string}|void>} fn
 */
export function registerAction(name, fn) {
  HANDLERS[name] = fn;
}

/** Listen on the system socket. Called once, at ready. */
export function initSocket() {
  game.socket?.on(CHANNEL, async data => {
    if ( data?.reply ) {
      if ( data.userId === game.user.id ) ui.notifications[data.level === "info" ? "info" : "warn"](data.message);
      return;
    }
    // Only one GM answers: the active one.
    if ( !game.user.isGM || (game.users.activeGM?.id !== game.user.id) ) return;
    const user = game.users.get(data?.userId);
    const fn = HANDLERS[data?.action];
    if ( !user || !fn ) return;
    try {
      const result = await fn(data.payload ?? {}, user);
      if ( result?.error ) reply(user, result.error);
      else if ( result?.notice ) ui.notifications.info(`${user.name}: ${result.notice}`);
    }
    catch(err) {
      console.error("irop | an action for a player failed", err);
      reply(user, `The GM's client could not do that: ${err.message}`);
    }
  });
}

function reply(user, message, level = "warn") {
  game.socket.emit(CHANNEL, { reply: true, userId: user.id, message, level });
}

/**
 * Run an action as the GM: here if this user is a GM, else on the active GM's client.
 * @param {string} action
 * @param {object} [payload]
 * @param {object} [options]
 * @param {string} [options.offline]   What a player is told when no GM is connected
 * @returns {Promise<object|null>}   The result here; null when sent to the GM
 */
export async function asGM(action, payload = {}, { offline = "No GM is connected. The ODR phase needs one online to record what you do." } = {}) {
  const fn = HANDLERS[action];
  if ( !fn ) throw new Error(`No such action: ${action}`);
  if ( game.user.isGM ) {
    const result = await fn(payload, game.user);
    if ( result?.error ) ui.notifications.warn(result.error);
    return result ?? null;
  }
  if ( !game.users.activeGM ) {
    ui.notifications.warn(offline);
    return null;
  }
  game.socket.emit(CHANNEL, { action, payload, userId: game.user.id });
  return null;
}

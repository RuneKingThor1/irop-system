const SYSTEM = "irop";

/**
 * Hover previews (Johnald, 2026-10-16): resting the mouse on a portrait or a store's picture, or on a
 * token, shows the picture full size in the lower left corner of the screen, so detailed art is not
 * lost when it is drawn small. A picture opts in with data-irop-preview. A token shows its actor's
 * portrait when the user may see the actor, else the token's own art, so nothing the GM keeps back
 * is shown. Each person can switch it off in the system settings.
 */

/** How long the mouse rests before the preview shows, in milliseconds. */
export const PREVIEW_DELAY = 250;

let panel = null;
let timer = null;
let shown = "";

/** Whether this user wants previews. */
function enabled() {
  try { return game.settings.get(SYSTEM, "hoverPreview") !== false; }
  catch { return true; }
}

/** The picture a token previews: its actor's portrait if the user may see that actor, else its own art. */
export function tokenPreview(token, user = game.user) {
  const actor = token?.actor ?? token?.document?.actor ?? null;
  const own = token?.document?.texture?.src ?? token?.texture?.src ?? "";
  const mayView = !!actor && (!!user?.isGM || !!actor.testUserPermission?.(user, "LIMITED"));
  const src = (mayView && actor.img && !/mystery-man/.test(actor.img)) ? actor.img : own;
  // The name only for an actor the user may see: a token's name can be kept from players.
  const name = mayView ? (token?.document?.name ?? token?.name ?? actor?.name ?? "") : "";
  return src ? { src, name } : null;
}

/** The panel, made once. */
function ensurePanel() {
  if ( panel?.isConnected ) return panel;
  panel = document.createElement("figure");
  panel.id = "irop-hover-preview";
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `<img alt=""><figcaption></figcaption>`;
  document.body.append(panel);
  return panel;
}

/** Show a picture after the mouse has rested a moment. */
export function showPreview(src, caption = "") {
  clearTimeout(timer);
  if ( !src || !enabled() ) return;
  timer = setTimeout(() => {
    const el = ensurePanel();
    const img = el.querySelector("img");
    if ( shown !== src ) img.src = src;
    shown = src;
    el.querySelector("figcaption").textContent = caption;
    el.classList.toggle("captioned", !!caption);
    el.classList.add("on");
  }, PREVIEW_DELAY);
}

export function hidePreview() {
  clearTimeout(timer);
  panel?.classList.remove("on");
}

/** The picture an element on a sheet previews, if it opts in. */
function previewOf(target) {
  const img = target?.closest?.("img[data-irop-preview]");
  if ( !img || img.closest(".adjusting") ) return null;
  return { el: img, src: img.dataset.iropPreview || img.getAttribute("src"), caption: img.getAttribute("alt") ?? "" };
}

/** Listen on the page for opted in pictures, and on the canvas for tokens. Called once, at ready. */
export function registerHoverPreview() {
  if ( !globalThis.document ) return;
  document.addEventListener("pointerover", event => {
    const hit = previewOf(event.target);
    if ( hit && !hit.el.contains(event.relatedTarget) ) showPreview(hit.src, hit.caption);
  });
  document.addEventListener("pointerout", event => {
    const hit = previewOf(event.target);
    if ( hit && !hit.el.contains(event.relatedTarget) ) hidePreview();
  });
  // A click or a drag means the user is doing something with it; the preview steps aside.
  document.addEventListener("pointerdown", hidePreview, true);
  Hooks.on("hoverToken", (token, hovered) => {
    if ( !hovered ) return hidePreview();
    const p = tokenPreview(token);
    if ( p ) showPreview(p.src, p.name);
  });
  Hooks.on("canvasTearDown", hidePreview);
}

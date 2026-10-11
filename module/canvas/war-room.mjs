import { IROP } from "../config.mjs";
import { overlayStyle, matchRegions, territoriesShown, testLayout, touchingPairs, placeKey } from "../rules/war-room-map.mjs";
import { linkNeighbors } from "../rules/strategy.mjs";
import { getStrategyRules, getStrategyScale } from "../settings.mjs";
import { WarRoomBar, TerritoryCard, currentLayer } from "../apps/war-room.mjs";
import { DateBar } from "../apps/calendar.mjs";
import { ProjectStrip } from "../apps/odr.mjs";
import { cardsOn } from "../strategy/events.mjs";
import { incursionAgainst } from "../strategy/losing-ground.mjs";

/**
 * THE WAR ROOM MAP (Strategy Layer step 2, 2026-10-08)
 * =====================================================
 *
 * Any scene can be a War Room: the GM ticks "War Room map" in the scene's own
 * settings (Basics tab, Strategy Layer). On such a scene every viewer gets the
 * top bar (apps/war-room.mjs), and the system draws each territory's region in
 * the overlay that viewer picked (Heat, Strength, Reputation, Control), straight
 * from the territory data, so the map can never fall out of step. Clicking a
 * territory opens its card. Regions are the scene's own Scene Regions; each is
 * matched to a territory by the link on the territory's sheet, or by name.
 *
 * A War Room map can show the whole campaign or only the territories inside one
 * (a Megacity's own map shows its districts).
 */

const FLAG = "warRoom";

/** A scene's War Room settings: {map: boolean, parent: territory id or ""}. */
export function warRoomFlags(scene) {
  return scene?.flags?.irop?.[FLAG] ?? {};
}

export function isWarRoom(scene) {
  return !!warRoomFlags(scene).map;
}

/** The world's territories. */
function territories() {
  return game.items?.filter?.(i => i.type === "territory") ?? [];
}

/** A scene's regions, each matched to the territory it is (on this map's level). */
export function sceneTerritories(scene) {
  const shown = territoriesShown(territories(), warRoomFlags(scene).parent || "");
  const regions = scene?.regions?.contents ?? [];
  return { regions, shown, matches: matchRegions(regions, shown) };
}

/** How many of the map's territories have a region, for the GM's note on the bar. */
function mapCounts() {
  const scene = canvas?.scene;
  if ( !isWarRoom(scene) ) return { linked: 0, total: 0, regions: 0 };
  const { regions, shown, matches } = sceneTerritories(scene);
  return { linked: matches.size, total: shown.length, regions: regions.length };
}

/* -------------------------------------------- */
/*  The overlay                                 */
/* -------------------------------------------- */

let overlay = null;
let selected = null;

function clearOverlay() {
  if ( overlay && !overlay.destroyed ) overlay.destroy({ children: true });
  overlay = null;
}

/** The middle of a set of polygons, by their points. */
function middle(polygons) {
  let x = 0;
  let y = 0;
  let n = 0;
  for ( const p of polygons ) {
    for ( let i = 0; i < p.points.length; i += 2 ) {
      x += p.points[i];
      y += p.points[i + 1];
      n++;
    }
  }
  return n ? [x / n, y / n] : [0, 0];
}

/** Draw every territory of a War Room scene in this viewer's overlay. */
export function drawOverlay() {
  clearOverlay();
  const scene = canvas?.scene;
  if ( !canvas?.ready || !isWarRoom(scene) ) return;
  const layer = currentLayer();
  const rules = getStrategyRules();
  const { regions, matches } = sceneTerritories(scene);
  const container = new PIXI.Container();
  container.eventMode = "none";
  const size = Math.max(22, Math.round((canvas.grid?.size ?? 100) * 0.32));
  for ( const region of regions ) {
    const match = matches.get(region.id);
    if ( !match ) continue;
    const t = match.territory;
    const style = overlayStyle(layer, t.system, rules.strengthMax);
    const polygons = region.polygons ?? [];
    if ( !polygons.length ) continue;
    const chosen = t.id === selected;
    const g = new PIXI.Graphics();
    g.lineStyle(chosen ? 10 : 3, chosen ? 0x42ABF2 : 0x0A0C0F, chosen ? 1 : 0.85);
    g.beginFill(style.color, style.alpha);
    for ( const p of polygons ) g.drawPolygon(p.points);
    g.endFill();
    container.addChild(g);
    const label = CONFIG.canvasTextStyle.clone();
    label.fontSize = size;
    label.align = "center";
    // Cards in play here (step 6) under the overlay's value.
    const cards = cardsOn(t.id).map(c => `◆ ${c.name}`);
    // An Incursion coming (step 7).
    const threat = incursionAgainst(t.id) ? ["⚠ Incursion"] : [];
    const text = new PIXI.Text([t.name, style.text, ...threat, ...cards].join("\n"), label);
    text.anchor.set(0.5, 0.5);
    text.position.set(...middle(polygons));
    container.addChild(text);
  }
  overlay = canvas.interface.addChild(container);
}

const redraw = foundry.utils.debounce(() => {
  drawOverlay();
  WarRoomBar.refresh();
  TerritoryCard.refresh();
  ProjectStrip.refresh();
}, 100);

/* -------------------------------------------- */
/*  Clicking a territory                        */
/* -------------------------------------------- */

let pressed = null;

function onPointerDown(event) {
  pressed = (event.button === 0) ? { x: event.clientX, y: event.clientY } : null;
}

/** A left click that did not drag, on a War Room scene: open the territory there, or close the card. */
function onPointerUp(event) {
  if ( (event.button !== 0) || !pressed ) return;
  const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
  pressed = null;
  if ( (moved > 6) || !isWarRoom(canvas?.scene) || canvas.tokens?.hover ) return;
  const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
  const { regions, matches } = sceneTerritories(canvas.scene);
  const hit = regions.find(r => matches.has(r.id) && r.polygonTree?.testPoint?.(point));
  if ( !hit ) {
    selected = null;
    TerritoryCard.hide();
    drawOverlay();
    return;
  }
  const territory = matches.get(hit.id).territory;
  selected = territory.id;
  drawOverlay();
  TerritoryCard.show(territory, { side: (event.clientX > (window.innerWidth / 2)) ? "left" : "right" });
}

let listening = false;

function listen() {
  const view = canvas?.app?.view;
  if ( listening || !view ) return;
  view.addEventListener("pointerdown", onPointerDown);
  view.addEventListener("pointerup", onPointerUp);
  listening = true;
}

/** Bar, overlay and card for the scene now viewed; the date bar where the War Room's is not. */
function syncScene() {
  DateBar.sync(isWarRoom(canvas?.scene));
  if ( isWarRoom(canvas?.scene) ) {
    listen();
    drawOverlay();
    WarRoomBar.show();
    ProjectStrip.show();
  }
  else {
    clearOverlay();
    selected = null;
    WarRoomBar.hide();
    TerritoryCard.hide();
    ProjectStrip.hide();
  }
}

/* -------------------------------------------- */
/*  The scene's own settings                    */
/* -------------------------------------------- */

/** Add the Strategy Layer box to a scene's settings: War Room map, and what it shows. */
export function onRenderSceneConfig(app, html) {
  // An element (Foundry 13 and 14), or a jQuery wrapper from an older sheet.
  const root = html?.querySelector ? html : html?.[0];
  if ( !root || root.querySelector(".irop-war-room-config") ) return;
  const tab = root.querySelector('.tab[data-tab="basics"], .tab[data-tab="basic"]') ?? root.querySelector("form") ?? root;
  const scene = app.document ?? app.object;
  const flags = warRoomFlags(scene);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const options = territories().sort((a, b) => a.name.localeCompare(b.name))
    .map(t => `<option value="${t.id}" ${t.id === flags.parent ? "selected" : ""}>Territories inside ${esc(t.name)}</option>`).join("");
  tab.insertAdjacentHTML("beforeend", `
    <fieldset class="irop-war-room-config">
      <legend>Strategy Layer</legend>
      <div class="form-group">
        <label>War Room map</label>
        <div class="form-fields"><input type="checkbox" name="flags.irop.${FLAG}.map" ${flags.map ? "checked" : ""}></div>
        <p class="hint">Show the War Room on this scene: the top bar, the overlays, and a card for each territory clicked.</p>
      </div>
      <div class="form-group">
        <label>Shows</label>
        <div class="form-fields"><select name="flags.irop.${FLAG}.parent"><option value="">The whole campaign</option>${options}</select></div>
        <p class="hint">A Megacity's own map shows only the territories inside it.</p>
      </div>
    </fieldset>`);
}

/** A War Room button atop the Scenes sidebar: go to the War Room map. */
export function onRenderSceneDirectory(app, html) {
  // An element (Foundry 13 and 14), or a jQuery wrapper from an older sheet.
  const root = html?.querySelector ? html : html?.[0];
  const actions = root?.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".irop-war-room-button") ) return;
  const button = root.ownerDocument.createElement("button");
  button.type = "button";
  button.className = "irop-war-room-button";
  button.innerHTML = `<i class="fa-solid fa-chess-rook"></i> War Room`;
  button.addEventListener("click", () => openWarRoom());
  actions.append(button);
}

/** Go to the War Room map: the first scene marked as one that shows the whole campaign. */
export function openWarRoom() {
  const maps = game.scenes?.filter?.(s => isWarRoom(s)) ?? [];
  const scene = maps.find(s => !warRoomFlags(s).parent) ?? maps[0];
  if ( !scene ) {
    ui.notifications.warn("No scene is a War Room map yet. Tick War Room map in a scene's settings (Basics tab).");
    return null;
  }
  return scene.view();
}

/* -------------------------------------------- */
/*  GM tools                                    */
/* -------------------------------------------- */

/**
 * GM: a rough test board on a War Room scene: one region per vault territory,
 * named to match, so the overlays and cards can be tried before the real map.
 */
export async function buildTestMap(scene = canvas?.scene) {
  if ( !game.user.isGM ) return ui.notifications.error("Only a GM can lay out the War Room.");
  if ( !scene ) return null;
  const have = new Set(scene.regions.contents.map(r => placeKey(r.name)));
  const rect = scene.dimensions?.sceneRect ?? canvas.dimensions.sceneRect;
  const fresh = testLayout(rect).filter(r => !have.has(placeKey(r.name)));
  if ( !fresh.length ) return ui.notifications.info("The test layout is already on this scene.");
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Test layout" },
    content: `<p>Put a rough test board on ${scene.name}: ${fresh.length} regions, one per territory, named to match?</p>`
      + "<p>It is not the campaign's real map. Delete the regions when the real map comes in; its regions link by name.</p>"
  });
  if ( !ok ) return null;
  if ( !isWarRoom(scene) ) await scene.setFlag("irop", FLAG, { map: true, parent: "" });
  return scene.createEmbeddedDocuments("Region", fresh.map(r => ({
    name: r.name,
    color: "#42abf2",
    shapes: [{ type: "polygon", points: r.points, hole: false }]
  })));
}

/**
 * GM: work out from the map which territories border each other, and link them.
 * Existing links stay; only borders the map shows are added, after a confirm.
 */
export async function neighboursFromMap(scene = canvas?.scene) {
  if ( !game.user.isGM ) return ui.notifications.error("Only a GM can set neighbors.");
  const { regions, matches } = sceneTerritories(scene);
  const shapes = regions.filter(r => matches.has(r.id))
    .map(r => ({ id: matches.get(r.id).territory.id, polygons: (r.polygons ?? []).map(p => Array.from(p.points)) }));
  const tolerance = Math.max(10, (scene.grid?.size ?? 100) / 2);
  const pairs = touchingPairs(shapes, tolerance);
  const lists = Object.fromEntries(territories().map(t => [t.id, [...t.system.neighbors]]));
  const before = JSON.stringify(lists);
  const added = [];
  for ( const [a, b] of pairs ) {
    const change = linkNeighbors(lists, a, b, true);
    if ( Object.keys(change).length ) added.push([a, b]);
    Object.assign(lists, change);
  }
  if ( !added.length ) return ui.notifications.info("Every border on this map is already a neighbor link.");
  const name = id => game.items.get(id)?.name ?? "?";
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Neighbors from the map" },
    content: `<p>Link ${added.length} pairs of ${getStrategyScale().unit.toLowerCase()}s that border each other on this map?</p>`
      + `<p class="hint">${added.map(([a, b]) => `${name(a)} and ${name(b)}`).join("; ")}</p>`
  });
  if ( !ok || (JSON.stringify(lists) === before) ) return null;
  const updates = Object.entries(lists).filter(([id, list]) => list.join() !== game.items.get(id)?.system.neighbors.join())
    .map(([id, list]) => ({ _id: id, "system.neighbors": list }));
  return Item.updateDocuments(updates);
}

/* -------------------------------------------- */
/*  Wiring                                      */
/* -------------------------------------------- */

/** Hooks for the War Room. Called once, at init. */
export function registerWarRoom() {
  WarRoomBar.tools = { mapCounts, testMap: () => buildTestMap(), neighbours: () => neighboursFromMap() };
  // A neighbour opened from a card is selected on the map, as a click there would.
  TerritoryCard.tools = { select: id => { selected = id; drawOverlay(); } };
  Hooks.on("canvasReady", syncScene);
  Hooks.on("canvasTearDown", () => { clearOverlay(); });
  Hooks.on("renderSceneConfig", onRenderSceneConfig);
  Hooks.on("renderSceneDirectory", onRenderSceneDirectory);
  Hooks.on("updateScene", (scene, changed) => {
    if ( (scene.id === canvas?.scene?.id) && foundry.utils.hasProperty(changed, `flags.irop.${FLAG}`) ) syncScene();
  });
  for ( const hook of ["createRegion", "updateRegion", "deleteRegion"] ) {
    Hooks.on(hook, region => { if ( region.parent?.id === canvas?.scene?.id ) redraw(); });
  }
  for ( const hook of ["createItem", "updateItem", "deleteItem"] ) {
    Hooks.on(hook, item => { if ( ["territory", "project"].includes(item.type) && !item.parent ) redraw(); });
  }
  Hooks.on("irop.strategyChanged", redraw);
  for ( const hook of ["createCard", "updateCard", "deleteCard"] ) Hooks.on(hook, redraw);
  // A territory card's journal changed, or who may see it (2026-10-08).
  for ( const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage", "updateJournalEntry", "deleteJournalEntry"] ) {
    Hooks.on(hook, () => TerritoryCard.refresh());
  }
  Hooks.on("irop.warRoomLayerChanged", redraw);
}

/**
 * TOKEN HEALTH BAR (Johnald, 2026-10-10)
 * ======================================
 *
 * A token's first bar, when it tracks health, is drawn the system's way: a thicker red
 * health bar along the bottom; the armor as a steel razor blade riding its top and bottom
 * edges, wrapped around its left end and as long as the armor left (gone when shredded);
 * and while the character has a barrier, a faint ODR blue force field over both, pulsing slowly.
 * The second bar, when it tracks Energy, is drawn the same way in the sheet's green (Johnald,
 * 2026-10-10), a little slimmer than health, all the way across the token's top. Who may see the
 * bars is Foundry's as before. Each player can turn the style off for Foundry's plain bars (the
 * client setting "Token bars: Insurrection style", on by default).
 *
 * The barrier shows its damage (Johnald, 2026-10-10, option B): it counts in cells, one per
 * barrier point up to ten (a bigger barrier is split into ten equal cells), but the cells left
 * are one smooth field of faint ODR sky blue (Johnald, 2026-10-10) with no lines between them, a
 * glassy top, an ODR ink rim and a glow,
 * so it reads over the health and armor (fog tried and dropped, Johnald, 2026-10-10). Damage breaks it off in cell sized chunks from
 * the right, leaving a jagged edge and a faint outline of what was lost; the last chunk left
 * flickers. No barrier, no field.
 */

/** The colours, from the sheet's own vital bars. */
export const BAR_COLORS = {
  track: 0x2a0f12, outline: 0x050505,
  hp: 0xc23f3f, hpLight: 0xec7a7a, hpDark: 0x7a1f24,
  // Energy in the sheet's green (#2a5e2a to #5fb85f).
  energyTrack: 0x0f2412, energy: 0x4fa84f, energyLight: 0x8fd88f, energyDark: 0x2a5e2a,
  steel: 0xb9c2cd, steelBack: 0xa7b0bd, edge: 0xffffff, spine: 0x30353c, notch: 0x000000,
  // The barrier in ODR blue: ODR sky (#42abf2) faint, with ODR ink (#7cc3f4) for its rim.
  field: 0x42abf2, fieldDeep: 0x1d5f95, fieldLine: 0x7cc3f4, glow: 0x42abf2, spent: 0x7cc3f4
};

/**
 * The bars' thickness in pixels at Foundry's interface scale 1 (Johnald, 2026-10-10: about 10%
 * thinner than first built, which was health 12, its blades 3, Energy 10). Large tokens get half
 * as thick again, as Foundry's own bars do.
 */
export const BAR_SIZE = { hp: 10.8, blade: 2.7, overlap: 0.9, energy: 9 };

/** The most cells a barrier shows; a bigger one is split into this many. */
export const MAX_CELLS = 10;

/**
 * A barrier's cells: how many, how many still lit, and the points in each.
 * @param {number} value   Barrier left
 * @param {number} max     Its most; a barrier above its max counts as full
 * @returns {{count: number, active: number, per: number}}   No cells when no barrier is left
 */
export function barrierCells(value, max) {
  const v = Math.max(0, Number(value) || 0);
  if ( !(v > 0) ) return { count: 0, active: 0, per: 1 };
  const m = Math.max(v, Number(max) || 0);
  const count = Math.min(MAX_CELLS, Math.max(1, Math.ceil(m)));
  const per = m / count;
  return { count, active: Math.min(count, Math.ceil((v / per) - 1e-9)), per };
}

const clamp01 = n => Math.max(0, Math.min(1, Number(n) || 0));

/** The share of a pool left, 0 to 1; nothing for a pool with no maximum. */
export function poolShare(pool) {
  const max = Number(pool?.max) || 0;
  return max > 0 ? clamp01((Number(pool?.value) || 0) / max) : 0;
}

/**
 * Where everything goes, for a token of some width (in pixels).
 * @param {object} input
 * @param {number} input.width       The token's width in pixels
 * @param {number} [input.uiScale]   Foundry's interface scale on the canvas
 * @param {boolean} [input.large]    A token two or more squares tall: a thicker bar, as Foundry does
 * @param {number} input.hp          Health left, 0 to 1
 * @param {number} [input.armor]     Armor left, 0 to 1
 * @param {{value: number, max: number}} [input.barrier]  The barrier pool
 */
export function vitalBarLayout({ width, uiScale = 1, large = false, hp, armor = 0, barrier = null }) {
  const s = Number(uiScale) || 1;
  const bh = BAR_SIZE.hp * s * (large ? 1.5 : 1);
  const t = BAR_SIZE.blade * s;
  const overlap = BAR_SIZE.overlap * s;
  // Health runs the token's full width (Johnald, 2026-10-10); the wrap curls over its left end.
  const x0 = 0;
  const height = bh + (2 * (t - overlap));
  const barW = Math.max(0, width - x0);
  const armorW = clamp01(armor) * barW;
  return {
    s, bh, t, x0, height, barW,
    hpY: t - overlap,
    hpW: clamp01(hp) * barW,
    armorW,
    tip: Math.min(6 * s, armorW),
    radius: Math.min(3 * s, (height - t) / 2),
    armor: armorW > 0,
    cells: barrierCells(barrier?.value, barrier?.max),
    get barrier() { return this.cells.count > 0; }
  };
}

/**
 * The outline of what is left of the barrier: one shape with clipped corners, a straight right
 * end when whole, a jagged one where chunks broke off.
 * @returns {number[]}   Polygon points
 */
export function fieldOutline(x, y, w, h, s, whole) {
  const c = 3 * s;
  const r = x + w;
  const right = whole
    ? [r - c, y, r, y + c, r, y + h - c, r - c, y + h]
    : [r - (2 * s), y, r, y + (h * 0.22), r - (3 * s), y + (h * 0.46), r, y + (h * 0.7), r - (2.25 * s), y + h];
  return [x + c, y, ...right, x + c, y + h, x, y + h - c, x, y + c];
}

/** What is left of the barrier: glow, a faint ODR blue fill with a deeper lower half, a glassy top, a bright rim. */
function drawField(g, { x, y, unit, active, count, h, s }) {
  const c = BAR_COLORS;
  const whole = active >= count;
  const w = active * unit;
  const jag = whole ? 0 : 3 * s;
  const points = fieldOutline(x, y, w, h, s, whole);
  for ( const [width, alpha] of [[6, 0.12], [3, 0.25]] ) g.lineStyle(width * s, c.glow, alpha).drawPolygon(points);
  g.lineStyle(0).beginFill(c.field, 0.3).drawPolygon(points).endFill();
  const inner = Math.max(0, w - jag - (4 * s));
  g.beginFill(c.fieldDeep, 0.22).drawRect(x + (2 * s), y + (h * 0.55), inner, Math.max(0, (h * 0.45) - s)).endFill();
  g.beginFill(c.edge, 0.12).drawRect(x + (2 * s), y + s, inner, h * 0.3).endFill();
  g.lineStyle(s, c.fieldLine, 0.95).drawPolygon(points);
  g.lineStyle(s, c.edge, 0.3).moveTo(x + (3 * s), y + (1.5 * s)).lineTo(x + w - jag - (3 * s), y + (1.5 * s));
  g.lineStyle(0);
}

/**
 * A gauge in the health bar's style: a dark track, then the fill with a lighter band along its
 * top and a darker one along its bottom.
 */
function drawGauge(g, { x, y, w, h, fillW, s, track, fill, light, dark }) {
  g.lineStyle(s, BAR_COLORS.outline, 1).beginFill(track, 0.85).drawRoundedRect(x, y, w, h, 2 * s).endFill();
  if ( fillW > 0 ) {
    g.lineStyle(0).beginFill(fill, 1).drawRoundedRect(x, y, fillW, h, 2 * s).endFill();
    const inner = Math.max(0, fillW - (2 * s));
    if ( inner > 0 ) {
      g.beginFill(light, 0.55).drawRect(x + s, y + s, inner, h * 0.28).endFill();
      g.beginFill(dark, 0.6).drawRect(x + s, y + (h * 0.66), inner, Math.max(0, (h * 0.34) - s)).endFill();
    }
  }
  g.lineStyle(0);
  return g;
}

/** Where the Energy bar goes: along the top, slimmer than health, the token's full width. */
export function energyBarLayout({ width, uiScale = 1, large = false, energy }) {
  const s = Number(uiScale) || 1;
  const x0 = 0;
  const barW = Math.max(0, width);
  return { s, x0, bh: BAR_SIZE.energy * s * (large ? 1.5 : 1), barW, fillW: clamp01(energy) * barW };
}

/** Draw the Energy bar. */
export function drawEnergyBar(bar, layout) {
  const c = BAR_COLORS;
  bar.clear();
  return drawGauge(bar, { x: layout.x0, y: 0, w: layout.barW, h: layout.bh, fillW: layout.fillW, s: layout.s,
    track: c.energyTrack, fill: c.energy, light: c.energyLight, dark: c.energyDark });
}

/** Draw the health bar, its razor and (in its own child) the force field. */
export function drawVitalBar(bar, layout) {
  const { s, bh, t, x0, height, barW, hpY, hpW, armorW, tip, radius } = layout;
  const c = BAR_COLORS;
  bar.clear();

  // Health: a dark track, the red fill with a lighter top and a darker bottom.
  drawGauge(bar, { x: x0, y: hpY, w: barW, h: bh, fillW: hpW, s, track: c.track, fill: c.hp, light: c.hpLight, dark: c.hpDark });

  // Armor: a blade along each edge, angled at its tip, wrapped around the left end.
  if ( layout.armor ) {
    const end = x0 + armorW;
    // The blades start where the wrap's curve ends, so its rounded corner covers theirs.
    const bx = x0 + radius + (t / 2);
    const tipAt = Math.max(bx, end - tip);
    bar.lineStyle(0).beginFill(c.steel, 1)
      .drawPolygon([bx, 0, tipAt, 0, Math.max(bx, end), t, bx, t])
      .drawPolygon([bx, height, tipAt, height, Math.max(bx, end), height - t, bx, height - t])
      .endFill();
    // The bright cutting edge outside, the darker spine inside.
    bar.lineStyle(s, c.edge, 0.9).moveTo(bx, 0.5 * s).lineTo(tipAt, 0.5 * s)
      .moveTo(bx, height - (0.5 * s)).lineTo(tipAt, height - (0.5 * s));
    bar.lineStyle(s, c.spine, 0.9).moveTo(bx, t - (0.5 * s)).lineTo(Math.max(bx, end - (s * 0.5)), t - (0.5 * s))
      .moveTo(bx, height - t + (0.5 * s)).lineTo(Math.max(bx, end - (s * 0.5)), height - t + (0.5 * s));
    // The snap-off notches.
    bar.lineStyle(s, c.notch, 0.45);
    for ( let x = bx + (8 * s); x < end - tip - (2 * s); x += 10 * s ) {
      bar.moveTo(x, t).lineTo(x + (2 * s), 0).moveTo(x, height - t).lineTo(x + (2 * s), height);
    }
    // The wrap: the back of the blade, curled over the left end of the bar, inside the token.
    const h = t / 2;
    bar.lineStyle(t, c.steelBack, 1)
      .moveTo(radius + h + s, h).lineTo(radius + h, h)
      .arcTo(h, h, h, radius + h, radius)
      .lineTo(h, height - radius - h)
      .arcTo(h, height - h, radius + h, height - h, radius)
      .lineTo(radius + h + s, height - h);
    bar.lineStyle(0);
  }

  // The barrier's cells, in their own child so they can pulse (and the last one flicker).
  const field = bar.iropField;
  if ( field ) {
    field.clear();
    const { count, active } = layout.cells;
    field.visible = count > 0;
    field.iropFlicker = active === 1;
    if ( count > 0 ) {
      const pad = 3 * s;
      const fx = -pad;
      const fy = -pad;
      const fw = barW + x0 + (2 * pad);
      const fh = height + (2 * pad);
      const unit = fw / count;
      // What was lost: one faint outline, open where the field broke.
      if ( active < count ) {
        const k = 3 * s;
        const lx = fx + (active * unit);
        const rx = fx + fw;
        field.lineStyle(s, c.spent, 0.22).moveTo(lx, fy).lineTo(rx - k, fy).lineTo(rx, fy + k)
          .lineTo(rx, fy + fh - k).lineTo(rx - k, fy + fh).lineTo(lx, fy + fh).lineStyle(0);
      }
      drawField(field, { x: fx, y: fy, unit, active, count, h: fh, s });
    }
  }
  return bar;
}

/* -------------------------------------------- */
/*  The pulse                                   */
/* -------------------------------------------- */

const pulsing = new Set();
let ticking = false;

/** Every force field breathes together, a slow rise and fall; one down to its last cell flickers. */
function pulse() {
  const now = performance.now();
  const alpha = 0.8 + (0.2 * Math.sin(now / 420));
  const flicker = (Math.floor(now / 550) % 2) ? 0.4 : 1;
  for ( const field of pulsing ) {
    if ( field.destroyed ) pulsing.delete(field);
    else field.alpha = field.iropFlicker ? flicker : alpha;
  }
}

function startPulse(field) {
  pulsing.add(field);
  if ( ticking || !globalThis.canvas?.app?.ticker ) return;
  canvas.app.ticker.add(pulse);
  ticking = true;
}

/* -------------------------------------------- */
/*  The token                                   */
/* -------------------------------------------- */

/** Whether this user wants the system's token bars; on unless they turned it off, or before settings exist. */
export function styledBarsOn() {
  try {
    return game.settings.get("irop", "styledTokenBars") !== false;
  }
  catch {
    return true;
  }
}

/** Redraw every token's bars on the scene, after the setting changes. */
export function refreshAllTokenBars() {
  for ( const token of globalThis.canvas?.tokens?.placeables ?? [] ) token.renderFlags?.set({ refreshBars: true });
}

/** Whether a token's first bar is drawn the system's way: it tracks a character's health. */
export function usesVitalBar(token) {
  return (token?.document?.bar1?.attribute === "vitals.hp") && !!token.actor?.system?.vitals;
}

/** Whether a token's second bar is drawn the system's way: it tracks a character's Energy. */
export function usesEnergyBar(token) {
  return (token?.document?.bar2?.attribute === "vitals.energy") && !!token.actor?.system?.vitals;
}

/**
 * The canvas Token class with the system's health bar, built on whatever Token class is
 * configured (squad sight's, or a module's).
 * @param {typeof Token} Base
 */
export function vitalBarsToken(Base) {
  return class IropBarsToken extends Base {
    /** @override */
    _drawBar(index, bar, data) {
      // Foundry's plain bars, for a player who prefers them.
      if ( !styledBarsOn() ) {
        if ( bar.iropField ) bar.iropField.visible = false;
        return super._drawBar(index, bar, data);
      }
      const size = this.document.getSize?.() ?? { width: this.w, height: this.h };
      if ( (index === 1) && usesEnergyBar(this) ) {
        drawEnergyBar(bar, energyBarLayout({
          width: size.width, uiScale: canvas.dimensions?.uiScale ?? 1, large: (this.document.height ?? 1) >= 2,
          energy: poolShare({ value: data.value, max: data.max })
        }));
        bar.position.set(0, 0);
        return;
      }
      if ( (index !== 0) || !usesVitalBar(this) ) {
        if ( bar.iropField ) bar.iropField.visible = false;
        return super._drawBar(index, bar, data);
      }
      const vitals = this.actor.system.vitals;
      const layout = vitalBarLayout({
        width: size.width,
        uiScale: canvas.dimensions?.uiScale ?? 1,
        large: (this.document.height ?? 1) >= 2,
        hp: poolShare({ value: data.value, max: data.max }),
        armor: poolShare(vitals.armor),
        barrier: vitals.barrier
      });
      if ( !bar.iropField ) bar.iropField = bar.addChild(new PIXI.Graphics());
      drawVitalBar(bar, layout);
      if ( layout.barrier ) startPulse(bar.iropField);
      bar.position.set(0, size.height - layout.height);
    }
  };
}

/** Armor and barrier are not the bar's own numbers, so Foundry may not redraw for them: this does. */
export function refreshTokenBars(actor) {
  for ( const token of actor?.getActiveTokens?.() ?? [] ) token.renderFlags?.set({ refreshBars: true });
}

/** An actor's vitals changed, or armor was put on, taken off, gained or lost. */
export function onVitalsChanged(document, changed) {
  if ( document?.documentName === "Actor" ) {
    if ( foundry.utils.hasProperty(changed ?? {}, "system.vitals") ) refreshTokenBars(document);
    return;
  }
  if ( (document?.type === "armor") && (document.parent?.documentName === "Actor") ) refreshTokenBars(document.parent);
}

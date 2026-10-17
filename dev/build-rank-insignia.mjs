/**
 * The ODR rank insignia (Johnald, 2026-10-17): ten sleeve patches, one per rank, after the first
 * (the Squaddie patch of 2026-10-08, now Initiate). Each is an ODR navy hexagon edged in silver with
 * a delta climbing to orbit, and below it the rank's marks: chevrons for the enlisted ranks, rockers
 * under them for the senior ones, a gold star in the delta for the sergeants, then bars for the
 * warrant and the officers, whose delta is gold.
 *
 *   node dev/build-rank-insignia.mjs      writes assets/icons/ranks/<key>.svg
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "icons", "ranks");

const SILVER = "#b9c4c8";
const GOLD = "#d9b234";
const NAVY = "#0d1522";
const SKY = "#42abf2";

/** Each rank's marks. chevrons, rockers, bars; star: the delta's star in gold; gold: the officers' delta; rim: a gold edge. */
const RANKS = [
  { key: "initiate", label: "Initiate", chevrons: 1 },
  { key: "ranger", label: "Ranger", chevrons: 2 },
  { key: "rangerFirst", label: "Ranger First Class", chevrons: 3 },
  { key: "lanceRanger", label: "Lance Ranger", chevrons: 3, rockers: 1 },
  { key: "fireteamCorporal", label: "Fireteam Corporal", chevrons: 3, rockers: 2 },
  { key: "strikeSergeant", label: "Strike Sergeant", chevrons: 3, rockers: 2, star: true },
  { key: "deltaSergeant", label: "Delta Sergeant", chevrons: 3, rockers: 3, star: true, inner: GOLD },
  { key: "orbitalWarrant", label: "Orbital Warrant", bars: 1, broken: true, star: true, inner: GOLD },
  { key: "deltaLieutenant", label: "Delta Lieutenant", bars: 1, gold: true, inner: GOLD },
  { key: "deltaCaptain", label: "Delta Captain", bars: 2, gold: true, inner: GOLD, rim: GOLD }
];

const f = n => Number(n.toFixed(2));

/** The marks under the delta, drawn about (0, 0) going down, with their height and width. */
function marks(rank) {
  const parts = [];
  let y = 0;
  const chevrons = rank.chevrons ?? 0;
  for ( let i = 0; i < chevrons; i++ ) {
    const t = y + (i * 10);
    parts.push(`<path d="M-24 ${t + 13} L0 ${t} L24 ${t + 13} L24 ${t + 19} L0 ${t + 6} L-24 ${t + 19} Z" fill="url(#metal)"/>`);
  }
  if ( chevrons ) y += 19 + (10 * (chevrons - 1));
  const rockers = rank.rockers ?? 0;
  if ( rockers ) y += 3;
  for ( let i = 0; i < rockers; i++ ) {
    const t = y + (i * 8);
    parts.push(`<path d="M-24 ${t} Q0 ${t + 12} 24 ${t} L24 ${t + 5} Q0 ${t + 17} -24 ${t + 5} Z" fill="url(#metal)"/>`);
  }
  if ( rockers ) y += 17 + (8 * (rockers - 1));
  const bars = rank.bars ?? 0;
  for ( let i = 0; i < bars; i++ ) {
    const t = y + (i * 16) + 2;
    const fill = rank.gold ? "url(#gold)" : "url(#metal)";
    if ( rank.broken ) {
      // A warrant's bar, broken in three, a sky band through the middle.
      for ( const x of [-26, -8, 10] ) parts.push(`<rect x="${x}" y="${t}" width="16" height="11" rx="1.5" fill="${fill}"/>`);
      parts.push(`<rect x="-26" y="${t + 4.5}" width="52" height="2" fill="${SKY}"/>`);
    }
    else parts.push(`<rect x="-26" y="${t}" width="52" height="11" rx="1.5" fill="${fill}" stroke="${NAVY}" stroke-width="1"/>`);
  }
  if ( bars ) y += 2 + 11 + (16 * (bars - 1));
  return { body: parts.join("\n    "), height: y, width: bars ? 52 : 48 };
}

function svg(rank) {
  const m = marks(rank);
  // The marks fit the space under the delta: from y 72 to 106, at most 54 wide. A patch with rockers
  // carries a smaller delta, set higher, so its marks keep their size.
  const compact = (rank.rockers ?? 0) > 0;
  const room = compact ? { top: 58, height: 46, width: 54 } : { top: 72, height: 34, width: 54 };
  const s = Math.min(1, room.height / m.height, room.width / m.width);
  const ty = room.top + ((room.height - (m.height * s)) / 2);
  const delta = rank.gold ? "url(#gold)" : "url(#metal)";
  const star = rank.star
    ? `<path d="M64 31 L66.8 38.8 L74.6 41.5 L66.8 44.2 L64 52 L61.2 44.2 L53.4 41.5 L61.2 38.8 Z" fill="${GOLD}" stroke="${NAVY}" stroke-width="1.2"/>`
    : `<path d="M64 32 L66.5 39 L73.5 41.5 L66.5 44 L64 51 L61.5 44 L54.5 41.5 L61.5 39 Z" fill="${NAVY}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <!-- ${rank.label}, an ODR rank (Johnald, 2026-10-17). Made by dev/build-rank-insignia.mjs. -->
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eef3f5"/>
      <stop offset="1" stop-color="#8e9fb5"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe9a3"/>
      <stop offset="1" stop-color="#b8862b"/>
    </linearGradient>
  </defs>
  <path d="M64 6 L112 32 L112 96 L64 122 L16 96 L16 32 Z" fill="${NAVY}" stroke="${rank.rim ?? SILVER}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M64 15 L104 37 L104 91 L64 113 L24 91 L24 37 Z" fill="none" stroke="${rank.inner ?? SKY}" stroke-opacity="${rank.inner ? 0.75 : 0.55}" stroke-width="1.5" stroke-linejoin="round"/>
  <g${compact ? ' transform="translate(64 14) scale(0.76) translate(-64 -19)"' : ""}>
    <path d="M64 19 L85 66 L64 55 L43 66 Z" fill="${delta}"/>
    ${star}
  </g>
  <g transform="translate(64 ${f(ty)}) scale(${f(s)})">
    ${m.body}
  </g>
</svg>
`;
}

fs.mkdirSync(OUT, { recursive: true });
for ( const rank of RANKS ) {
  fs.writeFileSync(path.join(OUT, `${rank.key}.svg`), svg(rank));
  console.log(`${rank.key}.svg`);
}

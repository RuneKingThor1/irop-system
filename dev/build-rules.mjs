/**
 * Build the Rules journal from the site's Combat Survival Guide (2026-10-30).
 * Run: node dev/build-rules.mjs <guide.html> <node_modules holding jsdom>
 *   <guide.html> is irop/guide.html in the site repo.
 *
 * Writes:
 *   assets/rules/rules.json   the pages, in guide order: each section, a page per role dossier
 *                             after Roles, and both status listings inside Status Effects
 *   styles/rules.css          the guide's look for that content, scoped to .irop-rules
 * The Species page is not the guide's: dev/rules-species.html holds all four species (2026-10-30),
 * and the Mutation Tables page is built from dev/player-mutations-macro.js. The Paraphysics and
 * Strategy pages come from dev/rules-paraphysics.html and dev/rules-strategy.html, a page per section.
 * Edit those, not rules.json. Players read this journal: GM only lore and the hidden Wave Two
 * disciplines stay out of it.
 * The active GM's client keeps the "Insurrection Rules" journal in step with rules.json, and G
 * opens it (module/rules-journal.mjs). Rerun this whenever the guide changes.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [guidePath, modules] = process.argv.slice(2);
if ( !guidePath || !modules ) throw new Error("Pass guide.html and the node_modules folder holding jsdom.");
const { JSDOM } = createRequire(path.join(path.resolve(modules), "x.js"))("jsdom");

const source = fs.readFileSync(guidePath, "utf8");
const doc = new JSDOM(source).window.document;

const ROLE_ORDER = ["legionary", "marauder", "specialist", "outrider", "warmachine", "vanguard"];

/** Strip what only works on the site: images, buttons, handlers, the site's font spans. */
function clean(el) {
  // Perk trees are tabs on the site, which need script. Here they fold, as in the old Soldier Roles
  // journal (irop-dossier.css): <details> works with no code, and the Primary tree starts open.
  el.querySelectorAll(".tree-tabs").forEach(tabs => {
    const names = [...tabs.querySelectorAll(".tree-tab")].map(t => t.textContent.trim());
    const panels = [...tabs.parentElement.querySelectorAll(".tree-panel")];
    panels.forEach((p, i) => {
      const fold = p.ownerDocument.createElement("details");
      fold.className = "tree-fold";
      if ( i === 0 ) fold.setAttribute("open", "");
      fold.innerHTML = `<summary>${names[i] ?? ""}</summary>`;
      p.replaceWith(fold);
      fold.append(p);
    });
    tabs.remove();
  });
  el.querySelectorAll("img, .rp-figure, button, script, .ropen").forEach(n => n.remove());
  el.querySelectorAll("[role=button]").forEach(n => { n.removeAttribute("role"); n.removeAttribute("tabindex"); });
  el.querySelectorAll("*").forEach(n => {
    for ( const a of [...n.attributes] ) if ( a.name.startsWith("on") ) n.removeAttribute(a.name);
    if ( /font-family/.test(n.getAttribute("style") ?? "") ) n.removeAttribute("style");
  });
  return el;
}

const wrap = (html, extra = "") => `<div class="irop-rules"${extra}>${html.trim()}</div>`;
const text = el => el?.textContent.replace(/\s+/g, " ").trim() ?? "";

/** The Mutation Tables page, from the macro that makes the items, so the two cannot drift. */
function mutationTables() {
  const macro = fs.readFileSync(path.join(ROOT, "dev/player-mutations-macro.js"), "utf8");
  const start = macro.indexOf("{", macro.indexOf("const DATA ="));
  const data = JSON.parse(macro.slice(start, macro.indexOf("\n  };", start) + 4));
  const table = (rows, caption) => `<div class="tbl-wrap"><table><caption>${caption}</caption>`
    + `<thead><tr><th>d20</th><th>Mutation</th><th>Effect</th></tr></thead><tbody>`
    + rows.map(r => `<tr><td class="mono">${String(r.roll).padStart(2, "0")}</td><td class="row-head">${r.name}</td>`
      + `<td>${r.description.replace(/<\/p><p>/g, " ").replace(/<\/?p>/g, "")}</td></tr>`).join("")
    + `</tbody></table></div>`;
  return `<section class="sec" id="mutations"><div class="sec-head"><div class="sec-code">SEC-02.A // Origin</div><h2>Mutation Tables</h2>`
    + `<p class="sec-intro">For Barons. Each table is a d20 with flat odds, one result per number.</p></div>`
    + `<h3>Positive Mutations</h3><p>Roll twice at creation and reroll duplicates.</p>${table(data.positive, "Positive Mutation Table")}`
    + `<h3>Negative Mutations</h3><p>Roll once at creation, with a single permitted reroll.</p>${table(data.negative, "Negative Mutation Table")}`
    + `<div class="callout"><div class="ct">GM Note // Contradicting Mutations</div><p>Some combinations create mechanical paradoxes. Frayed Focus explicitly lets a Baron who has also rolled Overclocked Cortex reroll either result. For any other pair that cannot both be true at once, allow one reroll of the conflicting entry, in addition to the Baron's Controlled Mutations reroll.</p></div></section>`;
}

const pages = [];
for ( const sec of doc.querySelectorAll("section.sec") ) {
  const name = text(sec.querySelector("h2"));
  if ( sec.id === "species" ) {
    pages.push({ name, html: wrap(fs.readFileSync(path.join(ROOT, "dev/rules-species.html"), "utf8")) });
    pages.push({ name: "Mutation Tables", html: wrap(mutationTables()) });
    continue;
  }
  const body = clean(sec.cloneNode(true));
  if ( sec.id === "status" ) {
    body.querySelector(".roles")?.remove();
    for ( const [key, label] of [["negative", "Negative Effects"], ["positive", "Positive Effects"]] ) {
      const list = doc.querySelector(`#statusDocs [data-statusdoc="${key}"]`);
      if ( list ) body.insertAdjacentHTML("beforeend", `<h3 class="status-head ${key}">${label}</h3>${clean(list.cloneNode(true)).innerHTML}`);
    }
  }
  pages.push({ name, html: wrap(body.outerHTML) });
  if ( sec.id !== "roles" ) continue;
  for ( const [i, key] of ROLE_ORDER.entries() ) {
    const dossier = doc.querySelector(`#roleDocs [data-roledoc="${key}"]`);
    if ( !dossier ) continue;
    const card = sec.querySelector(`[data-role="${key}"]`);
    const title = text(card?.querySelector(".rname")) || key;
    const head = `<div class="rp-head"><div class="rp-code">SEC-03.${"ABCDEF"[i]} // Role Dossier</div><h2 class="rp-name">${title}</h2>`
      + `<div class="rp-tag">${text(card?.querySelector(".rtag"))}</div></div>`;
    pages.push({ name: `Role: ${title}`, html: wrap(head + `<div class="rp-page">${clean(dossier.cloneNode(true)).innerHTML}</div>`, ` data-role="${key}"`) });
  }
}
// Paraphysics and the Strategy Layer (2026-10-30), after the guide: each section of a file is a page.
for ( const file of ["dev/rules-paraphysics.html", "dev/rules-strategy.html"] ) {
  const extra = new JSDOM(fs.readFileSync(path.join(ROOT, file), "utf8")).window.document;
  for ( const sec of extra.querySelectorAll("section.sec") ) {
    const name = sec.dataset.page;
    sec.removeAttribute("data-page");
    pages.push({ name, html: wrap(sec.outerHTML) });
  }
}
// Players read this: a page that names a secret or a hidden school does not ship.
const SECRETS = /eidolon|omnian|overwrit|magnetosphere|cryokinesis|electrokinesis|hemokinesis|\bentropy\b|\bdivining\b|\bspatial\b/i;
for ( const p of pages ) if ( p.name.startsWith("Paraphysics") && SECRETS.test(p.html) ) throw new Error(`GM only text in ${p.name}: ${p.html.match(SECRETS)[0]}`);
if ( pages.length < 20 ) throw new Error(`Only ${pages.length} pages found: has the guide's layout changed?`);
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
for ( const p of pages ) if ( DASHES.test(p.html) ) console.warn(`Dash in ${p.name}`);

/* ---- The stylesheet: the guide's rules for this content, scoped to .irop-rules. ---- */
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, "");

/** Split CSS into top level blocks: {head, body}. */
function blocks(s) {
  const out = [];
  let i = 0;
  while ( i < s.length ) {
    const open = s.indexOf("{", i);
    if ( open < 0 ) break;
    let depth = 1, j = open + 1;
    while ( depth && (j < s.length) ) { if ( s[j] === "{" ) depth++; else if ( s[j] === "}" ) depth--; j++; }
    out.push({ head: s.slice(i, open).trim(), body: s.slice(open + 1, j - 1).trim() });
    i = j;
  }
  return out;
}

const SKIP = /(^|[\s,>+~])(html|body|main|footer|\*)(?![\w-])|\.nav|\.shell|\.progress|\.masthead|\.stamp|\.step|\.note-strip|\.cs-|#sheet|#cs-|#roleLink|#rolePage|#statusPage|#statusBody|\.rp-back|\.rp-foot|\.rp-empty|\.wpn-scope|\.role::after|\.tree-tab|::-webkit/;

function scope(sel) {
  sel = sel.trim();
  if ( sel === ":root" ) return ".irop-rules";
  sel = sel.replace(/#rpBody/g, ".rp-page");
  return `.irop-rules ${sel}`;
}

const kept = [];
for ( const b of blocks(css) ) {
  if ( b.head.startsWith("@") ) continue;
  const sels = b.head.split(",").map(s => s.trim()).filter(s => s && !SKIP.test(s));
  if ( !sels.length ) continue;
  kept.push(`${sels.map(scope).join(", ")} { ${b.body.replace(/\s+/g, " ")} }`);
}

const out = `/* Generated by dev/build-rules.mjs from the site's Combat Survival Guide. Do not edit by hand. */
@import url("https://fonts.googleapis.com/css2?family=Bruno+Ace&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap");

${kept.join("\n")}

/* Journal fit: the guide's dark panel inside Foundry's journal page. */
.irop-rules { background: linear-gradient(180deg, var(--bg-grad), var(--bg)); color: var(--ink); padding: 18px 22px 26px;
  border: 1px solid var(--line); border-radius: 6px; font-family: "Rajdhani", system-ui, sans-serif; font-size: 16px; line-height: 1.55; }
.irop-rules .sec { margin: 0; padding: 0; border: none; }
.irop-rules h2, .irop-rules h3, .irop-rules h4 { border: none; text-shadow: none; }
.irop-rules a { color: var(--sky); }
.irop-rules .role { cursor: default; }
.irop-rules .rp-page .tree-panel { display: block; }
.irop-rules .tree-fold { border: 1px solid var(--line); border-radius: 4px; margin-bottom: 10px; background: var(--panel); }
.irop-rules .tree-fold > summary { cursor: pointer; list-style: none; padding: 11px 14px; font-family: "Share Tech Mono", monospace; font-size: 14px;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--rp-c); }
.irop-rules .tree-fold > summary::-webkit-details-marker { display: none; }
.irop-rules .tree-fold > summary::before { content: "▸"; display: inline-block; margin-right: 8px; }
.irop-rules .tree-fold[open] > summary::before { content: "▾"; }
.irop-rules .tree-fold[open] > summary { border-bottom: 1px solid var(--line); }
.irop-rules .tree-fold > .tree-panel { padding: 14px 14px 4px; margin: 0; }
.irop-rules .status-head { margin-top: 24px; }
.irop-rules table { color: var(--ink); }
.irop-rules td { color: var(--ink); }
.irop-rules td.mono { white-space: nowrap; }
.irop-rules ol { margin: 0 0 14px; padding-left: 26px; }
.irop-rules ol li { margin-bottom: 6px; }
.irop-rules ol li::marker { color: var(--sky); font-family: "Share Tech Mono", monospace; }
.irop-rules { --telestoi: #d8a13f; --telestoi-dim: #96712c; --reticulon: #3fbdae; --reticulon-dim: #1f6f68; }
.irop-rules .readout { margin-bottom: 22px; }
.irop-rules .statline { margin-top: 14px; }
.irop-rules .trait { max-width: none; font-size: 16.5px; color: var(--ink); }
.irop-rules .species-bgs { margin-top: 18px; }
.irop-rules .bg p { max-width: none; }
.irop-rules .readout.telestoi .badge { color: var(--telestoi); border-color: var(--telestoi-dim); }
.irop-rules .readout.telestoi .vital .v, .irop-rules .readout.telestoi .pick-label, .irop-rules .readout.telestoi .dm { color: var(--telestoi); }
.irop-rules .readout.reticulon .badge { color: var(--reticulon); border-color: var(--reticulon-dim); }
.irop-rules .readout.reticulon .vital .v, .irop-rules .readout.reticulon .pick-label, .irop-rules .readout.reticulon .dm { color: var(--reticulon); }
.irop-rules .status-head.negative { color: var(--danger); }
.irop-rules .status-head.positive { color: var(--r-legionary); }
.irop-rules .rp-head { margin-bottom: 14px; }
${ROLE_ORDER.map(r => `.irop-rules[data-role="${r}"] { --rp-c: var(--r-${r}); --rc: var(--r-${r}); }`).join("\n")}
`;

fs.mkdirSync(path.join(ROOT, "assets/rules"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "assets/rules/rules.json"), JSON.stringify({ source: "irop/guide.html", pages }, null, 1) + "\n");
fs.writeFileSync(path.join(ROOT, "styles/rules.css"), out);
console.log(`${pages.length} pages, ${kept.length} style rules`);
console.log(pages.map(p => `  ${p.name} (${Math.round(p.html.length / 1024)} KB)`).join("\n"));

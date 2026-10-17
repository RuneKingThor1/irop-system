/**
 * Mutation numbers (Johnald, 2026-10-17): what the player mutations do, on the sheet. Run once as
 * the GM, as a script macro, after the player mutations macro. Safe to run again: the effects it
 * made before are replaced, and nothing else on the items is touched.
 *
 * - Active Effects for the ones that change a number the sheet keeps: Defense, DR, ablative armor,
 *   max HP, max Energy, Run and Sprint, and the Edge and Victory banks.
 * - The choice for Aberrant Potential (+5 to an attribute and a skill rank) and Genetic Degradation
 *   (-5 to an attribute, Luck excluded). The enlistment terminal asks for it when one is rolled; a
 *   character who already carries one gets a Choose button on the mutation, on their sheet.
 * - Both on the world's Mutation items and on the copies characters already carry.
 * The rest (saving throws, Hindrance dice, once per mission triggers, damage taken more) stay as text
 * for the table to rule.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Run this as the GM.");
  const B = "system.bonuses";
  const SPECS = {
    "Armored Hide": { [`${B}.defense`]: 3, "system.dr.ballistic": 1, "system.dr.physical": 1, "system.dr.laser": 1, "system.dr.explosive": 1 },
    "Ossified Frame": { "system.vitals.armor.bonus": 4 },
    "Powerful Haunches": { [`${B}.move.run`]: 1, [`${B}.move.sprint`]: 1 },
    "Venomous Strike": { "system.vitals.hp.bonus": 1 },
    "Bioelectric Discharge": { "system.vitals.energy.bonus": 1 },
    "Overclocked Cortex": { [`${B}.edgeCap`]: 1 },
    "Frayed Focus": { [`${B}.edgeCap`]: -1 },
    "Squandered Insight": { [`${B}.victoryCap`]: -1 },
    // "Take 2 additional physical damage": Physical DR 2 lower.
    "Hollow Bones": { "system.dr.physical": -2 },
    "Massive Frame": { [`${B}.move.sprint`]: -1 },
    "Energy Drain": { "system.vitals.energy.bonus": -2 }
  };
  const CHOICES = {
    "Aberrant Potential": { attribute: 5, skill: 1, noLuck: false },
    "Genetic Degradation": { attribute: -5, skill: 0, noLuck: true }
  };
  const fold = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const byName = table => Object.fromEntries(Object.entries(table).map(([k, v]) => [fold(k), v]));
  const specs = byName(SPECS);
  const choices = byName(CHOICES);

  /** One mutation: its effect made afresh, its choice set. Returns what was done, or "". */
  const fix = async item => {
    const key = fold(item.name);
    const spec = specs[key];
    const choice = choices[key];
    if ( !spec && !choice ) return "";
    const old = item.effects.filter(e => e.getFlag("irop", "mutationNumbers")).map(e => e.id);
    if ( old.length ) await item.deleteEmbeddedDocuments("ActiveEffect", old);
    if ( spec ) {
      const changes = Object.entries(spec).map(([k, value]) => ({ key: k, type: "add", value: String(value) }));
      await item.createEmbeddedDocuments("ActiveEffect", [{
        name: item.name, img: item.img, transfer: true, system: { changes }, flags: { irop: { mutationNumbers: true } }
      }]);
    }
    if ( choice ) await item.update({ "system.choice": choice });
    return spec ? "effect" : "choice";
  };

  const done = [];
  for ( const item of game.items.filter(i => i.type === "mutation") ) {
    const what = await fix(item);
    if ( what ) done.push(item.name);
  }
  let copies = 0;
  const waiting = [];
  for ( const actor of game.actors ) {
    for ( const item of actor.items.filter(i => i.type === "mutation") ) {
      if ( await fix(item) ) copies++;
      if ( item.system.awaitsChoice ) waiting.push(`${actor.name}: ${item.name}`);
    }
  }
  const missing = [...Object.keys(SPECS), ...Object.keys(CHOICES)].filter(n => !game.items.some(i => (i.type === "mutation") && (fold(i.name) === fold(n))));
  const list = items => `<ul>${items.map(t => `<li>${foundry.utils.escapeHTML(t)}</li>`).join("")}</ul>`;
  ChatMessage.create({
    whisper: [game.user.id], speaker: { alias: "Mutation numbers" },
    content: `<div class="irop-card"><header class="card-head"><h3>Mutation numbers</h3><span class="card-sub">${done.length} world mutations, ${copies} carried copies</span></header>
      ${done.length ? `<p>Updated:</p>${list(done)}` : "<p>No world Mutation items matched. Run the player mutations macro first.</p>"}
      ${waiting.length ? `<p>Waiting on a choice (the Choose button on the mutation, on the character's sheet):</p>${list(waiting)}` : ""}
      ${missing.length ? `<p>Not found in the Items sidebar:</p>${list(missing)}` : ""}</div>`
  });
  ui.notifications.info(`Mutation numbers: ${done.length} world mutations and ${copies} carried copies updated.`);
})();

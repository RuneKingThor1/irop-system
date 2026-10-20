/**
 * Insurrection: Retake Our Planet
 * The native Foundry VTT system. Entry point: registers the data models,
 * documents, sheets, dice and settings, and exposes game.irop.
 */
import { IROP } from "./config.mjs";
import { registerSettings, getGmBanks, adjustGmBanks, getWarRoom, setWarRoom, getStrategyRules, getStrategyScale,
  getLedger, recordResource, undoResource } from "./settings.mjs";
import { OperativeData, NpcData } from "./data/actor.mjs";
import * as itemModels from "./data/item.mjs";
import { IropActor, IropItem, IropActiveEffect } from "./documents.mjs";
import { OperativeSheet, NpcSheet } from "./sheets/actor-sheet.mjs";
import { IropItemSheet } from "./sheets/item-sheet.mjs";
import { DynosrsRoll } from "./dice/dynosrs-roll.mjs";
import { D100Roll, DamageRoll } from "./dice/d100-roll.mjs";
import { onRenderChatMessage } from "./chat.mjs";
import { BanksApp, addBanksButton } from "./apps/banks.mjs";
import * as rolls from "./rolls.mjs";
import * as dynosrs from "./rules/dynosrs.mjs";
import * as combat from "./rules/combat.mjs";
import * as startingSkills from "./rules/starting-skills.mjs";
import { squadSightToken, onTokenDisposition } from "./canvas/squad-sight.mjs";
import { vitalBarsToken, onVitalsChanged, refreshAllTokenBars } from "./canvas/token-bars.mjs";
import { watchTurnMarkers, syncTurnMarkerTints, markerTint } from "./canvas/turn-marker.mjs";
import { importAbilities, importTrees, importTerritories, importProjects } from "./import.mjs";
import { StrategyRulesConfig } from "./apps/strategy-rules.mjs";
import { registerWarRoom, openWarRoom, buildTestMap, neighboursFromMap, drawOverlay, isWarRoom } from "./canvas/war-room.mjs";
import { ResourceLedger, SupportApp, callSupport, addSupportButton } from "./apps/resources.mjs";
import { OdrBoard, TurnReport, ProjectStrip, confirmUndo, showWeekBanner } from "./apps/odr.mjs";
import { TerritoryCard, WarRoomBar } from "./apps/war-room.mjs";
import { registerOdrActions, briefMission } from "./strategy/odr.mjs";
import { migrateReputation, migrateStrength } from "./strategy/migrate.mjs";
import { EnlistmentApp, registerEnlistment, addEnlistButton } from "./apps/enlistment.mjs";
import {
  registerFactionActions, getFactions, getTasks, getFactionLog, saveFaction, deleteFaction, adjustStanding, saveTask, offerTask, resolveTask
} from "./strategy/factions.mjs";
import { currentPlan } from "./strategy/turn.mjs";
import { initSocket } from "./socket.mjs";
import { StoreData } from "./data/store.mjs";
import { registerHoverPreview } from "./hover-preview.mjs";
import { registerRankWatch } from "./ranks.mjs";
import { StoreSheet } from "./sheets/store-sheet.mjs";
import { registerStoreActions } from "./store.mjs";
import { addCheckpointButton, openCheckpoint, postCheckpoint, checkFor, registerConcealmentActions } from "./concealment.mjs";
import { registerArtemis } from "./artemis/link.mjs";
import { EventCardData } from "./data/card.mjs";
import { EventCardSheet } from "./apps/card-sheet.mjs";
import { CodexPageData } from "./data/codex.mjs";
import { CodexPageSheet, registerCodexSync } from "./codex.mjs";
import { registerConcentration } from "./concentration.mjs";
import { registerDurations } from "./durations.mjs";
import { EventsApp } from "./apps/events.mjs";
import { setupDecks, importEventCards, newCard, reshuffle } from "./strategy/events.mjs";
import { confirmLiberation, liberate, incursions, breakIncursion } from "./strategy/losing-ground.mjs";
import { installCalendar, forgetCalendar, startCalendar, getCalendar, dateInfo, setDate, advanceDays, setWorldTime } from "./calendar.mjs";
import { CalendarApp, CalendarEditor, DateBar, addCalendarControl } from "./apps/calendar.mjs";
import * as calendarRules from "./rules/calendar.mjs";
import { TurnRibbon } from "./apps/turn-ribbon.mjs";

Hooks.once("init", () => {
  console.log("irop | Insurrection: Retake Our Planet | initializing");

  CONFIG.IROP = IROP;
  registerSettings();
  // The Strategy Layer rules window, in Configure Settings (2026-10-08).
  game.settings.registerMenu("irop", "strategyRulesMenu", {
    name: "Strategy Layer",
    label: "Open the settings",
    hint: "The campaign's scale, the automatic GENESIS phase, and every number the Strategy Layer runs on.",
    icon: "fa-solid fa-chess-rook",
    type: StrategyRulesConfig,
    restricted: true
  });
  // The calendar (Johnald, 2026-10-08), in Configure Settings beside the Strategy Layer's.
  game.settings.registerMenu("irop", "calendarMenu", {
    name: "Calendar",
    label: "Calendar settings",
    hint: "Where the date shows, how far a turn moves it, and the calendar itself: months, weekdays, leap years and seasons.",
    icon: "fa-solid fa-calendar-days",
    type: CalendarEditor,
    restricted: true
  });
  // Foundry's own clock reads the date the system's way.
  installCalendar();
  // The War Room map (Strategy Layer step 2, 2026-10-08).
  registerWarRoom();
  // What players may ask the GM's client to do in the ODR phase (step 5).
  registerOdrActions();
  registerFactionActions();
  // Enlistment (2026-10-12): players' new operatives are made by the GM's client.
  registerEnlistment();
  // And at a store: buy what is in limited stock (2026-10-10).
  registerStoreActions();
  // Promotions in chat as XP earned crosses into a new ODR rank (2026-10-17).
  registerRankWatch();
  registerConcealmentActions();
  // ARTEMIS on Discord rolls from these sheets: linked characters send theirs when they change (2026-10-10).
  registerArtemis();

  // Documents and data models.
  CONFIG.Actor.documentClass = IropActor;
  CONFIG.Item.documentClass = IropItem;
  CONFIG.ActiveEffect.documentClass = IropActiveEffect;
  CONFIG.Actor.dataModels = { operative: OperativeData, npc: NpcData, store: StoreData };
  CONFIG.Item.dataModels = {
    weapon: itemModels.WeaponData,
    armor: itemModels.ArmorData,
    gear: itemModels.GearData,
    mod: itemModels.ModData,
    ability: itemModels.AbilityData,
    species: itemModels.SpeciesData,
    role: itemModels.RoleData,
    background: itemModels.BackgroundData,
    boon: itemModels.BoonData,
    mutation: itemModels.MutationData,
    skillTree: itemModels.SkillTreeData,
    territory: itemModels.TerritoryData,
    project: itemModels.ProjectData
  };

  // Event and Dark Event cards (Strategy Layer step 6).
  CONFIG.Card.dataModels = { ...(CONFIG.Card.dataModels ?? {}), event: EventCardData };

  // The Threat Codex (2026-10-17): a journal page per enemy, its intel revealed by the GM.
  if ( CONFIG.JournalEntryPage ) CONFIG.JournalEntryPage.dataModels = { ...(CONFIG.JournalEntryPage.dataModels ?? {}), codex: CodexPageData };

  // Squad sight (2026-10-08): players also see through every friendly token. The health
  // bar with its armor razor and barrier field (Johnald, 2026-10-10).
  CONFIG.Token.objectClass = vitalBarsToken(squadSightToken(CONFIG.Token.objectClass));

  // Token bars.
  const bars = ["vitals.hp", "vitals.energy", "vitals.armor", "vitals.barrier", "vitals.luck"];
  CONFIG.Actor.trackableAttributes = {
    operative: { bar: bars, value: ["critical", "xp.earned"] },
    npc: { bar: bars, value: ["critical"] }
  };

  // Initiative, LIVE: 1d20 + AGI mod + LCK mod.
  CONFIG.Combat.initiative = { formula: "1d20 + @agi.mod + @lck.mod + @initiativeBonus", decimals: 0 };

  // The turn marker, and the sides' colors it is tinted with, the ribbon's own (2026-10-11): ODR sky for
  // the cell and its friends, silver for neutrals, GENESIS red for hostiles. Token outlines take them too.
  CONFIG.Combat.fallbackTurnMarker = IROP.turnMarker;
  const sideColor = key => Number.parseInt(IROP.turnOrder.sides[key].color.slice(1), 16);
  if ( CONFIG.Canvas?.dispositionColors ) Object.assign(CONFIG.Canvas.dispositionColors, {
    PARTY: sideColor("operative"), FRIENDLY: sideColor("ally"), NEUTRAL: sideColor("neutral"), HOSTILE: sideColor("hostile")
  });

  // Dice: the roll classes must be registered to rebuild from chat messages.
  CONFIG.Dice.rolls.push(DynosrsRoll, D100Roll, DamageRoll);

  // Status effects, replacing core's set.
  CONFIG.statusEffects = IROP.statusEffects.map(s => ({ id: s.id, name: s.name, img: s.img, description: s.text }));

  // Sheets. Core registers no Actor or Item sheet of its own, so there is nothing to unregister.
  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.registerSheet(Actor, "irop", OperativeSheet, {
    types: ["operative"], makeDefault: true, label: "Insurrection Operative"
  });
  DocumentSheetConfig.registerSheet(Actor, "irop", NpcSheet, {
    types: ["npc"], makeDefault: true, label: "Insurrection NPC"
  });
  DocumentSheetConfig.registerSheet(Actor, "irop", StoreSheet, {
    types: ["store"], makeDefault: true, label: "Insurrection Store"
  });
  DocumentSheetConfig.registerSheet(Item, "irop", IropItemSheet, {
    makeDefault: true, label: "Insurrection Item"
  });
  DocumentSheetConfig.registerSheet(CONFIG.Card.documentClass, "irop", EventCardSheet, {
    types: ["event"], makeDefault: true, label: "Insurrection Event card"
  });
  if ( globalThis.JournalEntryPage ) DocumentSheetConfig.registerSheet(JournalEntryPage, "irop", CodexPageSheet, {
    types: ["codex"], makeDefault: true, label: "Insurrection Threat codex"
  });
  registerCodexSync();
  // Disorientated breaks Concentration (2026-10-20).
  registerConcentration();
  // Statuses' X and timed effects count down at the start of each turn (2026-10-20).
  registerDurations();

  // Fonts used by the sheets, registered so Foundry text (drawings, notes) can use them too.
  CONFIG.fontDefinitions["Rajdhani"] ??= { editor: true, fonts: [] };
  CONFIG.fontDefinitions["Share Tech Mono"] ??= { editor: true, fonts: [] };

  // Partials shared by several templates.
  foundry.applications.handlebars.loadTemplates(["systems/irop/templates/item/physical.hbs"]);

  // Template helpers.
  Handlebars.registerHelper("iropTimes", (n, options) => {
    let out = "";
    for ( let i = 0; i < (Number(n) || 0); i++ ) out += options.fn({ index: i });
    return out;
  });

  // Public API, for macros.
  game.irop = {
    config: IROP,
    // startingSkills: how a role's or background's skill list is read (the Background skills macro, 2026-10-10).
    rules: { dynosrs, combat, startingSkills },
    rolls,
    DynosrsRoll,
    D100Roll,
    DamageRoll,
    getGmBanks,
    adjustGmBanks,
    startSession: rolls.startSession,
    endSession: rolls.endSession,
    rollPool: rolls.rollFreePool,
    scatter: rolls.rollScatter,
    openBanks: () => BanksApp.open(),
    // The turn marker's side colors, for the check macro (dev/turn-marker-check-macro.js, 2026-10-11).
    turnMarker: { sync: syncTurnMarkerTints, tint: markerTint },
    // Concealment checkpoints (2026-10-10).
    concealment: { openCheckpoint, postCheckpoint, checkFor },
    // Content from the old Sandbox world (2026-10-08).
    importAbilities,
    importTrees,
    importTerritories,
    importProjects,
    // The Strategy Layer (2026-10-08): the War Room's state, the rules in force, the campaign scale.
    strategy: { getWarRoom, setWarRoom, rules: getStrategyRules, scale: getStrategyScale, openRules: () => new StrategyRulesConfig().render({ force: true }),
      openWarRoom, buildTestMap, neighboursFromMap, redraw: drawOverlay,
      // Step 3: Logistics and Intel, and Support.
      ledger: getLedger, record: recordResource, undo: undoResource,
      openLedger: () => ResourceLedger.open(), openSupport: () => SupportApp.open(), callSupport,
      // Steps 4 and 5: the turn and the ODR phase.
      openOdr: tab => OdrBoard.open(tab), advance: () => TurnReport.open(), undoWeek: confirmUndo, plan: currentPlan, brief: briefMission,
      // Step 6: the Event and Dark Event decks.
      openEvents: () => EventsApp.open(), setupDecks, newCard, reshuffle,
      // Step 7: Losing Ground.
      liberate: territory => confirmLiberation(typeof territory === "string" ? game.items.get(territory) : territory),
      liberateNow: liberate, incursions, breakIncursion,
      // Factions (2026-10-11): standing and the tasks they offer.
      factions: { open: () => OdrBoard.open("factions"), list: getFactions, tasks: getTasks, log: getFactionLog,
        save: saveFaction, remove: deleteFaction, adjust: adjustStanding, saveTask, offer: offerTask, resolve: resolveTask } },
    // The calendar (2026-10-08): today in words, and the GM's ways to move it.
    calendar: { open: () => CalendarApp.open(), settings: () => CalendarEditor.open(), get: getCalendar, today: dateInfo,
      setDate, advanceDays, setTime: setWorldTime, rules: calendarRules },
    importEventCards,
    // The enlistment terminal (2026-10-12): a guided new operative.
    enlist: () => EnlistmentApp.open()
  };
});

Hooks.on("renderChatMessageHTML", onRenderChatMessage);
Hooks.on("updateToken", onTokenDisposition);
// Token health bars redraw when armor or a barrier changes, not only health (2026-10-10).
Hooks.on("updateActor", onVitalsChanged);
for ( const hook of ["createItem", "updateItem", "deleteItem"] ) Hooks.on(hook, item => onVitalsChanged(item));
// A player switched between the system's bars and Foundry's plain ones.
Hooks.on("irop.tokenBarsChanged", refreshAllTokenBars);

// Perk trees (2026-10-08): a GM's edit to a tree, or to a world ability, shows on open Dossiers.
// Debounced, so an import of hundreds of abilities redraws each sheet once.
const redrawDossiers = foundry.utils.debounce(() => {
  for ( const app of foundry.applications.instances?.values() ?? [] ) {
    if ( (app instanceof OperativeSheet) && app.rendered ) app.render();
  }
}, 200);
function refreshDossiers(item) {
  if ( item.parent || !["skillTree", "ability"].includes(item.type) ) return;
  redrawDossiers();
}
for ( const hook of ["createItem", "updateItem", "deleteItem"] ) Hooks.on(hook, refreshDossiers);
// A change to the specialization settings shows at once too.
Hooks.on("irop.skillTreeRulesChanged", redrawDossiers);

// The Banks window: a button in the Actors sidebar, kept current as banks change.
Hooks.on("renderActorDirectory", addBanksButton);
// Support beside it, for calling in mid mission; it and the ledger follow the stock (step 3).
Hooks.on("renderActorDirectory", addSupportButton);
Hooks.on("renderActorDirectory", addCheckpointButton);
// The enlistment terminal (2026-10-12), for everyone.
Hooks.on("renderActorDirectory", addEnlistButton);
Hooks.on("irop.strategyChanged", () => {
  ResourceLedger.refresh();
  SupportApp.refresh();
  refreshOdr();
});

// The ODR board and the project strip follow projects, territories and operatives (steps 4, 5).
const refreshOdr = foundry.utils.debounce(() => {
  OdrBoard.refresh();
  ProjectStrip.refresh();
}, 150);
for ( const hook of ["createItem", "updateItem", "deleteItem"] ) {
  Hooks.on(hook, item => { if ( ["project", "territory"].includes(item.type) && !item.parent ) refreshOdr(); });
}
Hooks.on("updateActor", actor => { if ( actor.type === "operative" ) refreshOdr(); });
// Cards moving between the War Room's stacks (step 6).
const refreshCards = foundry.utils.debounce(() => {
  EventsApp.refresh();
  OdrBoard.refresh();
}, 150);
for ( const hook of ["createCard", "updateCard", "deleteCard", "createCards", "deleteCards"] ) Hooks.on(hook, refreshCards);

// Celsius or Fahrenheit changed (2026-10-08): the territory card and sheets show it at once.
Hooks.on("irop.unitsChanged", () => {
  TerritoryCard.refresh();
  for ( const app of foundry.applications.instances?.values() ?? [] ) {
    if ( app.rendered && (app.document?.type === "territory") ) app.render();
  }
});

// The calendar (2026-10-08): everyone opens it from the Journal Notes tools; the date
// shows wherever it is as the time moves, or as the GM changes the calendar.
Hooks.on("getSceneControlButtons", addCalendarControl);
const refreshDates = foundry.utils.debounce(() => {
  CalendarApp.refresh();
  DateBar.refresh();
  WarRoomBar.refresh();
  TerritoryCard.refresh();
}, 100);
Hooks.on("updateWorldTime", refreshDates);
Hooks.on("irop.calendarChanged", () => {
  forgetCalendar();
  installCalendar({ reinitialize: true });
  DateBar.sync(isWarRoom(globalThis.canvas?.scene));
  refreshDates();
});

// A banner across every screen as a new week starts.
let shownWeek = null;
Hooks.on("irop.warRoomChanged", state => {
  if ( (shownWeek !== null) && (state.week > shownWeek) ) showWeekBanner(state.week);
  shownWeek = state.week;
});
Hooks.on("irop.gmBanksChanged", () => BanksApp.refresh());
Hooks.on("irop.squadChanged", () => BanksApp.refresh());
Hooks.on("deleteActor", actor => {
  if ( actor.type === "operative" ) BanksApp.refresh();
});
Hooks.on("updateActor", (actor, changed) => {
  if ( actor.type !== "operative" ) return;
  if ( ["system.banks", "name", "img"].some(k => foundry.utils.hasProperty(changed, k)) ) BanksApp.refresh();
});

// The turn order ribbon (Johnald, 2026-10-11): it follows the combat in view, its turns, and what
// its cards show (health, dodges, status effects, a token's side). Redraws are gathered up.
for ( const hook of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant",
  "deleteCombatant", "canvasReady", "irop.turnRibbonChanged"] ) Hooks.on(hook, () => TurnRibbon.refresh());
for ( const hook of ["updateActor", "updateToken", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect",
  "createItem", "updateItem", "deleteItem"] ) Hooks.on(hook, () => { if ( game.combat ) TurnRibbon.refresh(); });
// The date bar steps down out of its way while it shows.
Hooks.on("irop.turnRibbonShown", () => DateBar.refresh());
// The turn marker in its side's exact color while Disposition Tint is on (2026-10-11).
Hooks.on("canvasReady", watchTurnMarkers);

/** Dodges come back at the start of each round. The GM's client does it once. */
Hooks.on("updateCombat", (combat, changed) => {
  if ( !game.user.isGM || !("round" in changed) ) return;
  for ( const c of combat.combatants ) {
    const actor = c.actor;
    if ( actor?.system?.vitals?.dodges && (actor.system.vitals.dodges.value !== actor.system.vitals.dodges.max) ) {
      actor.resetDodges();
    }
  }
});

Hooks.once("ready", () => {
  // Players' ODR actions reach the GM's client over the system socket (step 5).
  initSocket();
  // Portraits and tokens shown full size in the lower left on hover (2026-10-16).
  registerHoverPreview();
  // Reputation's nine levels and Strength to 25 (2026-10-11): an older world's territories move onto them, once.
  migrateReputation().then(() => migrateStrength())
    .catch(err => console.error("irop | The world could not be moved to the new Reputation and Strength scales", err));
  shownWeek = getWarRoom().week;
  // A new world opens on the campaign's date, once; the date bar shows even with no scene.
  startCalendar().catch(err => console.warn("irop | The calendar could not be put on the campaign's date", err));
  if ( !globalThis.canvas?.ready ) DateBar.sync(false);
  TurnRibbon.sync();
  // A one time check that the canon dice tables are intact.
  const problems = dynosrs.testTotals();
  if ( problems.length ) console.error("irop | DYNOSRS dice tables do not match canon:", problems);
});

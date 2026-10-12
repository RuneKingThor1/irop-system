import { IROP } from "../config.mjs";
import { turnDays, dateInfo, worldTime } from "../calendar.mjs";
import { SECONDS_PER_DAY } from "../rules/calendar.mjs";
import {
  canStart, weeklyProgress, progressBreakdown, skillLabel, salvageProgress, assignmentOf, tacticalChoices, perkRewards
} from "../rules/projects.mjs";
import { SECTIONS } from "../rules/turn.mjs";
import { checkDarkChoice } from "../rules/events.mjs";
import { reprisalInPlay, responseChoices } from "../strategy/events.mjs";
import { PHASES } from "../rules/strategy.mjs";
import { getWarRoom, getStrategyRules, getList, setList, genesisAutomatic } from "../settings.mjs";
import { asGM } from "../socket.mjs";
import {
  worldProjects, plainProject, soldierOf, addSalvage, setShown, briefMission, debriefMission, debriefDefaults, debriefContext,
  squadForPerks
} from "../strategy/odr.mjs";
import { currentPlan, applyTurn, lastTurn, undoTurn } from "../strategy/turn.mjs";
import { incursionChoices, confirmLiberation } from "../strategy/losing-ground.mjs";
import { megacityCount } from "../rules/losing-ground.mjs";
import { factionLevel, standingText, standingChange, dueText, rewardText, isOpen, signed } from "../rules/factions.mjs";
import { repPips, repRank, levelTone, signedLevel } from "../rules/reputation.mjs";
import {
  getFactions, getTasks, getFactionLog, factionName, saveFaction, deleteFaction, adjustStanding, setFactionHidden,
  saveTask, offerTask, withdrawTask, deleteTask, resolveTask, resolveDefaults
} from "../strategy/factions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/**
 * The ODR phase's windows (Strategy Layer steps 4 and 5, 2026-10-08): the ODR board
 * (Research, Engineering, Intelligence and the week's Tactical Action), the turn
 * report Advance week shows before anything is saved, the project strip along the
 * bottom of a War Room map, and the banner when a new week starts.
 */

const TABS = {
  research: { label: "Research", icon: "fa-solid fa-flask" },
  engineering: { label: "Engineering", icon: "fa-solid fa-helmet-safety" },
  intelligence: { label: "Intelligence", icon: "fa-solid fa-user-secret" },
  tactical: { label: "Tactical", icon: "fa-solid fa-crosshairs" },
  // Faction standing and the tasks they offer (Johnald, 2026-10-11).
  factions: { label: "Factions", icon: "fa-solid fa-handshake", tip: "Faction tasks open" }
};

const byName = (a, b) => a.name.localeCompare(b.name);
const enrich = html => foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { secrets: !!game.user?.isGM });

/** What each kind of project calls starting one. */
function startLabel(kind, switching) {
  if ( kind === "research" ) return switching ? "Switch to this" : "Research this";
  return (kind === "engineering") ? "Build" : "Start";
}

/** The skills a project takes, in words. */
function skillsText(system) {
  if ( system.kind === "intelligence" ) return "Any Social skill, Stealth, Hacking or Lock Picking";
  return (system.specialization ?? []).map(skillLabel).join(", ") || "No skills set";
}

/* -------------------------------------------- */
/*  The ODR board                               */
/* -------------------------------------------- */

export class OdrBoard extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-odr-board",
    classes: ["irop", "irop-odr-board"],
    window: { title: "ODR phase", icon: "fa-solid fa-chess-board", resizable: true },
    // 40px wider for the fifth tab, Factions (2026-10-11).
    position: { width: 720, height: 720 },
    actions: {
      // Not "tab": Foundry keeps that action for its own tab groups and never calls ours (fixed 2026-10-08).
      switchTab: OdrBoard.#onTab,
      start: OdrBoard.#onStart,
      stop: OdrBoard.#onStop,
      assign: OdrBoard.#onAssign,
      unassign: OdrBoard.#onUnassign,
      spend: OdrBoard.#onSpend,
      salvage: OdrBoard.#onSalvage,
      show: OdrBoard.#onShow,
      hide: OdrBoard.#onHide,
      newProject: OdrBoard.#onNewProject,
      openProject: OdrBoard.#onOpenProject,
      choose: OdrBoard.#onChoose,
      clear: OdrBoard.#onClear,
      brief: () => briefMission(),
      debrief: OdrBoard.#onDebrief,
      removeRevealed: OdrBoard.#onRemoveRevealed,
      advance: () => TurnReport.open(),
      undo: () => confirmUndo(),
      // Factions (2026-10-11).
      newFaction: () => editFactionDialog(),
      editFaction: OdrBoard.#onEditFaction,
      deleteFaction: OdrBoard.#onDeleteFaction,
      standingUp: (event, target) => adjustStanding(OdrBoard.#factionOf(target), 1),
      standingDown: (event, target) => adjustStanding(OdrBoard.#factionOf(target), -1),
      showFaction: (event, target) => setFactionHidden(OdrBoard.#factionOf(target), false),
      hideFaction: (event, target) => setFactionHidden(OdrBoard.#factionOf(target), true),
      newTask: (event, target) => editTaskDialog(null, { faction: OdrBoard.#factionOf(target) }),
      editTask: (event, target) => editTaskDialog(OdrBoard.#taskOf(target)),
      offerTask: (event, target) => offerTask(OdrBoard.#taskOf(target)),
      withdrawTask: (event, target) => withdrawTask(OdrBoard.#taskOf(target)),
      deleteTask: OdrBoard.#onDeleteTask,
      acceptTask: OdrBoard.#onAcceptTask,
      releaseTask: (event, target) => asGM("faction.release", { id: OdrBoard.#taskOf(target) }),
      sendOperative: OdrBoard.#onSendOperative,
      recallOperative: (event, target) => asGM("faction.unassign", { id: OdrBoard.#taskOf(target), actor: target.closest("[data-actor-id]")?.dataset.actorId }),
      resolveTask: (event, target) => resolveTaskDialog(OdrBoard.#taskOf(target))
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/odr-board.hbs", scrollable: [".odr-pane"] }
  };

  static #instance = null;

  /** The tab shown. */
  tab = "research";

  /** A territory picked for the Tactical Action before choosing it (from a territory card). */
  territory = "";

  /**
   * Open the board.
   * @param {string} [tab]                 research, engineering, intelligence, tactical or factions
   * @param {{territory?: string}} [options]
   */
  static open(tab, { territory } = {}) {
    this.#instance ??= new this();
    if ( TABS[tab] ) this.#instance.tab = tab;
    if ( territory ) this.#instance.territory = territory;
    return this.#instance.render({ force: true });
  }

  static refresh() {
    if ( this.#instance?.rendered ) this.#instance.render();
  }

  /** @override */
  async _prepareContext(options) {
    const state = getWarRoom();
    const rules = getStrategyRules();
    const isGM = !!game.user?.isGM;
    const items = worldProjects().sort(byName);
    const all = items.map(plainProject);
    const shown = items.filter(i => isGM || (i.system.status !== "hidden"));
    const territoryName = id => (id ? (game.items?.get(id)?.name ?? "") : "");
    const mine = (game.actors?.filter(a => (a.type === "operative") && (isGM || a.isOwner)) ?? []).sort(byName);

    const slot = async item => {
      const s = item.system;
      const weekly = weeklyProgress(s, soldierOf, rules);
      return {
        id: item.id, name: item.name, img: item.img,
        resource: IROP.resources[s.resource]?.label ?? "",
        progress: s.progress, cost: s.cost, pct: s.percent, remaining: s.remaining, noCost: !(s.cost > 0),
        weekly: weekly.total, breakdown: progressBreakdown(weekly),
        skills: skillsText(s), advancement: s.advancement, unlocks: (s.kind === "research") ? s.unlocks : "",
        term: (s.kind === "intelligence") ? IROP.intelTerms[s.term] : "",
        builds: (s.kind === "engineering") ? IROP.engineeringBuilds[s.builds] : "",
        where: territoryName(s.territory), reveals: (s.kind === "intelligence") ? s.reveals : "",
        salvage: s.salvage, canSalvage: isGM && (s.kind === "research") && (s.cost > 0),
        salvageAmount: salvageProgress(s.cost, rules),
        assigned: weekly.soldiers.map(x => ({ ...x, canRemove: isGM || !!game.actors?.get(x.actor)?.isOwner })),
        soldiers: mine.filter(a => !s.assigned.some(x => x.actor === a.id)).map(a => {
          const on = assignmentOf(all, a.id);
          return { id: a.id, name: on ? `${a.name} (on ${on.name})` : a.name };
        }),
        description: await enrich(s.description)
      };
    };
    const row = async item => {
      const s = item.system;
      const check = canStart(plainProject(item), all, rules);
      const switching = (s.kind === "research") && all.some(p => (p.kind === "research") && (p.status === "active"));
      return {
        id: item.id, name: item.name, img: item.img, cost: s.cost, progress: s.progress, pct: s.percent,
        resource: IROP.resources[s.resource]?.label ?? "",
        hidden: s.status === "hidden", complete: s.status === "complete",
        skills: skillsText(s),
        term: (s.kind === "intelligence") ? IROP.intelTerms[s.term] : "",
        builds: (s.kind === "engineering") ? IROP.engineeringBuilds[s.builds] : "",
        where: territoryName(s.territory),
        unlocks: (s.kind === "research") ? s.unlocks : "",
        reveals: (s.kind === "intelligence") ? s.reveals : "",
        canStart: check.ok, why: check.reason ?? "", startLabel: startLabel(s.kind, switching),
        description: await enrich(s.description)
      };
    };
    const ofKind = kind => shown.filter(i => i.system.kind === kind);
    const active = kind => ofKind(kind).filter(i => i.system.status === "active");
    const waiting = kind => ofKind(kind).filter(i => ["available", "hidden"].includes(i.system.status));
    const done = kind => ofKind(kind).filter(i => i.system.status === "complete");
    const rows = list => Promise.all(list.map(row));

    // Research: one at a time. Engineering: a slot each, empty ones shown. Intelligence: short and long.
    const slotsEng = Math.max(1, Math.round(Number(rules.engineeringSlots) || 1));
    const engActive = await Promise.all(active("engineering").map(slot));
    const engineering = {
      slots: [...engActive, ...Array.from({ length: Math.max(0, slotsEng - engActive.length) }, (_, i) => ({ empty: true, n: engActive.length + i + 1 }))],
      waiting: await rows(waiting("engineering")),
      done: await rows(done("engineering")),
      free: Math.max(0, slotsEng - engActive.length),
      slotsTotal: slotsEng
    };
    const intelSlot = async term => {
      const item = active("intelligence").find(i => i.system.term === term);
      return item ? slot(item) : { empty: true, term: IROP.intelTerms[term].toLowerCase() };
    };
    const intelligence = {
      slots: [await intelSlot("short"), await intelSlot("long")],
      short: await rows(waiting("intelligence").filter(i => i.system.term === "short")),
      long: await rows(waiting("intelligence").filter(i => i.system.term === "long")),
      done: await rows(done("intelligence"))
    };
    const researchActive = active("research")[0];
    const research = {
      slot: researchActive ? await slot(researchActive) : null,
      waiting: await rows(waiting("research")),
      done: await rows(done("research"))
    };

    // The week's Tactical Action.
    const revealed = getList("revealedActions");
    const territories = (game.items?.filter(i => (i.type === "territory") && (i.system.control !== "liberated")) ?? []).sort(byName);
    const t = state.tactical;
    const tactical = {
      current: t ? {
        ...t, where: territoryName(t.territory), heatLabel: IROP.heatClasses[t.heat] ?? "",
        statusLabel: { chosen: "Chosen, not yet briefed", briefed: "Briefed: the squad is deployed", done: "Debriefed" }[t.status] ?? "",
        canClear: (t.status !== "done") && (isGM || (t.status === "chosen")),
        canBrief: isGM && (t.status !== "done"),
        canDebrief: isGM && (t.status !== "done"),
        done: t.status === "done"
      } : null,
      choices: tacticalChoices(revealed, responseChoices(), incursionChoices()).map(c => ({ ...c, where: territoryName(c.territory), heatLabel: IROP.heatClasses[c.heat] ?? "" })),
      territories: Object.fromEntries(territories.map(x => [x.id, x.name])),
      territory: territories.some(x => x.id === this.territory) ? this.territory : "",
      log: getList("missionLog").slice(-12).reverse().map(e => debriefContext(e, { rules }))
    };

    const factions = factionsContext({ isGM, week: state.week, mine, territoryName });

    const last = isGM ? lastTurn() : null;
    const badge = (n, of) => `${n}/${of}`;
    const tabs = Object.entries(TABS).map(([key, tb]) => ({
      key, ...tb, active: key === this.tab,
      badge: {
        research: badge(research.slot ? 1 : 0, 1),
        engineering: badge(engActive.length, slotsEng),
        intelligence: badge(intelligence.slots.filter(x => !x.empty).length, 2),
        tactical: t ? ({ chosen: "chosen", briefed: "deployed", done: "done" }[t.status] ?? "") : "open",
        factions: String(factions.open.length)
      }[key]
    }));
    return {
      tab: this.tab, tabs, isGM,
      is: { [this.tab]: true },
      week: state.week, phase: PHASES[state.phase] ?? state.phase,
      megacities: megacityCount(game.items?.filter(i => i.type === "territory") ?? []),
      logistics: state.logistics, intel: state.intel,
      research, engineering, intelligence, tactical, factions,
      hasSoldiers: mine.length > 0,
      undoWeek: last ? last.to : null
    };
  }

  /* -------------------------------------------- */

  static #idOf(target) {
    return target.closest("[data-project-id]")?.dataset.projectId;
  }

  static async #onTab(event, target) {
    this.tab = target.dataset.tab;
    return this.render();
  }

  static #onStart(event, target) {
    return asGM("project.start", { id: OdrBoard.#idOf(target) });
  }

  static #onStop(event, target) {
    return asGM("project.stop", { id: OdrBoard.#idOf(target) });
  }

  static #onAssign(event, target) {
    const actor = target.closest("[data-project-id]")?.querySelector("select[data-soldier]")?.value;
    if ( !actor ) return ui.notifications.warn("Pick an operative to assign.");
    return asGM("project.assign", { id: OdrBoard.#idOf(target), actor });
  }

  static #onUnassign(event, target) {
    return asGM("project.unassign", { id: OdrBoard.#idOf(target), actor: target.closest("[data-actor-id]")?.dataset.actorId });
  }

  static #onSpend(event, target) {
    const input = target.closest("[data-project-id]")?.querySelector("input[data-spend]");
    const amount = Math.round(Number(input?.value) || 0);
    if ( amount <= 0 ) return ui.notifications.warn("Enter how much to spend.");
    return asGM("project.spend", { id: OdrBoard.#idOf(target), amount });
  }

  static #onSalvage(event, target) {
    return addSalvage(game.items.get(OdrBoard.#idOf(target)));
  }

  static #onShow(event, target) {
    return setShown(game.items.get(OdrBoard.#idOf(target)), true);
  }

  static #onHide(event, target) {
    return setShown(game.items.get(OdrBoard.#idOf(target)), false);
  }

  /** A new project of the kind on this tab, its sheet opened to fill in. */
  static async #onNewProject(event, target) {
    if ( !game.user.isGM ) return null;
    const kind = target.dataset.kind;
    const label = IROP.projectKinds[kind]?.label ?? "Project";
    return Item.implementation.create({
      name: `New ${label.toLowerCase()} project`, type: "project",
      system: { kind, status: "hidden", term: target.dataset.term ?? "short" }
    }, { renderSheet: true });
  }

  static #onOpenProject(event, target) {
    const item = game.items.get(OdrBoard.#idOf(target));
    if ( item?.testUserPermission(game.user, "OBSERVER") ) item.sheet.render({ force: true });
  }

  static #onChoose(event, target) {
    const row = target.closest("[data-choice]");
    const territory = this.element.querySelector("select[data-tactical-territory]")?.value ?? "";
    return asGM("tactical.choose", { key: row?.dataset.choice, territory });
  }

  static #onClear() {
    return asGM("tactical.clear");
  }

  static async #onDebrief() {
    const state = getWarRoom();
    const t = state.tactical;
    if ( !t ) return null;
    const rules = getStrategyRules();
    const defaults = debriefDefaults(t, rules);
    // What the deployed squad's background perks will add on a success (2026-10-11).
    const perks = perkRewards(squadForPerks(), game.items.get(t.territory)?.system?.kind, "success").lines;
    const content = await renderTemplate("systems/irop/templates/dialog/debrief.hbs", {
      label: t.label, territory: game.items.get(t.territory)?.name ?? "", rewards: t.rewards, defaults, perks,
      outcomes: IROP.missionOutcomes, heatClasses: Object.fromEntries(Object.entries(IROP.heatClasses).map(([k, v]) => [k, (k === "none") ? v : `${v}, +${rules.heatRise[k]}`])),
      reputationRules: rules.missionReputation,
      salvagePercent: rules.salvagePercent
    });
    const data = await DialogV2.input({
      window: { title: `Debrief: ${t.label}` },
      classes: ["irop", "irop-debrief-dialog"],
      position: { width: 480 },
      content,
      ok: { label: "Debrief", icon: "fa-solid fa-clipboard-check" },
      rejectClose: false,
      render: (ev, dialog) => {
        const root = dialog.element;
        root.querySelector("[name=outcome]")?.addEventListener("change", e => {
          const rep = root.querySelector("[name=reputation]");
          if ( rep ) rep.value = String(defaults.reputationFor[e.target.value] ?? 0);
        });
      }
    });
    if ( !data ) return null;
    const entry = await debriefMission(data);
    // Step 7: the third objective taken, the Megacity is ready to liberate.
    if ( entry?.liberates ) await confirmLiberation(game.items.get(t.territory));
    return entry;
  }

  /* -------------------------------------------- */
  /*  Factions                                    */
  /* -------------------------------------------- */

  static #factionOf(target) {
    return target.closest("[data-faction-id]")?.dataset.factionId ?? "";
  }

  static #taskOf(target) {
    return target.closest("[data-task-id]")?.dataset.taskId ?? "";
  }

  static #onEditFaction(event, target) {
    const faction = getFactions().find(f => f.id === OdrBoard.#factionOf(target));
    if ( !game.user.isGM || !faction ) return null;
    return editFactionDialog(faction);
  }

  static async #onDeleteFaction(event, target) {
    const faction = getFactions().find(f => f.id === OdrBoard.#factionOf(target));
    if ( !game.user.isGM || !faction ) return null;
    const ok = await DialogV2.confirm({
      window: { title: `Remove ${faction.name}?` },
      content: `<p>${foundry.utils.escapeHTML(faction.name)} leaves the board, with every task of theirs. Their lines in the standing log stay.</p>`,
      rejectClose: false
    });
    return ok ? deleteFaction(faction.id) : null;
  }

  static async #onDeleteTask(event, target) {
    const task = getTasks().find(t => t.id === OdrBoard.#taskOf(target));
    if ( !game.user.isGM || !task ) return null;
    const ok = await DialogV2.confirm({
      window: { title: `Delete ${task.title}?` },
      content: "<p>The task is gone for good. Nothing it already gave is taken back.</p>",
      rejectClose: false
    });
    return ok ? deleteTask(task.id) : null;
  }

  /** Take a task; the operative picked in its card, if any, goes on it at once. */
  static #onAcceptTask(event, target) {
    const actor = target.closest("[data-task-id]")?.querySelector("select[data-task-soldier]")?.value ?? "";
    return asGM("faction.accept", { id: OdrBoard.#taskOf(target), actor });
  }

  static #onSendOperative(event, target) {
    const actor = target.closest("[data-task-id]")?.querySelector("select[data-task-soldier]")?.value;
    if ( !actor ) return ui.notifications.warn("Pick an operative to send.");
    return asGM("faction.assign", { id: OdrBoard.#taskOf(target), actor });
  }

  static async #onRemoveRevealed(event, target) {
    if ( !game.user.isGM ) return null;
    const key = target.closest("[data-choice]")?.dataset.choice;
    return setList("revealedActions", getList("revealedActions").filter(r => r.id !== key));
  }
}

/* -------------------------------------------- */
/*  Factions: the board's tab and its dialogs   */
/* -------------------------------------------- */

/**
 * The Factions tab (2026-10-11): the tasks open this turn, the GM's drafts, every faction's
 * standing by tier, and the log. Players see only the factions the GM has shown, and
 * their tasks.
 */
export function factionsContext({ isGM = !!game.user?.isGM, week = 1, mine = [], territoryName = () => "" } = {}) {
  const all = getFactions();
  const known = all.filter(f => isGM || !f.hidden);
  const knownIds = new Set(known.map(f => f.id));
  const tasks = getTasks().filter(t => knownIds.has(t.faction));
  const nameOf = id => factionName(id, all);
  const tierOf = f => IROP.factionTiers[f?.tier] ?? IROP.factionTiers.minor;
  const onTask = id => tasks.find(t => isOpen(t) && t.operatives.includes(id));
  const actorName = id => game.actors?.get(id)?.name ?? "An operative";

  const taskCard = t => {
    const faction = all.find(f => f.id === t.faction);
    return {
      id: t.id, title: t.title, brief: t.brief, status: t.status, taken: t.status === "accepted",
      faction: nameOf(t.faction), factionId: t.faction, img: faction?.img ?? "", icon: tierOf(faction).icon,
      due: dueText(t, week), dueNow: !!t.due && (t.due <= week), term: t.term,
      offers: rewardText(t), failure: t.failure,
      rival: t.rival ? nameOf(t.rival) : "", rivalLoss: t.rivalLoss,
      by: t.by,
      team: t.operatives.map(id => ({ id, name: actorName(id), canRemove: isGM || !!game.actors?.get(id)?.isOwner })),
      soldiers: mine.filter(a => !t.operatives.includes(a.id)).map(a => {
        const on = onTask(a.id);
        return { id: a.id, name: on ? `${a.name} (on ${on.title})` : a.name };
      })
    };
  };

  // Standing (RULED 2026-10-11): a level on the factions' ladder, and the points in its bar.
  const scale = IROP.reputationScale;
  const recent = getFactionLog().filter(l => isGM || knownIds.has(l.faction));
  const change = l => (((l.delta === null) || (l.delta === undefined)) ? "Set" : signed(l.delta));
  const row = f => {
    const level = factionLevel(f.standing);
    return {
      id: f.id, name: f.name, tier: f.tier, stance: f.stance, img: f.img, icon: tierOf(f).icon,
      home: territoryName(f.home), notes: f.notes, hidden: f.hidden,
      standing: f.standing, points: f.points, standingText: standingText(f.standing),
      band: level.key, bandLabel: level.label, bandText: level.text,
      pips: repPips(f.points), pointsText: `${f.points}/${scale.points}`,
      atMin: (f.standing <= -scale.levels) && (f.points <= 0), atMax: (f.standing >= scale.levels) && (f.points >= scale.points),
      history: recent.filter(l => l.faction === f.id).slice(-3).reverse().map(l => `Turn ${l.week}: ${change(l)}, ${l.reason}`).join("<br>"),
      openTasks: tasks.filter(t => (t.faction === f.id) && isOpen(t)).length
    };
  };
  const tiers = Object.entries(IROP.factionTiers).map(([key, tier]) => ({
    key, label: tier.label,
    rows: known.filter(f => f.tier === key).sort((a, b) => (repRank({ level: b.standing, points: b.points }) - repRank({ level: a.standing, points: a.points })) || byName(a, b)).map(row)
  })).filter(t => isGM || t.rows.length);

  // Taken first, then offered; each by deadline.
  const taken = t => ((t.status === "accepted") ? 0 : 1);
  const open = tasks.filter(isOpen).sort((a, b) => (taken(a) - taken(b)) || ((a.due ?? 0) - (b.due ?? 0))).map(taskCard);
  const finished = tasks.filter(t => ["resolved", "lapsed"].includes(t.status))
    .sort((a, b) => (b.resolvedWeek ?? 0) - (a.resolvedWeek ?? 0)).slice(0, 12)
    .map(t => ({
      id: t.id, title: t.title, faction: nameOf(t.faction), week: t.resolvedWeek ?? t.week,
      outcome: (t.status === "lapsed") ? "lapsed" : t.outcome,
      outcomeLabel: (t.status === "lapsed") ? "Lapsed" : (IROP.missionOutcomes[t.outcome] ?? "")
    }));
  return {
    open,
    drafts: isGM ? tasks.filter(t => t.status === "draft").map(taskCard) : [],
    tiers,
    any: known.length > 0,
    finished,
    log: recent.slice(-12).reverse().map(l => ({
      week: l.week, name: l.name || nameOf(l.faction), delta: change(l), reason: l.reason,
      up: ((l.delta === null) || (l.delta === undefined)) ? (repRank(l.to) >= repRank(l.from)) : (Number(l.delta) > 0),
      to: (l.from && l.to) ? standingChange(l.from, l.to) : ""
    })),
    // The ladder, top first.
    bands: Object.entries(IROP.factionLevels).sort(([a], [b]) => Number(b) - Number(a))
      .map(([k, v]) => ({ key: levelTone(Number(k)), label: v.label, text: v.text, range: signedLevel(Number(k)) })),
    pointsPerLevel: scale.points, entry: scale.entry
  };
}

/** The territories, for a faction's home. */
function territoryChoices() {
  return Object.fromEntries((game.items?.filter(i => i.type === "territory") ?? []).sort(byName).map(t => [t.id, t.name]));
}

/** Make or change a faction. GM only. */
export async function editFactionDialog(faction = null) {
  if ( !game.user?.isGM ) return null;
  const scale = IROP.reputationScale;
  const content = await renderTemplate("systems/irop/templates/dialog/faction.hbs", {
    faction: faction ?? { tier: "minor", standing: 0, points: scale.entry },
    tiers: Object.fromEntries(Object.entries(IROP.factionTiers).map(([k, v]) => [k, v.one])),
    levels: Object.fromEntries(Object.entries(IROP.factionLevels).sort(([a], [b]) => Number(b) - Number(a))
      .map(([k, v]) => [k, `${signedLevel(Number(k))} ${v.label}`])),
    territories: territoryChoices(),
    scale
  });
  const data = await DialogV2.input({
    window: { title: faction ? `Faction: ${faction.name}` : "New faction", icon: "fa-solid fa-handshake" },
    classes: ["irop", "irop-faction-dialog"],
    position: { width: 520 },
    content,
    ok: { label: faction ? "Save" : "Add faction", icon: "fa-solid fa-check" },
    rejectClose: false,
    render: (ev, dialog) => {
      dialog.element.querySelector("[data-pick-image]")?.addEventListener("click", () => {
        const input = dialog.element.querySelector("[name=img]");
        const Picker = foundry.applications.apps.FilePicker.implementation;
        new Picker({ type: "image", current: input.value, callback: path => { input.value = path; } }).render({ force: true });
      });
    }
  });
  if ( !data ) return null;
  return saveFaction({ ...data, id: faction?.id ?? "" });
}

/** Write or change a task. A new one can go on offer at once. GM only. */
export async function editTaskDialog(id = null, { faction = "" } = {}) {
  if ( !game.user?.isGM ) return null;
  const factions = getFactions();
  if ( !factions.length ) return ui.notifications.warn("Add a faction first.");
  const rules = getStrategyRules();
  const task = id ? getTasks(rules).find(t => t.id === id) : null;
  if ( id && !task ) return null;
  const f = rules.factions;
  const choices = Object.fromEntries(factions.map(x => [x.id, x.name]));
  const content = await renderTemplate("systems/irop/templates/dialog/faction-task.hbs", {
    task: task ?? { faction: faction || factions[0].id, term: f.taskTurns, standing: f.taskStanding, failure: f.taskFailure, rivalLoss: f.rivalLoss, logistics: 0, intel: 0 },
    isNew: !task,
    factions: choices
  });
  const data = await DialogV2.input({
    window: { title: task ? `Task: ${task.title}` : "New faction task", icon: "fa-solid fa-handshake" },
    classes: ["irop", "irop-faction-dialog"],
    position: { width: 540 },
    content,
    ok: { label: task ? "Save" : "Add task", icon: "fa-solid fa-check" },
    rejectClose: false
  });
  if ( !data ) return null;
  const { offer, ...fields } = data;
  if ( fields.rival === fields.faction ) fields.rival = "";
  const saved = await saveTask({ ...fields, id: task?.id ?? "" });
  if ( saved && !task && offer ) return offerTask(saved.id);
  return saved;
}

/** Resolve a task as the GM saw it go: the outcome fills in what it gives, which the GM can change. */
export async function resolveTaskDialog(id) {
  if ( !game.user?.isGM ) return null;
  const rules = getStrategyRules();
  const task = getTasks(rules).find(t => t.id === id);
  if ( !task ) return null;
  const factions = getFactions();
  const defaults = resolveDefaults(task, rules);
  const content = await renderTemplate("systems/irop/templates/dialog/task-resolve.hbs", {
    task, defaults, faction: factionName(task.faction, factions), rival: task.rival ? factionName(task.rival, factions) : "",
    outcomes: IROP.missionOutcomes, offers: rewardText(task)
  });
  const data = await DialogV2.input({
    window: { title: `Resolve: ${task.title}`, icon: "fa-solid fa-clipboard-check" },
    classes: ["irop", "irop-debrief-dialog", "irop-faction-dialog"],
    position: { width: 480 },
    content,
    ok: { label: "Resolve", icon: "fa-solid fa-clipboard-check" },
    rejectClose: false,
    render: (ev, dialog) => {
      const root = dialog.element;
      root.querySelector("[name=outcome]")?.addEventListener("change", e => {
        const r = defaults.resultsFor[e.target.value] ?? {};
        for ( const key of ["standing", "rival", "logistics", "intel"] ) {
          const input = root.querySelector(`[name=${key}]`);
          if ( input ) input.value = String(r[key] ?? 0);
        }
      });
    }
  });
  if ( !data ) return null;
  return resolveTask(task.id, data);
}

/* -------------------------------------------- */
/*  Advance week: the turn report               */
/* -------------------------------------------- */

/** Undo the last Advance week, after a confirm. GM only. */
export async function confirmUndo() {
  const last = lastTurn();
  if ( !game.user.isGM || !last ) return null;
  const ok = await DialogV2.confirm({
    window: { title: `Undo turn ${last.to}?` },
    content: `<p>Go back to turn ${last.week}, as it was before Advance turn: territories, projects, the Tactical Action and anything revealed.</p>`
      + "<p>Changes made to those territories and projects since then go back too. Logistics and Intel are not touched; undo any ledger lines yourself.</p>",
    rejectClose: false
  });
  return ok ? undoTurn() : null;
}

/**
 * The turn report (step 4): the plan for the new week, line by line, before anything is
 * saved. Automatic GENESIS: every line ticked. Manual: the GENESIS lines start unticked,
 * as suggestions, and the GM ticks or changes territories by hand. Projects are ticked
 * either way, as they are the ODR's, not GENESIS's.
 */
export class TurnReport extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-turn-report",
    classes: ["irop", "irop-turn-report"],
    window: { title: "Advance turn", icon: "fa-solid fa-forward-step", resizable: true },
    // 60px wider for the larger text (Johnald, 2026-10-10).
    position: { width: 640, height: "auto" },
    actions: {
      apply: TurnReport.#onApply,
      replan: TurnReport.#onReplan,
      cancel: TurnReport.#onCancel
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/turn-report.hbs", scrollable: [".tr-body"] }
  };

  static #instance = null;

  plan = null;

  ticked = new Set();

  /** Where each Dark Event drawn hits, by line (step 6). */
  choices = new Map();

  static open() {
    if ( !game.user?.isGM ) return null;
    this.#instance ??= new this();
    this.#instance.replan();
    return this.#instance.render({ force: true });
  }

  /**
   * Plan afresh from the world as it is now. Step 6: the cards' lines are ticked either
   * way (the doc deals them; they are not GENESIS's choices), and of the Dark Events
   * drawn, the first darkEventKeep are ticked for the GM to change.
   */
  replan(plan = currentPlan()) {
    this.plan = plan;
    const automatic = genesisAutomatic();
    const genesis = ["growth", "strength", "heat"];
    const keep = Math.max(0, Math.round(Number(getStrategyRules().darkEventKeep) || 0));
    const dark = plan.lines.filter(l => l.section === "dark").slice(0, keep).map(l => l.id);
    this.ticked = new Set([
      ...plan.lines.filter(l => !l.hidden && (l.section !== "dark") && (automatic || !genesis.includes(l.section))).map(l => l.id),
      ...dark
    ]);
    this.choices = new Map();
  }

  /** @override */
  async _prepareContext(options) {
    const plan = this.plan;
    const visible = plan.lines.filter(l => !l.hidden);
    const territories = Object.fromEntries((game.items?.filter(i => i.type === "territory") ?? []).sort(byName).map(t => [t.id, t.name]));
    const keep = Math.max(0, Math.round(Number(getStrategyRules().darkEventKeep) || 0));
    return {
      territories,
      keep,
      week: plan.week,
      from: plan.week - 1,
      automatic: genesisAutomatic(),
      sections: Object.entries(SECTIONS).map(([key, label]) => ({
        key, label,
        lines: visible.filter(l => l.section === key).map(l => ({
          ...l, ticked: this.ticked.has(l.id), img: l.card?.img ?? "",
          pick: (l.card?.op === "dark") && l.card.needsTerritory, where: this.choices.get(l.id) ?? "",
          places: Object.fromEntries(Object.entries(territories).filter(([id]) => !(l.card?.excluded ?? []).includes(id)))
        }))
      })).filter(s => s.lines.length),
      due: plan.due,
      warnings: plan.warnings,
      quiet: !visible.length,
      // The calendar (2026-10-08): where the date goes when the turn starts.
      dateLine: (() => {
        const days = turnDays();
        if ( !days ) return "";
        return `The date moves on ${days} day${days === 1 ? "" : "s"}, to ${dateInfo(worldTime() + (days * SECONDS_PER_DAY)).long}.`;
      })()
    };
  }

  /** Ticking a line keeps it; nothing else redraws. @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    for ( const box of this.element.querySelectorAll("input[data-line]") ) {
      box.addEventListener("change", () => {
        if ( box.checked ) this.ticked.add(box.dataset.line);
        else this.ticked.delete(box.dataset.line);
      });
    }
    for ( const select of this.element.querySelectorAll("select[data-where]") ) {
      select.addEventListener("change", () => this.choices.set(select.dataset.where, select.value));
    }
  }

  static async #onApply() {
    // The Dark Events used: no more than the rules allow, one Reprisal, each placed (doc).
    const used = this.plan.lines.filter(l => (l.card?.op === "dark") && this.ticked.has(l.id))
      .map(l => ({ card: l.card, territory: this.choices.get(l.id) ?? "" }));
    const why = checkDarkChoice(used, getStrategyRules(), reprisalInPlay());
    if ( why ) return ui.notifications.warn(why);
    const done = await applyTurn(this.plan, this.ticked, this.choices);
    if ( done ) return this.close();
    return null;
  }

  static #onReplan() {
    this.replan();
    return this.render();
  }

  static #onCancel() {
    return this.close();
  }
}

/* -------------------------------------------- */
/*  The project strip on a War Room map         */
/* -------------------------------------------- */

/** The strip along the bottom of a War Room map: every slot at a glance, a click opens its tab. */
export class ProjectStrip extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-project-strip",
    classes: ["irop", "irop-project-strip"],
    window: { frame: false, positioned: true },
    position: { width: "auto", height: "auto" },
    actions: { open: (event, target) => OdrBoard.open(target.dataset.tab) }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/project-strip.hbs" }
  };

  static #instance = null;

  static show() {
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  static hide() {
    if ( this.#instance?.rendered ) this.#instance.close({ animate: false });
  }

  static refresh() {
    if ( this.#instance?.rendered ) this.#instance.render();
  }

  /** @override */
  async _prepareContext(options) {
    const rules = getStrategyRules();
    const isGM = !!game.user?.isGM;
    const active = worldProjects().filter(i => (i.system.status === "active") && (isGM || (i.system.status !== "hidden")));
    const chip = item => {
      const weekly = weeklyProgress(item.system, soldierOf, rules);
      return { name: item.name, pct: item.system.percent, progress: item.system.progress, cost: item.system.cost, weekly: weekly.total };
    };
    const of = kind => active.filter(i => i.system.kind === kind).sort(byName).map(chip);
    const intel = term => active.find(i => (i.system.kind === "intelligence") && (i.system.term === term));
    const t = getWarRoom().tactical;
    return {
      research: of("research")[0] ?? null,
      engineering: of("engineering"),
      engineeringFree: Math.max(0, Math.round(Number(rules.engineeringSlots) || 1) - of("engineering").length),
      short: intel("short") ? chip(intel("short")) : null,
      long: intel("long") ? chip(intel("long")) : null,
      tactical: t ? { label: t.label, where: game.items?.get(t.territory)?.name ?? "", status: { chosen: "chosen", briefed: "deployed", done: "done" }[t.status] ?? "" } : null
    };
  }

  /** Centred along the bottom, above the hotbar. @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const width = this.element.offsetWidth || 600;
    const height = this.element.offsetHeight || 40;
    this.setPosition({ left: Math.max(10, Math.round((window.innerWidth - width) / 2)), top: Math.max(10, window.innerHeight - height - 84) });
  }
}

/* -------------------------------------------- */

/** A banner across the screen as a new week starts (the "somewhat videogamish" touch). */
export function showWeekBanner(week, phase = "ODR phase") {
  const body = globalThis.document?.body;
  if ( !body ) return null;
  body.querySelector(".irop-week-banner")?.remove();
  const banner = document.createElement("div");
  banner.className = "irop irop-week-banner";
  banner.innerHTML = `<span class="wb-week">Turn ${Number(week) || 1}</span><span class="wb-phase">${phase}</span>`;
  body.append(banner);
  setTimeout(() => banner.remove(), 3200);
  return banner;
}

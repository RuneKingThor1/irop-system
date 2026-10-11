/**
 * The Strategy Layer's turn and ODR phase against a small fake world (steps 4 and 5,
 * 2026-10-08). Run: node test/strategy.test.mjs
 *
 * Loads Foundry's real data layer for the item models, and stands in for the rest:
 * world settings in a map, items and actors in lists, chat messages collected. Then
 * drives the real actions: start, staff, spend on and finish projects, choose, brief
 * and debrief a Tactical Action, advance the week and take it back.
 */
const COMMON = "file:///C:/Program%20Files/Foundry%20Virtual%20Tabletop/resources/app/common/server.mjs";
const foundryCommon = await import(COMMON);
globalThis.foundry = {
  ...foundryCommon,
  applications: { handlebars: { renderTemplate: async (path, data) => JSON.stringify({ path, data }) } }
};
globalThis.CONST = foundryCommon.CONST;

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if ( cond ) pass++;
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

/* -------------------------------------------- */
/*  The fake world                              */
/* -------------------------------------------- */

const store = new Map();
const warnings = [];
const chat = [];
globalThis.ui = { notifications: { warn: m => warnings.push(m), info() {}, error: m => warnings.push(m) } };
globalThis.Hooks = { callAll() {} };
globalThis.ChatMessage = { implementation: { create: async data => { chat.push(data); return data; } } };
globalThis.game = {
  user: { id: "gm", isGM: true, name: "Gamemaster" },
  users: { activeGM: { id: "gm" }, get: id => ({ gm: game.user, p1: player }[id]) },
  settings: {
    get(scope, key) {
      if ( store.has(key) ) return foundry.utils.deepClone(store.get(key));
      return { warRoom: {}, resourceLedger: [], turnHistory: [], revealedActions: [], missionLog: [], strategyRules: {}, genesisAutomatic: true }[key];
    },
    async set(scope, key, value) { store.set(key, foundry.utils.deepClone(value)); return value; }
  }
};
const player = { id: "p1", isGM: false, name: "Johnald", character: { name: "Kael" } };
// Foundry's clock (the calendar, 2026-10-08): 1 January 2040, 08:00.
const START = ((2040 * 365) + 495) * 86400 + (8 * 3600);
game.time = {
  worldTime: START,
  async advance(seconds) { this.worldTime += seconds; return this.worldTime; },
  async set(seconds) { this.worldTime = seconds; return seconds; }
};

const { IROP } = await import("../module/config.mjs");
const items = await import("../module/data/item.mjs");

/** A world item: its system a real data model, updates rebuilt through it. */
function makeItem(id, name, type, system) {
  const Model = { territory: items.TerritoryData, project: items.ProjectData }[type];
  const doc = { id, name, type, img: "x.svg", parent: null };
  doc.system = new Model(system);
  doc.update = async changes => {
    const src = { system: doc.system.toObject() };
    for ( const [path, value] of Object.entries(changes) ) foundry.utils.setProperty(src, path, foundry.utils.deepClone(value));
    doc.system = new Model(src.system);
    return doc;
  };
  return doc;
}
const world = [];
const collection = list => Object.assign(list, { get: id => list.find(d => d.id === id) ?? null, has: id => list.some(d => d.id === id) });
game.items = collection(world);
globalThis.Item = { updateDocuments: async updates => { for ( const { _id, ...rest } of updates ) await game.items.get(_id)?.update(rest); return updates; } };

const kael = {
  id: "k", name: "Kael", type: "operative",
  system: { attributes: { int: { mod: 4 }, str: { mod: 5 }, cha: { mod: 3 }, agi: { mod: 2 } }, skills: { tactics: { rank: 2 }, persuasion: { rank: 3 }, stealth: { rank: 1 } } },
  testUserPermission: user => user.isGM || (user.id === "p1")
};
const vex = { id: "v", name: "Vex", type: "operative", system: { attributes: { int: { mod: 3 } }, skills: {} }, testUserPermission: user => user.isGM };
game.actors = collection([kael, vex]);

world.push(
  makeItem("ns", "Neo Seattle", "territory", { kind: "megacity", strength: 6, heat: 2, quietWeeks: 1, neighbors: ["rh"] }),
  makeItem("rh", "Redwood Havens", "territory", { kind: "rural", strength: 3, heat: 1, neighbors: ["ns"] }),
  makeItem("ar", "Armory Refit", "project", { kind: "research", cost: 100, specialization: ["tactics"], unlocks: "Weapon Modifications" }),
  makeItem("xr", "Xeno Studies", "project", { kind: "research", cost: 80, specialization: ["tactics", "biology"] }),
  makeItem("lg", "Locate GENESIS Assets", "project", { kind: "intelligence", term: "long", cost: 20, territory: "ns", reveals: "Strike the GENESIS asset" }),
  makeItem("hd", "Secret Project", "project", { kind: "research", status: "hidden", cost: 40 })
);

const settings = await import("../module/settings.mjs");
const socket = await import("../module/socket.mjs");
const odr = await import("../module/strategy/odr.mjs");
const turn = await import("../module/strategy/turn.mjs");
odr.registerOdrActions();
const get = id => game.items.get(id);

/* -------------------------------------------- */
/*  Run                                         */
/* -------------------------------------------- */

// As the GM: Logistics to spend.
await settings.recordResource({ resource: "logistics", amount: 50, reason: "Starting stock" });
await settings.recordResource({ resource: "intel", amount: 5, reason: "Starting stock" });

// Research: start, switch, staff.
await socket.asGM("project.start", { id: "ar" });
check("odr: research starts", get("ar").system.status === "active");
await socket.asGM("project.assign", { id: "ar", actor: "k" });
check("odr: an operative works it with their best skill", get("ar").system.assigned.map(a => `${a.actor}:${a.skill}`).join() === "k:tactics");
await socket.asGM("project.start", { id: "xr" });
check("odr: starting another research switches; the soldier follows if they can work it",
  get("ar").system.status === "available" && get("ar").system.assigned.length === 0
    && get("xr").system.status === "active" && get("xr").system.assigned.map(a => a.actor).join() === "k");
await socket.asGM("project.start", { id: "ar" });
warnings.length = 0;
await socket.asGM("project.assign", { id: "ar", actor: "v" });
check("odr: an operative without the skills is refused, and told which skills", /Vex has none of the skills Armory Refit takes \(Tactics\)/.test(warnings[0]), warnings.join());
warnings.length = 0;
await socket.asGM("project.start", { id: "hd" });
check("odr: a hidden project does not start", /not open yet/.test(warnings[0]) && get("hd").system.status === "hidden");

// Spending: Logistics to the ledger, progress to the project.
await socket.asGM("project.spend", { id: "ar", amount: 30 });
check("odr: spending moves the project and the ledger",
  get("ar").system.progress === 30 && settings.getWarRoom().logistics === 20 && settings.getLedger().at(-1).reason === "Research: Armory Refit");
warnings.length = 0;
await socket.asGM("project.spend", { id: "ar", amount: 25 });
check("odr: spending more than the stock is refused", /25 Logistics; 20 in stock/.test(warnings[0]) && get("ar").system.progress === 30, warnings.join());

// Intelligence: spend Intel to finish it; it reveals a Tactical Action and tells the table.
await socket.asGM("project.start", { id: "lg" });
warnings.length = 0;
await socket.asGM("project.spend", { id: "lg", amount: 99 });
check("odr: a spend is capped at what is left to pay, then checked against the stock",
  get("lg").system.progress === 0 && /20 Intel; 5 in stock/.test(warnings[0]), warnings.join());
store.set("resourceLedger", [...settings.getLedger(), { id: "x1", week: 1, resource: "intel", amount: 20, reason: "Interrogation" }]);
chat.length = 0;
await socket.asGM("project.spend", { id: "lg", amount: 99 });
check("odr: an Intelligence Action paid off completes, frees its soldiers, and reveals its Tactical Action",
  get("lg").system.status === "complete" && settings.getList("revealedActions")[0]?.label === "Strike the GENESIS asset"
    && settings.getList("revealedActions")[0].territory === "ns" && chat.length === 1 && /project-complete/.test(chat[0].content));
check("odr: only what was owed was spent", settings.getWarRoom().intel === 5, String(settings.getWarRoom().intel));

// The Tactical Action: choose the revealed one, brief, debrief.
const revealed = settings.getList("revealedActions")[0];
await socket.asGM("tactical.choose", { key: revealed.id, territory: "rh" });
let t = settings.getWarRoom().tactical;
check("odr: a revealed action is taken where it was found", t?.label === "Strike the GENESIS asset" && t.territory === "ns" && t.status === "chosen" && t.revealed);
warnings.length = 0;
await socket.asGM("tactical.choose", { key: "ambushPatrols", territory: "rh" });
check("odr: a chosen action can be changed until briefed", settings.getWarRoom().tactical.key === "ambushPatrols");
await socket.asGM("tactical.clear");
await socket.asGM("tactical.choose", { key: revealed.id, territory: "" });
chat.length = 0;
await odr.briefMission();
t = settings.getWarRoom().tactical;
check("odr: the briefing goes to chat and locks the choice", t.status === "briefed" && /mission-brief/.test(chat[0]?.content));
const brief = odr.briefingContext(t, get("ns"), { rules: settings.getStrategyRules(), week: 1 });
check("odr: the briefing reads the territory: Heat, Strength band, Reputation",
  brief.heat === "Medium" && /Alien and GENESIS units/.test(brief.heatResponse) && brief.band === "Moderate" && brief.reputation === "0 Neutral" && brief.kind === "Megacity");
warnings.length = 0;
await socket.asGM("tactical.choose", { key: "ambushPatrols", territory: "rh" });
check("odr: once briefed it cannot be swapped", /already under way/.test(warnings[0]));

const before = settings.getWarRoom().logistics;
await odr.debriefMission({ outcome: "success", logistics: 15, intel: 4, heat: "major", reputation: 1, salvage: 1, notes: "Clean exit" });
t = settings.getWarRoom().tactical;
const ns = get("ns").system;
check("odr: the debrief lands: Logistics and Intel in, Heat waiting for next turn, Reputation up, activity marked",
  settings.getWarRoom().logistics === before + 15 && settings.getWarRoom().intel === 9 && ns.heatPending === 2 && ns.reputation === 1 && ns.active === true);
check("odr: salvage goes to the research under way (30% of 100)", get("ar").system.progress === 60 && get("ar").system.salvage === 1, String(get("ar").system.progress));
check("odr: the mission is logged, the revealed action used up, the week's action done",
  settings.getList("missionLog")[0]?.label === "Strike the GENESIS asset" && settings.getList("missionLog")[0].outcome === "success"
    && !settings.getList("revealedActions").length && t.status === "done");

// Advance week: the plan, applied, then undone.
const plan = turn.currentPlan();
const ticked = new Set(plan.lines.filter(l => !l.hidden).map(l => l.id));
check("turn: the plan picks up the debrief's Heat and the research's progress",
  plan.lines.some(l => l.text === "Neo Seattle: Heat Medium to Maximum") && plan.lines.some(l => /Research: Armory Refit, 60 to 84 of 100/.test(l.text)),
  plan.lines.map(l => l.text).join(" | "));
chat.length = 0;
await turn.applyTurn(plan, ticked);
check("turn: applied: turn 2, ODR phase, no Tactical Action yet",
  settings.getWarRoom().week === 2 && settings.getWarRoom().phase === "odr" && settings.getWarRoom().tactical === null);
check("turn: applied: Heat landed, pending cleared, activity cleared, research moved",
  get("ns").system.heat === 4 && get("ns").system.heatPending === 0 && get("ns").system.active === false && get("ar").system.progress === 84);
check("turn: a week report goes to chat", chat.some(m => /week-report/.test(m.content)));
check("calendar: the turn moved the date on a week, and the report carries the new date",
  game.time.worldTime === START + (7 * 86400) && chat.some(m => /week-report/.test(m.content) && m.content.includes('"date":"Sunday, 8 January 2040"')));
check("turn: Undo is offered for turn 2", turn.lastTurn()?.to === 2);
warnings.length = 0;
check("turn: an old report cannot be applied twice", (await turn.applyTurn(plan, ticked)) === null && /turn 2 now/.test(warnings[0]));
await turn.undoTurn();
check("turn: undone: turn 1 again with its debriefed action, territories and research as they were",
  settings.getWarRoom().week === 1 && settings.getWarRoom().tactical?.status === "done" && get("ns").system.heat === 2
    && get("ns").system.heatPending === 2 && get("ns").system.active === true && get("ar").system.progress === 60);
check("turn: nothing more to undo", turn.lastTurn() === null);
check("calendar: undoing the turn took the week back off the date", game.time.worldTime === START);

// A player's requests, as the GM's client receives them over the socket.
let listener = null;
const replies = [];
game.socket = { on: (channel, fn) => { listener = fn; }, emit: (channel, data) => replies.push(data) };
socket.initSocket();
await socket.asGM("project.unassign", { id: "ar", actor: "k" });
await listener({ action: "project.assign", payload: { id: "ar", actor: "v" }, userId: "p1" });
check("socket: the GM's client refuses a player assigning someone else's operative, and tells them",
  replies.at(-1)?.reply && replies.at(-1).userId === "p1" && /Vex is not yours to assign/.test(replies.at(-1).message) && !get("ar").system.assigned.length);
await listener({ action: "project.assign", payload: { id: "ar", actor: "k" }, userId: "p1" });
check("socket: a player assigns their own operative", get("ar").system.assigned.map(a => a.actor).join() === "k");
await settings.setWarRoom({ tactical: { key: "ambushPatrols", label: "Ambush Patrols", territory: "rh", status: "briefed" } });
replies.length = 0;
await listener({ action: "tactical.clear", payload: {}, userId: "p1" });
check("socket: a player cannot put back a briefed mission", /already briefed/.test(replies.at(-1)?.message ?? "") && settings.getWarRoom().tactical?.status === "briefed");
await listener({ action: "project.spend", payload: { id: "ar", amount: 5 }, userId: "p1" });
check("socket: a player's spend is signed with their character in the ledger", settings.getLedger().at(-1).reason === "Research: Armory Refit (Kael)");
replies.length = 0;
game.user = { id: "gm2", isGM: true, name: "Second GM" };
await listener({ action: "project.spend", payload: { id: "ar", amount: 5 }, userId: "p1" });
check("socket: only the active GM answers", !replies.length && settings.getLedger().at(-1).reason === "Research: Armory Refit (Kael)" && get("ar").system.progress === 65);

// A player's own client sends instead of acting.
game.user = player;
const sent = [];
game.socket = { on() {}, emit: (channel, data) => sent.push([channel, data]) };
await socket.asGM("project.start", { id: "xr" });
check("socket: a player's action goes to the GM over the system channel", sent[0]?.[0] === "system.irop" && sent[0][1].action === "project.start" && sent[0][1].userId === "p1");
game.users.activeGM = null;
warnings.length = 0;
await socket.asGM("project.start", { id: "xr" });
check("socket: with no GM online the player is told", /No GM is connected/.test(warnings[0]));

/* -------------------------------------------- */
/*  Event and Dark Event cards (step 6)         */
/* -------------------------------------------- */

{
  game.user = { id: "gm", isGM: true, name: "Gamemaster" };
  game.users.activeGM = { id: "gm" };
  const { EventCardData } = await import("../module/data/card.mjs");
  const events = await import("../module/strategy/events.mjs");

  // Card stacks that pass cards the way Foundry's Cards#pass does (client/documents/cards.mjs).
  class FakeCard {
    constructor(data, parent) {
      Object.assign(this, {
        id: data._id ?? foundry.utils.randomID(), name: data.name, type: data.type ?? "base", description: data.description ?? "",
        faces: foundry.utils.deepClone(data.faces ?? []), face: data.face ?? null, back: data.back ?? {}, drawn: !!data.drawn,
        flags: foundry.utils.deepClone(data.flags ?? {}), parent
      });
      this.origin = data.origin ? game.cards.get(data.origin) : null;
      this.system = new EventCardData(data.system ?? {});
    }
    get isHome() { return (this.parent.type === "deck") || (this.origin === this.parent); }
    get img() { return this.faces[0]?.img ?? ""; }
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
    toObject() {
      return { _id: this.id, name: this.name, type: this.type, description: this.description, faces: foundry.utils.deepClone(this.faces),
        face: this.face, back: this.back, drawn: this.drawn, flags: foundry.utils.deepClone(this.flags), origin: this.origin?.id ?? null,
        system: this.system.toObject() };
    }
  }
  class FakeCards {
    constructor(data) {
      Object.assign(this, { id: foundry.utils.randomID(), name: data.name, type: data.type, flags: foundry.utils.deepClone(data.flags ?? {}), ownership: data.ownership });
      this.cards = collection([]);
      Object.defineProperty(this.cards, "contents", { get: () => [...this.cards] });
      Object.defineProperty(this.cards, "size", { get: () => this.cards.length });
    }
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
    get availableCards() { return this.cards.filter(c => (this.type !== "deck") || !c.drawn); }
    async createEmbeddedDocuments(type, data) { const made = data.map(d => new FakeCard(d, this)); this.cards.push(...made); return made; }
    async deleteEmbeddedDocuments(type, ids) { for ( const id of ids ) this.cards.splice(this.cards.findIndex(c => c.id === id), 1); }
    async updateEmbeddedDocuments(type, updates) { for ( const { _id, ...u } of updates ) Object.assign(this.cards.get(_id), u); }
    async shuffle() { return this; }
    async pass(to, ids, { updateData = {} } = {}) {
      const toCreate = [];
      const toUpdate = [];
      const fromUpdate = [];
      const fromDelete = [];
      for ( const id of ids ) {
        const card = this.cards.get(id);
        const deletedFromOrigin = card.origin && !card.origin.cards.get(id);
        if ( (this.type === "deck") && card.isHome && card.drawn ) throw new Error("already drawn");
        if ( (card.origin === to) && !deletedFromOrigin ) toUpdate.push({ _id: card.id, drawn: false });
        else {
          const createData = foundry.utils.mergeObject(card.toObject(), updateData);
          const copyCard = card.isHome && (to.type === "deck");
          if ( copyCard ) createData.origin = to.id;
          else if ( card.isHome || !createData.origin ) createData.origin = this.id;
          createData.drawn = !copyCard && !deletedFromOrigin;
          toCreate.push(createData);
        }
        if ( card.isHome && (to.type !== "deck") ) fromUpdate.push({ _id: card.id, drawn: true });
        else if ( !card.isHome ) fromDelete.push(card.id);
      }
      const created = await to.createEmbeddedDocuments("Card", toCreate);
      await to.updateEmbeddedDocuments("Card", toUpdate);
      await this.updateEmbeddedDocuments("Card", fromUpdate);
      await this.deleteEmbeddedDocuments("Card", fromDelete);
      return created;
    }
  }
  game.cards = collection([]);
  globalThis.CONFIG = { Cards: { documentClass: { create: async data => { const c = new FakeCards(data); game.cards.push(c); return c; } } } };
  const fs = await import("node:fs");
  const examples = JSON.parse(fs.readFileSync(new URL("../assets/data/event-cards.json", import.meta.url), "utf8"));
  globalThis.fetch = async () => ({ ok: true, json: async () => examples });
  const S = role => events.stack(role);
  const names = role => S(role).cards.map(c => c.name).sort().join();
  const findIn = (role, name) => S(role).cards.find(c => c.name === name);

  // Set up: five stacks, the examples in their decks.
  await events.importEventCards({ confirm: false });
  check("cards: five stacks, found by their flags; in play and discard open to players",
    events.decksReady() && game.cards.length === 6 && S("inPlay").ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
      && S("darkDeck").ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE);
  check("cards: the six examples are in their decks, as event cards with their rules",
    names("eventDeck") === "Distress Call,Supply Drop,Uprising" && names("darkDeck") === "Crackdown,GENESIS Propaganda,Reprisal"
      && findIn("darkDeck", "Reprisal").system.reprisal && findIn("eventDeck", "Supply Drop").system.effect.logistics === 10
      && findIn("darkDeck", "Crackdown").img === "icons/svg/padlock.svg" && findIn("darkDeck", "Crackdown").back.img === IROP.cardKinds.dark.back);
  await events.importEventCards({ confirm: false });
  check("cards: importing again adds nothing twice", S("eventDeck").cards.length === 3);

  // Turn 3 ends: turn 4 has the Event phase and the Dark Events.
  world.push(makeItem("pl", "Portlandia", "territory", { kind: "wildland", strength: 2, heat: 0 }));
  store.set("warRoom", { week: 3, phase: "odr", tactical: null });
  const logisticsBefore = settings.getWarRoom().logistics;
  const repBefore = Object.fromEntries(["ns", "rh", "pl"].map(id => [id, get(id).system.reputation]));
  const plan = turn.currentPlan();
  const lines = s => plan.lines.filter(l => l.section === s);
  check("cards: Advance week deals three Events to three territories and draws three Dark Events",
    lines("events").length === 3 && new Set(lines("events").map(l => l.card.territory)).size === 3 && lines("dark").length === 3 && !plan.due.length);
  const dark = name => lines("dark").find(l => l.text === name);
  const ticked = new Set([...plan.lines.filter(l => l.section !== "dark").map(l => l.id), dark("GENESIS Propaganda").id, dark("Reprisal").id]);
  const choices = new Map([[dark("GENESIS Propaganda").id, "rh"], [dark("Reprisal").id, "ns"]]);
  await turn.applyTurn(plan, ticked, choices);
  const distress = findIn("inPlay", "Distress Call");
  check("cards: the persistent Event stays in play on its territory, marked with the week",
    !!distress && distress.getFlag("irop", "week") === 4 && ["ns", "rh", "pl"].includes(distress.getFlag("irop", "territory")) && distress.face === 0);
  check("cards: instant Events are discarded once applied; the deck's cards are marked drawn",
    names("discard").includes("Supply Drop") && S("eventDeck").availableCards.length === 0);
  const madeHere = settings.getLedger().filter(e => /^(Event|World Event|Dark Event): /.test(e.reason) && (e.resource === "logistics"));
  check("cards: the Supply Drop's Logistics are in the ledger, and the stock is what the cards made",
    madeHere.some(e => /^Event: Supply Drop, /.test(e.reason) && (e.amount === 10))
      && settings.getWarRoom().logistics === logisticsBefore + madeHere.reduce((n, e) => n + e.amount, 0));
  check("cards: a World Event comes with the Event phase", plan.lines.some(l => (l.section === "world") && (l.card.from === "worldDeck"))
    && (S("worldDeck").availableCards.length === 1));
  check("cards: the Dark Events used: Propaganda's Reputation lands where chosen, the Reprisal stays in play there",
    get("rh").system.reputation === Math.max(-2, Math.min(2, repBefore.rh - 1 + plan.lines.filter(l => ticked.has(l.id) && (l.section !== "dark"))
      .flatMap(l => l.ops).filter(o => (o.id === "rh") && (o.path === "system.reputation")).reduce((n, o) => n + o.delta, 0)))
      && findIn("inPlay", "Reprisal")?.getFlag("irop", "territory") === "ns"
      && findIn("inPlay", "Reprisal").getFlag("irop", "kind") === "dark");
  check("cards: the Dark Event not used is discarded", names("discard").includes("Crackdown") && names("discard").includes("GENESIS Propaganda"));
  check("cards: what can be answered is offered as a Tactical Action",
    events.responseChoices().map(c => c.label).sort().join() === "Respond: Distress Call,Respond: Reprisal" && events.reprisalInPlay());
  check("cards: the week card shows the cards dealt", chat.some(m => /week-report/.test(m.content) && /"cards":\[\{/.test(m.content)));

  await turn.undoTurn();
  check("cards: Undo puts every card back and takes back their ledger lines",
    !S("inPlay").cards.length && !S("discard").cards.length && S("eventDeck").availableCards.length === 3 && S("darkDeck").availableCards.length === 3
      && S("worldDeck").availableCards.length === 2
      && settings.getWarRoom().logistics === logisticsBefore && settings.getWarRoom().week === 3 && get("rh").system.reputation === repBefore.rh);

  // Again, this time keeping Crackdown (discretionary) for the GENESIS hand.
  const plan2 = turn.currentPlan();
  const dark2 = name => plan2.lines.find(l => (l.section === "dark") && (l.text === name));
  await turn.applyTurn(plan2, new Set([...plan2.lines.filter(l => l.section !== "dark").map(l => l.id), dark2("Crackdown").id, dark2("Reprisal").id]),
    new Map([[dark2("Reprisal").id, "ns"]]));
  check("cards: a discretionary Dark Event waits in the GENESIS hand", names("darkHand") === "Crackdown" && findIn("darkHand", "Crackdown").getFlag("irop", "week") === 4);
  warnings.length = 0;
  await events.playHeld(findIn("darkHand", "Crackdown").id, "");
  check("cards: playing one that hits a territory needs the territory", /Choose where Crackdown hits/.test(warnings[0]) && names("darkHand") === "Crackdown");
  // Never in (2026-10-08): not on a territory the card lists.
  const crackdown = findIn("darkHand", "Crackdown");
  const crackdownSystem = crackdown.system;
  crackdown.system = new EventCardData({ ...crackdownSystem.toObject(), excluded: ["pl"] });
  warnings.length = 0;
  await events.playHeld(crackdown.id, "pl");
  check("cards: a Dark Event is not played where it never happens", /Crackdown never happens in Portlandia/.test(warnings[0]) && names("darkHand") === "Crackdown", warnings.join());
  crackdown.system = crackdownSystem;
  const strengthBefore = get("pl").system.strength;
  const pendingBefore = get("pl").system.heatPending;
  chat.length = 0;
  await events.playHeld(findIn("darkHand", "Crackdown").id, "pl");
  check("cards: played, its numbers land and it is discarded, with a card in chat",
    get("pl").system.strength === Math.min(10, strengthBefore + 1) && get("pl").system.heatPending === pendingBefore + 1 && !S("darkHand").cards.length
      && names("discard").includes("Crackdown") && /event-card/.test(chat[0]?.content));

  // Respond to the Reprisal and counter it at the debrief: it leaves play without its 20 Logistics.
  const reprisal = findIn("inPlay", "Reprisal");
  await socket.asGM("tactical.choose", { key: `card:${reprisal.id}`, territory: "" });
  check("cards: the response is taken where the card is", settings.getWarRoom().tactical?.territory === "ns" && settings.getWarRoom().tactical.response);
  const before = settings.getWarRoom().logistics;
  await odr.debriefMission({ outcome: "success", heat: "minor", reputation: 1, countered: true });
  check("cards: a successful response counters it: out of play, no discard effect, logged",
    !findIn("inPlay", "Reprisal") && settings.getWarRoom().logistics === before && settings.getList("missionLog").at(-1).countered === "Reprisal");

  // Discarding with the effect.
  const dc = findIn("inPlay", "Distress Call");
  const where = dc.getFlag("irop", "territory");
  const rep = get(where).system.reputation;
  await events.discardInPlay(dc.id, { apply: true });
  check("cards: discarded with its effect: Reputation -1 there, the card in the discard",
    get(where).system.reputation === Math.max(-2, rep - 1) && !findIn("inPlay", "Distress Call") && names("discard").includes("Distress Call"));

  // Reshuffle: the Event discards go back in; the Dark ones stay.
  const back = await events.reshuffle("event");
  check("cards: reshuffling puts a deck's discards back in, only that deck's, and not what is still in play",
    back === 2 && S("eventDeck").availableCards.length === 2 && !S("discard").cards.some(c => c.origin === S("eventDeck"))
      && S("discard").cards.filter(c => c.origin === S("darkDeck")).length === 3 && !!findIn("inPlay", "Uprising"), String(back));

  // A persistent card (Uprising, dealt in turn 4) leaves at the end of the next turn.
  const p5 = turn.currentPlan();
  check("cards: one week later it is still in play", !p5.lines.some(l => /Uprising leaves/.test(l.text)));
  await turn.applyTurn(p5, new Set(p5.lines.map(l => l.id)));
  const p6 = turn.currentPlan();
  const leaving = p6.lines.find(l => /^Uprising leaves /.test(l.text));
  check("cards: at the end of the next turn it leaves, with its discard effect", !!leaving && /Heat \+1 next turn/.test(leaving.detail));
  delete globalThis.fetch;
}

/* -------------------------------------------- */
/*  Losing Ground (step 7)                      */
/* -------------------------------------------- */

{
  game.user = { id: "gm", isGM: true, name: "Gamemaster" };
  game.users.activeGM = { id: "gm" };
  const lg = await import("../module/strategy/losing-ground.mjs");
  const events = await import("../module/strategy/events.mjs");
  // A fresh corner of the map: a Megacity with slums and wildland, a second Megacity, a farm.
  for ( const id of ["ns", "rh", "pl"] ) await get(id).update({ "system.control": "liberated" });   // earlier tests' territories, out of the way
  world.push(
    makeItem("mc", "Neo Denver", "territory", { kind: "megacity", strength: 6, heat: 2, neighbors: ["s1", "w1", "mc2"], landmark: "Mile High Spire", landmarkBonus: "+5 Logistics a week" }),
    makeItem("s1", "Aurora Slums", "territory", { kind: "slums", strength: 3, heat: 1, neighbors: ["mc", "far"] }),
    makeItem("w1", "Front Range", "territory", { kind: "wildland", strength: 1, neighbors: ["mc"] }),
    makeItem("mc2", "Neo Cheyenne", "territory", { kind: "megacity", strength: 5, heat: 3, neighbors: ["mc"] }),
    makeItem("far", "Plains Havens", "territory", { kind: "rural", strength: 2, heat: 1, neighbors: ["s1"] }),
    makeItem("sam2", "SAM Site North", "project", { kind: "engineering", builds: "regional", status: "complete", cost: 60, progress: 60, territory: "mc2" })
  );
  store.set("warRoom", { week: 10, phase: "odr", tactical: null });
  store.set("incursions", []);
  store.set("turnHistory", []);

  // The Megacity assault: a Megacity only, its objectives by the debrief.
  warnings.length = 0;
  await socket.asGM("tactical.choose", { key: "megacityAssault", territory: "s1" });
  check("assault: only at a Megacity", /needs a Megacity\. Aurora Slums is Slums/.test(warnings[0]) && !settings.getWarRoom().tactical);
  await socket.asGM("tactical.choose", { key: "megacityAssault", territory: "mc" });
  check("assault: chosen at the Megacity", settings.getWarRoom().tactical?.megacity === true && settings.getWarRoom().tactical.heat === "critical");
  check("assault: the debrief offers the objectives still standing", odr.debriefDefaults(settings.getWarRoom().tactical).objectives.map(o => o.key).join() === "citadel,motorPool,government");
  let entry = await odr.debriefMission({ outcome: "success", heat: "critical", objective: "citadel" });
  check("assault: the objective taken lands on the Megacity", get("mc").system.objectives.citadel && entry.objective === "Military citadel" && !entry.liberates);
  await get("mc").update({ "system.objectives.motorPool": true });
  store.set("warRoom", { week: 10, phase: "odr", tactical: null });
  await socket.asGM("tactical.choose", { key: "megacityAssault", territory: "mc" });
  entry = await odr.debriefMission({ outcome: "success", heat: "critical", objective: "government" });
  check("assault: the third taken, the Megacity is ready to liberate", entry.liberates === true && /All three/.test(odr.debriefContext(entry).objectiveNote));
  store.set("warRoom", { week: 10, phase: "odr", tactical: null });
  warnings.length = 0;
  await socket.asGM("tactical.choose", { key: "megacityAssault", territory: "mc" });
  check("assault: none once all three are taken", /three objectives are taken/.test(warnings[0]));

  // Liberation: the Megacity and its surroundings freed, Heat spiking nearby, the table told.
  const context = lg.liberationContext(get("mc"));
  check("liberation: the dialog offers the Megacity and its surroundings, and shows the spike",
    context.area.map(a => a.id).join() === "mc,s1,w1" && context.area[0].fixed && context.spike.map(s => `${s.id}:${s.toLabel}`).join() === "mc2:Maximum,far:High", context.spike.map(s => `${s.id}:${s.toLabel}`).join());
  chat.length = 0;
  const result = await lg.liberate("mc", ["mc", "s1"]);
  check("liberation: the kept territories are liberated with no GENESIS Strength; one unticked stays",
    get("mc").system.control === "liberated" && get("mc").system.strength === 0 && get("s1").system.control === "liberated" && get("w1").system.control === "genesis");
  check("liberation: nearby Heat spikes", get("mc2").system.heat === 4 && get("far").system.heat === 3);
  check("liberation: a card for the table, with the landmark and the count", /liberation\.hbs/.test(chat[0]?.content) && /Mile High Spire/.test(chat[0].content)
    && /"liberated":2,"total":3/.test(chat[0].content) && chat.length === 1, chat[0]?.content);

  // An Incursion: Neo Cheyenne at Strength 8 beside liberated Neo Denver.
  await get("mc2").update({ "system.strength": 8 });
  const plan = turn.currentPlan();
  const opening = plan.lines.find(l => l.incursion?.op === "open" && l.incursion.target === "mc");
  check("incursion: Advance week launches it", opening?.text === "Incursion: GENESIS masses in Neo Cheyenne to retake Neo Denver");
  await turn.applyTurn(plan, new Set(plan.lines.filter(l => !l.hidden).map(l => l.id)));
  const inc = lg.incursions().find(i => i.target === "mc");
  check("incursion: under way, from where GENESIS massed, marked with the week", inc?.source === "mc2" && inc.week === 11 && !!lg.incursionAgainst("mc"));
  check("incursion: a high-priority Tactical Action where GENESIS massed",
    lg.incursionChoices().some(c => (c.id === `incursion:${inc.id}`) && (c.territory === "mc2") && c.priority));

  // Broken by a successful mission.
  await socket.asGM("tactical.choose", { key: `incursion:${inc.id}`, territory: "" });
  check("incursion: taken as the week's action", settings.getWarRoom().tactical?.incursion === inc.id && settings.getWarRoom().tactical.territory === "mc2");
  const before = get("mc2").system.strength;
  entry = await odr.debriefMission({ outcome: "success", heat: "major" });
  check("incursion: a success breaks it; where it massed loses 3 Strength",
    !lg.incursionAgainst("mc") && get("mc2").system.strength === before - 3 && entry.incursion === "broken");

  // Left alone, it lands; Undo takes it back.
  await get("mc2").update({ "system.strength": 9 });
  store.set("warRoom", { week: 11, phase: "odr", tactical: null });
  const p2 = turn.currentPlan();
  await turn.applyTurn(p2, new Set(p2.lines.filter(l => !l.hidden).map(l => l.id)));
  check("incursion: a new one launches once the old one is broken", lg.incursions().some(i => i.target === "mc"));
  const p3 = turn.currentPlan();
  const falls = p3.lines.find(l => l.incursion?.op === "land");
  check("incursion: unanswered, it lands the next turn", falls?.text === "Neo Denver falls: the Incursion from Neo Cheyenne lands");
  await turn.applyTurn(p3, new Set(p3.lines.filter(l => !l.hidden).map(l => l.id)));
  check("incursion: landed, Neo Denver is Contested with GENESIS Strength, its objectives lost, the Incursion over",
    get("mc").system.control === "contested" && get("mc").system.strength === 3 && !get("mc").system.objectives.citadel && !lg.incursionAgainst("mc"));
  await turn.undoTurn();
  check("incursion: Undo takes the landing back: liberated, objectives held, the Incursion under way",
    get("mc").system.control === "liberated" && get("mc").system.objectives.government && !!lg.incursionAgainst("mc"));

  // Victory: the last Megacity liberated.
  chat.length = 0;
  await get("ns").update({ "system.control": "liberated" });
  await get("mc2").update({ "system.objectives": { citadel: true, motorPool: true, government: true } });
  await lg.liberate("mc2", ["mc2"]);
  check("victory: the last Megacity liberated, the table is told", chat.length === 2 && /"victory":true/.test(chat[1].content) && /"liberated":3,"total":3/.test(chat[1].content));
  check("victory: an Incursion massing in a territory just freed is over", !lg.incursions().some(i => i.source === "mc2"));

  // A Reprisal that runs its course destroys a regional upgrade where it hit.
  const darkCard = events.stack("discard").cards.find(c => c.name === "Reprisal");
  await events.stack("discard").pass(events.stack("inPlay"), [darkCard.id], { updateData: { flags: { irop: { territory: "mc2", week: 10, kind: "dark" } } } });
  const inPlayReprisal = events.stack("inPlay").cards.find(c => c.name === "Reprisal");
  await events.discardInPlay(inPlayReprisal.id, { apply: true });
  check("reprisal: uncountered, the SAM Site where it hit is destroyed and back on the list",
    get("sam2").system.status === "available" && get("sam2").system.progress === 0);
}

// The calendar (2026-10-08): a GM who keeps the date apart from the turns, and off the Strategy Layer.
{
  store.set("calendarTurnDays", 0);
  store.set("calendarWarRoom", false);
  const before = game.time.worldTime;
  const p = turn.currentPlan();
  chat.length = 0;
  await turn.applyTurn(p, new Set(p.lines.filter(l => !l.hidden).map(l => l.id)));
  check("calendar: 0 days a turn leaves the date alone", game.time.worldTime === before && turn.lastTurn()?.days === 0);
  check("calendar: with the date off the Strategy Layer, the report shows none", chat.some(m => /week-report/.test(m.content) && m.content.includes('"date":""')));
  await turn.undoTurn();
  check("calendar: undoing that turn leaves the date alone too", game.time.worldTime === before);
  store.delete("calendarTurnDays");
  store.delete("calendarWarRoom");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

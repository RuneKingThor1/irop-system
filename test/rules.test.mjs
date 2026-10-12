/**
 * Rules core tests. Run: node test/rules.test.mjs
 * Pure Node, no Foundry. Checks the canon data points from the handoff and
 * that the port agrees with the Discord bot library symbol for symbol.
 */
import * as dyn from "../module/rules/dynosrs.mjs";
import * as combat from "../module/rules/combat.mjs";
import { pathToFileURL } from "node:url";
import * as trees from "../module/rules/skill-trees.mjs";
import * as strat from "../module/rules/strategy.mjs";
import * as wrm from "../module/rules/war-room-map.mjs";
import * as rsc from "../module/rules/resources.mjs";
import * as proj from "../module/rules/projects.mjs";
import * as turn from "../module/rules/turn.mjs";
import * as ev from "../module/rules/events.mjs";
import * as lg from "../module/rules/losing-ground.mjs";
import * as wx from "../module/rules/weather.mjs";
import { IROP } from "../module/config.mjs";

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if ( cond ) pass++;
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Canon symbol totals on every die.
check("canon totals", dyn.testTotals().length === 0, dyn.testTotals().join("; "));

// Canon pool examples, handoff Section 7, strict canon (no floor), with the
// 2026-10-06 renaming: the attribute's dice are Aptitude (d10), upgraded dice Skill (d12).
const strict = { minimumPoolDice: 0 };
let p = dyn.buildPool(4, 0, strict);
check("mod 4 rank 0 is 2 Aptitude", p.aptitude === 2 && p.skill === 0, JSON.stringify(p));
p = dyn.buildPool(5, 3, strict);
check("mod 5 rank 3 is 2 Skill + 1 Aptitude", p.skill === 2 && p.aptitude === 1, JSON.stringify(p));
p = dyn.buildPool(6, 3, strict);
check("mod 6 rank 3 is 3 Skill", p.skill === 3 && p.aptitude === 0, JSON.stringify(p));

// The rename moved names, not faces: Skill is the d12 with Victory, Aptitude the d10.
check("Skill is the d12 with Victory", dyn.DICE.skill.sides === 12 && dyn.DICE.skill.canonTotals.VICTORY === 1);
check("Aptitude is the d10", dyn.DICE.aptitude.sides === 10 && !dyn.DICE.aptitude.canonTotals.VICTORY);
check("Skill shows first, the strongest positive die", dyn.DICE_ORDER[0] === "skill" && dyn.DICE_ORDER[1] === "aptitude");
const opp = dyn.opposedPool({ skill: 1 }, { skill: 2, aptitude: 3 });
check("opposed: NPC Aptitude (d10) to Difficulty, Skill (d12) to Obstacle", opp.difficulty === 3 && opp.obstacle === 2);

// House rule floor: mod 2 untrained is 1 die strict, 2 with the floor, never a Skill die.
check("floor strict", dyn.buildPool(2, 0, strict).total === 1);
p = dyn.buildPool(2, 0);
check("floor house", p.total === 2 && p.aptitude === 2 && p.skill === 0 && p.floored, JSON.stringify(p));
p = dyn.buildPool(3, 1);
check("floor keeps the earned Skill die", p.skill === 1 && p.total === 2, JSON.stringify(p));

// Resolution cases. Face numbers are per die: Aptitude (d10) 4 is two successes,
// Skill (d12) 12 is Victory, Aptitude 5 is an Edge.
const r = (...faces) => faces.map(([k, f]) => ({ symbols: dyn.symbolsFor(k, f) }));
let res = dyn.resolve(r(["aptitude", 4], ["difficulty", 2]));
check("2S vs 1F passes", res.outcome === "pass" && res.net.SUCCESS === 1);
// Victory turns a failure into a success, which then cancels against the next
// failure: against two failures that nets to a wash, against one it passes.
res = dyn.resolve(r(["skill", 12], ["difficulty", 3]));
check("victory vs two failures washes", res.victoriesSpent === 1 && res.totalWash, JSON.stringify(res.net));
res = dyn.resolve(r(["skill", 12], ["difficulty", 2]));
check("victory vs one failure passes", res.victoriesSpent === 1 && res.outcome === "pass", JSON.stringify(res.net));
res = dyn.resolve(r(["aptitude", 5], ["difficulty", 1]));
check("edge tiebreak applied", res.outcome === "pass" && res.tiebreak?.applied === true);
res = dyn.resolve(r(["aptitude", 5], ["difficulty", 1]), { tiebreakWithEdgeAndDanger: false });
check("edge tiebreak offered when off", res.outcome === "stalemate" && res.tiebreak?.applied === false);
res = dyn.resolve(r(["aptitude", 1], ["difficulty", 1]));
check("total wash", res.totalWash && res.outcome === "stalemate");
res = dyn.resolve(r(["obstacle", 12], ["aptitude", 2]));
check("defeat is a GM option, not applied", res.outcome === "pass" && res.defeatIsGmOption);

// Agreement with the bot library, if it is on disk. The bot still uses the old
// names (its "skill" is the d10, its "aptitude" the d12), so compare across the rename
// until it is updated. If the bot has been updated, the names line up directly.
const botDir = "C:/Tempest Knights/irop/functions/_lib/dynosrs/";
try {
  const bot = await import(pathToFileURL(botDir + "config.js").href);
  const botEngine = await import(pathToFileURL(botDir + "engine.js").href);
  const botRenamed = bot.DICE.skill.sides === 12;
  const toBot = botRenamed ? (k => k) : (k => ({ skill: "aptitude", aptitude: "skill" })[k] ?? k);
  console.log(`(bot library uses the ${botRenamed ? "new" : "old"} Skill and Aptitude names)`);
  for ( const key of Object.keys(dyn.DICE) ) {
    check(`faces match bot: ${key} = bot ${toBot(key)}`, eq(bot.DICE[toBot(key)].faces, dyn.DICE[key].faces));
  }
  for ( let mod = 0; mod <= 10; mod++ ) for ( let rank = 0; rank <= 4; rank++ ) {
    const a = bot.buildPool(mod, rank);
    const b = dyn.buildPool(mod, rank, { minimumPoolDice: bot.HOUSE_RULES.minimumPoolDice });
    const same = (a.base === b.base) && (a.total === b.total) && (a.derived === b.derived) && (a.floored === b.floored)
      && (a[toBot("skill")] === b.skill) && (a[toBot("aptitude")] === b.aptitude);
    check(`pool match bot ${mod}/${rank}`, same, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  // Exhaustive two die resolution against the bot.
  const keys = Object.keys(dyn.DICE);
  let compared = 0;
  for ( const k1 of keys ) for ( const k2 of keys ) {
    for ( let f1 = 1; f1 <= dyn.DICE[k1].sides; f1++ ) for ( let f2 = 1; f2 <= dyn.DICE[k2].sides; f2++ ) {
      const rolls = [{ symbols: dyn.symbolsFor(k1, f1) }, { symbols: dyn.symbolsFor(k2, f2) }];
      const a = botEngine.resolve(rolls);
      const b = dyn.resolve(rolls, { tiebreakWithEdgeAndDanger: bot.HOUSE_RULES.tiebreakWithEdgeAndDanger });
      compared++;
      if ( a.outcome !== b.outcome || !eq(a.net, b.net) ) check(`resolve match ${k1}${f1} ${k2}${f2}`, false);
    }
  }
  check(`exhaustive pair resolution vs bot (${compared} cases)`, true);
}
catch(err) {
  console.log(`(bot library not compared: ${err.message})`);
}

// Combat: the handoff worked example.
const mods = combat.collectModifiers({ cover: "half", accuracy: -15 });
check("Alan formula", combat.formula(mods) === "1d100 + 30 - 15", combat.formula(mods));
const alan = combat.resolveCheck({ roll: 45, modifiers: mods, target: 45 });
check("Alan misses on 60", alan.total === 60 && !alan.success);
check("meet is a success", combat.resolveCheck({ roll: 45, modifiers: [], target: 45 }).success);

// RULED 2026-10-07: the target's Defense goes onto the attack roll, making the shot harder like cover.
const shot = combat.collectModifiers({ cover: "half", accuracy: -15, defense: 6, defenseLabel: "Trooper's Defense" });
check("target Defense adds to the attack roll", combat.totalModifier(shot) === 30 - 15 + 6
  && shot.some(m => (m.label === "Trooper's Defense") && (m.value === 6)), JSON.stringify(shot));
check("no Defense, no line", !combat.collectModifiers({ defense: 0 }).some(m => /Defense/.test(m.label)));

// Unaware forces open cover on dodge: full cover dodge -30 becomes +30.
const dodge = combat.collectModifiers({ cover: "full", role: "dodge", keys: ["unaware"] });
check("unaware dodge in the open", combat.totalModifier(dodge) === 30, JSON.stringify(dodge));
check("full cover dodge", combat.totalModifier(combat.collectModifiers({ cover: "full", role: "dodge" })) === -30);
check("exposed only touches crits",
  combat.totalModifier(combat.collectModifiers({ keys: ["exposed"], role: "accuracy" })) === 0
  && combat.totalModifier(combat.collectModifiers({ keys: ["exposed"], role: "critical" })) === -15);
check("disorientated both ways",
  combat.totalModifier(combat.collectModifiers({ keys: ["disorientated"], role: "dodge" })) === 20);

// RULED 2026-10-08: perk trees. Light gating, Pick one tiers, prerequisites, XP.
{
  const node = (id, name, xp = 20, requires = "") => ({ id, name, xp, requires, uuid: "" });
  const tree = {
    gated: true,
    tiers: [
      { exclusive: false, nodes: [node("a", "Clear the Room")] },
      { exclusive: true, nodes: [node("b", "Watch my Six"), node("c", "Fall in Line")] },
      { exclusive: false, nodes: [node("d", "Weapon Expert")] },
      { exclusive: false, nodes: [] },
      { exclusive: false, nodes: [node("e", "Target Rich Environment", 30, "d")] }
    ]
  };
  const at = (owned, opts = {}) => trees.nodeStates(tree, { owned: new Set(owned), unspent: 100, ...opts });
  let s = at([]);
  check("trees: the first tier is open from the start", s.get("a").state === "open" && s.get("a").canBuy && s.get("a").reason === "Buy for 20 XP");
  check("trees: the next tier is locked until a perk above is owned",
    s.get("b").state === "locked" && !s.get("b").canBuy && s.get("b").reason === "Locked: take a perk from Tier 1 first", s.get("b").reason);
  s = at(["a"]);
  check("trees: owning one perk in a tier opens the next (light gating)",
    s.get("a").state === "owned" && s.get("b").canBuy && s.get("c").canBuy && s.get("d").state === "locked");
  s = at(["a", "b"]);
  check("trees: a Pick one tier rules out the rest once one is taken",
    s.get("c").state === "excluded" && !s.get("c").canBuy && /Watch my Six/.test(s.get("c").reason), s.get("c").reason);
  check("trees: and still opens the tier below", s.get("d").canBuy);
  s = at(["a", "b", "d"]);
  check("trees: an empty tier never blocks the one below it", s.get("e").canBuy, s.get("e").reason);
  s = at(["a"], { unspent: 10 });
  check("trees: an open perk costing more than the unspent XP cannot be bought, and says why",
    s.get("b").state === "open" && !s.get("b").canBuy && s.get("b").reason === "Costs 20 XP; 10 unspent", s.get("b").reason);
  s = at([], { free: true, unspent: 0 });
  check("trees: Edit mode adds free and ignores gating", s.get("d").canBuy && s.get("e").canBuy && s.get("e").reason === "Add free (Edit mode)");
  s = at(["c"], { free: true });
  check("trees: Edit mode still honours Pick one", s.get("b").state === "excluded");
  const ungated = { ...tree, gated: false };
  s = trees.nodeStates(ungated, { owned: new Set(), unspent: 100 });
  check("trees: with gating off any tier is open, but a prerequisite still holds",
    s.get("d").canBuy && (s.get("e").state === "locked") && s.get("e").reason === "Locked: needs Weapon Expert first", s.get("e").reason);

  // Owned: perks carry their node; older abilities match by name, each once.
  const owned = trees.ownedPerks([tree], [
    { id: "x1", name: "Clear the Room", flags: { irop: { perk: { node: "a" } } } },
    { id: "x2", name: "Watch My Six!", flags: {} },
    { id: "x3", name: "Something Else", flags: {} }
  ]);
  check("trees: a bought perk is found by its node, an older ability by its name",
    owned.get("a") === "x1" && owned.get("b") === "x2" && !owned.has("c") && owned.size === 2, JSON.stringify([...owned]));
  check("trees: names compare loosely", trees.perkKey("Tag'em and Bag'em") === trees.perkKey("Tagem  and bagem"));

  // Editing.
  const tiers = tree.tiers;
  check("trees: a new perk costs what the last one in its tier does, or the tier above",
    trees.defaultNodeCost(tiers, 3) === 20 && trees.defaultNodeCost(tiers, 4) === 30 && trees.defaultNodeCost([], 0) === 10);
  const noD = trees.removeNode(tiers, "d");
  check("trees: removing a perk clears requirements on it",
    !noD[2].nodes.length && noD[4].nodes[0].requires === "" && tiers[2].nodes.length === 1);
  const moved = trees.moveNode(tiers, "c", 0);
  check("trees: a perk moves to another tier", moved[0].nodes.map(n => n.id).join() === "a,c" && moved[1].nodes.map(n => n.id).join() === "b"
    && !("tier" in moved[0].nodes[1]));
  check("trees: tiers move up and down, not past the ends",
    trees.moveTier(tiers, 1, -1)[0].nodes[0].id === "b" && trees.moveTier(tiers, 0, -1) === tiers);
  const noTier = trees.removeTier(tiers, 2);
  check("trees: deleting a tier clears requirements on its perks", noTier.length === 4 && noTier[3].nodes[0].requires === "");

  // Which trees a character sees (part B, 2026-10-08): its role's Primary and specializations,
  // another role's specialization only once bought into or while browsed, then the Everyone trees.
  const T = (name, role, kind, order = 0) => ({ id: name, name, system: { role, kind, order } });
  const all = [
    T("Generalist", "", "general"), T("Field Tactician", "legionary", "specialization", 2), T("Marauder", "marauder", "primary"),
    T("Legionary", "legionary", "primary"), T("Extra", "", "general", -1), T("Pointman", "legionary", "specialization", 1),
    T("Ghost", "outrider", "specialization", 1), T("Commando", "marauder", "specialization", 1)
  ];
  const names = opts => trees.treesFor(all, { role: "legionary", ...opts }).map(t => t.name).join();
  check("trees: Primary, the role's specializations in order, then the Everyone trees; not other roles",
    names({}) === "Legionary,Pointman,Field Tactician,Extra,Generalist", names({}));
  check("trees: another role's specialization shows once bought into, or while browsed, after the role's own",
    names({ entered: ["Ghost"], browse: "Commando" }) === "Legionary,Pointman,Field Tactician,Commando,Ghost,Extra,Generalist",
    names({ entered: ["Ghost"], browse: "Commando" }));

  // Specializations open at 300 and 900 XP earned; the first of the character's own role.
  const spec = (id, role) => ({ id, system: { kind: "specialization", role } });
  const lock = (tree, earned, entered) => trees.specializationLock(tree, { role: "legionary", earned, entered });
  check("specializations: none before 300 XP earned, one from 300, two from 900",
    trees.specializationSlots(299) === 0 && trees.specializationSlots(300) === 1 && trees.specializationSlots(900) === 2 && trees.specializationSlots(5000) === 2);
  check("specializations: locked below 300, and says so", lock(spec("pt", "legionary"), 150, []) === "Specializations open at 300 XP earned");
  check("specializations: at 300 the first opens, of the character's own role only",
    lock(spec("pt", "legionary"), 300, []) === "" && lock(spec("gh", "outrider"), 300, []) === "Your first specialization must be of your own role");
  check("specializations: even at 900, the first must be of the character's own role", lock(spec("gh", "outrider"), 950, []) !== "");
  check("specializations: with one taken, the second waits for 900 XP",
    lock(spec("ft", "legionary"), 500, ["pt"]) === "Your second specialization opens at 900 XP earned" && lock(spec("pt", "legionary"), 500, ["pt"]) === "");
  check("specializations: at 900 the second may be of any role", lock(spec("gh", "outrider"), 900, ["pt"]) === "" && lock(spec("ft", "legionary"), 900, ["pt"]) === "");
  check("specializations: never a third", lock(spec("gh", "outrider"), 5000, ["pt", "ft"]) === "Already 2 specializations, the most allowed");

  // A table can change the rules in the world settings (2026-10-08).
  const ruled = (rules, tree, earned, entered) => trees.specializationLock(tree, { role: "legionary", earned, entered,
    rules: { ...trees.SPECIALIZATION_RULES, ...rules } });
  check("settings: the unlock list reads loosely and in order",
    trees.parseUnlocks("900, 300;1500  x").join() === "300,900,1500" && !trees.parseUnlocks("").length && trees.parseUnlocks("300,900").join() === "300,900");
  const three = { unlockXP: [300, 900, 1500] };
  check("settings: a third number allows a third specialization, opening at its XP",
    ruled(three, spec("gh", "outrider"), 1000, ["pt", "ft"]) === "Your third specialization opens at 1500 XP earned"
      && ruled(three, spec("gh", "outrider"), 1500, ["pt", "ft"]) === "");
  check("settings: a blank list plays without specializations",
    ruled({ unlockXP: [] }, spec("pt", "legionary"), 5000, []) === "This table plays without specializations");
  check("settings: with cross training off, other roles stay shut",
    ruled({ crossRole: false }, spec("gh", "outrider"), 5000, ["pt"]) === "Specializations must be of your own role at this table"
      && ruled({ crossRole: false }, spec("ft", "legionary"), 5000, ["pt"]) === "");
  check("settings: with own role first off, the first may be of any role",
    ruled({ ownRoleFirst: false }, spec("gh", "outrider"), 300, []) === "");
  check("settings: other roles are offered only when one could be taken",
    !trees.canCrossTrain({ earned: 500, entered: ["pt"] }) && trees.canCrossTrain({ earned: 900, entered: ["pt"] })
      && !trees.canCrossTrain({ earned: 900, entered: [] }) && trees.canCrossTrain({ earned: 300, entered: [], rules: { ...trees.SPECIALIZATION_RULES, ownRoleFirst: false } })
      && !trees.canCrossTrain({ earned: 5000, entered: ["pt"], rules: { ...trees.SPECIALIZATION_RULES, crossRole: false } })
      && !trees.canCrossTrain({ earned: 5000, entered: ["pt", "ft"] }));
  check("specializations: Primary and General trees are never locked this way",
    lock({ id: "p", system: { kind: "primary", role: "legionary" } }, 0, []) === "" && lock({ id: "g", system: { kind: "general", role: "" } }, 0, []) === "");

  // Another role's tree claims only perks bought from it, never a shared name.
  const other = { role: "specialist", tiers: [{ exclusive: false, nodes: [{ id: "sx", name: "Covering Fire" }] }] };
  const mine = { role: "legionary", tiers: [{ exclusive: false, nodes: [{ id: "lx", name: "Covering Fire" }] }] };
  const held = trees.ownedPerks([mine, other], [{ id: "a1", name: "Covering Fire", flags: {} }], n => n.name, t => t.role === "legionary");
  check("trees: a name match counts only in the character's own trees", held.get("lx") === "a1" && !held.has("sx"));
}

// The Strategy Layer, step one (2026-10-08): its rules, state and starting values.
{
  const r = strat.strategyRules({});
  check("strategy: the defaults stand (Johnald, 2026-10-08); Strength runs to 25 (RULED 2026-10-11)",
    r.strengthMax === 25 && r.megacityGrowthEvery === 8 && r.heatRise.critical === 3 && r.heatQuietWeeks === 2
      && r.engineeringSlots === 3 && r.darkEventDraw === 3 && r.darkEventKeep === 2 && r.support.emergencyExtraction === 50);
  check("strategy: the Strength numbers keep their pace on the 25 scale: Incursion at 20 (8 of 10), moves of 3, Incursions 8 and 8, a card step 3",
    r.incursionStrength === 20 && r.strengthMoves === 3 && r.incursionMoves === 8 && r.incursionLoss === 8 && r.cardStrength === 3 && r.megacityGrowth === 1);
  const mine = strat.strategyRules({ strengthMax: 12, heatRise: { minor: 2 }, support: { mortarStrike: "40" }, darkEventKeep: "lots", stray: 5 });
  check("strategy: a world's changes lie over the defaults; nonsense keeps the default; unknown keys drop",
    mine.strengthMax === 12 && mine.heatRise.minor === 2 && mine.heatRise.major === 2 && mine.support.mortarStrike === 40
      && mine.darkEventKeep === 2 && !("stray" in mine));
  const w = strat.warRoomState({ week: 0, phase: "lunch", logistics: 12.6, intel: -3 });
  check("strategy: the War Room starts at turn 1 in the ODR phase, numbers whole and not below zero",
    JSON.stringify(strat.warRoomState()) === JSON.stringify({ week: 1, phase: "odr", logistics: 0, intel: 0, tactical: null })
      && w.week === 1 && w.phase === "odr" && w.logistics === 13 && w.intel === 0);
  check("strategy: the old tracks read as five tiers of five boxes",
    strat.readTrack("Tier 3, 5 of 5").boxes === 15 && strat.readTrack("Tier 1, 3 of 5").boxes === 3 && strat.readTrack("nothing") === null);
  check("strategy: Strength is the share of 25 boxes, on the 0 to 25 scale the boxes themselves",
    strat.strengthFromTrack("Tier 3, 5 of 5") === 15 && strat.strengthFromTrack("Tier 2, 5 of 5") === 10 && strat.strengthFromTrack("Tier 1, 1 of 5") === 1
      && strat.strengthFromTrack("Tier 3, 5 of 5", 20) === 12);
  check("strategy: Heat is the vigilance tier less one",
    strat.heatFromTrack("Tier 1, 5 of 5") === 0 && strat.heatFromTrack("Tier 2, 3 of 5") === 1 && strat.heatFromTrack("Tier 3, 5 of 5") === 2);
  const linked = strat.linkNeighbors({ a: ["c"], b: [] }, "a", "b");
  check("strategy: neighbours link both ways", linked.a.join() === "c,b" && linked.b.join() === "a");
  check("strategy: linking twice changes nothing; a territory is never its own neighbour",
    Object.keys(strat.linkNeighbors({ a: ["b"], b: ["a"] }, "a", "b")).length === 0 && Object.keys(strat.linkNeighbors({ a: [] }, "a", "a")).length === 0);
  const unlinked = strat.linkNeighbors({ a: ["b", "c"], b: ["a"] }, "a", "b", false);
  check("strategy: unlinking takes both sides apart", unlinked.a.join() === "c" && unlinked.b.join() === "");
}

// The War Room map (2026-10-08): overlays, which region is which territory, a test board, borders.
{
  const t = { heat: 3, strength: 8, reputation: -2, control: "liberated" };
  check("war room: each overlay says what it shows",
    wrm.overlayStyle("heat", t).text === "Heat High" && wrm.overlayStyle("strength", t).text === "Strength 8"
      && wrm.overlayStyle("reputation", t).text === "Wary" && wrm.overlayStyle("control", t).text === "Liberated"
      && wrm.overlayStyle("reputation", { reputation: 4 }).text === "Devoted" && wrm.overlayStyle("reputation", { reputation: -9 }).text === "Hostile");
  check("war room: hotter and stronger territories are bolder",
    wrm.overlayStyle("heat", { heat: 4 }).alpha > wrm.overlayStyle("heat", { heat: 1 }).alpha
      && wrm.overlayStyle("strength", { strength: 9 }).alpha > wrm.overlayStyle("strength", { strength: 2 }).alpha);
  check("war room: Control in the liveries: GENESIS red, contested gold, liberated ODR sky",
    wrm.overlayStyle("control", { control: "genesis" }).color === 0xC4121C && wrm.overlayStyle("control", { control: "contested" }).color === 0xD9B234
      && wrm.overlayStyle("control", { control: "liberated" }).color === 0x42ABF2);
  const T = (id, name, region = "", parent = "") => ({ id, name, system: { region, parent } });
  const regions = [{ id: "r1", uuid: "Scene.s.Region.r1", name: "Neo Seattle" }, { id: "r2", uuid: "Scene.s.Region.r2", name: "Seattle core" },
    { id: "r3", uuid: "Scene.s.Region.r3", name: "Portlandia" }];
  const m = wrm.matchRegions(regions, [T("a", "Neo-Seattle", "Scene.s.Region.r2"), T("b", "Neo Seattle"), T("c", "PORTLANDIA"), T("d", "Spokane")]);
  check("war room: a territory linked on its sheet is that region; others match by name, loosely",
    m.get("r2")?.territory.id === "a" && m.get("r2").how === "linked" && m.get("r1")?.territory.id === "b" && m.get("r1").how === "name"
      && m.get("r3")?.territory.id === "c" && m.size === 3);
  check("war room: a territory linked elsewhere is not also matched by name",
    wrm.matchRegions([{ id: "r1", uuid: "u1", name: "Neo Seattle" }], [T("a", "Neo Seattle", "u9")]).size === 0);
  check("war room: a Megacity's own map shows only what is inside it",
    wrm.territoriesShown([T("a", "x", "", "ns"), T("b", "y")], "ns").map(x => x.id).join() === "a"
      && wrm.territoriesShown([T("a", "x", "", "ns"), T("b", "y")]).length === 2);
  const board = wrm.testLayout({ x: 1000, y: 750, width: 4000, height: 3000 });
  const inside = board.every(r => r.points.every((v, i) => (i % 2 ? (v >= 750 && v <= 3750) : (v >= 1000 && v <= 5000))));
  check("war room: the test board is the sixteen vault regions, inside the scene", board.length === 16 && inside
    && wrm.TEST_LAYOUT.flat().includes("Neo Seattle") && board.every(r => r.points.length === 8));
  const pairs = wrm.touchingPairs(board.map(r => ({ id: r.name, polygons: [r.points] })), 50);
  const has = (a, b) => pairs.some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
  check("war room: borders found from the map: 24 on the board, sides only, no corners",
    pairs.length === 24 && has("Neo Seattle", "Portlandia") && has("Old Victoria", "Neo Seattle") && !has("Neo Seattle", "Eight Forests"), pairs.length);
  const gap = wrm.touchingPairs([{ id: "a", polygons: [[0, 0, 100, 0, 100, 100, 0, 100]] }, { id: "b", polygons: [[130, 0, 230, 0, 230, 100, 130, 100]] }], 50);
  const far = wrm.touchingPairs([{ id: "a", polygons: [[0, 0, 100, 0, 100, 100, 0, 100]] }, { id: "b", polygons: [[300, 0, 400, 0, 400, 100, 300, 100]] }], 50);
  check("war room: a small hand drawn gap still counts as a border; a real distance does not", gap.length === 1 && far.length === 0);
}

// Logistics and Intel as a ledger, and Support (Strategy Layer step 3, 2026-10-08).
{
  const L = (id, resource, amount, week = 1, reason = "x") => ({ id, resource, amount, week, reason });
  const ledger = [L("a", "logistics", 40), L("b", "intel", 12), L("c", "logistics", -10, 2)];
  check("ledger: the stock is the sum of its entries", JSON.stringify(rsc.resourceTotals(ledger)) === JSON.stringify({ logistics: 30, intel: 12 })
    && rsc.resourceTotals([]).logistics === 0 && rsc.resourceTotals([{ resource: "gold", amount: 5 }]).logistics === 0);
  check("ledger: the War Room's Logistics and Intel come from the ledger, not what was saved",
    strat.warRoomState({ week: 3, logistics: 999 }, ledger).logistics === 30 && strat.warRoomState({ week: 3 }, ledger).intel === 12
      && strat.warRoomState({ week: 3 }, ledger).week === 3);
  const gain = rsc.addEntry(ledger, { resource: "logistics", amount: 15, reason: "  Ambush haul ", week: 2, id: "d" });
  check("ledger: a gain adds an entry, reason trimmed", gain.ok && gain.ledger.length === 4 && gain.entry.reason === "Ambush haul"
    && rsc.resourceTotals(gain.ledger).logistics === 45 && ledger.length === 3);
  const over = rsc.addEntry(ledger, { resource: "logistics", amount: -50 });
  check("ledger: spending more than the stock is refused, and says why", !over.ok && /50 Logistics; 30 in stock/.test(over.reason));
  const loss = rsc.addEntry(ledger, { resource: "logistics", amount: -50, reason: "Reprisal" }, { clamp: true });
  check("ledger: a loss past the stock takes what is left", loss.ok && loss.entry.amount === -30 && loss.clamped && rsc.resourceTotals(loss.ledger).logistics === 0);
  check("ledger: no amount, an unknown resource, or nothing left to lose are refused",
    !rsc.addEntry(ledger, { resource: "logistics", amount: 0 }).ok && !rsc.addEntry(ledger, { resource: "gold", amount: 5 }).ok
      && !rsc.addEntry([], { resource: "intel", amount: -5 }, { clamp: true }).ok);
  check("ledger: a blank reason says gained or spent",
    rsc.addEntry(ledger, { resource: "intel", amount: 3 }).entry.reason === "Gained" && rsc.addEntry(ledger, { resource: "intel", amount: -3 }).entry.reason === "Spent");
  const undone = rsc.removeEntry(ledger, "c");
  check("ledger: undoing a spend gives it back", undone.ok && rsc.resourceTotals(undone.ledger).logistics === 40);
  const blocked = rsc.removeEntry(ledger, "a");
  check("ledger: undoing a gain already spent is refused", !blocked.ok && /-10 Logistics/.test(blocked.reason) && !rsc.removeEntry(ledger, "zz").ok);
  const weeks = rsc.ledgerWeeks([...ledger, L("d", "logistics", 5, 2, "Cache")]);
  check("ledger: by week, newest week and newest entry first, each week's net",
    weeks.map(w => w.week).join() === "2,1" && weeks[0].lines.map(l => l.id).join() === "d,c"
      && weeks[0].net.map(n => `${n.label} ${n.amount}`).join() === "Logistics -5" && weeks[1].net.length === 2
      && weeks[0].lines[1].amount === "-10" && !weeks[0].lines[1].gain && weeks[1].lines[1].amount === "+40");

  const rules = strat.strategyRules({});
  check("support: the doc's prices", rsc.supportCost("reinforcements", rules) === 10 && rsc.supportCost("hiddenCache", rules) === 15
    && rsc.supportCost("mortarStrike", rules) === 30 && rsc.supportCost("emergencyExtraction", rules) === 50 && rsc.supportCost("nope", rules) === null);
  check("support: an Inside Job costs 10 to 25, held inside the range",
    rsc.supportCost("insideJob", rules) === 10 && rsc.supportCost("insideJob", rules, 18) === 18 && rsc.supportCost("insideJob", rules, 99) === 25
      && rsc.supportCost("insideJob", rules, 2) === 10 && rsc.supportMost("insideJob", rules) === 25 && rsc.supportMost("mortarStrike", rules) === 30);
  check("support: a GM's own prices apply", rsc.supportCost("mortarStrike", strat.strategyRules({ support: { mortarStrike: 40 } })) === 40);
  const opts = rsc.supportOptions(rules, 20);
  check("support: five options, priced, and which the stock covers",
    opts.length === 5 && opts.find(o => o.key === "insideJob").costLabel === "10 to 25" && opts.find(o => o.key === "reinforcements").affordable
      && !opts.find(o => o.key === "mortarStrike").affordable && /Needs 30 Logistics; 20 in stock/.test(opts.find(o => o.key === "mortarStrike").short));
  const strikes = rsc.mortarStrikes([12, 75, 99]);
  check("support: a mortar roll of 75 or more scatters", strikes.map(s => s.scatters).join() === "false,true,true" && strikes[2].n === 3);
  // Blast markers for the mortars (Johnald, 2026-10-10): the doc's three areas may not overlap.
  check("mortar: two strikes overlap when closer than their radii together; touching or apart is fine",
    rsc.strikesOverlap({ x: 0, y: 0, radius: 300 }, { x: 500, y: 0, radius: 300 })
      && !rsc.strikesOverlap({ x: 0, y: 0, radius: 300 }, { x: 600, y: 0, radius: 300 })
      && !rsc.strikesOverlap({ x: 0, y: 0, radius: 300 }, { x: 0, y: 900, radius: 300 })
      && rsc.strikesOverlap({ x: 100, y: 100, radius: 300 }, { x: 400, y: 400, radius: 300 }));
  check("support: no dashes in the doc's effect text", Object.values(IROP.supportOptions).every(o => !/[\u2013\u2014]/.test(o.effect)));
}

// Projects in the ODR phase (Strategy Layer step 5, 2026-10-08).
{
  const soldier = {
    attributes: { int: { mod: 4 }, str: { mod: 5 }, cha: { mod: 3 }, agi: { mod: 2 } },
    skills: { tactics: { rank: 2 }, stealth: { rank: 1 }, persuasion: { rank: 3 }, mechanics: { rank: 0 } }
  };
  const research = { kind: "research", specialization: ["tactics", "mechanics"] };
  const eng = { kind: "engineering", specialization: ["mechanics"] };
  const intel = { kind: "intelligence" };
  check("projects: research and engineering skills give Intelligence bonus + 5 a rank",
    proj.contribution(research, soldier, "tactics") === 14 && proj.contribution(research, soldier, "mechanics") === 0
      && proj.contribution(research, soldier, "stealth") === 0);
  check("projects: labor is the Strength bonus, on Engineering only",
    proj.contribution(eng, soldier, "labor") === 5 && proj.contribution(research, soldier, "labor") === 0);
  check("projects: intelligence takes Social skills, Stealth, Hacking and Lock Picking, on their own attribute",
    proj.contribution(intel, soldier, "persuasion") === 18 && proj.contribution(intel, soldier, "stealth") === 7
      && proj.contribution(intel, soldier, "tactics") === 0 && proj.skillQualifies(intel, "lockpicking") && proj.skillQualifies(intel, "coercion"));
  check("projects: a soldier works with their best skill; labor when they have none for Engineering; nobody without one for Research",
    proj.bestSkill(research, soldier).skill === "tactics" && proj.bestSkill(intel, soldier).skill === "persuasion"
      && proj.bestSkill(eng, soldier).skill === "labor" && proj.bestSkill({ kind: "research", specialization: ["biology"] }, soldier) === null);
  const weekly = proj.weeklyProgress({ ...research, assigned: [{ actor: "a1", skill: "tactics" }, { actor: "gone", skill: "tactics" }] },
    id => (id === "a1" ? { name: "Kael", system: soldier } : null), strat.strategyRules({}));
  check("projects: a week's progress is the passive 10 and each soldier's share",
    weekly.passive === 10 && weekly.total === 24 && weekly.soldiers[0].label === "Tactics" && weekly.soldiers[1].amount === 0
      && proj.progressBreakdown(weekly) === "Passive 10, Kael (Tactics) 14, A soldier no longer here (Tactics) 0");
  check("projects: progress never passes the cost, and reaching it completes",
    JSON.stringify(proj.addProgress({ cost: 100, progress: 90 }, 24)) === JSON.stringify({ progress: 100, added: 10, complete: true })
      && !proj.addProgress({ cost: 0, progress: 0 }, 5).complete && proj.remainingCost({ cost: 50, progress: 20 }) === 30);
  check("projects: salvage adds 30% of the cost", proj.salvageProgress(100) === 30 && proj.salvageProgress(55) === 17);
  const P = (id, kind, status, extra = {}) => ({ id, name: id, kind, status, cost: 50, progress: 0, assigned: [], ...extra });
  const world = [P("r1", "research", "active"), P("r2", "research", "available"), P("e1", "engineering", "active"), P("e2", "engineering", "active"),
    P("e3", "engineering", "active"), P("e4", "engineering", "available"), P("s1", "intelligence", "active", { term: "short" }),
    P("s2", "intelligence", "available", { term: "short" }), P("l1", "intelligence", "available", { term: "long" })];
  const get = id => world.find(p => p.id === id);
  check("projects: starting research switches, the old one keeps its progress", proj.canStart(get("r2"), world).ok && proj.canStart(get("r2"), world).replaces.join() === "r1");
  check("projects: three Engineering projects at once", !proj.canStart(get("e4"), world).ok && /All 3 Engineering slots/.test(proj.canStart(get("e4"), world).reason));
  check("projects: one short term and one long term Intelligence Action",
    !proj.canStart(get("s2"), world).ok && /already under way: s1/.test(proj.canStart(get("s2"), world).reason) && proj.canStart(get("l1"), world).ok);
  check("projects: nothing starts without a cost, hidden, under way or done",
    !proj.canStart({ ...get("l1"), cost: 0 }, world).ok && !proj.canStart({ ...get("l1"), status: "hidden" }, world).ok
      && !proj.canStart(get("r1"), world).ok && !proj.canStart({ ...get("l1"), status: "complete" }, world).ok);
  const moved = proj.assignSoldier([P("a", "research", "active", { assigned: [{ actor: "k", skill: "tactics" }] }), P("b", "engineering", "active")], "b", "k", "labor");
  check("projects: a soldier works one project at a time", moved.a.length === 0 && moved.b[0].skill === "labor");
  check("projects: assigning the same way twice changes nothing", Object.keys(proj.assignSoldier([P("b", "engineering", "active", { assigned: [{ actor: "k", skill: "labor" }] })], "b", "k", "labor")).length === 0);

  check("missions: Strength reads low, moderate or high by share of the top", proj.strengthBand(2, 10).label === "Low"
    && proj.strengthBand(5, 10).label === "Moderate" && proj.strengthBand(9, 10).label === "High" && proj.strengthBand(0, 10).label === "Low");
  check("missions: Reputation's effect from Friendly up and Wary down; a level either side of Neutral only leans",
    /look the other way/.test(proj.reputationEffect(2)) && /look the other way/.test(proj.reputationEffect(4)) && /call GENESIS/.test(proj.reputationEffect(-2))
      && proj.reputationEffect(1) === "" && proj.reputationEffect(-1) === "" && proj.reputationEffect(0) === "");
  const d = proj.debriefTerritory({ heatPending: 1, reputation: 2, reputationPoints: 7 }, { heat: "major", reputation: 2 }, strat.strategyRules({}));
  check("missions: a debrief's Heat waits for next turn, the territory saw action, Reputation moves through its bar",
    d["system.heatPending"] === 3 && d["system.active"] === true && d["system.reputation"] === 2 && d["system.reputationPoints"] === 9);
  const tip = proj.debriefTerritory({ reputation: 2, reputationPoints: 9 }, { reputation: 2 });
  const old = proj.debriefTerritory({ reputation: 1 }, { reputation: -3 });
  check("missions: a full bar rises a level, starting mid bar; a territory with no points yet starts mid bar",
    tip["system.reputation"] === 3 && tip["system.reputationPoints"] === 5 && old["system.reputation"] === 1 && old["system.reputationPoints"] === 2);
  check("missions: Reputation points by outcome (RULED 2026-10-11): success +2, partial +1, failure -2",
    proj.defaultReputation("success") === 2 && proj.defaultReputation("partial") === 1 && proj.defaultReputation("failure") === -2
      && strat.strategyRules({}).missionReputation.civilians === -4);
  const choices = proj.tacticalChoices([{ id: "rv", label: "Strike the GENESIS asset", territory: "t1" }]);
  check("missions: the always available Tactical Actions (the doc's seven and the Megacity assault), then any revealed",
    choices.length === 9 && choices[0].label === "Ambush Patrols" && choices[7].label === "Assault a Megacity objective" && choices.at(-1).revealed && choices.at(-1).territory === "t1" && choices.at(-1).heat === "major");
}

// The turn engine (Strategy Layer step 4, 2026-10-08).
{
  const T = (id, name, kind, system) => ({ id, name, system: { kind, control: "genesis", strength: 0, heat: 0, heatPending: 0, quietWeeks: 0, active: false, neighbors: [], ...system } });
  const terrs = [
    T("a", "Neo Seattle", "megacity", { strength: 6, heat: 2, quietWeeks: 1, neighbors: ["b", "c", "d"] }),
    T("b", "Redwood Havens", "rural", { strength: 3, heat: 1, heatPending: 2, neighbors: ["a"] }),
    T("c", "Spokane Subsector", "slums", { strength: 4, heat: 0, active: true, quietWeeks: 1, neighbors: ["a"] }),
    T("d", "Neo LA", "megacity", { strength: 2, heat: 3, control: "liberated", neighbors: ["a"] })
  ];
  const rules = strat.strategyRules({});
  const plan = turn.planTurn({ week: 7, territories: terrs, rules });
  const shown = plan.lines.filter(l => !l.hidden);
  const texts = shown.map(l => l.text);
  check("turn: the plan is for the next turn", plan.week === 8);
  const genesis = shown.filter(l => ["growth", "strength", "heat"].includes(l.section)).map(l => l.text);
  check("turn: every 8th week each Megacity grows; a liberated one sits out the GENESIS phase",
    texts.includes("Neo Seattle grows: Strength 6 to 7") && !genesis.some(t => /Neo LA/.test(t)), texts.join(" | "));
  check("turn: the hotter territory pulls Strength from a cooler neighbour, rural before slums",
    texts.includes("Neo Seattle pulls 3 Strength from Redwood Havens") && !texts.some(t => /from Spokane/.test(t)), texts.join(" | "));
  check("turn: last week's Heat lands; two quiet weeks cool a territory; activity keeps it",
    texts.includes("Redwood Havens: Heat Low to High") && texts.includes("Neo Seattle: Heat Medium to Low") && !texts.some(t => /Spokane.*Heat/.test(t)), texts.join(" | "));
  check("turn: Dark Events every 4th week and the Event phase every 2nd are due", plan.due.length === 2 && /Dark Events: draw 3 and use 2/.test(plan.due[0]) && /Event phase/.test(plan.due[1]));
  check("turn: a week with no Tactical Action says so", plan.warnings.join() === "No Tactical Action was taken this turn.");
  check("turn: an undebriefed Tactical Action says so",
    /Ambush Patrols, was never debriefed/.test(turn.planTurn({ week: 2, territories: [], rules, tactical: { label: "Ambush Patrols", status: "briefed" } }).warnings[0]));

  const docs = new Map(terrs.map(t => [t.id, { system: JSON.parse(JSON.stringify(t.system)) }]));
  const all = new Set(shown.map(l => l.id));
  const res = turn.resolvePlan(plan, all, docs);
  const upd = id => res.updates.find(u => u._id === id) ?? {};
  check("turn: applied, Neo Seattle grows then pulls (6 to 10), cools to Low, quiet count reset",
    upd("a")["system.strength"] === 10 && upd("a")["system.heat"] === 1 && upd("a")["system.quietWeeks"] === 0, JSON.stringify(upd("a")));
  check("turn: applied, Redwood loses its Strength, takes its Heat, and its pending clears",
    upd("b")["system.strength"] === 0 && upd("b")["system.heat"] === 3 && upd("b")["system.heatPending"] === 0, JSON.stringify(upd("b")));
  check("turn: applied, the active territory's quiet count resets and its activity clears for the new week",
    upd("c")["system.quietWeeks"] === 0 && upd("c")["system.active"] === false && !("system.strength" in upd("c")), JSON.stringify(upd("c")));
  check("turn: the liberated territory is untouched", !res.updates.some(u => u._id === "d"));
  check("turn: what was there before is kept, for undo",
    res.before.find(b => b._id === "a")["system.strength"] === 6 && res.before.find(b => b._id === "b")["system.heatPending"] === 2);
  const growth = shown.find(l => l.section === "growth").id;
  const skip = turn.resolvePlan(plan, new Set([...all].filter(id => id !== growth)), docs);
  check("turn: an unticked line does not happen", skip.updates.find(u => u._id === "a")["system.strength"] === 9);
  const none = turn.resolvePlan(plan, new Set(), docs);
  check("turn: with nothing ticked only the bookkeeping applies",
    !none.updates.some(u => "system.strength" in u || "system.heat" in u) && none.updates.find(u => u._id === "c")["system.active"] === false);

  const full = turn.planTurn({ week: 3, territories: [T("x", "Hot", "rural", { strength: 25, heat: 4, neighbors: ["y"] }), T("y", "Cool", "rural", { strength: 5, heat: 0, neighbors: ["x"] })], rules });
  check("turn: a territory already at the top Strength pulls nothing", !full.lines.some(l => l.section === "strength"));
  check("turn: a quiet week plans no growth off schedule", !turn.planTurn({ week: 3, territories: terrs, rules }).lines.some(l => l.section === "growth"));

  const kael = { name: "Kael", system: { attributes: { int: { mod: 4 } }, skills: { tactics: { rank: 2 } } } };
  const projects = [
    { id: "p1", name: "Armory Refit", system: { kind: "research", status: "active", cost: 100, progress: 90, specialization: ["tactics"], assigned: [{ actor: "k", skill: "tactics" }] } },
    { id: "p2", name: "SAM Site", system: { kind: "engineering", status: "active", cost: 60, progress: 0, specialization: [], assigned: [] } },
    { id: "p3", name: "Unpriced", system: { kind: "engineering", status: "active", cost: 0, progress: 0, specialization: [], assigned: [] } },
    { id: "p4", name: "Waiting", system: { kind: "research", status: "available", cost: 50, progress: 0, specialization: [], assigned: [] } }
  ];
  const pp = turn.planTurn({ week: 1, territories: [], projects, soldierOf: id => (id === "k" ? kael : null), rules });
  const pl = pp.lines.filter(l => l.section === "projects");
  check("turn: active projects progress; reaching the cost completes and frees the soldiers",
    pl[0].text === "Research: Armory Refit, 90 to 100 of 100. Complete" && pl[0].completes === "p1" && /Passive 10, Kael \(Tactics\) 14/.test(pl[0].detail)
      && pl[0].ops.some(o => o.path === "system.status" && o.set === "complete") && pl[0].ops.some(o => o.path === "system.assigned"));
  check("turn: the passive progress alone moves an unstaffed project; one with no cost says so; waiting ones do not move",
    pl[1].text === "Engineering: SAM Site, 0 to 10 of 60" && /Unpriced has no cost yet/.test(pl[2].text) && pl.length === 3);
  const pdocs = new Map(projects.map(p => [p.id, { system: JSON.parse(JSON.stringify(p.system)) }]));
  const pres = turn.resolvePlan(pp, new Set(pl.map(l => l.id)), pdocs);
  check("turn: applied, the completion is reported for its card",
    pres.completes.join() === "p1" && pres.updates.find(u => u._id === "p1")["system.status"] === "complete"
      && pres.updates.find(u => u._id === "p1")["system.assigned"].length === 0 && pres.updates.find(u => u._id === "p2")["system.progress"] === 10);
}

// Event and Dark Event cards (Strategy Layer step 6, 2026-10-08).
{
  // A fixed sequence for the draws, so the tests know which cards land where.
  const seq = values => { let i = 0; return () => values[i++ % values.length]; };
  const C = (id, name, system = {}, extra = {}) => ({ id, name, img: `${id}.svg`, system, ...extra });
  check("cards: a plain card is an instant event with no numbers", JSON.stringify(ev.cardRules({ name: "x" })) === JSON.stringify({
    kind: "event", persistent: false, discretionary: false, holdable: false, reprisal: false, negative: false, respond: false, worldwide: false,
    excluded: [], effect: { logistics: 0, intel: 0, strength: 0, heat: 0, reputation: 0 }, discard: { logistics: 0, intel: 0, strength: 0, heat: 0, reputation: 0 }, discardText: "" }));
  check("cards: what a card changes, in words",
    ev.describeEffects({ logistics: 10, intel: -2, strength: 1, heat: 1, reputation: -1 }) === "+10 Logistics, -2 Intel, Strength +3, Heat +1 next turn, Reputation -3"
      && ev.describeEffects({}) === "" && ev.describeEffects({ reputation: 2 }, strat.strategyRules({ cardReputation: 4 })) === "Reputation +8");
  const ops = ev.effectOps({ strength: 2, heat: 1, reputation: -1, logistics: 5 }, "t1", strat.strategyRules({}));
  check("cards: Strength now (a step worth 3, held to the top), Heat next turn, Reputation through its bar, a step worth 3 points",
    ops.length === 3 && ops[0].path === "system.strength" && ops[0].delta === 6 && ops[0].max === 25 && ops[1].path === "system.heatPending" && ops[2].rep === -3
      && ev.effectOps({ strength: 1 }, "").length === 0);
  check("cards: Logistics and Intel go through the ledger",
    JSON.stringify(ev.effectLedger({ logistics: -20, intel: 3 }, "why")) === JSON.stringify([{ resource: "logistics", amount: -20, reason: "why" }, { resource: "intel", amount: 3, reason: "why" }]));
  check("cards: picking at random never picks twice", new Set(ev.pickDistinct([1, 2, 3, 4], 4, seq([0.9, 0.1, 0.5]))).size === 4 && ev.pickDistinct([1, 2], 5).length === 2);

  const T = (id, name, control = "genesis") => ({ id, name, system: { control } });
  const terrs = [T("a", "Neo Seattle"), T("b", "Portlandia"), T("c", "Neo LA", "liberated")];
  const rules = strat.strategyRules({});
  const inPlay = [
    C("p1", "Distress Call", { persistent: true, discard: { reputation: -1 }, discardText: "No one came." }, { territory: "b", week: 2 }),
    C("p2", "Uprising", { persistent: true }, { territory: "a", week: 3 })
  ];
  const held = [C("h1", "Crackdown", { kind: "dark", discretionary: true }, { week: 3 }), C("h2", "Long Game", { kind: "dark", discretionary: true, holdable: true }, { week: 3 })];
  const eventDeck = [C("e1", "Supply Drop", { effect: { logistics: 10 } }), C("e2", "Riot", { negative: true, effect: { reputation: -1 } }), C("e3", "Uprising II", { persistent: true, effect: { reputation: 1 } })];
  const darkDeck = [C("d1", "Propaganda", { kind: "dark", negative: true, effect: { reputation: -1 } }), C("d2", "Reprisal", { kind: "dark", persistent: true, reprisal: true }),
    C("d3", "Crackdown", { kind: "dark", discretionary: true, effect: { strength: 1 } })];
  // Turn 4 starts: the Event phase (every 2nd) and the Dark Events (every 4th) are both due.
  const plan = ev.planCards({ next: 4, rules, territories: terrs, inPlay, held, eventDeck, darkDeck, random: seq([0, 0, 0, 0, 0, 0, 0, 0]) });
  const of = s => plan.lines.filter(l => l.section === s);
  check("cards: a persistent card leaves at the end of the next turn, with its discard effect",
    of("cards")[0]?.text === "Distress Call leaves Portlandia" && /Reputation -3\. No one came/.test(of("cards")[0].detail)
      && of("cards")[0].ops[0].path === "system.reputation" && of("cards")[0].card.op === "discard" && !of("cards").some(l => /Uprising leaves/.test(l.text)));
  check("cards: an unused Dark Event drawn last turn goes, unless it can be held",
    of("cards").some(l => l.text === "Unused Dark Event discarded: Crackdown" && l.card.from === "darkHand") && !of("cards").some(l => /Long Game/.test(l.text)));
  check("cards: the Event phase draws three to three different territories",
    of("events").length === 3 && new Set(of("events").map(l => l.card.territory)).size === 3 && of("events").every(l => l.card.op === "draw"));
  const onLA = of("events").find(l => l.card.territory === "c");
  const negLA = of("events").find(l => (l.card.territory === "c") && (l.card.name === "Riot"));
  check("cards: what lands on a territory says so, and its numbers go there",
    of("events").every(l => / lands on /.test(l.text)) && !!onLA);
  const plan2 = ev.planCards({ next: 2, rules, territories: [T("c", "Neo LA", "liberated")], eventDeck: [eventDeck[1]], darkDeck: [], random: seq([0]) });
  check("cards: a negative event in a liberated territory is handled by the Resistance",
    /Handled by the Resistance/.test(plan2.lines[0].detail) && !plan2.lines[0].ops.length && !plan2.lines[0].ledger.length && plan2.lines[0].card.place === false);
  const plan3 = ev.planCards({ next: 2, rules, territories: [T("a", "Neo Seattle")], eventDeck: [eventDeck[2]], darkDeck: [], random: seq([0]) });
  check("cards: a persistent event stays in play; a short deck says so",
    plan3.lines[0].card.place === true && /Stays until turn 4 starts/.test(plan3.lines[0].detail) && /Event deck has 1 of the 3/.test(plan3.warnings[0]));
  check("cards: three Dark Events drawn, each saying how it plays",
    of("dark").length === 3 && of("dark").every(l => l.card.op === "dark") && /Discretionary/.test(of("dark").find(l => l.text === "Crackdown").detail)
      && /Reprisal/.test(of("dark").find(l => l.text === "Reprisal").detail) && of("dark").find(l => l.text === "Reprisal").card.needsTerritory
      && !of("dark").find(l => l.text === "Crackdown").card.needsTerritory);
  const none = ev.planCards({ next: 4, rules, territories: terrs });
  check("cards: with no decks set up, the draws are reminders", none.due.length === 2 && /Dark Events: draw 3 and use 2/.test(none.due[0]) && /Set up the decks/.test(none.due[1]));
  check("cards: odd weeks draw nothing", !ev.planCards({ next: 3, rules, territories: terrs, eventDeck, darkDeck }).lines.some(l => ["events", "dark"].includes(l.section)));

  const card = (name, extra = {}) => ({ card: { name, reprisal: false, needsTerritory: false, ...extra }, territory: "" });
  check("cards: the GM uses no more than two Dark Events", /Use 2 of the Dark Events drawn, not 3/.test(ev.checkDarkChoice([card("a"), card("b"), card("c")], rules)));
  check("cards: one Reprisal at a time",
    /one Reprisal/.test(ev.checkDarkChoice([card("a", { reprisal: true }), card("b", { reprisal: true })], rules))
      && /one Reprisal/.test(ev.checkDarkChoice([card("a", { reprisal: true })], rules, true)));
  check("cards: a Dark Event that hits a territory needs one chosen",
    /Choose where Reprisal hits/.test(ev.checkDarkChoice([card("Reprisal", { needsTerritory: true })], rules))
      && ev.checkDarkChoice([{ ...card("Reprisal", { needsTerritory: true }), territory: "a" }, card("b")], rules) === null);

  // The cards in the turn plan, and resolved.
  const tplan = turn.planTurn({ week: 3, territories: terrs.map(t => ({ ...t, system: { ...t.system, kind: "rural", strength: 3, heat: 0, neighbors: [] } })),
    rules, cards: { inPlay, held, eventDeck, darkDeck }, random: seq([0]) });
  const sections = [...new Set(tplan.lines.filter(l => !l.hidden).map(l => l.section))];
  check("turn: the cards come in the doc's order: Dark Events in the GENESIS phase, then the Event phase", sections.join() === "dark,cards,events", sections.join());
  check("turn: with decks, nothing is left as a reminder", !tplan.due.length);
  const docs = new Map(terrs.map(t => [t.id, { system: { strength: 3, heat: 0, heatPending: 0, reputation: 0 } }]));
  const dark = tplan.lines.filter(l => l.section === "dark");
  const prop = dark.find(l => l.text === "Propaganda");
  const rep = dark.find(l => l.text === "Reprisal");
  const ticked = new Set([...tplan.lines.filter(l => l.section !== "dark").map(l => l.id), prop.id, rep.id]);
  const res = turn.resolvePlan(tplan, ticked, docs, { choices: new Map([[prop.id, "b"], [rep.id, "a"]]), rules });
  const op = name => res.cardOps.find(o => o.name === name);
  check("turn: the Dark Events used land where the GM chose; the one not used is discarded",
    op("Propaganda").op === "use" && op("Propaganda").territory === "b" && op("Reprisal").op === "use" && op("Crackdown").op === "skip");
  const alone = turn.resolvePlan(tplan, new Set([prop.id]), docs, { choices: new Map([[prop.id, "b"]]), rules });
  check("turn: a used Dark Event's numbers land on its territory, through its Reputation bar",
    alone.updates.some(u => (u._id === "b") && (u["system.reputationPoints"] === 2) && !("system.reputation" in u)), JSON.stringify(alone.updates));
  const fall = turn.resolvePlan({ lines: [{ id: "x", hidden: true, ops: [{ id: "b", path: "system.reputation", rep: -3 }, { id: "b", path: "system.reputation", rep: -3 }] }] }, new Set(),
    new Map([["b", { system: { reputation: 1, reputationPoints: 3 } }]]));
  check("turn: Reputation ops chain on one territory: the first empties the bar and drops a level, the second eats into the new one",
    eq(fall.updates, [{ _id: "b", "system.reputation": 0, "system.reputationPoints": 2 }]) && eq(fall.before, [{ _id: "b", "system.reputation": 1, "system.reputationPoints": 3 }]));
  check("turn: the plan's lines are not changed by resolving it", !prop.ops.length);
  check("turn: the Event phase's Logistics go to the ledger, the old card's discard to its territory",
    res.ledger.some(e => (e.resource === "logistics") && (e.amount === 10)) && res.cardOps.some(o => (o.op === "discard") && (o.name === "Distress Call")));
  const skip = turn.resolvePlan(tplan, new Set(), docs, { rules });
  check("turn: nothing ticked: no card drawn or discarded, but the drawn Dark Events go unused",
    skip.cardOps.every(o => o.op === "skip") && skip.cardOps.length === 3 && !skip.ledger.length);
  // World Events (Johnald, 2026-10-08): a neutral deck, with the Event phase by default.
  const storm = C("w1", "Ion Storm", { kind: "world", worldwide: true, negative: true, effect: { heat: -1, intel: -5 } });
  const column = C("w2", "Refugee Column", { kind: "world", persistent: true, effect: { strength: -1 } });
  const wplan = ev.planCards({ next: 2, rules, territories: terrs, eventDeck: [eventDeck[0], eventDeck[1]], darkDeck: [], worldDeck: [storm], random: seq([0]) });
  const wl = wplan.lines.find(l => l.section === "world");
  check("world events: drawn with the Event phase; a worldwide one lands everywhere but a liberated territory when negative",
    wl.text === "Ion Storm: every territory" && wl.ops.map(o => o.id).join() === "a,b" && wl.ops.every(o => (o.path === "system.heatPending") && (o.delta === -1))
      && wl.ledger[0].amount === -5 && wl.card.from === "worldDeck" && wl.card.kind === "world" && wl.card.territory === "");
  const w2 = ev.planCards({ next: 2, rules, territories: terrs, eventDeck: [eventDeck[0], eventDeck[1]], darkDeck: [], worldDeck: [column], random: seq([0]) });
  const taken = w2.lines.filter(l => l.section === "events").map(l => l.card.territory);
  const landedOn = w2.lines.find(l => l.section === "world").card.territory;
  check("world events: one that lands goes where the Event phase did not, and can stay in play",
    !taken.includes(landedOn) && w2.lines.find(l => l.section === "world").card.place === true && /Strength -3/.test(w2.lines.find(l => l.section === "world").detail));
  check("world events: none on odd weeks, none when the rule draws none",
    !ev.planCards({ next: 3, rules, territories: terrs, worldDeck: [storm] }).lines.length
      && !ev.planCards({ next: 2, rules: strat.strategyRules({ worldEventDraw: 0 }), territories: terrs, eventDeck: [], worldDeck: [storm] }).lines.some(l => l.section === "world"));
  check("world events: decks set up before the World Event deck existed say how to add it",
    /no World Event deck yet/.test(ev.planCards({ next: 2, rules, territories: terrs, eventDeck: [], darkDeck: [] }).warnings.join()));
  const expiring = ev.planCards({ next: 6, rules, territories: terrs, inPlay: [C("w3", "Long Storm", { kind: "world", persistent: true, worldwide: true, discard: { reputation: 1 } }, { territory: "", week: 4 })] });
  check("world events: a worldwide card leaving play gives its discard effect everywhere",
    expiring.lines[0].text === "Long Storm leaves every territory" && expiring.lines[0].ops.length === 3);
  const choices = proj.tacticalChoices([], [{ id: "card:p1", label: "Respond: Distress Call", territory: "b", rewards: "x", heat: "minor" }]);
  check("cards: a card in play that can be answered is a Tactical Action there",
    choices.at(-1).response === true && choices.at(-1).revealed === false && choices.at(-1).key === "card:p1" && choices.at(-1).territory === "b");
}

// Losing Ground (Strategy Layer step 7, 2026-10-08).
{
  const rules = strat.strategyRules({});
  const T = (id, name, kind, system = {}) => ({ id, name, system: { kind, control: "genesis", strength: 0, heat: 0, heatPending: 0, quietWeeks: 0,
    active: false, objectives: { citadel: false, motorPool: false, government: false }, neighbors: [], ...system } });
  // A Megacity (mc) with slums and wildland around it, another Megacity next door, a farm beyond the slums.
  const world = [
    T("mc", "Neo Seattle", "megacity", { strength: 6, heat: 2, neighbors: ["s1", "w1", "mc2"], objectives: { citadel: true, motorPool: true, government: true } }),
    T("s1", "Spokane Subsector", "slums", { strength: 3, heat: 1, neighbors: ["mc", "far"] }),
    T("w1", "Old Victoria", "wildland", { strength: 1, neighbors: ["mc"] }),
    T("mc2", "Neo Portland", "megacity", { strength: 5, heat: 3, neighbors: ["mc"] }),
    T("far", "Redwood Havens", "rural", { strength: 2, heat: 3, neighbors: ["s1", "edge"] }),
    T("edge", "Black Hills", "rural", { neighbors: ["far"] })
  ];
  check("losing ground: a Megacity's objectives taken", lg.objectivesTaken(world[0].system) === 3 && lg.objectivesTaken(world[1].system) === 0);
  const area = lg.liberationArea(world[0], world);
  check("losing ground: liberating a Megacity frees it and the territories around it, but not another Megacity",
    area.map(t => t.id).join() === "mc,s1,w1");
  check("losing ground: what is near, by borders", lg.nearby(["mc", "s1", "w1"], world, 1).map(n => n.territory.id).join() === "mc2,far"
    && lg.nearby(["mc", "s1", "w1"], world, 2).map(n => `${n.territory.id}:${n.distance}`).join() === "mc2:1,far:1,edge:2");
  const spike = lg.liberationSpike(["mc", "s1", "w1"], world, rules);
  check("losing ground: territories near a liberation spike in Heat, held to Maximum",
    spike.map(s => `${s.id}:${s.from}>${s.to}`).join() === "mc2:3>4,far:3>4,edge:0>2");
  check("losing ground: nothing spikes with no reach", !lg.liberationSpike(["mc"], world, strat.strategyRules({ liberationReach: 0 })).length);
  const updates = lg.liberationUpdates(["mc", "s1"], spike.slice(0, 1));
  check("losing ground: liberated, GENESIS's Strength there is gone; the spike lands",
    updates[0]["system.control"] === "liberated" && updates[0]["system.strength"] === 0 && updates[1]._id === "s1" && updates[2]["system.heat"] === 4);
  check("losing ground: Megacities liberated of all", JSON.stringify(lg.megacityCount([{ system: { kind: "megacity", control: "liberated" } }, { system: { kind: "megacity" } }, { system: { kind: "rural" } }])) === '{"liberated":1,"total":2}');

  // Incursions.
  const freed = world.map(t => (["mc", "s1", "w1"].includes(t.id) ? { ...t, system: { ...t.system, control: "liberated", strength: 0 } } : t));
  const str = { mc2: 20, far: 23, edge: 0 };
  const strengthOf = id => str[id] ?? 0;
  const launch = lg.planIncursions({ next: 5, territories: freed, strengthOf, incursions: [], rules });
  check("losing ground: a neighbour at Strength 20 launches an Incursion against a liberated territory; the strongest, once each",
    launch.length === 2 && launch[0].text === "Incursion: GENESIS masses in Neo Portland to retake Neo Seattle"
      && launch[0].incursion.op === "open" && launch[0].incursion.source === "mc2"
      && launch[1].text === "Incursion: GENESIS masses in Redwood Havens to retake Spokane Subsector" && /lands as turn 6 starts/.test(launch[0].detail));
  check("losing ground: under Strength 20, nothing", !lg.planIncursions({ next: 5, territories: freed, strengthOf: () => 19, rules }).length);
  const open = [{ id: "i1", target: "mc", source: "mc2", week: 5 }];
  const waiting = lg.planIncursions({ next: 5, territories: freed, strengthOf, incursions: open, rules });
  check("losing ground: one under way is not launched twice, and does not land early",
    !waiting.some(l => /retake Neo Seattle/.test(l.text)) && !waiting.some(l => l.incursion.op === "land"));
  const lands = lg.planIncursions({ next: 6, territories: freed, strengthOf, incursions: open, rules }).find(l => l.incursion.op === "land");
  check("losing ground: left alone, it lands: Contested, 8 Strength in from where it massed, a Megacity's objectives lost",
    lands.text === "Neo Seattle falls: the Incursion from Neo Portland lands" && lands.incursion.id === "i1"
      && lands.ops.some(o => (o.id === "mc") && (o.path === "system.control") && (o.set === "contested"))
      && lands.ops.some(o => (o.id === "mc") && (o.path === "system.strength") && (o.delta === 8))
      && lands.ops.some(o => (o.id === "mc2") && (o.delta === -8)) && lands.ops.some(o => (o.path === "system.objectives") && (o.set.citadel === false)));
  const dropped = lg.planIncursions({ next: 6, territories: world, strengthOf, incursions: open, rules });
  check("losing ground: an Incursion against a territory no longer liberated is dropped quietly",
    dropped.some(l => l.hidden && (l.incursion.op === "drop") && (l.incursion.id === "i1")));
  const sourceFreed = freed.map(t => (t.id === "mc2" ? { ...t, system: { ...t.system, control: "liberated" } } : t));
  check("losing ground: so is one massing in a territory liberated since",
    lg.planIncursions({ next: 6, territories: sourceFreed, strengthOf, incursions: open, rules }).some(l => l.hidden && (l.incursion.op === "drop")));
  const choice = lg.incursionChoice(open[0], id => ({ mc: "Neo Seattle" })[id] ?? id, rules);
  check("losing ground: an Incursion is a high-priority Tactical Action where GENESIS masses",
    choice.label === "Stop the Incursion into Neo Seattle" && choice.territory === "mc2" && choice.priority && /lands as turn 6 starts/.test(choice.rewards));
  const tc = proj.tacticalChoices([], [], [choice]);
  check("losing ground: Incursions come first; the Megacity assault is always open",
    tc[0].priority && tc[0].incursion === "i1" && tc.find(c => c.key === "megacityAssault")?.megacity && tc.find(c => c.key === "megacityAssault").heat === "critical");

  // In the turn: from Strength after the moves; ticked opens, unticked does not; drops always apply.
  const tplan = turn.planTurn({ week: 4, territories: freed.map(t => (t.id === "mc2" ? { ...t, system: { ...t.system, strength: 20 } } : t)), rules });
  const losing = tplan.lines.filter(l => l.section === "losing" && !l.hidden);
  check("turn: Losing Ground comes after the Heat, in the GENESIS phase", losing.length >= 1
    && tplan.lines.findIndex(l => l.section === "losing") > tplan.lines.findIndex(l => l.section === "heat"));
  const docs = new Map(freed.map(t => [t.id, { system: JSON.parse(JSON.stringify(t.system)) }]));
  const on = turn.resolvePlan(tplan, new Set(losing.map(l => l.id)), docs, { rules });
  const off = turn.resolvePlan(tplan, new Set(), docs, { rules });
  check("turn: a ticked Incursion opens; unticked, none", on.incursionOps.some(o => o.op === "open") && !off.incursionOps.length);

  // Reprisals destroy a regional upgrade when they leave play uncountered.
  const reprisal = { id: "r1", name: "Reprisal", img: "r.svg", system: { kind: "dark", persistent: true, reprisal: true, discard: { logistics: -20 } }, territory: "mc2", week: 2 };
  const leaves = ev.planCards({ next: 4, rules, territories: world, inPlay: [reprisal], upgrades: [{ id: "sam", name: "SAM Site", territory: "mc2" }] }).lines[0];
  check("losing ground: a Reprisal leaving play destroys a regional upgrade where it hit, back to be rebuilt",
    /The SAM Site there is destroyed/.test(leaves.detail) && leaves.ops.some(o => (o.id === "sam") && (o.path === "system.status") && (o.set === "available"))
      && leaves.ops.some(o => (o.id === "sam") && (o.path === "system.progress") && (o.set === 0)));
  const elsewhere = ev.planCards({ next: 4, rules, territories: world, inPlay: [reprisal], upgrades: [{ id: "sam", name: "SAM Site", territory: "far" }] }).lines[0];
  check("losing ground: only an upgrade where the Reprisal hit", !/destroyed/.test(elsewhere.detail) && !elsewhere.ops.some(o => o.id === "sam"));
}

// The territory card's journal (Johnald, 2026-10-08).
{
  const journals = [
    { uuid: "JournalEntry.lore", name: "Lore", pages: [{ uuid: "JournalEntry.lore.JournalEntryPage.p1", name: "Neo-Seattle" }, { uuid: "JournalEntry.lore.JournalEntryPage.p2", name: "Portlandia" }] },
    { uuid: "JournalEntry.spk", name: "Spokane Subsector", pages: [] },
    { uuid: "JournalEntry.port", name: "Portlandia", pages: [] }
  ];
  const T = (name, journal = "") => ({ name, system: { journal } });
  check("card journal: the one linked on the sheet comes first", JSON.stringify(wrm.findJournal(T("Neo Seattle", "JournalEntry.x"), journals)) === '{"uuid":"JournalEntry.x","how":"linked"}');
  check("card journal: else a page named like the territory, loosely", wrm.findJournal(T("Neo Seattle"), journals)?.uuid === "JournalEntry.lore.JournalEntryPage.p1");
  check("card journal: a page before an entry of the same name", wrm.findJournal(T("Portlandia"), journals)?.uuid === "JournalEntry.lore.JournalEntryPage.p2");
  check("card journal: else an entry named like it; else none",
    wrm.findJournal(T("Spokane Subsector"), journals)?.uuid === "JournalEntry.spk" && wrm.findJournal(T("Reno"), journals) === null);
}

// Facilities, quick viewed (Johnald, 2026-10-08).
{
  const sys = { kind: "megacity", objectives: { government: true },
    facilities: { rebellion: [{ name: " Cell ", note: "" }], genesis: [{ name: "Checkpoint", hidden: true }, { name: "  " }] } };
  const gm = wrm.quickFacilities(sys, { upgrades: ["SAM Site"], gm: true });
  check("facilities: upgrades built join the Rebellion's, names trimmed", gm.rebellion.map(f => f.name).join() === "SAM Site,Cell" && gm.rebellion[0].auto);
  check("facilities: a Megacity's objectives join GENESIS's, taken ones down; blank rows skipped",
    gm.genesis.map(f => `${f.name}${f.down ? "!" : ""}`).join() === "Military citadel,Motor pool,Center of government!,Checkpoint");
  const players = wrm.quickFacilities(sys, { gm: false });
  check("facilities: hidden ones are the GM's", !players.genesis.some(f => f.name === "Checkpoint") && players.rebellion.length === 1);
  check("facilities: anywhere else, no objectives", wrm.quickFacilities({ kind: "rural" }).genesis.length === 0);
}

// Weather on the territory card (Johnald, 2026-10-08).
{
  const base = { id: "ns", turn: 5, climate: "wet" };
  check("weather: the same territory and turn give the same weather, for everyone", JSON.stringify(wx.weatherFor(base)) === JSON.stringify(wx.weatherFor(base)));
  const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
  check("weather: a new turn, or a GM reroll, gives new weather",
    differs(wx.weatherFor(base), wx.weatherFor({ ...base, turn: 6 })) && differs(wx.weatherFor(base), wx.weatherFor({ ...base, salt: 1 })));
  check("weather: the seasons, thirteen turns each, spring first",
    [1, 13, 14, 27, 40, 52, 53].map(wx.seasonOf).join() === "Spring,Spring,Summer,Autumn,Winter,Winter,Spring"
      && wx.seasonalWave(1) === 0 && wx.seasonalWave(14) > 0.99 && wx.seasonalWave(40) < -0.99);
  const many = (input, turns) => turns.flatMap(turn => Array.from({ length: 40 }, (_, i) => wx.weatherFor({ ...input, id: `t${i}`, turn })));
  const avg = list => list.reduce((n, w) => n + w.tempF, 0) / list.length;
  const summer = [13, 14, 15];
  check("weather: deserts run hotter than mountains in summer, and summer hotter than winter",
    avg(many({ climate: "arid" }, summer)) > avg(many({ climate: "alpine" }, summer)) + 15
      && avg(many({ climate: "continental" }, summer)) > avg(many({ climate: "continental" }, [39, 40, 41])) + 30);
  const all = many({ climate: "alpine", megacity: true }, [1, 14, 27, 40]);
  check("weather: snow only at freezing, heat haze only when hot", all.filter(w => w.key === "snow").every(w => w.tempF <= 33)
    && many({ climate: "arid" }, [14]).filter(w => w.key === "haze").every(w => w.tempF >= 88) && all.some(w => w.key === "snow"));
  check("weather: Megacities get smog; the Glasslands' paraphysical storms come with their tag",
    all.some(w => w.key === "smog") && !many({ climate: "alpine" }, [1, 14]).some(w => w.key === "smog")
      && many({ climate: "arid", modifiers: "Paraphysical Storms" }, [1, 14]).some(w => w.key === "paraStorm")
      && !many({ climate: "arid" }, [1, 14]).some(w => w.key === "paraStorm"));
  const one = wx.weatherFor({ id: "x", turn: 3, climate: "temperate" });
  check("weather: Celsius from Fahrenheit, wind and a direction, all whole",
    one.tempC === Math.round((one.tempF - 32) * 5 / 9) && Number.isInteger(one.wind) && ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].includes(one.direction));
  check("weather: a briefing's line", wx.weatherLine({ label: "Rain", tempF: 48, tempC: 9, wind: 12, direction: "SW" }) === "Rain, 48°F (9°C), wind 12 mph SW");
  check("weather: an unknown climate is temperate", JSON.stringify(wx.weatherFor({ id: "q", turn: 2, climate: "lunar" })) === JSON.stringify(wx.weatherFor({ id: "q", turn: 2, climate: "temperate" })));
}

// The GM's own weather for a territory, and Celsius or Fahrenheit (Johnald, 2026-10-08).
{
  const desert = wx.weatherProfile({ climate: "arid", megacity: true });
  check("weather profile: a climate's numbers, every condition listed, smog added for a Megacity",
    desert.base === 68 && desert.weights.dust === 12 && desert.weights.snow === 0 && desert.weights.smog === 12 && !desert.custom
      && Object.keys(desert.weights).length === Object.keys(IROP.weatherConditions).length);
  const mine = { custom: true, base: 20, swing: 5, spread: 2, weights: { snow: 10, clear: 0, fog: 3 } };
  const own = wx.weatherProfile({ climate: "arid", megacity: true, modifiers: "Paraphysical Storms", custom: mine });
  check("weather profile: customized, the territory's own numbers stand alone: no smog or storms added",
    own.custom && own.base === 20 && own.weights.snow === 10 && own.weights.fog === 3 && own.weights.smog === 0 && own.weights.paraStorm === 0);
  check("weather profile: switched back off, the climate's again", wx.weatherProfile({ climate: "arid", custom: { ...mine, custom: false } }).base === 68);
  const cold = Array.from({ length: 30 }, (_, i) => wx.weatherFor({ id: `c${i}`, turn: 40, custom: mine }));
  check("weather: a customized territory draws only what it allows", cold.every(w => ["snow", "fog"].includes(w.key)) && cold.every(w => w.tempF <= 33));
  check("units: degrees F shown in C, and back", wx.tempIn(212, "C") === 100 && wx.tempIn(48, "F") === 48 && wx.spanIn(18, "C") === 10
    && wx.toF(100, "C") === 212 && wx.toF(10, "C", { span: true }) === 18 && wx.toF(50, "F") === 50);
  check("units: a briefing in Celsius puts Celsius first",
    wx.weatherLine({ label: "Rain", tempF: 48, tempC: 9, wind: 12, direction: "SW" }, "C") === "Rain, 9°C (48°F), wind 12 mph SW");
  check("weather: a territory's weather from its sheet data matches the long way round",
    JSON.stringify(wx.territoryWeather("ns", { kind: "megacity", climate: "wet", weatherSalt: 2, modifiers: "" }, 7))
      === JSON.stringify(wx.weatherFor({ id: "ns", turn: 7, climate: "wet", megacity: true, salt: 2 })));
}

// The calendar (Johnald, 2026-10-08): the Gregorian calendar by default, editable by the GM.
{
  const cal = await import("../module/rules/calendar.mjs");
  const g = cal.normalizeCalendar({});
  const at = (year, month, dayOfMonth, extra = {}) => cal.timeToComponents(g, cal.dateToTime(g, { year, month, dayOfMonth, ...extra }));
  const long = (...d) => cal.formatDate(g, at(...d));
  check("calendar: an empty setting is the Gregorian calendar", cal.sameCalendar({}, cal.GREGORIAN) && g.name === "Gregorian" && g.months.length === 12 && g.weekdays[0].name === "Sunday");
  check("calendar: real weekdays (1 June 2040, 1 January 2000, 20 July 1969, 8 October 2026)",
    long(2040, 5, 0) === "Friday, 1 June 2040" && long(2000, 0, 0) === "Saturday, 1 January 2000"
      && long(1969, 6, 19) === "Sunday, 20 July 1969" && long(2026, 9, 7) === "Thursday, 8 October 2026"
      && long(2040, 0, 0) === "Sunday, 1 January 2040", long(2040, 5, 0));
  check("calendar: Gregorian leap years, centuries only by 400",
    cal.isLeapYear(g, 2040) && cal.isLeapYear(g, 2000) && !cal.isLeapYear(g, 1900) && !cal.isLeapYear(g, 2041) && cal.isLeapYear(g, 0)
      && cal.yearDays(g, 2040) === 366 && cal.yearDays(g, 2041) === 365);
  check("calendar: 29 February in a leap year; in another year the 28th",
    long(2040, 1, 28) === "Wednesday, 29 February 2040" && long(2041, 1, 28) === "Thursday, 28 February 2041" && long(2041, 2, 0) === "Friday, 1 March 2041");
  let wrong = 0;
  for ( let i = 0; i < 4000; i++ ) {
    const t = (Math.floor(Math.random() * 3000 * 365.25) * 86400) + Math.floor(Math.random() * 86400);
    if ( cal.dateToTime(g, cal.timeToComponents(g, t)) !== t ) wrong++;
  }
  check("calendar: seconds to a date and back, 4000 random moments over 3000 years", wrong === 0, `${wrong} wrong`);
  const d = at(2040, 5, 0, { hour: 14, minute: 5 });
  check("calendar: Foundry's components: day of the year, month and day from 0, the time of day",
    d.day === 152 && d.month === 5 && d.dayOfMonth === 0 && d.dayOfWeek === 5 && d.hour === 14 && d.minute === 5 && d.leapYear && cal.formatTime(d) === "14:05");
  check("calendar: Foundry's reading of components back to seconds (years, then day of the year), spans too",
    cal.componentsToTime(g, { year: 2040, day: 152, hour: 14, minute: 5 }) === cal.dateToTime(g, { year: 2040, month: 5, dayOfMonth: 0, hour: 14, minute: 5 })
      && cal.componentsToTime(g, { day: 7 }) === 7 * 86400 && cal.componentsToTime(g, { year: -1 }) === -366 * 86400);
  const season = (m, day) => cal.seasonName(g, at(2040, m, day));
  check("calendar: the weather's seasons, spring from 1 March, winter running over the new year",
    season(2, 0) === "Spring" && season(1, 28) === "Winter" && season(5, 0) === "Summer" && season(7, 30) === "Summer"
      && season(8, 0) === "Autumn" && season(11, 0) === "Winter" && season(0, 10) === "Winter");
  check("calendar: warmest in high summer, coldest in deep winter",
    cal.warmth(g, at(2040, 6, 15)) > 0.95 && cal.warmth(g, at(2040, 0, 15)) < -0.95 && Math.abs(cal.warmth(g, at(2040, 3, 15))) < 0.2);
  check("calendar: short and plain forms, and a word after the year",
    cal.formatDate(g, at(2040, 5, 0), { style: "short" }) === "Fri 1 Jun 2040" && cal.formatDate(g, at(2040, 5, 0), { style: "date" }) === "1 June 2040"
      && cal.formatDate({ ...g, era: "AE" }, at(2040, 5, 0)) === "Friday, 1 June 2040 AE");
  const june = cal.monthGrid(g, 2040, 5, { today: at(2040, 5, 9), selected: { year: 2040, month: 5, dayOfMonth: 20 } });
  const cells = june.weeks.flat();
  check("calendar: June 2040's page starts on Friday, 30 days, today and the picked day marked, summer's first day marked",
    june.title === "June 2040" && june.weekdays.map(w => w.abbr).join() === "Sun,Mon,Tue,Wed,Thu,Fri,Sat"
      && june.weeks[0].slice(0, 5).every(c => c.blank) && june.weeks[0][5].day === 1 && cells.filter(c => !c.blank).length === 30
      && cells.find(c => c.today)?.day === 10 && cells.find(c => c.selected)?.day === 21 && cells.find(c => c.day === 1).season === "Summer");
  check("calendar: turning the pages over the year's end, never before year 0",
    JSON.stringify(cal.shiftMonth(g, 2040, 11, 1)) === JSON.stringify({ year: 2041, month: 0 })
      && JSON.stringify(cal.shiftMonth(g, 2040, 0, -1)) === JSON.stringify({ year: 2039, month: 11 })
      && JSON.stringify(cal.shiftMonth(g, 0, 0, -3)) === JSON.stringify({ year: 0, month: 0 }));

  // A GM's own calendar: ten months of 36 days, a six day week, a leap day every 5th year.
  const own = cal.normalizeCalendar({
    name: "Reclamation", era: "AR",
    months: { 0: { name: "Thaw", days: "36" }, 1: { name: "", days: 36 }, ...Object.fromEntries([2, 3, 4, 5, 6, 7, 8].map(i => [i, { name: `M${i}`, days: 36 }])), 9: { name: "Ash", days: 36, leapDays: 37 } },
    weekdays: [{ name: "Oneday" }, { name: "Twoday" }, { name: "Threeday" }, { name: "Fourday" }, { name: "Fiveday" }, { name: "Restday", abbr: "Rst" }],
    leap: { rule: "every", every: "5", start: 0 },
    seasons: [{ name: "Thaw", month: 0, day: 1 }, { name: "Burn", month: 3, day: 1 }, { name: "Fall", month: 6, day: 1 }, { name: "Freeze", month: 8, day: 40 }]
  });
  check("calendar: the GM's months and weekdays from a form, blanks filled, numbers read",
    own.months.length === 10 && own.months[1].name === "Month 2" && own.months[0].abbr === "Tha" && own.months[0].days === 36
      && own.months[9].leapDays === 37 && own.weekdays.length === 6 && own.weekdays[5].abbr === "Rst" && own.leap.every === 5
      && own.seasons[3].day === 36);
  check("calendar: a leap year every 5th, 360 days or 361",
    cal.isLeapYear(own, 5) && !cal.isLeapYear(own, 6) && cal.yearDays(own, 10) === 361 && cal.yearDays(own, 11) === 360
      && cal.leapYearsBefore(own, 11) === 3);
  let ownWrong = 0;
  for ( let i = 0; i < 2000; i++ ) {
    const t = Math.floor(Math.random() * 400 * 360) * 86400;
    if ( cal.dateToTime(own, cal.timeToComponents(own, t)) !== t ) ownWrong++;
  }
  const leapDay = cal.timeToComponents(own, cal.dateToTime(own, { year: 10, month: 9, dayOfMonth: 36 }));
  check("calendar: the GM's calendar round trips, and its leap day exists only in a leap year",
    ownWrong === 0 && leapDay.month === 9 && leapDay.dayOfMonth === 36
      && cal.timeToComponents(own, cal.dateToTime(own, { year: 11, month: 9, dayOfMonth: 36 })).dayOfMonth === 35, `${ownWrong} wrong`);
  check("calendar: without a Summer, warmest at mid year", cal.warmth(own, cal.timeToComponents(own, cal.dateToTime(own, { year: 11, month: 5, dayOfMonth: 0 }))) > 0.99);
  check("calendar: no seasons when the GM removes them all", cal.normalizeCalendar({ seasons: [] }).seasons.length === 0
    && cal.seasonName(cal.normalizeCalendar({ seasons: [] }), at(2040, 5, 0)) === "");

  // Editing keeps today as it reads.
  const t31 = cal.dateToTime(g, { year: 2040, month: 2, dayOfMonth: 30, hour: 9 });
  const shortMarch = cal.normalizeCalendar({ ...g, months: g.months.map((m, i) => (i === 2 ? { ...m, days: 30 } : m)) });
  const carried = cal.timeToComponents(shortMarch, cal.carryDate(g, shortMarch, t31));
  check("calendar: an edit keeps today's date, the month's last day if the month got shorter",
    carried.year === 2040 && carried.month === 2 && carried.dayOfMonth === 29 && carried.hour === 9);
  const fewer = cal.normalizeCalendar({ ...g, months: g.months.slice(0, 3) });
  const dec = cal.timeToComponents(fewer, cal.carryDate(g, fewer, cal.dateToTime(g, { year: 2040, month: 11, dayOfMonth: 4 })));
  check("calendar: a month that is gone becomes the last month", dec.year === 2040 && dec.month === 2 && dec.dayOfMonth === 4);
  const today = Math.floor(cal.dateToTime(g, { year: 2040, month: 5, dayOfMonth: 0 }) / 86400);
  const moved = { ...g, firstWeekday: cal.anchorWeekday(g, today, 2) };
  check("calendar: the GM puts today on another weekday", cal.timeToComponents(moved, today * 86400).dayOfWeek === 2);

  // The weather follows the calendar's season.
  const plain = { custom: true, base: 50, swing: 20, spread: 0, weights: { clear: 1 } };
  const summer = wx.weatherFor({ id: "x", turn: 3, custom: plain, season: { wave: 1, name: "Summer" } });
  const winter = wx.weatherFor({ id: "x", turn: 3, custom: plain, season: { wave: -1, name: "Winter" } });
  check("weather: the calendar's season sets the warmth and the name", summer.tempF === 70 && winter.tempF === 30 && summer.season === "Summer" && winter.season === "Winter");
  check("weather: without a calendar, the turn sets the season as before", wx.weatherFor({ id: "x", turn: 1, custom: plain }).season === "Spring"
    && wx.weatherFor({ id: "x", turn: 1, custom: plain }).tempF === 50);

  // Foundry's own calendar gets the same months and days.
  const core = cal.toCoreConfig(g);
  check("calendar: handed to Foundry with its months, weekdays and seasons",
    core.months.values.length === 12 && core.months.values[1].leapDays === 29 && !("leapDays" in core.months.values[0])
      && core.months.values.every((m, i) => m.ordinal === i + 1) && core.days.daysPerYear === 365 && core.days.values[0].name === "Sunday"
      && core.years.firstWeekday === 6 && core.seasons.values[0].dayStart === 60 && core.seasons.values[3].dayEnd === 59);
}

// Never in (Johnald, 2026-10-08): territories a card never lands on or is played on.
{
  const seq = values => { let i = 0; return () => values[i++ % values.length]; };
  const C = (id, name, system = {}, extra = {}) => ({ id, name, img: `${id}.svg`, system, ...extra });
  const T = (id, name, control = "genesis") => ({ id, name, system: { control } });
  const terrs = [T("a", "Neo Seattle"), T("b", "Portlandia"), T("c", "Redwood Havens")];
  const rules = strat.strategyRules({});
  const x = C("x", "Dust Bowl", { excluded: ["a", "b"] });
  const y = C("y", "Flood", { excluded: ["a"] });
  const z = C("z", "Supply Drop");
  let always = true;
  for ( let i = 0; i < 60; i++ ) {
    const { pairs, unplaced } = ev.placeCards([x, y, z], terrs, 3);
    const where = Object.fromEntries(pairs.map(([c, t]) => [c.id, t.id]));
    if ( (pairs.length !== 3) || unplaced.length || (where.x !== "c") || (where.y !== "b") || (where.z !== "a") ) always = false;
  }
  check("never in: three cards, three territories: each card lands where it may, every time", always);
  check("never in: the card knows where it may land", !ev.canLand(x, "a") && ev.canLand(x, "c") && ev.placesFor(y, terrs).map(t => t.id).join() === "b,c");
  const nowhere = C("w", "Glass Rain", { excluded: ["a", "b", "c"] });
  const put = ev.placeCards([nowhere, z], terrs, 1, seq([0]));
  check("never in: a card with nowhere to land stays in the deck, and the next is drawn in its place",
    put.pairs.length === 1 && put.pairs[0][0].id === "z" && put.unplaced.map(c => c.id).join() === "w");
  const plain = [z, C("q", "Riot"), C("r", "Uprising")];
  const r1 = seq([0.6, 0.2, 0.9, 0.4]);
  const r2 = seq([0.6, 0.2, 0.9, 0.4]);
  const before = ev.pickDistinct(plain, 2, r2);
  const spots = ev.pickDistinct(terrs, 2, r2);
  const now = ev.placeCards(plain, terrs, 2, r1);
  check("never in: with no lists, the draw and placement are exactly as before",
    JSON.stringify(now.pairs.map(([c, t]) => [c.id, t.id])) === JSON.stringify(before.map((c, i) => [c.id, spots[i].id])));
  const plan = ev.planCards({ next: 2, rules, territories: terrs, eventDeck: [nowhere, x], darkDeck: [], worldDeck: [], random: seq([0]) });
  const events = plan.lines.filter(l => l.section === "events");
  check("never in: in the turn plan, the Event phase works round the lists and says what stayed in the deck",
    events.length === 1 && events[0].text === "Dust Bowl lands on Redwood Havens" && /Glass Rain has nowhere it may land/.test(plan.warnings.join(" ")));

  // World Events.
  const storm = C("s", "Ion Storm", { kind: "world", excluded: ["a", "b"], effect: { heat: 1 } });
  const wplan = ev.planCards({ next: 2, rules, territories: terrs, eventDeck: [], darkDeck: [], worldDeck: [storm], random: seq([0]) });
  check("never in: a World Event lands only where it may", wplan.lines.find(l => l.section === "world")?.text === "Ion Storm lands on Redwood Havens");
  const glass = C("g", "Glass Storm", { kind: "world", excluded: ["a", "b", "c"] });
  const w2 = ev.planCards({ next: 2, rules, territories: terrs, eventDeck: [], darkDeck: [], worldDeck: [glass, storm], random: seq([0]) });
  check("never in: a World Event with nowhere to land stays in the deck, and the next World Event is drawn",
    w2.lines.filter(l => l.section === "world").map(l => l.text).join() === "Ion Storm lands on Redwood Havens" && /Glass Storm has nowhere it may land/.test(w2.warnings.join(" ")));
  const wide = C("v", "Blackout", { kind: "world", worldwide: true, excluded: ["b"], effect: { strength: 1 } });
  const w3 = ev.planCards({ next: 2, rules, territories: terrs, eventDeck: [], darkDeck: [], worldDeck: [wide], random: seq([0]) });
  check("never in: a worldwide card's numbers skip the territories it is never in",
    w3.lines.find(l => l.section === "world").ops.map(o => o.id).join() === "a,c");
  const leaving = ev.planCards({ next: 6, rules, territories: terrs, inPlay: [C("v2", "Blackout", { kind: "world", persistent: true, worldwide: true, excluded: ["c"], discard: { reputation: 1 } }, { territory: "", week: 4 })] });
  check("never in: and so does its discard", leaving.lines[0].ops.map(o => o.id).join() === "a,b");

  // Dark Events: the GM chooses where, but not there.
  const dplan = ev.planCards({ next: 4, rules, territories: terrs, eventDeck: [], darkDeck: [C("d", "Purge", { kind: "dark", excluded: ["a"], effect: { reputation: -1 } })], worldDeck: [], random: seq([0]) });
  const dark = dplan.lines.find(l => l.section === "dark").card;
  check("never in: a Dark Event carries its list to the GM's choice", dark.excluded.join() === "a" && dark.needsTerritory);
  check("never in: a Dark Event cannot be used on a territory it is never in",
    /Purge never happens there/.test(ev.checkDarkChoice([{ card: dark, territory: "a" }], rules)) && ev.checkDarkChoice([{ card: dark, territory: "b" }], rules) === null);
}

// A full reset of an operative (Johnald, 2026-10-08).
{
  const rs = await import("../module/rules/reset.mjs");
  const blank = { attributes: { str: { value: 30 } }, xp: { earned: 0, log: [] }, wealth: { credits: 100 },
    details: { callsign: "", biography: "", notes: "", record: { first: "" }, startingSkills: { role: "", background: "" } } };
  const now = { attributes: { str: { value: 55 } }, xp: { earned: 400, log: [{ kind: "award", xp: 300, label: "OP-1" }, { kind: "award", xp: 100 }, { kind: "perk", xp: 60 }, { kind: "skill", xp: 20 }] },
    wealth: { credits: 900, alloys: 4 },
    details: { callsign: "Ghost", biography: "<p>Bio</p>", notes: "<p>Notes</p>", record: { first: "Kael" }, startingSkills: { role: "Outrider", background: "Drifter" } } };
  const full = rs.resetSystem(blank, now);
  check("reset: a full reset is a new operative's data, nothing carried over", JSON.stringify(full) === JSON.stringify(blank) && full !== blank);
  const kept = rs.resetSystem(blank, now, { identity: true, gear: true, xp: true });
  check("reset: kept on request: who they are, their wealth, the XP earned with only the awards on the ledger",
    kept.details.callsign === "Ghost" && kept.details.record.first === "Kael" && kept.details.notes === "<p>Notes</p>" && kept.details.biography === "<p>Bio</p>"
      && kept.details.startingSkills.role === "" && kept.wealth.credits === 900 && kept.wealth.alloys === 4
      && kept.xp.earned === 400 && kept.xp.log.length === 2 && kept.xp.log.every(e => e.kind === "award") && kept.attributes.str.value === 30);
  const items = [{ id: "w", type: "weapon" }, { id: "a", type: "armor" }, { id: "g", type: "gear" }, { id: "m", type: "mod" },
    { id: "r", type: "role" }, { id: "s", type: "species" }, { id: "b", type: "background" }, { id: "p", type: "ability" }, { id: "bo", type: "boon" }, { id: "mu", type: "mutation" }];
  check("reset: every item goes; keeping the gear keeps weapons, armor, gear and mods",
    rs.resetItems(items).length === 10 && rs.resetItems(items, { gear: true }).join() === "r,s,b,p,bo,mu");
  check("reset: what was kept, in words", rs.keptWords({}) === "Nothing was kept." && rs.keptWords({ gear: true }) === "Kept their gear."
    && rs.keptWords({ identity: true, gear: true, xp: true }) === "Kept who they are, their gear and the XP earned.");
}

// What stacks (Johnald, 2026-10-10: grenades dragged from the sidebar did not stack).
{
  const stacks = await import("../module/rules/stacks.mjs");
  const w = (system, name = "X", id = undefined) => ({ type: "weapon", name, id, system });
  check("stacks: grenades, rockets, explosives and single-use launchers stack; guns and loading launchers do not; gear always",
    stacks.isStackable(w({ weaponClass: "grenade" })) && stacks.isStackable(w({ weaponClass: "rocket" })) && stacks.isStackable(w({ weaponClass: "explosive" }))
      && stacks.isStackable(w({ weaponClass: "launcher", feed: "singleUse" })) && !stacks.isStackable(w({ weaponClass: "rifles" }))
      && !stacks.isStackable(w({ weaponClass: "launcher", feed: "grenades" })) && stacks.isStackable({ type: "gear", system: {} })
      && !stacks.isStackable({ type: "armor", system: {} }) && !stacks.isStackable(null));
  const items = [
    w({ weaponClass: "grenade", stowed: true }, "Frag Grenade", "a"),
    w({ weaponClass: "grenade" }, "Frag Grenade", "b"),
    w({ weaponClass: "smallArms" }, "T1 Pistol", "c"),
    { type: "gear", name: "Frag Grenade", id: "d", system: {} }
  ];
  check("stacks: a grenade joins the one of its name not stowed away; a gun never stacks; gear joins gear",
    (stacks.stackFor(items, w({ weaponClass: "grenade" }, "Frag Grenade"))?.id === "b")
      && (stacks.stackFor(items, w({ weaponClass: "smallArms" }, "T1 Pistol")) === null)
      && (stacks.stackFor(items, { type: "gear", name: "Frag Grenade", system: {} })?.id === "d")
      && (stacks.stackFor(items, w({ weaponClass: "grenade" }, "Smoke Grenade")) === null));
  check("stacks: one from the sidebar sharing its id with the copy on the sheet still joins it",
    stacks.stackFor([items[0]], w({ weaponClass: "grenade" }, "Frag Grenade", "a"))?.id === "a");
}

// Stores (Johnald, 2026-10-10): prices with markup, buying back, purchases and sales checked,
// what goes on a shelf and what a buyer gets.
{
  const st = await import("../module/rules/store.mjs");
  check("store: markup over the item's price, rounded; a discount; never below 0",
    (st.storePrice(25, 0) === 25) && (st.storePrice(25, 20) === 30) && (st.storePrice(25, -10) === 23)
      && (st.storePrice(10, -90) === 1) && (st.storePrice(-5, 0) === 0));
  check("store: buying back is a share of the price, rounded down; at 0 it buys nothing",
    (st.buyBackPrice(25, 50) === 12) && (st.buyBackPrice(80, 50) === 40) && (st.buyBackPrice(80, 0) === 0) && (st.buyBackPrice(80, 150) === 80));
  check("store: prices read as the armory prints them",
    (st.priceText(25) === "25 cr") && (st.priceText(4, "valuables") === "4 Valuables") && (st.priceText(2, "alloys") === "2 Alloys"));
  check("store: where each currency sits on the sheet",
    (st.walletPath("valuables") === "system.wealth.valuables") && (st.walletPath("gold") === "system.wealth.credits")
      && (st.walletOf({ system: { wealth: { credits: 200 } } }, "credits") === 200) && (st.walletOf(null, "credits") === 0));
  // A price per currency, and which may buy it (Johnald, 2026-10-10).
  const multi = { system: { prices: { credits: 20, valuables: 2, alloys: 0 }, accepts: { credits: true, valuables: true, alloys: true } } };
  const refusing = { system: { prices: { credits: 15, valuables: 1 }, accepts: { valuables: false } } };
  check("store: a currency buys an item when ticked and priced; 0 is no price, not free",
    st.accepts(multi, "credits") && st.accepts(multi, "valuables") && !st.accepts(multi, "alloys")
      && st.accepts(refusing, "credits") && !st.accepts(refusing, "valuables") && (st.acceptedCurrencies(refusing).join() === "credits")
      && (st.priceIn(multi, "valuables") === 2) && (st.priceIn({}, "credits") === 0) && !st.accepts(multi, "gold"));
  check("store: paid in what the player picks if the item takes it, else the store's preferred, else the first it takes",
    (st.payCurrency(multi, "credits", "valuables") === "valuables") && (st.payCurrency(multi, "valuables") === "valuables")
      && (st.payCurrency(multi, "alloys") === "credits") && (st.payCurrency(refusing, "credits", "valuables") === "credits")
      && (st.payCurrency({ system: { prices: {} } }, "credits") === null));
  check("store: bought back in the store's preferred currency if the item has a price there, else its first; the ticks are for buying",
    (st.sellCurrency(multi, "valuables") === "valuables") && (st.sellCurrency(multi, "alloys") === "credits")
      && (st.sellCurrency(refusing, "valuables") === "valuables") && (st.sellCurrency({ system: {} }, "credits") === null));
  check("store: an item on a shelf is unlimited and on show unless set",
    (JSON.stringify(st.shelfOf({})) === JSON.stringify({ limited: false, stock: 0, hidden: false }))
      && (st.shelfOf({ flags: { irop: { shelf: { limited: true, stock: 3.7, hidden: 1 } } } }).stock === 3));
  const open = { limited: false, stock: 0, hidden: false };
  const buy = args => st.checkPurchase({ unitPrice: 30, qty: 2, wallet: 100, shelf: open, name: "Frag Grenade", ...args });
  check("store: a purchase the purse covers goes ahead, at the price times how many", buy({}).ok && (buy({}).total === 60));
  check("store: short of money, it says how much is needed and how much is held",
    !buy({ wallet: 50 }).ok && (buy({ wallet: 50 }).error === "Not enough Credits: 60 needed, 50 on hand."));
  check("store: limited stock: too few left, or sold out",
    (buy({ shelf: { limited: true, stock: 1, hidden: false } }).error === "Only 1 Frag Grenade left.")
      && (buy({ shelf: { limited: true, stock: 0, hidden: false } }).error === "Frag Grenade is sold out.")
      && buy({ shelf: { limited: true, stock: 2, hidden: false } }).ok);
  check("store: hidden from players, though a GM may buy it; at least one",
    !buy({ shelf: { ...open, hidden: true } }).ok && buy({ shelf: { ...open, hidden: true }, isGM: true }).ok
      && (buy({ qty: 0 }).error === "Buy at least one."));
  check("store: priced in Alien Alloys, the alloys are what is checked",
    buy({ currency: "alloys", wallet: 10 }).error === "Not enough Alien Alloys: 60 needed, 10 on hand.");
  const medkits = (system = {}) => ({ type: "gear", name: "Medkit", system: { prices: { credits: 20 }, quantity: 3, ...system } });
  check("store: a sale pays the store's share of the price for each one, in its currency",
    JSON.stringify(st.checkSale({ item: medkits(), qty: 2, sellBack: 50 })) === JSON.stringify({ ok: true, unit: 10, total: 20, currency: "credits" })
      && (JSON.stringify(st.checkSale({ item: medkits({ prices: { credits: 20, valuables: 4 } }), qty: 1, sellBack: 50, preferred: "valuables" }))
        === JSON.stringify({ ok: true, unit: 2, total: 2, currency: "valuables" })));
  check("store: no sale to a store that buys nothing, of more than is held, or of what has no price or is worth nothing",
    (st.checkSale({ item: medkits(), qty: 1, sellBack: 0 }).error === "This store does not buy.")
      && (st.checkSale({ item: medkits(), qty: 4, sellBack: 50 }).error === "Medkit: only 3 to sell.")
      && /has no price/.test(st.checkSale({ item: medkits({ prices: { credits: 0 } }), qty: 1, sellBack: 50 }).error)
      && /worth nothing here/.test(st.checkSale({ item: medkits({ prices: { credits: 1 } }), qty: 1, sellBack: 50 }).error));
  check("store: what is fitted or loaded, or not a carried thing, cannot be sold",
    /fitted/.test(st.unsellable({ type: "mod", name: "Red Dot", system: { prices: { credits: 10 }, installedOn: "w1" } }))
      && /loaded/.test(st.unsellable({ type: "gear", name: "Cryo Rounds", system: { prices: { credits: 10 }, loadedIn: "w1" } }))
      && /Only weapons, armor, gear and mods/.test(st.unsellable({ type: "ability", name: "Dash", system: {} }))
      && (st.unsellable(medkits()) === ""));
  const onShelf = st.shelfData({ _id: "x", type: "weapon", name: "Grenade Launcher",
    system: { quantity: 3, equipped: true, stowed: true, loaded: [{ name: "Frag" }] }, flags: { core: { a: 1 } } });
  // Johnald, 2026-10-10: a store has only as many as were put on it.
  check("store: an item goes on a shelf not worn, stowed or loaded, on show, with as many in stock as were put there",
    !("_id" in onShelf) && (onShelf.system.quantity === 1) && !onShelf.system.equipped && !onShelf.system.stowed && (onShelf.system.loaded.length === 0)
      && (JSON.stringify(onShelf.flags.irop.shelf) === JSON.stringify({ limited: true, stock: 3, hidden: false })) && (onShelf.flags.core.a === 1)
      && (st.shelfData({ type: "weapon", name: "Rifle", system: {} }).flags.irop.shelf.stock === 1));
  const grenades = st.purchaseData({ _id: "s1", type: "weapon", name: "Frag Grenade", system: { weaponClass: "grenade", quantity: 1, prices: { credits: 30 } },
    flags: { irop: { shelf: { limited: true, stock: 4 } } } }, 3);
  const rifles = st.purchaseData({ _id: "s2", type: "weapon", name: "T2 Rifle", system: { weaponClass: "rifles", quantity: 1 },
    flags: { irop: { shelf: {} } } }, 2);
  check("store: three grenades bought come as one item of three, without the shelf's facts; two rifles come as two",
    grenades.stackable && (grenades.items.length === 1) && (grenades.items[0].system.quantity === 3) && !grenades.items[0].flags?.irop
      && !("_id" in grenades.items[0]) && !rifles.stackable && (rifles.items.length === 2) && rifles.items.every(i => i.system.quantity === 1)
      && (rifles.items[0] !== rifles.items[1]));
}

// The turn order ribbon (Johnald, 2026-10-11): who shows where, and what a viewer reads of each.
{
  const to = await import("../module/rules/turn-order.mjs");
  check("ribbon: condition words by health left, ASSUMED bands",
    eq([[30, 30], [20, 30], [15, 30], [10, 30], [7, 30], [1, 30], [0, 30]].map(([v, m]) => to.conditionWord(v, m)),
      ["Unhurt", "Hurt", "Wounded", "Wounded", "Critical", "Critical", "Down"]) && (to.conditionWord(5, 0) === null)
      && (to.conditionWord(40, 30) === "Unhurt"));
  check("ribbon: an operative is an operative whatever its token; the rest by disposition, secret as neutral",
    (to.sideOf({ type: "operative", disposition: -1 }) === "operative") && (to.sideOf({ type: "npc", disposition: 1 }) === "ally")
      && (to.sideOf({ type: "npc", disposition: -1 }) === "hostile") && (to.sideOf({ type: "npc", disposition: 0 }) === "neutral")
      && (to.sideOf({ type: "npc", disposition: -2 }) === "neutral") && (to.sideOf({}) === "neutral"));
  check("ribbon: the GM, anyone for an operative, and an observer read the numbers; a player does not for an NPC",
    to.seesNumbers({ isGM: true, type: "npc" }) && to.seesNumbers({ type: "operative" }) && to.seesNumbers({ type: "npc", observer: true })
      && !to.seesNumbers({ type: "npc" }));
  const bars = to.vitalBars({ hp: { value: 14, max: 18 }, armor: { value: 6, max: 8 }, barrier: { value: 0, max: 0 }, energy: { value: 5, max: 9 } });
  check("ribbon: Health always, Armor when there is any, no Barrier at none, never Energy",
    eq(bars.map(b => [b.key, b.value, b.max, b.pct]), [["hp", 14, 18, 78], ["armor", 6, 8, 75]])
      && eq(to.vitalBars({ hp: { value: 0, max: 0 } }).map(b => b.key), ["hp"]) && (to.percent(9, 4) === 100) && (to.percent(-2, 4) === 0));
  check("ribbon: dodge pips filled for those left; past six, a count instead; none at no dodges",
    eq(to.dodgePips({ value: 1, max: 2 }), { pips: [true, false], value: 1, max: 2 }) && eq(to.dodgePips({ value: 5, max: 8 }).pips, [])
      && (to.dodgePips({ value: 0, max: 0 }) === null) && eq(to.dodgePips({ value: 9, max: 2 }).pips, [true, true]));

  // Wraith acts; Enforcer, Bastion, Cipher and Tether follow; a drone is down; a sniper hides.
  const E = (id, more = {}) => ({ id, defeated: false, visible: true, ...more });
  const fight = [E("wraith"), E("enforcer"), E("sniper", { visible: false }), E("bastion"), E("drone", { defeated: true }), E("cipher"), E("tether")];
  const ids = r => r.cards.map(c => c.marker ? `|${c.round}` : `${c.id}${c.active ? "*" : ""}${c.next ? ">" : ""}${c.acted ? "~" : ""}${c.down ? "x" : ""}`).join(" ");
  let r = to.ribbonOrder(fight, { activeId: "bastion", nextId: "cipher", mode: "fixed", round: 2 });
  check("ribbon, fixed: initiative order, those who acted dimmed, the defeated in place, the hidden left out",
    ids(r) === "wraith~ enforcer~ bastion* dronex cipher> tether" && (r.position === 3) && (r.count === 5), ids(r));
  r = to.ribbonOrder(fight, { activeId: "bastion", nextId: "cipher", mode: "actingFirst", round: 2 });
  check("ribbon, acting first: the acting card leads, the next round's marker, those who acted behind it, the defeated last",
    ids(r) === "bastion* cipher> tether |3 wraith enforcer dronex" && (r.position === 1) && (r.count === 5), ids(r));
  r = to.ribbonOrder(fight, { activeId: "tether", nextId: "wraith", mode: "actingFirst", round: 2 });
  check("ribbon, acting first: the last to act leads, the first of the next round is next",
    ids(r) === "tether* |3 wraith> enforcer bastion cipher dronex", ids(r));
  r = to.ribbonOrder(fight, { activeId: "enforcer", nextId: "sniper", mode: "fixed" });
  check("ribbon: a hidden combatant next is not shown, and no visible card claims next", ids(r) === "wraith~ enforcer* bastion dronex cipher tether", ids(r));
  r = to.ribbonOrder(fight, { activeId: "sniper", nextId: "bastion", mode: "actingFirst", round: 1 });
  check("ribbon: a hidden combatant acting shows no acting card and no place in the count",
    !r.cards.some(c => c.active) && (r.position === null) && (r.count === 5) && r.cards[0].id === "bastion" && r.cards[0].next, ids(r));
  r = to.ribbonOrder(fight, { activeId: "wraith", nextId: "enforcer", mode: "actingFirst", round: 1 });
  check("ribbon, acting first: at the top of a round, no marker", !r.cards.some(c => c.marker), ids(r));
  r = to.ribbonOrder([E("a"), E("b", { visible: false })], { activeId: "b", nextId: "a", mode: "actingFirst", round: 4 });
  check("ribbon: the marker shows only with a visible card behind it", ids(r) === "|5 a>", ids(r));
  r = to.ribbonOrder(fight, { activeId: null, nextId: "wraith", mode: "actingFirst" });
  // A line longer than the screen (Johnald, 2026-10-11): how many cards are out of sight each way.
  const boxes = [0, 160, 320, 480, 640, 800].map(left => ({ left, width: 160 }));
  check("ribbon: cards more than half past an edge count as out of sight that way",
    eq(to.offscreen(boxes, { scrollLeft: 0, width: 500 }), { left: 0, right: 3 }) && eq(to.offscreen(boxes, { scrollLeft: 300, width: 500 }), { left: 2, right: 1 })
      && eq(to.offscreen(boxes, { scrollLeft: 0, width: 960 }), { left: 0, right: 0 }) && eq(to.offscreen([], {}), { left: 0, right: 0 }));
  check("ribbon: before the fight starts, initiative order with the first up marked next",
    ids(r) === "wraith> enforcer bastion cipher tether dronex" && (r.position === null), ids(r));
}

// Background perks on the Strategy Layer (Johnald, 2026-10-11): their effects raise system.bonuses.
{
  const zeroRanks = () => Object.fromEntries(Object.keys(IROP.projectKinds).map(k => [k, {}]));
  const soldier = (skills, strategy = {}) => ({
    attributes: { int: { mod: 4 }, str: { mod: 4 }, tgh: { mod: 3 }, cha: { mod: 3 }, per: { mod: 5 }, agi: { mod: 5 } },
    skills: Object.fromEntries(Object.entries(skills).map(([k, rank]) => [k, { rank }])),
    bonuses: { strategy: { perRank: zeroRanks(), laborToughness: 0, intelMegacity: 0, mission: { logistics: 0, intel: 0, reputation: {} }, ...strategy } }
  });
  const research = { kind: "research", specialization: ["technology", "biology"] };
  const engineering = { kind: "engineering", specialization: ["mechanics"] };
  const plain = soldier({ technology: 2, mechanics: 2 });
  const division = soldier({ technology: 2, mechanics: 2 }, { perRank: { ...zeroRanks(), research: { technology: 5 }, engineering: { mechanics: 5 } } });
  check("perks: Science and Engineering Division count +10 per rank instead of +5 in their skills, on their kind of project",
    (proj.contribution(research, plain, "technology") === 14) && (proj.contribution(research, division, "technology") === 24)
      && (proj.contribution(engineering, division, "mechanics") === 24) && (proj.contribution(engineering, division, "technology") === 0));
  const boots = soldier({}, { laborToughness: 1 });
  check("perks: Boots on the Ground puts Toughness into labor beside Strength, and only on Engineering",
    (proj.contribution(engineering, plain, "labor") === 4) && (proj.contribution(engineering, boots, "labor") === 7) && (proj.contribution(research, boots, "labor") === 0));
  const intelCity = { kind: "intelligence", territoryKind: "megacity" };
  const intelWild = { kind: "intelligence", territoryKind: "wildland" };
  const insider = soldier({}, { intelMegacity: 5 });
  const insiderSpy = soldier({ deception: 2 }, { intelMegacity: 5 });
  check("perks: Insider Knowledge works a Megacity Intelligence Action with no skill for it, at +5 a turn",
    eq(proj.bestSkill(intelCity, insider), { skill: proj.INSIDER, amount: 5 }) && (proj.bestSkill(intelWild, insider) === null)
      && (proj.skillLabel(proj.INSIDER) === "Insider Knowledge"));
  check("perks: with a skill for it, Insider Knowledge adds its 5 on top, in a Megacity only",
    (proj.contribution(intelCity, insiderSpy, "deception") === 18) && (proj.contribution(intelWild, insiderSpy, "deception") === 13));
  const turncoat = soldier({ deception: 2 }, { perRank: { ...zeroRanks(), intelligence: { deception: 5 } } });
  check("perks: Know their Ways counts Deception at +10 per rank on Intelligence", proj.contribution(intelWild, turncoat, "deception") === 23);

  // What a successful mission brings back.
  const squad = [
    { name: "Kael", system: soldier({}, { mission: { logistics: 10, intel: 0, reputation: {} } }), perks: ["Supply Run"] },
    { name: "Vale", system: soldier({}, { mission: { logistics: 0, intel: 0, reputation: { megacity: 1 } } }), perks: ["Wake Them Up"] },
    { name: "Ash", system: soldier({}, { mission: { logistics: 5, intel: 5, reputation: {} } }), perks: ["Waste Not"] },
    { name: "Nobody", system: soldier({}) }
  ];
  const city = proj.perkRewards(squad, "megacity", "success");
  check("perks: on a success the squad's perks add their Logistics, Intel and Reputation, named on the card",
    (city.logistics === 15) && (city.intel === 5) && (city.reputation === 1)
      && (city.lines.join(" | ") === "Kael (Supply Run): +10 Logistics | Vale (Wake Them Up): +1 Reputation | Ash (Waste Not): +5 Logistics, +5 Intel"), city.lines.join(" | "));
  check("perks: Reputation perks count only in their own kind of territory", proj.perkRewards(squad, "slums", "success").reputation === 0);
  check("perks: a mission that is not a success brings back nothing extra",
    eq(proj.perkRewards(squad, "megacity", "failure"), { logistics: 0, intel: 0, reputation: 0, lines: [] }) && (proj.perkRewards(squad, "megacity", "partial").lines.length === 0));

  // Concealment at one place only (Model Citizen's Megacity).
  const conceal = await import("../module/rules/concealment.mjs");
  const load = { visible: 14, capacity: 40, bonus: 10, bonusAt: { megacity: 5 } };
  check("perks: a bonus at one place counts only there: Megacity 25 + 10 + 5, Slums 50 + 10",
    (conceal.placeCheck(load, "megacity").limit === 40) && (conceal.placeCheck(load, "megacity").allowed === 16)
      && (conceal.placeCheck(load, "slums").limit === 60) && (conceal.placeCheck({ visible: 1, capacity: 40 }, "megacity").limit === 25));
}

// Reputation (RULED 2026-10-11, Johnald): nine levels, each a bar of 10 points; fill it to rise,
// empty it to fall, and the new level starts mid bar with the overflow thrown away.
{
  const rp = await import("../module/rules/reputation.mjs");
  const at = (level, points) => ({ level, points });
  const move = (s, d) => { const r = rp.moveReputation(s, d); return [r.level, r.points, r.moved]; };
  check("reputation: points move inside a level", eq(move(at(2, 5), 2), [2, 7, 0]) && eq(move(at(2, 5), -3), [2, 2, 0]));
  check("reputation: a full bar rises a level, mid bar, the overflow thrown away", eq(move(at(2, 9), 1), [3, 5, 1]) && eq(move(at(2, 9), 6), [3, 5, 1]));
  check("reputation: an empty bar falls a level, mid bar; one change moves one level at most", eq(move(at(2, 1), -1), [1, 5, -1]) && eq(move(at(2, 3), -12), [1, 5, -1]));
  check("reputation: just after a change it takes 5 either way to move again (Johnald: hard to move, easy to hold)",
    eq(move(at(3, 5), 4), [3, 9, 0]) && eq(move(at(3, 5), -4), [3, 1, 0]) && eq(move(at(3, 5), 5), [4, 5, 1]) && eq(move(at(3, 5), -5), [2, 5, -1]));
  check("reputation: at the top and bottom the bar only fills or empties", eq(move(at(4, 8), 5), [4, 10, 0]) && eq(move(at(-4, 2), -5), [-4, 0, 0])
    && eq(move(at(4, 10), -10), [3, 5, -1]) && eq(move(at(-4, 0), 10), [-3, 5, 1]));
  check("reputation: no points yet is mid bar; levels are held to -4 to +4", eq(rp.repState(1), at(1, 5)) && eq(rp.repState(9, 40), at(4, 10)) && eq(rp.repState(-7, -2), at(-4, 0)));
  check("reputation: a territory's ladder, four up and four down from Neutral",
    [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(l => rp.levelLabel(l)).join() === "Hostile,Resentful,Wary,Uneasy,Neutral,Sympathetic,Friendly,Supportive,Devoted");
  check("reputation: a faction's ladder",
    [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(l => rp.levelLabel(l, IROP.factionLevels)).join() === "At War,Hostile,Unfriendly,Wary,Neutral,Cordial,Friendly,Trusted,Allied");
  check("reputation: in words", rp.levelText(2) === "+2 Friendly" && rp.levelText(0) === "0 Neutral" && rp.stateText(at(-3, 4)) === "Resentful, 4 of 10"
    && rp.changeText(2, at(2, 5), at(2, 7)) === "+2: Friendly, 7 of 10" && rp.changeText(3, at(2, 8), at(3, 5)) === "+3: up to Supportive"
    && rp.changeText(-2, at(1, 1), at(0, 5)) === "-2: down to Neutral" && rp.changeText(1, at(4, 10), at(4, 10)) === "");
  check("reputation: the bar's boxes and the level's color", eq(rp.repPips(3).filter(Boolean).length, 3) && rp.repPips(3).length === 10
    && [-4, -2, 0, 1, 4].map(rp.levelTone).join() === "hostile,unfriendly,neutral,friendly,allied");
  check("reputation: a higher level always outranks a fuller bar", rp.repRank(at(1, 1)) > rp.repRank(at(0, 10)) && rp.repRank(at(0, 6)) > rp.repRank(at(0, 5)));
}

// Factions (Johnald, 2026-10-11): standing on the Reputation engine, what tasks give, and the turn's lines.
{
  const fr = await import("../module/rules/factions.mjs");
  const strat = await import("../module/rules/strategy.mjs");
  const rules = strat.strategyRules({});
  check("factions: a faction's level, its color family and what it means",
    eq(fr.factionLevel(-3), { key: "hostile", label: "Hostile", text: IROP.factionLevels["-3"].text }) && fr.factionLevel(4).label === "Allied" && fr.factionLevel(9).label === "Allied");
  check("factions: a new faction sits mid bar at Neutral; standing held to the ladder",
    eq([fr.normalizeFaction({}).standing, fr.normalizeFaction({}).points], [0, 5]) && fr.normalizeFaction({ standing: 7, points: 30 }).standing === 4
      && fr.normalizeFaction({ standing: 7, points: 30 }).points === 10 && fr.standingText(-3) === "-3 Hostile" && fr.standingState({ standing: 2, points: 7 }) === "Friendly, 7 of 10");

  const fresh = fr.normalizeTask({ faction: "a" }, rules);
  check("factions: a new task is a draft with the rules' numbers: +2 done, -2 failed (RULED 2026-10-11)",
    (fresh.status === "draft") && (fresh.standing === 2) && (fresh.failure === 2) && (fresh.term === 1) && (fresh.rivalLoss === 2) && (fresh.due === null) && (fresh.title === "Untitled task"));
  const task = { id: "t", faction: "a", title: "Clear the road", status: "accepted", standing: 3, failure: 2, logistics: 25, intel: 5, reward: "a guide", rival: "b", rivalLoss: 1 };
  check("factions: a success earns it all, a partial half rounded down, a failure costs; the rival loses when the work is done",
    eq(fr.taskResults(task, "success", rules), { standing: 3, rival: -1, logistics: 25, intel: 5 })
      && eq(fr.taskResults(task, "partial", rules), { standing: 1, rival: -1, logistics: 12, intel: 2 })
      && eq(fr.taskResults(task, "failure", rules), { standing: -2, rival: 0, logistics: 0, intel: 0 }));
  check("factions: the partial share is a rule", fr.taskResults(task, "partial", strat.strategyRules({ factions: { partialPercent: 100 } })).logistics === 25);
  check("factions: what a task offers, in words", fr.rewardText(task) === "+3 standing points, +25 Logistics, +5 Intel, a guide");
  check("factions: when a task is due, from the turn it is",
    (fr.dueText({ due: 3 }, 3) === "Due this turn") && (fr.dueText({ due: 5 }, 3) === "Due by turn 5, 3 turns left") && (fr.dueText({ due: 2 }, 3) === "Overdue since turn 2")
      && (fr.dueText({ due: null, term: 2 }, 3) === "Runs 2 turns once offered"));

  const factions = [{ id: "a", name: "Copperhides", standing: 2, points: 9 }, { id: "b", name: "Pale Sons", standing: -4, points: 0 }];
  const up = fr.changeStanding(factions, "a", 3);
  check("factions: a change runs through the bar: a full bar rises a level, mid bar",
    up.changed && (up.moved === 1) && eq(up.to, { level: 3, points: 5 }) && eq(up.from, { level: 2, points: 9 }) && (factions[0].standing === 2) && (fr.changeStanding(factions, "zz", 1) === null));
  check("factions: what a change does, in words", fr.standingChange({ level: 2, points: 9 }, { level: 3, points: 5 }) === "up to Trusted"
    && fr.standingChange({ level: 2, points: 5 }, { level: 2, points: 7 }) === "Friendly, 7 of 10" && fr.standingChange({ level: 0, points: 1 }, { level: -1, points: 5 }) === "down to Wary");
  let n = 0;
  const applied = fr.applyFactionOps({ factions, tasks: [task] }, [{ task: "t", status: "resolved", outcome: "success", changes: [{ faction: "a", delta: 1 }, { faction: "b", delta: -1 }], reason: "Task success: Clear the road" }],
    { week: 4, id: () => `l${++n}`, time: 1 });
  check("factions: ops resolve the task and log each real change with the faction's name; a change that moves nothing is not logged",
    (applied.tasks[0].status === "resolved") && (applied.tasks[0].resolvedWeek === 4) && (applied.factions[0].standing === 3) && (applied.log.length === 1)
      && eq(applied.log[0], { id: "l1", week: 4, faction: "a", name: "Copperhides", delta: 1, from: { level: 2, points: 9 }, to: { level: 3, points: 5 }, moved: 1,
        reason: "Task success: Clear the road", task: "t", time: 1 }));
  const moving = fr.assignToTask([{ id: "x", status: "accepted", operatives: ["k", "v"] }, { id: "y", status: "accepted", operatives: [] }, { id: "z", status: "resolved", operatives: ["k"] }], "y", "k");
  check("factions: an operative goes on one open task at a time; finished tasks keep their record",
    eq(moving.map(t => t.operatives.join("+")), ["v", "k", "k"]));

  // The turn: at the end of turn 3, a taken task due fails, an untaken one lapses, the rest wait.
  const tasks = [
    { id: "f", faction: "a", title: "Hold the bridge", status: "accepted", week: 3, due: 3, failure: 2 },
    { id: "l", faction: "a", title: "Find the cache", status: "offered", week: 3, due: 3 },
    { id: "w", faction: "a", title: "Long haul", status: "accepted", week: 3, due: 4 },
    { id: "d", faction: "a", title: "Draft", status: "draft", term: 1 },
    { id: "r", faction: "a", title: "Done", status: "resolved", due: 2 }
  ];
  const cu = [{ id: "a", name: "Copperhides", standing: 2, points: 1 }];
  const fl = fr.planFactionLines({ week: 3, factions: cu, tasks, rules });
  check("factions: the turn fails a taken task left undone and lapses one never taken, nothing else",
    eq(fl.map(l => l.text), ["Copperhides: Hold the bridge was not done in time. Standing -2", "Copperhides: Find the cache lapses, never taken"])
      && eq(fl[0].factionOp.changes, [{ faction: "a", delta: -2 }]) && (fl[0].factionOp.outcome === "failure") && !fl[1].factionOp.changes.length
      && (fl[0].detail === "Friendly, 1 of 10, down to Cordial. Counts as a failure."), fl[0].detail);
  const harsh = fr.planFactionLines({ week: 3, factions: cu, tasks, rules: strat.strategyRules({ factions: { lapseLoss: 1 } }) });
  check("factions: turning work down can cost standing, as a rule", eq(harsh[1].factionOp.changes, [{ faction: "a", delta: -1 }]) && /Standing -1/.test(harsh[1].text));
  const plan = turn.planTurn({ week: 3, territories: [], rules, factions: cu, tasks });
  const lines = plan.lines.filter(l => l.section === "factions");
  check("factions: Advance turn plans them under Faction tasks", (lines.length === 2) && (turn.SECTIONS.factions === "Faction tasks"));
  const all = turn.resolvePlan(plan, new Set(plan.lines.map(l => l.id)), new Map());
  const none = turn.resolvePlan(plan, new Set(), new Map());
  check("factions: ticked lines become faction ops; unticked, the task stays open", (all.factionOps.length === 2) && (all.factionOps[0].task === "f") && (none.factionOps.length === 0));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

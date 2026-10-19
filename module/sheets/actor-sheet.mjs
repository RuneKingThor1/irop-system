import { IROP, rankLocked } from "../config.mjs";
import { DICE, DICE_ORDER } from "../rules/dynosrs.mjs";
import * as rolls from "../rolls.mjs";
import { rankCost, checkRankPurchase, xpLine } from "../rules/xp.mjs";
import { rankList, serviceRank } from "../rules/ranks.mjs";
import { automationText, perkUses, abilityAsUpgraded, weaponPerkSummary, gearCharges } from "../rules/perks.mjs";
import { perkContext } from "../rolls.mjs";
import { startingSkillPlan, startingSkillRanks } from "../rules/starting-skills.mjs";
import { ownedPerks, nodeStates, treesFor, specializationLock, canCrossTrain, ordinal } from "../rules/skill-trees.mjs";
import { specializationRules, isLedgerOpen, setLedgerOpen } from "../settings.mjs";
import { parseRequirements, unmetRequirements } from "../rules/requirements.mjs";
import { nodeSource } from "./item-sheet.mjs";
import { effectChanges, describeChange } from "../rules/effects.mjs";
import { canReset, confirmReset } from "../reset.mjs";
import { isCountedWeapon, stackFor } from "../rules/stacks.mjs";
import { isLinked, linkActor, syncActor, unlinkActor } from "../artemis/link.mjs";
import { askStatusValue, setStatus, statusLabel, statusValue } from "../statuses.mjs";
import { liveBackground, perkCopy, perkMeta, takenPerk } from "../rules/backgrounds.mjs";
import { placeCheck } from "../rules/concealment.mjs";
import { psiContext, onSelectDiscipline, onBuyDiscipline, onBuyPowerRank, onChoosePower, onAwaken, learnPower, refundPsi, crystalAmount } from "./paraphysics-tab.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const { DialogV2 } = foundry.applications.api;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

const T = "systems/irop/templates/actor";

/** Item types an actor holds at most one of. */
const SINGLETONS = ["species", "role", "background"];

/** Pips for a 0 to n track. */
function pips(value, max) {
  return Array.from({ length: max }, (_, i) => ({ n: i + 1, filled: i < value }));
}

/**
 * Rank pips that can be bought (2026-10-08): in Play mode an operative's next pip
 * up carries its XP cost and is clickable; the rest stay locked.
 */
function buyPips(value, max, kind, canBuy) {
  return pips(value, max).map(p => {
    if ( !canBuy || (p.n !== value + 1) ) return p;
    return { ...p, buyable: true, cost: rankCost(kind, p.n) };
  });
}

function pct(value, max) {
  if ( !max ) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * The record bar's arrow points the way the drawer will move: left to slide it
 * out of the sheet, right to slide it back in.
 */
export function recordBarIcon(open) {
  return open ? "fa-caret-right" : "fa-caret-left";
}

/**
 * The header portrait is square and as tall as the vitals column beside it, so
 * there is no gap underneath. Never smaller than the 112px it used to be.
 */
export const PORTRAIT_MIN = 112;
export function portraitSize(vitalsHeight) {
  return Math.max(PORTRAIT_MIN, Math.round(Number(vitalsHeight) || 0));
}

/**
 * Split an attribute score into its tens, which are the modifier, and its
 * ones. 45 gives { tens: "4", ones: "5" }; 105 gives { tens: "10", ones: "5" }.
 * A score under 10 has no modifier and so no tens.
 */
export function splitScore(value, mod) {
  return mod > 0 ? { tens: String(mod), ones: String(value - (10 * mod)) } : { tens: "", ones: String(value) };
}

/**
 * A roll formula as the sheet shows it, with the character's numbers filled in:
 * "1d6 + @str.mod" reads "1d6 + 4". The @ references are how formulas are
 * written, a habit from Sandbox nobody needs to read (Johnald, 2026-10-07).
 * A reference the data does not have is left as written.
 */
export function shownFormula(formula, data = {}) {
  return String(formula ?? "")
    .replace(/@([\w.]+)/g, (match, path) => {
      const v = foundry.utils.getProperty(data, path);
      return ((typeof v === "number") && Number.isFinite(v)) ? String(v) : match;
    })
    .replace(/\+\s*-\s*/g, "- ");
}

/** The same formula in words, for its tooltip: "1d6 + @str.mod" reads "1d6 + STR mod". */
export function formulaInWords(formula) {
  return String(formula ?? "").replace(/@([\w.]+)/g, (match, path) => {
    const [head, tail] = path.split(".");
    if ( IROP.attributes[head] ) return `${IROP.attributes[head].abbr} ${tail === "value" ? "score" : "mod"}`;
    if ( (head === "paraphysics") && IROP.disciplines[tail] ) return `${IROP.disciplines[tail]} rank`;
    return match;
  });
}

/**
 * An armor row's labelled boxes (Johnald, 2026-10-08): Defense, Armor HP, DR,
 * Mobility and Dodges. DR and Mobility show one number when every type or
 * speed they touch shares it, with the full breakdown on hover.
 */
function armorStats(s) {
  const summary = (entries, labelOf, fmt) => {
    const live = entries.filter(([, n]) => n);
    const values = [...new Set(live.map(([, n]) => n))];
    return {
      value: !live.length ? "0" : (values.length === 1 ? fmt(values[0]) : "varies"),
      tip: live.map(([k, n]) => `${labelOf(k)} ${fmt(n)}`).join(", "),
      dim: !live.length
    };
  };
  const dr = summary(Object.entries(s.dr), k => IROP.damageTypes[k].label, n => String(n));
  const mob = summary(Object.entries(s.mobility), k => IROP.speeds[k], signed);
  return [
    { label: "Defense", value: String(s.defense), dim: !s.defense, tip: "Defense Value: added to every attack roll against the wearer" },
    { label: "Armor HP", value: String(s.points), dim: !s.points, tip: "Adaptive Armor: bonus HP that soaks damage first" },
    { label: "Barrier", value: String(s.barrier ?? 0), dim: !s.barrier, tip: "Added to your Barrier maximum while worn" },
    { label: "DR", value: dr.value, dim: dr.dim, tip: dr.tip ? `Damage reduction: ${dr.tip}` : "No damage reduction" },
    { label: "Mobility", value: mob.value, dim: mob.dim, tip: mob.tip ? `Mobility: ${mob.tip}` : "No mobility bonus" },
    { label: "Dodges", value: s.dodges ? signed(s.dodges) : "0", dim: !s.dodges, tip: "Extra dodges per round" }
  ];
}

/**
 * A weapon's Damage box. Loaded special ammo's damage bonus is added to the
 * formula shown, and named on hover (2026-10-08).
 */
function damageStat(s, rollData) {
  if ( !s.damage.formula ) return { label: "Damage", value: "none", dim: true, tip: "" };
  const bonus = s.specialAmmo?.system.ammo.damageBonus;
  const formula = bonus ? `${s.damage.formula} + ${bonus}` : s.damage.formula;
  return {
    label: "Damage",
    value: shownFormula(formula, rollData),
    cls: bonus ? "from-ammo" : "",
    tip: bonus ? `${formulaInWords(formula)}, the + ${bonus} from ${s.specialAmmo.name}` : formulaInWords(formula)
  };
}

/** A weapon's Type box: loaded special ammo's damage type replaces the weapon's own (RULED 2026-10-08). */
function typeStat(s) {
  const own = IROP.damageTypes[s.damage.type]?.label ?? "";
  const swapped = s.specialAmmo?.system.ammo.damageType;
  if ( !swapped ) return { label: "Type", value: own, cls: "type" };
  return {
    label: "Type",
    value: IROP.damageTypes[swapped]?.label ?? swapped,
    cls: "type from-ammo",
    tip: `${IROP.damageTypes[swapped]?.label ?? swapped} from ${s.specialAmmo.name}; the weapon's own is ${own}`
  };
}

/** Special ammo's effects in a line, for tooltips: "Cold damage, Bypasses 3 DR, Frostbite (2) on hit". */
export function ammoSummary(a) {
  if ( !a ) return "";
  const parts = [];
  if ( a.damageType ) parts.push(`${IROP.damageTypes[a.damageType]?.label ?? a.damageType} damage`);
  if ( a.damageBonus ) parts.push(`+ ${a.damageBonus} damage`);
  if ( a.accuracy ) parts.push(`Accuracy ${signed(a.accuracy)}`);
  if ( a.critical ) parts.push(`Crit ${signed(a.critical)}`);
  if ( a.drBypass ) parts.push(`Bypasses ${a.drBypass} DR`);
  if ( a.shred ) parts.push(`Shred ${a.shred}`);
  if ( a.penetration ) parts.push(`Penetration ${a.penetration}`);
  if ( a.ignoreDefense ) parts.push("Ignores Defense");
  if ( a.status ) {
    const name = IROP.statusEffects.find(e => e.id === a.status)?.name ?? a.status;
    parts.push(`${name}${a.statusValue ? ` (${a.statusValue})` : ""} on hit`);
  }
  return parts.join(", ");
}

/** The kind of mod a weapon or armor takes: "ranged", "melee" or "armor" (IROP.modTargets). */
export function modKindFor(host) {
  if ( host.type === "armor" ) return "armor";
  return (host.system.category === "melee") ? "melee" : "ranged";
}

/**
 * A launcher's slots for the template (RULED 2026-10-08): each loaded grenade or
 * rocket, then the empty slots left.
 */
function projectileSlots(s) {
  const slots = s.projectileSlots;
  if ( !slots ) return null;
  const noun = IROP.weaponFeeds[s.feed].noun;
  return Array.from({ length: slots }, (_, i) => {
    const shot = s.loaded[i];
    return shot ? { slot: i, name: shot.name, img: shot.img, loaded: true } : { slot: i, loaded: false, noun };
  });
}

/** A ledger entry, dated today. */
function xpEntry(kind, label, xp, ref, rank) {
  return { kind, label, xp, ref, rank, date: new Date().toISOString().slice(0, 10) };
}

/** A tree node's name: its ability's current name, or the one stored with the node. */
function nodeName(node) {
  return nodeSource(node.uuid)?.name ?? node.name;
}

/** The line under a perk's name: "20 XP, Active, 5 EN", or "Owned, Passive". */
function perkSubline(source, st) {
  const s = source?.system;
  const parts = [st.state === "owned" ? "Owned" : `${st.cost} XP`];
  if ( s?.kind ) parts.push(s.kind === "active" ? "Active" : "Passive");
  if ( s?.energyCost ) parts.push(`${s.energyCost} EN`);
  return parts.join(", ");
}

/**
 * A description as a short line of plain text, for a tooltip: tags dropped, cut at
 * a word near `max` characters. Only harmless entities are decoded, so nothing in
 * the text can turn back into markup.
 */
export function plainText(html, max = 280) {
  const text = String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  if ( text.length <= max ) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trim()}...`;
}

/** "A", "A and B", "A, B and C". */
function listOf(names) {
  if ( names.length < 2 ) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The GM's undo button on a ledger line says what it will do. */
function undoTip(entry) {
  switch ( entry.kind ) {
    case "award": return "Take back this award";
    case "perk": return "Undo: refund the XP and remove the perk";
    case "refund": return "Remove this refund";
    case "adjust": return "Remove this line";
    case "discipline": return "Undo: refund the XP and take the discipline rank off";
    case "power": return "Undo: refund the XP and take the power rank off";
    case "crystal": return "Undo: give the psycrystal back and take the power, or its evolution, off";
    case "awaken": return "Undo the awakening: give the psycrystals back";
    case "awakenPower": return "Undo: remove the power and give the free pick back";
    default: return "Undo: refund the XP and remove the rank";
  }
}

/** In the starting skills picker, stop more boxes being ticked than the pick allows. */
function limitPicks(root, pick) {
  const boxes = [...(root?.querySelectorAll('.starting-skills input[type="checkbox"]') ?? [])];
  const sync = () => {
    const full = boxes.filter(b => b.checked).length >= pick;
    for ( const b of boxes ) b.disabled = full && !b.checked;
  };
  for ( const b of boxes ) b.addEventListener("change", sync);
  sync();
}

/** Plain text made safe to place in HTML. */
function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Item types that can be stowed: everything carried. */
const STOWABLE = ["weapon", "armor", "gear", "mod"];

/** The line under a stowed item's name: what kind of thing it is. */
function stowedLabel(item) {
  const s = item.system;
  switch ( item.type ) {
    case "weapon": return `Weapon, ${IROP.weaponClasses[s.weaponClass] ?? IROP.weaponCategories[s.category]?.label ?? ""}`;
    case "armor": return `Armor, ${IROP.armorClasses[s.armorClass] ?? ""}`;
    case "gear": return IROP.gearKinds[s.kind] ?? "Gear";
    case "mod": return `Mod, ${IROP.modTargets[s.target] ?? ""}`;
    default: return "";
  }
}

/** A stable seven digit record number for an actor, derived from its id. */
export function recordNumber(id) {
  let h = 0;
  for ( const c of String(id ?? "") ) h = ((h * 31) + c.charCodeAt(0)) >>> 0;
  return String(h % 10000000).padStart(7, "0");
}

/**
 * Shared behavior for every Insurrection actor sheet: play and edit modes,
 * rolling, item management, mods, effects.
 */
/**
 * The header's concealment line (Johnald, 2026-10-10): what shows of the load, and whether it
 * passes at each place, with the numbers in its tooltip.
 */
export function concealmentLine(load) {
  if ( !load ) return null;
  const checks = Object.keys(IROP.concealment.places).map(place => placeCheck(load, place));
  // Why a place allows more: the species, effects at every place, and effects at that place only (2026-10-11).
  const why = place => [load.speciesBonus ? `+${load.speciesBonus}% as a ${load.species}` : "",
    ((load.bonus ?? 0) - (load.speciesBonus ?? 0)) ? `${signedText((load.bonus ?? 0) - (load.speciesBonus ?? 0))}% from effects` : "",
    load.bonusAt?.[place] ? `${signedText(load.bonusAt[place])}% here from effects` : ""].filter(Boolean).join(", ");
  const lines = checks.map(c => `${c.label} allow ${c.allowed} (${c.limit}%${why(c.place) ? `: ${c.base}% ${why(c.place)}` : ""}): ${c.pass ? "passes" : `caught${c.over ? `, ${c.over} over` : ""}${c.exposed?.length ? ", a focus cannot be hidden" : ""}`}.`);
  const tip = [`Showing ${load.visible} of what is carried${load.hidden ? `, ${load.hidden} more hidden` : ""}, against a capacity of ${load.capacity}.`,
    ...lines, "Concealable items, and those with a mod that conceals them, do not count."].join(" ");
  // Each place's line on its own chip (Johnald, 2026-10-16); the whole on the Concealment label.
  return { visible: load.visible, hidden: load.hidden, checks: checks.map((c, i) => ({ ...c, tip: lines[i] })), tip };
}

const signedText = n => ((n > 0) ? `+${n}` : `${n}`);

export class IropActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["irop", "actor-sheet"],
    // 1100 x 850 (Johnald, 2026-10-17), never taller than the screen it opens on.
    position: { width: 1100, height: 850 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      toggleMode: IropActorSheet.#onToggleMode,
      rollAttribute: IropActorSheet.#onRollAttribute,
      rollSkill: IropActorSheet.#onRollSkill,
      rollDodge: IropActorSheet.#onRollDodge,
      rollPool: IropActorSheet.#onRollPool,
      rollInitiative: IropActorSheet.#onRollInitiative,
      resetDodges: IropActorSheet.#onResetDodges,
      useItem: IropActorSheet.#onUseItem,
      postItem: IropActorSheet.#onPostItem,
      editItem: IropActorSheet.#onEditItem,
      deleteItem: IropActorSheet.#onDeleteItem,
      createItem: IropActorSheet.#onCreateItem,
      toggleEquip: IropActorSheet.#onToggleEquip,
      toggleStow: IropActorSheet.#onToggleStow,
      reload: IropActorSheet.#onReload,
      unfitMod: IropActorSheet.#onUnfitMod,
      unloadAmmo: IropActorSheet.#onUnloadAmmo,
      chooseAmmo: IropActorSheet.#onChooseAmmo,
      chooseMod: IropActorSheet.#onChooseMod,
      fireProjectile: IropActorSheet.#onFireProjectile,
      awardXp: IropActorSheet.#onAwardXp,
      pickStartingSkills: IropActorSheet.#onPickStartingSkills,
      resetStartingSkills: IropActorSheet.#onResetStartingSkills,
      pickBackgroundPerk: IropActorSheet.#onPickBackgroundPerk,
      resetBackgroundPerk: IropActorSheet.#onResetBackgroundPerk,
      refundXp: IropActorSheet.#onRefundXp,
      showTree: IropActorSheet.#onShowTree,
      perkNode: IropActorSheet.#onPerkNode,
      chooseMutation: IropActorSheet.#onChooseMutation,
      toggleSummary: IropActorSheet.#onToggleSummary,
      toggleLedger: IropActorSheet.#onToggleLedger,
      resetTree: IropActorSheet.#onResetTree,
      chooseProjectile: IropActorSheet.#onChooseProjectile,
      unloadProjectile: IropActorSheet.#onUnloadProjectile,
      refuel: IropActorSheet.#onRefuel,
      setRank: IropActorSheet.#onSetRank,
      setAdvance: IropActorSheet.#onSetAdvance,
      setPip: IropActorSheet.#onSetPip,
      adjust: IropActorSheet.#onAdjust,
      toggleStatus: IropActorSheet.#onToggleStatus,
      createEffect: IropActorSheet.#onCreateEffect,
      editEffect: IropActorSheet.#onEditEffect,
      deleteEffect: IropActorSheet.#onDeleteEffect,
      toggleEffect: IropActorSheet.#onToggleEffect,
      // Paraphysics (Framework Draft 0.6, 2026-10-19).
      selectDiscipline: onSelectDiscipline,
      buyDiscipline: onBuyDiscipline,
      buyPowerRank: onBuyPowerRank,
      choosePower: onChoosePower,
      awaken: onAwaken
    }
  };

  /** Play mode rolls; edit mode exposes base values. */
  #mode = "play";

  /** Watches the vitals column so the portrait keeps its height. */
  #portraitObserver = null;

  /** The perk tree tab showing on the Dossier, by tree id. */
  #activeTree = null;

  /** Another role's specialization being looked at on the Dossier, by tree id. */
  #browseTree = null;

  /** Active abilities dropped down to show their text, by item id; kept across redraws. */
  #expanded = new Set();

  get isEditMode() {
    return this.isEditable && (this.#mode === "edit");
  }

  /** The Effects tab: always for a GM, for a player only in Edit mode (Johnald, 2026-10-10). */
  get showsEffects() {
    return !!game.user?.isGM || this.isEditMode;
  }

  /**
   * The Paraphysics tab (Johnald, 2026-10-16): only for a paraphysical character, and for a GM in
   * Edit mode, so the first ranks can be set.
   */
  get showsParaphysics() {
    // Also for anyone holding the psycrystals to be awakened (2026-10-19).
    return !!this.actor.system.isParaphysical || (this.isEditMode && !!game.user?.isGM)
      || ((this.actor.system.psi?.crystals ?? 0) >= IROP.paraphysics.awakenCost);
  }

  /** Leave the Effects and Paraphysics tabs out where they are hidden. @inheritDoc */
  _getTabsConfig(group) {
    const config = super._getTabsConfig(group);
    if ( !config ) return config;
    const hide = new Set([this.showsEffects ? "" : "effects", this.showsParaphysics ? "" : "paraphysics"]);
    return { ...config, tabs: config.tabs.filter(t => !hide.has(t.id)) };
  }

  /** And their pages; a hidden tab left open falls back to the first. @inheritDoc */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if ( !this.showsEffects ) delete parts.effects;
    if ( !this.showsParaphysics ) {
      delete parts.paraphysics;
      if ( this.tabGroups?.primary === "paraphysics" ) this.tabGroups.primary = "main";
    }
    return parts;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;
    const systemSource = system._source;
    const editMode = this.isEditMode;
    // An NPC's caste, only for a Mutant (Johnald, 2026-10-17); one set before shows, flagged, so it can be cleared.
    const mutantSpecies = !!system.species?.system?.mutations;
    context.caste = { shown: mutantSpecies || !!system.details?.caste, stray: !mutantSpecies && !!system.details?.caste };
    // In Play mode an operative's owner buys the next pip with XP (2026-10-08).
    const canBuy = (actor.type === "operative") && !editMode && this.isEditable;

    const attributes = Object.entries(system.attributes).map(([key, a]) => ({
      key, label: a.label, abbr: a.abbr, value: a.value, mod: a.mod,
      // The modifier is the score's tens, so the score splits there and the tens wear the role color.
      ...splitScore(a.value, a.mod),
      base: systemSource.attributes[key].base,
      advances: a.advances,
      boons: a.boons,
      advancePips: buyPips(a.advances, IROP.attributeAdvance.maxRanks, "attribute", canBuy && !rankLocked(key)),
      // Luck cannot be raised (RULED 2026-10-17); only a GM's Edit mode may correct its ranks.
      locked: rankLocked(key),
      rankEditable: editMode && (!rankLocked(key) || !!game.user?.isGM)
    }));

    const skills = Object.entries(system.skills).map(([key, s]) => ({
      key, label: s.label, rank: s.rank,
      attrAbbr: IROP.attributes[s.attribute].abbr,
      attrLabel: IROP.attributes[s.attribute].label,
      mod: s.mod,
      rankPips: buyPips(s.rank, IROP.skillRanks.max, "skill", canBuy),
      dice: DICE_ORDER.flatMap(k => Array.from({ length: s.pool[k] || 0 }, () => ({ key: k, name: DICE[k].name }))),
      floored: s.pool.floored
    })).sort((a, b) => a.label.localeCompare(b.label));

    const v = system.vitals;
    const bar = (key, label, cls) => ({
      key, label, cls, value: v[key].value, max: v[key].max, bonus: systemSource.vitals[key].bonus,
      pct: pct(v[key].value, v[key].max)
    });

    const items = this.#prepareItems();
    // Active abilities carry their text, to drop down under the row (2026-10-08).
    for ( const a of items.activeAbilities ) {
      a.expanded = this.#expanded.has(a.id);
      a.descriptionHTML = await TextEditor.enrichHTML(a.system.description ?? "", {
        relativeTo: a.item, rollData: a.item.getRollData?.(), secrets: actor.isOwner
      });
    }
    const canMutate = system.canMutate;
    const canTakeBoons = system.canTakeBoons;
    const mods = system.mods;
    const initBonus = mods.agi + mods.lck + system.initiativeBonus;

    return Object.assign(context, {
      actor,
      system,
      systemSource,
      config: IROP,
      editable: this.isEditable,
      editMode,
      accent: system.accent ?? null,
      isOperative: actor.type === "operative",
      attributes,
      skills,
      // Skill groups (Physical, Social, Knowledge) in config order, alphabetical within each group.
      skillGroups: Object.entries(IROP.skillGroups).map(([key, group]) => ({
        key,
        label: group.label,
        wide: !!group.wide,
        skills: skills.filter(s => IROP.skills[s.key].group === key)
      })),
      vitals: [bar("hp", "Health", "hp"), bar("energy", "Energy", "energy"), bar("armor", "Armor", "armor"),
        bar("barrier", "Barrier", "barrier")],
      luckPips: pips(v.luck.value, v.luck.max),
      // Each up to the operative's own cap, which a mutation can move (2026-10-17).
      edgePips: system.banks ? pips(system.banks.edge, system.banks.edgeMax ?? 3) : null,
      victoryPips: system.banks ? pips(system.banks.victory, system.banks.victoryMax ?? 1) : null,
      edgeMax: system.banks?.edgeMax ?? 3, victoryMax: system.banks?.victoryMax ?? 1,
      dodgePips: pips(v.dodges.value, v.dodges.max),
      // None left this round: the Dodge buttons are greyed out (2026-10-10).
      canDodge: (Number(v.dodges.value) || 0) > 0,
      movement: system.movement,
      initiativeText: `1d20 ${initBonus < 0 ? "-" : "+"} ${Math.abs(initBonus)}`,
      // The box shows only the bonus; the d20 is the same for everyone (Johnald, 2026-10-07).
      initiativeBonusText: `${initBonus < 0 ? "-" : "+"}${Math.abs(initBonus)}`,
      carryPct: pct(system.carry.value, system.carry.max),
      concealment: concealmentLine(system.concealment),
      canMutate,
      showMutations: canMutate || (items.mutations.length > 0),
      strayMutations: !canMutate && (items.mutations.length > 0),
      canTakeBoons,
      showBoons: canTakeBoons || (items.boons.length > 0),
      strayBoons: !canTakeBoons && (items.boons.length > 0),
      // The header's Role, Species and Background chips. In Edit mode they carry what the
      // Training tab's identity cards did (moved 2026-10-08): remove, and the starting skills.
      identityChips: [
        { label: "Role", noun: "role", item: items.role, slot: "role", isRole: true },
        { label: "Species", noun: "species", item: items.species },
        { label: "Background", noun: "background", item: items.background, slot: "background" }
      ].filter(c => (actor.type === "operative") || (c.noun === "species")).map(c => ({
        ...c,
        // Free starting skills (2026-10-08): which were taken, and from what.
        takenFrom: c.slot ? (system.details?.startingSkills?.[c.slot] || "") : "",
        // The background's perk (2026-10-10): the one taken, or whether one is waiting to be picked.
        ...((c.noun === "background") ? this.#backgroundPerkChip(c.item?.item ?? null) : {})
      })),
      dr: Object.entries(IROP.damageTypes).map(([key, t]) => ({
        key, label: t.label, total: system.drTotal[key], bonus: systemSource.dr[key]
      })),
      disciplines: Object.entries(IROP.disciplines).map(([key, label]) => ({
        key, label, rank: system.paraphysics[key]
      })),
      // Only for the Paraphysical, or in edit mode so a GM can still set ranks (2026-10-08).
      showParaphysics: system.isParaphysical || this.isEditMode,
      // The operative sheet gives Paraphysics a tab of its own (2026-10-16); the NPC sheet keeps the panel.
      paraphysicsTab: "paraphysics" in this.constructor.PARTS,
      // The Paraphysics tab: crystals, disciplines and powers (Framework Draft 0.6, 2026-10-19).
      psi: ("paraphysics" in this.constructor.PARTS) ? psiContext(this) : null,
      // The XP ledger, newest first; only a GM can award or undo (2026-10-08).
      xpLog: (system.xp?.log ?? []).map((e, index) => ({ ...xpLine(e),
        // Psycrystal lines show the crystals, not XP (2026-10-19).
        ...(["crystal", "awaken", "awakenPower"].includes(e.kind) ? { amount: crystalAmount(e), award: false } : {}),
        index, undoTip: undoTip(e) })).reverse(),
      // The ledger folds away, each user's choice (2026-10-08).
      ledgerOpen: isLedgerOpen(),
      ledgerCount: `${system.xp?.log?.length ?? 0} ${(system.xp?.log?.length === 1) ? "entry" : "entries"}`,
      // The Experience bar's meter: how much of what was earned is spent.
      xpSpentPct: pct(system.xp?.spent ?? 0, system.xp?.earned ?? 0),
      // Perk trees (2026-10-08): the role's trees and the Everyone trees, each perk with its state.
      ...this.#prepareTrees(),
      roleKey: items.role?.item.system.role ?? "",
      isGM: !!game.user?.isGM,
      // Making a blank weapon, armor, gear, mod or ability is the GM's: players cannot fill one in
      // (Johnald, 2026-10-10: those items are the GM's to write). Players get them dragged or bought.
      gmEditable: this.isEditable && !!game.user?.isGM,
      statuses: IROP.statusEffects.map(s => {
        const active = actor.statuses.has(s.id);
        const value = (active && s.counter) ? statusValue(actor, s.id) : 0;
        return { ...s, active, value, label: statusLabel(s.id, value) };
      }),
      effects: this.#prepareEffects(),
      ...items,
      biography: await TextEditor.enrichHTML(system.details.biography, { relativeTo: actor, secrets: actor.isOwner }),
      notes: await TextEditor.enrichHTML(system.details.notes, { relativeTo: actor, secrets: actor.isOwner })
    });
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    context.tab = context.tabs?.[partId];
    return context;
  }

  /* -------------------------------------------- */
  /*  Perk trees (2026-10-08)                    */
  /* -------------------------------------------- */

  /**
   * This operative's perk trees, worked out together: which trees show, which perks
   * it holds (node id to ability id), and which specializations are its own (those it
   * holds a perk in). Another role's tree counts only perks bought from it.
   */
  #treeState() {
    const none = { trees: [], all: [], owned: new Map(), entered: [], role: "" };
    if ( this.actor.type !== "operative" ) return none;
    const role = this.actor.items.find(i => i.type === "role")?.system.role ?? "";
    const all = game.items?.filter?.(i => i.type === "skillTree") ?? [];
    const abilities = this.actor.items.filter(i => i.type === "ability");
    const marked = abilities.map(a => a.flags?.irop?.perk?.tree).filter(Boolean);
    const trees = treesFor(all, { role, entered: marked, browse: this.#browseTree });
    const owned = ownedPerks(trees.map(t => t.system), abilities, nodeName, t => !t.role || (t.role === role));
    const entered = trees.filter(t => (t.system.kind === "specialization")
      && t.system.tiers.some(x => x.nodes.some(n => owned.has(n.id)))).map(t => t.id);
    return { trees, all, owned, entered, role };
  }

  /**
   * The Dossier's trees: tabs, tiers and each perk's state, with specializations
   * locked until they open (RULED 2026-10-08: 300 XP earned for the first, of the
   * character's own role; 900 for the second, of any role; each a world setting).
   * Edit mode lifts the locks, for setting up a character. Also the cross training
   * picker: another role's specializations, once one can be taken.
   */
  #prepareTrees() {
    const { trees: visible, all, owned, entered, role } = this.#treeState();
    const free = this.isEditMode;
    const rules = specializationRules();
    // Once a character holds all the specializations the table allows, the rest of the role's
    // only clutter the tabs, so Play mode leaves them out (Johnald, 2026-10-08). Edit mode keeps them.
    const full = !free && (entered.length >= rules.unlockXP.length);
    const trees = visible.filter(t => !(full && (t.system.kind === "specialization") && !entered.includes(t.id)));
    if ( !trees.length ) return { trees: [], crossTrain: null };
    const earned = this.actor.system.xp?.earned ?? 0;
    const unspent = this.actor.system.xp?.unspent ?? 0;
    const active = trees.find(t => t.id === this.#activeTree) ?? trees[0];
    const roleLabel = r => IROP.roles[r]?.label ?? "";
    const unmet = this.#unmetFor();
    const list = trees.map(tree => {
      const states = nodeStates(tree.system, { owned, unspent, free, nameOf: nodeName, unmet });
      const lock = free ? "" : specializationLock(tree, { role, earned, entered, rules });
      const spec = tree.system.kind === "specialization";
      const holds = tree.system.tiers.some(x => x.nodes.some(n => owned.has(n.id)));
      const foreign = !!tree.system.role && (tree.system.role !== role);
      return {
        id: tree.id,
        label: foreign ? `${tree.system.tabLabel} (${roleLabel(tree.system.role)})` : tree.system.tabLabel,
        active: tree === active,
        lock,
        // A note on an open specialization not yet taken: a perk here makes it theirs.
        enterNote: (spec && !lock && !free && !entered.includes(tree.id))
          ? `Taking a perk here makes ${tree.system.tabLabel} your ${ordinal(entered.length)} specialization.` : "",
        canReset: free && !!game.user?.isGM && holds,
        // A tree without tier gating, like the Generalist perks, is laid out free form (2026-10-08).
        freeForm: !tree.system.gated,
        tiers: tree.system.tiers.map((tier, index) => ({
          number: index + 1,
          exclusive: tier.exclusive && (tier.nodes.length > 1),
          nodes: tier.nodes.map((node, i) => {
            const source = nodeSource(node.uuid);
            let st = states.get(node.id);
            if ( lock && (st.state !== "owned") ) st = { ...st, state: "locked", canBuy: false, reason: lock };
            return {
              id: node.id,
              name: nodeName(node),
              img: source?.img || node.img || "icons/svg/item-bag.svg",
              state: st.state,
              canBuy: st.canBuy,
              reason: st.reason,
              // A lock on its icon: a requirement is not met, written (Toughness 45) or the perk
              // before it in its line (Johnald, 2026-10-08).
              unmet: (st.state === "locked") && (!!st.needs?.length || !!st.waitsOn),
              or: tier.exclusive && (i > 0),
              // The perk before it in the line is its prerequisite: an arrow between them.
              chained: !tier.exclusive && (i > 0) && (node.requires === tier.nodes[i - 1].id),
              sub: perkSubline(source, st)
            };
          })
        })).filter(t => t.nodes.length)
      };
    });
    // Free form trees: lines of two or more, then the single perks in a grid.
    for ( const t of list.filter(x => x.freeForm) ) {
      t.lines = t.tiers.filter(x => x.nodes.length > 1);
      t.singles = t.tiers.filter(x => x.nodes.length === 1).flatMap(x => x.nodes);
    }
    // Cross training: once another role's specialization can be taken (or in Edit mode).
    const canCross = free || canCrossTrain({ earned, entered, rules });
    const options = canCross ? all
      .filter(t => (t.system.kind === "specialization") && t.system.role && (t.system.role !== role) && !entered.includes(t.id))
      .sort((a, b) => String(a.system.role).localeCompare(String(b.system.role)) || (a.system.order - b.system.order))
      .map(t => ({ id: t.id, label: `${roleLabel(t.system.role)}: ${t.system.tabLabel}`, selected: t.id === this.#browseTree })) : [];
    return { trees: list, crossTrain: options.length ? options : null };
  }

  /** Abilities: drop an active ability's text down, or fold it away, without a re-render. */
  static #onToggleSummary(event, target) {
    const row = target.closest("[data-item-id]");
    const id = row?.dataset.itemId;
    if ( !id ) return;
    if ( this.#expanded.has(id) ) this.#expanded.delete(id);
    else this.#expanded.add(id);
    const open = this.#expanded.has(id);
    row.classList.toggle("expanded", open);
    target.setAttribute("aria-expanded", String(open));
  }

  /** Training tab: fold the ledger away or open it, and remember the choice. */
  static #onToggleLedger(event, target) {
    const panel = target.closest(".xp-ledger");
    if ( !panel ) return;
    const open = !panel.classList.contains("open");
    panel.classList.toggle("open", open);
    target.setAttribute("aria-expanded", String(open));
    setLedgerOpen(open);
  }

  /**
   * A node's written requirements this character does not meet: attributes and skill
   * ranks from its ability's Prerequisites line, "Toughness 45" (2026-10-08).
   */
  #unmetFor() {
    const system = this.actor.system;
    return node => unmetRequirements(parseRequirements(nodeSource(node.uuid)?.system?.prerequisites), system);
  }

  /** Dossier: show another tree's tab, without a re-render. */
  static #onShowTree(event, target) {
    this.#activeTree = target.dataset.treeId;
    const panel = target.closest(".skill-trees");
    for ( const el of panel?.querySelectorAll("[data-tree-id]") ?? [] ) {
      el.classList.toggle("active", el.dataset.treeId === this.#activeTree);
    }
  }

  /**
   * Dossier: click a perk. An owned one opens; any other shows its text, and buys it
   * when it can be bought (RULED 2026-10-08: players buy freely with unspent XP; Edit
   * mode adds it free; a Pick one tier warns that the choice is the GM's to undo).
   */
  static async #onPerkNode(event, target) {
    const tree = game.items?.get(target.closest(".tree-view")?.dataset.treeId);
    const nodeId = target.dataset.nodeId;
    const found = tree?.system.findNode(nodeId);
    if ( !found ) return null;
    const { owned, entered, role } = this.#treeState();
    if ( owned.has(nodeId) ) return this.actor.items.get(owned.get(nodeId))?.sheet.render({ force: true });

    const free = this.isEditMode;
    let st = nodeStates(tree.system, { owned, unspent: this.actor.system.xp.unspent, free, nameOf: nodeName,
      unmet: this.#unmetFor() }).get(nodeId);
    const lock = free ? "" : specializationLock(tree, { role, earned: this.actor.system.xp.earned, entered, rules: specializationRules() });
    if ( lock ) st = { ...st, state: "locked", canBuy: false, reason: lock };
    const entering = (tree.system.kind === "specialization") && !entered.includes(tree.id);
    const source = found.node.uuid ? await foundry.utils.fromUuid(found.node.uuid) : null;
    const name = source?.name ?? found.node.name;
    const description = source
      ? await TextEditor.enrichHTML(source.system.description ?? "", { relativeTo: source })
      : "<p>This ability is missing from the world. Ask the GM to fix the tree.</p>";
    const rivals = found.exclusive
      ? tree.system.tiers[found.tier].nodes.filter(n => n.id !== nodeId).map(nodeName) : [];
    // A free form tree (no gating) has lines, not tiers, so no tier is named (2026-10-08).
    const meta = [tree.system.tabLabel, tree.system.gated ? `Tier ${found.tier + 1}` : null, free ? "free in Edit mode" : `${st.cost} XP`].filter(Boolean);
    const content = `<div class="irop-dialog perk-view">
      <p class="lede">${escapeText(meta.join(", "))}</p>
      <div class="perk-description">${description}</div>
      ${(st.canBuy && rivals.length) ? `<p class="hint warn">Pick one: taking it rules out ${escapeText(listOf(rivals))}. Only the GM can undo that.</p>` : ""}
      ${(st.canBuy && entering) ? `<p class="hint warn">This makes ${escapeText(tree.system.tabLabel)} your ${ordinal(entered.length)} specialization. Only the GM can undo that.</p>` : ""}
      ${st.canBuy ? "" : `<p class="hint">${escapeText(st.reason)}</p>`}
    </div>`;
    const window = { title: name };
    const classes = ["irop", "irop-roll-dialog", "irop-perk-dialog"];
    if ( !st.canBuy || !source ) {
      await DialogV2.prompt({ window, classes, content, ok: { label: "Close" } });
      return null;
    }
    const yes = await DialogV2.confirm({
      window, classes, content,
      yes: { label: free ? "Add free" : `Buy for ${st.cost} XP`, icon: "fa-solid fa-check" },
      no: { label: "Not now" }
    });
    if ( !yes ) return null;
    if ( !free && (this.actor.system.xp.unspent < st.cost) ) {
      ui.notifications.warn(`${name} costs ${st.cost} XP; ${this.actor.system.xp.unspent} unspent.`);
      return null;
    }
    return this.#takePerk(tree, found.node, source, free ? 0 : st.cost);
  }

  /**
   * Put a copy of the perk's ability on the operative, marked with its tree and node,
   * and write the XP to the ledger. The copy is the character's own: editing it
   * changes no one else's.
   */
  async #takePerk(tree, node, source, cost) {
    const data = source.toObject();
    for ( const key of ["_id", "folder", "sort", "ownership"] ) delete data[key];
    foundry.utils.setProperty(data, "flags.irop.perk", { tree: tree.id, node: node.id, xp: cost });
    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    if ( !created || !cost ) return created ?? null;
    const log = [...this.actor.system._source.xp.log,
      xpEntry("perk", `${source.name} (${tree.system.tabLabel})`, cost, node.id, 0)];
    await this.actor.update({ "system.xp.log": log });
    return created;
  }

  /**
   * GM, Edit mode: reset one of the character's trees so they can retrain (RULED
   * 2026-10-08). Every perk they hold in it comes off; perks bought with XP are
   * refunded from the ledger; perks from before the ledger can be refunded at the
   * tree's prices; perks added free in Edit mode refund nothing.
   */
  static async #onResetTree(event, target) {
    if ( !game.user.isGM ) return null;
    const tree = game.items?.get(target.closest(".tree-view")?.dataset.treeId);
    if ( !tree ) return null;
    const { owned } = this.#treeState();
    const held = tree.system.tiers.flatMap(t => t.nodes).filter(n => owned.has(n.id));
    if ( !held.length ) return null;
    const log = this.actor.system._source.xp.log;
    const refs = new Set(held.map(n => n.id));
    const ledgerXp = log.filter(e => (e.kind === "perk") && refs.has(e.ref)).reduce((s, e) => s + (Number(e.xp) || 0), 0);
    const onLedger = new Set(log.filter(e => e.kind === "perk").map(e => e.ref));
    // Perks with no tree mark came from before the ledger (Sandbox); marked ones off the ledger were free.
    const older = held.filter(n => !onLedger.has(n.id) && !this.actor.items.get(owned.get(n.id))?.flags?.irop?.perk);
    const olderXp = older.reduce((s, n) => s + n.xp, 0);
    const data = await DialogV2.input({
      window: { title: `Reset ${tree.system.tabLabel}: ${this.actor.name}` },
      classes: ["irop", "irop-roll-dialog"],
      content: `<div class="irop-dialog">
        <p>Take these ${held.length} perks off ${escapeText(this.actor.name)}, so they can retrain:</p>
        <p class="lede">${escapeText(listOf(held.map(nodeName)))}</p>
        ${ledgerXp ? `<p>${ledgerXp} XP bought on the ledger comes back.</p>` : ""}
        ${olderXp ? `<label class="check"><input type="checkbox" name="older" checked> Also refund ${olderXp} XP for the ${older.length} perk${older.length === 1 ? "" : "s"} from before the ledger, at this tree's prices</label>` : ""}
      </div>`,
      ok: { label: "Reset", icon: "fa-solid fa-rotate-left" }
    });
    if ( !data ) return null;
    await this.actor.deleteEmbeddedDocuments("Item", held.map(n => owned.get(n.id)).filter(id => this.actor.items.get(id)));
    const next = log.filter(e => !((e.kind === "perk") && refs.has(e.ref)));
    if ( olderXp && data.older ) next.push(xpEntry("refund", `${tree.system.tabLabel} reset: perks from before the ledger`, -olderXp, tree.id, 0));
    return this.actor.update({ "system.xp.log": next });
  }

  /** Sort owned items into the lists the sheet shows. */
  #prepareItems() {
    const out = {
      weapons: [], armors: [], deployables: [], gear: [], looseMods: [], stowed: [], activeAbilities: [], passiveAbilities: [],
      boons: [], mutations: [], species: null, role: null, background: null
    };
    const sorted = this.actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const rollData = this.actor.system.getRollData?.() ?? {};
    const abilities = this.actor.items.filter(i => i.type === "ability");
    const perkCtx = perkContext(this.actor);
    for ( const item of sorted ) {
      const s = item.system;
      // Stowed things leave their usual list for the Gear tab's Stowed box (Johnald, 2026-10-07).
      // A mod fitted to a weapon or armor travels with its host, so it is never listed on its own.
      if ( s.stowed && STOWABLE.includes(item.type) && !((item.type === "mod") && s.host) && !s.loadedHost ) {
        out.stowed.push({ item, id: item.id, name: item.name, img: item.img, system: s,
          typeLabel: stowedLabel(item), showQty: item.type === "gear" });
        continue;
      }
      switch ( item.type ) {
        case "weapon": {
          // What the role perks do with it (2026-10-18), folded into its boxes and listed on a chip.
          const perk = weaponPerkSummary(abilities, item, perkCtx);
          const dmgBox = damageStat(s, rollData);
          if ( perk.damage && (dmgBox.value !== "none") ) {
            dmgBox.value = `${dmgBox.value} + ${perk.damage}`;
            dmgBox.tip = `${dmgBox.tip}, + ${perk.damage} from perks`;
            dmgBox.cls = `${dmgBox.cls ?? ""} from-perks`.trim();
          }
          const crit = -s.critical.chance + perk.critical;
          out.weapons.push({
            perkLines: perk.lines, perkTip: perk.lines.join("; "),
            item, id: item.id, name: item.name, img: item.img, system: s,
            categoryLabel: IROP.weaponCategories[s.category]?.label,
            classLabel: IROP.weaponClasses[s.weaponClass],
            classShort: IROP.weaponClassShort[s.weaponClass] ?? IROP.weaponClasses[s.weaponClass],
            // Shown as the D.M. it puts on the roll, as the Field Manual's weapon cards print it:
            // roll under, so minus is the bonus. Accuracy 30 reads "-30" (Johnald, 2026-10-07).
            accuracyText: signed(-s.accuracy),
            critText: signed(-s.critical.chance),
            damageType: IROP.damageTypes[s.damage.type]?.label,
            damageText: shownFormula(s.damage.formula, rollData),
            damageWords: formulaInWords(s.damage.formula),
            // The row's labelled boxes, in fixed columns (Johnald, 2026-10-08). Ammo follows them in the template.
            stats: [
              { label: "Accuracy", value: signed(-s.accuracy), dim: !s.accuracy,
                tip: "Accuracy D.M. on the attack roll: minus makes it easier" },
              dmgBox,
              typeStat(s),
              { label: "Crit", value: signed(crit), dim: !crit, cls: perk.critical ? "from-perks" : "",
                tip: `Critical D.M. on the critical roll: minus makes a crit likelier${perk.critical ? ` (${signed(-s.critical.chance)} the weapon's, ${signed(perk.critical)} from perks)` : ""}` }
            ],
            isGrenade: s.weaponClass === "grenade",
            // Grenades, rockets and explosives show how many are carried, which the player can type in (2026-10-10).
            counted: isCountedWeapon(item) && (s.feed !== "singleUse"),
            section: s.section,
            takesAmmo: s.takesSpecialAmmo,
            specialAmmo: s.specialAmmo ? { id: s.specialAmmo.id, name: s.specialAmmo.name, img: s.specialAmmo.img,
              quantity: s.specialAmmo.system.quantity,
              tip: `${s.specialAmmo.name}: ${s.specialAmmo.system.quantity} ${s.specialAmmo.system.quantity === 1 ? "magazine" : "magazines"}, one loaded. ${
                ammoSummary(s.specialAmmo.system.ammo) || "No special effects set."}` } : null,
            showTray: !!s.slots || s.takesSpecialAmmo || !!s.projectileSlots,
            // Rockets are ammunition for a rocket launcher, not fired on their own (2026-10-08).
            canAttack: (s.weaponClass !== "rocket") && (!!s.attackAttribute || !!s.damage.formula || (s.feed === "fuel")),
            feed: s.feed,
            isFuel: s.feed === "fuel",
            isSingleUse: s.feed === "singleUse",
            projectiles: projectileSlots(s),
            projectileNoun: IROP.weaponFeeds[s.feed]?.noun ?? "",
            ammo: s.usesAmmo ? `${s.ammo.value}/${s.ammo.max}` : null,
            mods: s.mods.map(m => ({ id: m.id, name: m.name, img: m.img })),
            slots: s.slots,
            freeSlots: Math.max(0, s.slots - s.mods.length)
          });
          break;
        }
        case "armor":
          out.armors.push({
            item, id: item.id, name: item.name, img: item.img, system: s,
            classLabel: IROP.armorClasses[s.armorClass],
            stats: armorStats(s),
            drText: Object.entries(s.dr).filter(([, n]) => n).map(([k, n]) => `${IROP.damageTypes[k].label} ${n}`).join(", "),
            mobilityText: Object.entries(s.mobility).filter(([, n]) => n).map(([k, n]) => `${IROP.speeds[k]} ${signed(n)}`).join(", "),
            mods: s.mods.map(m => ({ id: m.id, name: m.name, img: m.img })),
            slots: s.slots,
            freeSlots: Math.max(0, s.slots - s.mods.length)
          });
          break;
        case "gear":
          // Special ammo loaded into a weapon shows in that weapon's ammo slot instead.
          if ( s.loadedHost ) break;
          // Deployables get their own box on the Combat tab (Johnald, 2026-10-08).
          ((s.kind === "deployable") ? out.deployables : out.gear).push({
            item, id: item.id, name: item.name, img: item.img, system: s, kindLabel: IROP.gearKinds[s.kind],
            formulaText: shownFormula(s.formula, rollData), formulaWords: formulaInWords(s.formula),
            ammoText: s.kind === "ammunition" ? ammoSummary(s.ammo) : "",
            // Uses left in the one in hand, when a perk gives it more (Field Medic, 2026-10-18).
            ...((charges => (charges ? { usesLeft: 1 + charges - (Number(s.used) || 0), usesPer: 1 + charges } : {}))(gearCharges(abilities, item))) });
          break;
        case "mod":
          if ( !s.host ) out.looseMods.push({ item, id: item.id, name: item.name, img: item.img, system: s,
            targetLabel: IROP.modTargets[s.target] });
          break;
        case "ability": {
          const row = {
            item, id: item.id, name: item.name, img: item.img, system: s,
            sourceLabel: IROP.abilitySources[s.source], accent: IROP.roles[s.source]?.color ?? null,
            actionLabel: IROP.actionTypes[s.actionType],
            discipline: IROP.disciplines[s.paraphysics.discipline] ?? null,
            // A passive's tile shows what it does on hover (2026-10-08), and what of it is automated (2026-10-18).
            tip: (s.kind === "passive") ? [plainText(s.description), automationText(item)].filter(Boolean).join(" ") : "",
            automated: automationText(item),
            // Its Energy cost as the character's other perks leave it (Efficient Fire: one less), and the
            // ammo an attack active spends (2026-10-18).
            ...abilityCost(item, abilities),
            // A passive with limited uses (Swift Hands) is used from its tile.
            usable: (s.kind === "passive") && !!perkUses(item),
            ruledUses: perkUses(item, Object.fromEntries(Object.entries(this.actor.system.attributes ?? {}).map(([k, a]) => [k, a.mod])))
          };
          (s.kind === "active" ? out.activeAbilities : out.passiveAbilities).push(row);
          break;
        }
        case "boon":
          out.boons.push({ item, id: item.id, name: item.name, img: item.img,
            text: `${IROP.attributes[s.attribute]?.abbr} ${signed(s.amount)}` });
          break;
        case "mutation":
          // A choice it asks for (2026-10-17): waiting, or what was chosen.
          out.mutations.push({ item, id: item.id, name: item.name, img: item.img, polarity: s.polarity,
            awaits: !!s.awaitsChoice, chosen: mutationChosenText(s) });
          break;
        case "species":
        case "role":
        case "background":
          out[item.type] = { item, id: item.id, name: item.name, img: item.img };
          break;
      }
    }
    // The Weapons box in sections, Ranged, Melee, Special, Explosives; empty ones are left out.
    out.weaponGroups = Object.entries(IROP.weaponGroups)
      .map(([key, label]) => ({ key, label, weapons: out.weapons.filter(w => w.section === key) }))
      .filter(g => g.weapons.length);
    return out;
  }

  /** Effects on the actor and those its items transfer, with where each comes from. */
  #prepareEffects() {
    const list = [];
    for ( const effect of this.actor.allApplicableEffects() ) {
      const changes = effectChanges(effect);
      if ( effect.statuses.size && !changes.length && (effect.parent === this.actor) ) continue;
      list.push({
        effect, id: effect.id, name: effect.name, img: effect.img, disabled: effect.disabled || effect.isSuppressed,
        suppressed: effect.isSuppressed,
        source: effect.parent === this.actor ? "Actor" : effect.parent?.name,
        owned: effect.parent === this.actor,
        itemId: effect.parent === this.actor ? "" : effect.parent?.id,
        // An item's effect is part of the item, and items are the GM's to change (Johnald,
        // 2026-10-10: "I dont want players editing any items"): players read it, no more.
        locked: (effect.parent !== this.actor) && !game.user?.isGM,
        changes: changes.map(describeChange).join("; ")
      });
    }
    return list;
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if ( context.accent ) root.style.setProperty("--irop-accent", context.accent);
    else root.style.removeProperty("--irop-accent");
    root.classList.toggle("edit-mode", this.isEditMode);
    this.#fitPortrait();

    // Dossier: look at another role's specialization (cross training, 2026-10-08).
    root.querySelector("select[data-browse-tree]")?.addEventListener("change", event => {
      event.stopPropagation();
      this.#browseTree = event.target.value || null;
      if ( this.#browseTree ) this.#activeTree = this.#browseTree;
      this.render();
    });

    // Inline edits on item rows (quantity, ammo) update the item, not the actor.
    for ( const input of root.querySelectorAll("[data-item-field]") ) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const item = this.actor.items.get(input.closest("[data-item-id]")?.dataset.itemId);
        if ( !item ) return;
        let value = input.type === "checkbox" ? input.checked : Number(input.value);
        // A count typed in is a whole number, never below none.
        if ( input.dataset.itemField === "system.quantity" ) value = Math.max(0, Math.round(value) || 0);
        // Uses left (2026-10-10, the ability's Details tab being the GM's): none up to the most it holds.
        if ( input.dataset.itemField === "system.uses.value" ) value = Math.min(item.system.uses?.max || Infinity, Math.max(0, Math.round(value) || 0));
        item.update({ [input.dataset.itemField]: value });
      });
    }

    // A status that is on with an (X): a right-click changes its X (2026-10-10).
    for ( const button of root.querySelectorAll(".status-grid .status.active[data-counter]") ) {
      button.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        this.#changeStatusValue(button.dataset.status);
      });
    }
  }

  /** Change the X of a status the actor has, in the same popup it went on with. */
  async #changeStatusValue(id) {
    if ( !this.isEditable || !this.actor.statuses.has(id) ) return;
    const value = await askStatusValue(id, { current: statusValue(this.actor, id) || 1, actorName: this.actor.name });
    if ( value !== null ) await setStatus(this.actor, id, value);
  }

  /**
   * Size the portrait to the taller of the vitals column and the identity column
   * (name, callsign, and the Role, Species and Background list, 2026-10-08), so no
   * gap opens under it. Watched rather than measured once: edit mode, luck pips, an
   * NPC's shorter column and late loading fonts all change those heights. Neither
   * depends on the portrait: the vitals column has a fixed width, and the identity
   * lines keep to one line each however narrow they get.
   */
  #fitPortrait() {
    this.#portraitObserver?.disconnect();
    this.#portraitObserver = null;
    const header = this.element.querySelector(".irop-header");
    const vitals = header?.querySelector(".vitals");
    if ( !vitals ) return;
    const identity = header.querySelector(".identity");
    // Kept on the window, not the header (bug, Johnald, 2026-10-17): a re-render replaces the header,
    // which then showed the 112px default for a frame before this caught up, so the portrait jiggled.
    const root = this.element;
    this.#portraitObserver = new ResizeObserver(() => {
      const tallest = Math.max(vitals.offsetHeight, identity?.offsetHeight ?? 0);
      const size = `${portraitSize(tallest)}px`;
      if ( root.style.getPropertyValue("--irop-portrait") !== size ) root.style.setProperty("--irop-portrait", size);
    });
    this.#portraitObserver.observe(vitals);
    if ( identity ) this.#portraitObserver.observe(identity);
  }

  /** @inheritDoc */
  _onClose(options) {
    this.#portraitObserver?.disconnect();
    this.#portraitObserver = null;
    super._onClose(options);
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /** @override */
  async _onDropItem(event, item) {
    if ( !this.actor.isOwner ) return null;
    if ( item.type === "skillTree" ) {
      ui.notifications.info("Perk trees stay in the Items sidebar. The Training tab shows the trees for the character's role.");
      return null;
    }
    // The Strategy Layer's items belong to the War Room, not to a character (2026-10-08).
    if ( item.type === "territory" ) {
      ui.notifications.info("Territories stay in the Items sidebar. Open the War Room to see them.");
      return null;
    }
    if ( item.type === "project" ) {
      ui.notifications.info("Projects stay in the Items sidebar. Assign operatives to them from the ODR window.");
      return null;
    }
    const own = item.parent?.uuid === this.actor.uuid;

    // A mod dropped onto a weapon or armor fits it; special ammunition dropped on a ranged weapon loads it.
    const host = event.target.closest("[data-mod-host]");
    // A grenade or rocket dropped on a launcher loads into a free slot.
    if ( (item.type === "weapon") && ["grenade", "rocket"].includes(item.system.weaponClass) && host ) {
      return this.#loadProjectile(item, host.dataset.modHost, own);
    }
    if ( (item.type === "gear") && (item.system.kind === "ammunition") && host ) {
      return this.#loadAmmo(item, host.dataset.modHost, own);
    }
    if ( (item.type === "mod") && host ) return this.#fitMod(item, host.dataset.modHost, own);
    if ( own ) return super._onDropItem(event, item);

    // A power dropped in Play mode is learned, for a psycrystal (Framework Draft 0.6, 2026-10-19).
    if ( (item.type === "ability") && item.system.paraphysics?.discipline && (this.actor.type === "operative") && !this.isEditMode ) {
      return learnPower(this, item, () => super._onDropItem(event, item));
    }

    // Only Mutants carry mutations.
    if ( (item.type === "mutation") && !this.actor.system.canMutate ) {
      ui.notifications.warn(`Only Mutants carry mutations. ${this.actor.name}'s species does not.`);
      return null;
    }

    // Only Humans take boons.
    if ( (item.type === "boon") && !this.actor.system.canTakeBoons ) {
      ui.notifications.warn(`Only Humans take boons. ${this.actor.name}'s species does not.`);
      return null;
    }

    // One species, role and background each: a new one replaces the old.
    if ( SINGLETONS.includes(item.type) ) {
      const old = this.actor.items.filter(i => i.type === item.type).map(i => i.id);
      if ( old.length ) await this.actor.deleteEmbeddedDocuments("Item", old);
    }

    // What is counted stacks by name: gear, and the weapons used up one at a time (grenades,
    // rockets, explosives, the LAW). Johnald, 2026-10-10: dragged from the sidebar, they did not.
    const stack = stackFor(this.actor.items, item);
    if ( stack ) return stack.update({ "system.quantity": (Number(stack.system.quantity) || 0) + (Number(item.system.quantity) || 1) });

    const created = await super._onDropItem(event, item);
    if ( created && (item.type === "species") ) await this.#offerSpeciesAttributes(created);
    // The first role and background bring free starting skills (2026-10-08).
    if ( created && ["role", "background"].includes(item.type) ) await this.#offerStartingSkills(created);
    if ( created?.type === "background" ) await this.#offerBackgroundPerk(created);
    return created;
  }

  /** Ask whether a new species should set the base attributes. */
  /**
   * Offer a role's or background's free starting skills, once per slot (RULED
   * 2026-10-08): the role's first skill plus a pick of one of the others; three of a
   * background's six. Each skill taken goes up one rank. Cancelling leaves a "Pick
   * starting skills" button on the Dossier, in Edit mode.
   */
  async #offerStartingSkills(source) {
    if ( this.actor.type !== "operative" ) return null;
    const slot = source.type;
    if ( this.actor.system.details.startingSkills?.[slot] ) return null;
    const plan = startingSkillPlan(source);
    if ( !plan.granted.length && !plan.options.length ) return null;
    const label = key => IROP.skills[key]?.label ?? key;
    const rank = key => this.actor.system.skills[key]?.rank ?? 0;
    const content = `<div class="irop-dialog starting-skills" data-pick="${plan.pick}">
      ${plan.granted.length ? `<p>Free: <strong>${plan.granted.map(label).join(", ")}</strong></p>` : ""}
      ${plan.pick ? `<p>Pick ${plan.pick} of these:</p>
        <div class="toggle-list">${plan.options.map(key => `<label><input type="checkbox" name="skill.${key}">
          <span>${escapeText(label(key))}</span><em>${rank(key) ? `rank ${rank(key)} now` : ""}</em></label>`).join("")}</div>` : ""}
      <p class="hint">Each goes up one rank. One already trained goes up one more.</p>
      ${plan.unknown.length ? `<p class="hint warn">Not a skill, skipped: ${escapeText(plan.unknown.join(", "))}</p>` : ""}
    </div>`;
    const data = await foundry.applications.api.DialogV2.input({
      window: { title: `${source.name}: starting skills` },
      content,
      ok: { label: "Take them", icon: "fa-solid fa-check" },
      render: (event, dialog) => limitPicks(dialog.element, plan.pick)
    });
    if ( !data ) return null;
    const chosen = plan.options.filter(key => data[`skill.${key}`] ?? data.skill?.[key]).slice(0, plan.pick);
    if ( chosen.length < plan.pick ) {
      ui.notifications.warn(`Pick ${plan.pick} from ${source.name}'s list. Nothing was taken; try again from the Training tab in Edit mode.`);
      return null;
    }
    const ranks = Object.fromEntries(Object.entries(this.actor.system.skills).map(([k, s]) => [k, s.rank]));
    const { update, capped } = startingSkillRanks(ranks, [...plan.granted, ...chosen]);
    if ( capped.length ) ui.notifications.info(`Already at the top rank: ${capped.map(label).join(", ")}.`);
    update[`system.details.startingSkills.${slot}`] = source.name;
    return this.actor.update(update);
  }

  /* -------------------------------------------- */
  /*  Background perks (2026-10-10)               */
  /* -------------------------------------------- */

  /** The header's Background row: the perk taken, or whether one waits to be picked. */
  #backgroundPerkChip(background) {
    if ( !background ) return {};
    const perk = takenPerk(this.actor.items, background.name);
    const offers = (liveBackground(background).system?.perks?.length ?? 0) > 0;
    return { perk: perk ? { id: perk.id, name: perk.name } : null, perkPick: !perk && offers };
  }

  /**
   * Offer a background's perks, after its starting skills (Johnald, 2026-10-10): pick one, and
   * a copy of its ability goes on the operative. Cancelling leaves a Pick button on the
   * Background row, in Edit mode.
   */
  async #offerBackgroundPerk(background) {
    if ( this.actor.type !== "operative" ) return null;
    if ( takenPerk(this.actor.items, background.name) ) return null;
    const choices = [];
    for ( const perk of liveBackground(background).system?.perks ?? [] ) {
      const source = perk.uuid ? await foundry.utils.fromUuid(perk.uuid) : null;
      if ( source?.type === "ability" ) choices.push({ perk, source });
    }
    if ( !choices.length ) return null;
    const rows = [];
    for ( const { perk, source } of choices ) {
      const s = source.system;
      const meta = perkMeta(s);
      const description = await TextEditor.enrichHTML(s.description ?? "", { relativeTo: source });
      rows.push(`<label class="perk-choice"><input type="radio" name="perk" value="${perk.id}">
        <img src="${escapeText(source.img)}" alt="">
        <span class="perk-choice-body"><strong>${escapeText(source.name)}</strong><span class="perk-choice-meta">${escapeText(meta)}</span>
        <span class="perk-description">${description || "<p class=\"hint\">No description yet.</p>"}</span></span></label>`);
    }
    const data = await DialogV2.input({
      window: { title: `${background.name}: background perk` },
      classes: ["irop", "irop-roll-dialog", "irop-perk-dialog", "irop-background-perk-dialog"],
      position: { width: 520 },
      content: `<div class="irop-dialog background-perk-pick"><p class="lede">Take one of ${escapeText(background.name)}'s perks.</p>
        <div class="perk-choices">${rows.join("")}</div></div>`,
      ok: { label: "Take it", icon: "fa-solid fa-check" },
      rejectClose: false
    });
    if ( !data ) return null;
    const pick = choices.find(c => c.perk.id === data.perk);
    if ( !pick ) {
      ui.notifications.warn(`Pick one of ${background.name}'s perks. Nothing was taken; pick again from the Background row in Edit mode.`);
      return null;
    }
    const [created] = await this.actor.createEmbeddedDocuments("Item", [perkCopy(pick.source.toObject(), background.name, pick.perk)]);
    return created ?? null;
  }

  /** Background row button: pick the background's perk, if none is taken yet. */
  static #onPickBackgroundPerk() {
    const background = this.actor.items.find(i => i.type === "background");
    return background ? this.#offerBackgroundPerk(background) : null;
  }

  /** GM, Edit mode: take the background's perk off, so one can be picked again. */
  static async #onResetBackgroundPerk() {
    if ( !game.user.isGM ) return null;
    const background = this.actor.items.find(i => i.type === "background");
    const perk = background ? takenPerk(this.actor.items, background.name) : null;
    if ( !perk ) return null;
    const ok = await DialogV2.confirm({
      window: { title: "Background perk" },
      content: `<p>Take ${escapeText(perk.name)} off ${escapeText(this.actor.name)}, so a ${escapeText(background.name)} perk can be picked again?</p>`
    });
    if ( !ok ) return null;
    return perk.delete();
  }

  /** Dossier button: take a role's or background's starting skills, if not yet taken. */
  static #onPickStartingSkills(event, target) {
    const source = this.actor.items.find(i => i.type === target.dataset.source);
    if ( source ) return this.#offerStartingSkills(source);
    return null;
  }

  /** GM, Edit mode: forget that a slot's starting skills were taken, so they can be picked again. */
  static #onResetStartingSkills(event, target) {
    if ( !game.user.isGM ) return null;
    return this.actor.update({ [`system.details.startingSkills.${target.dataset.source}`]: "" });
  }

  async #offerSpeciesAttributes(species) {
    const attrs = species.system.attributes;
    const list = Object.entries(IROP.attributes).map(([k, a]) => `${a.abbr} ${attrs[k]}`).join(", ");
    const ok = await DialogV2.confirm({
      window: { title: `${species.name} attributes` },
      content: `<p>Set ${this.actor.name}'s base attributes to the ${species.name} block?</p><p><strong>${list}</strong></p>
        <p>Advances and boons are kept on top.</p>`
    });
    if ( !ok ) return;
    const update = {};
    for ( const k of Object.keys(IROP.attributes) ) update[`system.attributes.${k}.base`] = attrs[k];
    await this.actor.update(update);
  }

  /** Fit a mod to an owned weapon or armor, enforcing slots, kind and one of each. */
  /**
   * Load special ammunition into a ranged weapon, taking out whatever it held.
   * Ammo from the sidebar or a compendium is copied onto the character first.
   */
  async #loadAmmo(ammo, hostId, own) {
    const host = this.actor.items.get(hostId);
    if ( !host ) return null;
    if ( !host.system.takesSpecialAmmo ) {
      ui.notifications.warn(`Only ranged weapons take special ammo, and ${host.name} is not one.`);
      return null;
    }
    const current = host.system.specialAmmo;
    if ( current && (current.id !== ammo.id) ) await current.update({ "system.loadedIn": "" });
    // Loading special ammo is a reload: a fresh magazine of it (RULED 2026-10-08).
    if ( host.system.usesAmmo ) await host.update({ "system.ammo.value": host.system.ammo.max });
    if ( own ) return ammo.update({ "system.loadedIn": host.id, "system.stowed": false });
    const data = ammo.toObject();
    data.system.loadedIn = host.id;
    data.system.stowed = false;
    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    return created;
  }

  async #fitMod(mod, hostId, own) {
    const host = this.actor.items.get(hostId);
    if ( !host ) return null;
    const kind = modKindFor(host);
    if ( mod.system.target !== kind ) {
      ui.notifications.warn(`${mod.name} fits a ${IROP.modTargets[mod.system.target].toLowerCase()}, not ${host.name}.`);
      return null;
    }
    const fitted = host.system.mods.filter(m => m.id !== mod.id);
    if ( fitted.length >= host.system.slots ) {
      ui.notifications.warn(`${host.name} has no free mod slots (${host.system.slots}).`);
      return null;
    }
    if ( fitted.some(m => m.name === mod.name) ) {
      ui.notifications.warn(`${host.name} already has ${mod.name} fitted.`);
      return null;
    }
    if ( own ) return mod.update({ "system.installedOn": host.id });
    const data = mod.toObject();
    data.system.quantity = 1;
    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    await created.update({ "system.installedOn": host.id });
    return created;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #itemFrom(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return this.actor.items.get(id);
  }

  static async #onToggleMode() {
    this.#mode = this.#mode === "edit" ? "play" : "edit";
    // A player back in Play mode on the Effects tab goes back to the first tab, the Effects tab being gone.
    if ( !this.showsEffects && (this.tabGroups?.primary === "effects") ) this.tabGroups.primary = "main";
    return this.render();
  }

  static #onRollAttribute(event, target) {
    return this.actor.rollAttribute(target.dataset.attribute);
  }

  static #onRollSkill(event, target) {
    return this.actor.rollSkill(target.dataset.skill);
  }

  static #onRollDodge() {
    return this.actor.rollDodge();
  }

  static #onRollPool() {
    return this.actor.rollPool();
  }

  static #onRollInitiative() {
    return this.actor.rollInitiative({ createCombatants: true });
  }

  static #onResetDodges() {
    return this.actor.resetDodges();
  }

  static #onUseItem(event, target) {
    return IropActorSheet.#itemFrom.call(this, target)?.use();
  }

  static #onPostItem(event, target) {
    const item = IropActorSheet.#itemFrom.call(this, target);
    if ( item ) return rolls.postItemCard(this.actor, item);
  }

  static #onEditItem(event, target) {
    return IropActorSheet.#itemFrom.call(this, target)?.sheet.render({ force: true });
  }

  static async #onDeleteItem(event, target) {
    const item = IropActorSheet.#itemFrom.call(this, target);
    if ( !item ) return;
    // RULED 2026-10-08: perks from a perk tree are soft permanent; only the GM removes them.
    if ( item.flags?.irop?.perk && !game.user.isGM ) {
      ui.notifications.warn(`${item.name} came from a perk tree. Only the GM can take it back, from the ledger on the Training tab.`);
      return;
    }
    if ( event.shiftKey ) return item.delete();
    return item.deleteDialog();
  }

  /**
   * A new item on the sheet. The GM makes any kind; a player only simple gear of their own, a
   * trinket say, marked as theirs so they can name, picture and describe it (Johnald, 2026-10-10).
   */
  static async #onCreateItem(event, target) {
    const { type, kind } = target.dataset;
    const homebrew = !game.user?.isGM;
    if ( homebrew && ((type !== "gear") || (kind && (kind !== "general"))) ) return null;
    const name = homebrew ? "New Trinket" : `New ${game.i18n.localize(`TYPES.Item.${type}`)}`;
    const system = {};
    if ( kind ) system.kind = kind;
    const data = { type, name, system };
    if ( homebrew ) data.flags = { irop: { homebrew: true } };
    const [item] = await this.actor.createEmbeddedDocuments("Item", [data]);
    return item?.sheet.render({ force: true });
  }

  static #onToggleEquip(event, target) {
    const item = IropActorSheet.#itemFrom.call(this, target);
    return item?.update({ "system.equipped": !item.system.equipped });
  }

  static #onToggleStow(event, target) {
    const item = IropActorSheet.#itemFrom.call(this, target);
    if ( !item ) return;
    const stowing = !item.system.stowed;
    // Anything packed away is no longer held or worn.
    const update = { "system.stowed": stowing };
    if ( stowing && item.system.equipped ) update["system.equipped"] = false;
    return item.update(update);
  }

  static async #onReload(event, target) {
    const item = IropActorSheet.#itemFrom.call(this, target);
    if ( !item?.system.usesAmmo ) return;
    // RULED 2026-10-08: a reload swaps out a loaded special ammo magazine, spending it.
    // Its quantity counts magazines; the last one deletes the item.
    const special = item.system.specialAmmo;
    if ( special ) {
      const left = special.system.quantity - 1;
      if ( left > 0 ) await special.update({ "system.quantity": left, "system.loadedIn": "" });
      else await special.delete();
      ui.notifications.info(`${item.name} reloaded with standard rounds. ${special.name} spent${left > 0 ? `, ${left} left` : ", none left"}.`);
    }
    return item.update({ "system.ammo.value": item.system.ammo.max });
  }

  /** Take special ammo out of its weapon; it goes back to the Gear list. */
  static #onUnloadAmmo(event, target) {
    const ammo = this.actor.items.get(target.dataset.ammoId);
    return ammo?.update({ "system.loadedIn": "" });
  }

  /** Click an empty ammo slot: pick from the special ammunition the character carries. */
  /**
   * Load one grenade or rocket into a launcher's free slot (RULED 2026-10-08). One is
   * taken from the character's stack (the slot keeps a copy of it); one dropped in from
   * the sidebar or a compendium is simply loaded.
   */
  async #loadProjectile(projectile, hostId, own) {
    const host = this.actor.items.get(hostId);
    if ( !host ) return null;
    const feed = IROP.weaponFeeds[host.system.feed];
    if ( !feed?.slots ) {
      ui.notifications.warn(`${host.name} does not load grenades or rockets.`);
      return null;
    }
    if ( projectile.system.weaponClass !== feed.takes ) {
      ui.notifications.warn(`${host.name} loads ${feed.noun}s, and ${projectile.name} is not one.`);
      return null;
    }
    if ( host.system.loaded.length >= feed.slots ) {
      ui.notifications.warn(`${host.name} is full (${feed.slots} ${feed.slots === 1 ? "slot" : "slots"}).`);
      return null;
    }
    if ( own && (projectile.system.quantity <= 0) ) {
      ui.notifications.warn(`${this.actor.name} has no ${projectile.name} left.`);
      return null;
    }
    const copy = projectile.toObject();
    copy.system.quantity = 1;
    const loaded = [...host.system.loaded.map(l => ({ ...l })), { name: copy.name, img: copy.img, system: copy.system }];
    await host.update({ "system.loaded": loaded });
    // Taken from the character's stack; loading the last one leaves none behind (2026-10-08).
    if ( own ) await rolls.spendOne(projectile);
    return host;
  }

  /** Click a loaded grenade or rocket: fire it, as the Attack button would. */
  static #onFireProjectile(event, target) {
    const host = IropActorSheet.#itemFrom.call(this, target);
    if ( !host ) return null;
    return rolls.rollAttack(this.actor, host, { projectile: Number(target.dataset.slot) || 0 });
  }

  /** Click an empty launcher slot: pick a grenade or rocket the character carries. */
  static async #onChooseProjectile(event, target) {
    const host = IropActorSheet.#itemFrom.call(this, target);
    const feed = host ? IROP.weaponFeeds[host.system.feed] : null;
    if ( !feed?.slots ) return null;
    const stock = this.actor.items.filter(i => (i.type === "weapon") && (i.system.weaponClass === feed.takes)
      && (i.system.quantity > 0));
    if ( !stock.length ) {
      return ui.notifications.info(`${this.actor.name} carries no ${feed.noun}s to load.`);
    }
    const options = stock.map(p => `<option value="${p.id}">${escapeText(p.name)} (x${p.system.quantity})</option>`).join("");
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: `Load ${host.name}` },
      content: `<label class="irop-choose"><span>${feed.noun[0].toUpperCase()}${feed.noun.slice(1)}</span><select name="projectile">${options}</select></label>`,
      ok: { label: "Load", icon: "fa-solid fa-check" }
    });
    const chosen = result && this.actor.items.get(result.projectile);
    if ( chosen ) return this.#loadProjectile(chosen, host.id, true);
    return null;
  }

  /** Take a grenade or rocket back out of its slot and return it to the character's stack. */
  static async #onUnloadProjectile(event, target) {
    const host = IropActorSheet.#itemFrom.call(this, target);
    const index = Number(target.dataset.slot);
    const shot = host?.system.loaded[index];
    if ( !shot ) return null;
    await host.update({ "system.loaded": host.system.loaded.filter((_, i) => i !== index) });
    const stack = this.actor.items.find(i => (i.type === "weapon") && (i.name === shot.name));
    if ( stack ) return stack.update({ "system.quantity": stack.system.quantity + 1 });
    const [created] = await this.actor.createEmbeddedDocuments("Item", [{ name: shot.name, img: shot.img, type: "weapon", system: shot.system }]);
    return created;
  }

  /** Refill a fuel weapon's tank. */
  static #onRefuel(event, target) {
    const item = IropActorSheet.#itemFrom.call(this, target);
    if ( item?.system.feed !== "fuel" ) return null;
    return item.update({ "system.fuel.value": item.system.fuel.max });
  }

  static async #onChooseAmmo(event, target) {
    const host = IropActorSheet.#itemFrom.call(this, target);
    if ( !host ) return null;
    const ammo = this.actor.items.filter(i => (i.type === "gear") && (i.system.kind === "ammunition") && !i.system.loadedHost);
    if ( !ammo.length ) {
      return ui.notifications.info(`${this.actor.name} carries no special ammo to load. Add some on the Gear tab as Ammunition.`);
    }
    const options = ammo.map(a => `<option value="${a.id}">${escapeText(a.name)} (x${a.system.quantity})</option>`).join("");
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: `Load ${host.name}` },
      content: `<label class="irop-choose"><span>Special ammo</span><select name="ammo">${options}</select></label>`,
      ok: { label: "Load", icon: "fa-solid fa-check" }
    });
    const chosen = result && this.actor.items.get(result.ammo);
    if ( chosen ) return this.#loadAmmo(chosen, host.id, true);
    return null;
  }

  /**
   * Click an empty mod slot: pick from the loose mods the character carries that fit (Johnald,
   * 2026-10-11: a loose mod on the Gear tab could not be dragged to a weapon on the Combat tab).
   * Loose means as the Gear tab's Loose mods box lists them: fitted to nothing, and not stowed.
   */
  static async #onChooseMod(event, target) {
    const host = IropActorSheet.#itemFrom.call(this, target);
    if ( !host ) return null;
    const kind = modKindFor(host);
    const fitted = new Set(host.system.mods.map(m => m.name));
    const loose = this.actor.items.filter(i => (i.type === "mod") && !i.system.host && !i.system.stowed);
    const fits = loose.filter(m => (m.system.target === kind) && !fitted.has(m.name));
    if ( !fits.length ) {
      const takes = IROP.modTargets[kind].toLowerCase();
      return ui.notifications.info(loose.length
        ? `None of ${this.actor.name}'s loose mods fit ${host.name}, which takes ${takes} mods.`
        : `${this.actor.name} carries no loose mods. They wait on the Gear tab until fitted.`);
    }
    const options = fits.map(m => `<option value="${m.id}">${escapeText(m.name)}</option>`).join("");
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: `Fit a mod to ${host.name}` },
      content: `<label class="irop-choose"><span>Loose mod</span><select name="mod">${options}</select></label>`,
      ok: { label: "Fit", icon: "fa-solid fa-check" }
    });
    const chosen = result && this.actor.items.get(result.mod);
    if ( chosen ) return this.#fitMod(chosen, host.id, true);
    return null;
  }

  static #onUnfitMod(event, target) {
    const mod = this.actor.items.get(target.dataset.modId);
    return mod?.update({ "system.installedOn": "" });
  }

  /** Click a pip to set that rank; click the current top pip to step down one. */
  static #onSetRank(event, target) {
    const key = target.dataset.skill;
    const n = Number(target.dataset.rank);
    const current = this.actor.system.skills[key].rank;
    if ( !this.isEditMode ) return this.#buyRank("skill", key, IROP.skills[key]?.label ?? key, current, n);
    return this.actor.update({ [`system.skills.${key}.rank`]: n === current ? n - 1 : n });
  }

  static #onSetAdvance(event, target) {
    const key = target.dataset.attribute;
    const n = Number(target.dataset.rank);
    const current = this.actor.system.attributes[key].advances;
    if ( rankLocked(key) && !(this.isEditMode && game.user?.isGM) ) return ui.notifications.warn(`${IROP.attributes[key]?.label ?? key} cannot be raised.`);
    if ( !this.isEditMode ) return this.#buyRank("attribute", key, IROP.attributes[key]?.label ?? key, current, n);
    return this.actor.update({ [`system.attributes.${key}.advances`]: n === current ? n - 1 : n });
  }

  /**
   * Buy the next attribute or skill pip with XP, in Play mode (RULED 2026-10-08).
   * Asks first, then raises the rank and writes the purchase to the ledger.
   */
  async #buyRank(kind, key, label, current, n) {
    if ( this.actor.type !== "operative" ) return null;
    const check = checkRankPurchase({ kind, key, label, current, n, unspent: this.actor.system.xp.unspent });
    if ( !check.ok ) {
      if ( n === current + 1 ) ui.notifications.warn(check.reason);
      return null;
    }
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Spend XP" },
      content: `<p>Buy rank ${n} ${escapeText(label)} for <strong>${check.cost} XP</strong>? You have ${this.actor.system.xp.unspent} unspent.</p>`
    });
    if ( !ok ) return null;
    const path = (kind === "attribute") ? `system.attributes.${key}.advances` : `system.skills.${key}.rank`;
    const log = [...this.actor.system._source.xp.log, xpEntry(kind, `${label} rank ${n}`, check.cost, key, n)];
    return this.actor.update({ [path]: n, "system.xp.log": log });
  }

  /**
   * A mutation's choice (Johnald, 2026-10-17), for one taken outside the enlistment terminal: which
   * attribute it raises or lowers, and which skill gains its ranks (up to the skill's top rank here;
   * the terminal holds new recruits to rank 2). The skill rank is written to the sheet.
   */
  static async #onChooseMutation(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    const s = item?.system;
    if ( (item?.type !== "mutation") || !s?.awaitsChoice || !this.actor.isOwner ) return null;
    const needAttr = !!s.choice.attribute && !s.chosen.attribute;
    const needSkill = !!s.choice.skill && !s.chosen.skill;
    const options = list => list.map(([k, label]) => `<option value="${k}">${escapeText(label)}</option>`).join("");
    const attrs = Object.entries(IROP.attributes).filter(([k]) => !(s.choice.noLuck && (k === "lck"))).map(([k, a]) => [k, a.label]);
    const skills = Object.entries(IROP.skills).filter(([k]) => ((this.actor.system.skills[k]?.rank ?? 0) + s.choice.skill) <= IROP.skillRanks.max)
      .map(([k, sk]) => [k, `${sk.label} (rank ${this.actor.system.skills[k]?.rank ?? 0})`]);
    const amount = (s.choice.attribute > 0) ? `+${s.choice.attribute}` : `${s.choice.attribute}`;
    const data = await DialogV2.input({
      window: { title: item.name },
      classes: ["irop", "irop-roll-dialog"],
      content: `<div class="irop-dialog">
        ${needAttr ? `<label class="irop-choose"><span>${amount} to</span><select name="attribute">${options(attrs)}</select></label>` : ""}
        ${needSkill ? `<label class="irop-choose"><span>+${s.choice.skill} rank in</span><select name="skill">${options(skills)}</select></label>` : ""}
      </div>`,
      ok: { label: "Choose", icon: "fa-solid fa-check" }
    });
    if ( !data ) return null;
    const chosen = {};
    if ( needAttr && IROP.attributes[data.attribute] && !(s.choice.noLuck && (data.attribute === "lck")) ) chosen["system.chosen.attribute"] = data.attribute;
    if ( needSkill && IROP.skills[data.skill] ) chosen["system.chosen.skill"] = data.skill;
    if ( !Object.keys(chosen).length ) return null;
    await item.update(chosen);
    if ( chosen["system.chosen.skill"] ) {
      const key = chosen["system.chosen.skill"];
      const rank = Math.min(IROP.skillRanks.max, (this.actor.system._source.skills[key]?.rank ?? 0) + s.choice.skill);
      await this.actor.update({ [`system.skills.${key}.rank`]: rank });
    }
    return this.render();
  }

  /** GM: award XP, with a reason for the ledger. */
  static async #onAwardXp() {
    if ( !game.user.isGM ) return null;
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: `Award XP: ${this.actor.name}` },
      content: `<label class="irop-choose"><span>XP</span><input type="number" name="xp" value="10" min="1" step="1"></label>
        <label class="irop-choose"><span>For</span><input type="text" name="label" placeholder="OP-009 debrief"></label>`,
      ok: { label: "Award", icon: "fa-solid fa-plus" }
    });
    const amount = Math.round(Number(result?.xp) || 0);
    if ( amount <= 0 ) return null;
    const log = [...this.actor.system._source.xp.log, xpEntry("award", result.label?.trim() || "Award", amount, "", 0)];
    return this.actor.update({ "system.xp.earned": this.actor.system.xp.earned + amount, "system.xp.log": log });
  }

  /**
   * GM: undo a ledger entry. A purchase is refunded and, if that rank is still the
   * top one, the rank comes off again; an award is taken back off Earned.
   */
  static async #onRefundXp(event, target) {
    if ( !game.user.isGM ) return null;
    const index = Number(target.closest("[data-log-index]")?.dataset.logIndex);
    const source = this.actor.system._source.xp.log;
    const entry = source[index];
    if ( !entry ) return null;
    const update = { "system.xp.log": source.filter((_, i) => i !== index) };
    if ( entry.kind === "award" ) update["system.xp.earned"] = Math.max(0, this.actor.system.xp.earned - entry.xp);
    // A perk refunded comes off the sheet (2026-10-08).
    if ( entry.kind === "perk" ) {
      const perk = this.actor.items.find(i => i.flags?.irop?.perk?.node === entry.ref);
      if ( perk ) await perk.delete();
    }
    if ( (entry.kind === "skill") && (this.actor.system.skills[entry.ref]?.rank === entry.rank) ) {
      update[`system.skills.${entry.ref}.rank`] = entry.rank - 1;
    }
    if ( (entry.kind === "attribute") && (this.actor.system.attributes[entry.ref]?.advances === entry.rank) ) {
      update[`system.attributes.${entry.ref}.advances`] = entry.rank - 1;
    }
    // Paraphysics lines (2026-10-19): XP or crystals back, the rank or the power off.
    const psi = refundPsi(this.actor, entry, update);
    for ( const { item, change } of psi.items ) await item.update(change);
    if ( psi.remove.length ) await this.actor.deleteEmbeddedDocuments("Item", psi.remove);
    return this.actor.update(update);
  }

  /** Generic pip track: data-path names the field, data-value the pip. */
  static #onSetPip(event, target) {
    const path = target.dataset.path;
    const n = Number(target.dataset.value);
    const current = foundry.utils.getProperty(this.actor, path);
    return this.actor.update({ [path]: n === current ? n - 1 : n });
  }

  /** Step a value up or down, clamped to 0 and its max when it has one. */
  static #onAdjust(event, target) {
    const path = target.dataset.path;
    const delta = Number(target.dataset.delta) * (event.shiftKey ? 5 : 1);
    const value = foundry.utils.getProperty(this.actor, path) ?? 0;
    const maxPath = path.replace(/\.value$/, ".max");
    const max = maxPath !== path ? foundry.utils.getProperty(this.actor, maxPath) : undefined;
    let next = value + delta;
    if ( max !== undefined ) next = Math.min(next, max);
    next = Math.max(0, next);
    return this.actor.update({ [path]: next });
  }

  /**
   * A status on or off. One with an (X) asks for X in a popup as it goes on (Johnald, 2026-10-10);
   * a click on one that is on takes it off, as for any status.
   */
  static async #onToggleStatus(event, target) {
    const id = target.dataset.status;
    if ( IROP.statusEffects.find(s => s.id === id)?.counter && !this.actor.statuses.has(id) ) {
      const value = await askStatusValue(id, { actorName: this.actor.name });
      if ( value === null ) return;
      return setStatus(this.actor, id, value);
    }
    return this.actor.toggleStatusEffect(id);
  }

  static async #onCreateEffect() {
    const [effect] = await this.actor.createEmbeddedDocuments("ActiveEffect", [{
      name: "New Effect", img: "icons/svg/aura.svg", origin: this.actor.uuid
    }]);
    return effect?.sheet.render({ force: true });
  }

  static #effectFrom(target) {
    const row = target.closest("[data-effect-id]");
    const parent = row.dataset.parentId ? this.actor.items.get(row.dataset.parentId) : this.actor;
    return parent?.effects.get(row.dataset.effectId);
  }

  /** Whether an effect row is an item's, which only a GM changes (2026-10-10). */
  static #itemEffectLocked(target) {
    return !!target.closest("[data-effect-id]")?.dataset.parentId && !game.user?.isGM;
  }

  static #onEditEffect(event, target) {
    if ( IropActorSheet.#itemEffectLocked(target) ) return null;
    return IropActorSheet.#effectFrom.call(this, target)?.sheet.render({ force: true });
  }

  static #onDeleteEffect(event, target) {
    return IropActorSheet.#effectFrom.call(this, target)?.deleteDialog();
  }

  static #onToggleEffect(event, target) {
    if ( IropActorSheet.#itemEffectLocked(target) ) return null;
    const effect = IropActorSheet.#effectFrom.call(this, target);
    return effect?.update({ disabled: !effect.disabled });
  }
}

/* -------------------------------------------- */

const PART = (name, scrollable = [""]) => ({ template: `${T}/${name}.hbs`, scrollable });

/** The operative sheet: the full character, six tabs. */
export class OperativeSheet extends IropActorSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["operative"],
    // Operatives open at 1100 x 850 too (Johnald, 2026-10-17); the record gutter fits inside.
    position: { width: 1100 },
    actions: {
      toggleRecord: OperativeSheet.#onToggleRecord,
      toggleNotes: OperativeSheet.#onToggleNotes,
      framePortrait: OperativeSheet.#onFramePortrait,
      resetPortrait: OperativeSheet.#onResetPortrait,
      recordPhoto: OperativeSheet.#onRecordPhoto,
      addRecordEntry: OperativeSheet.#onAddRecordEntry,
      awardMedal: OperativeSheet.#onAwardMedal,
      editMedal: OperativeSheet.#onEditMedal,
      removeMedal: OperativeSheet.#onRemoveMedal,
      deleteRecordEntry: OperativeSheet.#onDeleteRecordEntry,
      resetCharacter: OperativeSheet.#onResetCharacter,
      artemisLink: OperativeSheet.#onArtemisLink,
      artemisSync: OperativeSheet.#onArtemisSync,
      artemisUnlink: OperativeSheet.#onArtemisUnlink
    }
  };

  /** The window's ⋮ menu gains Reset character, for the owner or a GM (Johnald, 2026-10-08). @inheritDoc */
  _getHeaderControls() {
    const controls = super._getHeaderControls?.() ?? [];
    if ( canReset(this.actor) ) controls.push({ icon: "fa-solid fa-rotate-left", label: "Reset character", action: "resetCharacter" });
    // ARTEMIS on Discord (Johnald, 2026-10-10): the owner links the character with a code from /link.
    if ( this.actor.isOwner ) {
      if ( isLinked(this.actor) ) {
        controls.push({ icon: "fa-brands fa-discord", label: "ODR ARTEMIS: send the sheet now", action: "artemisSync" });
        controls.push({ icon: "fa-solid fa-link-slash", label: "Unlink from ODR ARTEMIS", action: "artemisUnlink" });
      }
      else controls.push({ icon: "fa-brands fa-discord", label: "Link to ODR ARTEMIS", action: "artemisLink" });
    }
    return controls;
  }

  /** Link the character to ARTEMIS with the code /link gave in Discord. */
  static async #onArtemisLink() {
    const code = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Link to ODR ARTEMIS", icon: "fa-brands fa-discord" },
      content: `<p>In Discord, use <strong>/link</strong> with ODR ARTEMIS. It gives you a six letter code that works once, for fifteen minutes. Enter it here.</p>
        <div class="form-group"><label>Code</label><input type="text" name="code" maxlength="12" autocomplete="off" autofocus></div>
        <p class="hint">From then on this sheet keeps itself up to date in ODR ARTEMIS whenever it changes, while you have Foundry open.</p>`,
      ok: { label: "Link", icon: "fa-solid fa-link", callback: (event, button) => button.form.elements.code.value },
      rejectClose: false
    });
    if ( !code ) return null;
    await linkActor(this.actor, code);
    return this.render();
  }

  static #onArtemisSync() {
    return syncActor(this.actor, { force: true, notify: true });
  }

  static async #onArtemisUnlink() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Unlink from ODR ARTEMIS" },
      content: `<p>Stop sending ${this.actor.name}'s sheet to ODR ARTEMIS, and remove it there?</p>`
    });
    if ( !ok ) return null;
    await unlinkActor(this.actor);
    return this.render();
  }

  /** A full reset of the character, after a confirm (reset.mjs). */
  static #onResetCharacter() {
    return confirmReset(this.actor);
  }

  /** @override */
  static PARTS = {
    header: { template: `${T}/header.hbs` },
    tabs: { template: `${T}/tabs.hbs` },
    main: PART("main"),
    abilities: PART("abilities"),
    paraphysics: PART("paraphysics"),
    combat: PART("combat"),
    gear: PART("gear"),
    bio: PART("bio"),
    effects: PART("effects"),
    // The drawer holds the Personnel Record and, for owners, their Notes (Johnald, 2026-10-11).
    record: { template: `${T}/record.hbs`, scrollable: [".record-body"] }
  };

  /** Width of the Personnel Record drawer, in pixels. Kept in step with the stylesheet. */
  static RECORD_WIDTH = 460;

  /** How long the drawer takes to slide, in milliseconds. Kept in step with the stylesheet. */
  static RECORD_SLIDE_MS = 260;

  /** How long a window gets to take a new size before it counts as refused, in milliseconds. */
  static WINDOW_RESIZE_WAIT = 600;

  /** A frame or two past a slide, so it has ended on screen before anything else changes. */
  static SLIDE_SETTLE_MS = 40;

  /** Actors whose record drawer is open, so it stays open across re-renders. */
  static #openRecords = new Set();

  /** Actors whose drawer is turned to their Notes rather than the Personnel Record. */
  static #notesPages = new Set();

  get recordOpen() {
    return this.recordOnly || OperativeSheet.#openRecords.has(this.actor.uuid);
  }

  /**
   * The drawer's page: "record", the Personnel Record, or "notes", the owner's Notes, which left
   * the tab bar for a side tab of their own under Record (Johnald, 2026-10-11). Someone who sees
   * the record alone never sees the Notes.
   */
  get drawerPage() {
    return (!this.recordOnly && OperativeSheet.#notesPages.has(this.actor.uuid)) ? "notes" : "record";
  }

  /**
   * RULED 2026-10-06: someone who can see an operative but does not own it (an
   * Observer, or a Limited user) sees only the Personnel Record, read only. Owners
   * and GMs get the full sheet. Checked live, so a change of ownership shows on
   * the next render.
   */
  get recordOnly() {
    return !this.actor.isOwner;
  }

  /**
   * Detached into a window of its own. That window ends at the sheet's edges, where
   * the record, off the sheet's left edge, was cut off (bug fix, Johnald, 2026-10-10). There the
   * record makes its room in the window instead (#roomInWindow).
   */
  get inDetachedWindow() {
    return !!this.element?.ownerDocument?.body?.classList.contains("detached");
  }

  /** Whether the sheet is the window's own app, so the window may be sized to it. */
  get ownsItsWindow() {
    return this.inDetachedWindow && !!this.id && (this.window?.windowId === this.id);
  }

  /** How the record's room was made in a detached window, to give it back: null when none was. */
  #roomMade = null;

  /** The wait for the drawer to slide shut before its room is given back. */
  #giveBackTimer = null;

  /** The wait for the sheet's glide to end, to take its transition off again. */
  #glideTimer = null;

  /**
   * Foundry sizes a detached window from the sheet's outline, and that would count the drawer
   * (even closed, it sits off the sheet's left edge): the window would open too wide, with the
   * sheet off to one side. The drawer is left out while the sheet moves. @inheritDoc
   */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if ( options.window?.detach ) this.element?.classList.add("irop-detaching");
  }

  /**
   * In its own window: the drawer back, the sheet at the window's top left with the window fitted
   * to it, then room for the record if it is open. @inheritDoc
   */
  _onDetach(from, to) {
    super._onDetach?.(from, to);
    this.element?.classList.remove("irop-detaching", "record-inside");
    clearTimeout(this.#giveBackTimer);
    this.#stopGlide();
    this.#roomMade = null;
    if ( this.ownsItsWindow ) this.#paintWindow(to);
    const fit = this.ownsItsWindow ? this.#moveInWindow({ left: 0, top: 0 }) : Promise.resolve(true);
    fit.then(() => (this.recordOpen && !this.recordOnly) ? this.#roomInWindow() : null)
      .catch(err => console.error("irop | Personnel Record room in a detached window", err));
  }

  /**
   * The window behind a detached sheet in the sheet's own black, not Foundry's gray. It shows as a
   * strip while the window widens for the record, and as the sheet slides home before the window
   * narrows (Johnald, 2026-10-10: "when closing the window you get the gray strip"). Set on the
   * page itself, since a stylesheet rule for it did not take.
   */
  #paintWindow(doc) {
    const view = doc?.defaultView ?? this.element?.ownerDocument?.defaultView;
    const bg = view?.getComputedStyle?.(doc.documentElement).getPropertyValue("--irop-bg").trim() || "#0a0c0f";
    for ( const el of [doc?.documentElement, doc?.body] ) el?.style?.setProperty("background", bg);
  }

  /** Back in the main window, an open record gets its room again, the main window's way. @inheritDoc */
  _onAttach(from, to) {
    super._onAttach?.(from, to);
    clearTimeout(this.#giveBackTimer);
    this.#stopGlide();
    this.#roomMade = null;
    this.element?.classList.remove("record-inside");
    if ( this.recordOpen && !this.recordOnly ) this.#makeRoomForRecord();
  }

  /**
   * In a window of its own, the record opens out beside the sheet as on the main screen (Johnald,
   * 2026-10-10: "expand out instead of in"). The room comes, in order of preference:
   *  1. from the sheet, in a window already wide enough (maximized, say) to keep the sheet at its
   *     full default width beside the record;
   *  2. from the window, widened on its right, when the screen has the room;
   *  3. failing both (no room on screen, a window that refuses to change size, or a sheet sharing
   *     another app's window), from inside the sheet: the record opens over its left side.
   * In the first two the sheet then glides right into its new place as the drawer slides out.
   *
   * The twitch (Johnald, 2026-10-10: "a little twitchy"): the window used to grow on its LEFT so
   * the sheet stayed put on screen. A browser moves and sizes a window in two separate steps, and
   * the sheet's shift inside it landed a few frames apart from the window's move, so the sheet
   * jumped aside and back. Now the window only grows on its right, with nothing inside moving
   * while it does, and the sheet's own move is a glide in step with the drawer.
   */
  async #roomInWindow() {
    clearTimeout(this.#giveBackTimer);
    const made = this.#roomMade;
    if ( made ) {
      // Opened again before the room was given back: the sheet glides back over.
      this.#glideOpen(made);
      return made.mode;
    }
    const win = this.element?.ownerDocument?.defaultView;
    const need = OperativeSheet.RECORD_WIDTH + 4;
    const { left = 0, top = 0 } = this.position ?? {};
    if ( !win || (left >= need) ) return null;
    const from = { left, top };
    if ( this.ownsItsWindow ) {
      if ( (win.innerWidth - need) >= OperativeSheet.DEFAULT_OPTIONS.position.width ) {
        this.#roomMade = { mode: "sheet", from };
        this.#glideOpen(this.#roomMade);
        return "sheet";
      }
      const grow = need - left;
      const spare = (win.screen?.availWidth ?? 0) - (win.outerWidth ?? Infinity);
      if ( (spare >= grow) && await this.#widenWindow(grow) ) {
        this.#roomMade = { mode: "window", from, grow };
        // Shut again while the window was taking its size: the toggle gives the room back.
        if ( this.recordOpen ) this.#glideOpen(this.#roomMade);
        return "window";
      }
    }
    this.element.classList.add("record-inside");
    this.#roomMade = { mode: "inside", from };
    return "inside";
  }

  /** The sheet's place beside the open record, for the room made: it glides there. */
  #glideOpen(made) {
    const need = OperativeSheet.RECORD_WIDTH + 4;
    const win = this.element.ownerDocument.defaultView;
    if ( made.mode === "sheet" ) this.#glide({ left: need, width: win.innerWidth - need });
    else if ( made.mode === "window" ) this.#glide({ left: need });
  }

  /**
   * Shut again: the sheet glides home as the drawer slides shut, and once both are done the window
   * gives back the width it took, from its right, so nothing inside it moves.
   */
  #giveBackRoom() {
    clearTimeout(this.#giveBackTimer);
    const made = this.#roomMade;
    if ( !made || this.recordOpen || !this.rendered || !this.inDetachedWindow ) return;
    const win = this.element.ownerDocument.defaultView;
    if ( made.mode === "sheet" ) this.#glide({ left: made.from.left, width: win.innerWidth - made.from.left });
    else if ( made.mode === "window" ) this.#glide({ left: made.from.left });
    // Given back as the slide ends, not after: the window takes a frame or two to follow anyway,
    // and until it does the room shows as a strip.
    this.#giveBackTimer = setTimeout(() => {
      if ( (this.#roomMade !== made) || this.recordOpen || !this.rendered || !this.inDetachedWindow ) return;
      this.#roomMade = null;
      if ( made.mode === "inside" ) this.element.classList.remove("record-inside");
      else if ( made.mode === "window" ) win.resizeBy(-made.grow, 0);
    }, OperativeSheet.RECORD_SLIDE_MS);
  }

  /**
   * Move the sheet in its window as a glide, over the drawer's slide time and with its easing.
   * A move alone (a widened window) is drawn as a translate (styles: .irop-gliding): the sheet
   * takes its new place at once, is pulled back to where it shows, and eases from there. The
   * browser slides a translate as one finished picture, so it stays smooth however busy the
   * sheet is, where easing `left` redrew the whole sheet every frame (Johnald, 2026-10-10:
   * "working a little better"). A glide begun while another runs turns from wherever the sheet
   * shows. A change of width too (a wide window) eases left and width together, the right edge
   * still (.irop-resizing).
   */
  #glide(position) {
    const el = this.element;
    if ( !el ) return;
    clearTimeout(this.#glideTimer);
    if ( "width" in position ) {
      el.classList.add("irop-gliding", "irop-resizing");
      // Measured before the change, so the transition runs from the sheet's present place.
      void el.offsetWidth;
      this.setPosition(position);
    }
    else {
      const pulled = parseFloat(el.ownerDocument.defaultView.getComputedStyle?.(el).translate) || 0;
      const shown = this.position.left + pulled;
      el.classList.remove("irop-gliding", "irop-resizing");
      this.setPosition(position);
      const pull = shown - this.position.left;
      el.style.translate = `${pull}px 0`;
      void el.offsetWidth;
      el.classList.add("irop-gliding");
      el.style.translate = "0px 0";
    }
    this.#glideTimer = setTimeout(() => {
      el.classList.remove("irop-gliding", "irop-resizing");
      el.style.translate = "";
    }, OperativeSheet.RECORD_SLIDE_MS + OperativeSheet.SLIDE_SETTLE_MS);
  }

  /** A glide cut short, by a move between windows: the sheet shows where it stands. */
  #stopGlide() {
    clearTimeout(this.#glideTimer);
    this.element?.classList.remove("irop-gliding", "irop-resizing");
    if ( this.element?.style ) this.element.style.translate = "";
  }

  /**
   * Widen the sheet's own window by dx on its right. Where the screen lacks that room on the
   * right, the window first moves left, whole, by what is missing. The sheet keeps its place and
   * size in the window throughout (Foundry's own resize handler would stretch it to fill), so the
   * window changes as one piece and nothing inside it shifts.
   * @returns {Promise<boolean>}  Whether the window took the new width; if not, it is put back.
   */
  async #widenWindow(dx) {
    const win = this.element.ownerDocument.defaultView;
    const { left, top, width, height } = this.position;
    const before = win.innerWidth;
    const w = before + dx;
    const screenRight = (win.screen?.availLeft ?? 0) + (win.screen?.availWidth ?? Infinity);
    const hop = Math.max(0, Math.ceil(((win.screenX ?? 0) + win.outerWidth + dx) - screenRight));
    const fits = () => Math.abs(win.innerWidth - w) <= 1;
    const sized = new Promise(resolve => {
      const done = () => {
        win.removeEventListener("resize", hold);
        clearTimeout(timer);
        resolve(fits());
      };
      // Runs after Foundry's own handler (harness.mjs ResizeManager), in the same event, so the
      // stretch it makes is undone before anything is drawn.
      const hold = () => {
        this.setPosition({ left, top, width, height });
        if ( fits() ) done();
      };
      const timer = setTimeout(done, OperativeSheet.WINDOW_RESIZE_WAIT);
      win.addEventListener("resize", hold);
    });
    if ( hop ) win.moveBy(-hop, 0);
    win.resizeBy(dx, 0);
    if ( await sized ) return true;
    // Refused, or only part taken: what was taken goes back.
    const took = win.innerWidth - before;
    if ( took ) win.resizeBy(-took, 0);
    if ( hop ) win.moveBy(hop, 0);
    this.setPosition({ left, top, width, height });
    return false;
  }

  /**
   * Put the sheet at a new left and top in its own window, the window growing or shrinking on
   * its left and top by the difference, and moving the other way, so the sheet stays where it is
   * on screen. Foundry's own handler keeps the sheet filling the window as it changes size; the
   * sheet's own size is put back once the window has taken its new one. Used only as the sheet
   * arrives in its window (_onDetach), and only when Foundry left it away from the top left.
   * @returns {Promise<boolean>}  Whether the window took the new size.
   */
  async #moveInWindow({ left, top }) {
    const win = this.element?.ownerDocument?.defaultView;
    const { left: x = 0, top: y = 0, width, height } = this.position ?? {};
    const dx = left - x;
    const dy = top - y;
    if ( !win || (!dx && !dy) ) return true;
    const w = win.innerWidth + dx;
    const h = win.innerHeight + dy;
    const fits = () => (Math.abs(win.innerWidth - w) <= 1) && (Math.abs(win.innerHeight - h) <= 1);
    const sized = new Promise(resolve => {
      const done = () => {
        win.removeEventListener("resize", check);
        clearTimeout(timer);
        resolve(fits());
      };
      const check = () => { if ( fits() ) done(); };
      const timer = setTimeout(done, OperativeSheet.WINDOW_RESIZE_WAIT);
      win.addEventListener("resize", check);
    });
    win.resizeBy(dx, dy);
    win.moveBy(-dx, -dy);
    if ( !(await sized) ) return false;
    this.setPosition({ left, top, width, height });
    return true;
  }

  /** A viewer who only sees the record gets a window sized to it. @inheritDoc */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    if ( options.document && !options.document.isOwner ) options.position.width = OperativeSheet.RECORD_WIDTH + 20;
    // Never taller than the screen (2026-10-17).
    const room = globalThis.window?.innerHeight;
    if ( room && (options.position?.height > room - 40) ) options.position = { ...options.position, height: Math.max(500, room - 40) };
    return options;
  }

  /** The record alone for viewers who do not own the operative. @inheritDoc */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    return this.recordOnly ? { record: parts.record } : parts;
  }

  /**
   * RULED 2026-10-06: the record opens on the left, from a bar inside the
   * sheet's left edge. If the sheet sits too close to the left of the screen,
   * shift it right just enough for the record to fit, as far as the screen allows.
   */
  #makeRoomForRecord() {
    // A window of its own makes the room its own way (#roomInWindow).
    if ( this.inDetachedWindow ) return;
    const need = OperativeSheet.RECORD_WIDTH + 4;
    const { left, width } = this.position;
    if ( !Number.isFinite(left) || (left >= need) ) return;
    const maxLeft = Math.max(0, window.innerWidth - (Number(width) || 0));
    this.setPosition({ left: Math.min(need, maxLeft) });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const r = this.actor.system.details.record;
    // Until first and last names are typed in, suggest them from the actor's name.
    const [first, ...rest] = String(this.actor.name ?? "").trim().split(/\s+/);
    const suggested = { firstName: first ?? "", lastName: rest.join(" ") };
    const field = f => ({ ...f, value: r[f.key] ?? "", placeholder: f.placeholder ?? suggested[f.key] ?? "" });
    context.record = {
      title: IROP.record.title,
      number: recordNumber(this.actor.id),
      log: IROP.record.log,
      open: this.recordOpen,
      only: this.recordOnly,
      page: this.drawerPage,
      // Each side tab is lit, and points in, while the drawer is open on its own page.
      recordActive: this.recordOpen && (this.drawerPage === "record"),
      notesActive: this.recordOpen && (this.drawerPage === "notes"),
      barIcon: recordBarIcon(this.recordOpen && (this.drawerPage === "record")),
      notesBarIcon: recordBarIcon(this.recordOpen && (this.drawerPage === "notes")),
      identity: IROP.record.identity.map(field),
      service: IROP.record.service.map(field),
      marks: r.marks,
      // The ODR rank, with its insignia (2026-10-17): by XP earned, or set by the GM.
      rank: rankContext(this.actor.system, !!game.user?.isGM && this.isEditable && !this.recordOnly),
      // Medals (2026-10-17): the GM awards them; everyone who sees the record reads them.
      medals: (r.medals ?? []).map(m => ({ ...m, ribbon: medalRibbon(m.name) })),
      canAward: !!game.user?.isGM && !this.recordOnly,
      nextOfKin: r.nextOfKin,
      timeline: r.timeline.map((e, index) => ({ ...e, index })),
      roleColor: context.accent,
      // The photo's framing (2026-10-16): the owner drags and zooms it while adjusting.
      frame: { x: r.portrait.x, y: r.portrait.y, zoom: r.portrait.zoom, scale: r.portrait.zoom / 100 },
      // Its own photo, else the sheet's portrait.
      photo: r.photo || this.actor.img,
      canFrame: this.isEditable && !this.recordOnly,
      adjusting: this.#framing
    };
    return context;
  }

  /** Whether the record's photo is being moved and zoomed. */
  #framing = false;

  /** Adjust the photo, or finish adjusting. */
  static #onFramePortrait() {
    this.#framing = !this.#framing;
    return this.render();
  }

  /** Pick the record's own photo; the sheet's portrait is left alone. */
  static #onRecordPhoto() {
    const Picker = foundry.applications.apps.FilePicker.implementation;
    const r = this.actor.system.details.record;
    return new Picker({ type: "image", current: r.photo || this.actor.img,
      callback: path => this.actor.update({ "system.details.record.photo": path, "system.details.record.portrait": { set: false, x: 50, y: 18, zoom: 100 } })
    }).render({ force: true });
  }

  /** The photo back to the middle, unzoomed. */
  static async #onResetPortrait() {
    await this.actor.update({ "system.details.record.portrait": { set: false, x: 50, y: 18, zoom: 100 } });
    return this.render();
  }

  /**
   * Drag the photo to move it and zoom with the slider or the wheel; it saves when the drag or the
   * zoom ends. Dragging right shows more of the left, so the point it centers on moves the other way,
   * slower the more it is zoomed in.
   */
  #wireFraming() {
    const frame = this.element.querySelector("[data-portrait-frame].adjusting");
    if ( !frame ) return;
    const now = { ...this.actor.system.details.record.portrait };
    const show = () => {
      frame.style.setProperty("--px", `${now.x}%`);
      frame.style.setProperty("--py", `${now.y}%`);
      frame.style.setProperty("--pz", String(now.zoom / 100));
    };
    const save = () => this.actor.update({ "system.details.record.portrait": { set: true, x: Math.round(now.x * 10) / 10, y: Math.round(now.y * 10) / 10, zoom: Math.round(now.zoom) } });
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    let drag = null;
    frame.addEventListener("pointerdown", event => {
      if ( event.target.closest("button, input") ) return;
      drag = { x: event.clientX, y: event.clientY, px: now.x, py: now.y };
      frame.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    frame.addEventListener("pointermove", event => {
      if ( !drag ) return;
      const rect = frame.getBoundingClientRect();
      const speed = 100 / (now.zoom / 100);
      now.x = clamp(drag.px - ((event.clientX - drag.x) / Math.max(1, rect.width)) * speed, 0, 100);
      now.y = clamp(drag.py - ((event.clientY - drag.y) / Math.max(1, rect.height)) * speed, 0, 100);
      show();
    });
    const end = () => { if ( drag ) { drag = null; save(); } };
    frame.addEventListener("pointerup", end);
    frame.addEventListener("pointercancel", end);
    const slider = frame.querySelector("[data-portrait-zoom]");
    slider?.addEventListener("input", () => { now.zoom = Number(slider.value); show(); });
    slider?.addEventListener("change", save);
    let wheelTimer = null;
    frame.addEventListener("wheel", event => {
      event.preventDefault();
      now.zoom = clamp(now.zoom + ((event.deltaY < 0) ? 10 : -10), 100, 300);
      if ( slider ) slider.value = String(now.zoom);
      show();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(save, 300);
    }, { passive: false });
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("record-only", this.recordOnly);
    // Only while it is being detached (see _configureRenderOptions); any other render clears it.
    this.element.classList.toggle("irop-detaching", !!options?.window?.detach);
    const drawer = this.element.querySelector(".irop-record");
    if ( !drawer ) return;
    this.#placeRecord();
    this.#wireFraming();

    // Service log rows edit one array entry each, outside the form submission.
    for ( const input of drawer.querySelectorAll("[data-record-field]") ) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const index = Number(input.closest("[data-record-index]")?.dataset.recordIndex);
        const timeline = foundry.utils.deepClone(this.actor.system._source.details.record.timeline);
        if ( !timeline[index] ) return;
        timeline[index][input.dataset.recordField] = input.value;
        this.actor.update({ "system.details.record.timeline": timeline });
      });
    }
  }

  /**
   * Set the dock's open state and its page, and point each side tab's arrows the way the drawer
   * will move: in, on the tab whose page is open; out, on the other.
   */
  #placeRecord() {
    const dock = this.element?.querySelector(".irop-record-dock");
    if ( !dock ) return;
    const open = this.recordOpen;
    const page = this.drawerPage;
    dock.classList.toggle("open", open);
    dock.classList.toggle("page-record", page === "record");
    dock.classList.toggle("page-notes", page === "notes");
    dock.querySelector(".irop-record")?.setAttribute("aria-hidden", String(!open));
    const bars = [
      [dock.querySelector(".record-bar.record-tab"), "record", "the Personnel Record"],
      [dock.querySelector(".record-bar.notes-tab"), "notes", "your Notes"]
    ];
    for ( const [bar, mine, what] of bars ) {
      if ( !bar ) continue;
      const shown = open && (page === mine);
      bar.classList.toggle("active", shown);
      bar.setAttribute("aria-expanded", String(shown));
      bar.dataset.tooltip = shown ? `Close ${what}` : `Open ${what}`;
      const icon = recordBarIcon(shown);
      for ( const i of bar.querySelectorAll("i") ) i.className = `fa-solid ${icon}`;
    }
  }

  /* -------------------------------------------- */

  static #onToggleRecord() {
    return this.#toggleDrawer("record");
  }

  static #onToggleNotes() {
    return this.#toggleDrawer("notes");
  }

  /**
   * A side tab was pressed. Shut, the drawer slides out on that tab's page; open on the other
   * page, it turns to this one where it is; open on this page, it slides shut.
   * @param {"record"|"notes"} page
   */
  async #toggleDrawer(page) {
    // A detach that failed (a blocked popup) never gets to put the drawer back.
    this.element?.classList.remove("irop-detaching");
    const set = OperativeSheet.#openRecords;
    const turnTo = () => {
      if ( page === "notes" ) OperativeSheet.#notesPages.add(this.actor.uuid);
      else OperativeSheet.#notesPages.delete(this.actor.uuid);
    };
    if ( set.has(this.actor.uuid) && (this.drawerPage !== page) ) {
      turnTo();
      this.#placeRecord();
      return;
    }
    if ( set.has(this.actor.uuid) ) {
      set.delete(this.actor.uuid);
      this.#placeRecord();
      if ( this.inDetachedWindow ) this.#giveBackRoom();
      return;
    }
    turnTo();
    set.add(this.actor.uuid);
    if ( this.rendered && this.inDetachedWindow ) {
      await this.#roomInWindow();
      // Shut again while the window was still taking its size.
      if ( !this.recordOpen ) return this.#giveBackRoom();
    }
    else if ( this.rendered ) this.#makeRoomForRecord();
    this.#placeRecord();
  }

  static async #onAddRecordEntry() {
    const timeline = foundry.utils.deepClone(this.actor.system._source.details.record.timeline);
    timeline.push({ date: "", entry: "" });
    return this.actor.update({ "system.details.record.timeline": timeline });
  }

  /** GM: award a medal, with why and on what mission (Johnald, 2026-10-17), and say so in chat. */
  static async #onAwardMedal() {
    if ( !game.user.isGM ) return null;
    const data = await medalDialog(`Award a medal: ${this.actor.name}`, { date: await campaignDate() }, "Award");
    if ( !data ) return null;
    const medal = { id: foundry.utils.randomID(), ...data, by: game.user.name };
    await this.actor.update({ "system.details.record.medals": [...this.actor.system._source.details.record.medals, medal] });
    return ChatMessage.implementation.create({
      speaker: { alias: "ODR Command" },
      content: medalCardHTML(this.actor.name, medal)
    });
  }

  /** GM: change a medal's details. */
  static async #onEditMedal(event, target) {
    if ( !game.user.isGM ) return null;
    const id = target.closest("[data-medal-id]")?.dataset.medalId;
    const medals = foundry.utils.deepClone(this.actor.system._source.details.record.medals);
    const medal = medals.find(m => m.id === id);
    if ( !medal ) return null;
    const data = await medalDialog(`${medal.name}: ${this.actor.name}`, medal, "Save");
    if ( !data ) return null;
    Object.assign(medal, data);
    return this.actor.update({ "system.details.record.medals": medals });
  }

  /** GM: take a medal off the record, after a word to be sure. */
  static async #onRemoveMedal(event, target) {
    if ( !game.user.isGM ) return null;
    const id = target.closest("[data-medal-id]")?.dataset.medalId;
    const medals = this.actor.system._source.details.record.medals;
    const medal = medals.find(m => m.id === id);
    if ( !medal ) return null;
    const ok = await DialogV2.confirm({ window: { title: "Remove medal" }, content: `<p>Take the ${escapeText(medal.name)} off ${escapeText(this.actor.name)}'s record?</p>` });
    if ( !ok ) return null;
    return this.actor.update({ "system.details.record.medals": medals.filter(m => m.id !== id) });
  }

  static async #onDeleteRecordEntry(event, target) {
    const index = Number(target.closest("[data-record-index]")?.dataset.recordIndex);
    const timeline = foundry.utils.deepClone(this.actor.system._source.details.record.timeline);
    timeline.splice(index, 1);
    return this.actor.update({ "system.details.record.timeline": timeline });
  }

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "main", label: "Attributes", icon: "fa-solid fa-user" },
        // Abilities before Combat (Johnald, 2026-10-11).
        { id: "abilities", label: "Abilities", icon: "fa-solid fa-bolt" },
        // Its own tab, only for the paraphysical (Johnald, 2026-10-16).
        { id: "paraphysics", label: "Paraphysics", icon: "fa-solid fa-atom" },
        { id: "combat", label: "Combat", icon: "fa-solid fa-crosshairs" },
        { id: "gear", label: "Gear", icon: "fa-solid fa-box-open" },
        // Renamed from Dossier (Johnald, 2026-10-08): identity, XP, perk trees and the ledger.
        { id: "bio", label: "Training", icon: "fa-solid fa-dumbbell" },
        // The player's Notes left the tab bar for a side tab under Record (Johnald, 2026-10-11).
        { id: "effects", label: "Effects", icon: "fa-solid fa-wand-sparkles" }
      ],
      initial: "main"
    }
  };
}

/* -------------------------------------------- */

/** The NPC sheet: the same rules, a leaner page. */
export class NpcSheet extends IropActorSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["npc"],
    // The same 1100 x 850 as an operative's (Johnald, 2026-10-17).
    position: { width: 1100, height: 850 },
    actions: { openCodex: NpcSheet.#onOpenCodex }
  };

  /** The GM's Threat codex button in the title bar (2026-10-17): this enemy's file, made if new. @inheritDoc */
  _getHeaderControls() {
    const controls = super._getHeaderControls();
    if ( game.user?.isGM ) controls.push({ icon: "fa-solid fa-skull", label: "Threat codex", action: "openCodex" });
    return controls;
  }

  static async #onOpenCodex() {
    const { openCodexFor } = await import("../codex.mjs");
    return openCodexFor(this.actor);
  }

  /** @override */
  static PARTS = {
    header: { template: `${T}/header.hbs` },
    tabs: { template: `${T}/tabs.hbs` },
    main: PART("main"),
    combat: PART("combat"),
    abilities: PART("abilities"),
    bio: PART("npc-notes"),
    effects: PART("effects")
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "main", label: "Stats", icon: "fa-solid fa-user" },
        { id: "combat", label: "Combat", icon: "fa-solid fa-crosshairs" },
        { id: "abilities", label: "Abilities", icon: "fa-solid fa-bolt" },
        { id: "bio", label: "Notes", icon: "fa-solid fa-note-sticky" },
        { id: "effects", label: "Effects", icon: "fa-solid fa-wand-sparkles" }
      ],
      initial: "main"
    }
  };
}

/** A mutation's choice as its row says it: "Strength +5, Stealth +1 rank", or "" with none made. */
export function mutationChosenText(s) {
  if ( !s?.choice ) return "";
  const parts = [];
  if ( s.choice.attribute && s.chosen?.attribute ) {
    parts.push(`${IROP.attributes[s.chosen.attribute]?.label ?? s.chosen.attribute} ${(s.choice.attribute > 0) ? "+" : ""}${s.choice.attribute}`);
  }
  if ( s.choice.skill && s.chosen?.skill ) parts.push(`${IROP.skills[s.chosen.skill]?.label ?? s.chosen.skill} +${s.choice.skill} rank`);
  return parts.join(", ");
}

/* -------------------------------------------- */

/**
 * The rank on the Personnel Record (2026-10-17): its insignia and band, what comes next, and for a
 * GM the ranks to set one by hand.
 */
export function rankContext(system, canSet = false) {
  const r = system.serviceRank ?? serviceRank(system.xp?.earned, system.details?.record?.rank);
  const band = (r.to === null) ? `${r.from}+ XP earned` : (r.from > 0 ? `${r.from} to ${r.to} XP earned` : `Up to ${r.to} XP earned`);
  return {
    ...r, band,
    nextLine: r.next ? `${r.next.label} at ${r.next.from} XP earned` : "The top ODR rank",
    choices: canSet ? [{ key: "", label: "By XP earned", on: !r.set },
      ...rankList().map(x => ({ key: x.key, label: x.label, on: r.set && (x.key === r.key) }))] : null
  };
}

/** A medal's ribbon, in the ODR colors, its stripes picked by its name so the same medal always matches. */
export function medalRibbon(name) {
  const colors = ["#0d1522", "#b9c4c8", "#42abf2", "#d9b234", "#c4121c", "#3fb8b0", "#f2f7f9"];
  let h = 2166136261;
  for ( const ch of String(name ?? "") ) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const pick = n => colors[(h >>> (n * 3)) % colors.length];
  const [a, b, c] = [pick(0), pick(1), pick(2)];
  return `background: linear-gradient(90deg, ${a} 0 20%, ${b} 20% 36%, ${c} 36% 64%, ${b} 64% 80%, ${a} 80% 100%)`;
}

/** Today on the campaign calendar, or blank. */
async function campaignDate() {
  try {
    const { dateInfo } = await import("../calendar.mjs");
    return dateInfo().date ?? "";
  }
  catch {
    return "";
  }
}

/** The medal dialog: its name, the mission, the date and why; suggestions from the world. */
async function medalDialog(title, medal = {}, okLabel = "Award") {
  const esc = v => escapeText(v ?? "");
  const awarded = [...new Set((game.actors?.filter?.(a => a.type === "operative") ?? [])
    .flatMap(a => (a.system.details?.record?.medals ?? []).map(m => m.name)).filter(Boolean))].sort();
  let missions = [];
  try {
    const { getList } = await import("../settings.mjs");
    missions = getList("missionLog").slice().reverse().map(m => `Week ${m.week}: ${m.label}${m.territory ? ` (${m.territory})` : ""}`);
  }
  catch { missions = []; }
  const options = list => list.map(v => `<option value="${esc(v)}"></option>`).join("");
  const data = await DialogV2.input({
    window: { title },
    classes: ["irop", "irop-roll-dialog", "irop-medal-dialog"],
    content: `<div class="irop-dialog medal-form">
      <label class="irop-choose"><span>Medal</span><input type="text" name="name" value="${esc(medal.name)}" list="irop-medal-names" placeholder="Orbital Cross" required></label>
      <datalist id="irop-medal-names">${options(awarded)}</datalist>
      <label class="irop-choose"><span>Mission</span><input type="text" name="mission" value="${esc(medal.mission)}" list="irop-medal-missions" placeholder="Week 3: Scavenge (Neo Seattle)"></label>
      <datalist id="irop-medal-missions">${options(missions)}</datalist>
      <label class="irop-choose"><span>Date</span><input type="text" name="date" value="${esc(medal.date)}"></label>
      <label class="irop-choose medal-reason"><span>Why</span><textarea name="description" rows="5" placeholder="Held the dam road alone for three rounds while the squad pulled the wounded out.">${esc(medal.description)}</textarea></label>
    </div>`,
    ok: { label: okLabel, icon: "fa-solid fa-medal" }
  });
  const name = String(data?.name ?? "").trim();
  if ( !name ) return null;
  return { name, mission: String(data.mission ?? "").trim(), date: String(data.date ?? "").trim(), description: String(data.description ?? "").trim() };
}

/** The chat card for a medal awarded. */
export function medalCardHTML(who, medal) {
  return `<div class="irop-card medal-card">
    <header class="card-head"><h3><i class="fa-solid fa-medal"></i> Commendation</h3><span class="card-sub">ODR personnel</span></header>
    <p class="medal-award"><span class="medal-ribbon" style="${medalRibbon(medal.name)}"></span><span><strong>${escapeText(who)}</strong> is awarded the <strong>${escapeText(medal.name)}</strong>${medal.mission ? `, ${escapeText(medal.mission)}` : ""}.</span></p>
    ${medal.description ? `<p class="medal-why">${escapeText(medal.description)}</p>` : ""}
  </div>`;
}

/** An ability's Energy cost and ammo on the sheet, as the character's perks leave them. */
export function abilityCost(item, abilities) {
  const base = Number(item.system.energyCost) || 0;
  const up = abilityAsUpgraded(item, abilities);
  const changed = up.energy !== base;
  const ammo = up.attack ? up.attack.ammo : (up.ammoOnly || 0);
  return {
    energy: up.energy,
    energyTip: changed ? `Energy cost: ${up.energy}, from ${base}, changed by your ${item.system.paraphysics?.discipline ? "discipline rank and the power's modification" : "perks"}` : "Energy cost",
    energyChanged: changed,
    ammoCost: (ammo > 1) ? ammo : 0
  };
}

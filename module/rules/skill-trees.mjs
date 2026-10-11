/**
 * Perk trees, RULED 2026-10-08 (Johnald). A tree is a GM editable item: tiers top
 * to bottom, each holding perks (ability items, by UUID) with an XP cost. On the
 * Dossier a character buys perks from the trees of their role:
 *   - LIGHT gating: owning any one perk in a tier opens the next tier down. A tree
 *     can switch this off (the Generalist perks work differently).
 *   - A "Pick one" tier is Exclusive: taking one rules out the rest. Soft
 *     permanent: a player cannot swap; the GM can undo it.
 *   - A perk can require another perk first (Strong Back (2) needs Strong Back (1)).
 *   - Players buy freely with unspent XP. Edit mode adds a perk free, for setting
 *     up a character, and ignores gating, but still honours Pick one.
 *   - Specializations: the Primary tree from the start; the first specialization
 *     opens at 300 XP earned and must be of the character's own role, the second
 *     at 900 and may be of any role. Taking a perk in a specialization makes it
 *     the character's; soft permanent, like Pick one. A world can change all of
 *     this in the system settings (2026-10-08), for private tables.
 * Everything here works on plain data, so it is tested without Foundry.
 */

/** A name compared loosely: case, accents, apostrophes and other punctuation ignored. */
export function perkKey(name) {
  return String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/['‘’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Every node of a tree, each with its tier index. */
export function treeNodes(tree) {
  return (tree?.tiers ?? []).flatMap((t, tier) => (t.nodes ?? []).map(n => ({ ...n, tier })));
}

/**
 * Which of a character's abilities hold which nodes. A perk bought or added from a
 * tree carries flags.irop.perk.node. An ability without that flag still counts when
 * its name matches a node, so characters brought over from Sandbox show the perks
 * they already have; each such ability counts once.
 * @param {object[]} trees        Tree system data, in Dossier order
 * @param {object[]} abilities    The character's abilities: {id, name, flags}
 * @param {(node: object) => string} [nameOf]   A node's current name
 * @param {(tree: object) => boolean} [byName]  Trees where a name match counts. Another
 *   role's tree counts only perks bought from it, so a shared name never claims it.
 * @returns {Map<string, string>}  node id to the owned ability's id
 */
export function ownedPerks(trees, abilities, nameOf = n => n.name, byName = () => true) {
  const owned = new Map();
  const loose = [];
  for ( const a of abilities ) {
    const node = a.flags?.irop?.perk?.node;
    if ( node ) owned.set(node, a.id);
    // A background's perk is not a tree's, even if it shares a name with one (2026-10-10).
    else if ( !a.flags?.irop?.backgroundPerk ) loose.push(a);
  }
  const used = new Set();
  for ( const tree of trees ) {
    if ( !byName(tree) ) continue;
    for ( const node of treeNodes(tree) ) {
      if ( owned.has(node.id) ) continue;
      const key = perkKey(nameOf(node));
      const match = key && loose.find(a => !used.has(a.id) && (perkKey(a.name) === key));
      if ( match ) {
        owned.set(node.id, match.id);
        used.add(match.id);
      }
    }
  }
  return owned;
}

/**
 * What a character can do with each node of a tree.
 * @param {object} tree                 Tree system data: {gated, tiers}
 * @param {object} options
 * @param {Set<string>|Map<string, *>} options.owned   Node ids the character holds
 * @param {number} [options.unspent]    XP to spend
 * @param {boolean} [options.free]      Edit mode: no XP and no gating
 * @param {(node: object) => string} [options.nameOf]
 * @param {(node: object) => string[]} [options.unmet]   Written requirements the character
 *   does not meet (attributes, skill ranks; see rules/requirements.mjs)
 * @returns {Map<string, {state: string, canBuy: boolean, cost: number, reason: string, needs: string[]}>}
 *   state is "owned", "excluded" (ruled out by its Pick one tier), "locked" or "open";
 *   needs lists the written requirements not met, and waitsOn names the perk it needs
 *   first (neither once owned, nor in Edit mode).
 */
export function nodeStates(tree, { owned, unspent = 0, free = false, nameOf = n => n.name, unmet = () => [] }) {
  const has = id => owned.has(id);
  const byId = new Map(treeNodes(tree).map(n => [n.id, n]));
  const states = new Map();
  const tiers = tree?.tiers ?? [];
  tiers.forEach((tier, index) => {
    const taken = tier.nodes.filter(n => has(n.id));
    // The nearest tier above with anything in it; an empty tier never blocks.
    let aboveIndex = index - 1;
    while ( (aboveIndex >= 0) && !tiers[aboveIndex].nodes.length ) aboveIndex--;
    const above = tiers[aboveIndex];
    const opened = !tree.gated || !above || above.nodes.some(n => has(n.id));
    for ( const node of tier.nodes ) {
      const cost = Math.max(0, Number(node.xp) || 0);
      let state = "open";
      let reason = "";
      const required = node.requires ? byId.get(node.requires) : null;
      const needs = (free || has(node.id)) ? [] : unmet(node);
      // The perk before it in its line, while not yet owned (Edit mode aside).
      const waitsOn = (!free && required && !has(node.id) && !has(required.id)) ? nameOf(required) : "";
      if ( has(node.id) ) {
        state = "owned";
        reason = "Owned";
      }
      else if ( tier.exclusive && taken.length ) {
        state = "excluded";
        reason = `Ruled out: ${taken.map(nameOf).join(" and ")} was taken from this tier`;
      }
      else if ( !free && !opened ) {
        state = "locked";
        reason = `Locked: take a perk from Tier ${aboveIndex + 1} first`;
      }
      else if ( !free && required && !has(required.id) ) {
        state = "locked";
        reason = `Locked: needs ${nameOf(required)} first`;
        if ( needs.length ) reason += `, and ${needs.join(" and ")}`;
      }
      else if ( needs.length ) {
        state = "locked";
        reason = `Locked: needs ${needs.join(" and ")}`;
      }
      let canBuy = state === "open";
      if ( canBuy && !free && (unspent < cost) ) {
        canBuy = false;
        reason = `Costs ${cost} XP; ${unspent} unspent`;
      }
      else if ( canBuy ) reason = free ? "Add free (Edit mode)" : `Buy for ${cost} XP`;
      states.set(node.id, { state, canBuy, cost, reason, needs, waitsOn });
    }
  });
  return states;
}

/**
 * The specialization rules (RULED 2026-10-08), each a world setting a table can change:
 *   unlockXP       XP earned at which each specialization opens, in order; one number
 *                  per specialization a character may hold (none: no specializations)
 *   ownRoleFirst   the first must be of the character's own role
 *   crossRole      later ones may be of any role
 */
export const SPECIALIZATION_RULES = Object.freeze({ unlockXP: Object.freeze([300, 900]), ownRoleFirst: true, crossRole: true });

/** The unlock setting as numbers: "300, 900" is [300, 900]. Anything not a number is skipped. */
export function parseUnlocks(text) {
  return String(text ?? "").split(/[\s,;]+/).filter(Boolean).map(Number)
    .filter(n => Number.isFinite(n) && (n >= 0)).map(Math.round).sort((a, b) => a - b);
}

/** How many specializations a character may hold at this much XP earned. */
export function specializationSlots(earned, unlockXP = SPECIALIZATION_RULES.unlockXP) {
  return unlockXP.filter(xp => (Number(earned) || 0) >= xp).length;
}

/** "first", "second"... for the nth specialization, counting from 0. */
export function ordinal(n) {
  return ["first", "second", "third", "fourth", "fifth", "sixth"][n] ?? `number ${n + 1}`;
}

/**
 * The trees a character sees, in Dossier order: Primary, then specializations,
 * then General (the Everyone trees). Within each, the character's own role first,
 * then by each tree's Order and name. Shown: the role's Primary and all three of
 * its specializations (locked until they open), any specialization of another
 * role the character has bought into, one more being browsed, and Everyone trees.
 * @param {object[]} trees        Perk tree items: {id, name, system}
 * @param {object} options
 * @param {string} options.role           The character's role key, or ""
 * @param {Iterable<string>} [options.entered]  Tree ids the character holds perks from
 * @param {string|null} [options.browse]  Another role's specialization being looked at
 */
export function treesFor(trees, { role, entered = [], browse = null }) {
  const held = new Set(entered);
  const rank = { primary: 0, specialization: 1, general: 2 };
  const own = t => (!t.system.role || (t.system.role === role)) ? 0 : 1;
  return trees
    .filter(t => {
      if ( t.system.kind === "specialization" ) return (t.system.role === role) || held.has(t.id) || (t.id === browse);
      return !t.system.role || (t.system.role === role);
    })
    .sort((a, b) => ((rank[a.system.kind] ?? 3) - (rank[b.system.kind] ?? 3)) || (own(a) - own(b))
      || String(a.system.role).localeCompare(String(b.system.role))
      || (a.system.order - b.system.order) || String(a.name).localeCompare(String(b.name)));
}

/**
 * Why a character cannot start this specialization, or "" if they can, it is
 * already theirs, or it is not a specialization.
 * @param {object} tree           {id, system}
 * @param {object} options
 * @param {string} options.role       The character's role key
 * @param {number} options.earned     XP earned
 * @param {string[]} options.entered  Specialization tree ids the character holds perks from
 * @param {object} [options.rules]    The table's rules, as SPECIALIZATION_RULES
 */
export function specializationLock(tree, { role, earned, entered, rules = SPECIALIZATION_RULES }) {
  if ( (tree.system.kind !== "specialization") || entered.includes(tree.id) ) return "";
  const unlock = rules.unlockXP;
  if ( !unlock.length ) return "This table plays without specializations";
  if ( entered.length >= unlock.length ) {
    return `Already ${unlock.length} specialization${unlock.length === 1 ? "" : "s"}, the most allowed`;
  }
  if ( entered.length >= specializationSlots(earned, unlock) ) {
    return entered.length ? `Your ${ordinal(entered.length)} specialization opens at ${unlock[entered.length]} XP earned`
      : `Specializations open at ${unlock[0]} XP earned`;
  }
  const foreign = tree.system.role !== role;
  if ( foreign && !rules.crossRole ) return "Specializations must be of your own role at this table";
  if ( foreign && rules.ownRoleFirst && !entered.length ) return "Your first specialization must be of your own role";
  return "";
}

/**
 * Whether another role's specializations can be bought into now, so the Dossier
 * offers them: a specialization is open, cross training is on, and the first is
 * taken (or need not be of the character's own role).
 */
export function canCrossTrain({ earned, entered, rules = SPECIALIZATION_RULES }) {
  if ( !rules.crossRole ) return false;
  if ( specializationSlots(earned, rules.unlockXP) <= entered.length ) return false;
  return (entered.length > 0) || !rules.ownRoleFirst;
}

/* -------------------------------------------- */
/*  Editing a tree                              */
/* -------------------------------------------- */

/** A new node's XP cost: the last one in its tier, or else the tier above, or 10. */
export function defaultNodeCost(tiers, tierIndex) {
  for ( let i = tierIndex; i >= 0; i-- ) {
    const last = tiers[i]?.nodes?.at(-1);
    if ( last ) return last.xp;
  }
  return 10;
}

/** Tiers with a node taken out, and any requirement pointing at it cleared. */
export function removeNode(tiers, nodeId) {
  return tiers.map(t => ({
    ...t,
    nodes: t.nodes.filter(n => n.id !== nodeId).map(n => (n.requires === nodeId ? { ...n, requires: "" } : n))
  }));
}

/** Tiers with a node moved to the end of another tier. */
export function moveNode(tiers, nodeId, toTier) {
  const node = treeNodes({ tiers }).find(n => n.id === nodeId);
  if ( !node || !tiers[toTier] ) return tiers;
  const { tier, ...data } = node;
  const out = tiers.map(t => ({ ...t, nodes: t.nodes.filter(n => n.id !== nodeId) }));
  out[toTier].nodes.push(data);
  return out;
}

/** Tiers with one moved up (-1) or down (+1). */
export function moveTier(tiers, index, delta) {
  const to = index + delta;
  if ( (to < 0) || (to >= tiers.length) || !tiers[index] ) return tiers;
  const out = [...tiers];
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

/** Tiers without one tier, and requirements on its nodes cleared. */
export function removeTier(tiers, index) {
  const gone = new Set((tiers[index]?.nodes ?? []).map(n => n.id));
  return tiers.filter((_, i) => i !== index).map(t => ({
    ...t,
    nodes: t.nodes.map(n => (gone.has(n.requires) ? { ...n, requires: "" } : n))
  }));
}

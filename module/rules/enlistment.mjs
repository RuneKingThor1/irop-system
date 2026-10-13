import { IROP } from "../config.mjs";
import { startingSkillPlan, startingSkillRanks } from "./starting-skills.mjs";
import { perkCopy } from "./backgrounds.mjs";

/**
 * Enlistment (Johnald, 2026-10-12: mockup A, the enlistment terminal): a new operative made in
 * six steps, species, role, background, skills and perk, identity, review. The same rules the
 * sheet applies when a species, role or background is dropped on it, run once, up front:
 * the species sets the base attributes, the role's first skill comes free with one more picked,
 * the background gives its picks of skills and one perk. Kept apart from Foundry so it can be
 * tested; strategy-free, it reads plain item data.
 *
 * Choices: {species, role, background (item ids), roleSkill (a skill key), backgroundSkills
 * (skill keys), perk (the background's perk entry id), firstName, lastName, callsign, img, owner}
 */

/** The steps, in order. */
export const STEPS = [
  { key: "species", label: "Species", prompt: "Select species" },
  { key: "role", label: "Role", prompt: "Select doctrine" },
  { key: "background", label: "Background", prompt: "Select background" },
  { key: "skills", label: "Skills and perk", prompt: "Assign starting skills" },
  { key: "identity", label: "Identity", prompt: "Identify recruit" },
  { key: "review", label: "Review", prompt: "Confirm enlistment" }
];

/** The default picture for a new operative. */
export const DEFAULT_IMG = "icons/svg/mystery-man.svg";

/** Plain text from HTML, and its first sentence or two, up to about `max` characters. */
export function blurb(html, max = 150) {
  const text = String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  if ( text.length <= max ) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let out = "";
  for ( const s of sentences ) {
    if ( (out + s).trim().length > max ) break;
    out += s;
  }
  return (out.trim() || `${text.slice(0, max).replace(/\s+\S*$/, "")}...`).trim();
}

/** A species' attributes against the baseline: [{key, abbr, value, diff}]. */
export function speciesAttributes(system) {
  return Object.entries(IROP.attributes).map(([key, a]) => {
    const value = Math.round(Number(system?.attributes?.[key] ?? IROP.attributeDefaults[key]) || 0);
    return { key, abbr: a.abbr, value, diff: value - IROP.attributeDefaults[key] };
  });
}

/** What a role offers at the start: the free skill, the ones to pick from, and how many. */
export function rolePlan(role) {
  return startingSkillPlan(role ? { type: "role", system: role.system } : null);
}

/** What a background offers at the start. */
export function backgroundPlan(background) {
  return startingSkillPlan(background ? { type: "background", system: background.system } : null);
}

/** Every skill taken, in order (a skill taken twice appears twice), from the choices. */
export function skillsTaken(choices, role, background) {
  const rp = rolePlan(role);
  const bp = backgroundPlan(background);
  const fromRole = [...rp.granted, ...(rp.options.includes(choices.roleSkill) ? [choices.roleSkill] : [])];
  const fromBackground = (choices.backgroundSkills ?? []).filter(k => bp.options.includes(k)).slice(0, bp.pick);
  return [...fromRole, ...fromBackground];
}

/** The ranks the skills taken come to, from nothing: {key: rank}. */
export function startingRanks(taken) {
  const zero = Object.fromEntries(Object.keys(IROP.skills).map(k => [k, 0]));
  const { update } = startingSkillRanks(zero, taken);
  return Object.fromEntries(Object.entries(update).map(([path, rank]) => [path.split(".")[2], rank]));
}

/** The name on the sheet and the token: the callsign, else the full name. */
export function operativeName(choices) {
  const full = [choices.firstName, choices.lastName].map(s => String(s ?? "").trim()).filter(Boolean).join(" ");
  return String(choices.callsign ?? "").trim() || full;
}

/**
 * What is still missing at each step, in words, or "" when the step is complete.
 * @param {object} choices
 * @param {{species?: object, role?: object, background?: object}} items   The chosen items
 * @returns {Record<string, string>}   By step key
 */
export function stepIssues(choices, { species = null, role = null, background = null } = {}) {
  const rp = rolePlan(role);
  const bp = backgroundPlan(background);
  const picked = (choices.backgroundSkills ?? []).filter(k => bp.options.includes(k)).length;
  const perks = background?.system?.perks ?? [];
  const skills = [];
  if ( !role || !background ) skills.push("Choose a role and a background first.");
  else {
    if ( rp.pick && !rp.options.includes(choices.roleSkill) ) skills.push(`Pick ${rp.pick} of ${role.name}'s skills.`);
    if ( picked !== bp.pick ) skills.push(`Pick ${bp.pick} of ${background.name}'s skills (${picked} picked).`);
    if ( perks.length && !perks.some(p => p.id === choices.perk) ) skills.push(`Pick one of ${background.name}'s perks.`);
  }
  const out = {
    species: species ? "" : "Choose a species.",
    role: role ? "" : "Choose a role.",
    background: background ? "" : "Choose a background.",
    skills: skills.join(" "),
    identity: operativeName(choices) ? "" : "Give a callsign or a name.",
    review: ""
  };
  out.review = Object.values(out).filter(Boolean).length ? "Finish the steps marked above." : "";
  return out;
}

/**
 * The new operative, ready to create: the actor's data with its species, role, background and
 * the perk taken among its items. Abilities are plain item data (toObject).
 * @param {object} choices
 * @param {{species: object, role: object, background: object, perkAbility?: object}} items
 *   Item data (toObject) for each, and the ability of the perk taken
 * @param {{owner?: string, date?: string, request?: string}} [options]
 * @returns {object}   Actor creation data
 */
export function operativeData(choices, { species, role, background, perkAbility = null }, { owner = "", date = "", request = "" } = {}) {
  const strip = data => {
    const copy = structuredClone(data);
    for ( const key of ["_id", "folder", "sort", "ownership", "_stats"] ) delete copy[key];
    return copy;
  };
  const name = operativeName(choices);
  const img = String(choices.img ?? "").trim() || DEFAULT_IMG;
  const taken = skillsTaken(choices, role, background);
  const ranks = startingRanks(taken);
  const attributes = Object.fromEntries(Object.keys(IROP.attributes).map(k => [k, { base: Number(species.system?.attributes?.[k] ?? IROP.attributeDefaults[k]) }]));
  const skills = Object.fromEntries(Object.entries(ranks).map(([k, rank]) => [k, { rank }]));
  const items = [strip(species), strip(role), strip(background)];
  const entry = (background.system?.perks ?? []).find(p => p.id === choices.perk);
  if ( entry && perkAbility ) items.push(perkCopy(strip(perkAbility), background.name, entry));
  const record = {
    firstName: String(choices.firstName ?? "").trim(),
    lastName: String(choices.lastName ?? "").trim(),
    enlisted: date,
    timeline: date ? [{ date, entry: "Enlisted with Eclipse." }] : []
  };
  return {
    name, type: "operative", img,
    ownership: owner ? { default: 0, [owner]: 3 } : { default: 0 },
    prototypeToken: { name, texture: { src: img } },
    system: {
      attributes, skills,
      details: { callsign: String(choices.callsign ?? "").trim(), startingSkills: { role: role.name, background: background.name }, record }
    },
    flags: { irop: { enlistment: { request, by: owner, species: species.name, role: role.name, background: background.name } } },
    items
  };
}

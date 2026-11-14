import { formula, totalModifier, naturalEdge, NATURAL_EDGE, luckRerollOffer } from "../rules/combat.mjs";
import { BANK_CAP } from "../rules/dynosrs.mjs";
import { IROP } from "../config.mjs";

/**
 * A d100 roll under check. The modifiers are applied to the roll (canon), and
 * the success test compares the modified total with the target attribute.
 *
 * options:
 *   label, subtitle   card heading
 *   kind              "check" | "attack" | "critical" | "dodge"
 *   save              a check that is a save (no natural Edge)
 *   target            the number to meet or roll under
 *   targetLabel       for example "Perception 45"
 *   modifiers         [{label, value}] as collected by the combat rules core
 *   actorUuid, itemUuid, attack   context for follow up buttons
 */
export class D100Roll extends foundry.dice.Roll {

  static CHAT_TEMPLATE = "systems/irop/templates/chat/d100-roll.hbs";

  static create({ modifiers = [], ...options }) {
    return new this(formula(modifiers), {}, { ...options, modifiers });
  }

  /** The face of the d100 before modifiers. */
  get natural() {
    return this.dice[0]?.total ?? null;
  }

  get success() {
    return this.total <= this.options.target;
  }

  /** @override */
  async _prepareChatRenderContext({ flavor, isPrivate = false, message, ...options } = {}) {
    const context = await super._prepareChatRenderContext({ flavor, isPrivate, ...options });
    if ( isPrivate ) return { ...context, isPrivate };

    const o = this.options;
    const success = this.success;
    const kind = o.kind ?? "check";
    const words = {
      check: ["Success", "Failure"],
      attack: ["Hit", "Miss"],
      critical: ["Critical hit", "No critical"],
      dodge: ["Dodged", "Dodge failed"]
    }[kind] ?? ["Success", "Failure"];

    const modifiers = (o.modifiers ?? []).filter(m => m.value).map(m => ({
      label: m.label,
      value: m.value,
      text: m.value > 0 ? `+${m.value}` : `${m.value}`,
      harder: m.value > 0
    }));

    const buttons = [];
    const attack = o.attack;
    if ( attack && (kind === "attack") && success ) {
      if ( attack.damage ) buttons.push({ action: "damage", label: "Damage", icon: "fa-solid fa-burst" });
      buttons.push({ action: "critical", label: "Roll critical", icon: "fa-solid fa-crosshairs" });
    }
    if ( attack && (kind === "attack") && !success && attack.scatter ) {
      buttons.push({ action: "scatter", label: "Scatter", icon: "fa-solid fa-compass" });
      // A missed explosive still goes off wherever it scatters to (2026-10-08): its damage
      // is for whatever is caught in the blast there.
      if ( attack.damage ) buttons.push({ action: "damage", label: "Damage where it lands", icon: "fa-solid fa-burst" });
    }
    if ( attack && (kind === "critical") && success && attack.damage ) {
      buttons.push({ action: "damage", label: "Critical damage", icon: "fa-solid fa-burst", critical: true });
    }

    // Doubles or a natural roll of the unit number on a check or attack (Johnald, 2026-11-14): the
    // die lights up, and an operative roller may bank the Edge from the card, once.
    let unit = NATURAL_EDGE.unit;
    try { unit = game.settings.get("irop", "unitNumber"); } catch { /* the default */ }
    const natural = naturalEdge(this.natural, { kind, save: !!o.save, unit });
    const roller = o.actorUuid ? foundry.utils.fromUuidSync(o.actorUuid) : null;
    let edge = null;
    if ( natural ) {
      const operative = roller?.type === "operative";
      edge = {
        ...natural,
        label: { unit: `Unit number ${natural.unit}`, unitDoubles: `Unit number ${natural.unit}, doubles` }[natural.reason] ?? "Doubles",
        cap: operative ? (roller.system.banks?.edgeMax ?? BANK_CAP.EDGE) : BANK_CAP.EDGE,
        operative,
        done: !!message?.flags?.irop?.banked?.EDGE
      };
    }

    // Soldier's Luck (Johnald, 2026-11-14): a failed attack, check, save or dodge may be rerolled for a
    // point, once: a reroll's own card offers none.
    const luckRerolled = !!message?.flags?.irop?.luckReroll;
    const luck = luckRerollOffer({ kind, failed: !success, rerolled: luckRerolled, reroll: !!o.luckReroll,
      luck: roller?.system?.vitals?.luck?.value });
    if ( luck ) buttons.push({ action: "luckReroll", label: `Reroll with Luck (${luck.left} left)`, icon: "fa-solid fa-clover" });

    return {
      ...context,
      isPrivate,
      edge,
      luckRerolled,
      luckReroll: !!o.luckReroll,
      // A successful dodge's effect on the hit (2026-11-14).
      dodgeReduction: ((kind === "dodge") && success) ? (Number(o.reduction ?? 3)) : null,
      label: o.label ?? "Check",
      subtitle: o.subtitle ?? "",
      kind,
      natural: this.natural,
      total: this.total,
      target: o.target,
      targetLabel: o.targetLabel ?? String(o.target),
      modifiers,
      totalModifier: totalModifier(o.modifiers ?? []),
      success,
      resultLabel: success ? words[0] : words[1],
      margin: Math.abs(o.target - this.total),
      buttons,
      messageId: message?.id ?? ""
    };
  }
}

/* -------------------------------------------- */

/** A damage roll that remembers its type and the weapon's armor numbers. */
export class DamageRoll extends foundry.dice.Roll {

  static CHAT_TEMPLATE = "systems/irop/templates/chat/damage-roll.hbs";

  /** @override */
  async _prepareChatRenderContext({ flavor, isPrivate = false, ...options } = {}) {
    const context = await super._prepareChatRenderContext({ flavor, isPrivate, ...options });
    const o = this.options;
    return {
      ...context,
      isPrivate,
      label: o.label ?? "Damage",
      damageType: o.damageTypeLabel ?? "",
      critical: !!o.critical,
      shred: o.shred ?? 0,
      penetration: o.penetration ?? 0,
      destruction: o.destruction ?? 0,
      drBypass: o.drBypass ?? 0,
      // What role perks added (2026-10-18): "Weapon Expert +1 damage".
      perkNotes: o.perkNotes ?? [],
      // A status the hit inflicts, from special ammo, with a button to apply it to the target.
      // A chemthrower burn (2026-10-08): the target saves for half; a button rolls the save.
      burn: o.burn ? {
        ...o.burn,
        targetName: o.targetName,
        half: Math.floor((this.total ?? 0) / 2),
        statusLabel: o.burn.status ? (IROP.statusEffects.find(e => e.id === o.burn.status.id)?.name ?? o.burn.status.id) : "",
        canSave: true,
        // Burned with no target, the button rolls for whichever token the presser targets.
        pickTarget: !o.targetUuid
      } : null,
      status: o.status ? {
        ...o.status,
        label: IROP.statusEffects.find(e => e.id === o.status.id)?.name ?? o.status.id,
        targetName: o.targetName,
        canApply: !!o.targetUuid
      } : null,
      // A blast marker on the map: the card clears it (Johnald, 2026-10-09).
      blastUuid: o.blastUuid ?? "",
      // An attack power's save (2026-10-20): a button rolls it for the targeted tokens.
      powerSave: o.powerSave ?? null
    };
  }
}

import { IROP } from "../config.mjs";
import { getStrategyScale, getStrategyRules } from "../settings.mjs";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

/**
 * The sheet for an Event or Dark Event card (Strategy Layer step 6, 2026-10-08): its
 * picture, the deck it belongs to, how it plays, the numbers it changes when revealed
 * and when discarded, and its text. Never in (Johnald, 2026-10-08): the territories it
 * never lands on or is played on.
 */
export class EventCardSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["irop", "event-card-sheet"],
    position: { width: 520, height: "auto" },
    window: { resizable: true },
    form: { submitOnChange: true, handler: EventCardSheet.#onSubmit },
    actions: { editImage: EventCardSheet.#onEditImage, allow: EventCardSheet.#onAllow }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/cards/event-card.hbs", scrollable: [""] }
  };

  /** @override */
  get title() {
    return `${IROP.cardKinds[this.document.system?.kind]?.label ?? "Card"}: ${this.document.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const card = this.document;
    const system = card.system;
    return {
      card,
      system,
      img: card.faces?.[0]?.img || card.img,
      editable: this.isEditable,
      isDark: system.kind === "dark",
      kinds: Object.fromEntries(Object.entries(IROP.cardKinds).map(([k, v]) => [k, v.label])),
      effects: Object.entries(IROP.cardEffects).map(([key, label]) => ({
        key, label, effect: system.effect?.[key] ?? 0, discard: system.discard?.[key] ?? 0,
        // Reputation (RULED 2026-10-11): a card counts in steps, each worth some points.
        tip: { reputation: `Each step is ${getStrategyRules().cardReputation} Reputation points`, strength: `Each step is ${getStrategyRules().cardStrength} Strength` }[key] ?? ""
      })),
      ...EventCardSheet.neverIn(system.excluded)
    };
  }

  /** The territories a card is never in, and the rest to add, in the campaign's word for them. */
  static neverIn(excluded = []) {
    const ids = Array.from(excluded ?? []);
    const territories = (game.items?.filter(i => i.type === "territory") ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const unit = getStrategyScale().unit.toLowerCase();
    const others = territories.filter(t => !ids.includes(t.id));
    return {
      never: ids.map(id => ({ id, name: game.items?.get(id)?.name ?? "A deleted territory" })),
      others: Object.fromEntries(others.map(t => [t.id, t.name])),
      canAdd: others.length > 0,
      unit,
      units: `${unit}s`,
      addLabel: `Add a ${unit}`
    };
  }

  /** Picking a territory from the list adds it to Never in. @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector(".ec-never-add")?.addEventListener("change", event => {
      event.stopPropagation();
      const id = event.currentTarget.value;
      const now = Array.from(this.document.system.excluded ?? []);
      if ( !id || now.includes(id) || !this.isEditable ) return;
      this.document.update({ "system.excluded": [...now, id] });
    });
  }

  /** Let the card happen in a territory again. */
  static #onAllow(event, target) {
    if ( !this.isEditable ) return null;
    const now = Array.from(this.document.system.excluded ?? []);
    return this.document.update({ "system.excluded": now.filter(id => id !== target.dataset.id) });
  }

  /** Save the form. The picture and name go on the card's face as well. */
  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const card = this.document;
    const faces = (card.toObject().faces ?? []).map(f => ({ ...f }));
    if ( !faces.length ) faces.push({ name: data.name ?? card.name, img: card.img, text: "" });
    if ( data.name ) faces[0].name = data.name;
    const update = { system: data.system, faces };
    if ( data.name ) update.name = data.name;
    if ( "description" in data ) update.description = data.description;
    return card.update(update);
  }

  /** Pick the card's picture. */
  static #onEditImage() {
    if ( !this.isEditable ) return null;
    const card = this.document;
    const Picker = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    const current = card.faces?.[0]?.img || card.img;
    return new Picker({
      type: "image", current,
      callback: path => {
        const faces = (card.toObject().faces ?? []).map(f => ({ ...f }));
        if ( !faces.length ) faces.push({ name: card.name, img: path, text: "" });
        else faces[0].img = path;
        return card.update({ faces });
      }
    }).render({ force: true });
  }
}

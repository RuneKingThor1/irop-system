import { IROP } from "../config.mjs";

const fields = foundry.data.fields;

/**
 * A store (Johnald, 2026-10-10): its own actor in the sidebar, with the items it sells
 * embedded on it as its shelf. Each shelf item keeps its own price in each currency and which
 * currencies may buy it; the store's markup goes over them, it charges its preferred currency
 * unless the player pays with another, and it buys back at a share of an item's price.
 * Whether an item's stock is limited, how many are left and whether players can see it are
 * kept on the item, in flags.irop.shelf (see rules/store.mjs).
 */
export class StoreData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: true, blank: true }),
      markup: new fields.NumberField({ required: true, nullable: false, integer: true, initial: IROP.store.markup,
        min: IROP.store.markupMin, max: IROP.store.markupMax }),
      sellBack: new fields.NumberField({ required: true, nullable: false, integer: true, initial: IROP.store.sellBack, min: 0, max: 100 }),
      // The currency it prices in and charges by default, and pays in when it buys back
      // (Johnald, 2026-10-10). A player may pay with any other an item takes.
      preferred: new fields.StringField({ required: true, initial: "credits", choices: () => IROP.currencyLabels }),
      // Offered in the enlistment terminal's Requisition step (Johnald, 2026-10-16), so a recruit
      // can buy their starting kit before their first mission.
      enlist: new fields.BooleanField({ initial: false })
    };
  }

  /** A store has nothing to roll with. */
  getRollData() {
    return {};
  }
}

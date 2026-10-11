import { IROP } from "../config.mjs";

const fields = foundry.data.fields;

/** What a card changes: whole numbers, none by default. */
function effects() {
  return new fields.SchemaField(Object.fromEntries(Object.keys(IROP.cardEffects).map(k => [k,
    new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 })])));
}

/**
 * An Event or Dark Event card (Strategy Layer step 6, 2026-10-08). Doc: Event cards
 * are instantaneous (apply, then discard) or persistent (stay on their territory to the
 * end of the next turn, then discard, some with an effect on discard). Dark Events are
 * used the turn they are drawn unless the card says otherwise; discretionary ones are
 * played when the GM chooses; only one Reprisal at a time. Negative events in a
 * liberated territory are handled by the Resistance. The card's own text says the rest.
 */
export class EventCardData extends foundry.abstract.TypeDataModel {
  /** @override */
  static defineSchema() {
    return {
      kind: new fields.StringField({ required: true, initial: "event", choices: () => Object.fromEntries(Object.entries(IROP.cardKinds).map(([k, v]) => [k, v.label])) }),
      persistent: new fields.BooleanField({ initial: false }),
      discretionary: new fields.BooleanField({ initial: false }),
      holdable: new fields.BooleanField({ initial: false }),
      reprisal: new fields.BooleanField({ initial: false }),
      negative: new fields.BooleanField({ initial: false }),
      respond: new fields.BooleanField({ initial: false }),
      // Its numbers land on every territory, not one (World Events, 2026-10-08).
      worldwide: new fields.BooleanField({ initial: false }),
      // Territories it never lands on or is played on, by id (Johnald, 2026-10-08); a
      // worldwide card's numbers skip them.
      excluded: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
      effect: effects(),
      discard: effects(),
      discardText: new fields.StringField({ required: true, blank: true, initial: "" })
    };
  }
}

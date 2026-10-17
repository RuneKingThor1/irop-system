const fields = foundry.data.fields;

/**
 * A Threat Codex page (Johnald, 2026-10-17): an enemy's file, linked to its NPC actor. See
 * rules/codex.mjs. `known` is the copy of what players may see, rewritten by the GM's client
 * whenever something is revealed or the enemy changes.
 */
export class CodexPageData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    const flag = () => new fields.BooleanField({ initial: false });
    return {
      // The NPC actor this file is about, by UUID.
      actor: new fields.StringField({ required: true, blank: true, initial: "" }),
      // A picture of the GM's choosing, in place of the actor's (blank: the actor's).
      img: new fields.FilePathField({ required: false, blank: true, initial: "", categories: ["IMAGE"] }),
      // Sections revealed whole, and the GM's field notes.
      reveal: new fields.SchemaField({
        classification: flag(), attributes: flag(), vitals: flag(), defenses: flag(), paraphysics: flag(), lore: flag()
      }),
      // Weapons, perks and mutations revealed, by item id.
      items: new fields.ArrayField(new fields.StringField({ blank: false })),
      // The GM's field notes, written on the page.
      lore: new fields.HTMLField({ required: true, blank: true }),
      // What players see: the art, and the revealed facts only.
      art: new fields.StringField({ required: true, blank: true, initial: "" }),
      known: new fields.ObjectField({ required: true, initial: {} })
    };
  }
}

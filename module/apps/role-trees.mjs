import { IROP } from "../config.mjs";
import { roleTreesContext } from "../sheets/item-sheet.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * A role's perk trees in a window of their own (Johnald, 2026-10-17): a middle click on a role in the
 * enlistment terminal shows its Primary and specializations, laid out as the role sheet's Perk trees
 * tab. Read only; a perk's text opens in a dialog, so a player needs no permission on the ability.
 */
export class RoleTreesViewer extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-role-trees",
    classes: ["irop", "irop-role-trees"],
    window: { title: "Perk trees", icon: "fa-solid fa-sitemap", resizable: true },
    position: { width: 760, height: 640 },
    actions: {
      roleTree: RoleTreesViewer.#onTree,
      openTreePerk: RoleTreesViewer.#onPerk,
      openTree: RoleTreesViewer.#onOpenTree
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/item/role-trees.hbs", scrollable: [""] }
  };

  static #instance = null;

  /** The role shown, and its tree on show. */
  role = null;
  tree = "";

  /** Show a role's trees (one window, reused). */
  static show(role) {
    this.#instance ??= new this();
    const app = this.#instance;
    if ( app.role?.id !== role.id ) app.tree = "";
    app.role = role;
    return app.render({ force: true, window: { title: `${role.name}: perk trees` } });
  }

  /** @override */
  async _prepareContext(options) {
    return {
      roleTrees: this.role ? roleTreesContext(this.role, this.tree) : [],
      isGM: !!game.user?.isGM,
      // The template is a sheet tab; here it is the whole window.
      tab: { cssClass: "active" }
    };
  }

  /** The role's color, as on its sheet. @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const color = IROP.roles[this.role?.system?.role]?.color;
    if ( color ) this.element.style.setProperty("--irop-accent", color);
  }

  static #onTree(event, target) {
    this.tree = target.dataset.treeId;
    for ( const el of this.element.querySelectorAll("[data-tree-id]") ) el.classList.toggle("active", el.dataset.treeId === this.tree);
  }

  /** A perk's text, in a dialog. */
  static async #onPerk(event, target) {
    const ability = target.dataset.uuid ? await foundry.utils.fromUuid(target.dataset.uuid) : null;
    if ( !ability ) return ui.notifications.warn("That perk's ability is missing from the world. The GM can fix the tree.");
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    const text = await TextEditor.enrichHTML(ability.system.description ?? "", { relativeTo: ability });
    const needs = ability.system.prerequisites ? `<p class="hint">Needs ${foundry.utils.escapeHTML(ability.system.prerequisites)}</p>` : "";
    return DialogV2.prompt({
      window: { title: ability.name },
      classes: ["irop", "irop-roll-dialog", "irop-perk-dialog"],
      content: `<div class="irop-dialog perk-view">${needs}<div class="perk-description">${text || "<p>No description yet.</p>"}</div></div>`,
      ok: { label: "Close" }
    });
  }

  /** GM: open the tree itself, to edit. */
  static #onOpenTree(event, target) {
    if ( !game.user.isGM ) return null;
    return game.items?.get(target.dataset.treeId)?.sheet.render({ force: true });
  }
}

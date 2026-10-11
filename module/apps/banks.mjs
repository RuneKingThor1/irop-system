import { BANK_CAP } from "../rules/dynosrs.mjs";
import { getGmBanks, adjustGmBanks, getSquad, setSquad } from "../settings.mjs";
import { startSession, endSession } from "../rolls.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The operatives a drop brings in: one operative actor, or every operative in a
 * dropped folder of actors. Compendium actors are refused, since the squad holds
 * world actors.
 * @param {object} data    The parsed drag data
 * @returns {Promise<{actors: Actor[], warning?: string}>}
 */
export async function operativesFromDrop(data) {
  if ( !["Actor", "Folder"].includes(data?.type) || !data.uuid ) return { actors: [] };
  const doc = await foundry.utils.fromUuid(data.uuid);
  if ( !doc ) return { actors: [] };
  if ( data.type === "Folder" ) {
    if ( doc.type !== "Actor" ) return { actors: [] };
    const actors = doc.contents.filter(a => a.type === "operative");
    return actors.length ? { actors } : { actors, warning: `${doc.name} holds no operatives.` };
  }
  if ( doc.pack ) return { actors: [], warning: "Import the operative into the world before deploying it." };
  if ( doc.type !== "operative" ) return { actors: [], warning: "Only operatives deploy on a mission." };
  return { actors: [doc] };
}

/**
 * The DYNOSRS economy at a glance: the GM's Danger and Defeat, and the deployed
 * squad's Edge and Victory, with session start and end.
 *
 * RULED 2026-10-07: the squad is only the operatives on this mission. The GM
 * drags them in from the Actors sidebar (one at a time, or a whole folder) and
 * stands them down with the x on their row or at the end of the session.
 * Players can open it to see the squad's banks; only the GM can change the GM
 * banks or the squad.
 */
export class BanksApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "irop-banks",
    classes: ["irop", "irop-banks"],
    window: { title: "Banks: Edge, Danger, Victory, Defeat", icon: "fa-solid fa-scale-balanced", resizable: true },
    position: { width: 440, height: "auto" },
    actions: {
      gm: BanksApp.#onAdjustGm,
      operative: BanksApp.#onAdjustOperative,
      standDown: BanksApp.#onStandDown,
      start: BanksApp.#onStart,
      end: BanksApp.#onEnd
    }
  };

  /** @override */
  static PARTS = {
    body: { template: "systems/irop/templates/apps/banks.hbs" }
  };

  static #instance;

  /** Open the window, reusing it if already open. */
  static open() {
    this.#instance ??= new this();
    return this.#instance.render({ force: true });
  }

  /** Re-render if open. */
  static refresh() {
    if ( this.#instance?.rendered ) this.#instance.render();
  }

  /** @override */
  async _prepareContext(options) {
    const banks = getGmBanks();
    const operatives = getSquad()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(a => ({
        id: a.id, name: a.name, img: a.img, canEdit: a.isOwner,
        edge: a.system.banks.edge, victory: a.system.banks.victory,
        edgePips: Array.from({ length: BANK_CAP.EDGE }, (_, i) => i < a.system.banks.edge),
        victoryPips: Array.from({ length: BANK_CAP.VICTORY }, (_, i) => i < a.system.banks.victory)
      }));
    return {
      isGM: game.user.isGM,
      danger: banks.danger,
      defeat: banks.defeat,
      dangerPips: Array.from({ length: BANK_CAP.DANGER }, (_, i) => i < banks.danger),
      defeatPips: Array.from({ length: BANK_CAP.DEFEAT }, (_, i) => i < banks.defeat),
      operatives,
      squadVictory: operatives.some(o => o.victory > 0)
    };
  }

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if ( !game.user.isGM ) return;
    // The whole body takes drops; it is rebuilt on every render, so listeners never pile up.
    const body = this.element.querySelector(".banks-body");
    if ( !body ) return;
    body.addEventListener("dragover", event => {
      event.preventDefault();
      body.classList.add("drag-over");
    });
    body.addEventListener("dragleave", event => {
      if ( !body.contains(event.relatedTarget) ) body.classList.remove("drag-over");
    });
    body.addEventListener("drop", event => this.#onDrop(event, body));
  }

  /** Deploy the dropped operative, or every operative in a dropped folder. */
  async #onDrop(event, body) {
    event.preventDefault();
    body.classList.remove("drag-over");
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    }
    catch {
      return;
    }
    const { actors, warning } = await operativesFromDrop(data);
    if ( warning ) ui.notifications.warn(warning);
    if ( !actors.length ) return;
    const ids = getSquad().map(a => a.id);
    return setSquad([...ids, ...actors.map(a => a.id)]);
  }

  static async #onAdjustGm(event, target) {
    const { bank, delta } = target.dataset;
    return adjustGmBanks({ [bank]: Number(delta) });
  }

  static async #onAdjustOperative(event, target) {
    const actor = game.actors.get(target.closest("[data-actor-id]")?.dataset.actorId);
    if ( !actor?.isOwner ) return;
    const { bank, delta } = target.dataset;
    const cap = bank === "edge" ? BANK_CAP.EDGE : BANK_CAP.VICTORY;
    const next = Math.max(0, Math.min(cap, actor.system.banks[bank] + Number(delta)));
    return actor.update({ [`system.banks.${bank}`]: next });
  }

  /** Take one operative off the squad. Its banks are left as they are. */
  static async #onStandDown(event, target) {
    if ( !game.user.isGM ) return;
    const id = target.closest("[data-actor-id]")?.dataset.actorId;
    return setSquad(getSquad().map(a => a.id).filter(i => i !== id));
  }

  static async #onStart(event) {
    return startSession({ perCharacter: event.shiftKey });
  }

  static async #onEnd() {
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "End session" },
      content: "<p>Reset every Edge, Danger, Victory and Defeat bank to 0.</p>"
        + "<p>Stand the squad down too, or keep it deployed for a mission that runs into the next session?</p>",
      buttons: [
        { action: "standDown", label: "End and stand down", icon: "fa-solid fa-flag-checkered", default: true },
        { action: "keep", label: "End, keep the squad", icon: "fa-solid fa-users" },
        { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    if ( (choice === "standDown") || (choice === "keep") ) return endSession({ standDown: choice === "standDown" });
  }
}

/** Add a Banks button to the Actors sidebar header. */
export function addBanksButton(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const actions = root?.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".irop-banks-button") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "irop-banks-button";
  button.innerHTML = `<i class="fa-solid fa-scale-balanced"></i> Banks`;
  button.addEventListener("click", () => BanksApp.open());
  actions.append(button);
}

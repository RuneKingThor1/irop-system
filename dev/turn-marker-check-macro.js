// Turn marker check (2026-10-11). A GM script macro: run it while a combat has a token on its turn.
// It lists what the system sees of that token's marker. Copy the lines it shows back to Claude, and
// say what color the marker is on the map.
const token = game.combat?.combatant?.token?.object;
if ( !token ) {
  ui.notifications.warn("Start a combat and give a token its turn first: the check looks at that token's marker.");
}
else {
  const tm = game.irop?.turnMarker;
  const mesh = token.turnMarker?.mesh;
  const Colorize = foundry.canvas.rendering.shaders.ColorizeBrightnessShader;
  const hex = n => (Number.isFinite(n) ? `#${n.toString(16).padStart(6, "0")}` : String(n));
  const chain = [];
  for ( let c = token.constructor; c && (chain.length < 6); c = Object.getPrototypeOf(c) ) chain.push(c.name || "?");
  let watching = false;
  for ( let l = canvas.app.ticker._head?.next; l; l = l.next ) {
    if ( tm && ((l.fn ?? l._fn) === tm.sync) ) watching = true;
  }
  const facts = {
    "system version": game.system.version,
    "system marker code": tm ? "loaded" : "missing",
    "token classes": chain.join(" < "),
    "GM marker settings": JSON.stringify(CONFIG.Combat.settings.turnMarker),
    "token marker settings": JSON.stringify(token.document.turnMarker),
    "fallback image": CONFIG.Combat.fallbackTurnMarker,
    "marker drawn": `${!!token.turnMarker}, mesh ${mesh ? (mesh.destroyed ? "destroyed" : "live") : "none"}`,
    "shader": `${mesh?.shader?.constructor?.name ?? "none"}${(mesh?.shader instanceof Colorize) ? " (tints by side)" : ""}`,
    "tint now": mesh ? hex(mesh.tint) : "none",
    "tint wanted": tm ? hex(tm.tint(token)) : "unknown",
    "side color": hex(token.getDispositionColor()),
    "sync each frame": String(watching),
    "markers listed": String(canvas.tokens.turnMarkers?.size ?? "none")
  };
  console.log("irop | turn marker check", facts);
  const text = Object.entries(facts).map(([k, v]) => `${k}: ${v}`).join("\n")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await foundry.applications.api.DialogV2.prompt({
    window: { title: "Turn marker check" },
    content: `<p>What color is the marker under the token on the map right now?</p>
      <textarea readonly rows="15" style="width:100%;font-family:monospace;font-size:12px">${text}</textarea>`,
    ok: { label: "Close" },
    rejectClose: false
  });
}

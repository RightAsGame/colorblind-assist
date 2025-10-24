/**
 * Colorblind Assist for Foundry VTT
 * Adds color-blind filters, high-contrast token outlines,
 * and accessible black-and-white ping indicators.
 * Tested on Foundry v11–v13.32x
 */

const MOD_ID = "colorblind-assist";

/* --------------------------------------------------------------------------------
 *  Load Confirmation
 * -------------------------------------------------------------------------------- */
Hooks.once("ready", () => {
  ChatMessage.create({
    content: `<b style="color:#00cc99;">✅ Colorblind Assist module loaded successfully.</b>`,
    whisper: ChatMessage.getWhisperRecipients("GM")
  });
});

/* --------------------------------------------------------------------------------
 *  Filter Presets
 * -------------------------------------------------------------------------------- */
const PRESETS = {
  none: { name: "None", matrix: [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0] },
  protanopia: { name: "Protanopia", matrix: [0.567,0.433,0,0,0, 0.558,0.442,0,0,0, 0,0.242,0.758,0,0, 0,0,0,1,0] },
  deuteranopia:{ name:"Deuteranopia",matrix:[0.625,0.375,0,0,0, 0.7,0.3,0,0,0, 0,0.3,0.7,0,0, 0,0,0,1,0]},
  tritanopia:{ name:"Tritanopia",matrix:[0.95,0.05,0,0,0, 0,0.433,0.567,0,0, 0,0.475,0.525,0,0, 0,0,0,1,0]}
};

/* --------------------------------------------------------------------------------
 *  State
 * -------------------------------------------------------------------------------- */
let _filter = null;
let _uiAugment = true;
let _ringScale = 1.1;

/* --------------------------------------------------------------------------------
 *  INIT
 * -------------------------------------------------------------------------------- */
Hooks.once("init", () => {
  console.log("Colorblind Assist | Registering settings");

  game.settings.register(MOD_ID, "preset", {
    name: "Colorblind Filter Preset",
    hint: "Choose a preset similar to World of Warcraft’s color-blind filters.",
    scope: "client",
    config: true,
    type: String,
    default: "none",
    choices: {
      none: "None",
      protanopia: "Protanopia",
      deuteranopia: "Deuteranopia",
      tritanopia: "Tritanopia"
    },
    onChange: applyFilters
  });

  game.settings.register(MOD_ID, "strength", {
    name: "Filter Strength",
    hint: "How strong the filter should be (0–100).",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 1 },
    default: 50,
    onChange: applyFilters
  });

  game.settings.register(MOD_ID, "uiAugment", {
    name: "Token Ring Overlay",
    hint: "Add black-and-white textured rings for controlled / targeted tokens.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: toggleUiAugment
  });

  game.settings.register(MOD_ID, "accessiblePingOverlay", {
    name: "Accessible Ping Overlay",
    hint: "Show black-and-white arrows around any ping (per viewer).",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
});

/* --------------------------------------------------------------------------------
 *  READY
 * -------------------------------------------------------------------------------- */
Hooks.once("ready", () => {
  ui.notifications.info("Colorblind Assist loaded!");
  applyFilters();
  if (game.settings.get(MOD_ID, "uiAugment")) enableUiAugment();
});

/* --------------------------------------------------------------------------------
 *  FILTER LOGIC
 * -------------------------------------------------------------------------------- */
function applyFilters() {
  if (!canvas?.app) return;
  const key = game.settings.get(MOD_ID, "preset");
  const s = game.settings.get(MOD_ID, "strength");
  if (_filter) removeStageFilter(_filter);
  if (key === "none" || s <= 0) return;

  const mat = PRESETS[key].matrix.map(
    (v, i) => PRESETS.none.matrix[i] + (v - PRESETS.none.matrix[i]) * s / 100
  );

  const ColorMatrix =
    PIXI.ColorMatrixFilter ??
    PIXI.filters.ColorMatrixFilter ??
    PIXI.filters.ColorMatrixFilterDeprecated;

  _filter = new ColorMatrix();
  _filter.matrix = mat;
  addStageFilter(_filter);
}

function addStageFilter(f) {
  const st = canvas.app.stage;
  const arr = st.filters ?? [];
  if (!arr.includes(f)) {
    arr.push(f);
    st.filters = arr;
  }
}
function removeStageFilter(f) {
  const st = canvas.app.stage;
  const arr = st.filters ?? [];
  st.filters = arr.filter(x => x !== f) || null;
}

/* --------------------------------------------------------------------------------
 *  TOKEN UI AUGMENT
 * -------------------------------------------------------------------------------- */
function toggleUiAugment(v) { _uiAugment = v; v ? enableUiAugment() : disableUiAugment(); }

function enableUiAugment() {
  decorateAllTokens();
  Hooks.on("controlToken", onControlToken);
  Hooks.on("targetToken", onTargetToken);
  Hooks.on("canvasReady", decorateAllTokens);
}
function disableUiAugment() {
  for (const t of canvas.tokens.placeables) removeDecoration(t);
  Hooks.off("controlToken", onControlToken);
  Hooks.off("targetToken", onTargetToken);
  Hooks.off("canvasReady", decorateAllTokens);
}

function decorateAllTokens() {
  if (!canvas?.tokens) return;
  for (const t of canvas.tokens.placeables) decorateToken(t);
}
function onControlToken(t, c) { if (_uiAugment) updateDecoration(t, c, t.isTargeted); }
function onTargetToken(u, t, tar) { if (_uiAugment) updateDecoration(t, t.controlled, tar); }

function decorateToken(t) {
  if (!t.cba) t.cba = {};
  if (!t.cba.ring) {
    t.sortableChildren = true;
    t.cba.ring = new PIXI.Graphics();
    t.cba.ring.zIndex = 9999;
    t.addChild(t.cba.ring);
  }
  t.on("destroyed", () => removeDecoration(t));
  updateDecoration(t, t.controlled, t.isTargeted);
}
function removeDecoration(t) {
  try {
    if (t?.cba?.ring) { t.removeChild(t.cba.ring); t.cba.ring.destroy(true); }
    t.cba = null;
  } catch (e) {}
}
function updateDecoration(token, isControlled, isTargeted) {
  if (!token?.cba?.ring) return;
  const active = isControlled || isTargeted;
  const g = token.cba.ring;
  g.visible = active;
  g.clear();
  if (!active) return;

  const cx = token.w / 2, cy = token.h / 2, baseR = Math.max(token.w, token.h) / 2 * _ringScale;

  g.lineStyle({ width: 6, color: 0x000000, alignment: 0.5 });
  g.drawCircle(cx, cy, baseR);

  if (isControlled) {
    const r = baseR * 0.92;
    g.lineStyle({ width: 3, color: 0xffffff, alignment: 0.5 });
    g.drawCircle(cx, cy, r);
    const count = 24, size = 4;
    g.beginFill(0x000000);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * 2 * Math.PI, dx = cx + r * Math.cos(a), dy = cy + r * Math.sin(a);
      g.moveTo(dx, dy - size / 2);
      g.lineTo(dx + size / 2, dy);
      g.lineTo(dx, dy + size / 2);
      g.lineTo(dx - size / 2, dy);
      g.lineTo(dx, dy - size / 2);
    }
    g.endFill();
  }

  if (isTargeted) {
    g.lineStyle({ width: 3, color: 0xffffff, alignment: 0.5 });
    drawDashedCircle(g, cx, cy, baseR * 1.05, 12, 8);
  }
}
function drawDashedCircle(g, x, y, r, dash = 12, gap = 8) {
  const c = 2 * Math.PI * r, step = ((dash + gap) / c) * 2 * Math.PI;
  for (let t = 0; t < 2 * Math.PI; t += step) {
    const t2 = t + (dash / c) * 2 * Math.PI;
    g.moveTo(x + r * Math.cos(t), y + r * Math.sin(t));
    g.arc(x, y, r, t, t2);
  }
}

/* --------------------------------------------------------------------------------
 *  ACCESSIBLE PING OVERLAY (anchored, world-aligned, pulse + spin)
 *  - Matches your previously working pointer-hold approach
 *  - Draws at the correct world coords (no drift)
 *  - Uses PIXI.Ticker.shared like your working build
 *  - Adds smooth, time-based rotation (no delta dependence)
 * -------------------------------------------------------------------------------- */
(function attachPingOverlayPointerHold() {
  Hooks.once("ready", () => {
    console.log("Colorblind Assist | Pointer-hold ping listener active (spin enabled)");
    let holdTimer = null;

    // Detect long left-clicks like Foundry's ping gesture
    canvas.stage.on("pointerdown", (event) => {
      // Respect the per-viewer setting
      if (!game.settings.get(MOD_ID, "accessiblePingOverlay")) return;
      // Left button only
      if (event.data.button !== 0) return;

      // Foundry's ping threshold ~250ms; use 300ms for clarity
      holdTimer = setTimeout(() => {
        // Convert screen -> world so it stays fixed when zoom/pan
        const global = event.data.global;
        const world = canvas.stage.worldTransform.applyInverse(global);
        drawAccessiblePingArrows(world.x, world.y);
      }, 300);
    });

    const cancelHold = () => {
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
    };
    canvas.stage.on("pointerup", cancelHold);
    canvas.stage.on("pointerupoutside", cancelHold);
  });

  function drawAccessiblePingArrows(x, y) {
    const g = new PIXI.Graphics();
    const size = 25;

    // Draw four arrowheads around local origin (0,0)
    g.lineStyle({ width: 4, color: 0x000000, alignment: 0.5 });
    g.beginFill(0xffffff);
    const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
    for (const [dx, dy] of dirs) {
      const cx = dx * size * 1.5;
      const cy = dy * size * 1.5;
      g.moveTo(cx, cy);
      g.lineTo(cx + dx * size, cy + dy * size);
      g.lineTo(cx + dy * size * 0.6, cy - dx * size * 0.6);
      g.lineTo(cx - dy * size * 0.6, cy + dx * size * 0.6);
      g.lineTo(cx + dx * size, cy + dy * size);
    }
    g.endFill();

    // Anchor graphic at the ping point so scale/rotation are centered
    g.position.set(x, y);
    g.pivot.set(0, 0);
    canvas.effects.addChild(g);

    // Animation params (match Foundry-ish lifetime)
    const duration = 2000;              // ms visible
    const spinSpeed = Math.PI * 2;      // rad/sec (360°/s)
    const start = performance.now();

    // Use absolute time for rotation (no delta dependence)
    const animate = () => {
      const elapsed = performance.now() - start;
      const t = elapsed / duration;

      if (t >= 1) {
        PIXI.Ticker.shared.remove(animate);
        g.destroy();
        return;
      }

      // Smooth pulse (in place)
      const pulse = 1 + 0.1 * Math.sin(t * Math.PI * 2);
      g.scale.set(pulse);

      // Time-based rotation (anchored, no drift)
      g.rotation = (elapsed / 1000) * spinSpeed;

      // Fade out toward the end
      g.alpha = 1 - t;
    };

    PIXI.Ticker.shared.add(animate);
  }
})();

/**
 * Colorblind Assist for Foundry VTT
 * Adds color-blind filters, high-contrast token outlines,
 * and accessible black-and-white ping indicators.
 * Verified on Foundry VTT 13.351
 */

const MOD_ID = "colorblind-assist";
const STATUS_SETTING = "lastStatusNoticeVersion";
const DISPOSITION_ALWAYS_VISIBLE_SETTING = "dispositionAlwaysVisible";
const LEGACY_DISPOSITION_MODE_SETTING = "dispositionIndicatorMode";
const DISPOSITION_ICON_VERSION = "1.0.5";
const TOKEN_DISPOSITIONS = CONST.TOKEN_DISPOSITIONS ?? {};
const dispositionIconPath = (name) => `modules/colorblind-assist/assets/disposition/${name}.svg?v=${DISPOSITION_ICON_VERSION}`;
const DISPOSITION_ICON_PATHS = {
  [TOKEN_DISPOSITIONS.FRIENDLY ?? 1]: dispositionIconPath("friendly"),
  [TOKEN_DISPOSITIONS.NEUTRAL ?? 0]: dispositionIconPath("neutral"),
  [TOKEN_DISPOSITIONS.HOSTILE ?? -1]: dispositionIconPath("hostile"),
  [TOKEN_DISPOSITIONS.SECRET ?? -2]: dispositionIconPath("secret"),
  1: dispositionIconPath("friendly"),
  0: dispositionIconPath("neutral"),
  "-1": dispositionIconPath("hostile"),
  "-2": dispositionIconPath("secret")
};

let stageFilter = null;
let uiAugmentHooksRegistered = false;
const ringScale = 1.1;

const PRESETS = {
  none: { name: "None", matrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0] },
  protanopia: { name: "Protanopia", matrix: [0.567, 0.433, 0, 0, 0, 0.558, 0.442, 0, 0, 0, 0, 0.242, 0.758, 0, 0, 0, 0, 0, 1, 0] },
  deuteranopia: { name: "Deuteranopia", matrix: [0.625, 0.375, 0, 0, 0, 0.7, 0.3, 0, 0, 0, 0, 0.3, 0.7, 0, 0, 0, 0, 0, 1, 0] },
  tritanopia: { name: "Tritanopia", matrix: [0.95, 0.05, 0, 0, 0, 0, 0.433, 0.567, 0, 0, 0, 0.475, 0.525, 0, 0, 0, 0, 0, 1, 0] }
};

Hooks.once("init", () => {
  console.log("Colorblind Assist | Registering settings");

  game.settings.register(MOD_ID, STATUS_SETTING, {
    name: "Load Status Notice Version",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MOD_ID, "preset", {
    name: "Colorblind Filter Preset",
    hint: "Choose a preset similar to World of Warcraft's color-blind filters.",
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
    hint: "How strong the filter should be (0-100).",
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
    onChange: refreshTokenDecorationState
  });

  game.settings.register(MOD_ID, "accessiblePingOverlay", {
    name: "Accessible Ping Overlay",
    hint: "Show black-and-white arrows around any ping (per viewer).",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MOD_ID, LEGACY_DISPOSITION_MODE_SETTING, {
    name: "Disposition Icon Display",
    scope: "client",
    config: false,
    type: String,
    default: "hover"
  });

  game.settings.register(MOD_ID, DISPOSITION_ALWAYS_VISIBLE_SETTING, {
    name: "Always Show Disposition Icons",
    hint: "Show the lower-left token disposition icon at all times. When unchecked, it appears on token mouse-over.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: refreshTokenDecorationState
  });
});

Hooks.once("ready", async () => {
  try {
    await migrateDispositionVisibilitySetting();
    applyFilters();
    refreshTokenDecorationState();
    notifyGmLoadStatus("loaded successfully", "info");
  } catch (error) {
    console.error("Colorblind Assist | Module startup failed", error);
    notifyGmLoadStatus(`failed to start: ${error.message}`, "error");
  }
});

async function notifyGmLoadStatus(message, level) {
  if (!game.user?.isGM) return;

  const version = game.modules.get(MOD_ID)?.version ?? "unknown";
  const noticeKey = `${version}:${level}`;
  const lastNotice = game.settings.get(MOD_ID, STATUS_SETTING);

  if (lastNotice === noticeKey) return;

  const content = level === "error"
    ? `<b style="color:#cc3333;">Colorblind Assist ${message}.</b>`
    : `<b style="color:#00cc99;">Colorblind Assist ${message}.</b>`;

  await ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients("GM")
  });

  await game.settings.set(MOD_ID, STATUS_SETTING, noticeKey);
}

function applyFilters() {
  if (!canvas?.app?.stage) return;

  const key = game.settings.get(MOD_ID, "preset");
  const strength = game.settings.get(MOD_ID, "strength");

  if (stageFilter) removeStageFilter(stageFilter);
  if (key === "none" || strength <= 0) return;

  const preset = PRESETS[key];
  if (!preset) return;

  const matrix = preset.matrix.map((value, index) => {
    const base = PRESETS.none.matrix[index];
    return base + ((value - base) * strength / 100);
  });

  const ColorMatrixFilterClass =
    PIXI.ColorMatrixFilter ??
    PIXI.filters?.ColorMatrixFilter ??
    PIXI.filters?.ColorMatrixFilterDeprecated;

  if (!ColorMatrixFilterClass) {
    console.warn("Colorblind Assist | No compatible ColorMatrixFilter class was found.");
    return;
  }

  stageFilter = new ColorMatrixFilterClass();
  stageFilter.matrix = matrix;
  addStageFilter(stageFilter);
}

function addStageFilter(filter) {
  const stage = canvas.app.stage;
  const filters = stage.filters ?? [];

  if (!filters.includes(filter)) {
    filters.push(filter);
    stage.filters = filters;
  }
}

function removeStageFilter(filter) {
  const stage = canvas.app.stage;
  const filters = stage.filters ?? [];
  const nextFilters = filters.filter((entry) => entry !== filter);
  stage.filters = nextFilters.length ? nextFilters : null;
  if (stageFilter === filter) stageFilter = null;
}

function enableUiAugment() {
  if (uiAugmentHooksRegistered) {
    decorateAllTokens();
    return;
  }

  uiAugmentHooksRegistered = true;
  decorateAllTokens();
  Hooks.on("controlToken", onControlToken);
  Hooks.on("targetToken", onTargetToken);
  Hooks.on("canvasReady", decorateAllTokens);
}

function disableUiAugment() {
  if (!uiAugmentHooksRegistered) return;

  uiAugmentHooksRegistered = false;
  for (const token of canvas?.tokens?.placeables ?? []) removeDecoration(token);
  Hooks.off("controlToken", onControlToken);
  Hooks.off("targetToken", onTargetToken);
  Hooks.off("canvasReady", decorateAllTokens);
}

function decorateAllTokens() {
  if (!canvas?.tokens) return;
  for (const token of canvas.tokens.placeables) decorateToken(token);
}

function onControlToken(token, controlled) {
  updateDecoration(token, controlled, token.isTargeted);
}

function onTargetToken(_user, token, targeted) {
  updateDecoration(token, token.controlled, targeted);
}

function decorateToken(token) {
  if (!token.cba) token.cba = {};

  if (!token.cba.ring) {
    token.sortableChildren = true;
    token.cba.ring = new PIXI.Graphics();
    token.cba.ring.zIndex = 9999;
    token.addChild(token.cba.ring);
  }

  if (!token.cba.dispositionIcon) {
    token.cba.dispositionIcon = PIXI.Sprite.from(getDispositionIconPath(token));
    token.cba.dispositionIconPath = getDispositionIconPath(token);
    token.cba.dispositionIcon.zIndex = 10000;
    token.cba.dispositionIcon.alpha = 0.96;
    token.addChild(token.cba.dispositionIcon);
  }

  if (!token.cba.destroyHandler) {
    token.cba.destroyHandler = () => removeDecoration(token);
    token.on("destroyed", token.cba.destroyHandler);
  }

  updateDecoration(token, token.controlled, token.isTargeted, token.hover);
}

function removeDecoration(token) {
  try {
    if (token?.cba?.destroyHandler) token.off("destroyed", token.cba.destroyHandler);
    if (token?.cba?.ring) {
      token.removeChild(token.cba.ring);
      token.cba.ring.destroy(true);
    }
    if (token?.cba?.dispositionIcon) {
      token.removeChild(token.cba.dispositionIcon);
      token.cba.dispositionIcon.destroy();
    }
    token.cba = null;
  } catch (_error) {}
}

function updateDecoration(token, isControlled, isTargeted, isHovered = token?.hover) {
  if (!token?.cba?.ring) return;

  const ringEnabled = game.settings.get(MOD_ID, "uiAugment");
  const active = isControlled || isTargeted;
  const graphics = token.cba.ring;
  graphics.visible = ringEnabled && active;
  graphics.clear();

  if (ringEnabled && active) {
    const centerX = token.w / 2;
    const centerY = token.h / 2;
    const baseRadius = Math.max(token.w, token.h) / 2 * ringScale;

    graphics.lineStyle({ width: 6, color: 0x000000, alignment: 0.5 });
    graphics.drawCircle(centerX, centerY, baseRadius);

    if (isControlled) {
      graphics.lineStyle({ width: 3, color: 0xffffff, alignment: 0.5 });
      drawDashedCircle(graphics, centerX, centerY, baseRadius * 1.05, 12, 8);
    }

    if (isTargeted) drawReticleRing(graphics, centerX, centerY, baseRadius * 0.96);
  }

  updateDispositionIcon(token, isHovered);
}

function drawDashedCircle(graphics, x, y, radius, dash = 12, gap = 8) {
  const circumference = 2 * Math.PI * radius;
  const step = ((dash + gap) / circumference) * 2 * Math.PI;

  for (let theta = 0; theta < 2 * Math.PI; theta += step) {
    const endTheta = theta + (dash / circumference) * 2 * Math.PI;
    graphics.moveTo(x + radius * Math.cos(theta), y + radius * Math.sin(theta));
    graphics.arc(x, y, radius, theta, endTheta);
  }
}

function drawReticleRing(graphics, x, y, radius) {
  graphics.lineStyle({ width: 3, color: 0xffffff, alignment: 0.5 });
  graphics.drawCircle(x, y, radius);

  const tickCount = 4;
  const gapInset = 10;
  const tickLength = 14;

  for (let index = 0; index < tickCount; index += 1) {
    const angle = (index / tickCount) * 2 * Math.PI;
    const innerX = x + (radius - gapInset) * Math.cos(angle);
    const innerY = y + (radius - gapInset) * Math.sin(angle);
    const outerX = x + (radius + tickLength) * Math.cos(angle);
    const outerY = y + (radius + tickLength) * Math.sin(angle);
    graphics.moveTo(innerX, innerY);
    graphics.lineTo(outerX, outerY);
  }
}

function updateDispositionIcon(token, isHovered) {
  const icon = token?.cba?.dispositionIcon;
  if (!icon) return;

  const shouldShow = game.settings.get(MOD_ID, DISPOSITION_ALWAYS_VISIBLE_SETTING) || isHovered;
  const iconPath = getDispositionIconPath(token);

  if (token.cba.dispositionIconPath !== iconPath) {
    icon.texture = PIXI.Texture.from(iconPath);
    token.cba.dispositionIconPath = iconPath;
  }

  icon.visible = shouldShow;
  if (!shouldShow) return;

  const iconSize = Math.max(18, Math.min(64, Math.round(Math.min(token.w, token.h) * 0.32)));
  const padding = Math.max(4, Math.round(iconSize * 0.18));
  const offsetY = Math.max(10, Math.round(iconSize * 0.25));

  icon.width = iconSize;
  icon.height = iconSize;
  icon.position.set(padding, token.h - iconSize - offsetY);
}

function getDispositionIconPath(token) {
  return DISPOSITION_ICON_PATHS[token.document?.disposition] ?? DISPOSITION_ICON_PATHS[TOKEN_DISPOSITIONS.NEUTRAL ?? 0];
}

function refreshAllTokenDecorations() {
  for (const token of canvas?.tokens?.placeables ?? []) {
    decorateToken(token);
    updateDecoration(token, token.controlled, token.isTargeted, token.hover);
  }
}

function refreshTokenDecorationState() {
  shouldEnableTokenDecorations() ? enableUiAugment() : disableUiAugment();
  if (shouldEnableTokenDecorations()) refreshAllTokenDecorations();
}

function shouldEnableTokenDecorations() {
  return true;
}

async function migrateDispositionVisibilitySetting() {
  const legacyMode = game.settings.get(MOD_ID, LEGACY_DISPOSITION_MODE_SETTING);
  if (legacyMode !== "always") return;

  await game.settings.set(MOD_ID, DISPOSITION_ALWAYS_VISIBLE_SETTING, true);
  await game.settings.set(MOD_ID, LEGACY_DISPOSITION_MODE_SETTING, "hover");
}

(function attachDispositionIndicatorHooks() {
  Hooks.on("hoverToken", (token, hovered) => {
    if (!uiAugmentHooksRegistered) return;
    decorateToken(token);
    updateDecoration(token, token.controlled, token.isTargeted, hovered);
  });

  Hooks.on("refreshToken", (token) => {
    if (!uiAugmentHooksRegistered) return;
    decorateToken(token);
    updateDecoration(token, token.controlled, token.isTargeted, token.hover);
  });

  Hooks.on("updateToken", (document) => {
    if (!uiAugmentHooksRegistered) return;
    const token = document?.object;
    if (!token) return;
    decorateToken(token);
    updateDecoration(token, token.controlled, token.isTargeted, token.hover);
  });
})();

(function attachPingOverlayPointerHold() {
  Hooks.once("ready", () => {
    console.log("Colorblind Assist | Pointer-hold ping listener active (spin enabled)");
    let holdTimer = null;

    canvas.stage.on("pointerdown", (event) => {
      if (!game.settings.get(MOD_ID, "accessiblePingOverlay")) return;
      if (event.data.button !== 0) return;

      holdTimer = setTimeout(() => {
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
    const graphics = new PIXI.Graphics();
    const size = 25;

    graphics.lineStyle({ width: 4, color: 0x000000, alignment: 0.5 });
    graphics.beginFill(0xffffff);

    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dy] of directions) {
      const centerX = dx * size * 1.5;
      const centerY = dy * size * 1.5;
      graphics.moveTo(centerX, centerY);
      graphics.lineTo(centerX + dx * size, centerY + dy * size);
      graphics.lineTo(centerX + dy * size * 0.6, centerY - dx * size * 0.6);
      graphics.lineTo(centerX - dy * size * 0.6, centerY + dx * size * 0.6);
      graphics.lineTo(centerX + dx * size, centerY + dy * size);
    }

    graphics.endFill();
    graphics.position.set(x, y);
    graphics.pivot.set(0, 0);
    canvas.effects.addChild(graphics);

    const duration = 2000;
    const spinSpeed = Math.PI * 2;
    const start = performance.now();

    const animate = () => {
      const elapsed = performance.now() - start;
      const progress = elapsed / duration;

      if (progress >= 1) {
        PIXI.Ticker.shared.remove(animate);
        graphics.destroy();
        return;
      }

      const pulse = 1 + 0.1 * Math.sin(progress * Math.PI * 2);
      graphics.scale.set(pulse);
      graphics.rotation = (elapsed / 1000) * spinSpeed;
      graphics.alpha = 1 - progress;
    };

    PIXI.Ticker.shared.add(animate);
  }
})();

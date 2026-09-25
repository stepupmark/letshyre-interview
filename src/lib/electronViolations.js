// How each desktop-app violation is shown and handled, keyed by the `code` the
// app sends. An extra display is a strike on the normal violation limit;
// everything else ends the interview when the app marks it a hard block.

export const DISPLAY_IMAGE = "/hdmi-display.svg";
const WINDOW_IMAGE = "/window-switch.svg";

const electronCopy = (key) => ({
  key,
  titleKey: `violations.electron.${key}.title`,
  descriptionKey: `violations.electron.${key}.description`,
});

const BY_KEY = {
  blockedApp: electronCopy("blockedApp"),
  aiTool: electronCopy("aiTool"),
  overlay: electronCopy("overlay"),
  renamedApp: electronCopy("renamedApp"),
  externalDisplay: { ...electronCopy("externalDisplay"), strike: true, imagePath: DISPLAY_IMAGE },
  mirroredDisplay: { ...electronCopy("mirroredDisplay"), strike: true, imagePath: DISPLAY_IMAGE },
  screenSharing: { ...electronCopy("screenSharing"), imagePath: "/laptop.svg" },
  remoteSession: electronCopy("remoteSession"),
  virtualMachine: electronCopy("virtualMachine"),
  securityMonitor: electronCopy("securityMonitor"),
  windowAction: electronCopy("windowAction"),
  fullscreenExit: {
    key: "fullscreenExit",
    titleKey: "violations.fullscreenExit.title",
    descriptionKey: "violations.fullscreenExit.description",
  },
  generic: electronCopy("generic"),
};

const KEY_BY_CODE = {
  blocked_app: "blockedApp",
  ai_tool: "aiTool",
  overlay: "overlay",
  renamed_app: "renamedApp",
  external_display: "externalDisplay",
  mirrored_display: "mirroredDisplay",
  remote_session: "remoteSession",
  virtual_machine: "virtualMachine",
  suspicious_activity: "generic",
  agent_unreachable: "securityMonitor",
  check_unverified: "securityMonitor",
  window_minimize: "windowAction",
  close_attempt: "windowAction",
  fullscreen_exit: "fullscreenExit",
};

export const ELECTRON_IMAGES = [
  ...new Set(Object.values(BY_KEY).map(({ imagePath = WINDOW_IMAGE }) => imagePath)),
];

// Desktop builds from before codes only send English text.
export function getElectronViolationKey(event = "") {
  const e = String(event).toLowerCase();
  if (e.includes("could not be verified")) return "securityMonitor";
  if (e.includes("overlay")) return "overlay";
  if (e.includes("mirrored display")) return "mirroredDisplay";
  if (e.includes("hdmi") || e.includes("display")) return "externalDisplay";
  if (e.includes("mirror") || e.includes("sharing")) return "screenSharing";
  if (e.includes("agent") || e.includes("tamper")) return "securityMonitor";
  if (e.includes("fullscreen")) return "fullscreenExit";
  if (e.includes("minimize") || e.includes("close")) return "windowAction";
  if (e.includes("blocked application")) return "blockedApp";
  return "generic";
}

const PATH = /[A-Za-z]:\\[^'"]*|\/(?:Users|home)\/[^'"\s]*/g;

// Older desktop builds put the agent's raw finding in the text, file paths included.
export function redactEvent(event) {
  return typeof event === "string" ? event.replace(PATH, "[path]").slice(0, 300) : undefined;
}

function appNames(apps) {
  if (!Array.isArray(apps)) return [];
  return [...new Set(apps.filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim()))];
}

/**
 * Everything the interview needs about one desktop-app violation.
 * @param {object} payload - what `window.electronAPI.onViolation` delivered
 */
export function resolveElectronViolation(payload = {}) {
  const key = KEY_BY_CODE[payload.code] ?? getElectronViolationKey(payload.event);
  const copy = BY_KEY[key] ?? BY_KEY.generic;
  return {
    key: copy.key,
    type: `ELECTRON_${copy.key.toUpperCase()}`,
    titleKey: copy.titleKey,
    descriptionKey: copy.descriptionKey,
    imagePath: copy.imagePath ?? WINDOW_IMAGE,
    strike: copy.strike === true,
    apps: appNames(payload.apps),
    detail: {
      ...(typeof payload.code === "string" ? { code: payload.code } : {}),
      ...(typeof payload.category === "string" ? { electron_category: payload.category } : {}),
      ...(appNames(payload.apps).length ? { apps: appNames(payload.apps) } : {}),
      ...(typeof payload.id === "string" ? { electron_id: payload.id } : {}),
      ...(payload.redelivered ? { redelivered: true } : {}),
      event: redactEvent(payload.event),
      severity: payload.severity,
      electron_count: payload.count,
    },
  };
}

/** An extra display is a strike even when an older desktop build marks it a hard block. */
export function isElectronHardBlock(payload = {}) {
  return payload.isHardBlock === true && !resolveElectronViolation(payload).strike;
}

const SEEN_KEY = "electron_violations_seen";
const MAX_SEEN = 200;
let seenInMemory = [];

function readSeen() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(SEEN_KEY));
    return Array.isArray(stored) ? stored : seenInMemory;
  } catch {
    return seenInMemory;
  }
}

/**
 * The desktop app sends a violation again, same id, until it is acknowledged,
 * and after every page load. True only the first time an id is seen.
 */
export function firstDelivery(id) {
  if (typeof id !== "string" || !id) return true;
  const seen = readSeen();
  if (seen.includes(id)) return false;
  seenInMemory = [...seen, id].slice(-MAX_SEEN);
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(seenInMemory));
  } catch {
    // storage blocked: this page still remembers it
  }
  return true;
}

export function resetElectronDeliveries() {
  seenInMemory = [];
  try {
    sessionStorage.removeItem(SEEN_KEY);
  } catch {
    // nothing stored
  }
}

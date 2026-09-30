// Every code in KEY_BY_CODE (src/lib/electronViolations.js), with roughly what
// the desktop app sends for it, so the site sees realistic text.
const SAMPLES = {
  blocked_app: {
    category: "communication",
    apps: ["Discord"],
    event: "Blocked application running during interview: Discord",
  },
  ai_tool: { category: "ai_tools", apps: ["ChatGPT"], event: "AI assistant detected: ChatGPT" },
  overlay: { category: "agent", apps: ["Cluely"], event: "Transparent overlay window detected" },
  renamed_app: {
    category: "agent",
    apps: ["notepad.exe"],
    event: "Disguised application detected",
  },
  external_display: { category: "hdmi", event: "External display detected" },
  mirrored_display: {
    category: "hdmi",
    event: "Duplicate/mirrored display detected (2 physical monitors)",
  },
  remote_session: { category: "agent", apps: ["AnyDesk"], event: "Remote desktop session active" },
  virtual_machine: { category: "agent", event: "Virtual machine detected" },
  virtual_camera: {
    category: "agent",
    apps: ["OBS Virtual Camera"],
    event: "Virtual camera detected",
  },
  suspicious_activity: { category: null, event: "Suspicious activity detected" },
  agent_unreachable: { category: "agent", event: "Security agent not responding" },
  check_unverified: { category: "agent", event: "Security check could not be verified" },
  window_minimize: { category: null, event: "Window minimize attempt" },
  close_attempt: { category: null, event: "Window close attempt" },
  fullscreen_exit: { category: null, event: "Fullscreen exit detected" },
  focus_lost: { category: null, event: "Interview window lost focus" },
  virtual_desktop: { category: null, event: "Virtual desktop switch detected" },
};

export const VIOLATION_CODES = Object.keys(SAMPLES);

export const DEFAULT_DESKTOP_VERSION = "1.5.0";
export const DEVTOOLS_MARKER = "letshyre-devtools";

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `fake-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * A violation exactly as the desktop app pushes it. `hard` mirrors the app:
 * high severity and isHardBlock; soft is medium and not a hard block.
 */
export function buildViolation(code, { hard = false, count = 1, id = newId(), now } = {}) {
  const sample = SAMPLES[code] ?? { category: null, event: code };
  return {
    id,
    code,
    category: sample.category,
    apps: sample.apps ?? [],
    event: sample.event,
    severity: hard ? "high" : "medium",
    count,
    isHardBlock: hard,
    source: "electron",
    timestamp: new Date(now ?? Date.now()).toISOString(),
  };
}

export function redeliver(payload) {
  return { ...payload, redelivered: true };
}

/** The user agent the desktop app would send, with its version token swapped in or removed. */
export function desktopUserAgent(baseAgent, version) {
  const clean = String(baseAgent).replace(/\s*LetsHyreSecureInterview\/\S+/, "");
  return version ? `${clean} LetsHyreSecureInterview/${version}` : clean;
}

/**
 * A stand-in for the preload bridge. Every call the site makes is logged, and
 * `controls` lets the dev panel push events the way the app would.
 */
export function createFakeDesktop({ abortInterview = true, onLog } = {}) {
  const calls = [];
  const listeners = new Set();
  const handlers = { violation: null, started: null, error: null };
  const acked = new Set();
  const counts = new Map();
  let last = null;

  const log = (name, args = []) => {
    const entry = { at: new Date().toISOString(), name, args };
    calls.push(entry);
    onLog?.(entry);
    for (const listener of listeners) listener(entry);
  };

  const api = {
    onViolation(callback) {
      log("onViolation");
      handlers.violation = callback;
    },
    removeViolationListener() {
      log("removeViolationListener");
      handlers.violation = null;
    },
    acknowledgeViolation(id) {
      log("acknowledgeViolation", [id]);
      if (typeof id === "string") acked.add(id);
    },
    interviewComplete(reason) {
      log("interviewComplete", [reason]);
    },
    viewDashboard() {
      log("viewDashboard");
    },
    startProctoring(meta) {
      log("startProctoring", [meta]);
      setTimeout(() => handlers.started?.(), 50);
      return Promise.resolve({ ok: true });
    },
    stopProctoring() {
      log("stopProctoring");
    },
    onProctoringStarted(callback) {
      log("onProctoringStarted");
      handlers.started = callback;
    },
    onProctoringError(callback) {
      log("onProctoringError");
      handlers.error = callback;
    },
    getSupportContact() {
      log("getSupportContact");
      return Promise.resolve({ url: null, email: "support@example.com" });
    },
  };
  if (abortInterview) {
    api.abortInterview = (reason) => log("abortInterview", [reason]);
  }

  const push = (payload) => {
    last = payload;
    log("→ violation", [payload]);
    if (!handlers.violation) return false;
    handlers.violation(payload);
    return true;
  };

  const controls = {
    fire(code, { hard = false } = {}) {
      const count = (counts.get(code) ?? 0) + 1;
      counts.set(code, count);
      return push(buildViolation(code, { hard, count }));
    },
    redeliverLast() {
      if (!last) return false;
      return push(redeliver(last));
    },
    proctoringError(error = "Screen capture permission denied") {
      log("→ proctoringError", [{ error }]);
      handlers.error?.({ error });
    },
    isAcked: (id) => acked.has(id),
    get lastViolation() {
      return last;
    },
    get calls() {
      return [...calls];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get listening() {
      return Boolean(handlers.violation);
    },
  };

  return { api, controls };
}

const DESKTOP_KEY = "dev_fake_desktop";

/** `?desktop=fake` turns the fake desktop on for this tab, `?desktop=off` turns it off. */
export function readDesktopSettings(search, storage = sessionStorage) {
  const wanted = new URLSearchParams(search).get("desktop");
  if (wanted === "off") {
    storage.removeItem(DESKTOP_KEY);
    return null;
  }
  let saved;
  try {
    saved = JSON.parse(storage.getItem(DESKTOP_KEY));
  } catch {
    saved = null;
  }
  if (wanted !== "fake" && !saved) return null;
  const settings = { abortInterview: true, version: DEFAULT_DESKTOP_VERSION, ...saved };
  storage.setItem(DESKTOP_KEY, JSON.stringify(settings));
  return settings;
}

export function saveDesktopSettings(settings) {
  sessionStorage.setItem(DESKTOP_KEY, JSON.stringify(settings));
}

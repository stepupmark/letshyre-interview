import {
  DISPLAY_IMAGE,
  ELECTRON_IMAGES,
  firstDelivery,
  getElectronViolationKey,
  isElectronHardBlock,
  redactEvent,
  resetElectronDeliveries,
  resolveElectronViolation,
} from "./electronViolations";
import interviewEn from "@/i18n/locales/en/interview.json";

const valueAt = (path) => path.split(".").reduce((node, key) => node?.[key], interviewEn);

const CODES = [
  ["blocked_app", "blockedApp"],
  ["ai_tool", "aiTool"],
  ["overlay", "overlay"],
  ["renamed_app", "renamedApp"],
  ["external_display", "externalDisplay"],
  ["mirrored_display", "mirroredDisplay"],
  ["remote_session", "remoteSession"],
  ["virtual_machine", "virtualMachine"],
  ["suspicious_activity", "generic"],
  ["agent_unreachable", "securityMonitor"],
  ["check_unverified", "securityMonitor"],
  ["window_minimize", "windowAction"],
  ["close_attempt", "windowAction"],
  ["fullscreen_exit", "fullscreenExit"],
  ["focus_lost", "focusLost"],
  ["virtual_desktop", "virtualDesktop"],
];

describe("resolveElectronViolation", () => {
  it.each(CODES)("maps %s to %s with copy that exists", (code, key) => {
    const resolved = resolveElectronViolation({ code, event: "anything" });
    expect(resolved.key).toBe(key);
    expect(typeof valueAt(resolved.titleKey)).toBe("string");
    expect(typeof valueAt(resolved.descriptionKey)).toBe("string");
  });

  it("prefers the code over the text", () => {
    const resolved = resolveElectronViolation({
      code: "blocked_app",
      event: "External display detected",
    });
    expect(resolved.key).toBe("blockedApp");
  });

  it("only extra displays are strikes, both with the HDMI art", () => {
    const strikes = CODES.filter(([code]) => resolveElectronViolation({ code }).strike);
    expect(strikes.map(([code]) => code)).toEqual(["external_display", "mirrored_display"]);
    expect(resolveElectronViolation({ code: "external_display" }).imagePath).toBe(DISPLAY_IMAGE);
    expect(resolveElectronViolation({ code: "mirrored_display" }).imagePath).toBe(DISPLAY_IMAGE);
    expect(ELECTRON_IMAGES).toContain(DISPLAY_IMAGE);
  });

  it("keeps what the log needs and drops the rest", () => {
    const { apps, detail, type } = resolveElectronViolation({
      id: "a1",
      code: "blocked_app",
      category: "browser",
      apps: ["Google Chrome", "Google Chrome", "", 3],
      event: "Blocked application running during interview: Google Chrome",
      severity: "high",
      count: 1,
      redelivered: true,
    });
    expect(type).toBe("ELECTRON_BLOCKEDAPP");
    expect(apps).toEqual(["Google Chrome"]);
    expect(detail).toEqual({
      code: "blocked_app",
      electron_category: "browser",
      apps: ["Google Chrome"],
      electron_id: "a1",
      redelivered: true,
      event: "Blocked application running during interview: Google Chrome",
      severity: "high",
      electron_count: 1,
    });
  });
});

describe("getElectronViolationKey (desktop builds without codes)", () => {
  it.each([
    ["HDMI cable connected", "externalDisplay"],
    ["External display detected", "externalDisplay"],
    ["Duplicate/mirrored display detected (2 physical monitors)", "mirroredDisplay"],
    ["External display check could not be verified for 3 consecutive scans", "securityMonitor"],
    ["Screen mirroring active", "screenSharing"],
    ["Screen sharing detected", "screenSharing"],
    ["Security agent stopped", "securityMonitor"],
    ["Tamper detected", "securityMonitor"],
    ["Window minimize blocked", "windowAction"],
    ["Close attempt blocked", "windowAction"],
    ["Fullscreen exit attempt", "fullscreenExit"],
    ["Blocked application running during interview: Zoom", "blockedApp"],
    ["Suspicious transparent overlay detected: 'x.exe' (PID 1)", "overlay"],
    ["Something unexpected", "generic"],
    ["", "generic"],
  ])("maps %j to %j", (event, expected) => {
    expect(getElectronViolationKey(event)).toBe(expected);
  });
});

describe("leaving the window", () => {
  it("is only logged: the site's own focus tracking already strikes it", () => {
    for (const code of ["focus_lost", "virtual_desktop"]) {
      const resolved = resolveElectronViolation({ code });
      expect(resolved.logOnly).toBe(true);
      expect(resolved.strike).toBe(false);
      expect(isElectronHardBlock({ code, isHardBlock: true })).toBe(false);
    }
  });
});

describe("isElectronHardBlock", () => {
  it("follows the desktop app, except for an extra display", () => {
    expect(isElectronHardBlock({ code: "blocked_app", isHardBlock: true })).toBe(true);
    expect(isElectronHardBlock({ code: "overlay", isHardBlock: false })).toBe(false);
    expect(isElectronHardBlock({ code: "external_display", isHardBlock: true })).toBe(false);
    expect(isElectronHardBlock({ event: "External display detected", isHardBlock: true })).toBe(
      false,
    );
  });
});

describe("redactEvent", () => {
  it("removes file paths an older desktop build put in the text", () => {
    expect(
      redactEvent("AI tool detected (install path): 'p.exe' at 'C:\\Users\\alice\\p.exe' (PID 4)"),
    ).toBe("AI tool detected (install path): 'p.exe' at '[path]' (PID 4)");
    expect(redactEvent("Found /Users/alice/app")).toBe("Found [path]");
    expect(redactEvent(undefined)).toBeUndefined();
  });
});

describe("firstDelivery", () => {
  beforeEach(() => resetElectronDeliveries());

  it("is true once per id, and survives a reload through sessionStorage", () => {
    expect(firstDelivery("x")).toBe(true);
    expect(firstDelivery("x")).toBe(false);
    expect(JSON.parse(sessionStorage.getItem("electron_violations_seen"))).toEqual(["x"]);
    expect(firstDelivery("y")).toBe(true);
  });

  it("never drops a violation without an id", () => {
    expect(firstDelivery(undefined)).toBe(true);
    expect(firstDelivery(undefined)).toBe(true);
  });
});

describe("fix lines", () => {
  it.each([
    "blocked_app",
    "ai_tool",
    "overlay",
    "renamed_app",
    "external_display",
    "mirrored_display",
    "remote_session",
    "virtual_machine",
    "suspicious_activity",
    "agent_unreachable",
    "window_minimize",
    "fullscreen_exit",
  ])("tells the candidate what to do about %s", (code) => {
    const { fixKey } = resolveElectronViolation({ code });
    expect(typeof valueAt(fixKey)).toBe("string");
  });

  it("has one for screen sharing reported by an older build", () => {
    const { fixKey } = resolveElectronViolation({ event: "Screen sharing detected" });
    expect(typeof valueAt(fixKey)).toBe("string");
  });
});

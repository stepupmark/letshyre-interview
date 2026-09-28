import {
  buildViolation,
  createFakeDesktop,
  desktopUserAgent,
  readDesktopSettings,
  VIOLATION_CODES,
} from "./fakeDesktop";
import {
  isElectronHardBlock,
  resetElectronDeliveries,
  resolveElectronViolation,
} from "@/lib/electronViolations";
import { isOutdatedDesktop } from "@/lib/desktopVersion";
import { leaveToDashboard } from "@/lib/desktopExit";
import { renderHook } from "@testing-library/react";
import { useElectronViolation } from "@hooks/electron/useElectronViolation";

describe("fake desktop violations", () => {
  it("builds the payload the desktop app sends", () => {
    const soft = buildViolation("external_display", { id: "abc", now: 0 });
    expect(soft).toEqual({
      id: "abc",
      code: "external_display",
      category: "hdmi",
      apps: [],
      event: "External display detected",
      severity: "medium",
      count: 1,
      isHardBlock: false,
      source: "electron",
      timestamp: "1970-01-01T00:00:00.000Z",
    });
    expect(buildViolation("blocked_app", { hard: true })).toMatchObject({
      severity: "high",
      isHardBlock: true,
      apps: ["Discord"],
    });
  });

  it("covers every code the site handles by code", () => {
    for (const code of VIOLATION_CODES) {
      const { key } = resolveElectronViolation({ code });
      expect(key === "generic").toBe(code === "suspicious_activity");
    }
  });

  it("gives a hard block only where the site would end the interview", () => {
    expect(isElectronHardBlock(buildViolation("blocked_app", { hard: true }))).toBe(true);
    expect(isElectronHardBlock(buildViolation("external_display", { hard: true }))).toBe(false);
    expect(isElectronHardBlock(buildViolation("blocked_app"))).toBe(false);
  });
});

describe("createFakeDesktop", () => {
  beforeEach(() => resetElectronDeliveries());

  it("delivers violations to the site's listener and logs acknowledgements", () => {
    const { api, controls } = createFakeDesktop();
    const seen = [];
    api.onViolation((v) => {
      seen.push(v);
      api.acknowledgeViolation(v.id);
    });

    controls.fire("overlay");
    controls.fire("overlay", { hard: true });
    controls.redeliverLast();

    expect(seen.map((v) => [v.count, v.isHardBlock, v.redelivered ?? false])).toEqual([
      [1, false, false],
      [2, true, false],
      [2, true, true],
    ]);
    expect(seen[2].id).toBe(seen[1].id);
    expect(controls.isAcked(seen[0].id)).toBe(true);
    expect(controls.calls.map((c) => c.name)).toContain("acknowledgeViolation");
  });

  it("stops delivering once the listener is removed", () => {
    const { api, controls } = createFakeDesktop();
    const handler = vi.fn();
    api.onViolation(handler);
    api.removeViolationListener();
    expect(controls.fire("ai_tool")).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("starts proctoring and passes a proctoring error to the site", async () => {
    vi.useFakeTimers();
    const { api, controls } = createFakeDesktop();
    const started = vi.fn();
    const errored = vi.fn();
    api.onProctoringStarted(started);
    api.onProctoringError(errored);

    await expect(api.startProctoring({ sessionId: "s" })).resolves.toEqual({ ok: true });
    vi.runAllTimers();
    controls.proctoringError("boom");

    expect(started).toHaveBeenCalledOnce();
    expect(errored).toHaveBeenCalledWith({ error: "boom" });
    vi.useRealTimers();
  });

  it("can play an app that has no abortInterview", () => {
    vi.useFakeTimers();
    const old = createFakeDesktop({ abortInterview: false });
    window.electronAPI = old.api;
    leaveToDashboard("start-server");
    vi.runAllTimers();
    expect(old.controls.calls.map((c) => c.name)).toEqual(["interviewComplete", "viewDashboard"]);

    const current = createFakeDesktop();
    window.electronAPI = current.api;
    leaveToDashboard("start-server");
    expect(current.controls.calls.map((c) => c.name)).toEqual(["abortInterview"]);
    delete window.electronAPI;
    vi.useRealTimers();
  });
});

describe("fake desktop with the site's violation hook", () => {
  beforeEach(() => resetElectronDeliveries());
  afterEach(() => delete window.electronAPI);

  it("routes soft, hard and redelivered violations the way the real app would", () => {
    const { api, controls } = createFakeDesktop();
    window.electronAPI = api;
    const onHardBlock = vi.fn();
    const onSoftBlock = vi.fn();
    const { result, unmount } = renderHook(() =>
      useElectronViolation({ onHardBlock, onSoftBlock }),
    );

    expect(result.current.isElectron).toBe(true);
    controls.fire("external_display");
    controls.fire("blocked_app", { hard: true });
    controls.redeliverLast();

    expect(onSoftBlock).toHaveBeenCalledOnce();
    expect(onHardBlock).toHaveBeenCalledOnce();
    expect(controls.calls.filter((c) => c.name === "acknowledgeViolation")).toHaveLength(3);
    unmount();
    expect(controls.listening).toBe(false);
  });
});

describe("desktop settings", () => {
  beforeEach(() => sessionStorage.clear());

  it("turns on with ?desktop=fake, stays on, and turns off with ?desktop=off", () => {
    expect(readDesktopSettings("")).toBeNull();
    expect(readDesktopSettings("?desktop=fake")).toEqual({
      abortInterview: true,
      version: "1.5.0",
    });
    expect(readDesktopSettings("")).not.toBeNull();
    expect(readDesktopSettings("?desktop=off")).toBeNull();
    expect(readDesktopSettings("")).toBeNull();
  });

  it("sets or strips the version token the site reads", () => {
    const base = "Mozilla/5.0 Chrome/140";
    const agent = desktopUserAgent(base, "1.4.0");
    expect(agent).toBe(`${base} LetsHyreSecureInterview/1.4.0`);
    expect(desktopUserAgent(agent, "")).toBe(base);
    expect(isOutdatedDesktop({ userAgent: agent, isDesktop: true, minVersion: "1.4.5" })).toBe(
      true,
    );
    expect(
      isOutdatedDesktop({
        userAgent: desktopUserAgent(base, "1.5.0"),
        isDesktop: true,
        minVersion: "1.4.5",
      }),
    ).toBe(false);
  });
});

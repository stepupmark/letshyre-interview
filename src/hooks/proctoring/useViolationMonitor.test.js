import { act, renderHook } from "@testing-library/react";
import {
  getElectronViolationKey,
  REMINDER_INTERVAL_MS,
  useViolationMonitor,
} from "./useViolationMonitor";
import { MAX_VIOLATIONS } from "@/config/interview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";

function setup({ isActive = true, sessionViolations = 0, startCount = 0 } = {}) {
  let count = startCount;
  const incrementViolation = vi.fn(() => (count += 1));

  const utils = renderHook((props) => useViolationMonitor(props), {
    initialProps: { isActive, incrementViolation, sessionViolations },
  });

  return { ...utils, incrementViolation };
}

describe("getElectronViolationKey", () => {
  it.each([
    ["HDMI cable connected", "externalDisplay"],
    ["External display detected", "externalDisplay"],
    ["Screen mirroring active", "screenSharing"],
    ["Screen sharing detected", "screenSharing"],
    ["Security agent stopped", "securityMonitor"],
    ["Tamper detected", "securityMonitor"],
    ["Window minimize blocked", "windowAction"],
    ["Close attempt blocked", "windowAction"],
    ["Something unexpected", "generic"],
    ["", "generic"],
  ])("maps %j to %j", (event, expected) => {
    expect(getElectronViolationKey(event)).toBe(expected);
  });
});

describe("useViolationMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("raises the modal and adds a strike for a hard AI violation", () => {
    const { result, incrementViolation } = setup();

    act(() => {
      result.current.handleAiViolation({
        titleKey: "violations.noFace.title",
        descriptionKey: "violations.noFace.description",
        imagePath: "/no-candidate.png",
      });
    });

    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.showTabWarning).toBe(true);
    expect(result.current.violationInfo).toMatchObject({
      titleKey: "violations.noFace.title",
      descriptionKey: "violations.noFace.description",
      violationCount: 1,
      counts: true,
    });
  });

  it("nudges with a toast for a soft violation instead of a strike", () => {
    const { result, incrementViolation } = setup();

    act(() => {
      result.current.handleAiViolation({
        soft: true,
        titleKey: "violations.notLooking.title",
        descriptionKey: "violations.notLooking.description",
      });
    });

    expect(toast.warning).toHaveBeenCalledWith("violations.notLooking.title", {
      description: "violations.notLooking.description",
    });
    expect(incrementViolation).not.toHaveBeenCalled();
    expect(result.current.showTabWarning).toBe(false);
  });

  it("shows a non-counting violation without adding a strike", () => {
    const { result, incrementViolation } = setup({ sessionViolations: 1 });

    act(() => {
      result.current.handleAiViolation({
        titleKey: "violations.multipleFaces.title",
        descriptionKey: "violations.multipleFaces.description",
        countsAsViolation: false,
      });
    });

    expect(incrementViolation).not.toHaveBeenCalled();
    expect(result.current.showTabWarning).toBe(true);
    expect(result.current.violationInfo).toMatchObject({ violationCount: 1, counts: false });
  });

  it("suppresses the modal on the strike that hits the limit", () => {
    const { result, incrementViolation } = setup({ startCount: MAX_VIOLATIONS - 1 });

    act(() => {
      result.current.handleAiViolation({
        titleKey: "violations.noFace.title",
        descriptionKey: "violations.noFace.description",
      });
    });

    // The strike still lands; only the dismissible modal is withheld, because
    // TerminationNotice owns the screen from here.
    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.showTabWarning).toBe(false);
  });

  it("ignores violations once the session is no longer active", () => {
    const { result, incrementViolation } = setup({ isActive: false });

    act(() => {
      result.current.handleAiViolation({ titleKey: "a", descriptionKey: "b" });
    });

    expect(incrementViolation).not.toHaveBeenCalled();
    expect(result.current.showTabWarning).toBe(false);
  });

  it("raises a tab-switch violation when the page is hidden", () => {
    const { result, incrementViolation } = setup();

    act(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.violationInfo.titleKey).toBe("violations.tabSwitch.title");

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  it("raises a fullscreen-exit violation when fullscreen is lost", () => {
    const { result, incrementViolation } = setup();

    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.violationInfo.titleKey).toBe("violations.fullscreenExit.title");
  });

  it("only raises the first violation while a warning is already open", () => {
    const { result, incrementViolation } = setup();

    act(() => {
      result.current.handleAiViolation({ titleKey: "first", descriptionKey: "d" });
    });
    act(() => {
      result.current.handleAiViolation({ titleKey: "second", descriptionKey: "d" });
    });

    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.violationInfo.titleKey).toBe("first");
  });

  it("replays an Electron violation that arrived before the session was active", () => {
    const { result, rerender, incrementViolation } = setup({ isActive: false });

    act(() => {
      result.current.handleElectronViolation({ event: "HDMI cable connected" });
    });

    expect(incrementViolation).not.toHaveBeenCalled();

    const stillIncrementing = incrementViolation;
    rerender({ isActive: true, incrementViolation: stillIncrementing, sessionViolations: 0 });

    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.violationInfo.titleKey).toBe("violations.electron.externalDisplay.title");
  });
});

describe("useViolationMonitor window resize", () => {
  const originalRatio = window.devicePixelRatio;

  function setViewport({ width, height }) {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    Object.defineProperty(window.screen, "availWidth", { value: 1000, configurable: true });
    Object.defineProperty(window.screen, "availHeight", { value: 800, configurable: true });
    Object.defineProperty(window, "devicePixelRatio", {
      value: originalRatio || 1,
      configurable: true,
    });
    setViewport({ width: 1000, height: 800 });
    setFullscreen(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("raises a violation for a shrink that persists past the confirm window", () => {
    const { result, incrementViolation } = setup();

    act(() => {
      setViewport({ width: 600, height: 400 });
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(300 + 1000);
    });

    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.violationInfo.titleKey).toBe("violations.windowResize.title");
  });

  function setFullscreen(active) {
    Object.defineProperty(document, "fullscreenElement", {
      value: active ? {} : null,
      configurable: true,
    });
  }

  // Leaving fullscreen resizes the window by itself, so the resize that trails a
  // fullscreen change must not cost a second strike.
  it("ignores a resize that follows straight after a fullscreen change", () => {
    const { incrementViolation } = setup();

    act(() => {
      setFullscreen(true);
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    act(() => {
      setFullscreen(false);
      setViewport({ width: 600, height: 400 });
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(300 + 1000);
    });

    expect(incrementViolation).not.toHaveBeenCalled();
  });

  it("still counts a resize that happens well after a fullscreen change", () => {
    const { incrementViolation } = setup();

    act(() => {
      setFullscreen(true);
      document.dispatchEvent(new Event("fullscreenchange"));
      vi.advanceTimersByTime(5_000);
    });

    act(() => {
      setFullscreen(false);
      setViewport({ width: 600, height: 400 });
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(300 + 1000);
    });

    expect(incrementViolation).toHaveBeenCalledTimes(1);
  });

  it("ignores a shrink that recovers before the confirm window closes", () => {
    const { incrementViolation } = setup();

    act(() => {
      setViewport({ width: 600, height: 400 });
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(300);
      setViewport({ width: 1000, height: 800 });
      vi.advanceTimersByTime(1000);
    });

    expect(incrementViolation).not.toHaveBeenCalled();
  });

  it("ignores a viewport change caused by a DPI or zoom change", () => {
    const { incrementViolation } = setup();

    act(() => {
      Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
      setViewport({ width: 600, height: 400 });
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(300 + 1000);
    });

    expect(incrementViolation).not.toHaveBeenCalled();
  });

  it("does not raise while the window is still maximized", () => {
    const { incrementViolation } = setup();

    act(() => {
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(300 + 1000);
    });

    expect(incrementViolation).not.toHaveBeenCalled();
  });
});

describe("useViolationMonitor modal lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const hardViolation = {
    titleKey: "violations.noFace.title",
    descriptionKey: "violations.noFace.description",
    imagePath: "/no-candidate.png",
  };

  it("closes the modal on its own so it cannot be held open as a mute", () => {
    const { result } = setup();

    act(() => result.current.handleAiViolation(hardViolation));
    expect(result.current.showTabWarning).toBe(true);

    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.showTabWarning).toBe(false);
  });

  it("holds the next strike for a grace period after closing itself", () => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation(hardViolation));
    act(() => vi.advanceTimersByTime(20_000));

    let outcome;
    act(() => {
      outcome = result.current.handleAiViolation(hardViolation);
    });

    expect(outcome).toBe("suppressed");
    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.showTabWarning).toBe(false);
  });

  it("shows nothing for a held-back strike that is not an object in view", () => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation(hardViolation));
    act(() => result.current.dismissWarning());
    act(() => vi.advanceTimersByTime(16_000));

    let outcome;
    act(() => {
      outcome = result.current.handleAiViolation(hardViolation);
    });

    expect(outcome).toBe("cooldown");
    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.showTabWarning).toBe(false);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("does not hold back strikes after a warning closes itself", () => {
    const { result, incrementViolation } = setup();
    const phone = {
      ...hardViolation,
      type: "PROHIBITED_OBJECT:cell phone",
      incident: true,
      remindWhileHeld: true,
    };

    act(() => result.current.handleAiViolation({ ...phone, incidentStartedAt: 0 }));
    act(() => result.current.dismissWarning());
    act(() => result.current.handleAiViolation({ ...phone, ongoing: true, incidentStartedAt: 0 }));
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.showTabWarning).toBe(false);

    act(() => result.current.handleAiViolation({ ...hardViolation, type: "TAB_SWITCH" }));
    expect(incrementViolation).toHaveBeenCalledTimes(2);
  });

  it("upgrades an open warning to a strike once one is admissible", () => {
    const { result, incrementViolation } = setup();
    const phone = {
      ...hardViolation,
      type: "PROHIBITED_OBJECT:cell phone",
      incident: true,
      remindWhileHeld: true,
      incidentStartedAt: Date.now(),
    };

    act(() => result.current.handleAiViolation(phone));
    act(() => result.current.dismissWarning());
    act(() => vi.advanceTimersByTime(16_000));
    act(() => result.current.handleAiViolation({ ...phone, ongoing: true }));
    expect(result.current.violationInfo.counts).toBe(true);
    act(() => vi.advanceTimersByTime(15_000));

    let outcome;
    act(() => {
      outcome = result.current.handleAiViolation({ ...phone, ongoing: true });
    });

    expect(outcome).toBe("raised");
    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.violationInfo.counts).toBe(true);
    expect(result.current.showTabWarning).toBe(true);
  });

  it("keeps the cooldown for a non-counting warning", () => {
    const { result } = setup();
    const environment = { ...hardViolation, countsAsViolation: false };

    act(() => result.current.handleAiViolation(environment));
    act(() => result.current.dismissWarning());

    let outcome;
    act(() => {
      outcome = result.current.handleAiViolation(environment);
    });

    expect(outcome).toBe("cooldown");
    expect(result.current.showTabWarning).toBe(false);
  });

  it("accepts a further violation once the grace and cooldown have passed", () => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation(hardViolation));
    act(() => vi.advanceTimersByTime(20_000));
    act(() => vi.advanceTimersByTime(20_000));
    act(() => result.current.handleAiViolation(hardViolation));

    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.showTabWarning).toBe(true);
  });

  it("asks for fullscreen back when it closes itself outside fullscreen", () => {
    const { result } = setup();

    act(() => result.current.handleAiViolation(hardViolation));
    expect(result.current.needsFullscreen).toBe(false);

    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.needsFullscreen).toBe(true);
  });

  it("reports the outcome back to the caller", () => {
    const { result } = setup();

    let first;
    let second;
    act(() => {
      first = result.current.handleAiViolation(hardViolation);
    });
    act(() => {
      second = result.current.handleAiViolation(hardViolation);
    });

    expect(first).toBe("raised");
    expect(second).toBe("modal_open");
  });

  it("carries the detected object through to the modal", () => {
    const { result } = setup();

    act(() =>
      result.current.handleAiViolation({
        type: "PROHIBITED_OBJECT",
        label: "cell phone",
        titleKey: "violations.prohibitedObject.title",
        descriptionKey: "violations.prohibitedObject.description",
        imagePath: "/laptop.png",
      }),
    );

    expect(result.current.violationInfo.label).toBe("cell phone");
  });

  it("releases the open-modal guard when the strike limit suppresses the modal", () => {
    const { result } = setup({ startCount: MAX_VIOLATIONS - 1 });

    act(() => result.current.handleAiViolation(hardViolation));
    expect(result.current.showTabWarning).toBe(false);

    act(() =>
      result.current.handleAiViolation({
        ...hardViolation,
        titleKey: "violations.multipleFaces.title",
        countsAsViolation: false,
      }),
    );
    expect(result.current.showTabWarning).toBe(true);
  });
  const phoneIncident = {
    type: "PROHIBITED_OBJECT",
    key: "PROHIBITED_OBJECT:cell phone",
    label: "cell phone",
    incident: true,
    remindWhileHeld: true,
    titleKey: "violations.prohibitedObject.title",
    descriptionKey: "violations.prohibitedObject.description",
  };
  const laptopIncident = { ...phoneIncident, key: "PROHIBITED_OBJECT:laptop", label: "laptop" };
  const objectsInView = {
    ...phoneIncident,
    strikeKey: "PROHIBITED_OBJECT",
    incidentStartedAt: 0,
    restrikeAfterMs: 60_000,
    maxRestrikes: 1,
  };

  it("strikes each newly introduced object even inside the strike gap", () => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation(phoneIncident));
    act(() => result.current.dismissWarning());
    act(() => result.current.handleAiViolation(laptopIncident));

    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.violationInfo).toMatchObject({ label: "laptop", counts: true });
  });

  it("shows the existing count while an object stays in view without blocking", () => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation(phoneIncident));
    act(() => result.current.dismissWarning());
    act(() => vi.advanceTimersByTime(REMINDER_INTERVAL_MS));

    let outcome;
    act(() => {
      outcome = result.current.handleAiViolation({
        ...phoneIncident,
        ongoing: true,
        restrikeAfterMs: 60_000,
        maxRestrikes: 1,
      });
    });

    expect(outcome).toBe("warned");
    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.violationInfo.counts).toBe(true);

    act(() => result.current.handleAiViolation(laptopIncident));
    expect(incrementViolation).toHaveBeenCalledTimes(2);
  });

  it("reminds about an object kept in view every 30s and strikes it once more after a minute", () => {
    const { result, incrementViolation } = setup();
    const outcomes = [];

    for (let ms = 0; ms <= 180_000; ms += 5_000) {
      act(() => {
        const outcome = result.current.handleAiViolation({ ...objectsInView, ongoing: ms > 0 });
        if (outcome === "raised" || outcome === "warned") outcomes.push([ms, outcome]);
      });
      act(() => result.current.dismissWarning());
      act(() => vi.advanceTimersByTime(5_000));
    }

    expect(outcomes).toEqual([
      [0, "raised"],
      [30_000, "warned"],
      [60_000, "raised"],
      [90_000, "warned"],
      [120_000, "warned"],
      [150_000, "warned"],
      [180_000, "warned"],
    ]);
    expect(incrementViolation).toHaveBeenCalledTimes(2);
  });

  it("counts a phone and a laptop that appear together as one strike", () => {
    const { result, incrementViolation } = setup();

    act(() =>
      result.current.handleAiViolation({ ...objectsInView, labels: ["cell phone", "laptop"] }),
    );

    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.violationInfo.labels).toEqual(["cell phone", "laptop"]);
  });

  it("counts a candidate who stays away once per interval without warnings between", () => {
    const { result, incrementViolation } = setup();
    const away = { ...hardViolation, type: "NO_FACE", incident: true, incidentStartedAt: 0 };
    const shown = [];

    for (let ms = 0; ms <= 45_000; ms += 1_000) {
      act(() => {
        const outcome = result.current.handleAiViolation({ ...away, ongoing: ms > 0 });
        if (outcome === "raised") shown.push(ms);
      });
      act(() => vi.advanceTimersByTime(1_000));
    }

    expect(shown).toEqual([0, 30_000]);
    expect(incrementViolation).toHaveBeenCalledTimes(2);
  });
});

describe("useViolationMonitor strike summary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function monitor(startCount = 0) {
    let count = startCount;
    const incrementViolation = vi.fn(() => (count += 1));
    return renderHook(() =>
      useViolationMonitor({
        isActive: true,
        incrementViolation,
        sessionViolations: count,
        sessionId: "s1",
      }),
    );
  }

  const strike = (result, violation) => {
    act(() => result.current.handleAiViolation(violation));
    act(() => result.current.dismissWarning());
    act(() => vi.advanceTimersByTime(16_000));
  };

  const tabSwitch = {
    type: "TAB_SWITCH",
    titleKey: "violations.tabSwitch.title",
    imagePath: "/window-switch.png",
  };
  const devices = {
    type: "PROHIBITED_OBJECT",
    titleKey: "violations.multipleDevices.title",
    imagePath: "/laptop.png",
    label: "cell phone",
    labels: ["cell phone", "laptop"],
    incident: true,
  };

  it("keeps every counted strike, including the one that ends the interview", () => {
    const { result } = monitor();

    strike(result, tabSwitch);
    strike(result, { ...tabSwitch, type: "NO_FACE", titleKey: "violations.noFace.title" });
    strike(result, devices);

    expect(result.current.showTabWarning).toBe(false);
    expect(result.current.strikes.map((s) => [s.count, s.titleKey])).toEqual([
      [1, "violations.tabSwitch.title"],
      [2, "violations.noFace.title"],
      [MAX_VIOLATIONS, "violations.multipleDevices.title"],
    ]);
    expect(result.current.strikes.at(-1).labels).toEqual(["cell phone", "laptop"]);
  });

  it("keeps the strikes from before a reload", () => {
    const earlier = [{ count: 1, at: 1, titleKey: "violations.tabSwitch.title" }];
    sessionStorage.setItem("interview_strikes:s1", JSON.stringify(earlier));
    const { result } = monitor(1);

    strike(result, devices);

    expect(result.current.strikes.map((s) => s.count)).toEqual([1, 2]);
  });

  it("leaves out warnings that did not count", () => {
    const { result } = monitor();

    strike(result, { ...tabSwitch, countsAsViolation: false });

    expect(result.current.strikes).toEqual([]);
  });
});

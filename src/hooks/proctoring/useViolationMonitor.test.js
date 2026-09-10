import { act, renderHook } from "@testing-library/react";
import { getElectronViolationKey, useViolationMonitor } from "./useViolationMonitor";
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
    act(() => result.current.handleAiViolation(hardViolation));

    expect(incrementViolation).toHaveBeenCalledTimes(1);
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
});

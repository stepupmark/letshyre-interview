import { act, renderHook } from "@testing-library/react";
import {
  getElectronViolationKey,
  HELD_TTL_MS,
  useViolationMonitor,
  whilePermissionPrompt,
} from "./useViolationMonitor";
import { MAX_VIOLATIONS } from "@/config/interview";
import { subscribeToViolationLog } from "@/lib/violationLog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";

function setup({ isActive = true, sessionViolations = 0, startCount = 0, onHardBlock } = {}) {
  let count = startCount;
  const incrementViolation = vi.fn(() => (count += 1));

  const utils = renderHook((props) => useViolationMonitor(props), {
    initialProps: { isActive, incrementViolation, sessionViolations, onHardBlock },
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
    ["Suspicious transparent overlay detected: 'x.exe' (PID 1)", "overlay"],
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

  it("queues a second violation instead of showing it over the first", () => {
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

  it("lands a violation raised under an open warning once the reaction window ends", () => {
    const { result, incrementViolation } = setup();
    const people = { ...hardViolation, type: "MULTIPLE_FACES", titleKey: "multipleFaces" };

    act(() => result.current.handleAiViolation(hardViolation));
    act(() => vi.advanceTimersByTime(5_000));

    let outcome;
    act(() => {
      outcome = result.current.handleAiViolation(people);
    });
    expect(outcome).toBe("queued");
    expect(incrementViolation).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(5_000));
    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.showTabWarning).toBe(true);
    expect(result.current.violationInfo.titleKey).toBe("multipleFaces");
  });

  it.each([
    ["closed straight away", true],
    ["left open", false],
  ])("gives the same reaction window when the warning is %s", (_, close) => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation(hardViolation));
    if (close) act(() => result.current.dismissWarning());
    act(() => vi.advanceTimersByTime(1_000));
    act(() => result.current.handleAiViolation({ ...hardViolation, type: "TAB_SWITCH" }));

    act(() => vi.advanceTimersByTime(8_999));
    expect(incrementViolation).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(incrementViolation).toHaveBeenCalledTimes(2);
  });

  it("does not add a grace after a warning closes itself", () => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation(hardViolation));
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.showTabWarning).toBe(false);

    act(() => result.current.handleAiViolation({ ...hardViolation, type: "TAB_SWITCH" }));
    expect(incrementViolation).toHaveBeenCalledTimes(2);
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
    expect(second).toBe("cooldown");
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
    restrikeAfterMs: 30_000,
    maxRestrikes: 1,
  };

  it("lands a newly introduced object once the reaction window ends", () => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation(phoneIncident));
    act(() => result.current.dismissWarning());
    act(() => result.current.handleAiViolation(laptopIncident));
    expect(incrementViolation).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(10_000));
    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.violationInfo).toMatchObject({ label: "laptop", counts: true });
  });

  it("keeps a banner up instead of the warning while an object stays in view", () => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation(objectsInView));
    act(() => result.current.dismissWarning());
    act(() => vi.advanceTimersByTime(5_000));

    let outcome;
    act(() => {
      outcome = result.current.handleAiViolation({ ...objectsInView, ongoing: true });
    });

    expect(outcome).toBe("cooldown");
    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.showTabWarning).toBe(false);
    expect(result.current.heldViolations).toEqual([
      expect.objectContaining({ key: "PROHIBITED_OBJECT", label: "cell phone" }),
    ]);
  });

  it("takes the banner down once the object stops being reported", () => {
    const { result } = setup();

    act(() => result.current.handleAiViolation(objectsInView));
    act(() => vi.advanceTimersByTime(HELD_TTL_MS - 1));
    expect(result.current.heldViolations).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.heldViolations).toEqual([]);
  });

  it("strikes an object kept in view once more after 30s, then only keeps the banner", () => {
    const { result, incrementViolation } = setup();
    const raisedAt = [];

    for (let ms = 0; ms <= 180_000; ms += 5_000) {
      act(() => {
        const outcome = result.current.handleAiViolation({ ...objectsInView, ongoing: ms > 0 });
        if (outcome === "raised") raisedAt.push(ms);
      });
      act(() => result.current.dismissWarning());
      act(() => vi.advanceTimersByTime(5_000));
    }

    expect(raisedAt).toEqual([0, 30_000]);
    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.heldViolations).toHaveLength(1);
  });

  it("lands the second strike right after an unanswered warning closes itself", () => {
    const { result, incrementViolation } = setup();
    const raisedAt = [];

    for (let ms = 0; ms <= 40_000; ms += 5_000) {
      act(() => {
        if (result.current.handleAiViolation({ ...objectsInView, ongoing: ms > 0 }) === "raised") {
          raisedAt.push(ms);
        }
      });
      act(() => vi.advanceTimersByTime(5_000));
    }

    expect(raisedAt).toEqual([0, 30_000]);
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

  it("lists what else is going on under the open warning", () => {
    const { result } = setup();
    const people = {
      type: "MULTIPLE_FACES",
      incident: true,
      incidentStartedAt: 2_000,
      titleKey: "violations.multipleFaces.title",
    };

    act(() => result.current.handleAiViolation(objectsInView));
    act(() => vi.advanceTimersByTime(2_000));
    act(() => result.current.handleAiViolation(people));
    expect(result.current.alsoDetected).toEqual([
      expect.objectContaining({ titleKey: "violations.multipleFaces.title" }),
    ]);

    act(() => vi.advanceTimersByTime(3_000));
    act(() => result.current.handleAiViolation({ ...objectsInView, ongoing: true }));
    act(() => vi.advanceTimersByTime(5_000));

    expect(result.current.violationInfo.titleKey).toBe("violations.multipleFaces.title");
    expect(result.current.alsoDetected).toEqual([
      expect.objectContaining({
        titleKey: "violations.prohibitedObject.title",
        label: "cell phone",
      }),
    ]);
  });

  it("shows an identity warning straight away over an open warning", () => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation(objectsInView));
    act(() =>
      result.current.handleAiViolation({
        type: "FACE_MISMATCH",
        titleKey: "violations.faceMismatch.title",
        descriptionKey: "violations.faceMismatch.description",
        countsAsViolation: false,
        finalWarning: true,
      }),
    );

    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.showTabWarning).toBe(true);
    expect(result.current.violationInfo).toMatchObject({
      titleKey: "violations.faceMismatch.title",
      counts: false,
      finalWarning: true,
    });
  });

  it("holds back soft nudges while a warning is open", () => {
    const { result } = setup();

    act(() => result.current.handleAiViolation(objectsInView));
    act(() =>
      result.current.handleAiViolation({ soft: true, titleKey: "violations.notLooking.title" }),
    );
    expect(toast.warning).not.toHaveBeenCalled();

    act(() => result.current.dismissWarning());
    act(() =>
      result.current.handleAiViolation({ soft: true, titleKey: "violations.notLooking.title" }),
    );
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});

describe("useViolationMonitor strike queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const incidentOf = (type, startedAt) => ({
    type,
    incident: true,
    incidentStartedAt: startedAt,
    titleKey: type,
    descriptionKey: "d",
  });

  it("still counts a violation that stopped before the window ended", () => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation(incidentOf("PROHIBITED_OBJECT", 0)));
    act(() => vi.advanceTimersByTime(3_000));
    act(() => result.current.handleAiViolation(incidentOf("MULTIPLE_FACES", 3_000)));
    act(() => vi.advanceTimersByTime(7_000));

    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.violationInfo.titleKey).toBe("MULTIPLE_FACES");
  });

  it("lands held strikes one window apart in the order they started", () => {
    const { result, incrementViolation } = setup({ startCount: -10 });

    act(() => result.current.handleAiViolation(incidentOf("NO_FACE", 0)));
    act(() => vi.advanceTimersByTime(6_000));
    act(() => result.current.handleAiViolation(incidentOf("MULTIPLE_FACES", 4_000)));
    act(() => vi.advanceTimersByTime(1_000));
    act(() => result.current.handleAiViolation(incidentOf("PROHIBITED_OBJECT", 2_000)));

    act(() => vi.advanceTimersByTime(3_000));
    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.violationInfo.titleKey).toBe("PROHIBITED_OBJECT");

    act(() => vi.advanceTimersByTime(9_999));
    expect(incrementViolation).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1));
    expect(incrementViolation).toHaveBeenCalledTimes(3);
    expect(result.current.violationInfo.titleKey).toBe("MULTIPLE_FACES");
  });

  it("does not let a newcomer jump ahead of a strike already waiting", () => {
    const { result, incrementViolation } = setup({ startCount: -10 });

    act(() => result.current.handleAiViolation(incidentOf("NO_FACE", 0)));
    act(() => vi.advanceTimersByTime(5_000));
    act(() => result.current.handleAiViolation(incidentOf("MULTIPLE_FACES", 5_000)));
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.violationInfo.titleKey).toBe("MULTIPLE_FACES");

    let outcome;
    act(() => {
      outcome = result.current.handleAiViolation(incidentOf("CAMERA_OFF", 10_000));
    });
    expect(outcome).toBe("queued");
    expect(incrementViolation).toHaveBeenCalledTimes(2);
  });

  it("counts nothing more once the strike limit is reached", () => {
    const { result, incrementViolation } = setup({ startCount: MAX_VIOLATIONS - 2 });

    act(() => result.current.handleAiViolation(incidentOf("NO_FACE", 0)));
    act(() => vi.advanceTimersByTime(2_000));
    act(() => result.current.handleAiViolation(incidentOf("MULTIPLE_FACES", 2_000)));
    act(() => result.current.handleAiViolation(incidentOf("CAMERA_OFF", 2_000)));
    act(() => vi.advanceTimersByTime(60_000));

    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.showTabWarning).toBe(false);
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

describe("useViolationMonitor leaving the window", () => {
  let focused;

  function setHidden(hidden) {
    Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
  }

  function setFullscreen(active) {
    Object.defineProperty(document, "fullscreenElement", {
      value: active ? {} : null,
      configurable: true,
    });
  }

  function setViewport({ width, height }) {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
  }

  const blur = () =>
    act(() => {
      focused = false;
      window.dispatchEvent(new Event("blur"));
    });
  const hide = () =>
    act(() => {
      focused = false;
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });
  const comeBack = () =>
    act(() => {
      focused = true;
      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
  const exitFullscreen = () =>
    act(() => {
      setFullscreen(false);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
  const shrink = () =>
    act(() => {
      setViewport({ width: 600, height: 400 });
      window.dispatchEvent(new Event("resize"));
    });
  const wait = (ms) => act(() => vi.advanceTimersByTime(ms));
  const lastStrike = (result) => result.current.strikes.at(-1);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    focused = true;
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    Object.defineProperty(window.screen, "availWidth", { value: 1000, configurable: true });
    Object.defineProperty(window.screen, "availHeight", { value: 800, configurable: true });
    setViewport({ width: 1000, height: 800 });
    setFullscreen(true);
    setHidden(false);
  });

  afterEach(() => {
    document.hasFocus.mockRestore();
    setFullscreen(false);
    setHidden(false);
    vi.useRealTimers();
  });

  it("strikes once for a tab switch that also exits fullscreen and shrinks the window", () => {
    const { result, incrementViolation } = setup();

    blur();
    hide();
    act(() => result.current.dismissWarning());
    exitFullscreen();
    wait(3_000);
    shrink();
    wait(60_000);

    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.violationInfo).toMatchObject({
      titleKey: "violations.tabSwitch.title",
      descriptionKey: "violations.tabSwitch.description",
      imagePath: "/window-switch.png",
    });
  });

  it("strikes once for a fullscreen exit that lands just before the tab hides", () => {
    const { result, incrementViolation } = setup();

    exitFullscreen();
    act(() => result.current.dismissWarning());
    wait(500);
    hide();
    wait(60_000);

    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.violationInfo.titleKey).toBe("violations.fullscreenExit.title");
  });

  it("strikes every leave after coming back, each once its reaction window ends", () => {
    const { result, incrementViolation } = setup();

    hide();
    comeBack();
    act(() => result.current.dismissWarning());
    wait(1_000);
    hide();
    expect(incrementViolation).toHaveBeenCalledTimes(1);

    wait(9_000);
    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.showTabWarning).toBe(true);

    comeBack();
    act(() => result.current.dismissWarning());
    wait(1_000);
    hide();
    wait(9_000);

    expect(incrementViolation).toHaveBeenCalledTimes(3);
  });

  it("does not let staying out of fullscreen make later leaves free", () => {
    const { result, incrementViolation } = setup();

    exitFullscreen();
    expect(lastStrike(result).titleKey).toBe("violations.fullscreenExit.title");
    act(() => result.current.dismissWarning());

    wait(5_000);
    hide();
    wait(5_000);
    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(lastStrike(result).titleKey).toBe("violations.tabSwitch.title");

    comeBack();
    act(() => result.current.dismissWarning());
    wait(1_000);
    blur();
    wait(9_000);

    expect(incrementViolation).toHaveBeenCalledTimes(3);
    expect(lastStrike(result).titleKey).toBe("violations.windowFocus.title");
  });

  it("strikes a separate resize after the candidate is back", () => {
    const { result, incrementViolation } = setup();
    setFullscreen(false);

    hide();
    comeBack();
    act(() => result.current.dismissWarning());
    wait(1_000);
    shrink();
    wait(9_000);

    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.violationInfo.titleKey).toBe("violations.windowResize.title");
  });

  it("strikes a page that stays visible but loses focus for two seconds", () => {
    const { result, incrementViolation } = setup();

    blur();
    wait(1_999);
    expect(incrementViolation).not.toHaveBeenCalled();

    wait(1);
    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.violationInfo).toMatchObject({
      titleKey: "violations.windowFocus.title",
      descriptionKey: "violations.windowFocus.description",
      imagePath: "/window-switch.png",
    });
  });

  it("ignores focus that comes back within two seconds", () => {
    const { incrementViolation } = setup();

    blur();
    wait(1_000);
    comeBack();
    wait(5_000);

    expect(incrementViolation).not.toHaveBeenCalled();
  });

  it("leaves a hidden page to the tab-switch strike", () => {
    const { result, incrementViolation } = setup();

    blur();
    hide();
    wait(5_000);

    expect(incrementViolation).toHaveBeenCalledTimes(1);
    expect(result.current.violationInfo.titleKey).toBe("violations.tabSwitch.title");
  });

  it("strikes focus loss once while the candidate stays away", () => {
    const { result, incrementViolation } = setup();

    blur();
    wait(2_000);
    act(() => result.current.dismissWarning());
    exitFullscreen();
    wait(60_000);

    expect(incrementViolation).toHaveBeenCalledTimes(1);
  });

  it("ignores focus lost to a permission prompt", async () => {
    const { incrementViolation } = setup();
    let answer;
    const prompt = whilePermissionPrompt(new Promise((resolve) => (answer = resolve)));

    blur();
    wait(5_000);
    expect(incrementViolation).not.toHaveBeenCalled();

    await act(async () => {
      answer();
      await prompt;
    });
    comeBack();
    blur();
    wait(2_000);

    expect(incrementViolation).toHaveBeenCalledTimes(1);
  });

  it("does not strike Esc dropping fullscreen while the candidate reads a warning", () => {
    const { result, incrementViolation } = setup();

    act(() => result.current.handleAiViolation({ titleKey: "t", descriptionKey: "d" }));
    exitFullscreen();
    wait(60_000);

    expect(incrementViolation).toHaveBeenCalledTimes(1);
  });

  it("asks for Esc to be held to leave fullscreen where the browser allows it", () => {
    const lock = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "keyboard", { value: { lock }, configurable: true });
    setup();

    act(() => {
      setFullscreen(true);
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    expect(lock).toHaveBeenCalledWith(["Escape"]);
    delete navigator.keyboard;
  });

  it("locks every key inside the desktop app so Alt+Tab and the Windows key stay in the page", () => {
    const lock = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "keyboard", { value: { lock }, configurable: true });
    window.electronAPI = {};
    setup();

    act(() => {
      setFullscreen(true);
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    expect(lock).toHaveBeenCalledWith(undefined);
    delete navigator.keyboard;
    delete window.electronAPI;
  });

  it("stops watching focus once unmounted", () => {
    const { unmount, incrementViolation } = setup();

    blur();
    unmount();
    wait(5_000);
    window.dispatchEvent(new Event("blur"));
    wait(5_000);

    expect(incrementViolation).not.toHaveBeenCalled();
  });
});

describe("useViolationMonitor held-back acts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    vi.useRealTimers();
  });

  const hdmi = { event: "HDMI cable connected" };
  const mirroring = { event: "Screen mirroring active" };
  const noFace = {
    type: "NO_FACE",
    titleKey: "violations.noFace.title",
    descriptionKey: "violations.noFace.description",
  };
  const wait = (ms) => act(() => vi.advanceTimersByTime(ms));
  const setHidden = (hidden) => {
    Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  function strikeAndDismiss(result) {
    act(() => result.current.handleAiViolation(noFace));
    act(() => result.current.dismissWarning());
  }

  it("raises a desktop-app block held back by the reaction window once it ends", () => {
    const { result, incrementViolation } = setup();

    strikeAndDismiss(result);
    wait(5_000);
    let outcome;
    act(() => {
      outcome = result.current.handleElectronViolation(hdmi);
    });
    expect(outcome).toBe("queued");

    wait(4_999);
    expect(incrementViolation).toHaveBeenCalledTimes(1);

    wait(1);
    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.violationInfo.titleKey).toBe("violations.electron.externalDisplay.title");
  });

  it("raises repeats of one block once and different blocks a window apart", () => {
    // Kept clear of the strike limit so every warning is shown.
    const { result, incrementViolation } = setup({ startCount: -10 });

    strikeAndDismiss(result);
    wait(5_000);
    act(() => result.current.handleElectronViolation(hdmi));
    act(() => result.current.handleElectronViolation(mirroring));
    act(() => result.current.handleElectronViolation(hdmi));

    wait(5_000);
    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.violationInfo.titleKey).toBe("violations.electron.externalDisplay.title");

    act(() => result.current.dismissWarning());
    wait(9_999);
    expect(incrementViolation).toHaveBeenCalledTimes(2);

    wait(1);
    expect(incrementViolation).toHaveBeenCalledTimes(3);
    expect(result.current.violationInfo.titleKey).toBe("violations.electron.screenSharing.title");

    act(() => result.current.dismissWarning());
    wait(60_000);
    expect(incrementViolation).toHaveBeenCalledTimes(3);
  });

  it("raises a leave made while the last warning was open once the window ends", () => {
    const { result, incrementViolation } = setup();

    act(() => setHidden(true));
    act(() => {
      setHidden(false);
      window.dispatchEvent(new Event("focus"));
    });
    wait(1_000);
    act(() => setHidden(true));
    expect(incrementViolation).toHaveBeenCalledTimes(1);

    wait(8_999);
    expect(incrementViolation).toHaveBeenCalledTimes(1);

    wait(1);
    expect(incrementViolation).toHaveBeenCalledTimes(2);
    expect(result.current.violationInfo.titleKey).toBe("violations.tabSwitch.title");
  });

  it("does not retry the trailing events of a leave that already struck", () => {
    const { result, incrementViolation } = setup();

    act(() => {
      setHidden(true);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    act(() => result.current.dismissWarning());
    wait(60_000);

    expect(incrementViolation).toHaveBeenCalledTimes(1);
  });

  it("drops whatever is held back once the session ends", () => {
    const { result, rerender, incrementViolation } = setup();

    strikeAndDismiss(result);
    wait(5_000);
    act(() => result.current.handleElectronViolation(hdmi));
    rerender({ isActive: false, incrementViolation, sessionViolations: 1 });
    wait(60_000);

    expect(incrementViolation).toHaveBeenCalledTimes(1);
  });

  it("lands an AI condition caught in the window without it being reported again", () => {
    const { result, incrementViolation } = setup();

    strikeAndDismiss(result);
    wait(5_000);
    act(() => result.current.handleAiViolation({ ...noFace, type: "MULTIPLE_FACES" }));
    wait(60_000);

    expect(incrementViolation).toHaveBeenCalledTimes(2);
  });
});

describe("useViolationMonitor desktop-app hard blocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const hardBlock = { event: "Security agent stopped", isHardBlock: true };

  it("ends the interview instead of adding a strike", () => {
    const onHardBlock = vi.fn();
    const { result, incrementViolation } = setup({ onHardBlock });

    let outcome;
    act(() => {
      outcome = result.current.handleElectronHardBlock(hardBlock);
    });

    expect(outcome).toBe("terminated");
    expect(onHardBlock).toHaveBeenCalledTimes(1);
    expect(incrementViolation).not.toHaveBeenCalled();
    expect(result.current.showTabWarning).toBe(false);
  });

  it("ends the interview once active for a block that arrived while loading", () => {
    const onHardBlock = vi.fn();
    const { result, rerender, incrementViolation } = setup({ isActive: false, onHardBlock });

    act(() => {
      result.current.handleElectronViolation({ event: "HDMI cable connected" });
      result.current.handleElectronHardBlock(hardBlock);
    });
    expect(onHardBlock).not.toHaveBeenCalled();

    rerender({ isActive: true, incrementViolation, sessionViolations: 0, onHardBlock });

    expect(onHardBlock).toHaveBeenCalledTimes(1);
    expect(incrementViolation).not.toHaveBeenCalled();
  });

  it("logs what the desktop app reported and keeps it for the notice", () => {
    const events = [];
    const unsubscribe = subscribeToViolationLog((event) => events.push(event));
    const { result } = setup({ onHardBlock: vi.fn() });

    act(() => {
      result.current.handleElectronHardBlock({
        event: "Suspicious transparent overlay detected: 'x.exe' (PID 1)",
        severity: "medium",
        count: 2,
        isHardBlock: true,
      });
    });
    unsubscribe();

    expect(events).toContainEqual(
      expect.objectContaining({
        source: "electron",
        type: "ELECTRON_OVERLAY",
        outcome: "terminated",
        event: "Suspicious transparent overlay detected: 'x.exe' (PID 1)",
        severity: "medium",
        electron_count: 2,
      }),
    );
    expect(result.current.securityBlock).toMatchObject({
      type: "ELECTRON_OVERLAY",
      titleKey: "violations.electron.overlay.title",
    });
  });

  it("logs the reported event on a warning too", () => {
    const events = [];
    const unsubscribe = subscribeToViolationLog((event) => events.push(event));
    const { result } = setup();

    act(() => {
      result.current.handleElectronViolation({ event: "HDMI cable connected", severity: "medium" });
    });
    unsubscribe();

    expect(events).toContainEqual(
      expect.objectContaining({ source: "electron", event: "HDMI cable connected" }),
    );
  });
});

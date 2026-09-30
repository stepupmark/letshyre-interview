import { act, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { PreStart } from "./PreStart";
import interviewEn from "@/i18n/locales/en/interview.json";
import { subscribeToViolationLog } from "@/lib/violationLog";
import { startLocalWatch } from "@hooks/proctoring/localWatch";
import { loadFaceDetector } from "@/lib/localFaceDetector";
import { RULES_ACK_KEY } from "@/lib/rulesAck";
import { interviewRules } from "@/config/interviewRules";
import {
  CAMERA_CHECK_HOLD_MS,
  FACE_MISMATCH_LIMIT,
  FACE_MISMATCH_TOTAL_LIMIT,
  HELD_RESTRIKE_SECONDS,
  MAX_INTERNET_DISCONNECTS,
  MAX_VIOLATIONS,
} from "@/config/interview";

vi.mock("@hooks/proctoring/localWatch", () => ({ startLocalWatch: vi.fn() }));
vi.mock("@/lib/localFaceDetector", () => ({ loadFaceDetector: vi.fn(() => Promise.resolve()) }));

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { interview: interviewEn } },
    ns: ["interview"],
    defaultNS: "interview",
    interpolation: { escapeValue: false },
  });
});

let watch;
let log;
let unsubscribe;
beforeEach(() => {
  log = [];
  unsubscribe = subscribeToViolationLog((event) => log.push(event));
  startLocalWatch.mockReset();
  startLocalWatch.mockImplementation((options) => {
    watch = options;
    return () => {};
  });
});
afterEach(() => unsubscribe());

const acknowledge = () => fireEvent.click(screen.getByRole("button", { name: "I understand" }));

describe("PreStart rules", () => {
  it("quotes the configured limits", () => {
    render(<PreStart onReady={() => {}} />);
    const text = document.body.textContent;

    expect(text).toContain(`After ${MAX_VIOLATIONS} strikes`);
    expect(text).toContain(`every ${HELD_RESTRIKE_SECONDS} seconds`);
    expect(text).toContain(`${FACE_MISMATCH_LIMIT} times in a row`);
    expect(text).toContain(`${FACE_MISMATCH_TOTAL_LIMIT} times in all`);
    expect(text).toContain(`drops ${MAX_INTERNET_DISCONNECTS} times`);
    expect(text).not.toMatch(/preStart\.|{{/);
  });

  it("records the acknowledgement and moves on to the camera check", () => {
    const onReady = vi.fn();
    render(<PreStart onReady={onReady} />);
    acknowledge();

    expect(log).toEqual([
      expect.objectContaining({
        type: "PRE_START",
        outcome: "rules_acknowledged",
        limits: expect.objectContaining({ strikes: MAX_VIOLATIONS }),
      }),
    ]);
    expect(screen.getByText("Camera check")).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
  });
});

describe("PreStart camera check", () => {
  it("starts the interview once the camera check passes", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => new Promise(() => {}) },
    });
    const onReady = vi.fn();
    render(<PreStart onReady={onReady} />);
    acknowledge();

    expect(screen.getByRole("button", { name: "Continue anyway" })).toBeDisabled();

    const good = { oneFace: true, centred: true, bright: true };
    act(() => watch.onResult({ ...good, at: 0 }));
    act(() => watch.onResult({ ...good, at: CAMERA_CHECK_HOLD_MS }));

    const start = screen.getByRole("button", { name: "Start interview" });
    fireEvent.click(start);
    fireEvent.click(start);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(log.at(-1)).toMatchObject({ outcome: "precheck_passed", failed_attempts: 0 });
    delete navigator.mediaDevices;
  });

  it("lets the candidate through and logs why when the check can't run", async () => {
    const onReady = vi.fn();
    render(<PreStart onReady={onReady} />);
    acknowledge();

    // jsdom has no camera, so the preview reports a failure.
    const skip = screen.getByRole("button", { name: "Continue anyway" });
    await vi.waitFor(() => expect(skip).toBeEnabled());
    fireEvent.click(skip);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(log.at(-1)).toMatchObject({ outcome: "precheck_skipped", reason: "camera_error" });
  });
});

describe("PreStart inside the desktop app", () => {
  beforeEach(() => {
    window.electronAPI = { onViolation: () => {} };
  });
  afterEach(() => {
    delete window.electronAPI;
    sessionStorage.clear();
  });

  it("starts straight away when the app showed these exact rules", () => {
    const at = "2026-09-30T10:00:00.000Z";
    sessionStorage.setItem(
      RULES_ACK_KEY,
      JSON.stringify({ ...interviewRules(import.meta.env), at }),
    );
    const onReady = vi.fn();
    const { container } = render(<PreStart onReady={onReady} />);

    expect(container).toBeEmptyDOMElement();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(log).toEqual([
      expect.objectContaining({
        outcome: "rules_acknowledged",
        source: "desktop",
        acknowledged_at: at,
      }),
      expect.objectContaining({ outcome: "precheck_skipped", reason: "identity_verified_in_app" }),
    ]);
    expect(loadFaceDetector).toHaveBeenCalled();
  });

  it("shows the rules when the app's copy is out of date, then starts without the camera check", () => {
    const stale = { ...interviewRules(import.meta.env), strikes: MAX_VIOLATIONS + 1 };
    sessionStorage.setItem(RULES_ACK_KEY, JSON.stringify(stale));
    const onReady = vi.fn();
    render(<PreStart onReady={onReady} />);

    expect(onReady).not.toHaveBeenCalled();
    acknowledge();

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Camera check")).not.toBeInTheDocument();
    expect(log.map((e) => e.outcome)).toEqual(["rules_acknowledged", "precheck_skipped"]);
    expect(log[0].source).toBe("site");
  });
});

import { act, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import CountdownTimer from "./CountdownTimer";
import interviewEn from "@/i18n/locales/en/interview.json";

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));

import { toast } from "sonner";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { interview: interviewEn } },
    ns: ["interview"],
    defaultNS: "interview",
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sessionStorage.clear();
});

afterEach(() => vi.useRealTimers());

const MINUTE = 60_000;

async function start(endTime) {
  const view = render(<CountdownTimer endTime={endTime} />);
  await act(async () => {});
  return view;
}

describe("CountdownTimer", () => {
  it("warns once at five minutes and once at one, changing colour each time", async () => {
    const endTime = Date.now() + 5 * MINUTE + 2_000;
    await start(endTime);
    const timer = screen.getByRole("timer", { name: "Time remaining" });
    expect(timer).toHaveAttribute("data-level", "normal");

    act(() => vi.advanceTimersByTime(3_000));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenLastCalledWith(
      "5 min left in your interview.",
      expect.anything(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("5 min left in your interview.");
    expect(timer).toHaveAttribute("data-level", "warning");

    act(() => vi.advanceTimersByTime(4 * MINUTE));
    expect(toast.warning).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("1 min left in your interview.");
    expect(timer).toHaveAttribute("data-level", "urgent");

    act(() => vi.advanceTimersByTime(30_000));
    expect(toast.warning).toHaveBeenCalledTimes(2);
  });

  it("doesn't warn again when it mounts again for the same interview", async () => {
    const endTime = Date.now() + 4 * MINUTE;
    const first = await start(endTime);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    first.unmount();

    await start(endTime);
    act(() => vi.advanceTimersByTime(5_000));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("timer")).toHaveAttribute("data-level", "warning");
  });

  it("stays quiet with plenty of time left", async () => {
    await start(Date.now() + 10 * MINUTE);
    act(() => vi.advanceTimersByTime(5_000));
    expect(toast.warning).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

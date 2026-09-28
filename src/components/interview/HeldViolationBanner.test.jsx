import { act, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import HeldViolationBanner from "./HeldViolationBanner";
import interviewEn from "@/i18n/locales/en/interview.json";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { interview: interviewEn } },
    ns: ["interview"],
    defaultNS: "interview",
    interpolation: { escapeValue: false },
  });
});

describe("HeldViolationBanner", () => {
  it("renders nothing while nothing is held", () => {
    const { container } = render(<HeldViolationBanner items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says what is still in view and what to do about it", () => {
    render(
      <HeldViolationBanner
        items={[
          {
            key: "PROHIBITED_OBJECT",
            titleKey: "violations.prohibitedObject.title",
            descriptionKey: "violations.prohibitedObject.description",
            label: "laptop",
          },
        ]}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Still detected");
    expect(screen.getByText("Prohibited Device Detected (laptop)")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Please put away the laptop to continue the interview.",
    );
  });

  describe("countdown to the next strike", () => {
    const camera = {
      key: "CAMERA_OFF",
      titleKey: "violations.cameraOff.title",
      descriptionKey: "violations.cameraOff.description",
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("counts down while the condition can still strike", () => {
      render(<HeldViolationBanner items={[{ ...camera, nextStrikeAt: Date.now() + 25_000 }]} />);
      expect(screen.getByText("Counts as another violation in 0:25")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(5_000));
      expect(screen.getByText("Counts as another violation in 0:20")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(20_000));
      expect(screen.getByText("Counts as another violation at the next check")).toBeInTheDocument();
    });

    it("keeps the ticking time out of what screen readers announce", () => {
      render(<HeldViolationBanner items={[{ ...camera, nextStrikeAt: Date.now() + 25_000 }]} />);
      expect(screen.getByText(/in 0:25/)).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByRole("status")).toHaveTextContent(
        "This will count as another violation if it stays.",
      );
    });

    it("shows no countdown once there is no strike left to come", () => {
      render(<HeldViolationBanner items={[{ ...camera, nextStrikeAt: null }]} />);
      expect(screen.queryByText(/Counts as another violation/)).not.toBeInTheDocument();
    });
  });
});

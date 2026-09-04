import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import TerminationNotice from "./TerminationNotice";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import interviewEn from "@/i18n/locales/en/interview.json";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { interview: interviewEn } },
    ns: ["interview"],
    defaultNS: "interview",
    interpolation: { escapeValue: false },
  });
});

// Guards the key migration: a typo or a key missing from en/interview.json shows
// up here as the raw key leaking into the DOM.
function renderNotice(reason) {
  render(<TerminationNotice reason={reason} secondsLeft={5} onAcknowledge={() => {}} />);
}

describe("TerminationNotice", () => {
  it("resolves copy for every termination reason", () => {
    for (const reason of Object.values(TERMINATION_REASONS)) {
      const { unmount } = render(
        <TerminationNotice reason={reason} secondsLeft={5} onAcknowledge={() => {}} />,
      );
      expect(document.body.textContent).not.toMatch(/termination\.[a-zA-Z.]+/);
      unmount();
    }
  });

  it("interpolates the configured violation limit", () => {
    renderNotice(TERMINATION_REASONS.VIOLATION_LIMIT);
    expect(screen.getByText(/compliance violations/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("{{violations}}");
  });

  it("shows the countdown and the acknowledge control", () => {
    renderNotice(TERMINATION_REASONS.VIOLATION_LIMIT);
    expect(screen.getByRole("button", { name: /i understand/i })).toBeInTheDocument();
    expect(screen.getByText(/5s/)).toBeInTheDocument();
  });

  it("announces itself as a modal alert dialog", () => {
    renderNotice(TERMINATION_REASONS.FACE_MISMATCH);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("does not blame the candidate for a timeout", () => {
    renderNotice(TERMINATION_REASONS.TIME_EXPIRED);
    expect(screen.getByText(/time's up/i)).toBeInTheDocument();
  });
});

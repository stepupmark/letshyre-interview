import { render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import TerminationNotice from "./TerminationNotice";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import interviewEn from "@/i18n/locales/en/interview.json";
import commonEn from "@/i18n/locales/en/common.json";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { interview: interviewEn, common: commonEn } },
    ns: ["interview", "common"],
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

describe("TerminationNotice violation summary", () => {
  const strikes = [
    { count: 1, at: 1, titleKey: "violations.tabSwitch.title" },
    { count: 2, at: 2, titleKey: "violations.prohibitedObject.title", label: "laptop" },
    {
      count: 3,
      at: 3,
      titleKey: "violations.cellPhone.title",
      imagePath: "/cell-phone.svg",
      label: "cell phone",
    },
  ];

  const renderSummary = (list = strikes, reason = TERMINATION_REASONS.VIOLATION_LIMIT) =>
    render(
      <TerminationNotice reason={reason} secondsLeft={5} onAcknowledge={() => {}} strikes={list} />,
    );

  const strikeList = () => document.querySelector("ol");

  it("says outright which violation ended the interview", () => {
    renderSummary();

    expect(screen.getByText("Violation 3 of 3 · Ended the interview")).toBeInTheDocument();
    expect(screen.getAllByText("Cell Phone Detected")[0]).toBeInTheDocument();
    expect(document.querySelector("img").getAttribute("src")).toBe("/cell-phone.svg");
  });

  it("lists every strike without timestamps and highlights the last", () => {
    renderSummary();

    const items = within(strikeList()).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "1. Tab Switch Detected",
      "2. Prohibited Device Detected (laptop)",
      "3. Cell Phone Detected",
    ]);
    expect(items[2].className).toContain("text-red-600");
    expect(items[0].className).not.toContain("text-red-600");
  });

  it("names both devices when they were caught together", () => {
    renderSummary([
      {
        count: 3,
        at: 1,
        titleKey: "violations.multipleDevices.title",
        labels: ["cell phone", "laptop"],
      },
    ]);

    expect(screen.getByText("Prohibited Devices Detected (phone and laptop)")).toBeInTheDocument();
    expect(strikeList()).toBeNull();
  });

  it("falls back to the general message when nothing was recorded", () => {
    renderSummary([]);

    expect(screen.queryByText(/Ended the interview/)).not.toBeInTheDocument();
    expect(screen.getByText(/compliance violations/i)).toBeInTheDocument();
  });

  it("keeps the summary off screens that aren't about violations", () => {
    renderSummary(strikes, TERMINATION_REASONS.TIME_EXPIRED);

    expect(screen.queryByText(/Ended the interview/)).not.toBeInTheDocument();
  });
});

describe("TerminationNotice security block", () => {
  const renderBlock = (securityBlock, reason = TERMINATION_REASONS.ELECTRON_SECURITY) =>
    render(
      <TerminationNotice
        reason={reason}
        secondsLeft={5}
        onAcknowledge={() => {}}
        securityBlock={securityBlock}
      />,
    );

  it("says what the desktop app detected", () => {
    renderBlock({ type: "ELECTRON_OVERLAY", titleKey: "violations.electron.overlay.title" });

    expect(screen.getByText("Detected")).toBeInTheDocument();
    expect(screen.getByText("Overlay Window Detected")).toBeInTheDocument();
  });

  it("adds nothing when the reason is too vague to help", () => {
    renderBlock({ type: "ELECTRON_GENERIC", titleKey: "violations.electron.generic.title" });

    expect(screen.queryByText("Detected")).not.toBeInTheDocument();
  });

  it("only shows on security endings", () => {
    renderBlock(
      { type: "ELECTRON_OVERLAY", titleKey: "violations.electron.overlay.title" },
      TERMINATION_REASONS.TIME_EXPIRED,
    );

    expect(screen.queryByText("Detected")).not.toBeInTheDocument();
  });
});

describe("TerminationNotice desktop-app block", () => {
  it("names the apps that were found", () => {
    render(
      <TerminationNotice
        reason={TERMINATION_REASONS.ELECTRON_SECURITY}
        secondsLeft={5}
        onAcknowledge={() => {}}
        securityBlock={{
          type: "ELECTRON_BLOCKEDAPP",
          titleKey: "violations.electron.blockedApp.title",
          apps: ["Google Chrome", "Zoom"],
        }}
      />,
    );
    expect(screen.getByText("Blocked App Detected")).toBeInTheDocument();
    expect(screen.getByText("Google Chrome and Zoom")).toBeInTheDocument();
  });
});

describe("TerminationNotice support details", () => {
  it("shows the reference code and what happens next", () => {
    render(
      <TerminationNotice
        reason={TERMINATION_REASONS.VIOLATION_LIMIT}
        secondsLeft={5}
        onAcknowledge={() => {}}
        sessionId="session-456"
      />,
    );
    expect(screen.getByText("LH-3KHH-QEY5")).toBeInTheDocument();
    expect(screen.getByText("What happens next")).toBeInTheDocument();
    expect(screen.getByText(/answers you gave so far/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/support\.(referenceCode|whatNext)/);
  });

  it("describes a timed-out interview as finished", () => {
    render(
      <TerminationNotice
        reason={TERMINATION_REASONS.TIME_EXPIRED}
        secondsLeft={5}
        onAcknowledge={() => {}}
        sessionId="s"
      />,
    );
    expect(screen.getByText(/go to the hiring team/)).toBeInTheDocument();
  });
});

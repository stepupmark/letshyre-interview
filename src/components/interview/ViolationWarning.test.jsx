import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import ViolationWarning from "./ViolationWarning";
import interviewEn from "@/i18n/locales/en/interview.json";
import interviewHi from "@/i18n/locales/hi/interview.json";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { interview: interviewEn }, hi: { interview: interviewHi } },
    ns: ["interview"],
    defaultNS: "interview",
    interpolation: { escapeValue: false },
  });
});

afterEach(() => i18next.changeLanguage("en"));

const renderWarning = (props) =>
  render(<ViolationWarning isOpen onClose={() => {}} violationCount={1} {...props} />);

describe("ViolationWarning", () => {
  it("names both devices when a phone and a laptop are caught together", () => {
    renderWarning({
      titleKey: "violations.multipleDevices.title",
      descriptionKey: "violations.multipleDevices.description",
      label: "cell phone",
      labels: ["cell phone", "laptop"],
    });

    expect(screen.getByText("Prohibited Devices Detected")).toBeInTheDocument();
    expect(
      screen.getByText("Please put away your phone and laptop to continue the interview."),
    ).toBeInTheDocument();
  });

  it("shows the combined warning in the candidate's language", async () => {
    await i18next.changeLanguage("hi");
    renderWarning({
      titleKey: "violations.multipleDevices.title",
      descriptionKey: "violations.multipleDevices.description",
      labels: ["cell phone", "laptop"],
    });

    expect(screen.getByText("कई प्रतिबंधित डिवाइस का पता चला")).toBeInTheDocument();
    expect(screen.getByText(/फ़ोन .* लैपटॉप/)).toBeInTheDocument();
  });

  it("counts failed identity checks in the badge instead of a plain warning", () => {
    renderWarning({
      titleKey: "violations.faceMismatch.title",
      descriptionKey: "violations.faceMismatch.description",
      counts: false,
      identityCheck: { count: 1, limit: 3 },
    });

    expect(screen.getByText("Identity check 1 of 3")).toBeInTheDocument();
    expect(screen.queryByText("Warning")).not.toBeInTheDocument();
    expect(screen.getByText(/Stay alone in front of the camera/)).toBeInTheDocument();
  });

  it("lists what else was detected under the current warning", () => {
    renderWarning({
      titleKey: "violations.cellPhone.title",
      descriptionKey: "violations.cellPhone.description",
      alsoDetected: [
        { titleKey: "violations.multipleFaces.title" },
        { titleKey: "violations.prohibitedObject.title", label: "laptop" },
      ],
    });

    expect(screen.getByText("Also detected")).toBeInTheDocument();
    expect(screen.getByText("Multiple People Detected")).toBeInTheDocument();
    expect(screen.getByText("Prohibited Device Detected (laptop)")).toBeInTheDocument();
  });

  it("leaves the list out when nothing else was detected", () => {
    renderWarning({ titleKey: "violations.cellPhone.title" });
    expect(screen.queryByText("Also detected")).not.toBeInTheDocument();
  });

  it("only closes from its button, not from Esc", () => {
    const onClose = vi.fn();
    renderWarning({ titleKey: "violations.cellPhone.title", onClose });

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalled();
  });

  it("says what to do now under the description", () => {
    renderWarning({
      titleKey: "violations.prohibitedObject.title",
      descriptionKey: "violations.prohibitedObject.description",
      fixKey: "inInterview.fix.prohibitedObject",
      label: "laptop",
    });

    expect(
      screen.getByText("Move the laptop out of the room or well out of the camera's view."),
    ).toBeInTheDocument();
  });

  it("is announced as an alert named by its title and described by its text", () => {
    renderWarning({
      titleKey: "violations.tabSwitch.title",
      descriptionKey: "violations.tabSwitch.description",
    });

    const dialog = screen.getByRole("alertdialog", { name: "Tab Switch Detected" });
    expect(dialog).toHaveAccessibleDescription(/Navigating away from the interview screen/);
  });

  it("takes focus while open and gives it back to the answer when closed", async () => {
    const page = (open) => (
      <>
        <textarea aria-label="Answer" />
        <ViolationWarning isOpen={open} onClose={() => {}} titleKey="violations.tabSwitch.title" />
      </>
    );
    const view = render(page(false));
    const answer = screen.getByRole("textbox", { name: "Answer" });
    answer.focus();

    view.rerender(page(true));
    expect(screen.getByRole("alertdialog")).toContainElement(document.activeElement);

    view.rerender(page(false));
    await waitFor(() => expect(answer).toHaveFocus());
  });
});

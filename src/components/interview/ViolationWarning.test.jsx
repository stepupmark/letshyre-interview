import { fireEvent, render, screen } from "@testing-library/react";
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

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalled();
  });
});

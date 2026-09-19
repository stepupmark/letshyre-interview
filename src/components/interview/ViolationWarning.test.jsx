import { render, screen } from "@testing-library/react";
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
});

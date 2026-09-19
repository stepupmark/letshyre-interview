import { render, screen } from "@testing-library/react";
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
});

import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import Header from "./Header";
import commonEn from "@/i18n/locales/en/common.json";
import interviewEn from "@/i18n/locales/en/interview.json";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { common: commonEn, interview: interviewEn } },
    ns: ["common", "interview"],
    defaultNS: "interview",
    interpolation: { escapeValue: false },
  });
});

describe("Header", () => {
  it("has no language picker, the desktop app sets the language", () => {
    render(<Header attempted={1} total={5} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByLabelText(/language/i)).toBeNull();
    expect(screen.getByText(interviewEn.header.recording)).toBeInTheDocument();
  });
});

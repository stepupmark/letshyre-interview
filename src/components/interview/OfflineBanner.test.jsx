import { act, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import OfflineBanner from "./OfflineBanner";
import { MAX_INTERNET_DISCONNECTS } from "@/config/interview";
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

function setOnline(online) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

afterEach(() => vi.restoreAllMocks());

describe("OfflineBanner", () => {
  it("says the answer is safe and counts the disconnect while offline", () => {
    render(<OfflineBanner disconnects={1} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    act(() => setOnline(false));
    expect(screen.getByRole("status")).toHaveTextContent(
      `You're offline. Your answer is saved on this device. Disconnect 1 of ${MAX_INTERNET_DISCONNECTS}.`,
    );

    act(() => setOnline(true));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

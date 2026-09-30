import { fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { InterviewStartFailed } from "./InterviewStartFailed";
import commonEn from "@/i18n/locales/en/common.json";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { common: commonEn } },
    ns: ["common"],
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  delete window.electronAPI;
});

const desktop = () => {
  window.electronAPI = { interviewComplete: vi.fn(), abortInterview: vi.fn() };
  return window.electronAPI;
};

describe("InterviewStartFailed", () => {
  it.each(["exhausted", "rejected", "network", "server"])("has copy for %s", (kind) => {
    render(<InterviewStartFailed failure={{ kind, message: "" }} onRetry={() => {}} />);
    expect(document.body.textContent).not.toMatch(/startFailed\./);
  });

  it("lets a spent attempt out of the lockdown straight away, with no retry", () => {
    const api = desktop();
    render(
      <InterviewStartFailed failure={{ kind: "exhausted", message: "" }} onRetry={() => {}} />,
    );
    expect(api.interviewComplete).toHaveBeenCalledWith("attempts-exhausted");
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Back to dashboard"));
    expect(api.abortInterview).toHaveBeenCalledWith("attempts-exhausted");
  });

  it("offers another try for a server problem and keeps the lockdown meanwhile", () => {
    const api = desktop();
    const onRetry = vi.fn();
    render(<InterviewStartFailed failure={{ kind: "server", message: "" }} onRetry={onRetry} />);
    expect(api.interviewComplete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Try again"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows the server's reason for a rejected start", () => {
    render(
      <InterviewStartFailed
        failure={{ kind: "rejected", message: "Bad role" }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("Bad role")).toBeInTheDocument();
  });

  it("has no dashboard button in a plain browser", () => {
    render(<InterviewStartFailed failure={{ kind: "network", message: "" }} onRetry={() => {}} />);
    expect(screen.queryByText("Back to dashboard")).not.toBeInTheDocument();
  });

  it("shows no reference code", () => {
    render(<InterviewStartFailed failure={{ kind: "server", message: "" }} onRetry={() => {}} />);
    expect(screen.queryByText(/Reference code|LH-/)).not.toBeInTheDocument();
  });
});

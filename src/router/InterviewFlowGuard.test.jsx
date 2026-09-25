import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key }),
}));
vi.mock("@/config/interview", () => ({ MIN_DESKTOP_VERSION: "1.4.5" }));

import { InterviewFlowGuard } from "./InterviewFlowGuard";

const BASE_UA = navigator.userAgent;

function setUserAgent(value) {
  Object.defineProperty(navigator, "userAgent", { value, configurable: true });
}

afterEach(() => {
  setUserAgent(BASE_UA);
  delete window.electronAPI;
});

describe("InterviewFlowGuard", () => {
  it("stops an old desktop app before the interview and lets it close", () => {
    window.electronAPI = { onViolation: vi.fn(), interviewComplete: vi.fn() };
    setUserAgent(`${BASE_UA} LetsHyreSecureInterview/1.4.4`);
    render(<InterviewFlowGuard>interview</InterviewFlowGuard>);

    expect(screen.getByText("desktopUpdate.heading")).toBeInTheDocument();
    expect(screen.queryByText("interview")).not.toBeInTheDocument();
    expect(window.electronAPI.interviewComplete).toHaveBeenCalledWith("update-required");
  });

  it("lets a current desktop app and a plain browser through", () => {
    window.electronAPI = { onViolation: vi.fn() };
    setUserAgent(`${BASE_UA} LetsHyreSecureInterview/1.4.5`);
    const { unmount } = render(<InterviewFlowGuard>interview</InterviewFlowGuard>);
    expect(screen.getByText("interview")).toBeInTheDocument();
    unmount();

    delete window.electronAPI;
    setUserAgent(BASE_UA);
    render(<InterviewFlowGuard>interview</InterviewFlowGuard>);
    expect(screen.getByText("interview")).toBeInTheDocument();
  });
});

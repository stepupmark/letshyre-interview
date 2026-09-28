import { hasActiveInterview, inDesktopApp, leaveToDashboard } from "./desktopExit";

afterEach(() => {
  delete window.electronAPI;
  sessionStorage.clear();
  vi.useRealTimers();
});

describe("leaveToDashboard", () => {
  it("asks the app to back out of the interview", () => {
    window.electronAPI = { abortInterview: vi.fn(), interviewComplete: vi.fn() };
    leaveToDashboard("attempts-exhausted");
    expect(window.electronAPI.abortInterview).toHaveBeenCalledWith("attempts-exhausted");
    expect(window.electronAPI.interviewComplete).not.toHaveBeenCalled();
  });

  it("releases first and waits on an app without abortInterview", () => {
    vi.useFakeTimers();
    window.electronAPI = { interviewComplete: vi.fn(), viewDashboard: vi.fn() };
    leaveToDashboard("start-server");
    expect(window.electronAPI.interviewComplete).toHaveBeenCalledWith("start-server");
    expect(window.electronAPI.viewDashboard).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(window.electronAPI.viewDashboard).toHaveBeenCalled();
  });

  it("ends the session when it can not go on", () => {
    vi.useFakeTimers();
    window.electronAPI = {
      abortInterview: vi.fn(),
      interviewComplete: vi.fn(),
      viewDashboard: vi.fn(),
    };
    leaveToDashboard("unauthorized", { endSession: true });
    expect(window.electronAPI.abortInterview).not.toHaveBeenCalled();
    expect(window.electronAPI.interviewComplete).toHaveBeenCalledWith("unauthorized");
    vi.runAllTimers();
    expect(window.electronAPI.viewDashboard).toHaveBeenCalled();
  });

  it("does nothing in a plain browser", () => {
    expect(inDesktopApp()).toBe(false);
    expect(() => leaveToDashboard("x")).not.toThrow();
  });
});

describe("hasActiveInterview", () => {
  it("is true only for a saved session still running", () => {
    expect(hasActiveInterview()).toBe(false);
    sessionStorage.setItem("interview_session", JSON.stringify({ status: "active" }));
    expect(hasActiveInterview()).toBe(true);
    sessionStorage.setItem("interview_session", JSON.stringify({ status: "completed" }));
    expect(hasActiveInterview()).toBe(false);
    sessionStorage.setItem("interview_session", "{broken");
    expect(hasActiveInterview()).toBe(false);
  });
});

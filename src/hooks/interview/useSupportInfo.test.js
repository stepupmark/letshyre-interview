import { renderHook, waitFor } from "@testing-library/react";
import { useSupportInfo } from "./useSupportInfo";

afterEach(() => {
  delete window.electronAPI;
});

describe("useSupportInfo", () => {
  it("has no contact in a plain browser but still derives the code", () => {
    const { result } = renderHook(() => useSupportInfo("session-456"));
    expect(result.current).toEqual({ contact: null, referenceCode: "LH-3KHH-QEY5" });
  });

  it("takes the contact from the desktop app", async () => {
    window.electronAPI = {
      getSupportContact: () =>
        Promise.resolve({
          url: "https://help.example",
          email: " help@example.com ",
          referenceCode: "x",
        }),
    };
    const { result } = renderHook(() => useSupportInfo("session-456"));

    await waitFor(() =>
      expect(result.current.contact).toEqual({
        url: "https://help.example",
        email: "help@example.com",
      }),
    );
    expect(result.current.referenceCode).toBe("LH-3KHH-QEY5");
  });

  it("falls back to the app's code before there is a session", async () => {
    window.electronAPI = { getSupportContact: () => ({ referenceCode: "LH-AAAA-BBBB" }) };
    const { result } = renderHook(() => useSupportInfo(undefined));

    await waitFor(() => expect(result.current.referenceCode).toBe("LH-AAAA-BBBB"));
    expect(result.current.contact).toBeNull();
  });

  it("survives an app call that fails", async () => {
    window.electronAPI = { getSupportContact: () => Promise.reject(new Error("no handler")) };
    const { result } = renderHook(() => useSupportInfo("session-456"));

    await waitFor(() => expect(result.current.referenceCode).toBe("LH-3KHH-QEY5"));
    expect(result.current.contact).toBeNull();
  });
});

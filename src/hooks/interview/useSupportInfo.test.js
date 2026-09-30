import { renderHook, waitFor } from "@testing-library/react";
import { useSupportInfo } from "./useSupportInfo";

afterEach(() => {
  delete window.electronAPI;
});

describe("useSupportInfo", () => {
  it("has no contact in a plain browser", () => {
    const { result } = renderHook(() => useSupportInfo());
    expect(result.current).toEqual({ contact: null });
  });

  it("takes the contact from the desktop app", async () => {
    window.electronAPI = {
      getSupportContact: () =>
        Promise.resolve({
          url: "https://help.example",
          email: " help@example.com ",
        }),
    };
    const { result } = renderHook(() => useSupportInfo());

    await waitFor(() =>
      expect(result.current.contact).toEqual({
        url: "https://help.example",
        email: "help@example.com",
      }),
    );
  });

  it("survives an app call that fails", async () => {
    const getSupportContact = vi.fn(() => Promise.reject(new Error("no handler")));
    window.electronAPI = { getSupportContact };
    const { result } = renderHook(() => useSupportInfo());

    await waitFor(() => expect(getSupportContact).toHaveBeenCalled());
    expect(result.current.contact).toBeNull();
  });
});

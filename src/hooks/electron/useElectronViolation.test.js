import { renderHook } from "@testing-library/react";
import { useElectronViolation } from "./useElectronViolation";

function installBridge() {
  let handler = null;
  window.electronAPI = {
    onViolation: vi.fn((fn) => {
      handler = fn;
    }),
    removeViolationListener: vi.fn(),
    acknowledgeViolation: vi.fn(),
  };
  return { push: (v) => handler(v) };
}

afterEach(() => {
  delete window.electronAPI;
});

it("acknowledges every violation before handling it", () => {
  const bridge = installBridge();
  const order = [];
  window.electronAPI.acknowledgeViolation.mockImplementation(() => order.push("ack"));
  const onHardBlock = vi.fn(() => order.push("hard"));
  const onSoftBlock = vi.fn(() => order.push("soft"));
  renderHook(() => useElectronViolation({ onHardBlock, onSoftBlock }));

  bridge.push({ event: "Window minimize attempt", isHardBlock: true });
  bridge.push({ event: "Fullscreen exit attempt", isHardBlock: false });

  expect(order).toEqual(["ack", "hard", "ack", "soft"]);
});

it("still acknowledges when the handler throws", () => {
  const bridge = installBridge();
  const onHardBlock = vi.fn(() => {
    throw new Error("boom");
  });
  renderHook(() => useElectronViolation({ onHardBlock }));

  bridge.push({ event: "Attempt to close interview window", isHardBlock: true });

  expect(window.electronAPI.acknowledgeViolation).toHaveBeenCalledTimes(1);
});

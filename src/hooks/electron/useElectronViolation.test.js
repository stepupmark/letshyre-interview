import { renderHook } from "@testing-library/react";
import { useElectronViolation } from "./useElectronViolation";
import { resetElectronDeliveries } from "@/lib/electronViolations";

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

describe("with ids and codes", () => {
  beforeEach(() => resetElectronDeliveries());

  it("acknowledges by id and handles a re-sent violation once", () => {
    const bridge = installBridge();
    const onHardBlock = vi.fn();
    const onSoftBlock = vi.fn();
    renderHook(() => useElectronViolation({ onHardBlock, onSoftBlock }));

    const overlay = { id: "v1", code: "overlay", event: "Overlay", isHardBlock: false };
    bridge.push(overlay);
    bridge.push({ ...overlay, redelivered: true });

    expect(window.electronAPI.acknowledgeViolation.mock.calls).toEqual([["v1"], ["v1"]]);
    expect(onSoftBlock).toHaveBeenCalledTimes(1);
    expect(onHardBlock).not.toHaveBeenCalled();
  });

  it("treats an extra display as a strike even when marked a hard block", () => {
    const bridge = installBridge();
    const onHardBlock = vi.fn();
    const onSoftBlock = vi.fn();
    renderHook(() => useElectronViolation({ onHardBlock, onSoftBlock }));

    bridge.push({ id: "d1", code: "external_display", isHardBlock: true });
    bridge.push({ event: "External display detected", isHardBlock: true });
    bridge.push({ id: "b1", code: "blocked_app", isHardBlock: true });

    expect(onSoftBlock).toHaveBeenCalledTimes(2);
    expect(onHardBlock).toHaveBeenCalledTimes(1);
  });
});

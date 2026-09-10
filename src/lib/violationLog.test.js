import { recordViolationEvent, subscribeToViolationLog } from "./violationLog";

describe("violationLog", () => {
  it("delivers an event to a subscriber", () => {
    const seen = [];
    const stop = subscribeToViolationLog((event) => seen.push(event));

    recordViolationEvent({ source: "ai", outcome: "raised" });

    expect(seen).toEqual([{ source: "ai", outcome: "raised" }]);
    stop();
  });

  it("delivers to every subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeToViolationLog(a);
    const stopB = subscribeToViolationLog(b);

    recordViolationEvent({ source: "tab_switch" });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    stopA();
    stopB();
  });

  it("stops delivering once unsubscribed", () => {
    const listener = vi.fn();
    const stop = subscribeToViolationLog(listener);

    stop();
    recordViolationEvent({ source: "ai" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("drops events on the floor when nobody is listening", () => {
    expect(() => recordViolationEvent({ source: "ai" })).not.toThrow();
  });
});

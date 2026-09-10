import { cooldownFor, createStrikePolicy } from "./strikePolicy";

describe("cooldownFor", () => {
  it("doubles with each repeat and stops at the cap", () => {
    expect(cooldownFor(0)).toBe(30_000);
    expect(cooldownFor(1)).toBe(60_000);
    expect(cooldownFor(2)).toBe(120_000);
    expect(cooldownFor(9)).toBe(120_000);
  });
});

describe("createStrikePolicy", () => {
  it("admits the first violation of a type", () => {
    const policy = createStrikePolicy();
    expect(policy.admit("TAB_SWITCH", { now: 0 })).toBe("raised");
  });

  it("holds a repeat of the same type inside its cooldown", () => {
    const policy = createStrikePolicy();
    policy.admit("TAB_SWITCH", { now: 0 });
    expect(policy.admit("TAB_SWITCH", { now: 20_000 })).toBe("cooldown");
  });

  it("backs the cooldown off on every repeat", () => {
    const policy = createStrikePolicy();
    policy.admit("TAB_SWITCH", { now: 0 });
    expect(policy.admit("TAB_SWITCH", { now: 31_000 })).toBe("raised");
    expect(policy.admit("TAB_SWITCH", { now: 62_000 })).toBe("cooldown");
    expect(policy.admit("TAB_SWITCH", { now: 92_000 })).toBe("raised");
  });

  it("keeps a floor between strikes of different types", () => {
    const policy = createStrikePolicy();
    policy.admit("FULLSCREEN_EXIT", { now: 0 });
    expect(policy.admit("WINDOW_RESIZE", { now: 1_300 })).toBe("strike_interval");
    expect(policy.admit("WINDOW_RESIZE", { now: 16_000 })).toBe("raised");
  });

  it("lets a warn-only violation through the strike floor", () => {
    const policy = createStrikePolicy();
    policy.admit("FULLSCREEN_EXIT", { now: 0 });
    expect(policy.admit("MULTIPLE_FACES", { now: 1_000, countsAsStrike: false })).toBe("raised");
  });

  it("does not start the strike floor from a warn-only violation", () => {
    const policy = createStrikePolicy();
    policy.admit("MULTIPLE_FACES", { now: 0, countsAsStrike: false });
    expect(policy.admit("TAB_SWITCH", { now: 1_000 })).toBe("raised");
  });

  it("suppresses everything for the requested gap", () => {
    const policy = createStrikePolicy();
    policy.suppressFor(10_000, 0);
    expect(policy.admit("TAB_SWITCH", { now: 5_000 })).toBe("suppressed");
    expect(policy.admit("TAB_SWITCH", { now: 11_000 })).toBe("raised");
  });

  it("never shortens an existing suppression", () => {
    const policy = createStrikePolicy();
    policy.suppressFor(10_000, 0);
    policy.suppressFor(1_000, 0);
    expect(policy.admit("TAB_SWITCH", { now: 5_000 })).toBe("suppressed");
  });

  it("forgets everything on reset", () => {
    const policy = createStrikePolicy();
    policy.admit("TAB_SWITCH", { now: 0 });
    policy.reset();
    expect(policy.admit("TAB_SWITCH", { now: 1_000 })).toBe("raised");
  });
});

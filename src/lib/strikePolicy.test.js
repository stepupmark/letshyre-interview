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

  it("reports when a held-back strike can next land", () => {
    const policy = createStrikePolicy();
    expect(policy.nextStrikeAt()).toBe(0);
    policy.admit("TAB_SWITCH", { now: 1_000 });
    expect(policy.nextStrikeAt()).toBe(16_000);
    policy.suppressFor(20_000, 1_000);
    expect(policy.nextStrikeAt()).toBe(21_000);
  });

  it("does not start the gap from a warn-only violation", () => {
    const policy = createStrikePolicy();
    policy.admit("MULTIPLE_FACES", { now: 1_000, countsAsStrike: false });
    expect(policy.nextStrikeAt()).toBe(0);
  });

  it("strikes every new leave of one shared key once, however many events it raises", () => {
    const policy = createStrikePolicy();
    const leave = (startedAt, now) =>
      policy.admit("LEFT_WINDOW", { incident: true, startedAt, maxRestrikes: 0, now });

    expect(leave(0, 0)).toBe("raised");
    expect(leave(0, 5)).toBe("held");
    expect(leave(0, 60_000)).toBe("held");
    expect(leave(3_000, 3_000)).toBe("raised");
    expect(leave(4_000, 4_000)).toBe("raised");
  });

  it("forgets everything on reset", () => {
    const policy = createStrikePolicy();
    policy.admit("TAB_SWITCH", { now: 0 });
    policy.reset();
    expect(policy.admit("TAB_SWITCH", { now: 1_000 })).toBe("raised");
  });

  it("holds the base cooldown while a condition never cleared", () => {
    const policy = createStrikePolicy();
    expect(policy.admit("NO_FACE", { now: 0 })).toBe("raised");
    expect(policy.admit("NO_FACE", { ongoing: true, now: 30_000 })).toBe("raised");
    expect(policy.admit("NO_FACE", { ongoing: true, now: 60_000 })).toBe("raised");
  });

  it("still backs off when a violation clears and comes back", () => {
    const policy = createStrikePolicy();
    expect(policy.admit("NO_FACE", { now: 0 })).toBe("raised");
    expect(policy.admit("NO_FACE", { now: 30_000 })).toBe("raised");
    expect(policy.admit("NO_FACE", { now: 60_000 })).toBe("cooldown");
    expect(policy.admit("NO_FACE", { now: 90_000 })).toBe("raised");
  });

  it("strikes a newly introduced object through every hold", () => {
    const policy = createStrikePolicy();
    policy.admit("NO_FACE", { now: 0 });
    policy.suppressFor(10_000, 0);
    const phone = "PROHIBITED_OBJECT:cell phone";
    expect(policy.admit(phone, { incident: true, startedAt: 1_000, now: 1_000 })).toBe("raised");
  });

  it("still keeps the strike floor for an object that stayed in view", () => {
    const policy = createStrikePolicy();
    const phone = "PROHIBITED_OBJECT:cell phone";
    const held = { incident: true, ongoing: true, startedAt: 0, restrikeAfterMs: 60_000 };
    policy.admit(phone, { incident: true, startedAt: 0, now: 0 });
    policy.admit("TAB_SWITCH", { now: 55_000 });
    expect(policy.admit(phone, { ...held, now: 60_000 })).toBe("strike_interval");
    expect(policy.admit(phone, { ...held, now: 70_000 })).toBe("raised");
  });

  it("re-strikes an object that stays in view on a fixed interval", () => {
    const policy = createStrikePolicy();
    const phone = "PROHIBITED_OBJECT:cell phone";
    const held = { incident: true, ongoing: true, startedAt: 0 };
    expect(policy.admit(phone, { incident: true, startedAt: 0, now: 0 })).toBe("raised");
    expect(policy.admit(phone, { ...held, now: 20_000 })).toBe("cooldown");
    expect(policy.admit(phone, { ...held, now: 30_000 })).toBe("raised");
    expect(policy.admit(phone, { ...held, now: 60_000 })).toBe("raised");
  });

  it("strikes an object brought back even though it confirms on a later frame", () => {
    const policy = createStrikePolicy();
    const phone = "PROHIBITED_OBJECT:cell phone";
    expect(policy.admit(phone, { incident: true, startedAt: 20_000, now: 21_000 })).toBe("raised");
    expect(
      policy.admit(phone, { incident: true, ongoing: true, startedAt: 40_000, now: 42_000 }),
    ).toBe("raised");
  });

  it("treats an object that has never struck as new even while in view", () => {
    const policy = createStrikePolicy();
    policy.admit("TAB_SWITCH", { now: 0 });
    expect(
      policy.admit("PROHIBITED_OBJECT:laptop", {
        incident: true,
        ongoing: true,
        startedAt: 0,
        now: 16_000,
      }),
    ).toBe("raised");
  });

  it("knows whether the current incident has struck", () => {
    const policy = createStrikePolicy();
    policy.admit("PROHIBITED_OBJECT", { incident: true, startedAt: 5_000, now: 5_000 });
    expect(policy.struckSince("PROHIBITED_OBJECT", 5_000)).toBe(true);
    expect(policy.struckSince("PROHIBITED_OBJECT", 90_000)).toBe(false);
    expect(policy.struckSince("NO_FACE", 5_000)).toBe(false);
  });

  it("strikes a held object once more after a minute, then only holds it", () => {
    const policy = createStrikePolicy();
    const rules = { incident: true, startedAt: 0, restrikeAfterMs: 60_000, maxRestrikes: 1 };
    const held = { ...rules, ongoing: true };

    expect(policy.admit("PROHIBITED_OBJECT", { ...rules, now: 0 })).toBe("raised");
    expect(policy.admit("PROHIBITED_OBJECT", { ...held, now: 30_000 })).toBe("cooldown");
    expect(policy.admit("PROHIBITED_OBJECT", { ...held, now: 60_000 })).toBe("raised");
    expect(policy.admit("PROHIBITED_OBJECT", { ...held, now: 120_000 })).toBe("held");
    expect(policy.admit("PROHIBITED_OBJECT", { ...held, now: 600_000 })).toBe("held");
  });

  it("starts the allowance over when the object is brought back", () => {
    const policy = createStrikePolicy();
    const rules = { incident: true, restrikeAfterMs: 60_000, maxRestrikes: 1 };

    policy.admit("PROHIBITED_OBJECT", { ...rules, startedAt: 0, now: 0 });
    policy.admit("PROHIBITED_OBJECT", { ...rules, ongoing: true, startedAt: 0, now: 60_000 });
    expect(policy.admit("PROHIBITED_OBJECT", { ...rules, startedAt: 200_000, now: 200_000 })).toBe(
      "raised",
    );
    expect(
      policy.admit("PROHIBITED_OBJECT", {
        ...rules,
        ongoing: true,
        startedAt: 200_000,
        now: 260_000,
      }),
    ).toBe("raised");
  });
});

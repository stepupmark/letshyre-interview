import { ackMatches, readRulesAck, RULES_ACK_KEY } from "./rulesAck";
import { interviewRules } from "@/config/interviewRules";

const rules = interviewRules({});
const store = (value) => ({ getItem: (key) => (key === RULES_ACK_KEY ? value : null) });

describe("readRulesAck", () => {
  it("reads what the desktop app stored", () => {
    const ack = { ...rules, at: "2026-09-30T10:00:00.000Z" };
    expect(readRulesAck(store(JSON.stringify(ack)))).toEqual(ack);
  });

  it.each([null, "", "not json", "42", JSON.stringify({ strikes: 3 })])("ignores %s", (value) =>
    expect(readRulesAck(store(value))).toBeNull(),
  );
});

describe("ackMatches", () => {
  it("accepts the same version and numbers", () => {
    expect(ackMatches({ ...rules }, rules)).toBe(true);
  });

  it.each([
    ["an older rules version", { version: rules.version - 1 }],
    ["a different strike limit", { strikes: rules.strikes + 1 }],
    ["a missing limit", { heldSeconds: undefined }],
  ])("refuses %s", (_label, change) => {
    expect(ackMatches({ ...rules, ...change }, rules)).toBe(false);
  });

  it("refuses no ack at all", () => {
    expect(ackMatches(null, rules)).toBe(false);
  });
});

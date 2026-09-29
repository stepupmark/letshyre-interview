import { createHash } from "node:crypto";
import { referenceCode, sha256 } from "./referenceCode";

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("sha256", () => {
  it.each(["", "abc", "session-456", "é ✓ 日本", "x".repeat(55), "y".repeat(64), "z".repeat(1000)])(
    "matches node's digest for %j",
    (text) => {
      expect(hex(sha256(text))).toBe(createHash("sha256").update(text).digest("hex"));
    },
  );
});

describe("referenceCode", () => {
  // The desktop app checks against the same vectors.
  it.each([
    ["session-456", "LH-3KHH-QEY5"],
    ["42", "LH-ONDV-ZNAK"],
    ["abc", "LH-XJ4B-NP4P"],
  ])("derives %s as %s", (sessionId, code) => {
    expect(referenceCode(sessionId)).toBe(code);
  });

  it("treats a numeric id like its string", () => {
    expect(referenceCode(42)).toBe(referenceCode("42"));
  });

  it("only uses the RFC 4648 base32 alphabet", () => {
    for (let i = 0; i < 200; i++) {
      expect(referenceCode(`s-${i}`)).toMatch(/^LH-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
  });

  it("has nothing to derive without a session", () => {
    expect(referenceCode(undefined)).toBeNull();
    expect(referenceCode(null)).toBeNull();
    expect(referenceCode("")).toBeNull();
  });
});

import { interviewRules, RULES_VERSION } from "./interviewRules";
import {
  FACE_MISMATCH_LIMIT,
  FACE_MISMATCH_TOTAL_LIMIT,
  HELD_RESTRIKE_SECONDS,
  MAX_INTERNET_DISCONNECTS,
  MAX_VIOLATIONS,
} from "./interview";

describe("interviewRules", () => {
  it("is where the enforced limits come from", () => {
    expect(interviewRules(import.meta.env)).toEqual({
      version: RULES_VERSION,
      strikes: MAX_VIOLATIONS,
      faceInARow: FACE_MISMATCH_LIMIT,
      faceTotal: FACE_MISMATCH_TOTAL_LIMIT,
      disconnects: MAX_INTERNET_DISCONNECTS,
      heldSeconds: HELD_RESTRIKE_SECONDS,
    });
  });

  it("reads the env and falls back on bad values", () => {
    const rules = interviewRules({
      VITE_AI_MAX_VIOLATIONS_ALLOWED: "5",
      VITE_AI_HELD_RESTRIKE_SECONDS: "x",
    });
    expect(rules.strikes).toBe(5);
    expect(rules.heldSeconds).toBe(30);
  });
});

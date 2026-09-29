import contract from "./interview-contract.json";
import { KEY_BY_CODE, resolveElectronViolation } from "@/lib/electronViolations";
import { END_REASONS } from "@/lib/terminationReasons";
import { START_FAILURE, startFailureReason } from "@/lib/startFailure";

// A copy of the desktop app's contract/interview-contract.json, refreshed with
// `pnpm contract:sync <this checkout>` in the app repo.

const codes = contract.violationCodes;

describe("desktop app contract", () => {
  it.each(codes.map((c) => [c.code]))("maps %s to its own copy", (code) => {
    expect(KEY_BY_CODE[code]).toBeDefined();
  });

  it.each(codes.filter((c) => c.neverHardBlock).map((c) => [c.code]))(
    "never ends the interview for %s",
    (code) => {
      const { strike, logOnly } = resolveElectronViolation({ code, isHardBlock: true });
      expect(strike || logOnly).toBe(true);
    },
  );

  it("sends only interviewComplete reasons the contract lists", () => {
    const listed = contract.reasons.interviewComplete.map((r) => r.reason);
    expect(listed).toEqual(expect.arrayContaining(Object.values(END_REASONS)));
  });

  it("sends only abortInterview start reasons the contract lists", () => {
    const listed = contract.reasons.abortInterview.map((r) => r.reason);
    const sent = Object.values(START_FAILURE).map(startFailureReason);
    expect(listed).toEqual(expect.arrayContaining(sent));
  });
});

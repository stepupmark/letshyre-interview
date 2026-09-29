import { afterEach, describe, expect, it, vi } from "vitest";
import { RUN_ID, correlation, correlationTag, setCorrelationSession } from "./correlation";
import { logger } from "./logger";

describe("correlation", () => {
  afterEach(() => {
    setCorrelationSession(null);
    vi.restoreAllMocks();
  });

  it("gives the page load a short run id that stays put", () => {
    expect(RUN_ID).toMatch(/^[0-9a-f]{12}$/);
    expect(correlation().run_id).toBe(RUN_ID);
  });

  it("adds the session id once it is known", () => {
    expect(correlation()).toEqual({ run_id: RUN_ID });

    setCorrelationSession(42);

    expect(correlation()).toEqual({ run_id: RUN_ID, session_id: 42 });
    expect(correlationTag()).toBe(`[run ${RUN_ID} session 42]`);
  });

  it("tags logger errors so they can be matched to the proctoring log", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setCorrelationSession("s1");

    logger.error("[Proctoring] failed", 500);

    expect(error).toHaveBeenCalledWith(`[run ${RUN_ID} session s1]`, "[Proctoring] failed", 500);
  });
});

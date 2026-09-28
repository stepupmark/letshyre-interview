import { classifyStartFailure, isRetryableStartFailure, startFailureReason } from "./startFailure";

const httpError = (status, data) => ({ response: { status, data } });

describe("classifyStartFailure", () => {
  it("reads a spent attempt from the message the backend sends today", () => {
    const error = httpError(400, {
      success: false,
      status: 400,
      message: "Maximum 3 attempts completed. You cannot take more interviews.",
    });
    expect(classifyStartFailure(error)).toEqual({
      kind: "exhausted",
      message: "Maximum 3 attempts completed. You cannot take more interviews.",
    });
  });

  it("prefers an error code when there is one", () => {
    expect(classifyStartFailure(httpError(403, { error_code: "attempts_exhausted" })).kind).toBe(
      "exhausted",
    );
  });

  it("splits the rest by what trying again could fix", () => {
    expect(classifyStartFailure(httpError(400, { message: "Invalid role" })).kind).toBe("rejected");
    expect(classifyStartFailure(httpError(502, {})).kind).toBe("server");
    expect(classifyStartFailure(new Error("Network Error")).kind).toBe("network");
    expect(classifyStartFailure({ code: "ECONNABORTED" }).kind).toBe("network");
    expect(classifyStartFailure({ startResponse: { success: false } }).kind).toBe("rejected");
  });
});

describe("isRetryableStartFailure", () => {
  it("only offers another try for a connection or server problem", () => {
    expect(["network", "server"].every(isRetryableStartFailure)).toBe(true);
    expect(["exhausted", "rejected"].some(isRetryableStartFailure)).toBe(false);
  });
});

describe("startFailureReason", () => {
  it("names a spent attempt so the app can say so on its dashboard", () => {
    expect(startFailureReason("exhausted")).toBe("attempts-exhausted");
    expect(startFailureReason("server")).toBe("start-server");
  });
});

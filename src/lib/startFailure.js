export const START_FAILURE = {
  EXHAUSTED: "exhausted",
  REJECTED: "rejected",
  NETWORK: "network",
  SERVER: "server",
};

const EXHAUSTED_CODES = new Set(["ATTEMPTS_EXHAUSTED", "MAX_ATTEMPTS_REACHED"]);

/**
 * Why the start request failed, from an axios error or a success:false body.
 * The backend has no error code for a spent attempt yet, so its message is read too.
 * @returns {{ kind: string, message: string }}
 */
export function classifyStartFailure(error) {
  const response = error?.response;
  const body = response?.data ?? error?.startResponse ?? null;
  const message = typeof body?.message === "string" ? body.message : "";

  if (!response && !error?.startResponse) return { kind: START_FAILURE.NETWORK, message };

  const status = Number(response?.status ?? body?.status);
  if (status >= 500) return { kind: START_FAILURE.SERVER, message };

  const code = String(body?.error_code ?? body?.code ?? "").toUpperCase();
  if (EXHAUSTED_CODES.has(code) || /\battempts?\b/i.test(message)) {
    return { kind: START_FAILURE.EXHAUSTED, message };
  }
  return { kind: START_FAILURE.REJECTED, message };
}

export const isRetryableStartFailure = (kind) =>
  kind === START_FAILURE.NETWORK || kind === START_FAILURE.SERVER;

/** The reason the desktop app is given, which picks the note on its dashboard. */
export const startFailureReason = (kind) =>
  kind === START_FAILURE.EXHAUSTED ? "attempts-exhausted" : `start-${kind}`;

/**
 * Ties the proctoring log and console errors to one interview and one page
 * load. A reload keeps the session id but gets a new run id, so a reviewer can
 * tell which records came from before and after it.
 */

function makeRunId() {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(16).slice(2, 14).padEnd(12, "0");
  }
}

export const RUN_ID = makeRunId();

let sessionId = null;

export function setCorrelationSession(id) {
  sessionId = id === undefined || id === "" ? null : id;
}

export function correlation() {
  return { run_id: RUN_ID, ...(sessionId === null ? {} : { session_id: sessionId }) };
}

export function correlationTag() {
  return sessionId === null ? `[run ${RUN_ID}]` : `[run ${RUN_ID} session ${sessionId}]`;
}

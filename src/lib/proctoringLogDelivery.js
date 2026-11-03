/**
 * Gets one proctoring log batch to the backend.
 *
 * Inside the desktop app the batch is handed to the app, which keeps it on
 * disk and sends it from the main process: that survives the window closing,
 * a crash and a relaunch. The backend keeps one batch per interview, so once
 * the app has it the page must not send it too. Anywhere else (a browser, or
 * an app build older than contract v5) the page POSTs it itself.
 */

import { submitProctoringLogs } from "@/services/proctoring.api";
import { deleteLog, loadLogs } from "@/lib/proctoringLogStore";
import { logger } from "@/lib/logger";

export const DELIVERY = Object.freeze({ HANDED_OVER: "handed_over", SENT: "sent" });

// An entry nobody has written to for this long belongs to a page that is gone.
export const ABANDONED_AFTER_MS = 10 * 60 * 1000;

/**
 * @param {object} payload - the body for proctoring/log/
 * @returns {Promise<"handed_over"|"sent">} rejects when it could not be sent
 */
export async function deliverLog(payload) {
  const handOver = window.electronAPI?.submitProctoringLog;
  if (typeof handOver === "function") {
    try {
      const result = await handOver(payload, sessionStorage.getItem("ac") ?? undefined);
      if (result?.ok) return DELIVERY.HANDED_OVER;
      logger.warn("[ProctoringLog] the app refused the log, sending it directly:", result?.error);
    } catch (err) {
      logger.warn("[ProctoringLog] hand-over to the app failed, sending directly:", err?.message);
    }
  }
  await submitProctoringLogs(payload);
  return DELIVERY.SENT;
}

export function payloadFromEntry(entry) {
  return {
    interview_id: entry.interview_id,
    session_id: entry.session_id,
    run_id: entry.run_id,
    proctoring_token: entry.proctoring_token,
    source: "cv_detect",
    event_type: "batch_proctoring_logs",
    payload: { total_records: entry.records.length, records: entry.records },
  };
}

export const isRefused = (status) =>
  status >= 400 && status < 500 && ![401, 408, 429].includes(status);

function isOwed(entry, currentSessionId, now) {
  if (!entry?.session_id || !entry.interview_id || !entry.records?.length) return false;
  if (currentSessionId != null && entry.session_id === String(currentSessionId)) return false;
  return entry.ended === true || now - (entry.updated_at ?? 0) >= ABANDONED_AFTER_MS;
}

/**
 * Sends the logs earlier pages kept but never delivered (the window closed,
 * the app quit, every send failed). Left alone: the current session's, and one
 * another open tab may still be writing.
 * @returns {Promise<number>} how many were delivered
 */
export async function resendKeptLogs(currentSessionId, now = Date.now()) {
  const entries = (await loadLogs()).filter((entry) => isOwed(entry, currentSessionId, now));
  let delivered = 0;
  for (const entry of entries) {
    // Its page already sent it while unloading; a second copy would be a
    // second batch for the same interview.
    if (entry.sent_at_unload) {
      await deleteLog(entry.session_id);
      continue;
    }
    try {
      const how = await deliverLog(payloadFromEntry(entry));
      await deleteLog(entry.session_id);
      delivered += 1;
      logger.log(`[ProctoringLog] kept log for session ${entry.session_id} ${how}.`);
    } catch (err) {
      const status = err?.response?.status;
      // Refused outright (usually: the backend already has this interview's
      // batch). Retrying on every page load would never change that.
      if (isRefused(status)) {
        await deleteLog(entry.session_id);
        logger.warn(
          `[ProctoringLog] kept log for session ${entry.session_id} refused (${status}).`,
        );
        continue;
      }
      logger.warn(
        `[ProctoringLog] kept log for session ${entry.session_id} still not sent:`,
        status ?? err?.message,
      );
    }
  }
  return delivered;
}

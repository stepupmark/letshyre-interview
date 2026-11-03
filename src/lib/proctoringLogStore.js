/**
 * The proctoring log, kept in IndexedDB while it is unsent.
 *
 * The log used to live only in memory until the one send at the end, so a
 * crash, reload or closed window lost all of it. One entry per session holds
 * the records so far; it is removed once the batch is delivered (or handed to
 * the desktop app, which keeps its own copy until then).
 *
 * Every call resolves, never rejects: without IndexedDB (private mode, tests,
 * a full disk) the log simply isn't kept, which is how it worked before.
 */

import { logger } from "@/lib/logger";

const DB_NAME = "letshyre-proctoring";
const DB_VERSION = 1;
const STORE = "logs";

let opening = null;

function openDb() {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "session_id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        logger.warn("[ProctoringLogStore] IndexedDB unavailable:", request.error?.message);
        resolve(null);
      };
      request.onblocked = () => resolve(null);
    } catch (err) {
      logger.warn("[ProctoringLogStore] IndexedDB unavailable:", err?.message);
      resolve(null);
    }
  }).then((db) => {
    // A failed open is retried on the next call rather than remembered.
    if (!db) opening = null;
    return db;
  });
  return opening;
}

async function run(mode, action, fallback) {
  const db = await openDb();
  if (!db) return fallback;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request?.result ?? fallback);
      tx.onerror = () => {
        logger.warn("[ProctoringLogStore] write failed:", tx.error?.message);
        resolve(fallback);
      };
      tx.onabort = () => resolve(fallback);
    } catch (err) {
      logger.warn("[ProctoringLogStore] write failed:", err?.message);
      resolve(fallback);
    }
  });
}

/**
 * @param {{
 *   session_id: string, interview_id: string, run_id: string,
 *   proctoring_token?: string, records: object[], ended: boolean,
 * }} entry
 */
export function saveLog(entry) {
  if (!entry?.session_id) return Promise.resolve(false);
  const kept = { ...entry, session_id: String(entry.session_id), updated_at: Date.now() };
  return run("readwrite", (store) => store.put(kept), false).then((key) => key !== false);
}

/** @returns {Promise<object[]>} every kept entry */
export function loadLogs() {
  return run("readonly", (store) => store.getAll(), []);
}

export function deleteLog(sessionId) {
  if (!sessionId) return Promise.resolve();
  return run("readwrite", (store) => store.delete(String(sessionId)), undefined);
}

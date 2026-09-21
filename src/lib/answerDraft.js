import { useEffect, useState } from "react";

const PREFIX = "answer_draft:";

export const draftKeyFor = (session) =>
  session ? `${PREFIX}${session.interview_id}:${session.current_index || 1}` : null;

export function readDraft(key) {
  if (!key) return "";
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(key, value) {
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // storage full or blocked; the answer still lives in component state
  }
}

export function clearDrafts() {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(PREFIX))
      .forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // nothing to clear
  }
}

// Kept in sessionStorage so a reload doesn't lose the answer and auto-submit can send it.
export function useAnswerDraft(key) {
  const [value, setValue] = useState(() => readDraft(key));

  useEffect(() => {
    writeDraft(key, value);
  }, [key, value]);

  return [value, setValue];
}

// The limits the candidate is told about before the interview. Read from the
// same env as the rest of the config, and published at build time as
// /interview-rules.json so the desktop app shows the same numbers.
// Bump RULES_VERSION when the rules text changes, not just a number.
export const RULES_VERSION = 1;

export const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function interviewRules(env) {
  return {
    version: RULES_VERSION,
    strikes: num(env.VITE_AI_MAX_VIOLATIONS_ALLOWED, 3),
    faceInARow: num(env.VITE_AI_FACE_MISMATCH_LIMIT, 2),
    faceTotal: num(env.VITE_AI_FACE_MISMATCH_TOTAL_LIMIT, 3),
    disconnects: num(env.VITE_AI_MAX_INTERNET_DISCONNECTS, 3),
    heldSeconds: num(env.VITE_AI_HELD_RESTRIKE_SECONDS, 30),
  };
}

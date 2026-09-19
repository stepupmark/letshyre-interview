const GAP_MS = 6_000;
const MISSES = 2;

const KEY_RULES = {
  NO_FACE: { gapMs: 1_500, misses: 1 },
};

/**
 * Tracks start timestamps for active violation incidents across frames.
 */
export function createIncidentTracker({
  gapMs = GAP_MS,
  misses = MISSES,
  keyRules = KEY_RULES,
} = {}) {
  let seen = new Map();

  return {
    observe(keys, now = Date.now()) {
      const present = new Set(keys);
      for (const [key, entry] of seen) {
        if (!present.has(key)) entry.misses += 1;
      }
      for (const key of present) {
        const entry = seen.get(key);
        const rule = keyRules[key] ?? { gapMs, misses };
        const returned =
          !entry || (entry.misses >= rule.misses && now - entry.lastSeenAt >= rule.gapMs);
        seen.set(key, { startedAt: returned ? now : entry.startedAt, lastSeenAt: now, misses: 0 });
      }
    },

    startedAt(key) {
      return seen.get(key)?.startedAt;
    },

    reset() {
      seen = new Map();
    },
  };
}

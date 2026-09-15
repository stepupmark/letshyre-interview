// An object has to be gone for two samples and at least this long before its
// return counts as a new incident, so one missed detection can't strike twice.
const GAP_MS = 6_000;
const MISSES = 2;

/**
 * Remembers when each violation's current incident began. Observe a frame
 * before judging it: a violation only confirms on a later sighting, so asking
 * "was it here last frame" at that point is always yes.
 */
export function createIncidentTracker({ gapMs = GAP_MS, misses = MISSES } = {}) {
  let seen = new Map();

  return {
    observe(keys, now = Date.now()) {
      const present = new Set(keys);
      for (const [key, entry] of seen) {
        if (!present.has(key)) entry.misses += 1;
      }
      for (const key of present) {
        const entry = seen.get(key);
        const returned = !entry || (entry.misses >= misses && now - entry.lastSeenAt >= gapMs);
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

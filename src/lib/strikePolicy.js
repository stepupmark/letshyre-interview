/**
 * Decides whether a confirmed violation is allowed to reach the candidate.
 * Every source goes through here, so one action raising two events, like a
 * fullscreen exit and the resize behind it, can't strike twice.
 */

const COOLDOWN_MS = 30_000;
// Repeats of the same violation back off. A condition that never stopped is not
// a repeat, so it holds the base cooldown instead of sliding into silence.
const MAX_COOLDOWN_MS = 120_000;
// After a strike the candidate gets this long to read the warning and react
// before another can land. Whatever is held back meanwhile lands after it.
export const REACTION_WINDOW_MS = 10_000;
// Periodic re-evaluation interval for sustained incidents.
const INCIDENT_RESTRIKE_MS = 30_000;

export function cooldownFor(repeats, base = COOLDOWN_MS, cap = MAX_COOLDOWN_MS) {
  return Math.min(base * 2 ** repeats, cap);
}

export function createStrikePolicy(options = {}) {
  const {
    cooldownMs = COOLDOWN_MS,
    maxCooldownMs = MAX_COOLDOWN_MS,
    reactionWindowMs = REACTION_WINDOW_MS,
    restrikeMs = INCIDENT_RESTRIKE_MS,
  } = options;

  let lastRaisedAt = new Map();
  let struckAt = new Map();
  let restrikes = new Map();
  let repeats = new Map();
  let lastStrikeAt = null;

  function record(type, now, countsAsStrike, ongoing) {
    lastRaisedAt.set(type, now);
    const seen = repeats.get(type) ?? 0;
    repeats.set(type, ongoing ? Math.max(seen, 1) : seen + 1);
    if (countsAsStrike) {
      lastStrikeAt = now;
      struckAt.set(type, now);
    }
    return "raised";
  }

  return {
    admit(
      type,
      {
        countsAsStrike = true,
        ongoing = false,
        incident = false,
        startedAt,
        restrikeAfterMs = restrikeMs,
        maxRestrikes = Infinity,
        // Strikes already waiting go first, so a newcomer can't jump the queue.
        defer = false,
        now = Date.now(),
      } = {},
    ) {
      const perIncident = incident && countsAsStrike;
      const struck = struckAt.get(type);
      const holdStrike =
        countsAsStrike &&
        (defer || (lastStrikeAt !== null && now - lastStrikeAt < reactionWindowMs));

      // The holds below stop one act from striking twice. Bringing an object
      // back is a second act, so a new incident only waits for the reaction window.
      const newIncident =
        struck === undefined || (startedAt === undefined ? !ongoing : struck < startedAt);
      if (perIncident && newIncident) {
        if (holdStrike) return "reaction_window";
        restrikes.set(type, 0);
        return record(type, now, true, false);
      }

      if (perIncident && (restrikes.get(type) ?? 0) >= maxRestrikes) return "held";

      const previous = perIncident ? struck : lastRaisedAt.get(type);
      if (previous !== undefined) {
        const wait = perIncident
          ? restrikeAfterMs
          : cooldownFor((repeats.get(type) ?? 1) - 1, cooldownMs, maxCooldownMs);
        if (now - previous < wait) return "cooldown";
      }

      if (holdStrike) return "reaction_window";

      if (perIncident) restrikes.set(type, (restrikes.get(type) ?? 0) + 1);
      return record(type, now, countsAsStrike, ongoing);
    },

    // When a strike held back by the reaction window can next land.
    nextStrikeAt() {
      return lastStrikeAt === null ? 0 : lastStrikeAt + reactionWindowMs;
    },

    struckSince(type, startedAt) {
      const at = struckAt.get(type);
      return at !== undefined && (startedAt === undefined || at >= startedAt);
    },

    reset() {
      lastRaisedAt = new Map();
      struckAt = new Map();
      restrikes = new Map();
      repeats = new Map();
      lastStrikeAt = null;
    },
  };
}

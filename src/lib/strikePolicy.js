/**
 * Decides whether a confirmed violation is allowed to reach the candidate.
 * Every source goes through here, so one action raising two events, like a
 * fullscreen exit and the resize behind it, can't strike twice.
 */

const COOLDOWN_MS = 30_000;
// Repeats of the same violation back off. A condition that never stopped is not
// a repeat, so it holds the base cooldown instead of sliding into silence.
const MAX_COOLDOWN_MS = 120_000;
// Floor between strikes of any type, so one bad moment can't burn two strikes.
const MIN_STRIKE_INTERVAL_MS = 15_000;
// Prohibited objects count per incident: bringing one into view strikes, and
// keeping it there strikes again on this interval.
const INCIDENT_RESTRIKE_MS = 30_000;

export function cooldownFor(repeats, base = COOLDOWN_MS, cap = MAX_COOLDOWN_MS) {
  return Math.min(base * 2 ** repeats, cap);
}

export function createStrikePolicy(options = {}) {
  const {
    cooldownMs = COOLDOWN_MS,
    maxCooldownMs = MAX_COOLDOWN_MS,
    minStrikeIntervalMs = MIN_STRIKE_INTERVAL_MS,
    restrikeMs = INCIDENT_RESTRIKE_MS,
  } = options;

  let lastRaisedAt = new Map();
  let struckAt = new Map();
  let repeats = new Map();
  let lastStrikeAt = null;
  let suppressUntil = 0;

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
        now = Date.now(),
      } = {},
    ) {
      const perIncident = incident && countsAsStrike;
      const struck = struckAt.get(type);

      // The holds below stop one act from striking twice. Bringing an object
      // back is a second act, so a new incident goes straight through.
      const newIncident =
        struck === undefined || (startedAt === undefined ? !ongoing : struck < startedAt);
      if (perIncident && newIncident) return record(type, now, true, false);

      if (now < suppressUntil) return "suppressed";

      const previous = perIncident ? struck : lastRaisedAt.get(type);
      if (previous !== undefined) {
        const wait = perIncident
          ? restrikeMs
          : cooldownFor((repeats.get(type) ?? 1) - 1, cooldownMs, maxCooldownMs);
        if (now - previous < wait) return "cooldown";
      }

      if (countsAsStrike && lastStrikeAt !== null && now - lastStrikeAt < minStrikeIntervalMs) {
        return "strike_interval";
      }

      return record(type, now, countsAsStrike, ongoing);
    },

    struckWithin(type, ms = restrikeMs, now = Date.now()) {
      const at = struckAt.get(type);
      return at !== undefined && now - at < ms;
    },

    // Used after the modal closes itself rather than by a candidate action: the
    // open modal was the only thing holding back the next strike, so releasing
    // it needs to leave a gap behind.
    suppressFor(ms, now = Date.now()) {
      suppressUntil = Math.max(suppressUntil, now + ms);
    },

    reset() {
      lastRaisedAt = new Map();
      struckAt = new Map();
      repeats = new Map();
      lastStrikeAt = null;
      suppressUntil = 0;
    },
  };
}

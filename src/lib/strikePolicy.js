/**
 * Decides whether a confirmed violation is allowed to reach the candidate.
 *
 * Every source goes through here. Previously only the AI path had a cooldown,
 * so a tab switch or a fullscreen exit struck instantly and could strike again
 * a second later — one fullscreen exit raising both a fullscreenchange and a
 * resize violation was two strikes for one action.
 */

const COOLDOWN_MS = 30_000;
// Repeats of the same violation back off, so a candidate glancing at a phone on
// their desk doesn't burn every strike inside a minute.
const MAX_COOLDOWN_MS = 120_000;
// Floor between strikes of ANY type, so one bad moment producing two different
// violations can't burn two of the three allowed strikes in a few seconds.
const MIN_STRIKE_INTERVAL_MS = 15_000;

export function cooldownFor(repeats, base = COOLDOWN_MS, cap = MAX_COOLDOWN_MS) {
  return Math.min(base * 2 ** repeats, cap);
}

export function createStrikePolicy(options = {}) {
  const {
    cooldownMs = COOLDOWN_MS,
    maxCooldownMs = MAX_COOLDOWN_MS,
    minStrikeIntervalMs = MIN_STRIKE_INTERVAL_MS,
  } = options;

  let lastRaisedAt = new Map();
  let repeats = new Map();
  let lastStrikeAt = null;
  let suppressUntil = 0;

  return {
    admit(type, { countsAsStrike = true, now = Date.now() } = {}) {
      if (now < suppressUntil) return "suppressed";

      const previous = lastRaisedAt.get(type);
      if (previous !== undefined) {
        const wait = cooldownFor((repeats.get(type) ?? 1) - 1, cooldownMs, maxCooldownMs);
        if (now - previous < wait) return "cooldown";
      }

      if (countsAsStrike && lastStrikeAt !== null && now - lastStrikeAt < minStrikeIntervalMs) {
        return "strike_interval";
      }

      lastRaisedAt.set(type, now);
      repeats.set(type, (repeats.get(type) ?? 0) + 1);
      if (countsAsStrike) lastStrikeAt = now;

      return "raised";
    },

    // Used after the modal closes itself rather than by a candidate action: the
    // open modal was the only thing holding back the next strike, so releasing
    // it needs to leave a gap behind.
    suppressFor(ms, now = Date.now()) {
      suppressUntil = Math.max(suppressUntil, now + ms);
    },

    reset() {
      lastRaisedAt = new Map();
      repeats = new Map();
      lastStrikeAt = null;
      suppressUntil = 0;
    },
  };
}

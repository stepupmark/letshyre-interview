/**
 * Separates objects that were already in the room from ones brought into frame
 * during the interview.
 *
 * A second screen on the desk is an environment problem: the candidate is told
 * and given time to clear it. A phone that appears mid-session is misconduct.
 * The two look identical in any single frame — only their history tells them
 * apart, so anything static from the opening ticks is treated as furniture.
 */

// The room gets the opening couple of observations to settle. Bounded on both
// ticks and wall-clock because either alone breaks: burst sampling can fire
// three ticks in two seconds, and degraded backoff can stretch two ticks across
// eighty.
const BASELINE_TICKS = 2;
const BASELINE_WINDOW_MS = 15_000;
const GRACE_MS = 60_000;
const TTL_MS = 30_000;

// Observed background objects drift under 1px between ticks; a device being
// handled moves far more.
const STATIC_DRIFT_PX = 12;
const MIN_MATCH_PX = 24;

function centroid(bbox) {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = bbox || [];
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createBaselineTracker(options = {}) {
  const {
    baselineTicks = BASELINE_TICKS,
    baselineWindowMs = BASELINE_WINDOW_MS,
    graceMs = GRACE_MS,
    ttlMs = TTL_MS,
    staticDriftPx = STATIC_DRIFT_PX,
  } = options;

  let startedAt = null;
  let ticks = 0;
  let tracked = [];

  function match(label, point) {
    let best = null;
    let bestDistance = Infinity;

    for (const record of tracked) {
      if (record.label !== label) continue;
      const gap = distance(record.last, point);
      const tolerance = Math.max(MIN_MATCH_PX, 0.6 * Math.max(point.w, point.h));
      if (gap <= tolerance && gap < bestDistance) {
        best = record;
        bestDistance = gap;
      }
    }

    return best;
  }

  return {
    start(now = Date.now()) {
      startedAt = now;
      ticks = 0;
      tracked = [];
    },

    reset() {
      startedAt = null;
      ticks = 0;
      tracked = [];
    },

    classify(objects, now = Date.now()) {
      if (startedAt === null) startedAt = now;
      const tick = ticks++;

      // A record that outlives its TTL is gone for good; anything at that spot
      // afterwards is a new object, not the old one reappearing.
      tracked = tracked.filter((record) => now - record.lastSeenAt <= ttlMs);

      return (objects || []).map((object) => {
        const point = centroid(object?.bbox);
        let record = match(object?.label, point);

        if (record) {
          record.last = point;
          record.lastSeenAt = now;
        } else {
          record = {
            label: object?.label,
            origin: point,
            last: point,
            firstSeenTick: tick,
            firstSeenAt: now,
            lastSeenAt: now,
          };
          tracked.push(record);
        }

        const settledEarly =
          record.firstSeenTick < baselineTicks &&
          record.firstSeenAt - startedAt <= baselineWindowMs;
        const isEnvironment = settledEarly && distance(record.origin, point) <= staticDriftPx;

        if (!isEnvironment) return { object, state: "introduced" };
        if (now - record.firstSeenAt > graceMs) return { object, state: "expired" };
        return { object, state: "baseline" };
      });
    },
  };
}

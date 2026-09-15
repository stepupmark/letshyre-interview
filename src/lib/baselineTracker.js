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
const GRACE_MS = 30_000;
const TTL_MS = 30_000;

// Observed background objects drift under 1px between ticks; a device being
// handled moves far more. Both thresholds are fractions of the frame's own
// scale, because the detector reports boxes in its resolution, not the one we
// upload.
const STATIC_DRIFT_RATIO = 0.025;
const MIN_MATCH_RATIO = 0.05;
const FALLBACK_FRAME_PX = 480;

function centroid(bbox) {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = bbox || [];
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// The payload never states the frame size, but a box and its area ratio imply it.
function frameScale(object) {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = object?.bbox || [];
  const area = Math.abs(x2 - x1) * Math.abs(y2 - y1);
  const ratio = object?.area_ratio;
  if (!area || !ratio) return FALLBACK_FRAME_PX;
  return Math.sqrt(area / ratio);
}

export function createBaselineTracker(options = {}) {
  const {
    baselineTicks = BASELINE_TICKS,
    baselineWindowMs = BASELINE_WINDOW_MS,
    graceMs = GRACE_MS,
    ttlMs = TTL_MS,
    staticDriftRatio = STATIC_DRIFT_RATIO,
  } = options;

  let startedAt = null;
  let ticks = 0;
  let tracked = [];

  function match(label, point, scale) {
    let best = null;
    let bestDistance = Infinity;

    for (const record of tracked) {
      if (record.label !== label) continue;
      const gap = distance(record.last, point);
      const tolerance = Math.max(MIN_MATCH_RATIO * scale, 0.6 * Math.max(point.w, point.h));
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
        const scale = frameScale(object);
        const point = centroid(object?.bbox);
        let record = match(object?.label, point, scale);

        if (record) {
          record.last = point;
          record.lastSeenAt = now;
          record.seen += 1;
        } else {
          record = {
            label: object?.label,
            origin: point,
            last: point,
            firstSeenTick: tick,
            firstSeenAt: now,
            lastSeenAt: now,
            seen: 1,
          };
          tracked.push(record);
        }

        const settledEarly =
          record.firstSeenTick < baselineTicks &&
          record.firstSeenAt - startedAt <= baselineWindowMs;
        const isEnvironment =
          settledEarly && distance(record.origin, point) <= staticDriftRatio * scale;

        if (!isEnvironment) return { object, state: "introduced" };
        // Furniture has to prove it holds still before it earns the grace; on a
        // first sighting there is nothing yet to tell a desk lamp from a phone
        // someone just picked up.
        if (record.seen < baselineTicks) return { object, state: "pending" };
        if (now - record.firstSeenAt > graceMs) return { object, state: "expired" };
        return { object, state: "baseline" };
      });
    },
  };
}

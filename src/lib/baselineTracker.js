/**
 * Tracks and classifies background environment objects versus newly introduced items.
 * Static objects observed during the calibration phase are treated as baseline environment.
 */

// Calibration window constraints for establishing baseline environment.
const BASELINE_TICKS = 2;
const BASELINE_WINDOW_MS = 15_000;
// Furniture gets this long to be cleared before it counts like anything else.
const GRACE_MS = 30_000;
const TTL_MS = 30_000;

// Spatial drift thresholds relative to detected bounding box scale.
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

// Estimate frame scale from bounding box area and relative area ratio.
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

      // Evict stale records exceeding TTL.
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
        // Require consecutive static observations before granting baseline exemption.
        if (record.seen < baselineTicks) return { object, state: "pending" };
        if (now - record.firstSeenAt > graceMs) return { object, state: "expired" };
        return { object, state: "baseline" };
      });
    },
  };
}

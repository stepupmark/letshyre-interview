/**
 * Temporal confirmation for CV detection results.
 *
 * One frame is not evidence: motion blur, a glance away, or a single bad YOLO
 * box each produce a violation on exactly one tick. Every type carries its own
 * sliding window, so a detection that flickers off for a frame still confirms,
 * and a candidate alternating between two violations can't reset both.
 *
 * Callers can pass a narrower `key` than the type — object violations use
 * "PROHIBITED_OBJECT:<label>" so a laptop on the desk can't bank evidence
 * towards confirming a phone, while the same phone flipping between furniture
 * and handled keeps one window.
 */

const CONFIRM_RULES = {
  NO_FACE: { needed: 2, window: 3 },
  MULTIPLE_FACES: { needed: 2, window: 3 },
  PROHIBITED_OBJECT: { needed: 2, window: 3 },
  FACE_MISMATCH: { needed: 3, window: 5 },
  NOT_LOOKING: { needed: 3, window: 5 },
  EYES_CLOSED: { needed: 3, window: 5 },
};

const DEFAULT_RULE = { needed: 2, window: 3 };

export function confirmRuleFor(key) {
  return CONFIRM_RULES[String(key).split(":")[0]] ?? DEFAULT_RULE;
}

export function createViolationStabilizer() {
  const windows = new Map();

  function observe(key, hit) {
    const { needed, window } = confirmRuleFor(key);
    const buffer = windows.get(key) ?? [];

    buffer.push(hit);
    if (buffer.length > window) buffer.shift();
    windows.set(key, buffer);

    return buffer.filter(Boolean).length >= needed;
  }

  return {
    push(violation) {
      const seen = violation ? (violation.key ?? violation.type) : null;

      for (const key of windows.keys()) {
        if (key !== seen) observe(key, false);
      }

      if (!seen) return null;
      return observe(seen, true) ? violation : null;
    },

    // Called only once a confirmed violation actually reaches the candidate.
    // Holding the window until then means one dropped by a cooldown keeps its
    // evidence instead of rebuilding from nothing.
    commit(key) {
      windows.delete(key);
    },

    reset() {
      windows.clear();
    },

    peek() {
      const state = {};
      for (const [type, buffer] of windows) {
        state[type] = { hits: buffer.filter(Boolean).length, size: buffer.length };
      }
      return state;
    },
  };
}

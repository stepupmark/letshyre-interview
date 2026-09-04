/**
 * Temporal confirmation for CV detection results.
 *
 * A single frame is not enough evidence to strike a candidate: motion blur, a
 * glance away, a momentary lean out of frame, or one low-quality YOLO box all
 * produce a violation on exactly one tick. Requiring the same type to repeat on
 * consecutive ticks removes that class of false positive, at the cost of
 * flagging a real violation one tick later.
 */

const CONFIRM_TICKS = {
  NO_FACE: 2,
  MULTIPLE_FACES: 2,
  PROHIBITED_OBJECT: 2,
  NOT_LOOKING: 3,
  EYES_CLOSED: 3,
};

const DEFAULT_CONFIRM_TICKS = 2;

export function confirmTicksFor(type) {
  return CONFIRM_TICKS[type] ?? DEFAULT_CONFIRM_TICKS;
}

export function createViolationStabilizer() {
  let activeType = null;
  let streak = 0;

  return {
    push(violation) {
      if (!violation) {
        activeType = null;
        streak = 0;
        return null;
      }

      if (violation.type !== activeType) {
        activeType = violation.type;
        streak = 0;
      }

      streak += 1;
      if (streak < confirmTicksFor(activeType)) return null;

      streak = 0;
      return violation;
    },

    reset() {
      activeType = null;
      streak = 0;
    },

    peek() {
      return { type: activeType, streak };
    },
  };
}

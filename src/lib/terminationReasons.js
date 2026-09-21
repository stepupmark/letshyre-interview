// Stable codes, not prose: the code travels from the trigger through
// autoSubmit to the UI, which resolves it to localized copy.

export const TERMINATION_REASONS = {
  VIOLATION_LIMIT: "violation_limit",
  FACE_MISMATCH: "face_mismatch",
  NETWORK_DISCONNECTS: "network_disconnects",
  TIME_EXPIRED: "time_expired",
  ELECTRON_SECURITY: "electron_security",
};

const REASON_COPY = {
  [TERMINATION_REASONS.VIOLATION_LIMIT]: {
    titleKey: "termination.violationLimit.title",
    descriptionKey: "termination.violationLimit.description",
    pillKey: "termination.violationLimit.pill",
    imagePath: "/termination-violation-limit.svg",
    punitive: true,
  },
  [TERMINATION_REASONS.FACE_MISMATCH]: {
    titleKey: "termination.faceMismatch.title",
    descriptionKey: "termination.faceMismatch.description",
    pillKey: "termination.faceMismatch.pill",
    imagePath: "/termination-face-mismatch.svg",
    punitive: true,
  },
  [TERMINATION_REASONS.NETWORK_DISCONNECTS]: {
    titleKey: "termination.networkDisconnects.title",
    descriptionKey: "termination.networkDisconnects.description",
    pillKey: "termination.networkDisconnects.pill",
    imagePath: "/termination-network.svg",
    punitive: false,
  },
  [TERMINATION_REASONS.TIME_EXPIRED]: {
    titleKey: "termination.timeExpired.title",
    descriptionKey: "termination.timeExpired.description",
    pillKey: "termination.timeExpired.pill",
    imagePath: "/termination-time-expired.svg",
    punitive: false,
  },
  [TERMINATION_REASONS.ELECTRON_SECURITY]: {
    titleKey: "termination.electronSecurity.title",
    descriptionKey: "termination.electronSecurity.description",
    pillKey: "termination.electronSecurity.pill",
    imagePath: "/termination-security.svg",
    punitive: true,
  },
};

const FALLBACK_COPY = {
  titleKey: "termination.generic.title",
  descriptionKey: "termination.generic.description",
  pillKey: "termination.generic.pill",
  imagePath: "/termination-generic.svg",
  punitive: false,
};

export function isTerminationReason(value) {
  return Object.prototype.hasOwnProperty.call(REASON_COPY, value);
}

export function getTerminationCopy(reason) {
  return REASON_COPY[reason] ?? FALLBACK_COPY;
}

// How an interview ended, as the scorecard and the desktop app see it.
export const END_REASONS = {
  COMPLETED: "completed",
  AUTO_SUBMITTED: "auto-submitted",
  TERMINATED: "terminated",
  EXPIRED: "expired",
};

export function toEndReason(reason, { terminated = false, timeUp = false } = {}) {
  if (terminated || getTerminationCopy(reason).punitive) return END_REASONS.TERMINATED;
  if (reason === TERMINATION_REASONS.TIME_EXPIRED) return END_REASONS.EXPIRED;
  // A restored session carries no reason code, only whether its time ran out.
  if (!isTerminationReason(reason) && timeUp) return END_REASONS.EXPIRED;
  return END_REASONS.AUTO_SUBMITTED;
}

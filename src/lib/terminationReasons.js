/**
 * Every way an interview can end itself, as stable codes rather than prose.
 *
 * The code travels from the trigger through autoSubmit to the UI, which resolves
 * it to localized copy. Passing English sentences instead — as this flow used to
 * — left the loader string-matching on them and made the copy untranslatable.
 */

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
    imagePath: "/window-switch.png",
    punitive: true,
  },
  [TERMINATION_REASONS.FACE_MISMATCH]: {
    titleKey: "termination.faceMismatch.title",
    descriptionKey: "termination.faceMismatch.description",
    pillKey: "termination.faceMismatch.pill",
    imagePath: "/no-candidate.png",
    punitive: true,
  },
  [TERMINATION_REASONS.NETWORK_DISCONNECTS]: {
    titleKey: "termination.networkDisconnects.title",
    descriptionKey: "termination.networkDisconnects.description",
    pillKey: "termination.networkDisconnects.pill",
    imagePath: "/window-switch.png",
    punitive: false,
  },
  [TERMINATION_REASONS.TIME_EXPIRED]: {
    titleKey: "termination.timeExpired.title",
    descriptionKey: "termination.timeExpired.description",
    pillKey: "termination.timeExpired.pill",
    imagePath: "/window-switch.png",
    punitive: false,
  },
  [TERMINATION_REASONS.ELECTRON_SECURITY]: {
    titleKey: "termination.electronSecurity.title",
    descriptionKey: "termination.electronSecurity.description",
    pillKey: "termination.electronSecurity.pill",
    imagePath: "/window-switch.png",
    punitive: true,
  },
};

const FALLBACK_COPY = {
  titleKey: "termination.generic.title",
  descriptionKey: "termination.generic.description",
  pillKey: "termination.generic.pill",
  imagePath: "/window-switch.png",
  punitive: false,
};

export function isTerminationReason(value) {
  return Object.prototype.hasOwnProperty.call(REASON_COPY, value);
}

export function getTerminationCopy(reason) {
  return REASON_COPY[reason] ?? FALLBACK_COPY;
}

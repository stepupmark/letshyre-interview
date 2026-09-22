// How each violation type presents itself, in one place so the detection loop
// and the face-match monitor can't drift on copy or artwork for the same event.
const COPY = {
  NO_FACE: {
    titleKey: "violations.noFace.title",
    descriptionKey: "violations.noFace.description",
    imagePath: "/no-candidate.png",
  },
  NO_FACE_GUIDANCE: {
    titleKey: "violations.noFaceGuidance.title",
    descriptionKey: "violations.noFaceGuidance.description",
    soft: true,
  },
  FACE_MISMATCH: {
    titleKey: "violations.faceMismatch.title",
    descriptionKey: "violations.faceMismatch.description",
    imagePath: "/termination-face-mismatch.svg",
  },
  FACE_UNCLEAR: {
    titleKey: "violations.faceUnclear.title",
    descriptionKey: "violations.faceUnclear.description",
    soft: true,
  },
  MULTIPLE_FACES: {
    titleKey: "violations.multipleFaces.title",
    descriptionKey: "violations.multipleFaces.description",
    imagePath: "/multi-people.png",
  },
  PROHIBITED_OBJECT: {
    titleKey: "violations.prohibitedObject.title",
    descriptionKey: "violations.prohibitedObject.description",
    imagePath: "/laptop.png",
  },
  MULTIPLE_OBJECTS: {
    titleKey: "violations.multipleDevices.title",
    descriptionKey: "violations.multipleDevices.description",
    imagePath: "/laptop.png",
  },
  "PROHIBITED_OBJECT:cell phone": {
    titleKey: "violations.cellPhone.title",
    descriptionKey: "violations.cellPhone.description",
    imagePath: "/cell-phone.svg",
  },
  NOT_LOOKING: {
    titleKey: "violations.notLooking.title",
    descriptionKey: "violations.notLooking.description",
    soft: true,
  },
  EYES_CLOSED: {
    titleKey: "violations.eyesClosed.title",
    descriptionKey: "violations.eyesClosed.description",
    soft: true,
  },
  LOOKING_AWAY: {
    titleKey: "violations.lookingAway.title",
    descriptionKey: "violations.lookingAway.description",
    imagePath: "/no-candidate.png",
  },
  CAMERA_OFF: {
    titleKey: "violations.cameraOff.title",
    descriptionKey: "violations.cameraOff.description",
    imagePath: "/no-candidate.png",
  },
};

export function violationCopy(type, label) {
  if (label) {
    const formatted = `${String(type).toUpperCase()}:${String(label).toLowerCase()}`;
    if (COPY[formatted]) return COPY[formatted];
  }
  if (COPY[type]) return COPY[type];
  if (typeof type === "string") {
    const colonIndex = type.indexOf(":");
    if (colonIndex !== -1) {
      const formatted = `${type.slice(0, colonIndex).toUpperCase()}:${type.slice(colonIndex + 1).toLowerCase()}`;
      if (COPY[formatted]) return COPY[formatted];
    }
  }
  return null;
}

// Detector labels are space or snake cased while copy keys are camelCase. Any
// warning that says {{object}} needs this, not only the modal.
export function objectNameKey(label) {
  if (!label) return "violations.objects.unknown";
  const [head, ...rest] = label.toLowerCase().split(/[\s_-]+/);
  const tail = rest.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return `violations.objects.${head}${tail}`;
}

// "phone and laptop" in the candidate's language when several objects count as one.
export function objectName(t, { label, labels } = {}, language) {
  if (!(labels?.length > 1)) return t(objectNameKey(label ?? labels?.[0]));
  const names = labels.map((each) => t(objectNameKey(each)));
  try {
    return new Intl.ListFormat(language, { type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}

const GENERIC_OBJECT_TITLES = new Set([
  "violations.prohibitedObject.title",
  "violations.multipleDevices.title",
]);

// "Prohibited Device Detected (laptop)": the generic device titles need the name.
export function violationTitle(t, { titleKey, label, labels } = {}, language) {
  const title = t(titleKey || "violationWarning.defaultTitle");
  return GENERIC_OBJECT_TITLES.has(titleKey)
    ? `${title} (${objectName(t, { label, labels }, language)})`
    : title;
}

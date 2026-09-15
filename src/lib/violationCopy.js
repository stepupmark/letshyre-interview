// How each violation type presents itself, in one place so the detection loop
// and the face-match monitor can't drift on copy or artwork for the same event.
const COPY = {
  NO_FACE: {
    titleKey: "violations.noFace.title",
    descriptionKey: "violations.noFace.description",
    imagePath: "/no-candidate.png",
  },
  FACE_MISMATCH: {
    titleKey: "violations.faceMismatch.title",
    descriptionKey: "violations.faceMismatch.description",
    imagePath: "/termination-face-mismatch.svg",
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
};

export function violationCopy(type) {
  return COPY[type] ?? null;
}

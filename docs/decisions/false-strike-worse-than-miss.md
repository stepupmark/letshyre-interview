# A false strike is worse than a missed one

**Decision:** nothing strikes on one noisy frame, and when a signal is doubtful it warns or is logged instead of costing a strike.

**Why:** a false termination costs a real candidate their attempt, with no appeal in the moment. A missed signal is usually seen again seconds later, by the next frame, another check or the recording.

**What it means in code:**

- Violations confirm over a window of frames (2 of 3, or 3 of 5 for gaze) before they reach the candidate (`lib/violationStabilizer.js`).
- A frame with no face can't support a claim about an object; the missing face is reported instead (`useProctoringSystem.js`).
- A second person must be at least 25% of the size of the largest face.
- An identity mismatch above `VITE_AI_FACE_MISMATCH_BELOW` is treated as an unclear face, and the first mismatch of a run is re-checked a second later (`useFaceMatchMonitoring.js`).
- After a strike the candidate gets a 10s reaction window, and repeats cool down (`lib/strikePolicy.js`).
- A desktop redelivery keeps its `id` and is only logged (`useElectronViolation.js`).

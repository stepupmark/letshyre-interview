import { createBaselineTracker } from "./baselineTracker";

const laptop = { label: "laptop", bbox: [119.6, 94, 184.3, 141.7] };
const phone = { label: "cell phone", bbox: [345, 185, 405, 296] };

function shifted(object, dx) {
  const [x1, y1, x2, y2] = object.bbox;
  return { ...object, bbox: [x1 + dx, y1, x2 + dx, y2] };
}

function setup() {
  const tracker = createBaselineTracker();
  tracker.start(0);
  return tracker;
}

describe("createBaselineTracker", () => {
  it("treats an object that is static from the start as environment", () => {
    const tracker = setup();
    expect(tracker.classify([laptop], 0)[0].state).toBe("baseline");
    expect(tracker.classify([laptop], 5000)[0].state).toBe("baseline");
  });

  it("treats an object that appears mid-session as introduced", () => {
    const tracker = setup();
    tracker.classify([laptop], 0);
    expect(tracker.classify([laptop, phone], 20000)[1].state).toBe("introduced");
  });

  it("makes a baseline object strikeable once its grace runs out", () => {
    const tracker = setup();
    let state;
    for (let ms = 0; ms <= 65000; ms += 5000) {
      state = tracker.classify([laptop], ms)[0].state;
    }
    expect(state).toBe("expired");
  });

  it("keeps baseline status through a brief occlusion", () => {
    const tracker = setup();
    tracker.classify([laptop], 0);
    tracker.classify([], 5000);
    expect(tracker.classify([laptop], 10000)[0].state).toBe("baseline");
  });

  it("treats an object returning after its TTL as newly introduced", () => {
    const tracker = setup();
    tracker.classify([laptop], 0);
    expect(tracker.classify([laptop], 40000)[0].state).toBe("introduced");
  });

  it("treats a baseline object that gets moved as introduced", () => {
    const tracker = setup();
    tracker.classify([laptop], 0);
    expect(tracker.classify([shifted(laptop, 20)], 5000)[0].state).toBe("introduced");
  });

  it("does not inherit a baseline record from a different label at the same spot", () => {
    const tracker = setup();
    for (let ms = 0; ms <= 20000; ms += 5000) tracker.classify([laptop], ms);
    const impostor = { label: "cell phone", bbox: laptop.bbox };
    expect(tracker.classify([laptop, impostor], 20000)[1].state).toBe("introduced");
  });

  it("still baselines an object present on the second observation", () => {
    const tracker = setup();
    tracker.classify([laptop], 0);
    expect(tracker.classify([laptop, phone], 5000)[1].state).toBe("baseline");
  });

  it("treats anything first seen after the opening observations as introduced", () => {
    const tracker = setup();
    tracker.classify([laptop], 0);
    tracker.classify([laptop], 5000);
    expect(tracker.classify([laptop, phone], 10000)[1].state).toBe("introduced");
  });

  it("clears everything on reset", () => {
    const tracker = setup();
    tracker.classify([laptop], 0);
    tracker.reset();
    tracker.start(60000);
    expect(tracker.classify([laptop], 60000)[0].state).toBe("baseline");
  });
});

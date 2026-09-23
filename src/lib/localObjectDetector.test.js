let workers;

class FakeWorker {
  constructor(url) {
    this.url = String(url);
    this.posted = [];
    this.terminate = vi.fn();
    workers.push(this);
  }
  postMessage(message, transfer) {
    this.posted.push({ message, transfer });
  }
  answer(data) {
    this.onmessage({ data });
  }
}

const video = { videoWidth: 1280, videoHeight: 720 };

async function loadModule() {
  vi.resetModules();
  return import("./localObjectDetector");
}

beforeEach(() => {
  workers = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (_source, { resizeWidth, resizeHeight }) => ({ resizeWidth, resizeHeight })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function started() {
  const { loadObjectDetector } = await loadModule();
  const loading = loadObjectDetector();
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  return { loading, worker: workers[0] };
}

describe("loadObjectDetector", () => {
  it("loads the phone model in a worker", async () => {
    const { loading, worker } = await started();

    expect(worker.url).toContain("objectDetector.worker.js");
    const { message } = worker.posted[0];
    expect(message.type).toBe("load");
    expect(message.wasmBase).toMatch(/^http.*\/mediapipe\/wasm\//);
    expect(message.options).toMatchObject({
      baseOptions: { modelAssetPath: expect.stringContaining("efficientdet_lite0-v1.tflite") },
      categoryAllowlist: ["cell phone"],
    });

    worker.answer({ type: "ready" });
    await expect(loading).resolves.toHaveProperty("detect");
  });

  it("fails, and ends the worker, when the worker can't load the model", async () => {
    const { loading, worker } = await started();
    worker.answer({ type: "error", error: "wasm blocked" });

    await expect(loading).rejects.toThrow("wasm blocked");
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("fails when the worker script can't start", async () => {
    const { loading, worker } = await started();
    worker.onerror({ message: "" });

    await expect(loading).rejects.toThrow("worker failed to start");
  });

  it("sends the worker a small frame and returns its answer", async () => {
    const { loading, worker } = await started();
    worker.answer({ type: "ready" });
    const detector = await loading;

    const result = detector.detect(video, 42);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
    const { message, transfer } = worker.posted[1];
    expect(message).toMatchObject({ type: "detect", timestamp: 42 });
    expect(message.frame).toEqual({ resizeWidth: 320, resizeHeight: 180 });
    expect(transfer).toEqual([message.frame]);

    worker.answer({ type: "result", phones: [{ score: 0.8 }], ms: 150 });
    await expect(result).resolves.toMatchObject({ phones: [{ score: 0.8 }], ms: 150 });
  });

  it("sends one frame at a time", async () => {
    const { loading, worker } = await started();
    worker.answer({ type: "ready" });
    const detector = await loading;

    const first = detector.detect(video, 1);
    const second = detector.detect(video, 2);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(worker.posted).toHaveLength(2);

    worker.answer({ type: "result", phones: [], ms: 1 });
    await first;
    await vi.waitFor(() => expect(worker.posted).toHaveLength(3));
    expect(worker.posted[2].message.timestamp).toBe(2);
    worker.answer({ type: "result", phones: [], ms: 1 });
    await second;
  });

  it("rejects a frame the worker fails on", async () => {
    const { loading, worker } = await started();
    worker.answer({ type: "ready" });
    const detector = await loading;

    const result = detector.detect(video, 1);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
    worker.answer({ type: "error", error: "bad frame" });

    await expect(result).rejects.toThrow("bad frame");
  });

  it("rejects a frame the worker never answers", async () => {
    const { loading, worker } = await started();
    worker.answer({ type: "ready" });
    const detector = await loading;

    vi.useFakeTimers();
    const result = detector.detect(video, 1);
    const settled = expect(result).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(5_000);
    await settled;
  });

  it("rejects every frame once the worker has crashed", async () => {
    const { loading, worker } = await started();
    worker.answer({ type: "ready" });
    const detector = await loading;

    worker.onerror({ message: "out of memory" });

    await expect(detector.detect(video, 1)).rejects.toThrow("out of memory");
  });
});

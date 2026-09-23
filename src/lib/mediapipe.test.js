async function loadModule() {
  vi.resetModules();
  return import("./mediapipe");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("WASM_BASE", () => {
  it("is a folder named after the MediaPipe version", async () => {
    vi.stubEnv("MEDIAPIPE_VERSION", "9.9.9");
    const { WASM_BASE } = await loadModule();
    expect(WASM_BASE).toBe("/mediapipe/wasm/9.9.9");
  });
});

describe("sharedDetector", () => {
  it("creates each detector once, however many callers ask", async () => {
    const { sharedDetector } = await loadModule();
    const create = vi.fn(async () => ({}));
    const load = sharedDetector(create);

    const [a, b] = await Promise.all([load(), load()]);

    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("creates one detector at a time", async () => {
    const { sharedDetector } = await loadModule();
    let finishFirst;
    const first = vi.fn(() => new Promise((resolve) => (finishFirst = resolve)));
    const second = vi.fn(async () => ({}));

    sharedDetector(first)();
    const pending = sharedDetector(second)();
    await vi.waitFor(() => expect(first).toHaveBeenCalled());
    expect(second).not.toHaveBeenCalled();

    finishFirst({});
    await pending;
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failed load", async () => {
    const { sharedDetector } = await loadModule();
    const create = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    const load = sharedDetector(create);

    await expect(load()).rejects.toThrow("offline");
    await expect(load()).resolves.toEqual({});
    expect(create).toHaveBeenCalledTimes(2);
  });
});

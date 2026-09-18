async function loadConfig(env) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./interview");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SHADOW_LABELS", () => {
  it("never mutes laptops while they are prohibited", async () => {
    const { SHADOW_LABELS } = await loadConfig({
      VITE_AI_PROHIBIT_LAPTOP: "true",
      VITE_AI_SHADOW_LABELS: "tv, Laptop",
    });
    expect([...SHADOW_LABELS]).toEqual(["tv"]);
  });

  it("keeps the other shadow labels as configured", async () => {
    const { SHADOW_LABELS } = await loadConfig({
      VITE_AI_PROHIBIT_LAPTOP: "false",
      VITE_AI_SHADOW_LABELS: "tv,laptop,book",
    });
    expect([...SHADOW_LABELS]).toEqual(["tv", "laptop", "book"]);
  });
});

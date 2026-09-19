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

describe("SHADOW_RULES", () => {
  it("shadows the gaze rule by default", async () => {
    const { SHADOW_RULES } = await loadConfig({});
    expect(SHADOW_RULES.has("gaze")).toBe(true);
  });

  it("keeps the default when CI forwards an unset variable as empty", async () => {
    const { SHADOW_RULES } = await loadConfig({ VITE_AI_SHADOW_RULES: "" });
    expect(SHADOW_RULES.has("gaze")).toBe(true);
  });

  it("enforces every rule when set to none", async () => {
    const { SHADOW_RULES } = await loadConfig({ VITE_AI_SHADOW_RULES: "none" });
    expect(SHADOW_RULES.has("gaze")).toBe(false);
  });

  it("parses a comma list", async () => {
    const { SHADOW_RULES } = await loadConfig({ VITE_AI_SHADOW_RULES: " Gaze, other " });
    expect([...SHADOW_RULES]).toEqual(["gaze", "other"]);
  });
});

describe("HELD_RESTRIKE_SECONDS", () => {
  it("defaults to 30 seconds", async () => {
    const { HELD_RESTRIKE_SECONDS } = await loadConfig({});
    expect(HELD_RESTRIKE_SECONDS).toBe(30);
  });

  it("takes a configured value", async () => {
    const { HELD_RESTRIKE_SECONDS } = await loadConfig({ VITE_AI_HELD_RESTRIKE_SECONDS: "45" });
    expect(HELD_RESTRIKE_SECONDS).toBe(45);
  });

  it.each(["", "0", "abc"])("falls back to 30 for %j", async (value) => {
    const { HELD_RESTRIKE_SECONDS } = await loadConfig({ VITE_AI_HELD_RESTRIKE_SECONDS: value });
    expect(HELD_RESTRIKE_SECONDS).toBe(30);
  });
});

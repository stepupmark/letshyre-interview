import { describe, expect, it } from "vitest";
import { resolveInitialLanguage, STORAGE_KEY } from "./resolveInitialLanguage";

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      store[k] = v;
    },
    _store: store,
  };
}

describe("resolveInitialLanguage", () => {
  it("prefers ?lang= over an existing own-session value", () => {
    const storage = fakeStorage({ [STORAGE_KEY]: "fr" });
    expect(resolveInitialLanguage("?lang=te", storage)).toBe("te");
  });

  it("falls back to sessionStorage.locale when ?lang= is absent", () => {
    const storage = fakeStorage({ locale: "hi" });
    expect(resolveInitialLanguage("", storage)).toBe("hi");
  });

  it("falls back to the app's own session key when neither Electron channel is set", () => {
    const storage = fakeStorage({ [STORAGE_KEY]: "fr" });
    expect(resolveInitialLanguage("", storage)).toBe("fr");
  });

  it("falls back to the default language when nothing is set", () => {
    const storage = fakeStorage();
    expect(resolveInitialLanguage("", storage)).toBe("en");
  });

  it("ignores a ?lang= value that isn't a supported code", () => {
    const storage = fakeStorage({ [STORAGE_KEY]: "fr" });
    expect(resolveInitialLanguage("?lang=xx", storage)).toBe("fr");
  });

  it("writes the resolved value back into the own-session key when it changes", () => {
    const storage = fakeStorage({ [STORAGE_KEY]: "fr" });
    resolveInitialLanguage("?lang=te", storage);
    expect(storage.getItem(STORAGE_KEY)).toBe("te");
  });

  it("does not rewrite the own-session key when the resolved value is unchanged", () => {
    let writes = 0;
    const storage = fakeStorage({ [STORAGE_KEY]: "fr" });
    const originalSetItem = storage.setItem;
    storage.setItem = (...args) => {
      writes += 1;
      originalSetItem(...args);
    };
    resolveInitialLanguage("", storage);
    expect(writes).toBe(0);
  });

  it("is case-insensitive on ?lang=", () => {
    const storage = fakeStorage();
    expect(resolveInitialLanguage("?lang=TE", storage)).toBe("te");
  });
});

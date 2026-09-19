const bundles = import.meta.glob("./locales/*/*.json", { eager: true, import: "default" });

const keysOf = (node, prefix = "") =>
  Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === "object" ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );

const placeholders = (text) => (text.match(/{{\s*\w+\s*}}/g) ?? []).sort();

const valueAt = (bundle, path) => path.split(".").reduce((node, key) => node?.[key], bundle);

const files = Object.entries(bundles).map(([path, bundle]) => {
  const [, lang, ns] = path.match(/\.\/locales\/(\w+)\/(\w+)\.json$/);
  return { lang, ns, bundle };
});

const english = Object.fromEntries(
  files.filter((f) => f.lang === "en").map((f) => [f.ns, f.bundle]),
);
const others = files.filter((f) => f.lang !== "en");

// A missing key silently falls back to English mid-sentence, which is how the
// whole violations section went untranslated.
describe.each(others)("$lang/$ns", ({ ns, bundle }) => {
  it("has every key the English file has", () => {
    const have = new Set(keysOf(bundle));
    expect(keysOf(english[ns]).filter((key) => !have.has(key))).toEqual([]);
  });

  it("keeps every placeholder", () => {
    const broken = keysOf(english[ns]).filter(
      (key) =>
        typeof valueAt(bundle, key) === "string" &&
        placeholders(valueAt(bundle, key)).join() !==
          placeholders(valueAt(english[ns], key)).join(),
    );
    expect(broken).toEqual([]);
  });
});

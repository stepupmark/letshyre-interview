import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, applyDocumentAttrs, loadFont } from "./languages";
import { resolveInitialLanguage, STORAGE_KEY } from "./resolveInitialLanguage";

const localeLoaders = import.meta.glob("./locales/*/*.json");
const NAMESPACES = ["common", "questions", "interview", "errors"];

async function loadLanguageBundle(lang) {
  const bundle = {};
  await Promise.all(
    NAMESPACES.map(async (ns) => {
      const loader = localeLoaders[`./locales/${lang}/${ns}.json`];
      if (!loader) return;
      const mod = await loader();
      bundle[ns] = mod.default ?? mod;
    }),
  );
  return bundle;
}

const initialLanguage = resolveInitialLanguage();
const preloadLanguages = [...new Set([initialLanguage, DEFAULT_LANGUAGE])];

applyDocumentAttrs(initialLanguage);
loadFont(initialLanguage);

Promise.all(preloadLanguages.map(loadLanguageBundle)).then((bundles) => {
  const resources = {};
  preloadLanguages.forEach((lang, i) => {
    resources[lang] = bundles[i];
  });

  i18next.use(initReactI18next).init({
    resources,
    lng: initialLanguage,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGE_CODES,
    ns: NAMESPACES,
    defaultNS: "common",
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
});

export async function loadLanguage(lang) {
  if (i18next.hasResourceBundle(lang, "common")) return;
  const bundle = await loadLanguageBundle(lang);
  for (const ns of Object.keys(bundle)) {
    i18next.addResourceBundle(lang, ns, bundle[ns]);
  }
}

export { STORAGE_KEY };
export default i18next;

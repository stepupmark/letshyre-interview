import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { STORAGE_KEY, loadLanguage } from "@/i18n";
import { applyDocumentAttrs, getLanguage, loadFont } from "@/i18n/languages";
import { INTERVIEW_SESSION_STORAGE_KEY } from "@/config/interview";

/**
 * Single source of truth for the active interview language. Locked once a
 * session is in progress (sessionStorage[INTERVIEW_SESSION_STORAGE_KEY] set)
 * so a candidate can't switch languages mid-interview.
 */
export function useLocale() {
  const { i18n } = useTranslation();
  const [language, setLanguageState] = useState(i18n.language);

  useEffect(() => {
    applyDocumentAttrs(language);
    loadFont(language);
  }, [language]);

  const isLocked = !!sessionStorage.getItem(INTERVIEW_SESSION_STORAGE_KEY);

  const setLanguage = useCallback(
    (code) => {
      if (isLocked) return;
      sessionStorage.setItem(STORAGE_KEY, code);
      setLanguageState(code);
      loadLanguage(code).then(() => i18n.changeLanguage(code));
    },
    [i18n, isLocked],
  );

  return { language, setLanguage, isLocked, direction: getLanguage(language).dir };
}

import { createContext, useContext, type ReactNode } from "react";
import type { LanguagePreference } from "@nlc/shared";
import { t as translate, type I18nKey } from "./i18n.js";

/**
 * Provides the active UI language to any descendant component without prop
 * drilling. App.tsx wraps its tree in <LangProvider value={settings.ui.language}>
 * so every component can call useLang() / useT() to react to language changes.
 *
 * Default is "zh-CN" which matches the build-time default in DEFAULT_SETTINGS.ui
 * — picked so a component rendered before settings load (or in a Storybook /
 * test harness with no provider) still renders sensibly.
 */
const LangContext = createContext<LanguagePreference>("zh-CN");

type LangProviderProps = {
  value: LanguagePreference;
  children: ReactNode;
};

export function LangProvider({ value, children }: LangProviderProps): JSX.Element {
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/** Read the active UI language. Stable across re-renders within a sub-tree. */
export function useLang(): LanguagePreference {
  return useContext(LangContext);
}

/**
 * Convenience: returns a translator bound to the active language. Use when a
 * component would otherwise pass `lang` to `t()` on every line.
 *
 *   const t = useT();
 *   <h1>{t("hero.title")}</h1>
 */
export function useT(): (key: I18nKey) => string {
  const lang = useLang();
  return (key: I18nKey): string => translate(key, lang);
}

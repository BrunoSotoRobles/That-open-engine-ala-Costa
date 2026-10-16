import type { Language } from "../stores/CostStore";

/** Minimal CostaBIM header labels (cosmetic only). */
const COSTA_BIM: Record<Language, Record<string, string>> = {
  en: {
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit Fullscreen",
    fullscreenTitle: "Fullscreen viewer",
    exitFullscreenTitle: "Exit fullscreen",
  },
  fi: {
    fullscreen: "Koko näyttö",
    exitFullscreen: "Poistu koko näytöstä",
    fullscreenTitle: "Koko näytön katselu",
    exitFullscreenTitle: "Poistu koko näytöstä",
  },
};

export function getCostaBimPageText(key: string, language: Language): string {
  return COSTA_BIM[language]?.[key] ?? COSTA_BIM.en[key] ?? key;
}

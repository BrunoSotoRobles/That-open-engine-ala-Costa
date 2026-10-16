import type { Language } from "../stores/CostStore";

export type AppNavKey =
  | "costaBim"
  | "projects"
  | "costs"
  | "about"
  | "home"
  | "teamSignOut";

const LABELS: Record<Language, Record<AppNavKey, string>> = {
  en: {
    home: "Welcome",
    costaBim: "CostaBIM",
    projects: "Projects",
    costs: "Quantities & Cost",
    about: "About",
    teamSignOut: "Sign out",
  },
  fi: {
    home: "Tervetuloa",
    costaBim: "CostaBIM",
    projects: "Projektit",
    costs: "Määrät ja kustannus",
    about: "Tietoa",
    teamSignOut: "Kirjaudu ulos",
  },
};

export function getAppNavLabel(key: AppNavKey, language: Language): string {
  return LABELS[language]?.[key] ?? LABELS.en[key];
}

/** Two-line sidebar label for Quantities & Cost (avoids overflowing narrow sidebar). */
export function getCostsNavLines(language: Language): [string, string] {
  return language === "fi"
    ? ["Määrät ja", "kustannus"]
    : ["Quantities &", "Cost"];
}

import type { Language } from "../stores/CostStore";

/** Home landing copy. FI terms aligned with costalaskenta.fi. */
const HOME: Record<Language, Record<string, string>> = {
  en: {
    headline: "Welcome to CostaBIM",
    tagline: "Accurate cost data for every construction project",
    openWithPassword: "Open with team password",
    authTitle: "Team access",
    authHint:
      "Enter the shared CostaBIM password. Authentication is not wired yet — this dialog is UI only.",
    passwordLabel: "Password",
    passwordPlaceholder: "Team password",
    cancel: "Cancel",
    continue: "Continue",
  },
  fi: {
    headline: "Tervetuloa CostaBIMiin",
    tagline: "Tarkkaa kustannustietoa jokaiseen rakennushankkeeseen",
    openWithPassword: "Avaa tiimin salasanalla",
    authTitle: "Tiimin käyttöoikeus",
    authHint:
      "Syötä jaettu CostaBIM-salasana. Kirjautuminen ei ole vielä kytketty — tämä ikkuna on vain käyttöliittymä.",
    passwordLabel: "Salasana",
    passwordPlaceholder: "Tiimin salasana",
    cancel: "Peruuta",
    continue: "Jatka",
  },
};

export function getHomePageText(key: string, language: Language): string {
  return HOME[language]?.[key] ?? HOME.en[key] ?? key;
}

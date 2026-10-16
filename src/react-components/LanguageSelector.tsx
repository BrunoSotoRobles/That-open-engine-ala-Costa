import * as React from "react";
import { useCostStore, type Language } from "../stores/CostStore";

/**
 * Compact EN / FI switch for page headers. No "Language" label.
 * Uses CostStore.language as the app-wide locale for now.
 */
export function LanguageSelector() {
  const language = useCostStore((s) => s.language);
  const setLanguage = useCostStore((s) => s.setLanguage);

  const btn = (lang: Language, label: string): React.CSSProperties => ({
    padding: "4px 10px",
    borderRadius: 4,
    border: "1px solid var(--border, #404040)",
    cursor: "pointer",
    fontSize: "0.8rem",
    fontWeight: 600,
    letterSpacing: "0.02em",
    background: language === lang ? "var(--primary)" : "transparent",
    color: language === lang ? "white" : "var(--text-2, #969696)",
  });

  return (
    <div
      role="group"
      aria-label="Language"
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      <button
        type="button"
        className={`language-button ${language === "en" ? "active" : ""}`}
        onClick={() => setLanguage("en")}
        style={btn("en", "ENG")}
      >
        ENG
      </button>
      <button
        type="button"
        className={`language-button ${language === "fi" ? "active" : ""}`}
        onClick={() => setLanguage("fi")}
        style={btn("fi", "FIN")}
      >
        FIN
      </button>
    </div>
  );
}

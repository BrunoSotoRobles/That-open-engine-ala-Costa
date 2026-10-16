import React from "react";
import * as Router from "react-router-dom";
import { LanguageSelector } from "./LanguageSelector";
import { useCostStore } from "../stores/CostStore";
import { useTeamGateStore } from "../stores/TeamGateStore";
import { getAppNavLabel } from "../locales/appNav";
import { getHomePageText } from "../locales/homePage";
import {
  isTeamGateEnabled,
  isTeamPasswordConfigured,
  verifyTeamGatePassword,
} from "../utils/costaTeamGate";

/** Landing for the standalone pilot; team password unlocks app routes when configured. */
export function HomePage() {
  const navigate = Router.useNavigate();
  const grantAccess = useTeamGateStore((s) => s.grantAccess);
  const [authOpen, setAuthOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [authError, setAuthError] = React.useState(false);
  const language = useCostStore((s) => s.language);

  const openAuth = () => {
    setPassword("");
    setAuthError(false);
    setAuthOpen(true);
  };

  const closeAuth = () => {
    setAuthOpen(false);
    setPassword("");
    setAuthError(false);
  };

  const onAuthSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isTeamGateEnabled()) {
      grantAccess();
      closeAuth();
      navigate("/viewer", { replace: true });
      return;
    }
    if (!isTeamPasswordConfigured()) {
      setAuthError(true);
      return;
    }
    if (verifyTeamGatePassword(password)) {
      grantAccess();
      closeAuth();
      navigate("/viewer", { replace: true });
      return;
    }
    setAuthError(true);
  };

  const gateMisconfigured = isTeamGateEnabled() && !isTeamPasswordConfigured();

  return (
    <div className="page">
      <header
        style={{
          padding: "1rem 2rem",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
        }}
      >
        <h2
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: 0,
            fontSize: "1.5rem",
          }}
        >
          <span className="material-icons-round">home</span>
          {getAppNavLabel("home", language)}
        </h2>
        <LanguageSelector />
      </header>

      <div
        className="main-page-content"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "calc(100vh - 80px)",
          background: `
          linear-gradient(135deg, rgba(32, 33, 36, 0.4) 0%, rgba(38, 40, 43, 0.3) 100%),
          url('/images/background.webp')
        `,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `
            radial-gradient(circle at 25% 25%, rgba(2, 154, 224, 0.05) 0%, transparent 50%),
            radial-gradient(circle at 75% 75%, rgba(2, 154, 224, 0.03) 0%, transparent 50%),
            radial-gradient(circle at 50% 50%, rgba(2, 154, 224, 0.02) 0%, transparent 50%)
          `,
            zIndex: 1,
          }}
        />

        <div
          style={{
            textAlign: "center",
            zIndex: 2,
            position: "relative",
            maxWidth: 600,
            padding: "2rem",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              marginBottom: "1.75rem",
            }}
          >
            <span
              className="material-icons-round"
              style={{
                fontSize: 108,
                color: "var(--primary)",
                lineHeight: 1,
                // Contorno = azul oscuro del mallado del fondo (#2F79CC)
                textShadow:
                  "0 0 2px #2F79CC, 1px 1px 0 #2F79CC, -1px -1px 0 #2F79CC, 1px -1px 0 #2F79CC, -1px 1px 0 #2F79CC, 0 2px 4px rgba(47,121,204,0.55)",
              }}
              aria-hidden
            >
              apartment
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: "1.5rem",
                color: "#fff",
                fontWeight: 600,
                letterSpacing: "0.03em",
                whiteSpace: "nowrap",
                lineHeight: 1,
                textShadow:
                  "0 0 2px #2F79CC, 1px 1px 0 #2F79CC, -1px -1px 0 #2F79CC, 1px -1px 0 #2F79CC, -1px 1px 0 #2F79CC",
              }}
            >
              Costa
              <span
                className="material-icons-round"
                style={{
                  fontSize: "3rem",
                  color: "var(--primary)",
                  lineHeight: 1,
                  textShadow:
                    "0 0 2px #2F79CC, 1px 1px 0 #2F79CC, -1px -1px 0 #2F79CC, 1px -1px 0 #2F79CC, -1px 1px 0 #2F79CC, 0 2px 3px rgba(47,121,204,0.5)",
                }}
                aria-label="love"
              >
                favorite
              </span>
              BIM
            </span>
          </div>

          <h1
            style={{
              fontSize: "2.5rem",
              color: "var(--text-1)",
              marginBottom: "0.75rem",
              fontWeight: 300,
            }}
          >
            {getHomePageText("headline", language)}
          </h1>

          <p
            style={{
              fontSize: "1.2rem",
              color: "var(--text-2)",
              marginBottom: "2rem",
              lineHeight: 1.6,
            }}
          >
            {getHomePageText("tagline", language)}
          </p>

          <button
            type="button"
            className="btn-secondary"
            onClick={openAuth}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "auto",
              minWidth: "auto",
              whiteSpace: "nowrap",
              padding: "12px 22px",
              fontSize: "1rem",
              lineHeight: 1.2,
            }}
          >
            <span className="material-icons-round" style={{ fontSize: 20 }}>
              lock_open
            </span>
            {getHomePageText("openWithPassword", language)}
          </button>
        </div>
      </div>

      {authOpen && (
        <div
          className="overlay"
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.55)",
            backdropFilter: "blur(3px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeAuth}
        >
          <dialog
            open
            aria-labelledby="home-auth-title"
            style={{
              width: "90%",
              maxWidth: 380,
              margin: "auto",
              padding: 0,
              border: "none",
              borderRadius: 8,
              backgroundColor: "var(--background)",
              color: "var(--text-1)",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
              zIndex: 1001,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <form onSubmit={onAuthSubmit} style={{ padding: "1.5rem" }}>
              <h3
                id="home-auth-title"
                style={{
                  margin: "0 0 0.5rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "1.15rem",
                  fontWeight: 500,
                }}
              >
                <span className="material-icons-round">lock</span>
                {getHomePageText("authTitle", language)}
              </h3>
              <p
                style={{
                  margin: "0 0 1.25rem",
                  color: "var(--text-2)",
                  fontSize: "0.9rem",
                  lineHeight: 1.45,
                }}
              >
                {getHomePageText("authHint", language)}
              </p>
              <label
                htmlFor="home-team-password"
                style={{
                  display: "block",
                  marginBottom: 6,
                  fontSize: "0.85rem",
                  color: "var(--text-2)",
                }}
              >
                {getHomePageText("passwordLabel", language)}
              </label>
              <input
                id="home-team-password"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (authError) setAuthError(false);
                }}
                placeholder={getHomePageText("passwordPlaceholder", language)}
                aria-invalid={authError}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  marginBottom: authError ? "0.5rem" : "1.25rem",
                  borderRadius: 6,
                  border: authError
                    ? "1px solid #e57373"
                    : "1px solid var(--border)",
                  background: "var(--background2, #2a2c2f)",
                  color: "var(--text-1)",
                  fontSize: "1rem",
                }}
              />
              {authError && (
                <p
                  role="alert"
                  style={{
                    margin: "0 0 1.25rem",
                    color: "#e57373",
                    fontSize: "0.85rem",
                  }}
                >
                  {gateMisconfigured
                    ? getHomePageText("authMisconfig", language)
                    : getHomePageText("authError", language)}
                </p>
              )}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeAuth}
                  style={{ padding: "8px 14px" }}
                >
                  {getHomePageText("cancel", language)}
                </button>
                <button
                  type="submit"
                  className="btn-secondary"
                  style={{
                    padding: "8px 14px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {getHomePageText("continue", language)}
                </button>
              </div>
            </form>
          </dialog>
        </div>
      )}
    </div>
  );
}

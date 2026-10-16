import * as React from "react";
import * as Router from "react-router-dom";
import { useAuthStore } from "../stores/AuthStore";
import { useCostStore } from "../stores/CostStore";
import { useTeamGateStore } from "../stores/TeamGateStore";
import { COSTA_FIREBASE_OFF_V1 } from "../utils/costaFirebaseFlags";
import { isTeamGateEnabled } from "../utils/costaTeamGate";
import { getAppNavLabel, getCostsNavLines } from "../locales/appNav";

export function Sidebar() {
  useAuthStore();
  const navigate = Router.useNavigate();
  const revokeAccess = useTeamGateStore((s) => s.revokeAccess);
  const language = useCostStore((s) => s.language);
  const [costsLine1, costsLine2] = getCostsNavLines(language);

  const onTeamSignOut = () => {
    if (isTeamGateEnabled()) {
      revokeAccess();
    }
    navigate("/", { replace: true });
  };

  return (
    <aside id="sidebar">
      <Router.Link to="/viewer" aria-label={getAppNavLabel("costaBim", language)}>
        <div
          id="company-logo"
          role="img"
          aria-label="Costa Laskenta logo"
        />
      </Router.Link>
      <ul id="nav-buttons">
        <Router.Link to="/viewer">
          <li>
            <span className="material-icons-round nav-item-icon">apartment</span>
            <span className="nav-item-label">{getAppNavLabel("costaBim", language)}</span>
          </li>
        </Router.Link>
        {!COSTA_FIREBASE_OFF_V1 && (
          <Router.Link to="/projects">
            <li>
              <span className="material-icons-round nav-item-icon">apartment</span>
              <span className="nav-item-label">{getAppNavLabel("projects", language)}</span>
            </li>
          </Router.Link>
        )}
        <Router.Link to="/costs">
          <li className="nav-item-multiline">
            <span className="material-icons-round nav-item-icon">euro</span>
            <span className="nav-item-label nav-item-label--two-line">
              <span>{costsLine1}</span>
              <span>{costsLine2}</span>
            </span>
          </li>
        </Router.Link>
        <Router.Link to="/about">
          <li>
            <span className="material-icons-round nav-item-icon">info</span>
            <span className="nav-item-label">{getAppNavLabel("about", language)}</span>
          </li>
        </Router.Link>
      </ul>
      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-logout-btn"
          onClick={onTeamSignOut}
        >
          <span className="material-icons-round nav-item-icon">logout</span>
          <span className="nav-item-label">{getAppNavLabel("teamSignOut", language)}</span>
        </button>
      </div>
    </aside>
  );
}

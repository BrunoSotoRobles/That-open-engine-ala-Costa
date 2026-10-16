import * as React from "react";
import * as Router from "react-router-dom";
import { useAuthStore } from "../stores/AuthStore";
import { useCostStore } from "../stores/CostStore";
import { COSTA_FIREBASE_OFF_V1 } from "../utils/costaFirebaseFlags";
import { getAppNavLabel, getCostsNavLines } from "../locales/appNav";

export function Sidebar() {
  useAuthStore();
  const language = useCostStore((s) => s.language);
  const [costsLine1, costsLine2] = getCostsNavLines(language);

  return (
    <aside id="sidebar">
      <Router.Link to="/home">
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
    </aside>
  );
}

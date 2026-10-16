import * as React from "react";
import * as OBC from "@thatopen/components";
import { IFCViewer } from "./IFCViewer";
import { IFCMeasurementPanel } from "./IFCMeasurementPanel";
import { LanguageSelector } from "./LanguageSelector";
import { useCostStore } from "../stores/CostStore";
import { getAppNavLabel } from "../locales/appNav";
import { getCostaBimPageText } from "../locales/costaBimPage";

/**
 * Pilot entry: IFC viewer + measurement without Firebase / project catalog.
 * Keeps the same IFCViewer + IFCMeasurementPanel stack as ProjectDetailsPage.
 */
export function StandaloneViewerPage() {
  const components = React.useMemo(() => new OBC.Components(), []);
  const [isViewerExpanded, setIsViewerExpanded] = React.useState(false);
  const language = useCostStore((s) => s.language);

  return (
    <div
      className="page"
      id="standalone-viewer-page"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 30px)",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "0.75rem 1.25rem",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexShrink: 0,
        }}
      >
        <h2
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: 0,
            fontSize: "1.25rem",
          }}
        >
          <span className="material-icons-round">apartment</span>
          {getAppNavLabel("costaBim", language)}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LanguageSelector />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsViewerExpanded((v) => !v)}
            title={
              isViewerExpanded
                ? getCostaBimPageText("exitFullscreenTitle", language)
                : getCostaBimPageText("fullscreenTitle", language)
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "auto",
              minWidth: "auto",
              whiteSpace: "nowrap",
              padding: "8px 16px",
            }}
          >
            <span className="material-icons-round" style={{ fontSize: 18 }}>
              {isViewerExpanded ? "fullscreen_exit" : "fullscreen"}
            </span>
            {isViewerExpanded
              ? getCostaBimPageText("exitFullscreen", language)
              : getCostaBimPageText("fullscreen", language)}
          </button>
        </div>
      </header>

      <div
        className="main-page-content"
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "row",
          padding: isViewerExpanded ? 0 : "12px 16px 16px",
          gap: isViewerExpanded ? 0 : 16,
        }}
      >
        <div
          style={{
            display: isViewerExpanded ? "none" : "flex",
            flexDirection: "column",
            width: "100%",
            maxWidth: 420,
            minHeight: 0,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <IFCMeasurementPanel />
          </div>
        </div>

        <div
          className={`ifc-viewer-container ${isViewerExpanded ? "fullscreen-mode" : ""}`}
          style={{
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderRadius: isViewerExpanded ? 0 : 8,
            overflow: "hidden",
          }}
        >
          <IFCViewer components={components} isExpanded={isViewerExpanded} />
        </div>
      </div>
    </div>
  );
}

import * as React from "react";
import { useCostStore } from "../stores/CostStore";
import { getCostBridgeUiText } from "../locales/costBridgeUi";

/**
 * Friendly how-to for CostaBIM Quantities. Pilot UX — gated by flag in parent.
 * Flip COSTA_MEASUREMENT_PANEL_GUIDE_V1 off (or drop this file) to restore prior chrome.
 * After Send: no bottom guide (keeps panel height ≈ original; scroll only via Advanced).
 */
export function IFCMeasurementPanelGuide(props: { hasCostData: boolean }) {
  const language = useCostStore((s) => s.language);
  const t = (key: string) => getCostBridgeUiText(key, language);
  const sendLabel = t("sendToQuantitiesCost");

  const stepStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "0.78rem",
    color: "#c8c8c8",
    lineHeight: 1.45,
  };
  const labelStyle: React.CSSProperties = {
    fontWeight: 600,
    color: "#e8e8e8",
  };

  if (props.hasCostData) {
    return null;
  }

  return (
    <div style={{ marginTop: 14, flexShrink: 0 }}>
      <div
        style={{
          borderRadius: 8,
          border: "1px solid #2f2f2f",
          background:
            "linear-gradient(180deg, rgba(2,154,224,0.08) 0%, rgba(22,22,22,0.95) 28%)",
          padding: "12px 14px 14px",
        }}
      >
        <p
          style={{
            margin: "0 0 8px",
            fontSize: "0.82rem",
            fontWeight: 600,
            color: "var(--primary)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span className="material-icons-round" style={{ fontSize: 18 }}>
            menu_book
          </span>
          {t("guideTitle")}
        </p>
        <p
          style={{
            margin: "0 0 10px",
            fontSize: "0.74rem",
            color: "#9a9a9a",
            lineHeight: 1.4,
          }}
        >
          {t("guideIntro")}
        </p>

        <ol
          style={{
            margin: 0,
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <li style={stepStyle}>
            <span style={labelStyle}>{t("guideStepOpenIfc")}</span>{" "}
            {t("guideStepOpenIfcDetail")}
          </li>
          <li style={stepStyle}>
            <span style={labelStyle}>{t("guideStepSend")}</span> — Cost →{" "}
            <strong>{sendLabel}</strong>. {t("guideStepSendDetail")}
          </li>
          <li style={stepStyle}>
            <span style={labelStyle}>{t("guideStepReturn")}</span>{" "}
            {t("guideStepReturnDetail")}
          </li>
        </ol>

        <p
          style={{
            margin: "12px 0 0",
            fontSize: "0.7rem",
            color: "#7a7a7a",
            lineHeight: 1.35,
          }}
        >
          {t("guideTip")}
        </p>
      </div>

      <div
        style={{
          marginTop: 12,
          borderRadius: 8,
          border: "1px dashed #3a3a3a",
          padding: "12px 14px",
          backgroundColor: "#141414",
        }}
      >
        <p
          style={{
            margin: "0 0 8px",
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "#d0d0d0",
          }}
        >
          {t("guideAfterSendTitle")}
        </p>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: "0.74rem",
            color: "#a8a8a8",
            lineHeight: 1.4,
          }}
        >
          <li>
            {t("guideAfterSend1Lead")}{" "}
            <strong style={{ color: "#ddd" }}>{t("guideAfterSend1Bold")}</strong>{" "}
            {t("guideAfterSend1Tail")}
          </li>
          <li>
            {t("guideAfterSend2Lead")}{" "}
            <strong style={{ color: "#ddd" }}>{t("guideAfterSend2Bold")}</strong>{" "}
            {t("guideAfterSend2Tail")}
          </li>
          <li>
            {t("guideAfterSend3Lead")}{" "}
            <strong style={{ color: "#ddd" }}>{t("guideAfterSend3Bold")}</strong>{" "}
            {t("guideAfterSend3Tail")}
          </li>
        </ul>
      </div>
    </div>
  );
}

/** Section help under Scope / Listing / Columns when pilot guide is on. */
export function MeasurementSectionHelp(props: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 6px",
        fontSize: "0.68rem",
        color: "#8e8e8e",
        lineHeight: 1.35,
      }}
    >
      {props.children}
    </p>
  );
}

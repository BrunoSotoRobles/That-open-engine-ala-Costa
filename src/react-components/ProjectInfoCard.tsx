import * as React from "react";
import type { Language } from "../stores/CostStore";
import type { BaseCostElement, BaseProjectInfo, ConstructionSchedule, CostFactors } from "../types/cost";
import { getTranslation } from "../locales/costAnalysis";
import { headerCase } from "../utils/textUtils";
import { REGIONAL_FACTORS } from "../data/finnishCostDatabase";
import { TimeAnalysisService } from "../services/TimeAnalysisService";
import {
  STANDARD_LOCATIONS,
  STANDARD_BUILDING_TYPES,
  STANDARD_CONSTRUCTION_METHODS,
  getLocationFactor,
  getBuildingTypeFactor,
  getConstructionMethodFactor,
  normalizeBuildingTypeKey,
  normalizeConstructionMethodKey,
} from "../utils/projectInfoNormalization";
import styles from "./ProjectInfoCard.module.css";

const OTHER_VALUE = "Other";

export interface ProjectInfoCardProps {
  projectInfo: BaseProjectInfo | null;
  setProjectInfo: (info: BaseProjectInfo) => void;
  costData: BaseCostElement[];
  setCostData: (data: BaseCostElement[]) => void;
  startDate: Date;
  setStartDate: (d: Date) => void;
  setConstructionSchedule: React.Dispatch<React.SetStateAction<ConstructionSchedule | null>>;
  language: Language;
  defaultCostFactors: CostFactors;
}

export function ProjectInfoCard({
  projectInfo,
  setProjectInfo,
  costData,
  setCostData,
  startDate,
  setStartDate,
  setConstructionSchedule,
  language,
  defaultCostFactors,
}: ProjectInfoCardProps) {
  if (!projectInfo) return null;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.headerTitle}>
          {headerCase(getTranslation(["projectInfo", "title"], language) ?? "")}
        </h3>
      </div>
      <div className={styles.form}>
        <div className={styles.row}>
          <label className={styles.label}>
            {getTranslation(["projectInfo", "name"], language)}:
          </label>
          <span className={styles.value}>
            {projectInfo?.name || "Unnamed Project"}
          </span>
          <span />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>
            {getTranslation(["projectInfo", "area"], language)}:
          </label>
          <div className={styles.inputWrap}>
            <input
              type="number"
              className={styles.input}
              value={projectInfo?.area ?? 0}
              onChange={(e) => {
                const newArea = Number(e.target.value);
                const updated = { ...projectInfo, area: newArea };
                setProjectInfo(updated);
                if (costData.length > 0) {
                  const timeService = TimeAnalysisService.getInstance();
                  const newSchedule = timeService.calculateConstructionSchedule(
                    costData,
                    normalizeBuildingTypeKey(updated.buildingType || "residential"),
                    newArea,
                    normalizeConstructionMethodKey(updated.constructionMethod || "traditional"),
                    startDate
                  );
                  setConstructionSchedule(newSchedule);
                }
              }}
              min={0}
              step={0.01}
            />
          </div>
          <span className={styles.unit}>m²</span>
        </div>

        <div className={styles.row}>
          <label className={styles.label}>
            {getTranslation(["projectInfo", "huoneistoala"], language)}:
          </label>
          <div className={styles.inputWrap}>
            <input
              type="number"
              className={styles.input}
              value={projectInfo?.huoneistoala !== undefined && projectInfo.huoneistoala !== null ? projectInfo.huoneistoala : ""}
              onChange={(e) => {
                const v = e.target.value;
                const newHm2 = v === "" ? undefined : Number(v);
                setProjectInfo({ ...projectInfo, huoneistoala: newHm2 });
              }}
              min={0}
              step={0.01}
              placeholder={projectInfo?.area ? String(projectInfo.area) : ""}
            />
          </div>
          <span className={styles.unit}>hm²</span>
        </div>

        <div className={styles.row}>
          <label className={styles.label}>
            {getTranslation(["projectInfo", "location"], language)}:
          </label>
          <div className={styles.inputWrap} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <select
              className={styles.select}
              value={
                STANDARD_LOCATIONS.includes(
                  projectInfo?.location as (typeof STANDARD_LOCATIONS)[number]
                )
                  ? projectInfo?.location ?? "Helsinki"
                  : OTHER_VALUE
              }
              onChange={(e) => {
                const sel = e.target.value;
                const newLocation = sel === OTHER_VALUE ? (projectInfo?.location && !STANDARD_LOCATIONS.includes(projectInfo.location as (typeof STANDARD_LOCATIONS)[number]) ? projectInfo.location : sel) : sel;
                setProjectInfo({ ...projectInfo, location: newLocation });
                if (costData.length > 0) {
                  const regionalFactor = getLocationFactor(newLocation, REGIONAL_FACTORS as Record<string, number>);
                  const updatedCostData = costData.map((el) => ({
                    ...el,
                    costs: {
                      material: el.costs.material * regionalFactor,
                      labor: el.costs.labor * regionalFactor,
                      subcontract: el.costs.subcontract * regionalFactor,
                      total: el.costs.total * regionalFactor,
                    },
                  }));
                  setCostData(updatedCostData);
                }
              }}
            >
              {STANDARD_LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>
                  {getTranslation(["locations", loc.toLowerCase() as "helsinki" | "tampere" | "oulu"], language) ?? loc}
                </option>
              ))}
              <option value={OTHER_VALUE}>
                {getTranslation(["locations", "other"], language) ?? "Location"}
              </option>
            </select>
            {(!projectInfo?.location || !STANDARD_LOCATIONS.includes(projectInfo.location as (typeof STANDARD_LOCATIONS)[number])) && (
              <input
                type="text"
                className={styles.input}
                placeholder={getTranslation(["locations", "other"], language) ?? "Location"}
                value={projectInfo?.location && !STANDARD_LOCATIONS.includes(projectInfo.location as (typeof STANDARD_LOCATIONS)[number]) ? projectInfo.location : ""}
                onChange={(e) => {
                  const newLocation = e.target.value.trim() || OTHER_VALUE;
                  setProjectInfo({ ...projectInfo, location: newLocation });
                  if (costData.length > 0) {
                    const regionalFactor = getLocationFactor(newLocation, REGIONAL_FACTORS as Record<string, number>);
                    const updatedCostData = costData.map((el) => ({
                      ...el,
                      costs: {
                        material: el.costs.material * regionalFactor,
                        labor: el.costs.labor * regionalFactor,
                        subcontract: el.costs.subcontract * regionalFactor,
                        total: el.costs.total * regionalFactor,
                      },
                    }));
                    setCostData(updatedCostData);
                  }
                }}
                style={{ flex: 1, minWidth: 80 }}
              />
            )}
          </div>
          <span />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>
            {getTranslation(["projectInfo", "buildingType"], language)}:
          </label>
          <div className={styles.inputWrap} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <select
              className={styles.select}
              value={
                STANDARD_BUILDING_TYPES.includes(
                  projectInfo?.buildingType as (typeof STANDARD_BUILDING_TYPES)[number]
                )
                  ? projectInfo?.buildingType ?? "Residential"
                  : OTHER_VALUE
              }
              onChange={(e) => {
                const sel = e.target.value;
                const newValue = sel === OTHER_VALUE
                  ? (projectInfo?.buildingType && !STANDARD_BUILDING_TYPES.includes(projectInfo.buildingType as (typeof STANDARD_BUILDING_TYPES)[number]) ? projectInfo.buildingType : sel)
                  : sel;
                setProjectInfo({ ...projectInfo, buildingType: newValue });
                if (costData.length > 0) {
                  const factor = getBuildingTypeFactor(newValue, defaultCostFactors.buildingType as Record<string, number>);
                  const updatedCostData = costData.map((el) => ({
                    ...el,
                    costs: {
                      material: el.costs.material * factor,
                      labor: el.costs.labor * factor,
                      subcontract: el.costs.subcontract * factor,
                      total: el.costs.total * factor,
                    },
                  }));
                  setCostData(updatedCostData);
                }
              }}
            >
              {STANDARD_BUILDING_TYPES.map((bt) => (
                <option key={bt} value={bt}>
                  {getTranslation(["buildingTypes", bt.toLowerCase() as "residential" | "office" | "commercial" | "industrial"], language) ?? bt}
                </option>
              ))}
              <option value={OTHER_VALUE}>
                {getTranslation(["buildingTypes", "other"], language) ?? "Type of Building"}
              </option>
            </select>
            {(!projectInfo?.buildingType || !STANDARD_BUILDING_TYPES.includes(projectInfo.buildingType as (typeof STANDARD_BUILDING_TYPES)[number])) && (
              <input
                type="text"
                className={styles.input}
                placeholder={getTranslation(["buildingTypes", "other"], language) ?? "Type of Building"}
                value={projectInfo?.buildingType && !STANDARD_BUILDING_TYPES.includes(projectInfo.buildingType as (typeof STANDARD_BUILDING_TYPES)[number]) ? projectInfo.buildingType : ""}
                onChange={(e) => {
                  const newValue = e.target.value.trim() || OTHER_VALUE;
                  setProjectInfo({ ...projectInfo, buildingType: newValue });
                  if (costData.length > 0) {
                    const factor = getBuildingTypeFactor(newValue, defaultCostFactors.buildingType as Record<string, number>);
                    const updatedCostData = costData.map((el) => ({
                      ...el,
                      costs: {
                        material: el.costs.material * factor,
                        labor: el.costs.labor * factor,
                        subcontract: el.costs.subcontract * factor,
                        total: el.costs.total * factor,
                      },
                    }));
                    setCostData(updatedCostData);
                  }
                }}
                style={{ flex: 1, minWidth: 80 }}
              />
            )}
          </div>
          <span />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>
            {getTranslation(
              ["projectInfo", "constructionMethod"],
              language
            )}:
          </label>
          <div className={styles.inputWrap} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <select
              className={styles.select}
              value={
                STANDARD_CONSTRUCTION_METHODS.includes(
                  projectInfo?.constructionMethod as (typeof STANDARD_CONSTRUCTION_METHODS)[number]
                )
                  ? projectInfo?.constructionMethod ?? "OnSite"
                  : OTHER_VALUE
              }
              onChange={(e) => {
                const sel = e.target.value;
                const newValue = sel === OTHER_VALUE
                  ? (projectInfo?.constructionMethod && !STANDARD_CONSTRUCTION_METHODS.includes(projectInfo.constructionMethod as (typeof STANDARD_CONSTRUCTION_METHODS)[number]) ? projectInfo.constructionMethod : sel)
                  : sel;
                setProjectInfo({ ...projectInfo, constructionMethod: newValue });
                if (costData.length > 0) {
                  const factor = getConstructionMethodFactor(newValue, defaultCostFactors.constructionMethod as Record<string, number>);
                  const updatedCostData = costData.map((el) => ({
                    ...el,
                    costs: {
                      material: el.costs.material * factor,
                      labor: el.costs.labor * factor,
                      subcontract: el.costs.subcontract * factor,
                      total: el.costs.total * factor,
                    },
                  }));
                  setCostData(updatedCostData);
                }
              }}
            >
              <option value="OnSite">
                {getTranslation(["constructionMethods", "onSite"], language)}
              </option>
              <option value="Prefabricated">
                {getTranslation(
                  ["constructionMethods", "prefabricated"],
                  language
                )}
              </option>
              <option value={OTHER_VALUE}>
                {getTranslation(["constructionMethods", "other"], language) ?? "Construction Method"}
              </option>
            </select>
            {(!projectInfo?.constructionMethod || !STANDARD_CONSTRUCTION_METHODS.includes(projectInfo.constructionMethod as (typeof STANDARD_CONSTRUCTION_METHODS)[number])) && (
              <input
                type="text"
                className={styles.input}
                placeholder={getTranslation(["constructionMethods", "other"], language) ?? "Construction Method"}
                value={projectInfo?.constructionMethod && !STANDARD_CONSTRUCTION_METHODS.includes(projectInfo.constructionMethod as (typeof STANDARD_CONSTRUCTION_METHODS)[number]) ? projectInfo.constructionMethod : ""}
                onChange={(e) => {
                  const newValue = e.target.value.trim() || OTHER_VALUE;
                  setProjectInfo({ ...projectInfo, constructionMethod: newValue });
                  if (costData.length > 0) {
                    const factor = getConstructionMethodFactor(newValue, defaultCostFactors.constructionMethod as Record<string, number>);
                    const updatedCostData = costData.map((el) => ({
                      ...el,
                      costs: {
                        material: el.costs.material * factor,
                        labor: el.costs.labor * factor,
                        subcontract: el.costs.subcontract * factor,
                        total: el.costs.total * factor,
                      },
                    }));
                    setCostData(updatedCostData);
                  }
                }}
                style={{ flex: 1, minWidth: 80 }}
              />
            )}
          </div>
          <span />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>
            {getTranslation(["schedule", "startDate"], language)}:
          </label>
          <div className={styles.inputWrap}>
            <input
              type="date"
              className={styles.input}
              value={startDate.toISOString().split("T")[0]}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setStartDate(new Date(e.target.value))
              }
            />
          </div>
          <span />
        </div>
      </div>
    </div>
  );
}

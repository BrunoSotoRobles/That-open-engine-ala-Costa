/**
 * PublishedUnit alignment — reversible via COSTA_PUBLISHED_UNIT_POLICY_V1.
 * Does not change numeric quantity; only PublishedUnit when family implies JM vs M2.
 */

import { COSTA_PUBLISHED_UNIT_POLICY_V1 } from "./measurementFeatureFlags";
import type { MeasurementFamily } from "./familyQuantityPolicy";

export function applyPublishedUnitPolicy(
  extra: Record<string, string | number>,
  family: MeasurementFamily,
  provenance?: string
): void {
  if (!COSTA_PUBLISHED_UNIT_POLICY_V1) return;
  if (extra["CostaBIM.PublishedBlocked"] === 1) return;
  if (!(Number(extra["CostaBIM.PublishedQuantity"]) > 0)) return;

  const prov = String(provenance ?? extra["CostaBIM.FamilyProvenance"] ?? "").toLowerCase();

  const linearFamily =
    family === "beam" || family === "column" || family === "member" || prov.includes(":length");
  if (linearFamily) {
    extra["CostaBIM.PublishedUnit"] = "m";
    return;
  }

  if (family === "opening") {
    const unit = String(extra["CostaBIM.PublishedUnit"] ?? "").toLowerCase();
    if (unit === "m3" || unit === "m") {
      extra["CostaBIM.PublishedUnit"] = "m2";
    }
    return;
  }

  if (family === "roof" || family === "covering" || family === "slab" || family === "wall") {
    const unit = String(extra["CostaBIM.PublishedUnit"] ?? "").toLowerCase();
    if (unit === "m" || unit === "m3") {
      extra["CostaBIM.PublishedUnit"] = "m2";
    }
  }
}

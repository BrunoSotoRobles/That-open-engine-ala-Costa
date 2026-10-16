/**
 * A/B policy counters for CostStore log and MCP ping (no IFC-specific IDs).
 */

export interface AbPolicyCounts {
  dimSignals: number;
  wallFace: number;
  hollowPreferNet: number;
  ontelo: number;
  bboxPoison: number;
  publishedQuantity: number;
  layerHost: number;
  layerHidden: number;
}

const DIM_CODES = new Set(["width_eq_length", "length_eq_height", "width_eq_height"]);

export function summarizeAbPolicies(
  data: ReadonlyArray<{ extraProperties?: Record<string, string | number> }>
): AbPolicyCounts {
  const counts: AbPolicyCounts = {
    dimSignals: 0,
    wallFace: 0,
    hollowPreferNet: 0,
    ontelo: 0,
    bboxPoison: 0,
    publishedQuantity: 0,
    layerHost: 0,
    layerHidden: 0,
  };
  for (const el of data) {
    const x = el.extraProperties;
    if (!x) continue;
    const sig = x["CostaBIM.QuantitySignal"];
    if (typeof sig === "string" && DIM_CODES.has(sig)) counts.dimSignals++;
    if (x["CostaBIM.WallFaceProvenance"]) counts.wallFace++;
    if (x["CostaBIM.PreferNetVolume"] === 1) counts.hollowPreferNet++;
    if (x["CostaBIM.OnteloCode"]) counts.ontelo++;
    if (x["CostaBIM.BBoxPoison"] === 1) counts.bboxPoison++;
    if (typeof x["CostaBIM.PublishedQuantity"] === "number") counts.publishedQuantity++;
    if (x["CostaBIM.LayerRole"] === "host") counts.layerHost++;
    if (x["CostaBIM.ContributeToMaara"] === 0) counts.layerHidden++;
  }
  return counts;
}

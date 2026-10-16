import { classifyOpeningDimensions, classifyPublishedQuantity } from "./classify";
import type { BridgeClassifyResult } from "./classify";
import { bridgeFamily, buildBridgeQtoRecord } from "./record";
import { parseNum } from "./util";

export type BridgeElementLike = {
  globalId?: string;
  baseQuantities?: Record<string, { value?: number; unit?: string } | undefined>;
  extraProperties?: Record<string, unknown>;
  quantity?: number;
};

/** Shared v2.3 decision for PublishedQuantity (export + store). */
export function evaluatePublishedQuantityCorrection(
  element: BridgeElementLike,
  ifcType: string,
  publishedQuantity: number | null,
  publishedUnit: string
): BridgeClassifyResult | null {
  const rec = buildBridgeQtoRecord(
    ifcType,
    element.baseQuantities,
    element.extraProperties
  );
  const fam = bridgeFamily(ifcType);
  const res = classifyPublishedQuantity(rec, fam, publishedQuantity, publishedUnit);
  if (res.veredicto === "CORREGIDO" && res.nuevo != null) return res;
  return null;
}

export function readPublishedFromElement(
  element: BridgeElementLike
): { pq: number | null; unit: string } {
  const extra = element.extraProperties ?? {};
  const stamped = parseNum(extra["CostaBIM.PublishedQuantity"]);
  const raw =
    typeof element.quantity === "number" && element.quantity > 0 ? element.quantity : null;
  const pq = stamped ?? raw;
  const unit = String(extra["CostaBIM.PublishedUnit"] ?? "")
    .trim()
    .toLowerCase();
  return { pq, unit };
}

export function evaluateOpeningDimensionsCorrection(
  element: BridgeElementLike,
  ifcType: string,
  width: number | null,
  height: number | null
) {
  const rec = buildBridgeQtoRecord(
    ifcType,
    element.baseQuantities,
    element.extraProperties
  );
  return classifyOpeningDimensions(rec, width, height);
}

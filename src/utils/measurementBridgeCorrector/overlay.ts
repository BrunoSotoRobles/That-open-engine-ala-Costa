import { UNIT_MIRROR_KEYS } from "./constants";
import {
  evaluateOpeningDimensionsCorrection,
  evaluatePublishedQuantityCorrection,
  type BridgeElementLike,
} from "./publishedQuantityCorrection";
import { bridgeFamily } from "./record";
import { igual, parseNum } from "./util";

export type BridgeCorrectorOverlay = {
  publishedQuantity?: number;
  width?: number;
  height?: number;
  unitMirrors: Partial<Record<string, number>>;
  correctorMeta?: {
    campo: string;
    veredicto: string;
    codigo: string;
    publicado: number | null;
    nuevo: number | null;
  };
};

/**
 * Export overlay — does not mutate CostStore (applied only to row data before Excel write).
 */
export function computeBridgeCorrectorOverlay(
  element: BridgeElementLike,
  ifcType: string,
  row: Record<string, unknown>
): BridgeCorrectorOverlay | null {
  const pq = parseNum(row.pub_PublishedQuantity ?? row["PublishedQuantity"]);
  const unit = String(row.pub_PublishedUnit ?? row["PublishedUnit"] ?? "").toLowerCase();

  const overlay: BridgeCorrectorOverlay = { unitMirrors: {} };
  let changed = false;

  const correction = evaluatePublishedQuantityCorrection(element, ifcType, pq, unit);
  if (correction?.nuevo != null) {
    const rounded = Number(correction.nuevo.toFixed(6));
    overlay.publishedQuantity = rounded;
    overlay.correctorMeta = {
      campo: "PublishedQuantity",
      veredicto: correction.veredicto,
      codigo: correction.codigo,
      publicado: pq,
      nuevo: rounded,
    };
    changed = true;
    for (const key of UNIT_MIRROR_KEYS) {
      const v = parseNum(row[key]);
      if (v != null && pq != null && igual(v, pq)) {
        overlay.unitMirrors[key] = rounded;
      }
    }
  }

  if (bridgeFamily(ifcType) === "OPENING") {
    const w = parseNum(row.bq_Width ?? row.Width);
    const h = parseNum(row.bq_Height ?? row.Height);
    const openRes = evaluateOpeningDimensionsCorrection(element, ifcType, w, h);
    if (openRes.veredicto === "CORREGIDO" && openRes.nuevo) {
      overlay.width = Number(openRes.nuevo[0].toFixed(6));
      overlay.height = Number(openRes.nuevo[1].toFixed(6));
      overlay.correctorMeta = {
        campo: "Width/Height",
        veredicto: openRes.veredicto,
        codigo: openRes.codigo,
        publicado: w,
        nuevo: overlay.width,
      };
      changed = true;
    }
  }

  return changed ? overlay : null;
}

export function applyBridgeCorrectorToGuidRow(
  element: BridgeElementLike,
  ifcType: string,
  guidRowData: Record<string, unknown>
): void {
  const overlay = computeBridgeCorrectorOverlay(element, ifcType, guidRowData);
  if (!overlay) return;

  if (overlay.publishedQuantity != null) {
    guidRowData.pub_PublishedQuantity = overlay.publishedQuantity;
  }
  for (const [key, val] of Object.entries(overlay.unitMirrors)) {
    if (guidRowData[key] !== undefined) guidRowData[key] = val;
  }
  if (overlay.width != null) guidRowData.bq_Width = overlay.width;
  if (overlay.height != null) guidRowData.bq_Height = overlay.height;
}

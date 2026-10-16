import { COSTA_MEASUREMENT_BRIDGE_CORRECTOR_V1 } from "../measurementFeatureFlags";
import { stampPublishedQuantity, type PublishedQuantityUnit } from "../publishedQuantity";
import {
  evaluatePublishedQuantityCorrection,
  readPublishedFromElement,
  type BridgeElementLike,
} from "./publishedQuantityCorrection";

function normalizeUnit(unit: string): PublishedQuantityUnit {
  const u = unit.trim().toLowerCase();
  if (u === "m" || u === "jm") return "m";
  if (u === "m2" || u === "m²") return "m2";
  if (u === "m3" || u === "m³") return "m3";
  if (u === "kpl") return "kpl";
  const t = u;
  if (t.includes("m3")) return "m3";
  if (t.includes("m2")) return "m2";
  return "m";
}

function stampCorrectorAudit(
  extra: Record<string, string | number>,
  res: NonNullable<ReturnType<typeof evaluatePublishedQuantityCorrection>>,
  publicado: number | null
): void {
  extra["CostaBIM.BridgeCorrector.V1"] = 1;
  extra["CostaBIM.BridgeCorrector.Verdict"] = res.veredicto;
  extra["CostaBIM.BridgeCorrector.Codigo"] = res.codigo;
  if (publicado != null) {
    extra["CostaBIM.BridgeCorrector.Publicado"] = Number(publicado.toFixed(6));
  }
  if (res.origen) {
    extra["CostaBIM.BridgeCorrector.Canal"] = res.origen.canal;
    extra["CostaBIM.BridgeCorrector.Clave"] = res.origen.clave;
  }
}

/**
 * Final store pass — re-stamps PublishedQuantity when v2.3 says CORREGIDO.
 * Does not mutate baseQuantities. No-op when flag OFF.
 */
export function applyBridgeCorrectorStorePass<
  T extends BridgeElementLike & {
    type?: string;
    extraProperties?: Record<string, string | number>;
  },
>(element: T): T {
  if (!COSTA_MEASUREMENT_BRIDGE_CORRECTOR_V1) return element;

  const ifcType = String(element.type ?? "");
  if (!ifcType) return element;

  const extra = { ...(element.extraProperties ?? {}) };
  const { pq, unit } = readPublishedFromElement({ ...element, extraProperties: extra });
  if (pq == null) return element;

  const correction = evaluatePublishedQuantityCorrection(element, ifcType, pq, unit);
  if (!correction?.nuevo) return element;

  const pubUnit = normalizeUnit(unit || "m");
  stampPublishedQuantity(extra, correction.nuevo, pubUnit);
  stampCorrectorAudit(extra, correction, pq);

  return {
    ...element,
    quantity: correction.nuevo,
    extraProperties: extra,
  };
}

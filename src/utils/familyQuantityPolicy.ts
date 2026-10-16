/**
 * Family measurement policy (A/B matriz B) — product-level, IFC-agnostic where possible.
 * Opens (door/window), slabs, beams/columns, roof/covering, foundations.
 * Wall → wallFaceArea; ontelo → onteloQuantityPolicy (applied earlier).
 */

import { isOnteloElementName } from "./onteloQuantityPolicy";
import { resolveWallFaceArea, isWallIfcType } from "./wallFaceArea";
import { COSTA_PUBLISHED_UNIT_POLICY_V1 } from "./measurementFeatureFlags";
import { publishPrimaryQuantity } from "./measurementReliability";
import { applyPublishedUnitPolicy } from "./publishedUnitPolicy";
import type { QuantityResolutionMetadata } from "../types/cost/shared";

type QtyMap = {
  [key: string]: { value?: number; unit?: string } | undefined;
};

function readQty(bq: QtyMap, key: string): number | undefined {
  const v = bq?.[key]?.value;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

export type MeasurementFamily =
  | "ontelo"
  | "wall"
  | "opening"
  | "slab"
  | "beam"
  | "column"
  | "member"
  | "roof"
  | "covering"
  | "foundation"
  | "other";

export type FamilyQuantityProvenance =
  | "opening:OverallWxH"
  | "opening:NetArea"
  | "opening:Area"
  | "slab:NetArea"
  | "slab:GrossArea"
  | "slab:Area"
  | "beam:Length"
  | "beam:Volume"
  | "column:Length"
  | "column:Volume"
  | "member:Length"
  | "member:NetVolume"
  | "roof:Area"
  | "covering:Area"
  | "foundation:Volume"
  | "wall:delegated"
  | "ontelo:delegated"
  | "none";

export interface FamilyQuantityResult {
  family: MeasurementFamily;
  value: number;
  provenance: FamilyQuantityProvenance;
  /** Suggested SI unit for the published primary quantity */
  unit: "m2" | "m3" | "m" | "kpl";
}

export function classifyMeasurementFamily(
  name: string | undefined | null,
  ifcType: string | undefined | null,
  extraProperties?: Record<string, string | number>
): MeasurementFamily {
  if (isOnteloElementName(name, extraProperties)) return "ontelo";
  const t = String(ifcType ?? "").toUpperCase();
  if (t.includes("WALL")) return "wall";
  if (t.includes("WINDOW") || t.includes("DOOR")) return "opening";
  if (t.includes("SLAB")) return "slab";
  if (t.includes("BEAM")) return "beam";
  if (t.includes("COLUMN")) return "column";
  if (t.includes("MEMBER")) return "member";
  if (t.includes("ROOF")) return "roof";
  if (t.includes("COVERING")) return "covering";
  if (t.includes("FOOTING") || t.includes("PILE") || t.includes("PADFOUNDATION")) {
    return "foundation";
  }
  return "other";
}

/** Opening (door/window): vano = OverallWidth × OverallHeight when present. */
export function resolveOpeningAreaM2(baseQuantities: QtyMap): {
  value: number;
  provenance: FamilyQuantityProvenance;
} {
  const ow = readQty(baseQuantities, "OverallWidth");
  const oh = readQty(baseQuantities, "OverallHeight");
  if (ow != null && oh != null) {
    return { value: ow * oh, provenance: "opening:OverallWxH" };
  }
  const net = readQty(baseQuantities, "NetArea");
  if (net != null) return { value: net, provenance: "opening:NetArea" };
  const area = readQty(baseQuantities, "Area") ?? readQty(baseQuantities, "GrossArea");
  if (area != null) return { value: area, provenance: "opening:Area" };
  return { value: 0, provenance: "none" };
}

export function resolveFamilyPrimaryQuantity(
  name: string | undefined | null,
  ifcType: string | undefined | null,
  baseQuantities: QtyMap,
  extraProperties?: Record<string, string | number>
): FamilyQuantityResult {
  const family = classifyMeasurementFamily(name, ifcType, extraProperties);

  if (family === "ontelo") {
    return { family, value: 0, provenance: "ontelo:delegated", unit: "m2" };
  }
  if (family === "wall") {
    const face = resolveWallFaceArea(baseQuantities, "any", extraProperties);
    return {
      family,
      value: face.value,
      provenance: face.value > 0 ? "wall:delegated" : "none",
      unit: "m2",
    };
  }
  if (family === "opening") {
    const o = resolveOpeningAreaM2(baseQuantities);
    return { family, value: o.value, provenance: o.provenance, unit: "m2" };
  }
  if (family === "slab") {
    const net = readQty(baseQuantities, "NetArea");
    if (net != null) {
      return { family, value: net, provenance: "slab:NetArea", unit: "m2" };
    }
    const gross = readQty(baseQuantities, "GrossArea");
    if (gross != null) {
      return { family, value: gross, provenance: "slab:GrossArea", unit: "m2" };
    }
    const area = readQty(baseQuantities, "Area");
    return {
      family,
      value: area ?? 0,
      provenance: area != null ? "slab:Area" : "none",
      unit: "m2",
    };
  }
  if (family === "beam") {
    const len = readQty(baseQuantities, "Length");
    if (len != null) {
      return { family, value: len, provenance: "beam:Length", unit: "m" };
    }
    const vol =
      readQty(baseQuantities, "NetVolume") ||
      readQty(baseQuantities, "GrossVolume") ||
      readQty(baseQuantities, "Volume");
    return {
      family,
      value: vol ?? 0,
      provenance: vol != null ? "beam:Volume" : "none",
      unit: "m3",
    };
  }
  if (family === "column") {
    const len = readQty(baseQuantities, "Length") ?? readQty(baseQuantities, "Height");
    if (len != null) {
      return { family, value: len, provenance: "column:Length", unit: "m" };
    }
    const vol =
      readQty(baseQuantities, "NetVolume") ||
      readQty(baseQuantities, "GrossVolume") ||
      readQty(baseQuantities, "Volume");
    return {
      family,
      value: vol ?? 0,
      provenance: vol != null ? "column:Volume" : "none",
      unit: "m3",
    };
  }
  if (family === "member") {
    const len = readQty(baseQuantities, "Length");
    if (len != null) {
      return { family, value: len, provenance: "member:Length", unit: "m" };
    }
    const vol =
      readQty(baseQuantities, "NetVolume") ||
      readQty(baseQuantities, "Volume") ||
      readQty(baseQuantities, "GrossVolume");
    return {
      family,
      value: vol ?? 0,
      provenance: vol != null ? "member:NetVolume" : "none",
      unit: "m3",
    };
  }
  if (family === "roof" || family === "covering") {
    const area =
      readQty(baseQuantities, "NetArea") ||
      readQty(baseQuantities, "GrossArea") ||
      readQty(baseQuantities, "Area");
    return {
      family,
      value: area ?? 0,
      provenance:
        area != null
          ? family === "roof"
            ? "roof:Area"
            : "covering:Area"
          : "none",
      unit: "m2",
    };
  }
  if (family === "foundation") {
    const vol =
      readQty(baseQuantities, "NetVolume") ||
      readQty(baseQuantities, "GrossVolume") ||
      readQty(baseQuantities, "Volume");
    return {
      family,
      value: vol ?? 0,
      provenance: vol != null ? "foundation:Volume" : "none",
      unit: "m3",
    };
  }
  return { family: "other", value: 0, provenance: "none", unit: "m2" };
}

function stampFamilyPublish(
  extra: Record<string, string | number>,
  value: number,
  unit: "m2" | "m3" | "m" | "kpl",
  family: MeasurementFamily,
  ctx: {
    provenance?: string;
    wallFaceProvenance?: string;
    baseQuantities?: QtyMap;
    ifcType?: string;
  } = {}
): boolean {
  const ok = publishPrimaryQuantity(extra, value, unit, {
    provenance: ctx.provenance,
    wallFaceProvenance: ctx.wallFaceProvenance,
    baseQuantities: ctx.baseQuantities,
    extraProperties: extra,
    ifcType: ctx.ifcType,
  });
  if (ok && COSTA_PUBLISHED_UNIT_POLICY_V1) {
    applyPublishedUnitPolicy(extra, family, ctx.provenance);
  }
  return ok;
}

function quantityAfterPublish(
  extra: Record<string, string | number>,
  value: number | undefined
): number | undefined {
  if (extra["CostaBIM.PublishedBlocked"] === 1) return undefined;
  return value;
}

/**
 * Tag family + publish primary quantity for openings (and fill slab/foundation when empty).
 * Does not override ontelo / wall policies already applied.
 */
export function applyFamilyQuantityPolicyToElement<
  T extends {
    name?: string;
    type?: string;
    quantity?: number;
    baseQuantities?: QtyMap;
    quantityResolution?: QuantityResolutionMetadata;
    extraProperties?: Record<string, string | number>;
  },
>(element: T): T {
  if (element.extraProperties?.["CostaBIM.MeasurementFamily"]) return element;
  // Ontelo / wall already own quantity
  if (element.extraProperties?.["CostaBIM.OnteloDimPolicy"]) {
    const extra = { ...(element.extraProperties ?? {}) };
    extra["CostaBIM.MeasurementFamily"] = "ontelo";
    if (typeof element.quantity === "number" && element.quantity > 0) {
      stampFamilyPublish(extra, element.quantity, "m2", "ontelo", {
        provenance: "ontelo:delegated",
        baseQuantities: element.baseQuantities,
        ifcType: element.type,
      });
    }
    return { ...element, extraProperties: extra };
  }
  if (element.extraProperties?.["CostaBIM.WallFaceProvenance"] || isWallIfcType(element.type)) {
    const face = resolveWallFaceArea(
      element.baseQuantities ?? {},
      "any",
      element.extraProperties
    );
    const extra = { ...(element.extraProperties ?? {}) };
    extra["CostaBIM.MeasurementFamily"] = "wall";
    if (face.provenance !== "none") {
      extra["CostaBIM.FamilyProvenance"] = `wall:${face.provenance}`;
    }
    if (face.value > 0) {
      stampFamilyPublish(extra, face.value, "m2", "wall", {
        provenance: face.provenance !== "none" ? `wall:${face.provenance}` : undefined,
        wallFaceProvenance: face.provenance,
        baseQuantities: element.baseQuantities,
        ifcType: element.type,
      });
    }
    return {
      ...element,
      quantity: quantityAfterPublish(extra, face.value > 0 ? face.value : element.quantity),
      extraProperties: extra,
    };
  }

  const resolved = resolveFamilyPrimaryQuantity(
    element.name,
    element.type,
    element.baseQuantities ?? {},
    element.extraProperties
  );

  const extra = { ...(element.extraProperties ?? {}) };
  extra["CostaBIM.MeasurementFamily"] = resolved.family;
  if (resolved.provenance !== "none" && resolved.provenance !== "ontelo:delegated") {
    extra["CostaBIM.FamilyProvenance"] = resolved.provenance;
  }
  if (resolved.unit) {
    extra["CostaBIM.FamilyPrimaryUnit"] = resolved.unit;
  }

  const structuralLengthFamily =
    resolved.family === "beam" || resolved.family === "column" || resolved.family === "member";
  const lengthProvenance =
    structuralLengthFamily &&
    (resolved.provenance === "beam:Length" ||
      resolved.provenance === "column:Length" ||
      resolved.provenance === "member:Length");
  const structuralLengthStale =
    lengthProvenance &&
    typeof element.quantity === "number" &&
    element.quantity > 0 &&
    resolved.value > 0 &&
    Math.abs(element.quantity - resolved.value) / Math.max(resolved.value, 1e-9) > 0.05;

  const shouldPublishQty =
    resolved.value > 0 &&
    (resolved.family === "opening" ||
      resolved.family === "slab" ||
      resolved.family === "foundation" ||
      resolved.family === "roof" ||
      resolved.family === "covering" ||
      structuralLengthStale ||
      (structuralLengthFamily && !(element.quantity != null && element.quantity > 0)));

  const published = shouldPublishQty ? resolved.value : element.quantity;
  if (typeof published === "number" && published > 0) {
    stampFamilyPublish(extra, published, resolved.unit, resolved.family, {
      provenance: resolved.provenance !== "none" ? resolved.provenance : undefined,
      baseQuantities: element.baseQuantities,
      ifcType: element.type,
    });
  }

  const rawQty = shouldPublishQty ? resolved.value : element.quantity;
  return {
    ...element,
    quantity: quantityAfterPublish(extra, rawQty),
    extraProperties: extra,
  };
}

/**
 * Ontelo (Oxx) quantity policy — A/B P1.
 * Tipado IFC no fija la función (BEAM vs SLAB). Cuando Width≈Length, decidir
 * piece width vs span usando Area (y ancho nominal 1.2 m), sin hardcode de edificio.
 */

import { detectOnteloType, PIECE_WIDTH_M, type OnteloType } from "./ontelolaattaUtils";
import { WIDTH_EQ_LENGTH_REL_TOL } from "./widthLengthSignal";
import { publishPrimaryQuantity } from "./measurementReliability";
import { applyPublishedUnitPolicy } from "./publishedUnitPolicy";
import { COSTA_PUBLISHED_UNIT_POLICY_V1 } from "./measurementFeatureFlags";
import type { QuantityResolutionMetadata } from "../types/cost/shared";

type QtyMap = {
  [key: string]: { value?: number; unit?: string } | undefined;
};

function readQty(bq: QtyMap, key: string): number | undefined {
  const v = bq?.[key]?.value;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

function nearlyEqual(a: number, b: number, relTol = 0.05): boolean {
  if (b === 0) return Math.abs(a) < 1e-9;
  return Math.abs(a - b) / Math.abs(b) <= relTol;
}

/** Paavola-style names are often just ONTELOLAATTA without embedded Oxx. */
const ONTELO_FAMILY_NAME_RE = /ontelolaatta/i;

/**
 * Resolve ontelo identity from name and optional extraProperties (e.g. QTO Reference).
 */
export function resolveOnteloIdentity(
  name: string | undefined | null,
  extraProperties?: Record<string, string | number>
): OnteloType | null {
  const n = String(name ?? "");
  const fromName = detectOnteloType(n);
  if (fromName) return fromName;

  if (extraProperties) {
    for (const [key, val] of Object.entries(extraProperties)) {
      if (typeof val !== "string" && typeof val !== "number") continue;
      if (!/reference|ontelo|product/i.test(key) && !/^o\d{2}/i.test(String(val))) {
        continue;
      }
      const token = String(val).trim();
      const fromExtra =
        detectOnteloType(token) ||
        detectOnteloType(`:${token}:`) ||
        detectOnteloType(` ${token} `);
      if (fromExtra) return fromExtra;
    }
  }

  if (ONTELO_FAMILY_NAME_RE.test(n)) {
    return { code: "ONTELO", baseNumber: 0, thicknessMm: null, suffix: "" };
  }
  return null;
}

export type OnteloDimPolicyCode =
  | "span_from_duplicated_wl"
  | "piece_width_from_wl"
  | "area_only"
  | "dims_ok";

export interface OnteloQuantityResolution {
  isOntelo: true;
  code: string;
  footprintM2: number | undefined;
  pieceWidthM: number | undefined;
  spanM: number | undefined;
  thicknessM: number | undefined;
  policy: OnteloDimPolicyCode;
  message: string;
}

export function isOnteloElementName(
  name: string | undefined | null,
  extraProperties?: Record<string, string | number>
): boolean {
  return resolveOnteloIdentity(name, extraProperties) != null;
}

export function readFootprintAreaM2(baseQuantities: QtyMap): number | undefined {
  return (
    readQty(baseQuantities, "NetArea") ||
    readQty(baseQuantities, "GrossArea") ||
    readQty(baseQuantities, "Area")
  );
}

/**
 * When Width≈Length on an Oxx element, infer piece width vs span from Area.
 * - If Area / 1.2 ≈ W → duplicated W/L is SPAN (Paavola-like); piece = 1.2.
 * - Else if W ≤ 1.2·1.05 and Area/W ≫ W → W is piece width; span = Area/W (Revit half-plate).
 * - Else keep Area as footprint only.
 */
export function resolveOnteloQuantityPolicy(
  name: string | undefined | null,
  baseQuantities: QtyMap,
  relTol: number = WIDTH_EQ_LENGTH_REL_TOL,
  extraProperties?: Record<string, string | number>
): OnteloQuantityResolution | null {
  const ontelo = resolveOnteloIdentity(name, extraProperties);
  if (!ontelo) return null;

  const width = readQty(baseQuantities, "Width");
  const length = readQty(baseQuantities, "Length");
  const height = readQty(baseQuantities, "Height");
  const footprintM2 = readFootprintAreaM2(baseQuantities);
  const thicknessM =
    ontelo.thicknessMm != null ? ontelo.thicknessMm / 1000 : height;

  const wlDup =
    width != null &&
    length != null &&
    Math.abs(width - length) / Math.max(width, length) <= relTol;

  if (!wlDup) {
    const span = length ?? width;
    const piece =
      width != null && length != null
        ? Math.min(width, length)
        : width ?? length;
    return {
      isOntelo: true,
      code: ontelo.code,
      footprintM2,
      pieceWidthM: piece,
      spanM: span,
      thicknessM,
      policy: "dims_ok",
      message: `Ontelo ${ontelo.code}: Width/Length distinct`,
    };
  }

  // Width ≈ Length
  const dup = width!;

  if (footprintM2 != null && footprintM2 > 0) {
    const spanIfPiece12 = footprintM2 / PIECE_WIDTH_M;
    if (nearlyEqual(spanIfPiece12, dup, 0.08)) {
      return {
        isOntelo: true,
        code: ontelo.code,
        footprintM2,
        pieceWidthM: PIECE_WIDTH_M,
        spanM: dup,
        thicknessM,
        policy: "span_from_duplicated_wl",
        message: `Ontelo ${ontelo.code}: W≈L is span; piece width nominal ${PIECE_WIDTH_M} m (Area/1.2≈W)`,
      };
    }

    const spanIfWIsPiece = footprintM2 / dup;
    if (dup <= PIECE_WIDTH_M * 1.05 && spanIfWIsPiece > dup * 1.5) {
      return {
        isOntelo: true,
        code: ontelo.code,
        footprintM2,
        pieceWidthM: dup,
        spanM: spanIfWIsPiece,
        thicknessM,
        policy: "piece_width_from_wl",
        message: `Ontelo ${ontelo.code}: W≈L is piece width; span=Area/W`,
      };
    }

    return {
      isOntelo: true,
      code: ontelo.code,
      footprintM2,
      pieceWidthM: undefined,
      spanM: undefined,
      thicknessM,
      policy: "area_only",
      message: `Ontelo ${ontelo.code}: W≈L ambiguous; use Area footprint only`,
    };
  }

  return {
    isOntelo: true,
    code: ontelo.code,
    footprintM2: undefined,
    pieceWidthM: undefined,
    spanM: dup,
    thicknessM,
    policy: "area_only",
    message: `Ontelo ${ontelo.code}: W≈L without Area; do not trust Width as profile`,
  };
}

export function getOnteloFootprintM2(
  name: string | undefined | null,
  baseQuantities: QtyMap,
  fallback = 0,
  extraProperties?: Record<string, string | number>
): number {
  const r = resolveOnteloQuantityPolicy(name, baseQuantities, WIDTH_EQ_LENGTH_REL_TOL, extraProperties);
  if (r?.footprintM2 != null && r.footprintM2 > 0) return r.footprintM2;
  return readFootprintAreaM2(baseQuantities) ?? fallback;
}

export function getOnteloSpanM(
  name: string | undefined | null,
  baseQuantities: QtyMap,
  fallback = 0,
  extraProperties?: Record<string, string | number>
): number {
  const r = resolveOnteloQuantityPolicy(name, baseQuantities, WIDTH_EQ_LENGTH_REL_TOL, extraProperties);
  if (r?.spanM != null && r.spanM > 0) return r.spanM;
  return readQty(baseQuantities, "Length") ?? fallback;
}

export function applyOnteloQuantityPolicyToElement<
  T extends {
    name?: string;
    type?: string;
    quantity?: number;
    baseQuantities?: QtyMap;
    quantityResolution?: QuantityResolutionMetadata;
    extraProperties?: Record<string, string | number>;
  },
>(element: T): T {
  const resolved = resolveOnteloQuantityPolicy(
    element.name,
    element.baseQuantities ?? {},
    WIDTH_EQ_LENGTH_REL_TOL,
    element.extraProperties
  );
  if (!resolved) return element;
  if (element.extraProperties?.["CostaBIM.OnteloDimPolicy"]) return element;

  const extra = { ...(element.extraProperties ?? {}) };
  extra["CostaBIM.OnteloCode"] = resolved.code;
  extra["CostaBIM.OnteloDimPolicy"] = resolved.policy;
  if (resolved.footprintM2 != null && resolved.footprintM2 > 0) {
    extra["CostaBIM.OnteloFootprintM2"] = Number(resolved.footprintM2.toFixed(6));
    publishPrimaryQuantity(extra, resolved.footprintM2, "m2", {
      provenance: "ontelo:delegated",
      baseQuantities: element.baseQuantities,
      extraProperties: extra,
      ifcType: element.type,
    });
    if (COSTA_PUBLISHED_UNIT_POLICY_V1) {
      applyPublishedUnitPolicy(extra, "ontelo", "ontelo:delegated");
    }
  }
  if (resolved.pieceWidthM != null) {
    extra["CostaBIM.OnteloPieceWidthM"] = Number(resolved.pieceWidthM.toFixed(6));
  }
  if (resolved.spanM != null) {
    extra["CostaBIM.OnteloSpanM"] = Number(resolved.spanM.toFixed(6));
  }
  if (resolved.policy === "span_from_duplicated_wl") {
    extra["CostaBIM.IgnoreProfileWidth"] = 1;
  }
  if (resolved.policy === "piece_width_from_wl") {
    // Width is piece width; Length was duplicate — ignore Length as independent span source without Area
    extra["CostaBIM.OnteloLengthIsDuplicate"] = 1;
  }

  const warning = resolved.message;
  const prev = element.quantityResolution;
  const resolution: QuantityResolutionMetadata = prev
    ? {
        ...prev,
        warnings: Array.from(new Set([...(prev.warnings ?? []), warning])),
        status: prev.status === "ok" ? "corrected" : prev.status,
      }
    : {
        resolved: {},
        original: {},
        warnings: [warning],
        status: "corrected",
      };

  // Publish footprint as quantity when we have M2 truth (forjado)
  const nextQty =
    resolved.footprintM2 != null && resolved.footprintM2 > 0
      ? resolved.footprintM2
      : element.quantity;

  return {
    ...element,
    quantity: nextQty,
    quantityResolution: resolution,
    extraProperties: extra,
  };
}

/**
 * Linear dimension duplication signals (A/B — beam / column / slab / member).
 * Width≈Length (paso 3) and Length≈Height / Width≈Height (Lahdesjärvi Revit).
 */

import type { QuantityResolutionMetadata } from "../types/cost/shared";

export const DIM_DUP_REL_TOL = 0.03; // 3%

export type DimensionDuplicationCode =
  | "width_eq_length"
  | "length_eq_height"
  | "width_eq_height";

export interface DimensionDuplicationSignal {
  code: DimensionDuplicationCode;
  aKey: "Width" | "Length" | "Height";
  bKey: "Width" | "Length" | "Height";
  a: number;
  b: number;
  relDiff: number;
  /** Width is not a reliable profile width */
  ignoreProfileWidth: boolean;
  /** Height duplicates Length (or Width); do not treat Height as independent profile dim */
  ignoreDuplicateHeight: boolean;
  message: string;
}

export const WIDTH_EQ_LENGTH_REL_TOL = DIM_DUP_REL_TOL;
export type WidthLengthSignalCode = "width_eq_length";
/** @deprecated use DimensionDuplicationSignal */
export type WidthLengthSignal = DimensionDuplicationSignal;

type QtyMap = {
  [key: string]: { value?: number; unit?: string } | undefined;
};

function readQty(bq: QtyMap, key: string): number | undefined {
  const v = bq?.[key]?.value;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

export function isBeamColumnOrSlabType(ifcType: string | undefined | null): boolean {
  const t = String(ifcType ?? "").toUpperCase();
  return (
    t.includes("BEAM") ||
    t.includes("COLUMN") ||
    t.includes("SLAB") ||
    t.includes("MEMBER")
  );
}

function pairEqual(
  a: number | undefined,
  b: number | undefined,
  relTol: number
): { relDiff: number } | null {
  if (a == null || b == null) return null;
  const relDiff = Math.abs(a - b) / Math.max(a, b);
  if (relDiff > relTol) return null;
  return { relDiff };
}

/**
 * Prefer Width≈Length, then Length≈Height (Revit extrusion), then Width≈Height.
 */
export function detectDimensionDuplication(
  baseQuantities: QtyMap,
  ifcType?: string | null,
  relTol: number = DIM_DUP_REL_TOL
): DimensionDuplicationSignal | null {
  if (!isBeamColumnOrSlabType(ifcType)) return null;

  const width = readQty(baseQuantities, "Width");
  const length = readQty(baseQuantities, "Length");
  const height = readQty(baseQuantities, "Height");

  const wl = pairEqual(width, length, relTol);
  if (wl && width != null && length != null) {
    return {
      code: "width_eq_length",
      aKey: "Width",
      bKey: "Length",
      a: width,
      b: length,
      relDiff: wl.relDiff,
      ignoreProfileWidth: true,
      ignoreDuplicateHeight: false,
      message: `Width≈Length (${width.toFixed(4)} ≈ ${length.toFixed(4)}); do not use Width as profile width`,
    };
  }

  const lh = pairEqual(length, height, relTol);
  if (lh && length != null && height != null) {
    return {
      code: "length_eq_height",
      aKey: "Length",
      bKey: "Height",
      a: length,
      b: height,
      relDiff: lh.relDiff,
      ignoreProfileWidth: false,
      ignoreDuplicateHeight: true,
      message: `Length≈Height (${length.toFixed(4)} ≈ ${height.toFixed(4)}); Height duplicates Length — Width may be the profile dim`,
    };
  }

  const wh = pairEqual(width, height, relTol);
  if (wh && width != null && height != null) {
    return {
      code: "width_eq_height",
      aKey: "Width",
      bKey: "Height",
      a: width,
      b: height,
      relDiff: wh.relDiff,
      ignoreProfileWidth: true,
      ignoreDuplicateHeight: true,
      message: `Width≈Height (${width.toFixed(4)} ≈ ${height.toFixed(4)}); linear dims duplicated`,
    };
  }

  return null;
}

/** Backward-compatible helper: Width≈Length only. */
export function detectWidthEqualsLength(
  baseQuantities: QtyMap,
  ifcType?: string | null,
  relTol: number = DIM_DUP_REL_TOL
): DimensionDuplicationSignal | null {
  const s = detectDimensionDuplication(baseQuantities, ifcType, relTol);
  return s?.code === "width_eq_length" ? s : null;
}

export function getReliableProfileWidth(
  baseQuantities: QtyMap,
  ifcType?: string | null
): number | undefined {
  const s = detectDimensionDuplication(baseQuantities, ifcType);
  if (s?.ignoreProfileWidth) return undefined;
  return readQty(baseQuantities, "Width");
}

export function buildDimensionDuplicationResolution(
  signal: DimensionDuplicationSignal
): QuantityResolutionMetadata {
  return {
    resolved: {},
    original: {
      [signal.aKey]: [
        {
          value: signal.a,
          unit: "m",
          source: "ifc_base",
          rawKey: signal.aKey,
        },
      ],
      [signal.bKey]: [
        {
          value: signal.b,
          unit: "m",
          source: "ifc_base",
          rawKey: signal.bKey,
        },
      ],
    },
    warnings: [signal.message],
    status: "conflict",
  };
}

export function buildWidthLengthQuantityResolution(
  signal: DimensionDuplicationSignal
): QuantityResolutionMetadata {
  return buildDimensionDuplicationResolution(signal);
}

/** Attach duplication signal (idempotent). */
export function applyWidthLengthSignalToElement<
  T extends {
    type?: string;
    baseQuantities?: QtyMap;
    quantityResolution?: QuantityResolutionMetadata;
    extraProperties?: Record<string, string | number>;
  },
>(element: T): T {
  const signal = detectDimensionDuplication(element.baseQuantities ?? {}, element.type);
  if (!signal) return element;

  const prevCode = element.extraProperties?.["CostaBIM.QuantitySignal"];
  if (prevCode === signal.code) return element;

  const built = buildDimensionDuplicationResolution(signal);
  const prev = element.quantityResolution;
  const resolution: QuantityResolutionMetadata = prev
    ? {
        ...prev,
        original: {
          ...(prev.original ?? {}),
          ...built.original,
        },
        warnings: Array.from(
          new Set([...(prev.warnings ?? []), ...(built.warnings ?? [])])
        ),
        status: "conflict",
      }
    : built;

  const extra = { ...(element.extraProperties ?? {}) };
  extra["CostaBIM.QuantitySignal"] = signal.code;
  if (signal.ignoreProfileWidth) {
    extra["CostaBIM.IgnoreProfileWidth"] = 1;
  }
  if (signal.ignoreDuplicateHeight) {
    extra["CostaBIM.IgnoreDuplicateHeight"] = 1;
  }

  return {
    ...element,
    quantityResolution: resolution,
    extraProperties: extra,
  };
}

/**
 * D3 — Instanced / shared-mesh bbox poison guard.
 * When Width×Length×Height looks like a building footprint box (all dims large),
 * do not trust those quantities for määräluettelo. Flag + strip.
 * No project-specific names/IDs.
 */

import type { QuantityResolutionMetadata } from "../types/cost/shared";

/** Each axis must be at least this (m) to count as "all dims building-scale". */
export const BBOX_POISON_MIN_EACH_M = 1.8;
/** At least one axis at/above this (m). */
export const BBOX_POISON_MAX_SPAN_M = 15;
/** Product W×L×H at/above this (m³). */
export const BBOX_POISON_MIN_VOLUME_M3 = 80;
/** Identical W/L/H group size to treat as shared-instance poison even if slightly under volume. */
export const BBOX_POISON_SHARED_GROUP_MIN = 5;

export type InstancedBBoxPoisonCode = "instanced_bbox_poison";

type QtyMap = {
  [key: string]: { value?: number; unit?: string } | undefined;
};

function readQty(bq: QtyMap, key: string): number | undefined {
  const v = bq?.[key]?.value;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

export interface InstancedBBoxPoisonSignal {
  code: InstancedBBoxPoisonCode;
  width: number;
  length: number;
  height: number;
  volumeProduct: number;
  message: string;
}

export function isBuildingScaleBox(
  width: number,
  length: number,
  height: number,
  opts?: {
    minEach?: number;
    maxSpan?: number;
    minVolume?: number;
  }
): boolean {
  const minEach = opts?.minEach ?? BBOX_POISON_MIN_EACH_M;
  const maxSpan = opts?.maxSpan ?? BBOX_POISON_MAX_SPAN_M;
  const minVolume = opts?.minVolume ?? BBOX_POISON_MIN_VOLUME_M3;
  if (width < minEach || length < minEach || height < minEach) return false;
  if (Math.max(width, length, height) < maxSpan) return false;
  return width * length * height >= minVolume;
}

export function detectInstancedBBoxPoison(
  baseQuantities: QtyMap
): InstancedBBoxPoisonSignal | null {
  const width = readQty(baseQuantities, "Width");
  const length = readQty(baseQuantities, "Length");
  const height = readQty(baseQuantities, "Height");
  if (width == null || length == null || height == null) return null;
  if (!isBuildingScaleBox(width, length, height)) return null;

  const volumeProduct = width * length * height;
  return {
    code: "instanced_bbox_poison",
    width,
    length,
    height,
    volumeProduct,
    message: `Building-scale box ${width.toFixed(2)}×${length.toFixed(2)}×${height.toFixed(2)} m (≈${volumeProduct.toFixed(0)} m³); likely shared-instance bbox — do not use for QTO`,
  };
}

/** Geometry fallback must not return building-scale dims. */
export function rejectPoisonedGeometricDimensions(dims: {
  width: number;
  length: number;
  height: number;
}): boolean {
  return isBuildingScaleBox(dims.width, dims.length, dims.height);
}

const STRIP_KEYS = [
  "Width",
  "Length",
  "Height",
  "Area",
  "GrossArea",
  "NetArea",
  "GrossSideArea",
  "NetSideArea",
  "Volume",
  "GrossVolume",
  "NetVolume",
] as const;

function stripPoisonedQuantities(bq: QtyMap): QtyMap {
  const next: QtyMap = { ...bq };
  for (const k of STRIP_KEYS) {
    delete next[k];
  }
  return next;
}

export function applyInstancedBBoxGuardToElement<
  T extends {
    quantity?: number;
    baseQuantities?: QtyMap;
    quantityResolution?: QuantityResolutionMetadata;
    extraProperties?: Record<string, string | number>;
  },
>(element: T): T {
  const signal = detectInstancedBBoxPoison(element.baseQuantities ?? {});
  if (!signal) return element;
  if (element.extraProperties?.["CostaBIM.BBoxPoison"] === 1) return element;

  const extra = { ...(element.extraProperties ?? {}) };
  extra["CostaBIM.BBoxPoison"] = 1;
  extra["CostaBIM.QuantitySignal"] = signal.code;

  const warning = signal.message;
  const prev = element.quantityResolution;
  const resolution: QuantityResolutionMetadata = prev
    ? {
        ...prev,
        warnings: Array.from(new Set([...(prev.warnings ?? []), warning])),
        status: "conflict",
      }
    : {
        resolved: {},
        original: {
          Width: [
            {
              value: signal.width,
              unit: "m",
              source: "ifc_base",
              rawKey: "Width",
            },
          ],
          Length: [
            {
              value: signal.length,
              unit: "m",
              source: "ifc_base",
              rawKey: "Length",
            },
          ],
          Height: [
            {
              value: signal.height,
              unit: "m",
              source: "ifc_base",
              rawKey: "Height",
            },
          ],
        },
        warnings: [warning],
        status: "conflict",
      };

  return {
    ...element,
    quantity: 0,
    baseQuantities: stripPoisonedQuantities(element.baseQuantities ?? {}),
    quantityResolution: resolution,
    extraProperties: extra,
  };
}

function dimKey(bq: QtyMap): string | null {
  const w = readQty(bq, "Width");
  const l = readQty(bq, "Length");
  const h = readQty(bq, "Height");
  if (w == null || l == null || h == null) return null;
  // 1 mm resolution in m
  return `${w.toFixed(3)}|${l.toFixed(3)}|${h.toFixed(3)}`;
}

/**
 * If many elements share the exact same W/L/H and that box is building-scale
 * (or large group with all dims ≥ minEach), flag them all.
 */
export function applySharedInstanceBBoxGuard<
  T extends {
    quantity?: number;
    baseQuantities?: QtyMap;
    quantityResolution?: QuantityResolutionMetadata;
    extraProperties?: Record<string, string | number>;
  },
>(elements: T[], groupMin: number = BBOX_POISON_SHARED_GROUP_MIN): T[] {
  const groups = new Map<string, number[]>();
  elements.forEach((el, i) => {
    const key = dimKey(el.baseQuantities ?? {});
    if (!key) return;
    const list = groups.get(key) ?? [];
    list.push(i);
    groups.set(key, list);
  });

  const poisonIdx = new Set<number>();
  for (const [, idxs] of groups) {
    if (idxs.length < groupMin) continue;
    const sample = elements[idxs[0]];
    const w = readQty(sample.baseQuantities ?? {}, "Width");
    const l = readQty(sample.baseQuantities ?? {}, "Length");
    const h = readQty(sample.baseQuantities ?? {}, "Height");
    if (w == null || l == null || h == null) continue;
    // Shared identical box at scale: relax volume slightly for large groups
    const scaleOk =
      isBuildingScaleBox(w, l, h) ||
      (idxs.length >= 20 &&
        isBuildingScaleBox(w, l, h, { minVolume: 40 }));
    if (!scaleOk) continue;
    for (const i of idxs) poisonIdx.add(i);
  }

  if (poisonIdx.size === 0) {
    return elements.map((el) => applyInstancedBBoxGuardToElement(el));
  }

  return elements.map((el, i) => {
    if (!poisonIdx.has(i)) return applyInstancedBBoxGuardToElement(el);
    // Force poison even if single-element thresholds were borderline
    const bq = el.baseQuantities ?? {};
    const w = readQty(bq, "Width") ?? 0;
    const l = readQty(bq, "Length") ?? 0;
    const h = readQty(bq, "Height") ?? 0;
    if (el.extraProperties?.["CostaBIM.BBoxPoison"] === 1) return el;
    const extra = { ...(el.extraProperties ?? {}) };
    extra["CostaBIM.BBoxPoison"] = 1;
    extra["CostaBIM.QuantitySignal"] = "instanced_bbox_poison";
    return {
      ...el,
      quantity: 0,
      baseQuantities: stripPoisonedQuantities(bq),
      extraProperties: extra,
      quantityResolution: {
        resolved: {},
        original: {},
        warnings: [
          `Shared identical box ${w.toFixed(2)}×${l.toFixed(2)}×${h.toFixed(2)} m across ${poisonIdx.size}+ elements; instanced bbox poison`,
        ],
        status: "conflict" as const,
      },
    };
  });
}

/**
 * Hollow-section volume policy (A/B).
 * When GrossVolume (or solid CrossSectionArea) treats a hollow profile as solid,
 * prefer NetVolume and flag for consumers.
 */

import type { QuantityResolutionMetadata } from "../types/cost/shared";

export const HOLLOW_GROSS_NET_MIN_RATIO = 2.5;

export type HollowSectionSignalCode = "hollow_section_prefer_net";

type QtyMap = {
  [key: string]: { value?: number; unit?: string } | undefined;
};

function readQty(bq: QtyMap, key: string): number | undefined {
  const v = bq?.[key]?.value;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

export function isHollowSectionCandidateType(ifcType: string | undefined | null): boolean {
  const t = String(ifcType ?? "").toUpperCase();
  return t.includes("MEMBER") || t.includes("COLUMN") || t.includes("BEAM");
}

export interface HollowSectionSignal {
  code: HollowSectionSignalCode;
  grossVolume: number;
  netVolume: number;
  ratio: number;
  message: string;
}

export function detectHollowSectionPreferNet(
  baseQuantities: QtyMap,
  ifcType?: string | null,
  minRatio: number = HOLLOW_GROSS_NET_MIN_RATIO
): HollowSectionSignal | null {
  if (!isHollowSectionCandidateType(ifcType)) return null;

  const net = readQty(baseQuantities, "NetVolume");
  const gross =
    readQty(baseQuantities, "GrossVolume") ?? readQty(baseQuantities, "Volume");
  if (net == null || gross == null || net <= 0 || gross <= 0) return null;

  const ratio = gross / net;
  if (ratio < minRatio) return null;

  return {
    code: "hollow_section_prefer_net",
    grossVolume: gross,
    netVolume: net,
    ratio,
    message: `GrossVolume/NetVolume ≈ ${ratio.toFixed(1)}×; prefer NetVolume for hollow section`,
  };
}

/** Volume to publish for M3 when hollow policy applies. */
export function getReliableStructuralVolume(
  baseQuantities: QtyMap,
  ifcType?: string | null,
  extraProperties?: Record<string, string | number>
): number {
  if (
    extraProperties?.["CostaBIM.PreferNetVolume"] === 1 ||
    detectHollowSectionPreferNet(baseQuantities, ifcType)
  ) {
    const net = readQty(baseQuantities, "NetVolume");
    if (net != null && net > 0) return net;
  }
  return (
    readQty(baseQuantities, "GrossVolume") ||
    readQty(baseQuantities, "NetVolume") ||
    readQty(baseQuantities, "Volume") ||
    0
  );
}

export function applyHollowSectionPolicyToElement<
  T extends {
    type?: string;
    baseQuantities?: QtyMap;
    quantityResolution?: QuantityResolutionMetadata;
    extraProperties?: Record<string, string | number>;
  },
>(element: T): T {
  const signal = detectHollowSectionPreferNet(element.baseQuantities ?? {}, element.type);
  if (!signal) return element;

  if (element.extraProperties?.["CostaBIM.PreferNetVolume"] === 1) {
    return element;
  }

  const extra = { ...(element.extraProperties ?? {}) };
  extra["CostaBIM.PreferNetVolume"] = 1;
  extra["CostaBIM.HollowSectionSignal"] = signal.code;
  // Do not overwrite QuantitySignal if dimension duplication already set
  if (!extra["CostaBIM.QuantitySignal"]) {
    extra["CostaBIM.QuantitySignal"] = signal.code;
  }

  const warning = signal.message;
  const prev = element.quantityResolution;
  const resolution: QuantityResolutionMetadata = prev
    ? {
        ...prev,
        warnings: Array.from(new Set([...(prev.warnings ?? []), warning])),
        status: prev.status === "ok" ? "conflict" : prev.status,
      }
    : {
        resolved: {},
        original: {
          GrossVolume: [
            {
              value: signal.grossVolume,
              unit: "m³",
              source: "ifc_base",
              rawKey: "GrossVolume",
            },
          ],
          NetVolume: [
            {
              value: signal.netVolume,
              unit: "m³",
              source: "ifc_base",
              rawKey: "NetVolume",
            },
          ],
        },
        warnings: [warning],
        status: "conflict",
      };

  return {
    ...element,
    quantityResolution: resolution,
    extraProperties: extra,
  };
}

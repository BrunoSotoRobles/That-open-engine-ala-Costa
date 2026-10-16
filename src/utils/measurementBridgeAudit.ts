/**
 * Audit / diagnostics for measurement bridge export (UI + MCP).
 *
 * REVERSIBLE: measurementFeatureFlags.COSTA_MEASUREMENT_PREFLIGHT_V1
 */

import {
  isProfileLengthSuspect,
  provenanceConsumesLength,
  teklaBqLengthMismatch,
} from "./measurementReliability";
/** Bridge Excel = measured quantities only. Block 4 preflight never adds audit columns to export. */
export const BRIDGE_MEASUREMENT_AUDIT_ENABLED = false;

export type BridgeAuditColumnDef = {
  id: string;
  header: string;
  sourceKey: string;
};

export const BRIDGE_AUDIT_COLUMN_DEFS: ReadonlyArray<BridgeAuditColumnDef> = [
  { id: "audit_MeasurementFamily", header: "MeasurementFamily", sourceKey: "CostaBIM.MeasurementFamily" },
  { id: "audit_FamilyProvenance", header: "FamilyProvenance", sourceKey: "CostaBIM.FamilyProvenance" },
  { id: "audit_QuantitySignal", header: "QuantitySignal", sourceKey: "CostaBIM.QuantitySignal" },
  { id: "audit_ContributeToMaara", header: "ContributeToMaara", sourceKey: "CostaBIM.ContributeToMaara" },
  { id: "audit_BBoxPoison", header: "BBoxPoison", sourceKey: "CostaBIM.BBoxPoison" },
  { id: "audit_QuantityWarnings", header: "QuantityWarnings", sourceKey: "__computed__" },
];

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readBqLengthM(element: any): number | null {
  const bq = element?.baseQuantities?.Length;
  if (bq == null) return null;
  const v = typeof bq === "number" ? bq : parseFiniteNumber((bq as { value?: unknown })?.value);
  if (v === null || v <= 0) return null;
  return v;
}

function readTeklaLengthM(extra: Record<string, unknown>): number | null {
  for (const [key, raw] of Object.entries(extra)) {
    const lower = key.toLowerCase();
    if (!lower.startsWith("tekla quantity.") || !lower.endsWith("length")) continue;
    const v = parseFiniteNumber(raw);
    if (v === null || v <= 0) return null;
    return v > 100 ? v / 1000 : v;
  }
  return null;
}

/** Read-only warning string for export; does not mutate quantities. */
export function computeQuantityWarnings(element: any): string {
  const warnings = new Set<string>();
  const extra = (element?.extraProperties ?? {}) as Record<string, unknown>;

  const sig = extra["CostaBIM.QuantitySignal"];
  if (typeof sig === "string" && sig.trim()) warnings.add(sig.trim());

  if (extra["CostaBIM.BBoxPoison"] === 1) warnings.add("instanced_bbox_poison");

  if (extra["CostaBIM.PublishedBlocked"] === 1) {
    const reason = extra["CostaBIM.PublishedBlockReason"];
    warnings.add(typeof reason === "string" && reason ? `published_blocked:${reason}` : "published_blocked");
  }

  const isOntelo =
    extra["CostaBIM.OnteloDimPolicy"] ||
    extra["CostaBIM.OnteloCode"] ||
    extra["CostaBIM.MeasurementFamily"] === "ontelo";

  const familyProv = extra["CostaBIM.FamilyProvenance"];
  const wallProv = extra["CostaBIM.WallFaceProvenance"];
  const published =
    extra["CostaBIM.PublishedQuantity"] ??
    (typeof element?.quantity === "number" ? element.quantity : null);
  if (typeof published === "number" && published > 0 && !isOntelo) {
    const prov = typeof familyProv === "string" ? familyProv.trim() : "";
    if (!prov || prov === "none") warnings.add("published_without_provenance");
  }

  const bqLen = readBqLengthM(element);
  const teklaLen = readTeklaLengthM(extra);
  const consumesLength = provenanceConsumesLength(
    typeof familyProv === "string" ? familyProv : undefined,
    typeof wallProv === "string" ? wallProv : undefined
  );

  if (bqLen !== null && consumesLength) {
    if (teklaBqLengthMismatch(bqLen, teklaLen)) {
      warnings.add("tekla_bq_length_mismatch");
    }
    if (isProfileLengthSuspect(bqLen, teklaLen)) {
      warnings.add("profile_dim_in_length_slot");
    }
  }

  return Array.from(warnings).join("; ");
}

export function resolveAuditColumnValue(element: any, sourceKey: string): string | number | "" {
  if (sourceKey === "__computed__") {
    const w = computeQuantityWarnings(element);
    return w || "";
  }
  const extra = (element?.extraProperties ?? {}) as Record<string, unknown>;
  const v = extra[sourceKey];
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return String(v);
}

export type MeasurementAuditTrustSummary = {
  sampleSize: number;
  withQuantityWarnings: number;
  publishedWithoutProvenance: number;
  teklaBqLengthMismatch: number;
  profileLengthSuspect: number;
  bboxPoisonFlagged: number;
  dimSignalCount: number;
  note: string;
};

export function summarizeMeasurementAuditTrust(elements: any[]): MeasurementAuditTrustSummary {
  const n = elements.length;
  let withQuantityWarnings = 0;
  let publishedWithoutProvenance = 0;
  let teklaBqLengthMismatch = 0;
  let profileLengthSuspect = 0;
  let bboxPoisonFlagged = 0;
  let dimSignalCount = 0;

  for (const el of elements) {
    const extra = (el?.extraProperties ?? {}) as Record<string, unknown>;
    const warnings = computeQuantityWarnings(el);
    if (warnings) withQuantityWarnings++;
    if (warnings.includes("published_without_provenance")) publishedWithoutProvenance++;
    if (warnings.includes("tekla_bq_length_mismatch")) teklaBqLengthMismatch++;
    if (warnings.includes("profile_dim_in_length_slot")) profileLengthSuspect++;
    if (extra["CostaBIM.BBoxPoison"] === 1) bboxPoisonFlagged++;
    if (typeof extra["CostaBIM.QuantitySignal"] === "string" && extra["CostaBIM.QuantitySignal"]) {
      dimSignalCount++;
    }
  }

  const note =
    n === 0
      ? "No sample elements for audit trust summary."
      : withQuantityWarnings === 0
        ? "No audit warnings in sample; still verify Published against physical sense per family."
        : "Review rows with QuantityWarnings; PublishedBlocked rows are not certified for määrä.";

  return {
    sampleSize: n,
    withQuantityWarnings,
    publishedWithoutProvenance,
    teklaBqLengthMismatch,
    profileLengthSuspect,
    bboxPoisonFlagged,
    dimSignalCount,
    note,
  };
}

export function getBridgeAuditColumnHeaders(): string[] {
  if (!BRIDGE_MEASUREMENT_AUDIT_ENABLED) return [];
  return BRIDGE_AUDIT_COLUMN_DEFS.map((c) => c.header);
}

export function isBridgeAuditHeader(header: string): boolean {
  if (!BRIDGE_MEASUREMENT_AUDIT_ENABLED) return false;
  const n = header.trim().toLowerCase();
  return BRIDGE_AUDIT_COLUMN_DEFS.some((c) => c.header.toLowerCase() === n);
}

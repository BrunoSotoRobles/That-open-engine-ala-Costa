/**
 * Measurement reliability v1 — Block 1: backed publish or truly empty.
 * Flag: measurementFeatureFlags.COSTA_MEASUREMENT_RELIABILITY_V1
 */

import { COSTA_MEASUREMENT_RELIABILITY_V1 } from "./measurementFeatureFlags";
import type { QtyLike } from "./qtoPhysicalCoherence";
import { isQtoLengthPhysicallyCoherentFromQuantities } from "./qtoPhysicalCoherence";
import type { PublishedQuantityUnit } from "./publishedQuantity";
import { stampPublishedQuantity } from "./publishedQuantity";

export { COSTA_MEASUREMENT_RELIABILITY_V1 };

type QtyMap = {
  [key: string]: { value?: number; unit?: string } | undefined;
};

function readQty(bq: QtyMap | undefined, key: string): number | undefined {
  const v = bq?.[key]?.value;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nearlyEqual(a: number, b: number, relTol = 0.12): boolean {
  if (b === 0) return Math.abs(a) < 1e-9;
  return Math.abs(a - b) / Math.abs(b) <= relTol;
}

function readExtraNumber(extra: Record<string, unknown>, keyMatch: (lower: string) => boolean): number | null {
  for (const [key, raw] of Object.entries(extra)) {
    if (!keyMatch(key.toLowerCase())) continue;
    const v = parseFiniteNumber(raw);
    if (v !== null && v > 0) return v;
  }
  return null;
}

export function readTeklaLengthRawMm(extra: Record<string, unknown>): number | null {
  return readExtraNumber(extra, (k) => k.startsWith("tekla quantity.") && k.endsWith("length"));
}

/** Tekla Quantity.Length is mm when value >= 100; smaller values need bolt/context checks. */
function readTeklaLengthM(extra: Record<string, unknown>): number | null {
  const raw = readTeklaLengthRawMm(extra);
  if (raw === null) return null;
  if (raw >= 100) return raw / 1000;
  return raw;
}

function isCoherentStructuralTeklaLengthM(lengthM: number, teklaRawMm: number): boolean {
  if (teklaRawMm >= 100 && nearlyEqual(lengthM, teklaRawMm / 1000, 0.03)) return true;
  return false;
}

function readTeklaAreaM2(extra: Record<string, unknown>): number | null {
  return readExtraNumber(extra, (k) => {
    if (!k.startsWith("tekla quantity.")) return false;
    return (
      k.includes("net surface area") ||
      k.includes("gross footprint area") ||
      k.endsWith(".area") ||
      k.includes("area per")
    );
  });
}

function readRevitLengthM(extra: Record<string, unknown>): number | null {
  const v = readExtraNumber(
    extra,
    (k) => k.startsWith("dimensions.") && k.endsWith("length")
  );
  return v;
}

function readRevitAreaM2(extra: Record<string, unknown>): number | null {
  return readExtraNumber(extra, (k) => {
    if (!k.startsWith("dimensions.")) return false;
    return k.endsWith("area") || k.includes("surface");
  });
}

/** Tekla bolt signature: Length = Width = Height in mm (all equal, small). */
export function teklaBoltSignature(extra: Record<string, unknown>): boolean {
  const len = readTeklaLengthRawMm(extra);
  const wid = readExtraNumber(extra, (k) => k.startsWith("tekla quantity.") && k.endsWith("width"));
  const hei = readExtraNumber(extra, (k) => k.startsWith("tekla quantity.") && k.endsWith("height"));
  if (len === null || wid === null || hei === null) return false;
  if (len > 500 || wid > 500 || hei > 500) return false;
  return nearlyEqual(len, wid, 0.02) && nearlyEqual(len, hei, 0.02);
}

/**
 * BQ/Tekla both say e.g. 16 or 100 but Tekla raw is mm and published as metres.
 * Skips real spans where teklaRaw/1000 matches published (TUKIPUU 14432 mm → 14,432 m).
 */
export function isTeklaMmPublishedAsM(
  bqLength: number,
  publishedM: number,
  extra: Record<string, unknown>,
  bq?: QtyMap
): boolean {
  const raw = readTeklaLengthRawMm(extra);
  if (raw == null || raw <= 0) return false;

  if (
    isCoherentStructuralTeklaLengthM(publishedM, raw) ||
    (bqLength > 0 && isCoherentStructuralTeklaLengthM(bqLength, raw))
  ) {
    return false;
  }

  if (teklaBoltSignature(extra) && publishedM >= 10 && publishedM <= 300) {
    return true;
  }

  const matchesRaw =
    nearlyEqual(publishedM, raw, 0.03) || (bqLength > 0 && nearlyEqual(bqLength, raw, 0.03));
  if (!matchesRaw || raw < 10 || raw > 2000) return false;

  const weight = readExtraNumber(
    extra,
    (k) => k.startsWith("tekla quantity.") && k.endsWith("weight")
  );
  if (weight != null && weight < 5) return true;

  const volume =
    readQty(bq ?? {}, "NetVolume") ??
    readQty(bq ?? {}, "GrossVolume") ??
    readQty(bq ?? {}, "Volume");
  if (volume != null && volume < 0.01) return true;

  return raw <= 500;
}

/** Provenance strings that use BQ Length (or wall run derived from L/W). */
export function provenanceConsumesLength(
  familyProvenance?: string,
  wallFaceProvenance?: string
): boolean {
  const fp = String(familyProvenance ?? "").toLowerCase();
  const wp = String(wallFaceProvenance ?? "").toLowerCase();
  if (
    wp === "derived_run_x_height" ||
    wp === "derived_volume_thickness" ||
    wp === "derived_gross_volume_brick"
  ) {
    return true;
  }
  if (fp.endsWith(":length")) return true;
  if (fp.includes("beam:length") || fp.includes("member:length") || fp.includes("column:length")) {
    return true;
  }
  return false;
}

export function isProfileLengthSuspect(
  bqLength: number,
  teklaLengthM: number | null,
  publishedM: number = bqLength,
  extra?: Record<string, unknown>,
  quantities?: QtyLike
): boolean {
  if (quantities && isQtoLengthPhysicallyCoherentFromQuantities(quantities)) {
    return false;
  }

  const ex = extra ?? {};

  if (teklaBoltSignature(ex) && publishedM >= 10 && publishedM <= 300) {
    return true;
  }

  const teklaRaw = readTeklaLengthRawMm(ex);
  if (
    teklaRaw != null &&
    isTeklaMmPublishedAsM(bqLength, publishedM, ex)
  ) {
    return true;
  }

  if (teklaLengthM != null && teklaLengthM > 0.5 && nearlyEqual(teklaLengthM, publishedM, 0.12)) {
    return false;
  }

  const revitLen = readRevitLengthM(ex);
  if (revitLen != null && revitLen > 0.5 && nearlyEqual(revitLen, publishedM, 0.12)) {
    return false;
  }

  if (teklaLengthM != null && teklaLengthM > 0.5 && bqLength >= 0.02 && bqLength <= 0.25) {
    return teklaLengthM / bqLength >= 5;
  }

  if (bqLength >= 10 && bqLength <= 250) {
    if (teklaRaw != null && isCoherentStructuralTeklaLengthM(publishedM, teklaRaw)) return false;
    if (teklaLengthM != null && teklaLengthM > 1) return false;
    if (revitLen != null && revitLen > 1) return false;
    return true;
  }

  return false;
}

export function teklaBqLengthMismatch(bqLength: number, teklaLengthM: number | null): boolean {
  if (teklaLengthM == null || teklaLengthM <= 0 || bqLength <= 0) return false;
  const ratio = Math.max(bqLength, teklaLengthM) / Math.min(bqLength, teklaLengthM);
  if (ratio < 5) return false;
  const unitFactors = [25.4, 304.8, 1000];
  return !unitFactors.some(
    (f) => Math.abs(ratio - f) / f <= 0.03 || Math.abs(ratio - 1 / f) / (1 / f) <= 0.03
  );
}

/** Wall brick: run × height × thickness ≈ volume (SI). */
export function wallVolumeConsistencyOk(bq: QtyMap, run: number, height: number, thickness: number): boolean {
  const volume =
    readQty(bq, "NetVolume") ?? readQty(bq, "GrossVolume") ?? readQty(bq, "Volume");
  if (!volume || volume <= 0) return true;
  if (run <= 0 || height <= 0 || thickness <= 0) return false;
  return nearlyEqual(run * height * thickness, volume, 0.15);
}

/** Same recovery as wallFaceArea — shared for certification gate. */
export function resolveWallHorizontalsFromVolume(
  width: number | undefined,
  length: number | undefined,
  height: number | undefined,
  volume: number | undefined
): { run: number; thickness: number } {
  const horiz = [width, length].filter((d): d is number => typeof d === "number" && d > 0);
  if (!horiz.length) return { run: 0, thickness: 0 };

  let thickness = Math.min(...horiz);
  let run = Math.max(...horiz);

  if (!(volume && volume > 0 && height && height > 0)) {
    return { run, thickness };
  }

  if (nearlyEqual(run * height * thickness, volume, 0.12)) {
    return { run, thickness };
  }

  const thicknessCandidates = new Set<number>();
  for (const d of horiz) {
    thicknessCandidates.add(d);
    if (d >= 10) thicknessCandidates.add(d / 1000);
  }

  for (const t of thicknessCandidates) {
    if (t <= 0 || t > 2.5) continue;
    const impliedRun = volume / (height * t);
    if (impliedRun < 0.08 || impliedRun > 200) continue;
    if (!nearlyEqual(impliedRun * height * t, volume, 0.15)) continue;
    if (run / impliedRun > 1.5 || impliedRun / run > 1.5) {
      return { run: impliedRun, thickness: t };
    }
  }

  return { run, thickness };
}

export interface PublishCertContext {
  provenance?: string;
  wallFaceProvenance?: string;
  baseQuantities?: QtyMap;
  extraProperties?: Record<string, string | number>;
  ifcType?: string;
  publishedValue?: number;
  publishedUnit?: PublishedQuantityUnit;
}

function corroboratesPublishedValue(ctx: PublishCertContext): boolean {
  const value = ctx.publishedValue;
  if (value == null || !(value > 0)) return false;

  const extra = (ctx.extraProperties ?? {}) as Record<string, unknown>;
  const bq = ctx.baseQuantities ?? {};
  const unit = ctx.publishedUnit ?? "m2";

  const candidates: number[] = [];
  if (unit === "m2") {
    for (const key of ["NetSideArea", "NetArea", "GrossSideArea", "GrossArea", "Area"] as const) {
      const v = readQty(bq, key);
      if (v != null) candidates.push(v);
    }
    const teklaArea = readTeklaAreaM2(extra);
    if (teklaArea != null) candidates.push(teklaArea);
    const revitArea = readRevitAreaM2(extra);
    if (revitArea != null) candidates.push(revitArea);
  } else if (unit === "m") {
    const bqLen = readQty(bq, "Length") ?? 0;
    if (isTeklaMmPublishedAsM(bqLen, value, extra, bq)) {
      return false;
    }
    if (bqLen > 0) candidates.push(bqLen);
    const teklaLen = readTeklaLengthM(extra);
    if (teklaLen != null) candidates.push(teklaLen);
    const revitLen = readRevitLengthM(extra);
    if (revitLen != null) candidates.push(revitLen);
  }

  return candidates.some((c) => nearlyEqual(c, value, 0.12));
}

function isWallFacePublish(wallProv: string): boolean {
  return (
    wallProv.startsWith("ifc:") ||
    wallProv === "derived_run_x_height" ||
    wallProv === "derived_gross_volume_brick" ||
    wallProv === "derived_volume_thickness"
  );
}

export function applyPublishBlock(
  extra: Record<string, string | number>,
  reason: string
): void {
  extra["CostaBIM.PublishedBlocked"] = 1;
  extra["CostaBIM.PublishedBlockReason"] = reason;
  delete extra["CostaBIM.PublishedQuantity"];
  delete extra["CostaBIM.PublishedUnit"];
  extra["CostaBIM.ContributeToMaara"] = 0;
}

export function evaluatePublishBlock(ctx: PublishCertContext): string | null {
  if (!COSTA_MEASUREMENT_RELIABILITY_V1) return null;

  const prov = String(ctx.provenance ?? "").trim();
  const wallProv = String(ctx.wallFaceProvenance ?? "").trim();
  const extra = (ctx.extraProperties ?? {}) as Record<string, unknown>;
  const publishedM = ctx.publishedValue ?? 0;

  if (extra["CostaBIM.OnteloDimPolicy"] || extra["CostaBIM.OnteloCode"]) {
    return null;
  }
  if (prov === "ontelo:delegated" || extra["CostaBIM.MeasurementFamily"] === "ontelo") {
    return null;
  }

  if ((prov === "none" || prov === "") && corroboratesPublishedValue(ctx)) {
    return null;
  }

  if (prov === "none" || prov === "") {
    return "provenance_none";
  }

  const bq = ctx.baseQuantities ?? {};
  const bqLen = readQty(bq, "Length");
  const teklaLen = readTeklaLengthM(extra);

  if (isWallFacePublish(wallProv)) {
    if (wallProv === "derived_run_x_height" || wallProv === "derived_volume_thickness") {
      const w = readQty(bq, "Width");
      const l = readQty(bq, "Length");
      const h = readQty(bq, "Height");
      const volume =
        readQty(bq, "NetVolume") ?? readQty(bq, "GrossVolume") ?? readQty(bq, "Volume");
      if (volume && volume > 0 && h) {
        const { run, thickness } = resolveWallHorizontalsFromVolume(w, l, h, volume);
        if (run <= 0 || thickness <= 0 || !wallVolumeConsistencyOk(bq, run, h, thickness)) {
          return "wall_volume_inconsistent";
        }
      }
    }
    return null;
  }

  if (ctx.publishedUnit === "m" && publishedM > 0) {
    const lenForMm = bqLen ?? publishedM;
    if (isTeklaMmPublishedAsM(lenForMm, publishedM, extra, bq)) {
      return "profile_dim_in_length_slot";
    }
  }

  const consumesLength = provenanceConsumesLength(prov, wallProv);
  if (consumesLength && bqLen != null && ctx.publishedUnit === "m") {
    if (isProfileLengthSuspect(bqLen, teklaLen, publishedM, extra)) {
      return "profile_dim_in_length_slot";
    }
    if (teklaLen != null && teklaBqLengthMismatch(bqLen, teklaLen)) {
      return "tekla_bq_length_mismatch";
    }
  }

  return null;
}

export function maybeStampPublishedQuantity(
  extra: Record<string, string | number>,
  value: number,
  unit: PublishedQuantityUnit,
  ctx: PublishCertContext = {}
): boolean {
  if (!(value > 0) || !Number.isFinite(value)) return false;

  const blockReason = evaluatePublishBlock({
    ...ctx,
    publishedValue: value,
    publishedUnit: unit,
    extraProperties: extra,
  });
  if (blockReason) {
    applyPublishBlock(extra, blockReason);
    return false;
  }

  delete extra["CostaBIM.PublishedBlocked"];
  delete extra["CostaBIM.PublishedBlockReason"];
  if (extra["CostaBIM.ContributeToMaara"] === 0 && !extra["CostaBIM.LayerRole"]) {
    delete extra["CostaBIM.ContributeToMaara"];
  }
  stampPublishedQuantity(extra, value, unit);
  return true;
}

/**
 * Publish path used by measurement policies. When reliability flag is OFF (default),
 * behaves like stampPublishedQuantity. When ON, runs plausibility gate first.
 */
export function publishPrimaryQuantity(
  extra: Record<string, string | number>,
  value: number,
  unit: PublishedQuantityUnit,
  ctx: PublishCertContext = {}
): boolean {
  if (COSTA_MEASUREMENT_RELIABILITY_V1) {
    return maybeStampPublishedQuantity(extra, value, unit, ctx);
  }
  if (!(value > 0) || !Number.isFinite(value)) return false;
  stampPublishedQuantity(extra, value, unit);
  return true;
}

function inferPublishedUnitFromElement(
  extra: Record<string, string | number>,
  ifcType?: string
): PublishedQuantityUnit {
  const stamped = String(extra["CostaBIM.PublishedUnit"] ?? extra["CostaBIM.FamilyPrimaryUnit"] ?? "")
    .trim()
    .toLowerCase();
  if (stamped === "m" || stamped === "m2" || stamped === "m3" || stamped === "kpl") {
    return stamped;
  }
  const fam = String(extra["CostaBIM.MeasurementFamily"] ?? "");
  if (fam === "beam" || fam === "column" || fam === "member") return "m";
  if (fam === "foundation") return "m3";
  if (fam === "opening") return "m2";
  const t = String(ifcType ?? "").toUpperCase();
  if (t.includes("BEAM") || t.includes("COLUMN") || t.includes("MEMBER")) return "m";
  if (t.includes("FOOTING") || t.includes("PILE")) return "m3";
  return "m2";
}

function resolveGateProvenance(extra: Record<string, string | number>): string | undefined {
  const fp = String(extra["CostaBIM.FamilyProvenance"] ?? "").trim();
  if (fp) return fp;
  const wp = String(extra["CostaBIM.WallFaceProvenance"] ?? "").trim();
  if (wp) return `wall:${wp}`;
  return undefined;
}

/** Final pass after layer assembly — always runs reliability gate when flag ON. */
export function applyMeasurementReliabilityFinalPass<
  T extends {
    name?: string;
    type?: string;
    quantity?: number;
    baseQuantities?: QtyMap;
    extraProperties?: Record<string, string | number>;
  },
>(element: T): T {
  if (!COSTA_MEASUREMENT_RELIABILITY_V1) return element;

  const extra = { ...(element.extraProperties ?? {}) };
  if (extra["CostaBIM.OnteloDimPolicy"] || extra["CostaBIM.OnteloCode"]) {
    return { ...element, extraProperties: extra };
  }

  const stamped =
    typeof extra["CostaBIM.PublishedQuantity"] === "number" &&
    Number.isFinite(extra["CostaBIM.PublishedQuantity"]) &&
    extra["CostaBIM.PublishedQuantity"] > 0
      ? extra["CostaBIM.PublishedQuantity"]
      : null;
  const rawQty =
    typeof element.quantity === "number" && element.quantity > 0 ? element.quantity : null;
  const gateValue = stamped ?? rawQty;
  if (gateValue == null) return { ...element, extraProperties: extra };

  const unit = inferPublishedUnitFromElement(extra, element.type);
  publishPrimaryQuantity(extra, gateValue, unit, {
    provenance: resolveGateProvenance(extra),
    wallFaceProvenance: String(extra["CostaBIM.WallFaceProvenance"] ?? "") || undefined,
    baseQuantities: element.baseQuantities,
    extraProperties: extra,
    ifcType: element.type,
  });

  const blocked = extra["CostaBIM.PublishedBlocked"] === 1;
  const published =
    !blocked && typeof extra["CostaBIM.PublishedQuantity"] === "number"
      ? extra["CostaBIM.PublishedQuantity"]
      : undefined;

  return {
    ...element,
    quantity: blocked ? undefined : published ?? element.quantity,
    extraProperties: extra,
  };
}

export function isPublishedBlocked(
  extra: Record<string, string | number> | undefined | null
): boolean {
  return extra?.["CostaBIM.PublishedBlocked"] === 1;
}

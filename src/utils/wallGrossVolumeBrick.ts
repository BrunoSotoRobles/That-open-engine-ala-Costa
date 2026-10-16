/**
 * Wall face from gross brick: run × height × thickness ≈ GrossVolume.
 * Works without Tekla (Revit/Archicad/geometric exports); Tekla Width refines thickness when present.
 */

import {
  COSTA_WALL_GROSS_VOLUME_BRICK_V1,
  getMeasurementFeatureFlagsSnapshot,
} from "./measurementFeatureFlags";
import { readDimensionsMetres, readTeklaQuantityMetres } from "./ifcExtraQuantityReaders";

function isWallIfcType(ifcType: string | undefined | null): boolean {
  return String(ifcType ?? "").toUpperCase().includes("WALL");
}

export type WallBrickResult = {
  run: number;
  thickness: number;
  face: number;
  reason: "duplicate_horizontal" | "horizontal_poison";
};

function nearlyEqual(a: number, b: number, relTol = 0.12): boolean {
  if (b === 0) return Math.abs(a) < 1e-9;
  return Math.abs(a - b) / Math.abs(b) <= relTol;
}

/**
 * IFC slot carrying profile thickness in mm (Tekla: 48–100 stored as metres).
 * Guard: do not treat a 10–250 value as mm when GrossArea/H ≈ that value as run (VÄLISEINÄ L≈14 m).
 */
function pickMmThicknessSlot(
  width: number,
  length: number,
  height?: number,
  grossArea?: number,
  grossVolume?: number
): number | null {
  const inMmSlot = (d: number) => d >= 10 && d <= 250;

  const slotLooksLikeThicknessMm = (slot: number, partner: number): boolean => {
    const t = slot / 1000;
    if (height != null && height > 0 && grossArea != null && grossArea > 0) {
      const impliedT = grossArea / height;
      if (nearlyEqual(impliedT, t, 0.18)) return true;
    }
    if (
      height != null &&
      height > 0 &&
      grossVolume != null &&
      grossVolume > 0 &&
      partner > 0 &&
      partner < slot / 5
    ) {
      const run = grossVolume / (height * t);
      if (nearlyEqual(run, partner, 0.15)) return true;
    }
    if (partner > 0 && partner < 3 && slot / partner > 5) return true;
    return false;
  };

  const wMm = inMmSlot(width);
  const lMm = inMmSlot(length);
  if (wMm && !lMm && slotLooksLikeThicknessMm(width, length)) return width;
  if (lMm && !wMm && slotLooksLikeThicknessMm(length, width)) return length;
  if (wMm && lMm) {
    const larger = Math.max(width, length);
    const smaller = Math.min(width, length);
    if (slotLooksLikeThicknessMm(larger, smaller)) return larger;
  }
  return null;
}

function thicknessCandidates(
  width: number,
  length: number,
  extra?: Record<string, string | number>,
  height?: number,
  grossArea?: number,
  grossVolume?: number
): number[] {
  const out = new Set<number>();
  const teklaW = readTeklaQuantityMetres(extra, "width");
  const dimW = readDimensionsMetres(extra, "width");
  if (teklaW != null && teklaW > 0 && teklaW <= 2.5) out.add(teklaW);
  if (dimW != null && dimW > 0 && dimW <= 2.5) out.add(dimW);

  const mmSlot = pickMmThicknessSlot(width, length, height, grossArea, grossVolume);
  if (mmSlot != null) out.add(mmSlot / 1000);

  const minH = Math.min(width, length);
  if (minH > 0 && minH <= 2.5) out.add(minH);

  return Array.from(out).filter((t) => t > 0.01 && t <= 2.5);
}

function impliedThicknessFromRun(
  run: number,
  height: number,
  grossVolume: number
): number | null {
  if (run <= 0 || height <= 0 || grossVolume <= 0) return null;
  const t = grossVolume / (run * height);
  if (t > 0.01 && t <= 2.5) return t;
  return null;
}

export function wallHorizontalsNeedBrickRecovery(
  width: number | undefined,
  length: number | undefined,
  height: number | undefined,
  grossVolume: number | undefined,
  grossArea?: number
): boolean {
  if (!COSTA_WALL_GROSS_VOLUME_BRICK_V1) return false;
  if (!width || !length || !height || !grossVolume || grossVolume <= 0) return false;

  const rel = Math.abs(width - length) / Math.max(width, length);
  if (rel <= 0.03) return true;

  const maxH = Math.max(width, length);
  const minH = Math.min(width, length);
  const naiveBrick = maxH * minH * height;
  if (maxH > 15 && !nearlyEqual(naiveBrick, grossVolume, 0.35)) return true;
  if (minH >= 10 && maxH > minH * 3 && !nearlyEqual(naiveBrick, grossVolume, 0.35)) return true;
  const mmProbe = pickMmThicknessSlot(width, length, height, grossArea, grossVolume);
  if (mmProbe != null) {
    const mm = mmProbe;
    const t = mm / 1000;
    const run = grossVolume / (height * t);
    const face = run * height;
    const naiveFace = maxH * height;
    if (run >= 0.05 && run <= 200 && !nearlyEqual(face, naiveFace, 0.12)) return true;
  }

  return false;
}

export function recoverWallBrickFromGrossVolume(
  width: number,
  length: number,
  height: number,
  grossVolume: number,
  extra?: Record<string, string | number>,
  grossArea?: number
): WallBrickResult | null {
  if (!COSTA_WALL_GROSS_VOLUME_BRICK_V1) return null;

  const reason: WallBrickResult["reason"] =
    Math.abs(width - length) / Math.max(width, length) <= 0.03
      ? "duplicate_horizontal"
      : "horizontal_poison";

  const mmSlot = pickMmThicknessSlot(width, length, height, grossArea, grossVolume);
  if (mmSlot != null) {
    const t = mmSlot / 1000;
    const partner = mmSlot === width ? length : width;
    const run = grossVolume / (height * t);
    const runMatchesPartner =
      partner > 0 && partner < 15 && nearlyEqual(run, partner, 0.15);
    const runPlausible = run >= 0.05 && run <= 200 && (run <= 15 || runMatchesPartner);
    if (runPlausible && nearlyEqual(run * height * t, grossVolume, 0.02)) {
      const face = run * height;
      if (face > 0) return { run, thickness: t, face, reason: "horizontal_poison" };
    }
  }

  const thicknesses = thicknessCandidates(width, length, extra, height, grossArea, grossVolume);
  if (reason === "duplicate_horizontal") {
    const runHint = (width + length) / 2;
    const implied = impliedThicknessFromRun(runHint, height, grossVolume);
    if (implied != null) thicknesses.unshift(implied);
  }

  for (const t of thicknesses) {
    const run = grossVolume / (height * t);
    if (run < 0.05 || run > 200) continue;
    if (!nearlyEqual(run * height * t, grossVolume, 0.15)) continue;
    const face = run * height;
    if (face <= 0) continue;
    return { run, thickness: t, face, reason };
  }

  return null;
}

function readBqValue(bq: unknown, key: string): number | undefined {
  const row = (bq as Record<string, { value?: number } | undefined>)?.[key];
  const v = typeof row === "number" ? row : row?.value;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

export type WallQuantityRecoverySummary = {
  sampleSize: number;
  wallCount: number;
  brickEligible: number;
  brickRecovered: number;
  duplicateHorizontal: number;
  horizontalPoison: number;
  featureFlags: ReturnType<typeof getMeasurementFeatureFlagsSnapshot>;
  note: string;
};

/** Preflight counters for MCP / Claude contrast — does not change quantities. */
export function summarizeWallQuantityRecovery(
  elements: unknown[],
  featureFlags?: ReturnType<typeof getMeasurementFeatureFlagsSnapshot>
): WallQuantityRecoverySummary {
  let wallCount = 0;
  let brickEligible = 0;
  let brickRecovered = 0;
  let duplicateHorizontal = 0;
  let horizontalPoison = 0;

  for (const raw of elements) {
    const el = raw as {
      type?: string;
      baseQuantities?: Record<string, { value?: number }>;
      extraProperties?: Record<string, unknown>;
    };
    if (!isWallIfcType(el.type)) continue;
    wallCount++;

    const bq = el.baseQuantities ?? {};
    const w = readBqValue(bq, "Width");
    const l = readBqValue(bq, "Length");
    const h = readBqValue(bq, "Height");
    const gross = readBqValue(bq, "GrossVolume") ?? readBqValue(bq, "Volume");
    if (wallHorizontalsNeedBrickRecovery(w, l, h, gross)) brickEligible++;

    const extra = el.extraProperties ?? {};
    if (extra["CostaBIM.WallBrickRecovery"] === 1) {
      brickRecovered++;
      const reason = extra["CostaBIM.WallBrickReason"];
      if (reason === "duplicate_horizontal") duplicateHorizontal++;
      if (reason === "horizontal_poison") horizontalPoison++;
    }
  }

  const note =
    wallCount === 0
      ? "No walls in preflight sample."
      : brickRecovered > 0
        ? `${brickRecovered}/${wallCount} walls used GrossVolume brick recovery (W≈L or poisoned horizontals). Re-Send after flag changes.`
        : brickEligible > 0
          ? `${brickEligible} walls eligible for brick recovery but none stamped yet — run Send to CostStore.`
          : "No wall horizontal recovery triggered in sample.";

  return {
    sampleSize: elements.length,
    wallCount,
    brickEligible,
    brickRecovered,
    duplicateHorizontal,
    horizontalPoison,
    featureFlags: featureFlags ?? getMeasurementFeatureFlagsSnapshot(),
    note,
  };
}

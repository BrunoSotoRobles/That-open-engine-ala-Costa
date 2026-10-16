/**
 * Paso 2 — wall face area for M2 (määräluettelo).
 * Do not publish bbox cross-section (thickness × height) as wall side area.
 * Prefer typed side area only when it looks like the face; else max(W,L) × H.
 * Axis-agnostic: thickness ≈ min(Width,Length), run ≈ max(Width,Length).
 * Applies to IfcWall and IfcWallStandardCase (same function — subtype must not diverge).
 */

import { COSTA_WALL_NET_SIDE_AREA_V1 } from "./measurementFeatureFlags";
import { publishPrimaryQuantity } from "./measurementReliability";
import { applyPublishedUnitPolicy } from "./publishedUnitPolicy";
import {
  recoverWallBrickFromGrossVolume,
  wallHorizontalsNeedBrickRecovery,
} from "./wallGrossVolumeBrick";

export type WallFaceProvenance =
  | "ifc:NetSideArea"
  | "ifc:GrossSideArea"
  | "ifc:NetArea"
  | "ifc:GrossArea"
  | "derived_run_x_height"
  | "derived_gross_volume_brick"
  | "derived_volume_thickness"
  | "none";

export interface WallFaceAreaResult {
  value: number;
  provenance: WallFaceProvenance;
  brickReason?: "duplicate_horizontal" | "horizontal_poison";
}

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

export function isWallIfcType(ifcType: string | undefined | null): boolean {
  return String(ifcType ?? "").toUpperCase().includes("WALL");
}

/** True if `area` matches thickness × height (cross-section / canto). */
export function isWallCrossSectionArea(
  area: number,
  width?: number,
  length?: number,
  height?: number
): boolean {
  if (!height || height <= 0) return false;
  const dims = [width, length].filter((d): d is number => typeof d === "number" && d > 0);
  if (dims.length === 0) return false;
  const thickness = Math.min(...dims);
  const cross = thickness * height;
  return nearlyEqual(area, cross, 0.08);
}

export function resolveWallFaceArea(
  baseQuantities: QtyMap,
  prefer: "net" | "gross" | "any" = "any",
  extraProperties?: Record<string, string | number>
): WallFaceAreaResult {
  const width = readQty(baseQuantities, "Width");
  const length = readQty(baseQuantities, "Length");
  const height = readQty(baseQuantities, "Height");
  const grossVolume =
    readQty(baseQuantities, "GrossVolume") ?? readQty(baseQuantities, "Volume");
  const grossArea =
    readQty(baseQuantities, "GrossArea") ?? readQty(baseQuantities, "GrossSideArea");

  let brickRecovery: ReturnType<typeof recoverWallBrickFromGrossVolume> = null;
  if (
    width &&
    length &&
    height &&
    grossVolume &&
    wallHorizontalsNeedBrickRecovery(width, length, height, grossVolume, grossArea)
  ) {
    brickRecovery = recoverWallBrickFromGrossVolume(
      width,
      length,
      height,
      grossVolume,
      extraProperties,
      grossArea
    );
  }

  const horiz = [width, length].filter((d): d is number => typeof d === "number" && d > 0);
  const thickness =
    brickRecovery?.thickness ?? (horiz.length ? Math.min(...horiz) : undefined);
  const run =
    brickRecovery?.run ?? (horiz.length ? Math.max(...horiz) : undefined);
  const derivedFace =
    brickRecovery?.face ??
    (run && height && run > 0 && height > 0 ? run * height : undefined);

  type Cand = { value: number; provenance: WallFaceProvenance };
  const netFirst: Cand[] = [
    { value: readQty(baseQuantities, "NetSideArea")!, provenance: "ifc:NetSideArea" },
    { value: readQty(baseQuantities, "NetArea")!, provenance: "ifc:NetArea" },
  ].filter((c) => c.value != null && c.value > 0) as Cand[];

  const grossFirst: Cand[] = [
    { value: readQty(baseQuantities, "GrossSideArea")!, provenance: "ifc:GrossSideArea" },
    { value: readQty(baseQuantities, "GrossArea")!, provenance: "ifc:GrossArea" },
  ].filter((c) => c.value != null && c.value > 0) as Cand[];

  const areaOnly: Cand[] = [
    { value: readQty(baseQuantities, "Area")!, provenance: "ifc:GrossArea" },
  ].filter((c) => c.value != null && c.value > 0) as Cand[];

  const ordered: Cand[] =
    prefer === "net"
      ? [...netFirst, ...grossFirst, ...areaOnly]
      : prefer === "gross"
        ? [...grossFirst, ...netFirst, ...areaOnly]
        : [...netFirst, ...grossFirst, ...areaOnly];

  for (const c of ordered) {
    if (isWallCrossSectionArea(c.value, width, length, height)) {
      continue;
    }
    if (brickRecovery && !nearlyEqual(c.value, brickRecovery.face, 0.08)) {
      continue;
    }
    // Reject candidates much smaller than derived face (IfcWall vs StandardCase divergence)
    if (derivedFace && c.value * 3 < derivedFace && !nearlyEqual(c.value, derivedFace, 0.25)) {
      continue;
    }
    return c;
  }

  if (brickRecovery && brickRecovery.face > 0) {
    return {
      value: brickRecovery.face,
      provenance: "derived_gross_volume_brick",
      brickReason: brickRecovery.reason,
    };
  }

  if (COSTA_WALL_NET_SIDE_AREA_V1) {
    const netSide = readQty(baseQuantities, "NetSideArea");
    if (
      netSide != null &&
      netSide > 0 &&
      !brickRecovery &&
      !isWallCrossSectionArea(netSide, width, length, height)
    ) {
      const t = thickness ?? (horiz.length ? Math.min(...horiz) : undefined);
      const volume =
        readQty(baseQuantities, "NetVolume") ??
        readQty(baseQuantities, "GrossVolume") ??
        readQty(baseQuantities, "Volume");
      // NetSideArea × thickness ≈ volume — not run×H×t (run×H may be placement bbox).
      const netSideCloses =
        t != null &&
        t > 0 &&
        volume != null &&
        volume > 0 &&
        nearlyEqual(netSide * t, volume, 0.12);
      if (netSideCloses && derivedFace != null && derivedFace > netSide * 1.12) {
        return { value: netSide, provenance: "ifc:NetSideArea" };
      }
    }
  }

  if (derivedFace && derivedFace > 0) {
    return { value: derivedFace, provenance: "derived_run_x_height" };
  }

  const volume =
    readQty(baseQuantities, "NetVolume") ||
    readQty(baseQuantities, "GrossVolume") ||
    readQty(baseQuantities, "Volume");
  if (volume && thickness && thickness > 0) {
    return { value: volume / thickness, provenance: "derived_volume_thickness" };
  }

  return { value: 0, provenance: "none" };
}

export type WallVolumeProvenance =
  | "ifc:NetVolume"
  | "ifc:GrossVolume"
  | "ifc:Volume"
  | "derived_face_x_thickness"
  | "none";

export interface WallVolumeResult {
  value: number;
  provenance: WallVolumeProvenance;
}

/**
 * Reliable wall volume: if GrossVolume disagrees with face×thickness, prefer derived
 * (or NetVolume when closer). Same policy for IfcWall and IfcWallStandardCase.
 */
export function resolveWallReliableVolume(
  baseQuantities: QtyMap,
  extraProperties?: Record<string, string | number>
): WallVolumeResult {
  const face = resolveWallFaceArea(baseQuantities, "any", extraProperties);
  const width = readQty(baseQuantities, "Width");
  const length = readQty(baseQuantities, "Length");
  const height = readQty(baseQuantities, "Height");
  const grossVolume =
    readQty(baseQuantities, "GrossVolume") ?? readQty(baseQuantities, "Volume");
  const grossArea =
    readQty(baseQuantities, "GrossArea") ?? readQty(baseQuantities, "GrossSideArea");
  let thickness: number | undefined;
  if (
    width &&
    length &&
    height &&
    grossVolume &&
    wallHorizontalsNeedBrickRecovery(width, length, height, grossVolume, grossArea)
  ) {
    const brick = recoverWallBrickFromGrossVolume(
      width,
      length,
      height,
      grossVolume,
      extraProperties,
      grossArea
    );
    if (brick) thickness = brick.thickness;
  }
  if (thickness == null) {
    const horiz = [width, length].filter((d): d is number => typeof d === "number" && d > 0);
    thickness = horiz.length ? Math.min(...horiz) : undefined;
  }

  const net = readQty(baseQuantities, "NetVolume");
  const gross = readQty(baseQuantities, "GrossVolume");
  const vol = readQty(baseQuantities, "Volume");

  const derived =
    face.value > 0 && thickness && thickness > 0 ? face.value * thickness : undefined;

  if (derived != null && derived > 0) {
    const grossBad =
      gross != null && gross > 0 && !nearlyEqual(gross, derived, 0.25) && gross > derived * 1.5;
    const volBad =
      vol != null && vol > 0 && !nearlyEqual(vol, derived, 0.25) && vol > derived * 1.5;

    if (grossBad || volBad) {
      if (net != null && net > 0 && nearlyEqual(net, derived, 0.25)) {
        return { value: net, provenance: "ifc:NetVolume" };
      }
      return { value: derived, provenance: "derived_face_x_thickness" };
    }
  }

  if (gross != null && gross > 0) return { value: gross, provenance: "ifc:GrossVolume" };
  if (net != null && net > 0) return { value: net, provenance: "ifc:NetVolume" };
  if (vol != null && vol > 0) return { value: vol, provenance: "ifc:Volume" };
  if (derived != null && derived > 0) {
    return { value: derived, provenance: "derived_face_x_thickness" };
  }
  return { value: 0, provenance: "none" };
}

/** Publish face as element.quantity for walls; flag provenance (idempotent). */
export function applyWallFacePolicyToElement<
  T extends {
    type?: string;
    quantity?: number;
    baseQuantities?: QtyMap;
    extraProperties?: Record<string, string | number>;
  },
>(element: T): T {
  if (!isWallIfcType(element.type)) return element;

  const face = resolveWallFaceArea(
    element.baseQuantities ?? {},
    "any",
    element.extraProperties
  );
  if (face.value <= 0 || face.provenance === "none") return element;

  const vol = resolveWallReliableVolume(element.baseQuantities ?? {}, element.extraProperties);
  const extra = { ...(element.extraProperties ?? {}) };
  extra["CostaBIM.WallFaceProvenance"] = face.provenance;
  if (face.provenance === "derived_gross_volume_brick") {
    extra["CostaBIM.WallBrickRecovery"] = 1;
    if (face.brickReason) extra["CostaBIM.WallBrickReason"] = face.brickReason;
  }
  const published = publishPrimaryQuantity(extra, face.value, "m2", {
    wallFaceProvenance: face.provenance,
    baseQuantities: element.baseQuantities,
    extraProperties: extra,
    ifcType: element.type,
    provenance: `wall:${face.provenance}`,
  });
  if (published) {
    applyPublishedUnitPolicy(extra, "wall", face.provenance);
  }

  const gross = readQty(element.baseQuantities ?? {}, "GrossVolume");
  if (
    gross != null &&
    vol.value > 0 &&
    (vol.provenance === "derived_face_x_thickness" || vol.provenance === "ifc:NetVolume") &&
    Math.abs(gross - vol.value) / Math.max(vol.value, 1e-9) > 0.25
  ) {
    extra["CostaBIM.WallVolumeCorrected"] = 1;
    extra["CostaBIM.WallVolumeProvenance"] = vol.provenance;
  }

  const patchedQuantities = { ...(element.baseQuantities ?? {}) };
  if (
    face.provenance === "derived_gross_volume_brick" &&
    face.brickReason === "horizontal_poison"
  ) {
    const brick = recoverWallBrickFromGrossVolume(
      readQty(patchedQuantities, "Width") ?? 0,
      readQty(patchedQuantities, "Length") ?? 0,
      readQty(patchedQuantities, "Height") ?? 0,
      readQty(patchedQuantities, "GrossVolume") ?? readQty(patchedQuantities, "Volume") ?? 0,
      element.extraProperties,
      readQty(patchedQuantities, "GrossArea") ?? readQty(patchedQuantities, "GrossSideArea")
    );
    if (brick && brick.run > 0 && brick.run <= 200) {
      const prev = patchedQuantities["Length"];
      patchedQuantities["Length"] = {
        value: brick.run,
        unit: prev?.unit ?? "m",
      };
      extra["CostaBIM.WallRunM"] = brick.run;
    }
  }

  return {
    ...element,
    quantity: extra["CostaBIM.PublishedBlocked"] === 1 ? undefined : face.value,
    baseQuantities: patchedQuantities,
    extraProperties: extra,
  };
}

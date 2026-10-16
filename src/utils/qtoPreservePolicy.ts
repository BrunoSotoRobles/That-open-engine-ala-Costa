/**
 * Preserve coherent IFC Qto before bbox/heuristics mutate store quantities.
 * Covers all families CostaBIM publishes — not only linears.
 */

import { COSTA_PRESERVE_COHERENT_QTO_V1 } from "./measurementFeatureFlags";
import type { QtyLike } from "./qtoPhysicalCoherence";
import {
  isQtoLengthPhysicallyCoherentFromQuantities,
  QTO_PHYSICAL_COHERENCE_EPS,
} from "./qtoPhysicalCoherence";

export {
  isQtoLengthPhysicallyCoherentFromQuantities,
  QTO_PHYSICAL_COHERENCE_EPS,
} from "./qtoPhysicalCoherence";
export type { QtyLike };

const EPS = QTO_PHYSICAL_COHERENCE_EPS;
const OPENING_REL_MIN = 0.02;

function typeUpper(ifcType: string): string {
  return ifcType.toUpperCase();
}

export function isOpeningIfcType(ifcType: string): boolean {
  const t = typeUpper(ifcType);
  return t.includes("DOOR") || t.includes("WINDOW");
}

export function isWallIfcType(ifcType: string): boolean {
  return typeUpper(ifcType).includes("WALL");
}

export function isLinearIfcType(ifcType: string): boolean {
  const t = typeUpper(ifcType);
  return (
    t.includes("BEAM") ||
    t.includes("COLUMN") ||
    t.includes("MEMBER") ||
    t.includes("PILE") ||
    t.includes("RAILING") ||
    t.includes("PIPE") ||
    t.includes("DUCT") ||
    t.includes("CABLE") ||
    t.includes("STAIRFLIGHT")
  );
}

export function isHorizontalAreaIfcType(ifcType: string): boolean {
  const t = typeUpper(ifcType);
  return (
    t.includes("SLAB") ||
    t.includes("ROOF") ||
    t.includes("PLATE") ||
    t.includes("COVERING") ||
    t.includes("FOOTING") ||
    t.includes("FOUNDATION")
  );
}

/** Single entry — all preserve rules for this element. */
export function applyQtoPreservePolicies(
  quantities: QtyLike,
  ifcType: string
): void {
  if (!COSTA_PRESERVE_COHERENT_QTO_V1) return;

  applyOpeningDimensionsPolicy(quantities, ifcType);
  applyWallAreaPolicy(quantities, ifcType);
  applyHorizontalAreaVolumePolicy(quantities, ifcType);
}

export function applyOpeningDimensionsPolicy(
  quantities: QtyLike,
  ifcType: string
): void {
  if (!COSTA_PRESERVE_COHERENT_QTO_V1 || !isOpeningIfcType(ifcType)) return;

  const ow = readQty(quantities, "OverallWidth");
  const oh = readQty(quantities, "OverallHeight");
  if (ow == null || oh == null || ow <= 0 || oh <= 0) return;

  setQty(quantities, "Width", ow, "m");
  setQty(quantities, "Height", oh, "m");

  const area = ow * oh;
  if (!readQty(quantities, "NetArea")) setQty(quantities, "NetArea", area, "m²");
  if (!readQty(quantities, "GrossArea")) setQty(quantities, "GrossArea", area, "m²");
  if (!readQty(quantities, "Area")) setQty(quantities, "Area", area, "m²");
}

export function applyWallAreaPolicy(
  quantities: QtyLike,
  ifcType: string
): void {
  if (!COSTA_PRESERVE_COHERENT_QTO_V1 || !isWallIfcType(ifcType)) return;

  copyAuthoritativeArea(quantities, "NetSideArea", ["NetArea", "Area"]);
  copyAuthoritativeArea(quantities, "GrossSideArea", ["GrossArea"]);
}

/** Slabs, roofs, plates, coverings — preserve NetArea/GrossArea and volume from IFC Qto. */
export function applyHorizontalAreaVolumePolicy(
  quantities: QtyLike,
  ifcType: string
): void {
  if (!COSTA_PRESERVE_COHERENT_QTO_V1 || !isHorizontalAreaIfcType(ifcType)) return;

  copyAuthoritativeArea(quantities, "NetArea", ["Area"]);
  copyAuthoritativeArea(quantities, "GrossArea", []);

  const netArea = readQty(quantities, "NetArea");
  const netVol = readQty(quantities, "NetVolume");
  const grossVol = readQty(quantities, "GrossVolume");

  if (netArea && netVol && netArea > 0) {
    reassertQty(quantities, "NetVolume", netVol, "m³");
    reassertQty(quantities, "NetArea", netArea, "m²");
  }
  if (grossVol && readQty(quantities, "GrossArea")) {
    reassertQty(quantities, "GrossVolume", grossVol, "m³");
  }
}

export function shouldSkipStructuralLengthMutation(
  quantities: QtyLike,
  _ifcType: string
): boolean {
  if (!COSTA_PRESERVE_COHERENT_QTO_V1) return false;
  return isQtoLengthPhysicallyCoherentFromQuantities(quantities);
}

export function openingDimensionsCoherent(quantities: QtyLike): boolean {
  const ow = readQty(quantities, "OverallWidth");
  const oh = readQty(quantities, "OverallHeight");
  if (ow == null || oh == null) return false;
  return Math.abs(ow - oh) / Math.max(ow, oh) > OPENING_REL_MIN;
}

function copyAuthoritativeArea(
  quantities: QtyLike,
  sourceKey: string,
  mirrorKeys: string[]
): void {
  const source = readQty(quantities, sourceKey);
  if (source == null || source <= 0) return;

  for (const key of mirrorKeys) {
    const cur = readQty(quantities, key);
    if (cur == null || relativeDelta(cur, source) > EPS) {
      setQty(quantities, key, source, "m²");
    }
  }
}

function readQty(qty: QtyLike, key: string): number | undefined {
  const v = qty[key]?.value;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

function relativeDelta(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
}

function setQty(qty: QtyLike, key: string, value: number, unit: string): void {
  qty[key] = { value, unit: qty[key]?.unit ?? unit };
}

function reassertQty(qty: QtyLike, key: string, value: number, unit: string): void {
  setQty(qty, key, value, unit);
}

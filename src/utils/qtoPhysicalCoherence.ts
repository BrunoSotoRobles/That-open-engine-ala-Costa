/**
 * Physical coherence gate — preserve IFC Qto Length when V/A ≈ L.
 * Universal rule: if Qto closes physically, do not mutate Length in resolveStructuralLength.
 */

export const QTO_PHYSICAL_COHERENCE_EPS = 0.03;

export type QtyLike = {
  [key: string]: { value?: number; unit?: string } | undefined;
};

function readQtyValue(qty: QtyLike, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = qty[key]?.value;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}

/** True when GrossVolume/CrossSectionArea ≈ Length within epsilon. */
export function isQtoLengthPhysicallyCoherent(
  lengthM: number,
  volumeM3: number,
  crossSectionAreaM2: number,
  epsilon: number = QTO_PHYSICAL_COHERENCE_EPS
): boolean {
  if (lengthM <= 0 || volumeM3 <= 0 || crossSectionAreaM2 <= 0) return false;
  const impliedLength = volumeM3 / crossSectionAreaM2;
  const denom = Math.max(Math.abs(lengthM), 1e-9);
  return Math.abs(impliedLength - lengthM) / denom <= epsilon;
}

/** Reads Length, volume and CrossSectionArea from a baseQuantities map. */
export function isQtoLengthPhysicallyCoherentFromQuantities(
  quantities: QtyLike,
  epsilon: number = QTO_PHYSICAL_COHERENCE_EPS
): boolean {
  const lengthM = readQtyValue(quantities, "Length");
  if (lengthM == null) return false;
  const volumeM3 = readQtyValue(quantities, "GrossVolume", "NetVolume", "Volume");
  const crossSectionAreaM2 = readQtyValue(quantities, "CrossSectionArea");
  if (volumeM3 == null || crossSectionAreaM2 == null) return false;
  return isQtoLengthPhysicallyCoherent(lengthM, volumeM3, crossSectionAreaM2, epsilon);
}

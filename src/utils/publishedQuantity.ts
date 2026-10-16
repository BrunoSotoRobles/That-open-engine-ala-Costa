/**
 * CostaBIM-published primary quantity (what the app stands behind).
 * Raw IFC QTO in baseQuantities is not rewritten.
 */

export type PublishedQuantityUnit = "m2" | "m3" | "m" | "kpl";

export function stampPublishedQuantity(
  extra: Record<string, string | number>,
  value: number,
  unit: PublishedQuantityUnit
): void {
  if (!(value > 0) || !Number.isFinite(value)) return;
  extra["CostaBIM.PublishedQuantity"] = Number(value.toFixed(6));
  extra["CostaBIM.PublishedUnit"] = unit;
}

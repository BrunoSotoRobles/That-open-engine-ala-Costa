/**
 * Vendor-agnostic readers for extraProperties quantity channels (Tekla, Revit Dimensions.*, …).
 */

function parseFinite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Normalize linear extra values to metres (Tekla exports mm when raw > 100). */
export function readExtraLinearMetres(
  extra: Record<string, string | number> | undefined,
  keyPredicate: (lowerKey: string) => boolean
): number | null {
  if (!extra) return null;
  for (const [key, raw] of Object.entries(extra)) {
    const lower = key.toLowerCase();
    if (!keyPredicate(lower)) continue;
    const v = parseFinite(raw);
    if (v === null || v <= 0) continue;
    return v > 100 ? v / 1000 : v;
  }
  return null;
}

export function readTeklaQuantityMetres(
  extra: Record<string, string | number> | undefined,
  suffix: string
): number | null {
  const s = suffix.toLowerCase();
  return readExtraLinearMetres(
    extra,
    (k) => k.startsWith("tekla quantity.") && k.endsWith(s)
  );
}

export function readDimensionsMetres(
  extra: Record<string, string | number> | undefined,
  suffix: string
): number | null {
  const s = suffix.toLowerCase();
  return readExtraLinearMetres(extra, (k) => k.startsWith("dimensions.") && k.endsWith(s));
}

/**
 * Measurement exclusions (Paso 1 + Revit A/B).
 * Product policy: name denylist + IFC type denylist. No project-specific IDs/names.
 * Excluded elements must not inflate Määrä nor receive Littera in store/export.
 */

export type MeasurementExclusionReason =
  | "exact_name"
  | "name_prefix"
  | "name_pattern"
  | "empty_name"
  | "ifc_type";

export interface MeasurementExclusionHit {
  excluded: true;
  reason: MeasurementExclusionReason;
  matched: string;
}

export interface MeasurementExclusionMiss {
  excluded: false;
}

export type MeasurementExclusionResult = MeasurementExclusionHit | MeasurementExclusionMiss;

/** Exact names (case-insensitive, trimmed). Geometry auxiliaries + known connector tokens. */
export const MEASUREMENT_EXACT_NAMES: readonly string[] = [
  "PP",
  "VOID",
  "CUT",
  "ORIGO",
  "VASTINPISTE",
  "WELD",
  "UNNAMED",
  "LAYER",
  "BEARING_PLATE",
  "ROUNDBAR1",
  "SIDEPLATE1",
  "PETRA",
  "MODIX",
  "PBK_10",
  "RT24",
  "PLATE",
  "LEVY",
  "ENDPLATE",
];

/** Name starts with (case-insensitive). Hardware / Peikko-style product families. */
export const MEASUREMENT_NAME_PREFIXES: readonly string[] = [
  "WELDA",
  "VS80",
  "HPM20",
  "HPM30",
  "ARBOX_",
  "AEP600",
  "SUMO20",
];

/** Full-name regexes (case-insensitive). Keep narrow. */
export const MEASUREMENT_NAME_REGEXES: readonly RegExp[] = [
  /^unnamed(\s|$)/i,
];

/**
 * IFC types never measured for määräluettelo (Revit + generic).
 * Match on normalized type token (e.g. SPACE, BUILDINGELEMENTPROXY).
 */
export const MEASUREMENT_EXCLUDED_IFC_TYPE_TOKENS: readonly string[] = [
  "SPACE", // IfcSpace — rooms/zones, not construction
  "BUILDINGELEMENTPROXY", // masses / non-typed placeholders, not ML parts
  "OPENINGELEMENT", // voids; openings are not qty lines
];

const exactSet = new Set(MEASUREMENT_EXACT_NAMES.map((n) => n.toUpperCase()));

export function normalizeElementName(name: string | undefined | null): string {
  return String(name ?? "").trim();
}

/** Strip Ifc/IFC prefix and non-alnum for token compare. */
export function normalizeIfcTypeToken(ifcType: string | undefined | null): string {
  return String(ifcType ?? "")
    .toUpperCase()
    .replace(/^IFC/, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function isExcludedIfcType(ifcType: string | undefined | null): MeasurementExclusionResult {
  const token = normalizeIfcTypeToken(ifcType);
  if (!token) return { excluded: false };
  for (const excluded of MEASUREMENT_EXCLUDED_IFC_TYPE_TOKENS) {
    if (token === excluded) {
      return { excluded: true, reason: "ifc_type", matched: excluded };
    }
  }
  return { excluded: false };
}

/**
 * Returns whether an element should be excluded from measurement / cost store / Excel export.
 */
export function isMeasurementExcluded(
  name: string | undefined | null,
  ifcType?: string | undefined | null
): MeasurementExclusionResult {
  const byType = isExcludedIfcType(ifcType);
  if (byType.excluded) return byType;

  const normalized = normalizeElementName(name);
  if (!normalized) {
    return { excluded: true, reason: "empty_name", matched: "" };
  }

  const upper = normalized.toUpperCase();

  if (exactSet.has(upper)) {
    return { excluded: true, reason: "exact_name", matched: normalized };
  }

  for (const prefix of MEASUREMENT_NAME_PREFIXES) {
    if (upper.startsWith(prefix.toUpperCase())) {
      return { excluded: true, reason: "name_prefix", matched: prefix };
    }
  }

  for (const re of MEASUREMENT_NAME_REGEXES) {
    if (re.test(normalized)) {
      return { excluded: true, reason: "name_pattern", matched: re.source };
    }
  }

  return { excluded: false };
}

export function filterOutExcludedMeasurements<T extends { name?: string; type?: string }>(
  elements: T[]
): { kept: T[]; excludedCount: number } {
  const kept: T[] = [];
  let excludedCount = 0;
  for (const el of elements) {
    if (isMeasurementExcluded(el.name, el.type).excluded) {
      excludedCount++;
      continue;
    }
    kept.push(el);
  }
  return { kept, excludedCount };
}

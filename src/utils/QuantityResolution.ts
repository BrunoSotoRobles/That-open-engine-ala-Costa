import type {
  IFCQuantityValue,
  QuantityResolutionMetadata,
  QuantityResolutionOriginalValue,
  QuantityResolutionSource,
  QuantityResolutionValue,
} from "../types/cost/shared";

type MetricKey = "Length" | "Width" | "Height" | "Perimeter" | "Area" | "Volume";

interface QuantityObservation {
  metric: MetricKey;
  value: number;
  unit: string;
  source: QuantityResolutionSource;
  rawKey: string;
}

const METRICS: MetricKey[] = ["Length", "Width", "Height", "Perimeter", "Area", "Volume"];
const LINEAR_METRICS = new Set<MetricKey>(["Length", "Width", "Height", "Perimeter"]);
const RATIO_FACTORS = [1000, 1_000_000, 1_000_000_000];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function canonicalUnit(metric: MetricKey): string {
  if (metric === "Area") return "m²";
  if (metric === "Volume") return "m³";
  return "m";
}

function normalizedMetricFromKey(key: string): MetricKey | null {
  const lower = key.toLowerCase();
  if (lower.endsWith("perimeter")) return "Perimeter";
  if (lower.endsWith("length")) return "Length";
  if (lower.endsWith("width")) return "Width";
  if (lower.endsWith("height")) return "Height";
  if (lower.endsWith("area") || lower.endsWith("surfacearea") || lower.endsWith("surface area")) return "Area";
  if (lower.endsWith("volume")) return "Volume";
  return null;
}

function ratioMatchesKnownScale(a: number, b: number): boolean {
  if (!isFiniteNumber(a) || !isFiniteNumber(b) || Math.abs(b) <= Number.EPSILON) return false;
  const ratio = Math.abs(a / b);
  return RATIO_FACTORS.some((f) => Math.abs(ratio - f) / f < 0.03 || Math.abs(ratio - 1 / f) / (1 / f) < 0.03);
}

function scoreSource(source: QuantityResolutionSource): number {
  if (source === "tekla_quantity") return 0.9;
  if (source === "pset_basequantities") return 0.85;
  if (source === "ifc_base") return 0.75;
  return 0.6;
}

function toCanonicalValue(obs: QuantityObservation): QuantityObservation {
  // Tekla Quantity linear fields are commonly exported in mm.
  if (obs.source === "tekla_quantity" && LINEAR_METRICS.has(obs.metric)) {
    return { ...obs, value: obs.value / 1000, unit: "m" };
  }
  return { ...obs, unit: canonicalUnit(obs.metric) };
}

export function resolveQuantityShadow(
  baseQuantities: Record<string, IFCQuantityValue>,
  extraProperties: Record<string, string | number>
): QuantityResolutionMetadata {
  const observations: QuantityObservation[] = [];
  const warnings = new Set<string>();

  for (const metric of METRICS) {
    const ifcValue = baseQuantities[metric]?.value;
    if (isFiniteNumber(ifcValue)) {
      observations.push({
        metric,
        value: ifcValue,
        unit: canonicalUnit(metric),
        source: "ifc_base",
        rawKey: metric,
      });
    }
  }

  for (const [rawKey, rawValue] of Object.entries(extraProperties)) {
    if (!isFiniteNumber(rawValue)) continue;
    const metric = normalizedMetricFromKey(rawKey);
    if (!metric) continue;

    const lower = rawKey.toLowerCase();
    let source: QuantityResolutionSource | null = null;
    if (lower.startsWith("tekla quantity.")) source = "tekla_quantity";
    else if (lower.includes("basequantities.")) source = "pset_basequantities";
    else if (lower.startsWith("dimensions.")) source = "dimensions";
    if (!source) continue;

    observations.push({
      metric,
      value: rawValue,
      unit: canonicalUnit(metric),
      source,
      rawKey,
    });
  }

  const original: Record<string, QuantityResolutionOriginalValue[]> = {};
  const resolved: Record<string, QuantityResolutionValue> = {};

  for (const obs of observations) {
    const normalized = toCanonicalValue(obs);
    if (!original[normalized.metric]) original[normalized.metric] = [];
    original[normalized.metric].push({
      value: normalized.value,
      unit: normalized.unit,
      source: normalized.source,
      rawKey: normalized.rawKey,
    });
  }

  let correctedCount = 0;
  let unresolvedCount = 0;
  let conflictCount = 0;

  for (const metric of METRICS) {
    const options = (original[metric] ?? []).slice().sort((a, b) => scoreSource(b.source) - scoreSource(a.source));
    if (options.length === 0) continue;

    const winner = options[0];
    let confidence = scoreSource(winner.source);
    const ifc = options.find((o) => o.source === "ifc_base");

    if (ifc && winner.source !== "ifc_base" && ratioMatchesKnownScale(winner.value, ifc.value)) {
      warnings.add(`ratio_factor_detected:${metric}`);
      warnings.add(`source_conflict_ifc_vs_tekla:${metric}`);
      correctedCount++;
      confidence = Math.min(1, confidence + 0.08);
    }

    const hasAgreement = options.some((o) => o !== winner && Math.abs(o.value - winner.value) / Math.max(Math.abs(winner.value), 1e-9) < 0.05);
    if (hasAgreement) confidence = Math.min(1, confidence + 0.08);

    const hasHardConflict = options.some((o) => o !== winner && Math.abs(o.value - winner.value) / Math.max(Math.abs(winner.value), 1e-9) > 0.5);
    if (hasHardConflict) {
      conflictCount++;
      warnings.add(`source_conflict_ifc_vs_tekla:${metric}`);
      if (confidence < 0.7) {
        unresolvedCount++;
        warnings.add(`low_confidence_resolution:${metric}`);
      }
    }

    resolved[metric] = {
      value: winner.value,
      unit: winner.unit,
      source: winner.source,
      confidence: Number(confidence.toFixed(3)),
    };
  }

  // Mixed-unit warning when linear metrics pick different source families.
  const linearSources = new Set(
    Object.entries(resolved)
      .filter(([metric]) => LINEAR_METRICS.has(metric as MetricKey))
      .map(([, data]) => data.source)
  );
  if (linearSources.size > 1) {
    warnings.add("mixed_units_within_element:linear_metrics");
  }

  let status: QuantityResolutionMetadata["status"] = "ok";
  if (unresolvedCount > 0) status = "unresolved";
  if (conflictCount > 0) status = "conflict";
  if (correctedCount > 0 && status === "ok") status = "corrected";

  return {
    resolved,
    original,
    warnings: Array.from(warnings),
    status,
  };
}

/**
 * Para IfcDoor / IfcWindow, resuelve el ancho y alto del vano para cálculo de
 * perímetro (JM) y área (M2).
 *
 * Jerarquía de fuentes:
 * 1. OverallWidth / OverallHeight — atributos directos de la entidad IFC (más fiables).
 * 2. Heurística sobre L/W/H del QTO/bbox — detecta cuál dimensión es el espesor.
 */
export function resolveOpeningFrameDimsForPerimeter(
  ifcType: string,
  baseQuantities: { [key: string]: { value: number; unit: string } }
): { openingWidth: number; openingHeight: number } | null {
  const type = ifcType.toUpperCase();
  const isDoorOrWindow = type.includes("DOOR") || type.includes("WINDOW");

  // Prioridad 1: Overall* — atributos semánticos del vano definidos por el modelador.
  const OW = baseQuantities.OverallWidth?.value;
  const OH = baseQuantities.OverallHeight?.value;
  if (
    isDoorOrWindow &&
    isFiniteNumber(OW) && OW > 0 &&
    isFiniteNumber(OH) && OH > 0
  ) {
    return { openingWidth: OW, openingHeight: OH };
  }

  const W = baseQuantities.Width?.value;
  const H = baseQuantities.Height?.value;
  const L = baseQuantities.Length?.value;
  if (!isFiniteNumber(W) || !isFiniteNumber(H)) return null;

  if (!isDoorOrWindow) {
    return { openingWidth: W, openingHeight: H };
  }

  // Prioridad 2: heurística de ejes — detectar qué dimensión es el espesor del marco.

  // Height = espesor; Length = altura del vano (caso Tekla/fragment típico)
  if (
    isFiniteNumber(L) &&
    L > 0 &&
    H < Math.min(W, L) * 0.45 &&
    H < 0.55 &&
    Math.max(W, L) > 0.85
  ) {
    return { openingWidth: W, openingHeight: L };
  }

  // Length = espesor; Height = altura del vano
  if (
    isFiniteNumber(L) &&
    L > 0 &&
    L < Math.min(W, H) * 0.45 &&
    L < 0.55 &&
    Math.max(W, H) > 0.85
  ) {
    return { openingWidth: W, openingHeight: H };
  }

  // Width = espesor (raro); las dos otras son vano
  if (
    isFiniteNumber(L) &&
    L > 0 &&
    W < Math.min(H, L) * 0.45 &&
    W < 0.55 &&
    Math.max(H, L) > 0.85
  ) {
    return { openingWidth: Math.min(H, L), openingHeight: Math.max(H, L) };
  }

  return { openingWidth: W, openingHeight: H };
}

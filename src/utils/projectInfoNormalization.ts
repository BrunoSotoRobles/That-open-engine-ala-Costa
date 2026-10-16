/**
 * Normalización de valores de Project Information para factores de coste.
 * - Claves internas siempre en minúsculas
 * - Mapeo UI → base de factores (ej. OnSite → traditional)
 * - Fallback: valor desconocido → factor 1.0 o el más cercano
 */

/** Opciones estándar de Location (valores mostrados en UI) */
export const STANDARD_LOCATIONS = ['Helsinki', 'Tampere', 'Oulu'] as const;

/** Opciones estándar de Building Type */
export const STANDARD_BUILDING_TYPES = ['Residential', 'Office', 'Commercial', 'Industrial'] as const;

/** Mapeo UI Construction Method → clave interna en factores */
export const CONSTRUCTION_METHOD_UI_TO_KEY: Record<string, string> = {
  OnSite: 'traditional',
  Prefabricated: 'prefabricated',
  Traditional: 'traditional',
  Modular: 'modular',
  Renovation: 'renovation',
};

/** Opciones estándar de Construction Method (valores mostrados en UI) */
export const STANDARD_CONSTRUCTION_METHODS = ['OnSite', 'Prefabricated'] as const;

/**
 * Normaliza location a clave para buscar en REGIONAL_FACTORS.
 * Siempre devuelve minúsculas.
 */
export function normalizeLocationKey(value: string): string {
  if (!value || typeof value !== 'string') return 'other';
  const v = value.trim().toLowerCase();
  if (v === 'fi' || v === 'finland') return 'helsinki'; // fallback genérico
  return v;
}

/**
 * Normaliza buildingType a clave para factores.
 * Siempre devuelve minúsculas.
 * "Industrial / Hall" → "industrial" (primer token o más cercano)
 */
export function normalizeBuildingTypeKey(value: string): string {
  if (!value || typeof value !== 'string') return 'residential';
  const v = value.trim().toLowerCase();
  // Si contiene "industrial" o "hall", usar industrial
  if (v.includes('industrial') || v.includes('hall')) return 'industrial';
  if (v.includes('office')) return 'office';
  if (v.includes('commercial') || v.includes('retail')) return 'commercial';
  if (v.includes('residential') || v.includes('apartment')) return 'residential';
  if (v.includes('public')) return 'public';
  return v;
}

/**
 * Normaliza constructionMethod a clave para factores.
 * OnSite → traditional, Prefabricated → prefabricated.
 */
export function normalizeConstructionMethodKey(value: string): string {
  if (!value || typeof value !== 'string') return 'traditional';
  const v = value.trim();
  const mapped = CONSTRUCTION_METHOD_UI_TO_KEY[v] ?? CONSTRUCTION_METHOD_UI_TO_KEY[v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()];
  if (mapped) return mapped;
  const lower = v.toLowerCase();
  if (lower.includes('prefab') || lower.includes('element')) return 'prefabricated';
  if (lower.includes('modular')) return 'modular';
  if (lower.includes('renovation') || lower.includes('saneeraus')) return 'renovation';
  return 'traditional';
}

/**
 * Obtiene el factor regional. Si no existe, usa 'other' o 1.0.
 */
export function getLocationFactor(
  value: string,
  factors: Record<string, number>
): number {
  const key = normalizeLocationKey(value);
  if (key in factors) return Number(factors[key]);
  if ('other' in factors) return Number(factors.other);
  return 1.0;
}

/**
 * Obtiene el factor de building type. Si no existe, usa 'industrial' o 'residential' o 1.0.
 */
export function getBuildingTypeFactor(
  value: string,
  factors: Record<string, number>
): number {
  const key = normalizeBuildingTypeKey(value);
  if (key in factors) return Number(factors[key]);
  if ('default' in factors) return Number(factors.default);
  if ('residential' in factors) return Number(factors.residential);
  return 1.0;
}

/**
 * Obtiene el factor de construction method. Si no existe, usa 'traditional' o 1.0.
 */
export function getConstructionMethodFactor(
  value: string,
  factors: Record<string, number>
): number {
  const key = normalizeConstructionMethodKey(value);
  if (key in factors) return Number(factors[key]);
  if ('traditional' in factors) return Number(factors.traditional);
  return 1.0;
}

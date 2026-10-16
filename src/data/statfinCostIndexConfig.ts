/**
 * Configuración de índices de Statistics Finland para actualización de costes.
 * Punto de inicio: la app (o un módulo) aplica factores (indexLatest/indexBase) a los valores base.
 * En el futuro, los valores base pueden vivir en vuestra propia base de datos; este config
 * sigue siendo la fuente de los factores de actualización (o se integra en la BD).
 *
 * @see docs/COST_UPDATE_STATFIN_DESIGN.md
 */

export interface StatfinIndexEntry {
  indexBase: number;
  indexLatest: number;
}

export interface StatfinCostIndexConfig {
  baseYear: number;
  basePeriod: string;
  lastFetchedAt: string;
  source: string;
  byInputHeading: {
    material: StatfinIndexEntry;
    labor: StatfinIndexEntry;
    services: StatfinIndexEntry;
  };
  byBuildingType: {
    residential: StatfinIndexEntry;
    commercial: StatfinIndexEntry;
    industrial: StatfinIndexEntry;
  };
}

/** Factor de actualización = indexLatest / indexBase */
export function getUpdateFactor(entry: StatfinIndexEntry): number {
  if (entry.indexBase <= 0) return 1;
  return entry.indexLatest / entry.indexBase;
}

/**
 * Configuración de índices. Valores de prueba: base 2024, último 2025 (~+5%).
 * Sustituir por datos reales de PXWeb (tablas 13ft, 13g5) cuando esté el script.
 */
export const STATFIN_COST_INDEX_CONFIG: StatfinCostIndexConfig = {
  baseYear: 2024,
  basePeriod: "2024-03",
  lastFetchedAt: "2025-10-15",
  source: "Statistics Finland, Building cost index (PXWeb). Valores de prueba.",
  byInputHeading: {
    material: { indexBase: 100, indexLatest: 105.2 },
    labor: { indexBase: 100, indexLatest: 106.0 },
    services: { indexBase: 100, indexLatest: 104.0 },
  },
  byBuildingType: {
    residential: { indexBase: 100, indexLatest: 105.0 },
    commercial: { indexBase: 100, indexLatest: 105.5 },
    industrial: { indexBase: 100, indexLatest: 104.5 },
  },
};

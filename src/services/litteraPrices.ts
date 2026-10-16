/**
 * Precios por Littera (labor, material, subcontract) desde littera-prices.json.
 * Clave: litteraCode|unit. Usado en import Excel para rellenar costes cuando
 * el usuario no ha indicado coste y el elemento tiene Littera asignado.
 */

import litteraPricesJson from '../data/littera-prices.json';

export interface LitteraPriceEntry {
  labor?: number;
  material?: number;
  subcontract?: number;
  total?: number;
}

const prices = (litteraPricesJson as { prices: Record<string, LitteraPriceEntry> }).prices;

/**
 * Devuelve el precio por unidad para un código Littera y unidad, o null si no existe.
 * La clave en el JSON es "litteraCode|unit" (unidad en mayúsculas).
 */
export function getPriceForLittera(litteraCode: string, unit: string): LitteraPriceEntry | null {
  const code = String(litteraCode ?? '').trim();
  const u = String(unit ?? '').trim().toUpperCase();
  if (!code || !u) return null;
  const key = `${code}|${u}`;
  const entry = prices[key];
  return entry ?? null;
}

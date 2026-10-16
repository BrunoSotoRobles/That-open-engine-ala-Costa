/**
 * Validación del JSON de librería al cargar.
 * Evita que archivos mal formados o de versiones incompatibles generen
 * comportamiento impredecible; mensaje claro al usuario.
 */

import type { CostLibrary, LibraryEntry, LibraryLitteraEntry } from '../types/library';

const SCHEMA_VERSION = '1.0';

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

function isArrayOfLitteraEntries(arr: unknown): arr is LibraryLitteraEntry[] {
  if (!Array.isArray(arr)) return false;
  return arr.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const o = item as Record<string, unknown>;
    if (!isNonEmptyString(o.litteraCode) || !isNonEmptyString(o.unit)) return false;
    if (o.quantityRatio != null && (typeof o.quantityRatio !== 'number' || o.quantityRatio < 0 || o.quantityRatio > 1)) return false;
    if (o.costPerUnit != null && (typeof o.costPerUnit !== 'object' || o.costPerUnit === null)) return false;
    return true;
  });
}

function isValidEntry(entry: unknown): entry is LibraryEntry {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  if (!isNonEmptyString(e.taloCode) || !isNonEmptyString(e.elementType)) return false;
  if (!isArrayOfLitteraEntries(e.litteraCodes)) return false;
  return true;
}

export type ValidateCostLibraryResult =
  | { valid: true; lib: CostLibrary }
  | { valid: false; error: string };

/**
 * Valida un objeto parseado como CostLibrary.
 * version/updatedAt/entries obligatorios; metadata y campos opcionales en entradas permitidos.
 */
export function validateCostLibrary(obj: unknown): ValidateCostLibraryResult {
  if (!obj || typeof obj !== 'object') {
    return { valid: false, error: 'El archivo no es un JSON válido de librería.' };
  }
  const lib = obj as Record<string, unknown>;
  if (!isNonEmptyString(lib.version)) {
    return { valid: false, error: 'El archivo no tiene el campo "version". No es una librería válida.' };
  }
  if (lib.version !== SCHEMA_VERSION) {
    return {
      valid: false,
      error: `Versión de esquema no soportada: "${lib.version}". La herramienta espera "${SCHEMA_VERSION}". Exporte de nuevo desde la herramienta actual.`
    };
  }
  if (lib.updatedAt !== undefined && lib.updatedAt !== null && !isNonEmptyString(lib.updatedAt)) {
    return { valid: false, error: 'El campo "updatedAt" debe ser una fecha (texto) si está presente.' };
  }
  if (!Array.isArray(lib.entries)) {
    return { valid: false, error: 'El archivo debe contener un array "entries".' };
  }
  for (let i = 0; i < lib.entries.length; i++) {
    if (!isValidEntry(lib.entries[i])) {
      return {
        valid: false,
        error: `Entrada ${i + 1} inválida: debe tener "taloCode", "elementType" y "litteraCodes" (array con litteraCode y unit; opcional: costPerUnit, quantityRatio).`
      };
    }
  }
  const normalized: CostLibrary = {
    version: lib.version as string,
    updatedAt: (lib.updatedAt as string) ?? new Date().toISOString().slice(0, 10),
    entries: lib.entries as LibraryEntry[]
  };
  if (lib.metadata && typeof lib.metadata === 'object') {
    const m = lib.metadata as Record<string, unknown>;
    const source = m.source as string | undefined;
    normalized.metadata = {
      source: source === 'export' || source === 'manual' || source === 'suggestions' ? source : undefined,
      buildingType: typeof m.buildingType === 'string' ? m.buildingType : undefined,
      constructionMethod: typeof m.constructionMethod === 'string' ? m.constructionMethod : undefined
    };
  }
  return { valid: true, lib: normalized };
}

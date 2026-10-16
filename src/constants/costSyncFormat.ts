/**
 * Formato de archivo para sincronización Cost Analysis (Fase 2B).
 * Export/import por GUID: solo se aplican códigos (TALO, Littera) y costos;
 * las mediciones (área, volumen, etc.) no se sobrescriben al importar.
 */

/** Nombres de columnas en la hoja/archivo Sync (Excel o CSV). Case-insensitive en import. */
export const SYNC_COLUMNS = {
  GUID: 'GUID',
  TALO_CODE: 'TALO Code',
  TALO_NAME: 'TALO Name',
  MATERIAL_COST: 'Material Cost',
  LABOR_COST: 'Labor Cost',
  SUBCONTRACT_COST: 'Subcontract Cost',
  /** @deprecated Use SUBCONTRACT_COST. Kept for backward compatibility on import. */
  EQUIPMENT_COST: 'Equipment Cost',
  /** @deprecated Use SUBCONTRACT_COST. Kept for backward compatibility on import. */
  OVERHEAD_COST: 'Overhead Cost',
  TOTAL_COST: 'Total Cost',
  /** JSON array: [{ litteraCode, litteraName, litteraCategory?, unit, quantity }] */
  LITTERA_CODES: 'LitteraCodes',
} as const;

export const SYNC_SHEET_NAME = 'Sync';

/** Fila leída del archivo (valores en string; se parsean al importar). */
export interface SyncRowRaw {
  guid: string;
  taloCode?: string;
  taloName?: string;
  materialCost?: string;
  laborCost?: string;
  subcontractCost?: string;
  equipmentCost?: string;
  overheadCost?: string;
  totalCost?: string;
  litteraCodes?: string;
}

/** Resultado del import para mostrar en UX. */
export interface SyncImportResult {
  updated: number;
  ignored: number;
  errors: string[];
}

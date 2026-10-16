/**
 * Puente IFC raw → decisión Costa → unidades Cost (määräluettelo).
 * Mismo contrato para IFC Measurement Excel (UI) y export MCP/Claude.
 *
 * Orden: identidad (fija en el panel) → IFC raw → Published* → unidades Cost → audit (opcional).
 * Sin TALO / Littera / costes en columnas numéricas.
 *
 * LIVE MEASUREMENT CONTRACT: bridge Excel = identity + IFC raw + Published + Cost units only.
 * Diagnostics (MeasurementFamily, QuantityWarnings, …) are MCP preflight only, not export columns.
 */

import {
  BRIDGE_AUDIT_COLUMN_DEFS,
  BRIDGE_MEASUREMENT_AUDIT_ENABLED,
  getBridgeAuditColumnHeaders,
  isBridgeAuditHeader,
  resolveAuditColumnValue,
  computeQuantityWarnings,
  summarizeMeasurementAuditTrust,
} from "./measurementBridgeAudit";

export {
  BRIDGE_MEASUREMENT_AUDIT_ENABLED,
  getBridgeAuditColumnHeaders,
  isBridgeAuditHeader,
  resolveAuditColumnValue,
  computeQuantityWarnings,
  summarizeMeasurementAuditTrust,
};
export type { MeasurementAuditTrustSummary } from "./measurementBridgeAudit";

export type BridgeDynamicColumn = {
  id: string;
  header: string;
  enabled: boolean;
  /** baseQuantities key, published field, Cost unit code, or extraProperties audit key */
  kind: "ifcRaw" | "decision" | "costUnit" | "audit";
  sourceKey?: string;
};

/** Mensaje cuando el CostStore está vacío (IFC ya cargado en el visor). */
export const COST_STORE_EMPTY_USER_MESSAGE_ES =
  "No hay datos en Cost. En CostaBIM, pulsa **Cost** → **Send to Quantities & Cost**, y vuelve a pedir el export.";

export const COST_STORE_EMPTY_USER_MESSAGE_EN =
  "No Cost data yet. In CostaBIM, click **Cost** → **Send to Quantities & Cost**, then ask for the export again.";

export const COST_STORE_EMPTY_MCP_CODE = "COST_STORE_EMPTY";

/** Dimensiones IFC: columnas siempre presentes; vacío si el IFC no trae valor. */
export const BRIDGE_IFC_RAW_HEADERS = [
  "Length",
  "Width",
  "Height",
  "GrossArea",
  "NetArea",
  "GrossVolume",
  "NetVolume",
] as const;

export const BRIDGE_DECISION_HEADERS = ["PublishedQuantity", "PublishedUnit"] as const;

/** Unidades Cost / määräluettelo (mismas que el panel). */
export const BRIDGE_COST_UNIT_COLUMNS: ReadonlyArray<{ unit: string; header: string }> = [
  { unit: "M2", header: "M2 (m²)" },
  { unit: "BRM2", header: "BRM2 (m²)" },
  { unit: "NM2", header: "NM2 (m²)" },
  { unit: "M3", header: "M3 (m³)" },
  { unit: "RM3", header: "RM3 (m³)" },
  { unit: "NM3", header: "NM3 (m³)" },
  { unit: "JM", header: "JM (m)" },
  { unit: "M", header: "M (m)" },
  { unit: "KG", header: "KG (kg)" },
  { unit: "KPL", header: "KPL (pcs)" },
  { unit: "ERA", header: "ERÄ (lot)" },
  { unit: "AS", header: "AS (m²)" },
];

/** Claves store / extraProperties para decisión Costa (cabeceras limpias en Excel). */
export const BRIDGE_PUBLISHED_QUANTITY_KEYS = [
  "PublishedQuantity",
  "CostaBIM.PublishedQuantity",
] as const;

export const BRIDGE_PUBLISHED_UNIT_KEYS = [
  "PublishedUnit",
  "CostaBIM.PublishedUnit",
] as const;

export function buildBridgeDynamicColumns(): BridgeDynamicColumn[] {
  const ifcRaw: BridgeDynamicColumn[] = BRIDGE_IFC_RAW_HEADERS.map((header) => ({
    id: `bq_${header}`,
    header,
    enabled: true,
    kind: "ifcRaw",
    sourceKey: header,
  }));

  const decision: BridgeDynamicColumn[] = [
    {
      id: "pub_PublishedQuantity",
      header: "PublishedQuantity",
      enabled: true,
      kind: "decision",
      sourceKey: "PublishedQuantity",
    },
    {
      id: "pub_PublishedUnit",
      header: "PublishedUnit",
      enabled: true,
      kind: "decision",
      sourceKey: "PublishedUnit",
    },
  ];

  const costUnits: BridgeDynamicColumn[] = BRIDGE_COST_UNIT_COLUMNS.map(({ unit, header }) => ({
    id: `unit_${unit}`,
    header,
    enabled: true,
    kind: "costUnit",
    sourceKey: unit,
  }));

  const audit: BridgeDynamicColumn[] = BRIDGE_MEASUREMENT_AUDIT_ENABLED
    ? BRIDGE_AUDIT_COLUMN_DEFS.map(({ id, header, sourceKey }) => ({
        id,
        header,
        enabled: true,
        kind: "audit" as const,
        sourceKey,
      }))
    : [];

  return [...ifcRaw, ...decision, ...costUnits, ...audit];
}

/** Cabeceras que Claude/MCP debe seleccionar por defecto (sin Group; Group lo añade el scope). */
export function getBridgeSelectedColumnHeaders(includeGroup = false): string[] {
  const headers = [
    ...BRIDGE_IFC_RAW_HEADERS,
    ...BRIDGE_DECISION_HEADERS,
    ...BRIDGE_COST_UNIT_COLUMNS.map((c) => c.header),
    ...getBridgeAuditColumnHeaders(),
  ];
  return includeGroup ? ["CostaBIM Group", ...headers] : [...headers];
}

export function isBridgeCostUnitHeader(header: string): boolean {
  const n = header.trim().toLowerCase();
  return BRIDGE_COST_UNIT_COLUMNS.some(
    (c) => c.header.toLowerCase() === n || c.unit.toLowerCase() === n || `unit_${c.unit}`.toLowerCase() === n
  );
}

export function isBridgeIfcRawHeader(header: string): boolean {
  const n = header.trim().toLowerCase();
  return BRIDGE_IFC_RAW_HEADERS.some((h) => h.toLowerCase() === n);
}

export function isBridgeDecisionHeader(header: string): boolean {
  const n = header.trim().toLowerCase();
  return (
    n === "publishedquantity" ||
    n === "publishedunit" ||
    n === "costabim.publishedquantity" ||
    n === "costabim.publishedunit"
  );
}

/** Resuelve Published* desde elemento CostStore / mapElementForMcp. */
export function resolvePublishedFields(element: any): {
  quantity: string | number | "";
  unit: string | number | "";
} {
  const extra = (element?.extraProperties ?? {}) as Record<string, unknown>;
  if (extra["CostaBIM.PublishedBlocked"] === 1) {
    return { quantity: "", unit: "" };
  }
  const contribute = extra["CostaBIM.ContributeToMaara"];
  if (contribute === 0) {
    return {
      quantity: 0,
      unit: (extra["CostaBIM.LayerOwnUnit"] as string) ?? "",
    };
  }
  const q =
    extra["CostaBIM.PublishedQuantity"] ??
    element?.publishedQuantity ??
    (typeof element?.quantity === "number" ? element.quantity : "");
  const u =
    extra["CostaBIM.PublishedUnit"] ??
    element?.publishedUnit ??
    "";
  return {
    quantity: q === undefined || q === null ? "" : (q as string | number),
    unit: u === undefined || u === null ? "" : (u as string | number),
  };
}

/** Valor de BaseQuantity (objeto {value,unit} o escalar). */
export function resolveBaseQuantityValue(element: any, key: string): string | number | "" {
  const bq = element?.baseQuantities?.[key] ?? element?.baseQuantities?.[key];
  if (bq == null) return "";
  if (typeof bq === "number") return bq;
  if (typeof bq === "object" && bq !== null && "value" in bq) {
    const v = (bq as { value?: unknown }).value;
    if (v === undefined || v === null || v === "") return "";
    return typeof v === "number" || typeof v === "string" ? v : String(v);
  }
  return "";
}

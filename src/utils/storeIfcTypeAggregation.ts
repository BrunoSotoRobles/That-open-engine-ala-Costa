/**
 * Single source for IFC-type counts from CostStore elements.
 * Used by MCP ping, ModelHealth, and any store-vs-export diagnostics.
 */

export type StoreIfcTypeCount = {
  ifcType: string;
  count: number;
};

export function normalizeStoreIfcType(type: unknown): string {
  return String(type ?? "").trim() || "(unknown)";
}

/** Aggregate element list by raw IFC type (same axis as costa_get_ifc_types_in_store). */
export function aggregateStoreElementsByIfcType(
  elements: Array<{ type?: unknown }>
): StoreIfcTypeCount[] {
  const counts = new Map<string, number>();
  for (const el of elements) {
    const t = normalizeStoreIfcType(el?.type);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([ifcType, count]) => ({ ifcType, count }))
    .sort((a, b) => b.count - a.count || a.ifcType.localeCompare(b.ifcType));
}

export function sumStoreTypeCounts(rows: StoreIfcTypeCount[]): number {
  return rows.reduce((sum, row) => sum + row.count, 0);
}

/** True when ModelHealth row totals match store type aggregation (C1 guard). */
export function modelHealthTotalsMatchStore(
  healthRows: Array<{ elementCount: number }>,
  storeElements: Array<{ type?: unknown }>
): boolean {
  const healthTotal = healthRows.reduce((s, r) => s + r.elementCount, 0);
  return healthTotal === storeElements.length;
}

import * as WEBIFC from "web-ifc";

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function inferIfcType(typeValue: unknown): string {
  const key = Object.keys(WEBIFC).find((k) => (WEBIFC as Record<string, unknown>)[k] === typeValue);
  return key?.replace(/^IFC/, "Ifc") ?? `Type ${String(typeValue)}`;
}

export function normalizeIfcTypeFilter(ifcType: string | undefined): string | undefined {
  const t = ifcType?.trim().toLowerCase();
  if (!t) return undefined;
  return t.startsWith("ifc") ? t : `ifc${t}`;
}

export type IfcElementQueryFilters = {
  ifcType?: string;
  /** Substring on Name (MCP: nameContains). */
  nameContains?: string;
  /** Substring on Name, optional Description and Pset property names. */
  keywords?: string;
  globalId?: string;
  maxResults?: number;
  searchInDescription?: boolean;
  searchInPropertyNames?: boolean;
  /**
   * If set, only these express IDs are considered (Model Tree visible scope
   * and/or live click/lasso selection). Empty set → no hits.
   */
  expressIdAllowList?: ReadonlySet<number> | number[];
};

export type IfcElementQueryRow = {
  id: number;
  expressId: number;
  /**
   * ID del primer fragmento que contiene este elemento.
   * Solo informativo — no usar para highlight ni lógica de negocio.
   * Para construir FragmentIdMap completo (todos los fragmentos del objeto)
   * usar buildFragmentIdMapForIds(fragmentModel, expressIds) en su lugar.
   */
  fragmentId: string | null;
  globalId: string | null;
  name: string;
  type: string;
};

export type IfcRelationsIndexerLike = {
  getEntityRelations: (model: unknown, expressId: number, relation: string) => Iterable<number> | null | undefined;
};

const DEFAULT_MAX_RESULTS = 500;
const HARD_MAX_RESULTS = 2000;

function getSearchText(filters: IfcElementQueryFilters): string {
  return (filters.keywords ?? filters.nameContains ?? "").trim();
}

async function elementMatchesPropertyNames(
  fragmentModel: { getProperties: (id: number) => Promise<unknown> },
  indexer: IfcRelationsIndexerLike,
  expressId: number,
  regex: RegExp
): Promise<boolean> {
  const propertyRelations = indexer.getEntityRelations(fragmentModel, expressId, "IsDefinedBy");
  if (!propertyRelations) return false;

  for (const relId of propertyRelations) {
    const relation = (await fragmentModel.getProperties(Number(relId))) as {
      HasProperties?: { value: number }[];
      Quantities?: unknown;
      Name?: { value?: string };
    } | null;
    if (!relation?.HasProperties || relation.Quantities) continue;

    const psetName = String(relation.Name?.value ?? "").trim();
    if (psetName && regex.test(psetName)) return true;

    for (const propRef of relation.HasProperties) {
      try {
        const property = (await fragmentModel.getProperties(propRef.value)) as {
          Name?: { value?: string };
        } | null;
        const propertyName = String(property?.Name?.value ?? "").trim();
        if (propertyName && regex.test(propertyName)) return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

/**
 * Query IFC elements with filters. Scans the loaded fragment model.
 * Stops at maxResults to limit CPU/memory pressure.
 */
export async function queryIfcElements(
  fragmentModel: { items: Iterable<{ id: string; ids: Iterable<number> }>; getProperties: (id: number) => Promise<unknown> } | null,
  filters: IfcElementQueryFilters,
  options?: { indexer?: IfcRelationsIndexerLike }
): Promise<{ elements: IfcElementQueryRow[]; truncated: boolean }> {
  const ifcTypeFilter = normalizeIfcTypeFilter(filters.ifcType);
  const globalIdFilter = filters.globalId?.trim().toLowerCase();
  const searchText = getSearchText(filters);
  const searchRegex = searchText ? new RegExp(escapeRegExp(searchText), "i") : null;
  const searchInDescription = filters.searchInDescription ?? Boolean(filters.keywords);
  const searchInPropertyNames = filters.searchInPropertyNames ?? false;
  const maxResults = Math.min(
    typeof filters.maxResults === "number" && filters.maxResults > 0 ? filters.maxResults : DEFAULT_MAX_RESULTS,
    HARD_MAX_RESULTS
  );

  const allowListRaw = filters.expressIdAllowList;
  const allowList: Set<number> | null = allowListRaw
    ? allowListRaw instanceof Set
      ? allowListRaw
      : new Set(allowListRaw.map((n) => Number(n)))
    : null;

  const elements: IfcElementQueryRow[] = [];
  /** One IFC element (expressId) may appear in multiple mesh fragments — dedupe at element level. */
  const seenExpressIds = new Set<number>();
  let truncated = false;

  if (!fragmentModel) {
    return { elements, truncated };
  }

  if (allowList && allowList.size === 0) {
    return { elements, truncated };
  }

  const hasTextSearch = Boolean(searchRegex);
  const hasGuidFilter = Boolean(globalIdFilter);
  const hasTypeOnly = Boolean(ifcTypeFilter) && !hasTextSearch && !hasGuidFilter;

  if (!hasTextSearch && !hasGuidFilter && !hasTypeOnly) {
    return { elements, truncated };
  }

  outer: for (const fragment of fragmentModel.items) {
    for (const expressId of fragment.ids) {
      const idNum = Number(expressId);
      if (Number.isNaN(idNum)) continue;
      if (allowList && !allowList.has(idNum)) continue;

      let element: {
        type?: unknown;
        Name?: { value?: string };
        Description?: { value?: string };
        GlobalId?: { value?: string };
      } | null = null;

      try {
        element = (await fragmentModel.getProperties(idNum)) as typeof element;
      } catch {
        continue;
      }
      if (!element) continue;

      const inferredType = inferIfcType(element.type);
      if (ifcTypeFilter && inferredType.toLowerCase() !== ifcTypeFilter) continue;

      const globalId = element.GlobalId?.value ?? null;
      if (hasGuidFilter && String(globalId ?? "").toLowerCase() !== globalIdFilter) continue;

      const name = String(element.Name?.value ?? "");
      let matched = false;

      if (hasGuidFilter && !hasTextSearch) {
        matched = true;
      } else if (searchRegex) {
        if (searchRegex.test(name)) matched = true;
        if (!matched && searchInDescription) {
          const description = String(element.Description?.value ?? "");
          if (description && searchRegex.test(description)) matched = true;
        }
        if (!matched && searchInPropertyNames && options?.indexer) {
          matched = await elementMatchesPropertyNames(
            fragmentModel,
            options.indexer,
            idNum,
            searchRegex
          );
        }
      } else if (hasTypeOnly) {
        matched = true;
      }

      if (!matched) continue;

      if (seenExpressIds.has(idNum)) continue;
      seenExpressIds.add(idNum);

      elements.push({
        id: idNum,
        expressId: idNum,
        fragmentId: String(fragment.id),
        globalId: globalId != null ? String(globalId) : null,
        name,
        type: inferredType,
      });

      if (elements.length >= maxResults) {
        truncated = true;
        break outer;
      }
    }
  }

  return { elements, truncated };
}

/** Collect distinct Ifc types present in the model (sorted). */
export async function collectIfcTypesFromModel(
  fragmentModel: { items: Iterable<{ ids: Iterable<number> }>; getProperties: (id: number) => Promise<unknown> } | null,
  maxSample = 50000
): Promise<string[]> {
  const types = new Set<string>();
  if (!fragmentModel) return [];

  let scanned = 0;
  outer: for (const fragment of fragmentModel.items) {
    for (const expressId of fragment.ids) {
      scanned++;
      if (scanned > maxSample) break outer;
      try {
        const element = (await fragmentModel.getProperties(Number(expressId))) as { type?: unknown } | null;
        if (element) types.add(inferIfcType(element.type));
      } catch {
        continue;
      }
    }
  }

  return Array.from(types).sort((a, b) => a.localeCompare(b));
}

export function buildFragmentIdMapForIds(
  fragmentModel: { items: Iterable<{ id: string; ids: Iterable<number> }> } | null,
  ids: number[]
): Record<string, Set<number>> {
  const idSet = new Set(ids.map((n) => Number(n)));
  const fragmentIdMap: Record<string, Set<number>> = {};
  if (!fragmentModel?.items) return fragmentIdMap;

  for (const fragment of fragmentModel.items) {
    const selected: number[] = [];
    for (const expressId of fragment.ids) {
      const idNum = Number(expressId);
      if (idSet.has(idNum)) selected.push(idNum);
    }
    if (selected.length > 0) {
      fragmentIdMap[String(fragment.id)] = new Set(selected);
    }
  }
  return fragmentIdMap;
}

/**
 * Construye un FragmentIdMap a partir de filas de búsqueda guardadas.
 *
 * LIMITACIÓN CONOCIDA: usa row.fragmentId (solo el primer fragmento del objeto).
 * Solo se activa como fallback cuando no hay fragmentModel en memoria; en ese
 * contexto no es posible resolver todos los fragmentos del objeto.
 * Con modelo activo, usar buildFragmentIdMapForIds() para el mapa completo.
 */
export function buildFragmentIdMapFromRows(rows: IfcElementQueryRow[]): Record<string, Set<number>> {
  const fragmentIdMap: Record<string, Set<number>> = {};
  for (const row of rows) {
    if (!row.fragmentId) continue;
    const fid = row.fragmentId;
    if (!fragmentIdMap[fid]) fragmentIdMap[fid] = new Set();
    fragmentIdMap[fid].add(row.expressId);
  }
  return fragmentIdMap;
}

export function cloneFragmentIdMap(map: Record<string, Set<number>>): Record<string, Set<number>> {
  const out: Record<string, Set<number>> = {};
  for (const key of Object.keys(map)) {
    out[key] = new Set(map[key]);
  }
  return out;
}

export function mergeFragmentIdMaps(
  base: Record<string, Set<number>>,
  add: Record<string, Set<number>>
): Record<string, Set<number>> {
  const out = cloneFragmentIdMap(base);
  for (const key of Object.keys(add)) {
    if (!out[key]) out[key] = new Set();
    for (const id of add[key]) out[key].add(id);
  }
  return out;
}

export function countFragmentIdMap(map: Record<string, Set<number>>): number {
  let n = 0;
  for (const key of Object.keys(map)) n += map[key].size;
  return n;
}

export function getExpressIdsFromFragmentIdMap(map: Record<string, Set<number>>): number[] {
  const ids: number[] = [];
  for (const key of Object.keys(map)) {
    for (const id of map[key]) ids.push(Number(id));
  }
  return ids;
}

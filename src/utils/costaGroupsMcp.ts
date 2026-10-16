/**
 * Costa named groups → MCP / WebSocket (IFC read-only, no IFC write).
 * Groups: CostaBIM document (localStorage). Member data: loaded fragment model.
 */

import type { FragmentsGroup } from "@thatopen/fragments";
import { IfcCategoryMap } from "@thatopen/components";
import {
  createNamedGroupFromExpressIds,
  getCostaGroupsDocument,
  type CostaGroupRecord,
  type CostaGroupsDocument,
  type CostaNamedGroup,
} from "./costaGroups";
import { inferIfcType, type IfcRelationsIndexerLike } from "./ifcElementQuery";

export type CostaGroupMemberIfc = {
  expressId: number;
  globalId: string | null;
  ifcType: string;
  name: string;
  description: string | null;
  floor: string | null;
  resolved: boolean;
};

export type CostaGroupExtractRow = CostaGroupMemberIfc & {
  costaGroupId: string;
  costaGroupName: string;
  baseQuantities: Record<string, { value: number; unit: string }>;
  properties: Record<string, string | number>;
};

const DEFAULT_EXTRACT_MAX = 500;
const HARD_EXTRACT_MAX = 2000;

export function resolveCostaGroup(
  groupId?: string,
  groupName?: string,
  doc?: CostaGroupsDocument
): { group: CostaGroupRecord; document: CostaGroupsDocument } | { error: string } {
  const document = doc ?? getCostaGroupsDocument();
  const id = groupId?.trim();
  const name = groupName?.trim();

  if (!id && !name) {
    return { error: "Provide groupId or groupName." };
  }

  let group: CostaGroupRecord | undefined;
  if (id) {
    group = document.groups.find((g) => g.id === id);
    if (!group) return { error: `No Costa group with id "${id}".` };
  } else if (name) {
    const matches = document.groups.filter((g) => g.name === name);
    if (matches.length === 0) return { error: `No Costa group named "${name}".` };
    if (matches.length > 1) {
      return {
        error: `Multiple groups named "${name}" (${matches.length}). Use groupId.`,
      };
    }
    group = matches[0];
  }

  if (!group) return { error: "Group not found." };
  return { group, document };
}

async function resolveFloor(
  model: FragmentsGroup,
  indexer: IfcRelationsIndexerLike,
  expressId: number
): Promise<string | null> {
  const containment = indexer.getEntityRelations(model, expressId, "ContainedInStructure");
  if (!containment) return null;
  for (const containerId of containment) {
    const container = (await model.getProperties(Number(containerId))) as {
      type?: string;
      Name?: { value?: string };
      LongName?: { value?: string };
    } | null;
    if (!container) continue;
    const type = String(container.type ?? "").toUpperCase();
    if (type === "IFCBUILDINGSTOREY" || type.includes("BUILDINGSTOREY")) {
      const label = String(container.Name?.value ?? container.LongName?.value ?? "").trim();
      return label || null;
    }
  }
  return null;
}

async function readIfcProperties(
  model: FragmentsGroup,
  indexer: IfcRelationsIndexerLike,
  expressId: number,
  psetNameContains?: string
): Promise<Record<string, string | number>> {
  const out: Record<string, string | number> = {};
  const filter = psetNameContains?.trim().toLowerCase();
  const propertyRelations = indexer.getEntityRelations(model, expressId, "IsDefinedBy");
  if (!propertyRelations) return out;

  for (const relId of propertyRelations) {
    const relation = (await model.getProperties(Number(relId))) as {
      HasProperties?: { value: number }[];
      Quantities?: unknown;
      Name?: { value?: string };
    } | null;
    if (!relation?.HasProperties || relation.Quantities) continue;

    const psetName = String(relation.Name?.value ?? "").trim();
    if (filter && !psetName.toLowerCase().includes(filter)) continue;

    for (const propRef of relation.HasProperties) {
      try {
        const property = (await model.getProperties(propRef.value)) as {
          Name?: { value?: string };
          NominalValue?: { value?: unknown };
        } | null;
        if (!property) continue;
        const propName = String(property.Name?.value ?? "").trim();
        if (!propName) continue;
        const raw = property.NominalValue?.value;
        if (raw === undefined || raw === null) continue;
        const key = psetName ? `${psetName}.${propName}` : propName;
        out[key] = typeof raw === "number" || typeof raw === "string" ? raw : String(raw);
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

async function readIfcBaseQuantities(
  model: FragmentsGroup,
  indexer: IfcRelationsIndexerLike,
  expressId: number
): Promise<Record<string, { value: number; unit: string }>> {
  const out: Record<string, { value: number; unit: string }> = {};
  const propertyRelations = indexer.getEntityRelations(model, expressId, "IsDefinedBy");
  if (!propertyRelations) return out;

  for (const relId of propertyRelations) {
    const relation = (await model.getProperties(Number(relId))) as {
      Quantities?: { value: number }[];
      Name?: { value?: string };
    } | null;
    if (!relation?.Quantities) continue;

    for (const quantityRef of relation.Quantities) {
      try {
        const quantity = (await model.getProperties(quantityRef.value)) as {
          Name?: { value?: string };
          LengthValue?: { value?: number };
          AreaValue?: { value?: number };
          VolumeValue?: { value?: number };
          CountValue?: { value?: number };
        } | null;
        if (!quantity?.Name?.value) continue;
        const qName = String(quantity.Name.value);
        let value: number | undefined;
        let unit = "";
        if (quantity.LengthValue?.value != null) {
          value = Number(quantity.LengthValue.value);
          unit = "m";
        } else if (quantity.AreaValue?.value != null) {
          value = Number(quantity.AreaValue.value);
          unit = "m²";
        } else if (quantity.VolumeValue?.value != null) {
          value = Number(quantity.VolumeValue.value);
          unit = "m³";
        } else if (quantity.CountValue?.value != null) {
          value = Number(quantity.CountValue.value);
          unit = "units";
        }
        if (value !== undefined && !Number.isNaN(value)) {
          out[qName] = { value, unit };
        }
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

export async function readCostaGroupMemberFromIfc(
  model: FragmentsGroup,
  indexer: IfcRelationsIndexerLike,
  expressId: number
): Promise<CostaGroupMemberIfc> {
  const id = Number(expressId);
  try {
    const element = (await model.getProperties(id)) as {
      type?: unknown;
      Name?: { value?: string };
      Description?: { value?: string };
      GlobalId?: { value?: string };
    } | null;
    if (!element) {
      return {
        expressId: id,
        globalId: null,
        ifcType: "Unknown",
        name: "",
        description: null,
        floor: null,
        resolved: false,
      };
    }
    const floor = await resolveFloor(model, indexer, id);
    const globalIdRaw = element.GlobalId?.value;
    return {
      expressId: id,
      globalId:
        globalIdRaw !== undefined && globalIdRaw !== null
          ? String(globalIdRaw).trim()
          : null,
      ifcType: inferIfcType(element.type),
      name: String(element.Name?.value ?? "").trim(),
      description: String(element.Description?.value ?? "").trim() || null,
      floor,
      resolved: true,
    };
  } catch {
    return {
      expressId: id,
      globalId: null,
      ifcType: "Unknown",
      name: "",
      description: null,
      floor: null,
      resolved: false,
    };
  }
}

export async function readCostaGroupMembersFromIfc(
  model: FragmentsGroup,
  indexer: IfcRelationsIndexerLike,
  expressIds: number[]
): Promise<{ members: CostaGroupMemberIfc[]; unresolvedIds: number[] }> {
  const members: CostaGroupMemberIfc[] = [];
  const unresolvedIds: number[] = [];
  for (const expressId of expressIds) {
    const member = await readCostaGroupMemberFromIfc(model, indexer, expressId);
    members.push(member);
    if (!member.resolved) unresolvedIds.push(expressId);
  }
  return { members, unresolvedIds };
}

export type ExtractCostaGroupOptions = {
  includeBaseQuantities?: boolean;
  includeProperties?: boolean;
  psetNameContains?: string;
  maxMembers?: number;
};

export async function extractCostaGroupFromIfc(
  model: FragmentsGroup,
  indexer: IfcRelationsIndexerLike,
  group: CostaGroupRecord,
  options: ExtractCostaGroupOptions = {}
): Promise<{
  groupName: string;
  groupId: string;
  rowCount: number;
  truncated: boolean;
  columns: string[];
  rows: CostaGroupExtractRow[];
  unresolvedIds: number[];
  source: "ifc";
}> {
  const maxMembers = Math.min(
    Math.max(1, options.maxMembers ?? DEFAULT_EXTRACT_MAX),
    HARD_EXTRACT_MAX
  );
  const ids = group.expressIds.slice(0, maxMembers);
  const truncated = group.expressIds.length > ids.length;
  const includeBaseQuantities = options.includeBaseQuantities !== false;
  const includeProperties = options.includeProperties !== false;

  const rows: CostaGroupExtractRow[] = [];
  const unresolvedIds: number[] = [];

  for (const expressId of ids) {
    const member = await readCostaGroupMemberFromIfc(model, indexer, expressId);
    if (!member.resolved) unresolvedIds.push(expressId);

    const baseQuantities = includeBaseQuantities
      ? await readIfcBaseQuantities(model, indexer, expressId)
      : {};
    const properties = includeProperties
      ? await readIfcProperties(model, indexer, expressId, options.psetNameContains)
      : {};

    rows.push({
      ...member,
      costaGroupId: group.id,
      costaGroupName: group.name,
      baseQuantities,
      properties,
    });
  }

  const columns = [
    "expressId",
    "globalId",
    "ifcType",
    "name",
    "description",
    "floor",
    "costaGroupId",
    "costaGroupName",
    ...(includeBaseQuantities ? ["baseQuantities"] : []),
    ...(includeProperties ? ["properties"] : []),
  ];

  return {
    groupId: group.id,
    groupName: group.name,
    rowCount: rows.length,
    truncated,
    columns,
    rows,
    unresolvedIds,
    source: "ifc",
  };
}

/** Every expressId present in the loaded fragment model (IFC viewer universe). */
export function collectExpressIdsFromFragmentModel(model: FragmentsGroup): number[] {
  const seen = new Set<number>();
  for (const fragment of model.items as Iterable<{ ids: Iterable<number> }>) {
    for (const expressId of fragment.ids) {
      const n = Number(expressId);
      if (Number.isFinite(n)) seen.add(n);
    }
  }
  return Array.from(seen);
}

/** Normalize IfcPlate / IFCPLATE / plate → "ifcplate". */
export function normalizeIfcTypeKey(ifcType: string): string {
  const t = String(ifcType ?? "")
    .trim()
    .toLowerCase()
    .replace(/^ifc/, "");
  return t ? `ifc${t}` : "";
}

/** Display label: ifcplate → IfcPlate */
function toIfcTypeLabel(raw: string): string {
  const key = normalizeIfcTypeKey(raw);
  if (!key) return String(raw ?? "").trim();
  const body = key.slice(3);
  return `Ifc${body.charAt(0).toUpperCase()}${body.slice(1)}`;
}

/**
 * Sync IFC type from fragment `model.data` (IfcCategoryMap), same source as Model Tree.
 * Falls back to empty string if unknown.
 */
export function ifcTypeKeyFromModelData(
  model: FragmentsGroup,
  expressId: number
): string {
  try {
    const data = (model as { data?: Map<number, unknown> }).data?.get(expressId) as
      | [unknown, [unknown, number]?]
      | undefined;
    const typeId = data?.[1]?.[1];
    if (typeId === undefined) return "";
    const raw = IfcCategoryMap[typeId] ?? "";
    return normalizeIfcTypeKey(String(raw));
  } catch {
    return "";
  }
}

/** Filter expressIds to those whose IFC type matches any of `ifcTypes` (case / Ifc-prefix insensitive). */
export function filterExpressIdsByIfcTypes(
  model: FragmentsGroup,
  expressIds: number[],
  ifcTypes: string[]
): number[] {
  const want = new Set(
    ifcTypes.map(normalizeIfcTypeKey).filter(Boolean)
  );
  if (want.size === 0) return expressIds.slice();
  return expressIds.filter((id) => {
    const key = ifcTypeKeyFromModelData(model, id);
    return Boolean(key) && want.has(key);
  });
}

export type CreateComplementGroupInput = {
  name: string;
  /** CostaBIM group(s) = selection to EXCLUDE from the IFC (any mix of types). */
  excludeGroupId?: string;
  excludeGroupName?: string;
  excludeGroupIds?: string[];
  excludeGroupNames?: string[];
  /**
   * Optional: narrow the IFC universe before subtracting the exclude group(s).
   * Omit = entire loaded IFC (default inverse selection).
   */
  ifcTypes?: string[];
};

export type CreateComplementOptions = {
  /** When true, universe = storeExpressIds instead of all loaded IFC expressIds. */
  useStoreUniverse?: boolean;
  storeExpressIds?: number[];
};

export type CreateComplementGroupResult =
  | {
      ok: true;
      /** Always inverse selection: IFC universe minus CostaBIM exclude group(s). */
      operation: "inverse_selection";
      group: CostaNamedGroup;
      universeCount: number;
      universeSource: "ifc" | "store";
      /** Loaded IFC expressId count (for strict contrast with store). */
      ifcUniverseCount?: number;
      storeUniverseCount?: number;
      /** How many exclude-group IDs fell inside the universe used. */
      excludedFromUniverse: number;
      /** Total IDs in the exclude group(s), any IFC type. */
      excludedCount: number;
      complementCount: number;
      ifcTypes: string[] | null;
      excludeGroups: Array<{ id: string; name: string; memberCount: number }>;
      unresolvedIds?: number[];
    }
  | { ok: false; error: string };

/**
 * Inverse selection for MCP: IFC universe minus CostaBIM exclude group(s).
 *
 * The exclude group is a selection of elements to remove from the loaded IFC —
 * any mix of IFC types (plates, members, openings, hardware, …). It is NOT
 * required to be a single type.
 *
 * Default universe = every expressId in the loaded fragment model.
 * Optional ifcTypes only narrows that universe before the subtraction.
 */
export function createComplementNamedGroup(
  input: CreateComplementGroupInput,
  model: FragmentsGroup | null,
  options?: CreateComplementOptions
): CreateComplementGroupResult {
  if (!model) {
    return { ok: false, error: "No IFC model loaded in the viewer." };
  }

  const trimmed = input.name.trim();
  if (!trimmed) return { ok: false, error: "Group name is required." };

  const excludeRefs: Array<{ groupId?: string; groupName?: string }> = [];
  if (input.excludeGroupId?.trim()) {
    excludeRefs.push({ groupId: input.excludeGroupId.trim() });
  }
  if (input.excludeGroupName?.trim()) {
    excludeRefs.push({ groupName: input.excludeGroupName.trim() });
  }
  for (const id of input.excludeGroupIds ?? []) {
    const s = String(id ?? "").trim();
    if (s) excludeRefs.push({ groupId: s });
  }
  for (const n of input.excludeGroupNames ?? []) {
    const s = String(n ?? "").trim();
    if (s) excludeRefs.push({ groupName: s });
  }
  if (excludeRefs.length === 0) {
    return {
      ok: false,
      error:
        "Provide at least one CostaBIM exclude group (excludeGroupId or excludeGroupName). That group is the selection to remove from the IFC.",
    };
  }

  const rawIfcTypes = (input.ifcTypes ?? [])
    .map((t) => String(t ?? "").trim())
    .filter(Boolean);
  const ifcTypesNormalized = rawIfcTypes.length
    ? [...new Set(rawIfcTypes.map(toIfcTypeLabel))]
    : null;

  const doc = getCostaGroupsDocument();
  const excludeIdSet = new Set<number>();
  const excludeGroups: Array<{ id: string; name: string; memberCount: number }> = [];

  for (const ref of excludeRefs) {
    const resolved = resolveCostaGroup(ref.groupId, ref.groupName, doc);
    if ("error" in resolved) return { ok: false, error: resolved.error };
    for (const id of resolved.group.expressIds) {
      excludeIdSet.add(Number(id));
    }
    excludeGroups.push({
      id: resolved.group.id,
      name: resolved.group.name,
      memberCount: resolved.group.expressIds.length,
    });
  }

  if (excludeIdSet.size === 0) {
    return {
      ok: false,
      error: "Exclude group(s) have no expressIds — nothing to subtract from the IFC.",
    };
  }

  const ifcUniverseCount = collectExpressIdsFromFragmentModel(model).length;
  const storeIds = (options?.storeExpressIds ?? [])
    .map((n) => Number(n))
    .filter((n) => !isNaN(n) && n > 0);
  const storeUniverseCount = storeIds.length > 0 ? new Set(storeIds).size : undefined;

  const useStore = Boolean(options?.useStoreUniverse && storeUniverseCount);
  const allIds = useStore
    ? [...new Set(storeIds)]
    : collectExpressIdsFromFragmentModel(model);
  const universe =
    rawIfcTypes.length > 0
      ? filterExpressIdsByIfcTypes(model, allIds, rawIfcTypes)
      : allIds;

  if (universe.length === 0) {
    return {
      ok: false,
      error: rawIfcTypes.length
        ? `IFC universe is empty for type(s) ${ifcTypesNormalized!.join(", ")}.`
        : "IFC universe is empty: loaded model has no expressIds.",
    };
  }

  const excludedFromUniverse = universe.reduce(
    (n, id) => n + (excludeIdSet.has(id) ? 1 : 0),
    0
  );
  const complementIds = universe.filter((id) => !excludeIdSet.has(id));
  if (complementIds.length === 0) {
    const scope = ifcTypesNormalized
      ? `IFC type(s) ${ifcTypesNormalized.join(", ")} (${universe.length} elements)`
      : `the entire loaded IFC (${universe.length} elements)`;
    return {
      ok: false,
      error: `Inverse selection is empty — exclude group(s) cover ${scope}.`,
    };
  }

  const created = createNamedGroupFromExpressIds(trimmed, complementIds, model);
  if (!created.ok) return created;

  return {
    ok: true,
    operation: "inverse_selection",
    group: created.group,
    universeCount: universe.length,
    universeSource: useStore ? "store" : "ifc",
    ifcUniverseCount,
    storeUniverseCount,
    excludedFromUniverse,
    excludedCount: excludeIdSet.size,
    complementCount: complementIds.length,
    ifcTypes: ifcTypesNormalized,
    excludeGroups,
    unresolvedIds: created.unresolvedIds,
  };
}

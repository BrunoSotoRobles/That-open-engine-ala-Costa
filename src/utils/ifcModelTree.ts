/**
 * IFC model tree for visual scope: Project → Site → Building → Storey → IFC type groups.
 * Elements under a spatial container are grouped by IFC entity (IfcWall, IfcSlab, …),
 * not listed one-by-one at the storey level.
 *
 * Tekla / Assemblies:On — IfcElementAssembly under a storey is expanded via
 * IsDecomposedBy so type groups show real parts (IfcPlate, IfcBeam, …).
 * IFCs without assemblies behave exactly as before.
 */

import { IfcCategoryMap } from "@thatopen/components";
import type { FragmentsGroup } from "@thatopen/fragments";
import type { FragmentIdMap } from "./boxSelection";

const SPATIAL_ENTITIES = new Set([
  "IFCPROJECT",
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
  "IFCSPACE",
  "IFCFACILITY",
  "IFCFACILITYPART",
  "IFCBRIDGE",
  "IFCRAILWAY",
  "IFCROAD",
  "IFCMARINEFACILITY",
]);

/** Containers that wrap products (Tekla assemblies). Not spatial; not leaf type buckets. */
const ASSEMBLY_ENTITIES = new Set(["IFCELEMENTASSEMBLY"]);

/** Guard against cyclic RelAggregates graphs. */
const MAX_ASSEMBLY_DEPTH = 4;

export type IfcModelTreeNode = {
  id: string;
  kind: "spatial" | "typeGroup";
  /** Display label (Name or entity). */
  label: string;
  /** IFC category string, e.g. IFCWALL / IFCBUILDINGSTOREY */
  entity: string;
  expressId: number | null;
  /** Express IDs used for Select / Isolate (type group = members; spatial = aggregated). */
  expressIds: number[];
  children: IfcModelTreeNode[];
};

type IndexerLike = {
  getEntityRelations: (
    model: FragmentsGroup,
    expressId: number,
    attribute: string
  ) => number[] | null | undefined;
};

function entityOf(model: FragmentsGroup, expressId: number): string {
  const data = model.data.get(expressId);
  const typeId = data?.[1]?.[1];
  if (typeId === undefined) return "IFCPRODUCT";
  return IfcCategoryMap[typeId] ?? `TYPE_${typeId}`;
}

function isSpatialEntity(entity: string): boolean {
  return SPATIAL_ENTITIES.has(entity.toUpperCase());
}

function isElementAssembly(entity: string): boolean {
  return ASSEMBLY_ENTITIES.has(entity.toUpperCase());
}

/** Parts of an IfcElementAssembly (RelAggregates → RelatedObjects), indexer-flattened. */
function assemblyPartIds(
  model: FragmentsGroup,
  indexer: IndexerLike,
  assemblyId: number
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  // Only IsDecomposedBy from the assembly (RelatingObject → RelatedObjects).
  // Do not use Decomposes — that walks upward to the parent.
  const rels = indexer.getEntityRelations(model, assemblyId, "IsDecomposedBy") ?? [];
  for (const id of rels) {
    const n = Number(id);
    if (!Number.isFinite(n) || seen.has(n) || n === assemblyId) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

async function buildNode(
  model: FragmentsGroup,
  indexer: IndexerLike,
  expressId: number,
  path: string
): Promise<IfcModelTreeNode | null> {
  const props = await model.getProperties(expressId);
  if (!props) return null;
  const entity = entityOf(model, expressId);
  const name =
    (props.Name && typeof props.Name === "object" && "value" in props.Name
      ? String((props.Name as { value?: unknown }).value ?? "")
      : "") || entity;

  const childSpatial: IfcModelTreeNode[] = [];
  const typeBuckets = new Map<string, number[]>();
  const bucketed = new Set<number>();

  const pushType = (id: number, ent: string) => {
    if (bucketed.has(id)) return;
    bucketed.add(id);
    const list = typeBuckets.get(ent) ?? [];
    list.push(id);
    typeBuckets.set(ent, list);
  };

  /**
   * Place a non-spatial product into type buckets.
   * ElementAssembly → expand members (Tekla); if none, keep the assembly id.
   */
  const absorbElement = (id: number, depth: number) => {
    const ent = entityOf(model, id);
    if (isSpatialEntity(ent)) return false;

    if (isElementAssembly(ent) && depth < MAX_ASSEMBLY_DEPTH) {
      const parts = assemblyPartIds(model, indexer, id);
      let absorbedPart = false;
      for (const partId of parts) {
        if (partId === id) continue;
        const partEnt = entityOf(model, partId);
        if (isSpatialEntity(partEnt)) continue;
        if (absorbElement(partId, depth + 1)) absorbedPart = true;
      }
      if (absorbedPart) return true;
      // Empty / unresolved assembly: keep visible as its own type
      pushType(id, ent);
      return true;
    }

    pushType(id, ent);
    return true;
  };

  const decomposed =
    indexer.getEntityRelations(model, expressId, "IsDecomposedBy") ?? [];
  for (const id of decomposed) {
    const ent = entityOf(model, id);
    if (isSpatialEntity(ent)) {
      const child = await buildNode(model, indexer, id, `${path}/${id}`);
      if (child) childSpatial.push(child);
    } else {
      absorbElement(id, 0);
    }
  }

  const contained =
    indexer.getEntityRelations(model, expressId, "ContainsElements") ?? [];
  for (const id of contained) {
    const ent = entityOf(model, id);
    if (isSpatialEntity(ent)) {
      const child = await buildNode(model, indexer, id, `${path}/${id}`);
      if (child) childSpatial.push(child);
    } else {
      absorbElement(id, 0);
    }
  }

  const typeChildren: IfcModelTreeNode[] = [];
  const sortedTypes = [...typeBuckets.keys()].sort((a, b) => a.localeCompare(b));
  for (const typeName of sortedTypes) {
    const ids = typeBuckets.get(typeName) ?? [];
    if (ids.length === 0) continue;
    typeChildren.push({
      id: `${path}/type:${typeName}`,
      kind: "typeGroup",
      label: `${typeName} (${ids.length})`,
      entity: typeName,
      expressId: null,
      expressIds: ids,
      children: [],
    });
  }

  const children = [...childSpatial, ...typeChildren];
  const expressIds = children.flatMap((c) => c.expressIds);
  // Spatial node with no geometry children still keeps its own id if it is an element container.
  if (expressIds.length === 0 && !isSpatialEntity(entity)) {
    expressIds.push(expressId);
  }

  return {
    id: `${path}:${expressId}`,
    kind: "spatial",
    label: name,
    entity,
    expressId,
    expressIds,
    children,
  };
}

/** Build Project → … → Storey → IFC type groups for one fragments model. */
export async function buildIfcModelTree(
  model: FragmentsGroup,
  indexer: IndexerLike
): Promise<IfcModelTreeNode[]> {
  // web-ifc schema: IFCPROJECT = 103090709
  const IFCPROJECT = 103090709;
  const projectProps = await model.getAllPropertiesOfType(IFCPROJECT);
  if (!projectProps || Object.keys(projectProps).length === 0) return [];

  const roots: IfcModelTreeNode[] = [];
  for (const key of Object.keys(projectProps)) {
    const entry = projectProps[key] as { expressID?: number };
    const expressId = entry?.expressID ?? Number(key);
    if (!Number.isFinite(expressId)) continue;
    const node = await buildNode(model, indexer, expressId, `p${expressId}`);
    if (node) roots.push(node);
  }
  return roots;
}

export function fragmentMapForExpressIds(
  model: FragmentsGroup,
  expressIds: number[]
): FragmentIdMap {
  if (!expressIds.length) return {};
  return model.getFragmentMap(expressIds) as FragmentIdMap;
}

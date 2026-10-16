/**
 * Costa named groups — session + localStorage (v3 buckets by IFC fingerprint).
 *
 * Runtime (Select / Isolate / Save): expressIds + FragmentIdMap — unchanged.
 * Portable document (v2 per bucket): globalId per member; expressId is a hint only.
 * MCP session tools: getCostaGroupsDocument() returns name + expressIds for active IFC only.
 */

import type { FragmentsGroup } from "@thatopen/fragments";
import type { FragmentIdMap } from "./boxSelection";
import {
  cloneFragmentIdMap,
  countFragmentIdMap,
  getExpressIdsFromFragmentIdMap,
} from "./ifcElementQuery";
import { fragmentMapForExpressIds } from "./ifcModelTree";
import {
  resolveBucketIfcFileNameForFingerprint,
  sha256HexFromString,
  shortIfcFingerprint,
} from "./costaGroupsFingerprint";

export { resolveBucketIfcFileNameForFingerprint } from "./costaGroupsFingerprint";
import {
  COSTA_GROUPS_DOC_VERSION,
  COSTA_GROUPS_DOC_VERSION_V1,
  COSTA_GROUPS_STORAGE_KEY,
  COSTA_GROUPS_STORAGE_KEY_V3,
  costaGroupsFileNameForIfc,
  emptyCostaGroupsStoreV3,
  normalizeMembers,
  parseCostaGroupsDocument,
  parseCostaGroupsStoreV3,
  toCostaGroupsDocumentV1,
  toCostaGroupsDocumentV2,
  uniqueExpressIds,
  type CostaGroupMemberRecord,
  type CostaGroupRecord,
  type CostaGroupsBucketRecord,
  type CostaGroupsDocument,
  type CostaGroupsDocumentNormalized,
  type CostaGroupsDocumentSource,
  type CostaGroupsDocumentV2,
  type CostaGroupsDocumentV3,
} from "./costaGroupsDocument";

export {
  COSTA_GROUPS_DOC_VERSION,
  COSTA_GROUPS_DOC_VERSION_V1,
  COSTA_GROUPS_STORAGE_KEY,
  COSTA_GROUPS_STORAGE_KEY_V3,
  costaGroupsFileNameForIfc,
  parseCostaGroupsDocument,
  toCostaGroupsDocumentV1,
  toCostaGroupsDocumentV2,
  type CostaGroupMemberRecord,
  type CostaGroupRecord,
  type CostaGroupsDocument,
  type CostaGroupsDocumentNormalized,
  type CostaGroupsDocumentSource,
  type CostaGroupsDocumentV2,
};

export type CostaGroupsBucketSummary = {
  fingerprint: string;
  fingerprintShort: string;
  groupCount: number;
  ifcFileName: string | null;
  updatedAt: number;
  active: boolean;
};

export type CostaGroupsBucketMeta = {
  activeFingerprint: string | null;
  activeFingerprintShort: string | null;
  activeGroupCount: number;
  bucketCount: number;
  buckets: CostaGroupsBucketSummary[];
};

/** @deprecated Prefer toCostaGroupsDocumentV1 — kept for existing imports. */
export const toCostaGroupsDocument = toCostaGroupsDocumentV1;

/** Kill-switch: set false to disable localStorage (RAM only). */
export const COSTA_GROUPS_LOCAL_STORAGE = true;

export type StoreyGroupInfo = {
  name: string;
  expressId: number | null;
  map: FragmentIdMap;
  elementCount: number;
};

export type CostaNamedGroup = {
  id: string;
  name: string;
  /** Runtime selection map (rebuilt after model load). */
  map: FragmentIdMap;
  /** Session IDs for Select / Isolate / MCP. */
  expressIds: number[];
  /** Portable members (GUID). Empty until enriched from IFC or loaded from v2. */
  members: CostaGroupMemberRecord[];
  elementCount: number;
  createdAt: number;
  /** GlobalIds that did not resolve in the current model (partial group). */
  unresolvedGlobalIds?: string[];
};

export type CostaGroupsRebindReport = {
  reboundGroups: number;
  resolvedMembers: number;
  unresolvedMembers: number;
  warnings: string[];
};

/** Normalize classifier map (Sets or number arrays) to FragmentIdMap. */
export function toFragmentIdMap(
  map: Record<string, Set<number> | number[]> | undefined | null
): FragmentIdMap {
  const out: FragmentIdMap = {};
  if (!map) return out;
  for (const fragId of Object.keys(map)) {
    const ids = map[fragId];
    if (!ids) continue;
    out[fragId] = ids instanceof Set ? new Set(ids) : new Set(ids);
  }
  return out;
}

/**
 * Read storeys classified under system "storeys"
 * (from classifier.bySpatialStructure with isolate IFCBUILDINGSTOREY).
 */
export function listStoreyGroups(classifierList: {
  storeys?: Record<
    string,
    { map: Record<string, Set<number> | number[]>; name: string; id: number | null }
  >;
}): StoreyGroupInfo[] {
  const system = classifierList.storeys;
  if (!system) return [];
  const rows: StoreyGroupInfo[] = [];
  for (const key of Object.keys(system)) {
    const group = system[key];
    if (!group) continue;
    const map = toFragmentIdMap(group.map);
    const elementCount = countFragmentIdMap(map);
    if (elementCount === 0) continue;
    rows.push({
      name: group.name || key,
      expressId: group.id,
      map,
      elementCount,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return rows;
}

function recordsToNamedGroups(
  records: CostaGroupsDocumentNormalized["groups"]
): CostaNamedGroup[] {
  return records.map((g) => {
    const expressIds = uniqueExpressIds(g.expressIds);
    const members = normalizeMembers(g.members);
    return {
      id: g.id,
      name: g.name,
      expressIds,
      members,
      map: {},
      elementCount: members.length || expressIds.length,
      createdAt: Date.now(),
    };
  });
}

function getIfcFileNameHint(): string | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { ifcFilename?: string; __costaIfcDisplayName?: string };
  for (const raw of [w.ifcFilename, w.__costaIfcDisplayName]) {
    const name = String(raw ?? "").trim();
    if (name) return name;
  }
  return null;
}

function resolveBucketIfcFileName(fingerprint: string): string {
  const existing = groupsStoreV3.buckets[fingerprint]?.source?.ifcFileName;
  return resolveBucketIfcFileNameForFingerprint(fingerprint, existing, getIfcFileNameHint());
}

function bucketSourceForFingerprint(fingerprint: string): CostaGroupsDocumentSource {
  return {
    ifcFileName: resolveBucketIfcFileName(fingerprint),
    ifcFingerprint: fingerprint,
  };
}

function groupHasPortableMembers(g: CostaNamedGroup): boolean {
  return normalizeMembers(g.members).length > 0;
}

function canPersistAsV2(): boolean {
  if (namedGroups.length === 0) return true;
  return namedGroups.every(groupHasPortableMembers);
}

const LEGACY_UNSCOPED_BUCKET = "__legacy-unscoped__";

let activeFingerprint: string | null = null;
let groupsStoreV3: CostaGroupsDocumentV3 = emptyCostaGroupsStoreV3();
let namedGroups: CostaNamedGroup[] = [];

function syncActiveFingerprintWindow(): void {
  if (typeof window === "undefined") return;
  (window as unknown as { __costaActiveIfcFingerprint?: string | null }).__costaActiveIfcFingerprint =
    activeFingerprint;
}

function readGroupsStoreV3(): CostaGroupsDocumentV3 {
  if (!COSTA_GROUPS_LOCAL_STORAGE || typeof localStorage === "undefined") {
    return emptyCostaGroupsStoreV3();
  }
  try {
    const rawV3 = localStorage.getItem(COSTA_GROUPS_STORAGE_KEY_V3);
    if (rawV3) {
      const parsed = parseCostaGroupsStoreV3(JSON.parse(rawV3));
      if (parsed) return parsed;
    }
    migrateLegacyGroupsStoreV1();
    const rawAfter = localStorage.getItem(COSTA_GROUPS_STORAGE_KEY_V3);
    if (!rawAfter) return emptyCostaGroupsStoreV3();
    return parseCostaGroupsStoreV3(JSON.parse(rawAfter)) ?? emptyCostaGroupsStoreV3();
  } catch {
    return emptyCostaGroupsStoreV3();
  }
}

function writeGroupsStoreV3(): void {
  if (!COSTA_GROUPS_LOCAL_STORAGE || typeof localStorage === "undefined") return;
  try {
    groupsStoreV3.updatedAt = Date.now();
    localStorage.setItem(COSTA_GROUPS_STORAGE_KEY_V3, JSON.stringify(groupsStoreV3));
  } catch {
    /* quota / private mode */
  }
}

function migrateLegacyGroupsStoreV1(): void {
  if (!COSTA_GROUPS_LOCAL_STORAGE || typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(COSTA_GROUPS_STORAGE_KEY);
    if (!raw) return;
    const doc = parseCostaGroupsDocument(JSON.parse(raw));
    if (!doc || doc.groups.length === 0) return;

    const portable = toCostaGroupsDocumentV2(
      doc.groups.map((g) => ({
        id: g.id,
        name: g.name,
        members: normalizeMembers(g.members),
      })),
      doc.source ?? {
        ifcFileName: getIfcFileNameHint(),
        ifcFingerprint: LEGACY_UNSCOPED_BUCKET,
      }
    );
    if (portable.groups.length === 0) return;

    const legacyFp =
      String(doc.source?.ifcFingerprint ?? "").trim() || LEGACY_UNSCOPED_BUCKET;
    const store = emptyCostaGroupsStoreV3();
    store.buckets[legacyFp] = {
      version: 2,
      updatedAt: doc.updatedAt,
      source: {
        ifcFileName: doc.source?.ifcFileName ?? getIfcFileNameHint(),
        ifcFingerprint: legacyFp,
      },
      groups: portable.groups,
    };
    localStorage.setItem(COSTA_GROUPS_STORAGE_KEY_V3, JSON.stringify(store));
  } catch {
    /* corrupt legacy */
  }
}

function loadActiveBucketIntoMemory(): void {
  if (!activeFingerprint) {
    namedGroups = [];
    return;
  }
  const bucket = groupsStoreV3.buckets[activeFingerprint];
  if (!bucket || bucket.groups.length === 0) {
    namedGroups = [];
    return;
  }
  const normalized: CostaGroupsDocumentNormalized["groups"] = bucket.groups.map((g) => {
    const members = normalizeMembers(g.members);
    const expressIds = uniqueExpressIds(
      members
        .map((m) => m.expressId)
        .filter((n): n is number => n !== undefined && n !== null && Number.isFinite(Number(n)))
        .map(Number)
    );
    return { id: g.id, name: g.name, expressIds, members };
  });
  namedGroups = recordsToNamedGroups(normalized);
}

function persistNamedGroups(): void {
  if (!COSTA_GROUPS_LOCAL_STORAGE || typeof localStorage === "undefined") return;
  if (!activeFingerprint) return;

  groupsStoreV3 = readGroupsStoreV3();

  if (namedGroups.length === 0) {
    delete groupsStoreV3.buckets[activeFingerprint];
    writeGroupsStoreV3();
  } else if (canPersistAsV2()) {
    const portable = toCostaGroupsDocumentV2(
      namedGroups.map((g) => ({
        id: g.id,
        name: g.name,
        members: normalizeMembers(g.members),
      })),
      bucketSourceForFingerprint(activeFingerprint)
    );
    groupsStoreV3.buckets[activeFingerprint] = {
      version: 2,
      updatedAt: Date.now(),
      source: bucketSourceForFingerprint(activeFingerprint),
      groups: portable.groups,
    };
    writeGroupsStoreV3();
  } else {
    const sessionGroups: CostaGroupsBucketRecord["groups"] = namedGroups
      .map((g) => {
        const expressIds = uniqueExpressIds(
          g.expressIds?.length ? g.expressIds : getExpressIdsFromFragmentIdMap(g.map)
        );
        if (expressIds.length === 0) return null;
        return {
          id: g.id,
          name: g.name,
          members: expressIds.map((expressId) => ({
            globalId: `_express_${expressId}`,
            expressId,
          })),
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
    if (sessionGroups.length > 0) {
      groupsStoreV3.buckets[activeFingerprint] = {
        version: 2,
        updatedAt: Date.now(),
        source: bucketSourceForFingerprint(activeFingerprint),
        groups: sessionGroups,
      };
      writeGroupsStoreV3();
    }
  }

  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("costa-named-groups-changed"));
    }
  } catch {
    /* noop */
  }
}

groupsStoreV3 = readGroupsStoreV3();

export function getActiveIfcFingerprint(): string | null {
  return activeFingerprint;
}

export function getCostaGroupsBucketMeta(): CostaGroupsBucketMeta {
  const store = readGroupsStoreV3();
  const buckets = Object.entries(store.buckets).map(([fingerprint, bucket]) => ({
    fingerprint,
    fingerprintShort: shortIfcFingerprint(fingerprint) ?? fingerprint,
    groupCount: bucket.groups.length,
    ifcFileName: resolveBucketIfcFileNameForFingerprint(
      fingerprint,
      bucket.source?.ifcFileName,
      getIfcFileNameHint()
    ),
    updatedAt: bucket.updatedAt,
    active: fingerprint === activeFingerprint,
  }));
  buckets.sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    activeFingerprint,
    activeFingerprintShort: shortIfcFingerprint(activeFingerprint),
    activeGroupCount: namedGroups.length,
    bucketCount: buckets.length,
    buckets,
  };
}

/**
 * Switch in-memory groups to the bucket for the loaded IFC (by content fingerprint).
 * Call before rebind on every model load.
 */
export async function activateCostaGroupsBucketForModel(
  model: FragmentsGroup
): Promise<{ fingerprint: string; groupCount: number; switched: boolean }> {
  const fingerprint = await computeIfcFingerprintFromModel(model);
  const switched = fingerprint !== activeFingerprint;
  activeFingerprint = fingerprint;
  syncActiveFingerprintWindow();
  groupsStoreV3 = readGroupsStoreV3();
  loadActiveBucketIntoMemory();
  const bucket = groupsStoreV3.buckets[fingerprint];
  if (bucket) {
    const nextSource = bucketSourceForFingerprint(fingerprint);
    const prevName = String(bucket.source?.ifcFileName ?? "").trim();
    if (!prevName || prevName === "mcp-loaded-model.ifc") {
      bucket.source = nextSource;
      writeGroupsStoreV3();
    }
  }
  return { fingerprint, groupCount: namedGroups.length, switched };
}

export function listNamedGroups(): CostaNamedGroup[] {
  return namedGroups.slice();
}

/**
 * Session document for MCP / UI tools — always name + expressIds.
 * Does not replace the portable v2 file format.
 */
export function getCostaGroupsDocument(): CostaGroupsDocument {
  return toCostaGroupsDocumentV1(
    namedGroups.map((g) => ({
      id: g.id,
      name: g.name,
      expressIds: g.expressIds?.length
        ? g.expressIds
        : getExpressIdsFromFragmentIdMap(g.map),
    }))
  );
}

/** Portable v2 document (GUID members). Empty members groups are omitted. */
export function getCostaGroupsPortableDocument(
  source?: CostaGroupsDocumentSource
): CostaGroupsDocumentV2 {
  return toCostaGroupsDocumentV2(
    namedGroups
      .filter(groupHasPortableMembers)
      .map((g) => ({
        id: g.id,
        name: g.name,
        members: normalizeMembers(g.members),
      })),
    source ??
      (activeFingerprint
        ? bucketSourceForFingerprint(activeFingerprint)
        : { ifcFileName: getIfcFileNameHint(), ifcFingerprint: null })
  );
}

/** Notify bucket layer when IFC display name becomes known (MCP filename message). */
export function refreshCostaGroupsBucketIfcFileName(): void {
  if (!activeFingerprint || !COSTA_GROUPS_LOCAL_STORAGE) return;
  groupsStoreV3 = readGroupsStoreV3();
  const bucket = groupsStoreV3.buckets[activeFingerprint];
  if (!bucket) return;
  const next = bucketSourceForFingerprint(activeFingerprint);
  const prev = String(bucket.source?.ifcFileName ?? "").trim();
  const nextName = String(next.ifcFileName ?? "").trim();
  if (!nextName || nextName === prev) return;
  if (prev && prev !== "mcp-loaded-model.ifc" && nextName.startsWith("ifc-")) return;
  bucket.source = next;
  writeGroupsStoreV3();
}

function isSessionExpressMember(globalId: string): boolean {
  return String(globalId ?? "").startsWith("_express_");
}

async function readGlobalIdForExpressId(
  model: FragmentsGroup,
  expressId: number
): Promise<string | null> {
  try {
    const props = (await model.getProperties(expressId)) as {
      GlobalId?: { value?: string };
    } | null;
    const gid = props?.GlobalId?.value;
    if (gid === undefined || gid === null) return null;
    const trimmed = String(gid).trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

/** Build GlobalId → expressId index for the loaded model (one pass). */
export async function buildGlobalIdToExpressIdMap(
  model: FragmentsGroup
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const keys =
    model.data && typeof (model.data as Map<number, unknown>).keys === "function"
      ? [...(model.data as Map<number, unknown>).keys()]
      : [];
  for (const expressId of keys) {
    const id = Number(expressId);
    if (!Number.isFinite(id)) continue;
    const gid = await readGlobalIdForExpressId(model, id);
    if (gid) out.set(gid, id);
  }
  return out;
}

/** Stable fingerprint: sha256(sorted GlobalIds). */
export async function computeIfcFingerprintFromModel(
  model: FragmentsGroup
): Promise<string> {
  const guidIndex = await buildGlobalIdToExpressIdMap(model);
  const globalIds = [...guidIndex.keys()].sort();
  if (globalIds.length === 0) {
    const keys =
      model.data && typeof (model.data as Map<number, unknown>).keys === "function"
        ? [...(model.data as Map<number, unknown>).keys()]
            .map(Number)
            .filter((n) => Number.isFinite(n))
            .sort((a, b) => a - b)
        : [];
    return sha256HexFromString(`weak-express:${keys.length}:${keys.slice(0, 64).join(",")}`);
  }
  return sha256HexFromString(globalIds.join("\n"));
}

/** Fill / refresh GUID members from current expressIds (save / before export). Active bucket only. */
export async function enrichNamedGroupsWithGlobalIds(
  model: FragmentsGroup
): Promise<{ enriched: number; missingGuid: number }> {
  let enriched = 0;
  let missingGuid = 0;
  namedGroups = await Promise.all(
    namedGroups.map(async (g) => {
      const ids = uniqueExpressIds(
        g.expressIds?.length ? g.expressIds : getExpressIdsFromFragmentIdMap(g.map)
      );
      const existingMembers = normalizeMembers(g.members);
      if (ids.length === 0 && existingMembers.length > 0) {
        return g;
      }
      const members: CostaGroupMemberRecord[] = [];
      for (const expressId of ids) {
        const globalId = await readGlobalIdForExpressId(model, expressId);
        if (!globalId) {
          missingGuid += 1;
          continue;
        }
        members.push({ globalId, expressId });
        enriched += 1;
      }
      return {
        ...g,
        expressIds: ids,
        members: normalizeMembers(members.length > 0 ? members : existingMembers),
        elementCount: ids.length || existingMembers.length,
      };
    })
  );
  persistNamedGroups();
  return { enriched, missingGuid };
}

export function saveNamedGroup(name: string, map: FragmentIdMap): CostaNamedGroup | null {
  const trimmed = name.trim();
  const expressIds = uniqueExpressIds(getExpressIdsFromFragmentIdMap(map));
  const elementCount = expressIds.length;
  if (!trimmed || elementCount === 0) return null;
  const group: CostaNamedGroup = {
    id: `cg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    map: cloneFragmentIdMap(map),
    expressIds,
    members: [],
    elementCount,
    createdAt: Date.now(),
  };
  namedGroups = [...namedGroups, group];
  persistNamedGroups();
  return group;
}

export type CreateNamedGroupResult =
  | { ok: true; group: CostaNamedGroup; unresolvedIds?: number[] }
  | { ok: false; error: string };

/** Create a Costa group from expressIds (MCP / automation). Fails if name already exists. */
export function createNamedGroupFromExpressIds(
  name: string,
  expressIds: number[],
  model?: FragmentsGroup | null
): CreateNamedGroupResult {
  const trimmed = name.trim();
  const ids = uniqueExpressIds(expressIds);
  if (!trimmed) return { ok: false, error: "Group name is required." };
  if (ids.length === 0) {
    return { ok: false, error: "expressIds must contain at least one id." };
  }
  if (namedGroups.some((g) => g.name === trimmed)) {
    return {
      ok: false,
      error: `A Costa group named "${trimmed}" already exists. Use update instead.`,
    };
  }

  let map: FragmentIdMap = {};
  const unresolvedIds: number[] = [];
  if (model) {
    map = fragmentMapForExpressIds(model, ids);
    const resolvedSet = new Set(getExpressIdsFromFragmentIdMap(map));
    for (const id of ids) {
      if (!resolvedSet.has(id)) unresolvedIds.push(id);
    }
  }

  // memberCount / MCP contract = expressIds.length (map may hold more fragment indices).
  const elementCount = ids.length;
  const group: CostaNamedGroup = {
    id: `cg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    map: cloneFragmentIdMap(map),
    expressIds: ids,
    members: [],
    elementCount,
    createdAt: Date.now(),
  };
  namedGroups = [...namedGroups, group];
  persistNamedGroups();
  return {
    ok: true,
    group,
    unresolvedIds: unresolvedIds.length ? unresolvedIds : undefined,
  };
}

export type UpdateNamedGroupResult =
  | { ok: true; group: CostaNamedGroup; unresolvedIds?: number[] }
  | { ok: false; error: string };

function findNamedGroupIndex(groupId?: string, groupName?: string): number {
  const id = groupId?.trim();
  const name = groupName?.trim();
  if (id) return namedGroups.findIndex((g) => g.id === id);
  if (name) return namedGroups.findIndex((g) => g.name === name);
  return -1;
}

/** Update an existing Costa group by id or exact name (MCP / automation). */
export function updateNamedGroup(
  ref: { groupId?: string; groupName?: string },
  patch: { name?: string; expressIds?: number[] },
  model?: FragmentsGroup | null
): UpdateNamedGroupResult {
  const id = ref.groupId?.trim();
  const refName = ref.groupName?.trim();
  if (!id && !refName) {
    return { ok: false, error: "Provide groupId or groupName." };
  }

  const idx = findNamedGroupIndex(id, refName);
  if (idx < 0) {
    return {
      ok: false,
      error: id ? `No Costa group with id "${id}".` : `No Costa group named "${refName}".`,
    };
  }

  const nextName = patch.name !== undefined ? patch.name.trim() : namedGroups[idx].name;
  const nextIds =
    patch.expressIds !== undefined
      ? uniqueExpressIds(patch.expressIds)
      : uniqueExpressIds(namedGroups[idx].expressIds);

  if (!nextName) return { ok: false, error: "Group name cannot be empty." };
  if (nextIds.length === 0) {
    return { ok: false, error: "expressIds must contain at least one id." };
  }

  const duplicateName = namedGroups.some((g, i) => i !== idx && g.name === nextName);
  if (duplicateName) {
    return { ok: false, error: `Another Costa group is already named "${nextName}".` };
  }

  let map: FragmentIdMap = {};
  const unresolvedIds: number[] = [];
  if (model) {
    map = fragmentMapForExpressIds(model, nextIds);
    const resolvedSet = new Set(getExpressIdsFromFragmentIdMap(map));
    for (const expressId of nextIds) {
      if (!resolvedSet.has(expressId)) unresolvedIds.push(expressId);
    }
  } else if (patch.expressIds === undefined) {
    map = cloneFragmentIdMap(namedGroups[idx].map);
  }

  const elementCount = model ? countFragmentIdMap(map) || nextIds.length : nextIds.length;
  const group: CostaNamedGroup = {
    ...namedGroups[idx],
    name: nextName,
    expressIds: nextIds,
    // expressIds changed → portable members must be re-enriched
    members: patch.expressIds !== undefined ? [] : namedGroups[idx].members,
    map: cloneFragmentIdMap(map),
    elementCount,
    unresolvedGlobalIds: undefined,
  };
  namedGroups = namedGroups.map((g, i) => (i === idx ? group : g));
  persistNamedGroups();
  return {
    ok: true,
    group,
    unresolvedIds: unresolvedIds.length ? unresolvedIds : undefined,
  };
}

export function removeNamedGroup(id: string): boolean {
  const before = namedGroups.length;
  namedGroups = namedGroups.filter((g) => g.id !== id);
  if (namedGroups.length < before) persistNamedGroups();
  return namedGroups.length < before;
}

export function clearNamedGroups(options?: { persist?: boolean }): void {
  namedGroups = [];
  if (options?.persist === false) return;
  persistNamedGroups();
}

/**
 * Rebuild maps after IFC load.
 * Prefer GlobalId when members exist; else expressIds (v1 / same-file session).
 * Partial groups kept; unresolved GUIDs reported.
 */
export async function rebindNamedGroupMaps(
  model: FragmentsGroup
): Promise<CostaGroupsRebindReport> {
  const warnings: string[] = [];
  let reboundGroups = 0;
  let resolvedMembers = 0;
  let unresolvedMembers = 0;

  const beforeSnapshot = namedGroups.map((g) => ({
    id: g.id,
    expressIdCount: uniqueExpressIds(g.expressIds).length,
    memberCount: normalizeMembers(g.members).length,
  }));

  const needsGuidIndex = namedGroups.some((g) => normalizeMembers(g.members).length > 0);
  const guidIndex = needsGuidIndex
    ? await buildGlobalIdToExpressIdMap(model)
    : new Map<string, number>();

  const nextGroups: CostaNamedGroup[] = [];
  for (const g of namedGroups) {
    const portable = normalizeMembers(g.members);
    if (portable.length > 0) {
      const sessionOnly = portable.every((m) => isSessionExpressMember(m.globalId));
      const resolvedIds: number[] = [];
      const unresolvedGlobalIds: string[] = [];
      const nextMembers: CostaGroupMemberRecord[] = [];
      for (const m of portable) {
        let expressId: number | undefined;
        if (sessionOnly && m.expressId != null && Number.isFinite(Number(m.expressId))) {
          expressId = Number(m.expressId);
        } else {
          expressId = guidIndex.get(m.globalId);
        }
        if (expressId === undefined) {
          unresolvedGlobalIds.push(m.globalId);
          unresolvedMembers += 1;
          nextMembers.push({ globalId: m.globalId, expressId: m.expressId ?? null });
          continue;
        }
        const mapProbe = fragmentMapForExpressIds(model, [expressId]);
        if (countFragmentIdMap(mapProbe) === 0 && !sessionOnly) {
          unresolvedGlobalIds.push(m.globalId);
          unresolvedMembers += 1;
          nextMembers.push({ globalId: m.globalId, expressId: null });
          continue;
        }
        resolvedIds.push(expressId);
        resolvedMembers += 1;
        const realGuid =
          sessionOnly || isSessionExpressMember(m.globalId)
            ? (await readGlobalIdForExpressId(model, expressId)) ?? m.globalId
            : m.globalId;
        nextMembers.push({ globalId: realGuid, expressId });
      }
      const uniqueResolved = uniqueExpressIds(resolvedIds);
      const prior = beforeSnapshot.find((s) => s.id === g.id);
      if (
        prior &&
        prior.memberCount > 0 &&
        uniqueResolved.length === 0 &&
        !sessionOnly
      ) {
        warnings.push(
          `"${g.name}": rebind would empty group — kept stored members (no persist).`
        );
        nextGroups.push(g);
        continue;
      }
      const map = fragmentMapForExpressIds(model, uniqueResolved);
      const elementCount = countFragmentIdMap(map);
      if (elementCount > 0) reboundGroups += 1;
      if (unresolvedGlobalIds.length > 0) {
        warnings.push(
          `"${g.name}": ${uniqueResolved.length}/${portable.length} members resolved (${unresolvedGlobalIds.length} missing in model).`
        );
      }
      nextGroups.push({
        ...g,
        expressIds: uniqueResolved,
        members: nextMembers,
        map,
        elementCount: elementCount || uniqueResolved.length,
        unresolvedGlobalIds: unresolvedGlobalIds.length ? unresolvedGlobalIds : undefined,
      });
      continue;
    }

    // v1 / not yet enriched: expressId path + fill GUIDs when possible
    const ids = uniqueExpressIds(
      g.expressIds?.length ? g.expressIds : getExpressIdsFromFragmentIdMap(g.map)
    );
    const map = fragmentMapForExpressIds(model, ids);
    const elementCount = countFragmentIdMap(map);
    if (elementCount > 0) reboundGroups += 1;

    const members: CostaGroupMemberRecord[] = [];
    for (const expressId of ids) {
      const globalId = await readGlobalIdForExpressId(model, expressId);
      if (globalId) {
        members.push({ globalId, expressId });
        resolvedMembers += 1;
      } else {
        unresolvedMembers += 1;
      }
    }

    nextGroups.push({
      ...g,
      expressIds: ids,
      members: normalizeMembers(members),
      map,
      elementCount: elementCount || ids.length,
      unresolvedGlobalIds: undefined,
    });
  }

  namedGroups = nextGroups;
  persistNamedGroups();
  return { reboundGroups, resolvedMembers, unresolvedMembers, warnings };
}

export type ImportCostaGroupsResult =
  | {
      ok: true;
      groupCount: number;
      version: 1 | 2;
      warnings: string[];
    }
  | { ok: false; error: string };

/** Replace in-memory + localStorage groups from a parsed JSON document (v1 or v2). */
export function importCostaGroupsDocument(raw: unknown): ImportCostaGroupsResult {
  const doc = parseCostaGroupsDocument(raw);
  if (!doc) {
    return { ok: false, error: "Invalid Costa groups document (expected version 1 or 2)." };
  }
  if (doc.groups.length === 0) {
    return { ok: false, error: "Document has no valid groups." };
  }
  namedGroups = recordsToNamedGroups(doc.groups);
  persistNamedGroups();
  const warnings: string[] = [];
  if (doc.version === 1) {
    warnings.push("Imported v1 (expressIds). Load IFC to enrich GlobalIds and persist as v2.");
  }
  return { ok: true, groupCount: namedGroups.length, version: doc.version, warnings };
}

export type ExportCostaGroupsResult =
  | { ok: true; document: CostaGroupsDocumentV2; fileName: string; json: string }
  | { ok: false; error: string };

/**
 * Build portable v2 JSON for download. Requires GUID members
 * (call enrichNamedGroupsWithGlobalIds / rebind first if needed).
 */
export function exportCostaGroupsPortableJson(
  ifcFileName?: string | null
): ExportCostaGroupsResult {
  if (namedGroups.length === 0) {
    return { ok: false, error: "No Costa groups to export." };
  }
  if (!canPersistAsV2()) {
    return {
      ok: false,
      error:
        "Groups are not GUID-enriched yet. Load the IFC (or wait for rebind) and try again.",
    };
  }
  const fileHint = ifcFileName?.trim() || getIfcFileNameHint();
  const document = getCostaGroupsPortableDocument({
    ifcFileName: fileHint,
    ifcFingerprint: activeFingerprint,
  });
  if (document.groups.length === 0) {
    return { ok: false, error: "No portable groups with GlobalId members." };
  }
  const fileName = costaGroupsFileNameForIfc(fileHint);
  return {
    ok: true,
    document,
    fileName,
    json: JSON.stringify(document, null, 2),
  };
}

export function downloadCostaGroupsPortableFile(ifcFileName?: string | null): ExportCostaGroupsResult {
  const result = exportCostaGroupsPortableJson(ifcFileName);
  if (!result.ok) return result;
  try {
    const blob = new Blob([result.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return result;
}

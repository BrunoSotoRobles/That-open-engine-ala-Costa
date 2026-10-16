/**
 * Canonical Costa groups document (UI = Claude session = localStorage = *.costa-groups.json).
 * Pure JSON helpers — no IFC / Fragments imports.
 *
 * v1: { version:1, groups:[{ id, name, expressIds }] }  — session / legacy
 * v2: { version:2, groups:[{ id, name, members:[{ globalId, expressId? }] }] } — portable per IFC
 * v3: { version:3, buckets:{ [ifcFingerprint]: v2 payload } } — multi-IFC localStorage
 */

export const COSTA_GROUPS_DOC_VERSION_V1 = 1 as const;
export const COSTA_GROUPS_DOC_VERSION_V2 = 2 as const;
export const COSTA_GROUPS_DOC_VERSION_V3 = 3 as const;
/** Current portable write version. */
export const COSTA_GROUPS_DOC_VERSION = COSTA_GROUPS_DOC_VERSION_V2;
/** Legacy single-bucket key (v1/v2). Migrated once into v3. */
export const COSTA_GROUPS_STORAGE_KEY = "costa.namedGroups.v1";
/** Multi-IFC bucket store. */
export const COSTA_GROUPS_STORAGE_KEY_V3 = "costa.namedGroups.v3";

/** Session / MCP record (expressIds). Runtime tools keep using this. */
export type CostaGroupRecord = {
  id: string;
  name: string;
  expressIds: number[];
};

export type CostaGroupsDocumentV1 = {
  version: typeof COSTA_GROUPS_DOC_VERSION_V1;
  updatedAt: number;
  groups: CostaGroupRecord[];
};

/** Portable member — globalId is canonical; expressId is a session hint only. */
export type CostaGroupMemberRecord = {
  globalId: string;
  expressId?: number | null;
};

export type CostaGroupRecordV2 = {
  id: string;
  name: string;
  members: CostaGroupMemberRecord[];
};

export type CostaGroupsDocumentSource = {
  ifcFileName?: string | null;
  ifcFingerprint?: string | null;
};

export type CostaGroupsDocumentV2 = {
  version: typeof COSTA_GROUPS_DOC_VERSION_V2;
  updatedAt: number;
  source?: CostaGroupsDocumentSource;
  groups: CostaGroupRecordV2[];
};

/** One IFC bucket inside the v3 store (portable v2 payload). */
export type CostaGroupsBucketRecord = {
  version: typeof COSTA_GROUPS_DOC_VERSION_V2;
  updatedAt: number;
  source?: CostaGroupsDocumentSource;
  groups: CostaGroupRecordV2[];
};

export type CostaGroupsDocumentV3 = {
  version: typeof COSTA_GROUPS_DOC_VERSION_V3;
  updatedAt: number;
  buckets: Record<string, CostaGroupsBucketRecord>;
};

/** @deprecated Alias — prefer CostaGroupsDocumentV1 for session MCP payloads. */
export type CostaGroupsDocument = CostaGroupsDocumentV1;

/** Normalized in-memory shape after parse (v1 or v2). */
export type CostaGroupRecordNormalized = {
  id: string;
  name: string;
  expressIds: number[];
  members: CostaGroupMemberRecord[];
};

export type CostaGroupsDocumentNormalized = {
  version: 1 | 2;
  updatedAt: number;
  source?: CostaGroupsDocumentSource;
  groups: CostaGroupRecordNormalized[];
};

export function uniqueExpressIds(ids: number[]): number[] {
  return [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isFinite(n)))];
}

export function uniqueGlobalIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const g = String(raw ?? "").trim();
    if (!g || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}

export function normalizeMembers(members: CostaGroupMemberRecord[]): CostaGroupMemberRecord[] {
  const seen = new Set<string>();
  const out: CostaGroupMemberRecord[] = [];
  for (const m of members) {
    const globalId = String(m?.globalId ?? "").trim();
    if (!globalId || seen.has(globalId)) continue;
    seen.add(globalId);
    const expressHint = m.expressId;
    const expressId =
      expressHint === undefined || expressHint === null
        ? null
        : Number.isFinite(Number(expressHint))
          ? Number(expressHint)
          : null;
    out.push({ globalId, expressId });
  }
  return out;
}

/** `edificio.ifc` → `edificio.costa-groups.json` */
export function costaGroupsFileNameForIfc(ifcFileName?: string | null): string {
  const raw = String(ifcFileName ?? "").trim() || "model.ifc";
  const base = raw.replace(/[\\/]+/g, "/").split("/").pop() || "model.ifc";
  const stem = base.replace(/\.ifc$/i, "").replace(/[?#].*$/, "") || "model";
  const safe = stem.replace(/[\\/:*?"<>|]+/g, "_").trim() || "model";
  return `${safe}.costa-groups.json`;
}

export function toCostaGroupsDocumentV1(
  groups: Array<{ id: string; name: string; expressIds: number[] }>
): CostaGroupsDocumentV1 {
  return {
    version: COSTA_GROUPS_DOC_VERSION_V1,
    updatedAt: Date.now(),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      expressIds: uniqueExpressIds(g.expressIds),
    })),
  };
}

/** @deprecated Use toCostaGroupsDocumentV1 for MCP session payloads. */
export function toCostaGroupsDocument(
  groups: Array<{ id: string; name: string; expressIds: number[] }>
): CostaGroupsDocumentV1 {
  return toCostaGroupsDocumentV1(groups);
}

export function toCostaGroupsDocumentV2(
  groups: Array<{ id: string; name: string; members: CostaGroupMemberRecord[] }>,
  source?: CostaGroupsDocumentSource
): CostaGroupsDocumentV2 {
  return {
    version: COSTA_GROUPS_DOC_VERSION_V2,
    updatedAt: Date.now(),
    source: source
      ? {
          ifcFileName: source.ifcFileName ?? null,
          ifcFingerprint: source.ifcFingerprint ?? null,
        }
      : undefined,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      members: normalizeMembers(g.members),
    })),
  };
}

export function parseCostaGroupsDocument(raw: unknown): CostaGroupsDocumentNormalized | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;
  const version = doc.version;
  if (version !== COSTA_GROUPS_DOC_VERSION_V1 && version !== COSTA_GROUPS_DOC_VERSION_V2) {
    return null;
  }
  if (!Array.isArray(doc.groups)) return null;

  const groups: CostaGroupRecordNormalized[] = [];

  for (const g of doc.groups as unknown[]) {
    if (!g || typeof g !== "object") continue;
    const row = g as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    const id = String(row.id ?? "").trim();
    if (!name || !id) continue;

    if (version === COSTA_GROUPS_DOC_VERSION_V2) {
      const members = normalizeMembers(
        Array.isArray(row.members) ? (row.members as CostaGroupMemberRecord[]) : []
      );
      if (members.length === 0) continue;
      const expressIds = uniqueExpressIds(
        members
          .map((m) => m.expressId)
          .filter((n): n is number => n !== undefined && n !== null && Number.isFinite(Number(n)))
          .map(Number)
      );
      groups.push({ id, name, expressIds, members });
      continue;
    }

    const expressIds = uniqueExpressIds(
      Array.isArray(row.expressIds) ? (row.expressIds as unknown[]).map(Number) : []
    );
    if (expressIds.length === 0) continue;
    groups.push({ id, name, expressIds, members: [] });
  }

  let source: CostaGroupsDocumentSource | undefined;
  if (version === COSTA_GROUPS_DOC_VERSION_V2 && doc.source && typeof doc.source === "object") {
    const s = doc.source as CostaGroupsDocumentSource;
    source = {
      ifcFileName: s.ifcFileName ?? null,
      ifcFingerprint: s.ifcFingerprint ?? null,
    };
  }

  return {
    version,
    updatedAt: typeof doc.updatedAt === "number" ? doc.updatedAt : Date.now(),
    source,
    groups,
  };
}

export function parseCostaGroupsStoreV3(raw: unknown): CostaGroupsDocumentV3 | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;
  if (doc.version !== COSTA_GROUPS_DOC_VERSION_V3) return null;
  if (!doc.buckets || typeof doc.buckets !== "object") return null;

  const buckets: Record<string, CostaGroupsBucketRecord> = {};
  for (const [fp, bucketRaw] of Object.entries(doc.buckets as Record<string, unknown>)) {
    const key = String(fp ?? "").trim();
    if (!key || !bucketRaw || typeof bucketRaw !== "object") continue;
    const bucket = bucketRaw as Record<string, unknown>;
    if (!Array.isArray(bucket.groups)) continue;
    const groups: CostaGroupRecordV2[] = [];
    for (const g of bucket.groups as unknown[]) {
      if (!g || typeof g !== "object") continue;
      const row = g as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      const id = String(row.id ?? "").trim();
      if (!name || !id) continue;
      const members = normalizeMembers(
        Array.isArray(row.members) ? (row.members as CostaGroupMemberRecord[]) : []
      );
      if (members.length === 0) continue;
      groups.push({ id, name, members });
    }
    let source: CostaGroupsDocumentSource | undefined;
    if (bucket.source && typeof bucket.source === "object") {
      const s = bucket.source as CostaGroupsDocumentSource;
      source = {
        ifcFileName: s.ifcFileName ?? null,
        ifcFingerprint: s.ifcFingerprint ?? key,
      };
    } else {
      source = { ifcFileName: null, ifcFingerprint: key };
    }
    buckets[key] = {
      version: COSTA_GROUPS_DOC_VERSION_V2,
      updatedAt: typeof bucket.updatedAt === "number" ? bucket.updatedAt : Date.now(),
      source,
      groups,
    };
  }

  return {
    version: COSTA_GROUPS_DOC_VERSION_V3,
    updatedAt: typeof doc.updatedAt === "number" ? doc.updatedAt : Date.now(),
    buckets,
  };
}

export function emptyCostaGroupsStoreV3(): CostaGroupsDocumentV3 {
  return {
    version: COSTA_GROUPS_DOC_VERSION_V3,
    updatedAt: Date.now(),
    buckets: {},
  };
}

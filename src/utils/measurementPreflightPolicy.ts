/**
 * Block 4 — MCP preflight: Costa-critical families (Littera + MeasurementFamily).
 * Advisory only — does not change PublishedQuantity or bridge Excel columns.
 *
 * Littera unit mass (2071 rows, non-category): M2 633 · KPL 477 · JM 363 · M3 90.
 * Tier A = määrä drivers (area + linear structural). Tier B = secondary but cost-relevant.
 */

import type { AbPolicyCounts } from "./abPolicySummary";
import { classifyMeasurementFamily } from "./familyQuantityPolicy";
import type { getMeasurementFeatureFlagsSnapshot } from "./measurementFeatureFlags";

export type MeasurementFeatureFlagsSnapshot = ReturnType<typeof getMeasurementFeatureFlagsSnapshot>;

export type CriticalTier = "A" | "B";

export type CriticalFamilyDef = {
  id: string;
  tier: CriticalTier;
  /** Primary Littera unit for this family cluster */
  litteraUnit: string;
  ifcTypeIncludes: string[];
  /** abPolicies counter when store signal is more reliable than raw IFC type */
  storeSignal?: keyof AbPolicyCounts;
};

/** Tier A — must appear in preflight sample when present in store (≥ minStoreCount). */
export const COSTA_CRITICAL_FAMILIES: ReadonlyArray<CriticalFamilyDef> = [
  { id: "wall", tier: "A", litteraUnit: "M2", ifcTypeIncludes: ["WALL"], storeSignal: "wallFace" },
  { id: "slab", tier: "A", litteraUnit: "M2", ifcTypeIncludes: ["SLAB"] },
  { id: "beam", tier: "A", litteraUnit: "JM", ifcTypeIncludes: ["BEAM"] },
  { id: "column", tier: "A", litteraUnit: "JM", ifcTypeIncludes: ["COLUMN"] },
  { id: "member", tier: "A", litteraUnit: "JM", ifcTypeIncludes: ["MEMBER"] },
  { id: "plate", tier: "A", litteraUnit: "M2", ifcTypeIncludes: ["PLATE"] },
  { id: "ontelo", tier: "B", litteraUnit: "M2", ifcTypeIncludes: ["SLAB", "BEAM"], storeSignal: "ontelo" },
  { id: "opening", tier: "B", litteraUnit: "M2", ifcTypeIncludes: ["DOOR", "WINDOW"] },
  { id: "foundation", tier: "B", litteraUnit: "M3", ifcTypeIncludes: ["FOOTING", "PILE", "PADFOUNDATION"] },
  { id: "roof", tier: "B", litteraUnit: "M2", ifcTypeIncludes: ["ROOF"] },
  { id: "covering", tier: "B", litteraUnit: "M2", ifcTypeIncludes: ["COVERING", "CURTAINWALL"] },
];

const MIN_STORE_FOR_SAMPLE_REQUIREMENT = 1;

/** Minimum sample ids per tier-A family when that family exists in the store. */
export const PREFLIGHT_TIER_A_MIN_PER_FAMILY = 3;

/** Max ids fetched per family/type when building the preflight pool (any IFC). */
export const PREFLIGHT_PER_TYPE_POOL_MAX = 12;

/** Tier-A reservation cap — leaves room for tier-B / fill in default sample sizes. */
export const PREFLIGHT_TIER_A_RESERVE_CAP_RATIO = 0.65;

/** IFC type sort for stratified sample — critical families first (when preflight ON). */
const IFC_TYPE_PRIORITY: string[] = [
  "WALL",
  "SLAB",
  "BEAM",
  "COLUMN",
  "MEMBER",
  "PLATE",
  "DOOR",
  "WINDOW",
  "FOOTING",
  "ROOF",
  "COVERING",
  "CURTAINWALL",
];

export function isPreflightPolicyEnabled(
  flags?: Partial<MeasurementFeatureFlagsSnapshot>
): boolean {
  return Boolean(flags?.measurementPreflightV1);
}

function normalizeIfcTypeKey(ifcType: string): string {
  return String(ifcType ?? "")
    .trim()
    .toUpperCase()
    .replace(/^IFC/, "");
}

function ifcTypeMatchesIncludes(ifcType: string, includes: string[]): boolean {
  const key = normalizeIfcTypeKey(ifcType);
  return includes.some((frag) => key.includes(frag));
}

export function ifcTypePreflightPriority(ifcType: string): number {
  const key = normalizeIfcTypeKey(ifcType);
  const idx = IFC_TYPE_PRIORITY.findIndex((frag) => key.includes(frag));
  return idx >= 0 ? idx : 1000;
}

export function sortIfcTypesForPreflight(
  types: string[],
  byCount: Map<string, number>,
  preflightEnabled = false
): string[] {
  if (!preflightEnabled) {
    return [...types].sort((a, b) => (byCount.get(b) ?? 0) - (byCount.get(a) ?? 0));
  }
  return [...types].sort((a, b) => {
    const pa = ifcTypePreflightPriority(a);
    const pb = ifcTypePreflightPriority(b);
    if (pa !== pb) return pa - pb;
    return (byCount.get(b) ?? 0) - (byCount.get(a) ?? 0);
  });
}

export function idsForIfcTypeIncludes(
  byType: Map<string, number[]>,
  includes: string[]
): number[] {
  const out: number[] = [];
  for (const [type, ids] of byType) {
    if (!ifcTypeMatchesIncludes(type, includes)) continue;
    out.push(...ids);
  }
  return [...new Set(out.map(Number).filter((n) => !isNaN(n)))].sort((a, b) => a - b);
}

/** Stable numeric ids per IFC type — deterministic preflight on any model. */
export function normalizePreflightByTypeMap(
  byType: Map<string, number[]>
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [type, ids] of byType) {
    out.set(
      type,
      [...new Set(ids.map(Number).filter((n) => !isNaN(n)))].sort((a, b) => a - b)
    );
  }
  return out;
}

export function isPreflightDeprioritizedIfcType(ifcType: string): boolean {
  const key = normalizeIfcTypeKey(ifcType);
  return key.includes("FASTENER") || key.includes("MECHANICALFASTENER");
}

export type PreflightTypeFetchRequest = {
  familyId: string;
  ifcTypes: string[];
  maxResults: number;
};

/** Tier-A families — dedicated pool fetch (never rely on document-order store slice). */
export function tierAFamiliesForPreflightFetch(
  storeTypes: Array<{ ifcType: string; count: number }>,
  abPolicies: AbPolicyCounts,
  perFamilyMax = PREFLIGHT_PER_TYPE_POOL_MAX
): PreflightTypeFetchRequest[] {
  const out: PreflightTypeFetchRequest[] = [];
  for (const def of COSTA_CRITICAL_FAMILIES) {
    if (def.tier !== "A") continue;
    const storeCount = countStoreByFamily(storeTypes, def, abPolicies);
    if (storeCount < MIN_STORE_FOR_SAMPLE_REQUIREMENT) continue;
    const ifcTypes = storeTypes
      .filter((t) => t.count > 0 && ifcTypeMatchesIncludes(t.ifcType, def.ifcTypeIncludes))
      .map((t) => t.ifcType);
    if (!ifcTypes.length) continue;
    out.push({
      familyId: def.id,
      ifcTypes,
      maxResults: Math.min(perFamilyMax, storeCount),
    });
  }
  return out;
}

/**
 * Universal fetch plan: tier-A families first, then every other non-deprioritized IFC type in store.
 * Does not depend on origin (Revit/Tekla/Archicad) or model size.
 */
export function buildPreflightTypeFetchPlan(
  storeTypes: Array<{ ifcType: string; count: number }>,
  abPolicies: AbPolicyCounts,
  perTypeMax = PREFLIGHT_PER_TYPE_POOL_MAX
): PreflightTypeFetchRequest[] {
  const out: PreflightTypeFetchRequest[] = [];
  const claimed = new Set<string>();

  for (const req of tierAFamiliesForPreflightFetch(storeTypes, abPolicies, perTypeMax)) {
    out.push(req);
    for (const t of req.ifcTypes) claimed.add(normalizeIfcTypeKey(t));
  }

  for (const row of storeTypes) {
    if (!row.ifcType || row.count <= 0) continue;
    if (isPreflightDeprioritizedIfcType(row.ifcType)) continue;
    const key = normalizeIfcTypeKey(row.ifcType);
    if (claimed.has(key)) continue;
    claimed.add(key);
    out.push({
      familyId: row.ifcType,
      ifcTypes: [row.ifcType],
      maxResults: Math.min(perTypeMax, row.count),
    });
  }

  return out;
}

function nextUnusedId(pool: number[], cursor: number, used: Set<number>): { id: number; next: number } | null {
  let i = cursor;
  while (i < pool.length) {
    const id = pool[i];
    i++;
    if (!used.has(id)) return { id, next: i };
  }
  return null;
}

function roundRobinPick(
  pools: Array<{ key: string; ids: number[]; need: number; picked: number; cursor: number }>,
  selected: number[],
  used: Set<number>,
  maxTotal: number
): void {
  let progressed = true;
  while (progressed && selected.length < maxTotal) {
    progressed = false;
    for (const pool of pools) {
      if (pool.picked >= pool.need || selected.length >= maxTotal) continue;
      const hit = nextUnusedId(pool.ids, pool.cursor, used);
      if (!hit) continue;
      pool.cursor = hit.next;
      selected.push(hit.id);
      used.add(hit.id);
      pool.picked++;
      progressed = true;
    }
  }
}

/** Reserve tier-A ids first (round-robin), then round-robin fill — preflight ON, any IFC. */
export function buildPreflightStratifiedSampleIds(input: {
  byType: Map<string, number[]>;
  maxSample: number;
  storeTypes: Array<{ ifcType: string; count: number }>;
  abPolicies: AbPolicyCounts;
}): number[] {
  const { maxSample, storeTypes, abPolicies } = input;
  const byType = normalizePreflightByTypeMap(input.byType);
  const selected: number[] = [];
  const selectedSet = new Set<number>();
  const tierACap = Math.min(
    30,
    Math.floor(maxSample * PREFLIGHT_TIER_A_RESERVE_CAP_RATIO)
  );

  const tierAPools: Array<{
    key: string;
    ids: number[];
    need: number;
    picked: number;
    cursor: number;
  }> = [];

  for (const def of COSTA_CRITICAL_FAMILIES) {
    if (def.tier !== "A") continue;
    const storeCount = countStoreByFamily(storeTypes, def, abPolicies);
    if (storeCount < MIN_STORE_FOR_SAMPLE_REQUIREMENT) continue;
    const poolIds = idsForIfcTypeIncludes(byType, def.ifcTypeIncludes);
    if (!poolIds.length) continue;
    tierAPools.push({
      key: def.id,
      ids: poolIds,
      need: Math.min(PREFLIGHT_TIER_A_MIN_PER_FAMILY, storeCount, poolIds.length),
      picked: 0,
      cursor: 0,
    });
  }

  roundRobinPick(tierAPools, selected, selectedSet, tierACap);

  const fillTypes = Array.from(byType.keys()).filter((t) => !isPreflightDeprioritizedIfcType(t));
  const byCount = new Map(fillTypes.map((t) => [t, (byType.get(t) ?? []).length]));
  const orderedTypes = sortIfcTypesForPreflight(fillTypes, byCount, true);
  const fillPools = orderedTypes.map((t) => ({
    key: t,
    ids: byType.get(t) ?? [],
    need: maxSample,
    picked: 0,
    cursor: 0,
  }));
  roundRobinPick(fillPools, selected, selectedSet, maxSample);

  return selected.slice(0, maxSample);
}

/** Share of sample slots taken by deprioritized IFC types (e.g. FASTENER). Diagnostic only. */
export function preflightDeprioritizedShare(
  sampleIds: number[],
  byType: Map<string, number[]>
): number {
  if (!sampleIds.length) return 0;
  const deprioritized = new Set<number>();
  for (const [t, ids] of byType) {
    if (!isPreflightDeprioritizedIfcType(t)) continue;
    for (const id of ids) deprioritized.add(id);
  }
  let n = 0;
  for (const id of sampleIds) {
    if (deprioritized.has(id)) n++;
  }
  return n / sampleIds.length;
}

function countStoreByFamily(
  storeTypes: Array<{ ifcType: string; count: number }>,
  def: CriticalFamilyDef,
  abPolicies: AbPolicyCounts
): number {
  if (def.storeSignal && def.id === "wall") {
    return abPolicies.wallFace;
  }
  if (def.storeSignal === "ontelo") {
    return abPolicies.ontelo;
  }
  let total = 0;
  for (const row of storeTypes) {
    if (ifcTypeMatchesIncludes(row.ifcType, def.ifcTypeIncludes)) {
      total += row.count;
    }
  }
  return total;
}

/**
 * Preflight census must use the same axis as sampling (IFC type fetch) for tier-A,
 * while still honouring Costa MeasurementFamily when it applies.
 */
export function sampleElementMatchesCriticalFamily(
  el: { type?: string; name?: string; extraProperties?: Record<string, string | number> },
  def: CriticalFamilyDef
): boolean {
  const family = classifyMeasurementFamily(el.name, el.type, el.extraProperties);
  if (family === def.id) return true;
  // Tier A + openings: IFC type in sample ⇒ family covered (matches buildPreflightTypeFetchPlan).
  if (def.tier === "A" || def.id === "opening") {
    return ifcTypeMatchesIncludes(String(el.type ?? ""), def.ifcTypeIncludes);
  }
  return false;
}

function countSampleByFamily(sampleElements: unknown[], def: CriticalFamilyDef): number {
  let n = 0;
  for (const el of sampleElements) {
    const anyEl = el as {
      type?: string;
      name?: string;
      extraProperties?: Record<string, string | number>;
    };
    if (sampleElementMatchesCriticalFamily(anyEl, def)) n++;
  }
  return n;
}

export type CriticalFamilyRow = {
  family: string;
  tier: CriticalTier;
  litteraUnit: string;
  storeCount: number;
  sampleCount: number;
  status: "ok" | "missing_in_sample" | "absent_from_store" | "not_required";
};

export type CriticalFamilyCoverage = {
  enabled: boolean;
  storeElementCount: number;
  sampleSize: number;
  families: CriticalFamilyRow[];
  strictWarnings: string[];
  guidance: string[];
};

export function buildCriticalFamilyCoverage(input: {
  storeElementCount: number;
  storeTypes: Array<{ ifcType: string; count: number }>;
  abPolicies: AbPolicyCounts;
  sampleElements: unknown[];
  preflightEnabled: boolean;
}): CriticalFamilyCoverage {
  const enabled = input.preflightEnabled;
  const sampleSize = input.sampleElements.length;
  const families: CriticalFamilyRow[] = [];
  const strictWarnings: string[] = [];
  const guidance: string[] = [];

  for (const def of COSTA_CRITICAL_FAMILIES) {
    const storeCount = countStoreByFamily(input.storeTypes, def, input.abPolicies);
    const sampleCount = countSampleByFamily(input.sampleElements, def);

    let status: CriticalFamilyRow["status"] = "not_required";
    if (storeCount <= 0) {
      status = "absent_from_store";
    } else if (sampleCount > 0) {
      status = "ok";
    } else if (enabled && def.tier === "A" && storeCount >= MIN_STORE_FOR_SAMPLE_REQUIREMENT) {
      status = "missing_in_sample";
    } else if (storeCount > 0 && sampleCount === 0) {
      status = enabled ? "missing_in_sample" : "not_required";
    }

    if (enabled && status === "missing_in_sample" && def.tier === "A") {
      strictWarnings.push(
        `critical_family_missing_in_sample:${def.id} (store=${storeCount}, sample=0, littera=${def.litteraUnit})`
      );
    }

    families.push({
      family: def.id,
      tier: def.tier,
      litteraUnit: def.litteraUnit,
      storeCount,
      sampleCount,
      status,
    });
  }

  if (enabled) {
    if (input.abPolicies.layerHidden > 0) {
      guidance.push(
        `${input.abPolicies.layerHidden} store elements have ContributeToMaara=0 (layer/sandwich). Preflight runs on the sent store — hidden layers are invisible to määrä.`
      );
    }
    if (input.abPolicies.wallFace === 0) {
      const wallIfc = input.storeTypes
        .filter((t) => ifcTypeMatchesIncludes(t.ifcType, ["WALL"]))
        .reduce((s, t) => s + t.count, 0);
      if (wallIfc === 0) {
        guidance.push(
          "Store has no wall face policy hits and no IfcWall types — wall measurements cannot be validated in this preflight."
        );
      }
    }
    if (strictWarnings.length > 0) {
      guidance.push(
        "Tier-A Costa families exist in store but are missing from the preflight sample — do not treat this preflight as representative for those families."
      );
    }
  }

  return {
    enabled,
    storeElementCount: input.storeElementCount,
    sampleSize,
    families,
    strictWarnings,
    guidance,
  };
}

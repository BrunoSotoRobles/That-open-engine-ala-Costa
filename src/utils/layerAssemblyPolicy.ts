/**
 * Tekla exploded composition (cast-unit layers exported as separate IfcWalls).
 * First Talo process: declare + user confirms grouping, then määrä uses one host paño.
 * Layers keep own quantities in extras (material / thickness); they do not add facade M2.
 */

export type LayerRole = "host" | "layer" | "other";
export type IfcOriginKind = "tekla" | "revit" | "other" | "unknown";

export const FACADE_ASSEMBLY_KEY = "ulkoseina-sandwich";
export const FACADE_TALO_HINT = "1241";

/** Prefab shell that carries the facade paño (one product). */
export const DEFAULT_HOST_NAMES = ["KUORIELEMENTTI"] as const;

/** Composition of that product — keep in model, do not sum as extra walls. */
export const DEFAULT_LAYER_NAMES = [
  "SISAKUORI",
  "ERISTE",
  "LAYER",
  "KOOLAUS",
  "PAROC",
  "RAK.LEVY",
  "RAKLEVY",
  "SISALEVY",
  "SUOJALEVY",
] as const;

/**
 * Same IfcWall type but a different määrä line (cladding, timber wall, partitions…).
 * Matched before ERISTE so "ERISTE+RUNKO" is not swallowed as sandwich insulation.
 */
export const DEFAULT_OTHER_WALL_NAMES = [
  "ERISTE+RUNKO",
  "PUUVERHOUS",
  "VALISEINA",
  "VSS-SEINAELEMENTTI",
  "VSS-SEINA",
  "TUKIMUURIELEMENTTI",
  "TUKIMUURI",
  "HISSIKUILUELEMENTTI",
  "PV-SEINA",
] as const;

export function detectIfcOriginKind(...hints: Array<string | null | undefined>): IfcOriginKind {
  const blob = hints
    .map((h) => String(h ?? "").toLowerCase())
    .join(" ");
  if (!blob.trim()) return "unknown";
  if (blob.includes("tekla")) return "tekla";
  if (blob.includes("revit") || blob.includes("autodesk")) return "revit";
  if (blob.includes("archicad") || blob.includes("graphisoft")) return "other";
  return "unknown";
}

export function normalizeFamilyName(name: string | undefined | null): string {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Tekla Name is a family token; Revit is often "Basic Wall:FAMILY:id". */
export function familyKey(name: string | undefined | null): string {
  const n = normalizeFamilyName(name);
  if (!n) return "";
  const parts = n.split(":").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const head = parts[0];
    if (head.includes("WALL") || head.includes("BASIC") || head.includes("FLOOR") || head.includes("SLAB")) {
      return parts[1];
    }
  }
  return parts[0] ?? n;
}

function nameSet(names: readonly string[]): Set<string> {
  return new Set(names.map((n) => normalizeFamilyName(n)));
}

const HOST_SET = nameSet(DEFAULT_HOST_NAMES);
const LAYER_SET = nameSet(DEFAULT_LAYER_NAMES);
const OTHER_SET = nameSet(DEFAULT_OTHER_WALL_NAMES);

export function isWallIfcTypeName(ifcType: string | undefined | null): boolean {
  return String(ifcType ?? "").toUpperCase().includes("WALL");
}

export function resolveLayerRole(
  name: string | undefined | null,
  ifcType?: string | undefined | null,
  hostNames: readonly string[] = DEFAULT_HOST_NAMES,
  layerNames: readonly string[] = DEFAULT_LAYER_NAMES,
  otherNames: readonly string[] = DEFAULT_OTHER_WALL_NAMES
): LayerRole {
  if (!isWallIfcTypeName(ifcType)) return "other";
  const key = familyKey(name);
  if (!key) return "other";
  if (nameSet(otherNames).has(key) || OTHER_SET.has(key)) return "other";
  if (nameSet(hostNames).has(key) || HOST_SET.has(key)) return "host";
  if (nameSet(layerNames).has(key) || LAYER_SET.has(key)) return "layer";
  return "other";
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface LayerAssemblyProposal {
  assemblyKey: string;
  taloHint: string;
  origin: IfcOriginKind;
  /** Tekla + host + layers: Claude must stop before the Talo table. */
  required: boolean;
  suggested: boolean;
  hostNames: string[];
  layerNames: string[];
  otherNames: string[];
  counts: Record<string, number>;
  hostCount: number;
  layerCount: number;
  finding: string;
  gate: string;
}

export function proposeFacadeLayerAssembly(
  items: ReadonlyArray<{ name?: string | null; type?: string | null }>,
  origin: IfcOriginKind = "unknown"
): LayerAssemblyProposal {
  const counts: Record<string, number> = {};
  for (const el of items) {
    if (!isWallIfcTypeName(el.type)) continue;
    const key = familyKey(el.name);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const present = new Set(Object.keys(counts));
  const hostNames = DEFAULT_HOST_NAMES.filter((n) => present.has(normalizeFamilyName(n)));
  const layerNames = DEFAULT_LAYER_NAMES.filter((n) => present.has(normalizeFamilyName(n)));
  const otherNames = DEFAULT_OTHER_WALL_NAMES.filter((n) => present.has(normalizeFamilyName(n)));

  const hostCount = hostNames.reduce((s, n) => s + (counts[normalizeFamilyName(n)] ?? 0), 0);
  const layerCount = layerNames.reduce((s, n) => s + (counts[normalizeFamilyName(n)] ?? 0), 0);

  const suggested = hostNames.length > 0 && layerNames.length > 0;
  const required = suggested && (origin === "tekla" || origin === "unknown");

  const finding = suggested
    ? `Exploded facade composition: ${hostCount} host (${hostNames.join(", ")}) and ${layerCount} layer pieces (${layerNames.join(", ")}). Tekla often exports the sandwich as separate IfcWalls (Assemblies:Off). Measuring each wall as facade triples the paño.`
    : "No sandwich host+layer name pair detected on IfcWall.";

  const gate = required
    ? "GATE: Do not propose the Talo table for these wall names and do not write IFC until the user accepts or rejects grouping. Propose: measure as ONE product (host paño); keep layers for materials/thickness."
    : suggested
      ? "Layer names found on a non-Tekla origin. Propose grouping only if the user confirms it is exploded composition."
      : "No layer-assembly gate.";

  return {
    assemblyKey: FACADE_ASSEMBLY_KEY,
    taloHint: FACADE_TALO_HINT,
    origin,
    required,
    suggested,
    hostNames,
    layerNames,
    otherNames,
    counts,
    hostCount,
    layerCount,
    finding,
    gate,
  };
}

export interface LayerAssemblyConfirmation {
  confirmed: boolean;
  assemblyKey: string;
  taloHint: string;
  hostNames: string[];
  layerNames: string[];
  otherNames: string[];
}

const FACADE_MAARA_UNITS = new Set(["M2", "BRM2", "NM2", "KPL", "AS"]);

function zeroFacadeLitteraQuantities<T extends { unit?: string; quantity?: number }>(
  codes: T[] | undefined
): T[] | undefined {
  if (!codes?.length) return codes;
  return codes.map((lc) => {
    const u = String(lc.unit ?? "").toUpperCase();
    if (FACADE_MAARA_UNITS.has(u)) return { ...lc, quantity: 0 };
    return lc;
  });
}

export const COSTA_ASSEMBLY_PSET = "Pset_CostaAssembly";
export const COSTA_ASSEMBLY_PROP_ROLE = "LayerRole";
export const COSTA_ASSEMBLY_PROP_KEY = "AssemblyKey";
export const COSTA_ASSEMBLY_PROP_MAARA = "ContributeToMaara";

const PSET_ROLE = `${COSTA_ASSEMBLY_PSET}.${COSTA_ASSEMBLY_PROP_ROLE}`;
const PSET_KEY = `${COSTA_ASSEMBLY_PSET}.${COSTA_ASSEMBLY_PROP_KEY}`;
const PSET_MAARA = `${COSTA_ASSEMBLY_PSET}.${COSTA_ASSEMBLY_PROP_MAARA}`;

/** Copy IFC Pset_CostaAssembly onto CostaBIM.* keys used by Excel / määrä. */
export function hydrateAssemblyFromIfcPsets(
  extra: Record<string, string | number> | undefined | null
): Record<string, string | number> {
  const next: Record<string, string | number> = { ...(extra ?? {}) };
  const roleRaw = String(next[PSET_ROLE] ?? next["CostaBIM.LayerRole"] ?? "")
    .trim()
    .toLowerCase();
  if (roleRaw === "host" || roleRaw === "layer" || roleRaw === "other") {
    next["CostaBIM.LayerRole"] = roleRaw;
  }
  const key = next[PSET_KEY] ?? next["CostaBIM.LayerAssembly"];
  if (key != null && String(key).trim()) {
    next["CostaBIM.LayerAssembly"] = String(key).trim();
  }
  const maara = next[PSET_MAARA];
  if (maara === 0 || maara === "0") next["CostaBIM.ContributeToMaara"] = 0;
  if (maara === 1 || maara === "1") next["CostaBIM.ContributeToMaara"] = 1;
  return next;
}

export function hasIfcAssemblyHandshake(
  extra: Record<string, string | number> | undefined | null
): boolean {
  const role = hydrateAssemblyFromIfcPsets(extra)["CostaBIM.LayerRole"];
  return role === "host" || role === "layer";
}

export function inferLayerAssemblyConfirmationFromElements(
  elements: ReadonlyArray<{
    name?: string;
    taloCode?: string;
    extraProperties?: Record<string, string | number>;
  }>
): LayerAssemblyConfirmation | null {
  const hostNames = new Set<string>();
  const layerNames = new Set<string>();
  const otherNames = new Set<string>();
  let assemblyKey = FACADE_ASSEMBLY_KEY;
  let taloHint = FACADE_TALO_HINT;
  for (const el of elements) {
    const extra = hydrateAssemblyFromIfcPsets(el.extraProperties);
    const role = extra["CostaBIM.LayerRole"];
    const fam = familyKey(el.name);
    if (!fam || (role !== "host" && role !== "layer" && role !== "other")) continue;
    if (typeof extra["CostaBIM.LayerAssembly"] === "string" && extra["CostaBIM.LayerAssembly"]) {
      assemblyKey = String(extra["CostaBIM.LayerAssembly"]);
    }
    if (role === "host") {
      hostNames.add(fam);
      const talo = String(el.taloCode ?? "").replace(/\./g, "");
      if (talo.length >= 4) taloHint = talo.slice(0, 4);
    } else if (role === "layer") {
      layerNames.add(fam);
    } else {
      otherNames.add(fam);
    }
  }
  if (hostNames.size === 0 || layerNames.size === 0) return null;
  return {
    confirmed: true,
    assemblyKey,
    taloHint,
    hostNames: Array.from(hostNames),
    layerNames: Array.from(layerNames),
    otherNames: Array.from(otherNames),
  };
}

function applyStampedLayerRole<
  T extends {
    quantity?: number;
    extraProperties?: Record<string, string | number>;
    litteraCodes?: Array<{ unit?: string; quantity?: number }>;
  },
>(element: T, extra: Record<string, string | number>, role: LayerRole, assemblyKey: string): T {
  extra["CostaBIM.LayerRole"] = role;
  extra["CostaBIM.LayerAssembly"] = assemblyKey;
  if (extra["CostaBIM.PublishedBlocked"] === 1) {
    extra["CostaBIM.ContributeToMaara"] = 0;
    return { ...element, quantity: undefined, extraProperties: extra };
  }
  if (role !== "layer") {
    extra["CostaBIM.ContributeToMaara"] = 1;
    return { ...element, extraProperties: extra };
  }
  const own =
    (typeof extra["CostaBIM.LayerOwnQuantity"] === "number" && extra["CostaBIM.LayerOwnQuantity"] > 0
      ? extra["CostaBIM.LayerOwnQuantity"]
      : undefined) ??
    (typeof extra["CostaBIM.PublishedQuantity"] === "number"
      ? extra["CostaBIM.PublishedQuantity"]
      : undefined) ??
    (typeof element.quantity === "number" ? element.quantity : 0);
  extra["CostaBIM.LayerOwnQuantity"] = own;
  extra["CostaBIM.LayerOwnUnit"] = extra["CostaBIM.PublishedUnit"] ?? "m2";
  extra["CostaBIM.ContributeToMaara"] = 0;
  delete extra["CostaBIM.PublishedQuantity"];
  delete extra["CostaBIM.PublishedUnit"];
  return {
    ...element,
    quantity: 0,
    extraProperties: extra,
    ...(element.litteraCodes
      ? { litteraCodes: zeroFacadeLitteraQuantities(element.litteraCodes) }
      : {}),
  };
}

/** After user confirm or IFC Pset_CostaAssembly: layers do not add façade M2. */
export function applyLayerAssemblyPolicyToElement<
  T extends {
    name?: string;
    type?: string;
    quantity?: number;
    extraProperties?: Record<string, string | number>;
    litteraCodes?: Array<{ unit?: string; quantity?: number }>;
  },
>(element: T, confirmation: LayerAssemblyConfirmation | null | undefined): T {
  const extra = hydrateAssemblyFromIfcPsets(element.extraProperties);
  extra["CostaBIM.LayerRoleProposed"] = resolveLayerRole(element.name, element.type);

  if (confirmation?.confirmed) {
    const role = resolveLayerRole(
      element.name,
      element.type,
      confirmation.hostNames,
      confirmation.layerNames,
      confirmation.otherNames
    );
    return applyStampedLayerRole(element, extra, role, confirmation.assemblyKey);
  }

  if (hasIfcAssemblyHandshake(extra)) {
    const role = extra["CostaBIM.LayerRole"] as LayerRole;
    const key = String(extra["CostaBIM.LayerAssembly"] ?? FACADE_ASSEMBLY_KEY);
    return applyStampedLayerRole(element, extra, role, key);
  }

  if (extra["CostaBIM.PublishedBlocked"] === 1) {
    extra["CostaBIM.ContributeToMaara"] = 0;
    return { ...element, quantity: undefined, extraProperties: extra };
  }
  delete extra["CostaBIM.LayerRole"];
  delete extra["CostaBIM.ContributeToMaara"];
  delete extra["CostaBIM.LayerAssembly"];
  return { ...element, extraProperties: extra };
}

export function contributesToMaara(
  extra: Record<string, string | number> | undefined | null
): boolean {
  if (extra?.["CostaBIM.PublishedBlocked"] === 1) return false;
  return extra?.["CostaBIM.ContributeToMaara"] !== 0;
}

export function isConfirmedAssemblyMember(extra: Record<string, string | number> | undefined | null): boolean {
  const role = extra?.["CostaBIM.LayerRole"];
  return role === "host" || role === "layer";
}

function normalizePublishedUnit(extra: Record<string, string | number> | undefined): string {
  return String(extra?.["CostaBIM.PublishedUnit"] ?? "")
    .trim()
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/\s+/g, "");
}

/** True when the stamped unit is area (or unset — walls historically omit the unit). */
export function isPublishedAreaUnit(extra: Record<string, string | number> | undefined | null): boolean {
  const unit = normalizePublishedUnit(extra ?? undefined);
  if (!unit || unit === "m2" || unit === "sqm") return true;
  return false;
}

export function publishedMaaraM2(el: {
  quantity?: number;
  extraProperties?: Record<string, string | number>;
}): number {
  if (el.extraProperties?.["CostaBIM.PublishedBlocked"] === 1) return 0;
  if (!contributesToMaara(el.extraProperties)) return 0;
  if (!isPublishedAreaUnit(el.extraProperties)) return 0;
  const pub = el.extraProperties?.["CostaBIM.PublishedQuantity"];
  if (typeof pub === "number" && Number.isFinite(pub) && pub > 0) return pub;
  if (typeof el.quantity === "number" && Number.isFinite(el.quantity) && el.quantity > 0) {
    return el.quantity;
  }
  return 0;
}

export interface AssemblyProductMeta {
  taloCode: string;
  productName: string;
}

/** Host name + Talo of the sandwich product (for Excel group key). */
export function resolveAssemblyProductMeta(
  costData: ReadonlyArray<{
    name?: string;
    taloCode?: string;
    extraProperties?: Record<string, string | number>;
  }>
): AssemblyProductMeta | null {
  const hosts = costData.filter((el) => el.extraProperties?.["CostaBIM.LayerRole"] === "host");
  if (hosts.length === 0) return null;
  const productName = String(hosts[0].name ?? "").replace(/:\d{3,}$/, "") || "KUORIELEMENTTI";
  const taloCode = String(
    hosts.find((h) => String(h.taloCode ?? "").trim())?.taloCode ?? ""
  ).trim();
  return { taloCode, productName };
}

export function assemblyExcelGroupKey(
  el: { extraProperties?: Record<string, string | number> },
  product: AssemblyProductMeta | null
): string | null {
  if (!product || !isConfirmedAssemblyMember(el.extraProperties)) return null;
  return `${product.taloCode}-${product.productName}`;
}

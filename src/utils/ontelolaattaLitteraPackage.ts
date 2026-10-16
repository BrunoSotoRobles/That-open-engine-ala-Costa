/**
 * Paquete fijo de 6 códigos Littera por array ontelolaatta confirmado.
 * Se aplica en CostCalculator al pulsar "Calcular costes".
 */

import * as FRAGS from "@thatopen/fragments";
import type { OntelolaattaMcpEntry } from "../stores/CostStore";
import type { BaseCostElement } from "../types/cost/shared";
import {
  PIECE_WIDTH_M,
  computeFootprintEdges,
  computePieceCount,
  computeSpanLinePoints,
  detectOnteloType,
  resolveFieldLength,
  resolvePerpWidth,
  type OnteloType,
} from "./ontelolaattaUtils";

export const SAUMATERAKSETS_KG_PER_M2 = 2.0;

export type OntelolaattaLitteraSource = NonNullable<
  NonNullable<BaseCostElement["litteraCodes"]>[number]["source"]
>;

export interface OntelolaattaMeasurements {
  spanLengthM: number;
  pieceCount: number;
  areaM2: number;
}

type LitteraLineMeta = {
  description: string;
  unit: string;
  category: string;
};

/** Material + juotosvalut por espesor (baseNumber normalizado; O26 → 27). */
const TYPE_CODES: Record<number, { material: string; grout: string }> = {
  15: { material: "3152490", grout: "3156105" },
  20: { material: "3152500", grout: "3156107" },
  27: { material: "3152510", grout: "3156109" },
  32: { material: "3152520", grout: "3156111" },
  37: { material: "3152530", grout: "3156113" },
  40: { material: "3152540", grout: "3156115" },
  50: { material: "3152550", grout: "3156117" },
};

const LITTERA_META: Record<string, LitteraLineMeta> = {
  "3152490": { description: "ontelolaatta O15 d=150mm, xx kpl", unit: "M2", category: "RAKENNUSOSAT" },
  "3152500": { description: "ontelolaatta O20 d=200mm, xx kpl", unit: "M2", category: "RAKENNUSOSAT" },
  "3152510": { description: "ontelolaatta O27 d=265mm, xx kpl", unit: "M2", category: "RAKENNUSOSAT" },
  "3152520": { description: "ontelolaatta O32 d=320mm, xx kpl", unit: "M2", category: "RAKENNUSOSAT" },
  "3152530": { description: "ontelolaatta O37 d=370mm, xx kpl", unit: "M2", category: "RAKENNUSOSAT" },
  "3152540": { description: "ontelolaatta O40 d=400mm, xx kpl", unit: "M2", category: "RAKENNUSOSAT" },
  "3152550": { description: "ontelolaatta O50 d=500mm, xx kpl", unit: "M2", category: "RAKENNUSOSAT" },
  "3155060": { description: "ontelolaattojen asennus", unit: "KPL", category: "RAKENNUSOSAT" },
  "3156102": { description: "onteloiden saumateräkset", unit: "KG", category: "RAKENNUSOSAT" },
  "3156105": { description: "onteloiden saumaus+juotosvalut, h=150mm", unit: "M2", category: "RAKENNUSOSAT" },
  "3156107": { description: "onteloiden saumaus+juotosvalut, h=200mm", unit: "M2", category: "RAKENNUSOSAT" },
  "3156109": { description: "onteloiden saumaus+juotosvalut, h=265mm", unit: "M2", category: "RAKENNUSOSAT" },
  "3156111": { description: "onteloiden saumaus+juotosvalut, h=320mm", unit: "M2", category: "RAKENNUSOSAT" },
  "3156113": { description: "onteloiden saumaus+juotosvalut, h=370mm", unit: "M2", category: "RAKENNUSOSAT" },
  "3156115": { description: "onteloiden saumaus+juotosvalut, h=400mm", unit: "M2", category: "RAKENNUSOSAT" },
  "3156117": { description: "onteloiden saumaus+juotosvalut, h=500mm", unit: "M2", category: "RAKENNUSOSAT" },
  "3156119": { description: "ontelolaattojen reiät+paikkaus", unit: "ERÄ", category: "RAKENNUSOSAT" },
  "315720": { description: "ontelolaattojen jälkityö", unit: "M2", category: "RAKENNUSOSAT" },
};

export function onteloStoreKey(globalId: string | undefined, expressId: number): string {
  const gid = String(globalId ?? "").trim();
  return gid || `express:${expressId}`;
}

/** O26 se trata como O27 para códigos Littera y espesor. */
export function normalizeOnteloBaseNumber(baseNumber: number): number {
  if (baseNumber === 26) return 27;
  return baseNumber;
}

/** Elemento con nombre Oxx y entrada MCP confirmada en IFCViewer. */
export function isConfirmedOntelolaattaElement(
  element: { name?: string; globalId?: string; id: number },
  byGlobalId: Record<string, OntelolaattaMcpEntry>
): boolean {
  if (!detectOnteloType(element.name ?? "")) return false;
  return (
    lookupConfirmedOntelolaattaEntry(element.globalId, element.id, byGlobalId) != null
  );
}

/** Tras confirmación ontelolaatta, solo códigos del paquete fijo (defensa en profundidad). */
export function litteraCodesForConfirmedOntelolaatta(
  litteraCodes: BaseCostElement["litteraCodes"],
  confirmed: boolean
): NonNullable<BaseCostElement["litteraCodes"]> {
  if (!confirmed || !litteraCodes?.length) return litteraCodes ?? [];
  return litteraCodes.filter((lc) => lc.source === "ontelolaatta");
}

export function lookupConfirmedOntelolaattaEntry(
  globalId: string | undefined,
  expressId: number,
  byGlobalId: Record<string, OntelolaattaMcpEntry>
): OntelolaattaMcpEntry | null {
  const key = onteloStoreKey(globalId, expressId);
  const direct = byGlobalId[key];
  if (direct?.confirmed) return direct;

  for (const entry of Object.values(byGlobalId)) {
    if (entry.confirmed && entry.expressId === expressId) return entry;
  }
  return null;
}

function isFragmentsGroup(model: unknown): model is FRAGS.FragmentsGroup {
  return (
    model != null &&
    typeof model === "object" &&
    "items" in model &&
    Array.isArray((model as FRAGS.FragmentsGroup).items)
  );
}

function measurementsFromEntry(entry: OntelolaattaMcpEntry): OntelolaattaMeasurements {
  const spanLengthM = entry.fieldLength ?? 0;
  const pieceCount = entry.pieceCount ?? computePieceCount(entry.fieldWidth);
  const areaM2 = pieceCount * spanLengthM * PIECE_WIDTH_M;
  return { spanLengthM, pieceCount, areaM2 };
}

/**
 * Medidas del array: recálculo live desde geometría del fragmento si es posible;
 * si no, valores guardados en ontelolaattaMcp.
 */
export function resolveOntelolaattaMeasurements(
  entry: OntelolaattaMcpEntry,
  fragmentsModel?: unknown,
  expressId?: number
): OntelolaattaMeasurements {
  const eid = expressId ?? entry.expressId;
  const lineAlongLong = entry.lineAlongLong ?? false;

  if (isFragmentsGroup(fragmentsModel) && eid != null) {
    const edges = computeFootprintEdges(fragmentsModel, eid);
    if (edges) {
      const { p1, p2 } = computeSpanLinePoints(edges, lineAlongLong);
      const spanLengthM = resolveFieldLength(edges, lineAlongLong, p1, p2);
      const perpWidth = resolvePerpWidth(edges, lineAlongLong);
      const pieceCount = computePieceCount(perpWidth);
      const areaM2 = pieceCount * spanLengthM * PIECE_WIDTH_M;
      if (spanLengthM > 0 && pieceCount > 0) {
        return { spanLengthM, pieceCount, areaM2 };
      }
    }
  }

  return measurementsFromEntry(entry);
}

function litteraLine(
  code: string,
  quantity: number
): NonNullable<BaseCostElement["litteraCodes"]>[number] {
  const meta = LITTERA_META[code] ?? {
    description: code,
    unit: "M2",
    category: "RAKENNUSOSAT",
  };
  return {
    litteraCode: code,
    litteraName: meta.description,
    litteraCategory: meta.category,
    unit: meta.unit,
    quantity,
    relevanceScore: 100,
    source: "ontelolaatta",
  };
}

/** Construye las 6 líneas Littera del paquete ontelolaatta estándar. */
export function buildOntelolaattaLitteraPackage(
  measurements: OntelolaattaMeasurements,
  onteloType: OnteloType
): NonNullable<BaseCostElement["litteraCodes"]> {
  const base = normalizeOnteloBaseNumber(onteloType.baseNumber);
  const codes = TYPE_CODES[base];
  if (!codes) {
    console.warn("[ontelolaattaLitteraPackage] Unknown ontelo base number:", onteloType.baseNumber);
    return [];
  }

  const { spanLengthM, pieceCount, areaM2 } = measurements;
  if (spanLengthM <= 0 || pieceCount <= 0 || areaM2 <= 0) {
    console.warn("[ontelolaattaLitteraPackage] Invalid measurements:", measurements);
    return [];
  }

  const kgSaumaterakset = areaM2 * SAUMATERAKSETS_KG_PER_M2;

  return [
    litteraLine(codes.material, areaM2),
    litteraLine("3155060", pieceCount),
    litteraLine("3156102", kgSaumaterakset),
    litteraLine(codes.grout, areaM2),
    litteraLine("315720", areaM2),
    litteraLine("3156119", 1),
  ];
}

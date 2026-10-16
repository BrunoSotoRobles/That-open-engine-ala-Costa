import type { BridgeFamily } from "./constants";
import { FAMILIA_PATTERNS } from "./constants";
import { parseNum } from "./util";

export type BridgeQtoRecord = {
  type: string;
  qto: Record<string, number>;
  props: Record<string, number>;
  overallWidth?: number;
  overallHeight?: number;
};

export function bridgeFamily(ifcType: string): BridgeFamily {
  const u = ifcType.toUpperCase();
  if (u.includes("CURTAINWALL")) return "OTHER";
  if (u.includes("STAIRFLIGHT")) return "LINEAR";
  for (const [fam, pats] of FAMILIA_PATTERNS) {
    if (pats.some((p) => u.includes(p))) return fam;
  }
  return "OTHER";
}

function readQtyMap(
  bq: Record<string, { value?: number; unit?: string } | undefined> | undefined,
  key: string
): number | undefined {
  const v = bq?.[key]?.value;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return undefined;
}

/** Build IFC-side record from CostStore element (same plane as bridge IFC-raw columns). */
export function buildBridgeQtoRecord(
  ifcType: string,
  baseQuantities: Record<string, { value?: number; unit?: string } | undefined> | undefined,
  extraProperties: Record<string, unknown> | undefined
): BridgeQtoRecord {
  const qto: Record<string, number> = {};
  for (const [k, entry] of Object.entries(baseQuantities ?? {})) {
    const v = entry?.value;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) qto[k] = v;
  }

  const props: Record<string, number> = {};
  for (const [k, raw] of Object.entries(extraProperties ?? {})) {
    const n = parseNum(raw);
    if (n != null && n > 0) props[k] = n;
  }

  return {
    type: ifcType,
    qto,
    props,
    overallWidth: readQtyMap(baseQuantities, "OverallWidth"),
    overallHeight: readQtyMap(baseQuantities, "OverallHeight"),
  };
}

export function readRec(
  rec: BridgeQtoRecord,
  origen: "qto" | "prop",
  clave: string
): number | null {
  const fuente = origen === "qto" ? rec.qto : rec.props;
  const v = fuente[clave];
  return v != null && v > 0 ? v : null;
}

export function canales(
  rec: BridgeQtoRecord,
  defs: ReadonlyArray<[string, "qto" | "prop", string]>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [nombre, origen, clave] of defs) {
    const v = readRec(rec, origen, clave);
    if (v != null) out[nombre] = v;
  }
  return out;
}

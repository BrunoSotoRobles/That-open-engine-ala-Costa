/** Spec capa externa v2.3 — mirrors Downloads/_audit/independiente/capa_externa_v2 */

export const EPS_COH = 0.03;
export const EPS_IGUAL = 1e-3;
export const EPS_CANAL = 2e-4;
export const SPREAD_CANALES = 0.05;
export const LIN_MIN_M = 0.05;
export const LIN_MAX_M = 300;
export const RATIO_LIN_MIN = 0.05;
export const RATIO_LIN_MAX = 20;
export const RATIO_AREA_MIN = 0.5;
export const RATIO_AREA_MAX = 2;
export const AREA_MIN = 1e-6;
export const FACTORES_UNIDAD = [1e3, 1e4, 1e6, 1e9] as const;
export const TOL_FACTOR = 0.01;

export type BridgeFamily = "LINEAR" | "OPENING" | "WALL" | "HORIZONTAL" | "OTHER";

export const FAMILIA_PATTERNS: ReadonlyArray<[BridgeFamily, string[]]> = [
  ["LINEAR", ["BEAM", "COLUMN", "MEMBER", "PILE", "RAILING", "PIPE", "DUCT", "CABLE"]],
  ["OPENING", ["DOOR", "WINDOW"]],
  ["WALL", ["WALL"]],
  ["HORIZONTAL", ["SLAB", "ROOF", "PLATE", "COVERING", "FOOTING", "FOUNDATION"]],
];

export const CANALES_LONGITUD: ReadonlyArray<[string, "qto" | "prop", string]> = [
  ["Qto.Length", "qto", "Length"],
  ["Dimensions.Cut Length", "prop", "Dimensions.Cut Length"],
  ["Dimensions.System Length", "prop", "Dimensions.System Length"],
  ["Dimensions.Length", "prop", "Dimensions.Length"],
  ["Simplebim.Length", "prop", "ePset_SimplebimBasicQuantities.Length (Simplebim)"],
  ["Tekla.length", "prop", "Tekla Quantity.length"],
  ["Tekla.pituus", "prop", "Tekla Quantity.pituus"],
];

export const CONTAMINANTES_LONGITUD: ReadonlyArray<[string, "qto" | "prop", string, string]> = [
  ["Qto.OuterSurfaceArea", "qto", "OuterSurfaceArea", "m2"],
  ["Qto.CrossSectionArea", "qto", "CrossSectionArea", "m2"],
  ["Qto.GrossSurfaceArea", "qto", "GrossSurfaceArea", "m2"],
  ["Qto.Width", "qto", "Width", "m_seccion"],
  ["Qto.Height", "qto", "Height", "m_seccion"],
  ["Qto.GrossVolume", "qto", "GrossVolume", "m3"],
  ["Qto.NetVolume", "qto", "NetVolume", "m3"],
];

export const CANALES_AREA_MURO: ReadonlyArray<[string, "qto" | "prop", string]> = [
  ["Qto.NetSideArea", "qto", "NetSideArea"],
  ["Qto.GrossSideArea", "qto", "GrossSideArea"],
];

export const CANALES_AREA_HORIZ: ReadonlyArray<[string, "qto" | "prop", string]> = [
  ["Qto.NetArea", "qto", "NetArea"],
  ["Qto.GrossArea", "qto", "GrossArea"],
];

export const CONTAMINANTES_AREA: ReadonlyArray<[string, "qto" | "prop", string, string]> = [
  ["Qto.NetVolume", "qto", "NetVolume", "m3"],
  ["Qto.GrossVolume", "qto", "GrossVolume", "m3"],
  ["Qto.Length", "qto", "Length", "m"],
];

export const CANDIDATO: Record<
  "LINEAR" | "WALL" | "HORIZONTAL",
  [string, string]
> = {
  LINEAR: ["Qto.Length", "Length"],
  WALL: ["Qto.NetSideArea", "NetSideArea"],
  HORIZONTAL: ["Qto.NetArea", "NetArea"],
};

/** Unit column keys in export row data (unit_JM, unit_M2, …). */
export const UNIT_MIRROR_KEYS = ["unit_JM", "unit_M", "unit_M2"] as const;

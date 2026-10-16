import {
  AREA_MIN,
  CANALES_AREA_HORIZ,
  CANALES_AREA_MURO,
  CANALES_LONGITUD,
  CANDIDATO,
  CONTAMINANTES_AREA,
  CONTAMINANTES_LONGITUD,
  EPS_COH,
  EPS_IGUAL,
  LIN_MAX_M,
  LIN_MIN_M,
  RATIO_AREA_MAX,
  RATIO_AREA_MIN,
  RATIO_LIN_MAX,
  RATIO_LIN_MIN,
  SPREAD_CANALES,
  type BridgeFamily,
} from "./constants";
import { canales, readRec, type BridgeQtoRecord } from "./record";
import { factorSospechoso, igual, rel } from "./util";

export type BridgeCorrectorGates = {
  capa2: string | null;
  capa2_pasa: boolean | null;
  capa1: string | null;
  capa1_pasa: boolean | null;
};

export type BridgeCorrectorOrigin = {
  tipo: string;
  clave: string;
  pset: string | null;
  canal: string;
};

export type BridgeClassifyResult = {
  veredicto: string;
  nuevo: number | null;
  codigo: string;
  detalle: Record<string, unknown>;
  origen: BridgeCorrectorOrigin | null;
  gates: BridgeCorrectorGates;
};

function originFor(clave: string, canal: string): BridgeCorrectorOrigin {
  return { tipo: "Qto", clave, pset: "BaseQuantities", canal };
}

function capa1(rec: BridgeQtoRecord, fam: BridgeFamily): [boolean, string] {
  if (fam !== "LINEAR") return [true, "no aplica (familia no lineal)"];
  const L = readRec(rec, "qto", "Length");
  const A = readRec(rec, "qto", "CrossSectionArea");
  const V =
    readRec(rec, "qto", "GrossVolume") ?? readRec(rec, "qto", "NetVolume");
  if (L == null || L <= 0) return [false, "sin Qto.Length"];
  if (A != null && V != null) {
    const d = rel(V / A, L);
    return [d <= EPS_COH, `|V/A−L|/L = ${d.toFixed(5)} (V/A = ${(V / A).toFixed(5)}, L = ${L.toFixed(5)})`];
  }
  return [true, "sin CrossSectionArea o volumen: capa 1 no aplicable"];
}

function capa2(
  rec: BridgeQtoRecord,
  fam: BridgeFamily
): [boolean, string | null, string] {
  if (fam !== "LINEAR") return [true, null, "no aplica (familia no lineal)"];
  const L = readRec(rec, "qto", "Length");
  if (L == null) return [false, "sin_Qto_Length", "sin Qto.Length"];
  const W = readRec(rec, "qto", "Width") ?? 0;
  const H = readRec(rec, "qto", "Height") ?? 0;
  const otro = Math.max(W, H);
  if (otro > 0 && L < otro) {
    return [false, "eje_volcado", `L = ${L.toFixed(5)} < max(W,H) = ${otro.toFixed(5)}`];
  }
  if (L < LIN_MIN_M) {
    return [false, "L_fuera_de_rango", `L = ${L.toFixed(5)} < ${LIN_MIN_M} m`];
  }
  if (L > LIN_MAX_M) {
    return [false, "L_fuera_de_rango", `L = ${L.toFixed(5)} > ${LIN_MAX_M} m`];
  }
  const msg =
    otro > 0
      ? "L ≥ max(W,H) y en rango"
      : `sin W/H en Qto (L2a no aplica); L = ${L.toFixed(5)} en rango`;
  return [true, null, msg];
}

function capa3(
  rec: BridgeQtoRecord,
  fam: BridgeFamily,
  pq: number,
  candidato: number | null,
  defsCanal: ReadonlyArray<[string, "qto" | "prop", string]>,
  defsCont: ReadonlyArray<[string, "qto" | "prop", string, string]>
): [string | null, string | null, Record<string, unknown>] {
  if (candidato == null || candidato <= 0) {
    return ["ABSTENCION", "sin_candidato_IFC", {}];
  }

  const f = factorSospechoso(candidato, pq);
  if (f != null) {
    return [
      "SOLO_AUDITADO",
      "unidad_anomala_ifc",
      {
        candidato_IFC: candidato,
        publicado: pq,
        factor: f,
        lectura: "el IFC parece estar en otra unidad; el Excel es coherente",
      },
    ];
  }

  for (const [nombre, origen, clave] of defsCont) {
    if (igual(pq, readRec(rec, origen, clave))) {
      return [null, null, {}];
    }
  }

  const ch = canales(rec, defsCanal);
  const nombreCand = CANDIDATO[fam as "LINEAR" | "WALL" | "HORIZONTAL"]?.[0];
  for (const [nombre, v] of Object.entries(ch)) {
    if (nombre === nombreCand) continue;
    if (igual(pq, v) && rel(v, candidato) > SPREAD_CANALES) {
      const cod = nombre.includes("Gross") ? "publica_area_bruta" : "otro_canal_de_longitud";
      return [
        "CRITERIO",
        cod,
        {
          publicado_es: nombre,
          valor: v,
          candidato,
          separacion_entre_canales: Math.round(rel(v, candidato) * 1e4) / 1e4,
        },
      ];
    }
  }
  return [null, null, {}];
}

export function classifyPublishedQuantity(
  rec: BridgeQtoRecord,
  fam: BridgeFamily,
  pq: number | null,
  unidad: string
): BridgeClassifyResult {
  const g: BridgeCorrectorGates = {
    capa2: null,
    capa2_pasa: null,
    capa1: null,
    capa1_pasa: null,
  };

  const salida = (
    v: string,
    nuevo: number | null,
    cod: string,
    det: Record<string, unknown>,
    origen: BridgeCorrectorOrigin | null = null
  ): BridgeClassifyResult => ({
    veredicto: v,
    nuevo,
    codigo: cod,
    detalle: det,
    origen,
    gates: g,
  });

  if (pq == null) return salida("SIN_DATO", null, "sin_PublishedQuantity", {});

  const u = unidad.trim().toLowerCase();
  const esLineal = fam === "LINEAR" && (u === "m" || u === "jm" || u === "");
  const esArea = (fam === "WALL" || fam === "HORIZONTAL") && (u === "m2" || u === "m²");
  if (!esLineal && !esArea) {
    return salida("NO_APLICA", null, `familia_${fam}_unidad_${u || "vacia"}`, {});
  }

  const [ok2, cod2, r2] = capa2(rec, fam);
  g.capa2 = r2;
  g.capa2_pasa = ok2;
  if (!ok2) return salida("ABSTENCION", null, cod2 ?? "eje_volcado", { capa2: r2 });

  const [ok1, r1] = capa1(rec, fam);
  g.capa1 = r1;
  g.capa1_pasa = ok1;
  if (!ok1) return salida("ABSTENCION", null, "capa1_VA_no_cierra", { capa1: r1 });

  const famCand = fam as "LINEAR" | "WALL" | "HORIZONTAL";
  const [nombreCand, claveCand] = CANDIDATO[famCand];
  const cand = readRec(rec, "qto", claveCand);
  const origen = cand != null ? originFor(claveCand, nombreCand) : null;

  const defsCanal =
    esLineal ? CANALES_LONGITUD : fam === "WALL" ? CANALES_AREA_MURO : CANALES_AREA_HORIZ;
  const defsCont = esLineal ? CONTAMINANTES_LONGITUD : CONTAMINANTES_AREA;

  const [dec3, cod3, det3] = capa3(rec, fam, pq, cand, defsCanal, defsCont);
  if (dec3 != null) {
    return salida(dec3, null, cod3 ?? "", det3, dec3 !== "ABSTENCION" ? origen : null);
  }

  if (cand != null && igual(pq, cand, EPS_IGUAL)) {
    return salida("OK", null, `coincide_con_${claveCand}`, {}, origen);
  }

  for (const [nombre, origenKey, clave, dim] of defsCont) {
    const v = readRec(rec, origenKey, clave);
    if (igual(pq, v)) {
      return salida(
        "CORREGIDO",
        cand,
        "defecto_dimensional",
        {
          publicado_es: nombre,
          dimension: dim,
          valor: v,
          candidato: nombreCand,
          nuevo: cand,
        },
        origen
      );
    }
  }

  if (fam === "WALL" && cand != null) {
    const gs = readRec(rec, "qto", "GrossSideArea");
    const L = readRec(rec, "qto", "Length") ?? 0;
    const H = readRec(rec, "qto", "Height") ?? 0;
    if (
      L > 0 &&
      H > 0 &&
      igual(pq, L * H, EPS_IGUAL) &&
      gs != null &&
      rel(gs, cand) <= 0.01 &&
      rel(cand, L * H) > EPS_IGUAL
    ) {
      return salida(
        "CORREGIDO",
        cand,
        "area_como_rectangulo",
        {
          publicado: pq,
          LxH: Math.round(L * H * 1e4) / 1e4,
          GrossSideArea: gs,
          NetSideArea: cand,
          nuevo: cand,
        },
        origen
      );
    }
  }

  if (cand == null || cand <= AREA_MIN) {
    return salida("ABSTENCION", null, "sin_candidato_IFC", {});
  }

  const ratio = pq / cand;
  const [lo, hi] = esLineal
    ? [RATIO_LIN_MIN, RATIO_LIN_MAX]
    : [RATIO_AREA_MIN, RATIO_AREA_MAX];
  if (ratio < lo || ratio > hi) {
    return salida(
      "CORREGIDO",
      cand,
      "orden_de_magnitud",
      { ratio: Math.round(ratio * 1e6) / 1e6, banda: [lo, hi], nuevo: cand },
      origen
    );
  }

  return salida(
    "EVIDENCIA_AMBIGUA",
    null,
    "discrepancia_fina_sin_origen",
    { ratio: Math.round(ratio * 1e4) / 1e4, canales: canales(rec, defsCanal) },
    origen
  );
}

export function classifyOpeningDimensions(
  rec: BridgeQtoRecord,
  w: number | null,
  h: number | null
): {
  veredicto: string;
  nuevo: [number, number] | null;
  codigo: string;
  detalle: Record<string, unknown>;
} {
  const ow = rec.overallWidth;
  const oh = rec.overallHeight;
  if (!(ow && oh && w && h)) {
    return { veredicto: "ABSTENCION", nuevo: null, codigo: "sin_dims", detalle: {} };
  }
  if (rel(ow, oh) > EPS_COH && rel(w, h) < EPS_COH) {
    return {
      veredicto: "CORREGIDO",
      nuevo: [ow, oh],
      codigo: "W_igual_H_indebido",
      detalle: { store: [w, h], overall: [ow, oh] },
    };
  }
  if (rel(w, ow) > 0.02 || rel(h, oh) > 0.02) {
    return {
      veredicto: "CRITERIO",
      nuevo: null,
      codigo: "modular_vs_overall",
      detalle: {
        store: [w, h],
        overall: [ow, oh],
        holgura: [Math.round((ow - w) * 1e4) / 1e4, Math.round((oh - h) * 1e4) / 1e4],
      },
    };
  }
  return { veredicto: "OK", nuevo: null, codigo: "coincide", detalle: {} };
}

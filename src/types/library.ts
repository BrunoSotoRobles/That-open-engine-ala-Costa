/**
 * Tipos para la librería de asociaciones TALO + tipo de elemento + nombre ↔ Littera + costes.
 * Alineada con la lógica de sugerencias (TaloSuggestionService, LitteraSuggestionService):
 * mismo criterio de coincidencia (taloCode + elementType + namePattern opcional) para usarla
 * como progresión en el tiempo: sugerencias → usuario acepta/refina → exportar a librería →
 * en otro proyecto aplicar librería = sugerencias preaplicadas a elementos que coincidan.
 * Sin identificadores de elemento (p. ej. GUID): la librería es reutilizable entre proyectos.
 */

/** Coste por unidad de medida en el modelo finlandés (material, labor, subcontract).
 *  Al aplicar la librería, coste = costPerUnit × cantidad del elemento.
 */
export interface CostPerUnit {
  material?: number;
  labor?: number;
  subcontract?: number;
  total?: number;
}

export interface LibraryLitteraEntry {
  litteraCode: string;
  litteraName: string;
  litteraCategory?: string;
  unit: string;
  /** Proporción 0–1 de la cantidad del elemento que corresponde a este Littera (varios Littera pueden repartirse la misma unidad). Si no se define, se reparte a partes iguales entre los del mismo unit. */
  quantityRatio?: number;
  /** Coste por unidad (p. ej. €/m²). En aplicación: coste = costPerUnit × cantidad calculada del elemento. */
  costPerUnit?: CostPerUnit;
}

export interface LibraryEntry {
  taloCode: string;
  elementType: string;
  /** Patrón de nombre reutilizable (p. ej. substring o normalizado); vacío = coincide con cualquier nombre. Misma lógica que sugerencias. */
  namePattern?: string;
  /** Unidad TALO para este par taloCode+elementType (m2, m3, kpl, etc.), coherente con getCorrectUnit / TALO_2000_MEASUREMENTS. */
  unit?: string;
  /** Tipo de edificio (residential, commercial, industrial). Vacío = coincide con cualquier tipo. */
  buildingType?: string;
  /** Método constructivo (traditional, prefabricated, modular, renovation). Vacío = coincide con cualquier método. */
  constructionMethod?: string;
  litteraCodes: LibraryLitteraEntry[];
}

export interface CostLibrary {
  version: string;
  updatedAt: string;
  /** Origen y contexto: source = quién generó; buildingType/constructionMethod = contexto del catálogo (ej. "commercial" + "prefabricated"). */
  metadata?: {
    source?: 'export' | 'manual' | 'suggestions';
    buildingType?: string;
    constructionMethod?: string;
  };
  entries: LibraryEntry[];
}

/**
 * Lógica compartida de agrupación y unidades para la tabla de costes (estilo Excel)
 * y para la exportación Excel/CSV en CostPage. Una sola fuente de verdad para
 * normalizar nombres, unidades por tipo IFC y agrupación por tipo + TALO + nombre.
 */
import type { BaseCostElement } from "../types/cost";
import { calculateBaseQuantities } from "./BaseQuantityCalculator";
import { resolveOpeningFrameDimsForPerimeter } from "./QuantityResolution";
import {
  assemblyExcelGroupKey,
  contributesToMaara,
  isConfirmedAssemblyMember,
  publishedMaaraM2,
  resolveAssemblyProductMeta,
} from "./layerAssemblyPolicy";

/**
 * IFC types that represent steel structural elements.
 * Only these types should have weight estimated from volume × 7850 kg/m³
 * when no direct Weight property is available from the model.
 * All other elements (concrete, timber, insulation, doors, slabs...) must NOT
 * inherit this fallback — their KG should stay 0 and be driven by the
 * Littera/Talo2000 scorer ratios (e.g. rebar ratio per m³ of concrete).
 */
const STEEL_IFC_TYPES = new Set([
  "IFCMEMBER",
  "IFCREINFORCINGBAR",
  "IFCREINFORCINGMESH",
  "IFCREINFORCINGELEMENT",
  "IFCPLATE",
  "IFCTENDON",
  "IFCTENDONANCHOR",
]);

/**
 * Name fragments that, combined with non-steel IFC types (IfcColumn, IfcBeam),
 * indicate a steel structural element (e.g. teräspilar, HEA, IPE, S355).
 */
const STEEL_NAME_HINTS = /ter[aä]s|steel|hea|heb|hem|ipe|ipeaa|ipea|upea|rhs|shs|chs|s235|s355|s420|fe360/i;

/**
 * Returns true only for elements whose weight should be estimated from
 * volume × 7850 kg/m³ (steel density) when no Weight is present in base quantities.
 */
function isSteelElement(el: BaseCostElement): boolean {
  const typeUpper = (el.type || "").toUpperCase();
  if (STEEL_IFC_TYPES.has(typeUpper)) return true;
  // IfcColumn / IfcBeam can be concrete or steel — discriminate by name
  if (typeUpper === "IFCCOLUMN" || typeUpper === "IFCBEAM") {
    return STEEL_NAME_HINTS.test(el.name || "");
  }
  return false;
}

/** Normaliza nombres para agrupar variantes Revit (elimina sufijos :123456). */
export function normalizeRevitName(name: string): string {
  if (!name) return name;
  return name.replace(/:\d{3,}$/, "");
}

/** Quita el sufijo visual " (N variants)" de la fila de grupo del Excel. */
export function stripExcelGroupNameSuffix(name: string): string {
  return normalizeRevitName(name || "").replace(/\s+\(\d+\s+variants?\)$/i, "");
}

/** Anfitrión del sándwich, si el grupo está confirmado; si no, el primer elemento. */
export function pickAssemblyGroupLead(elements: BaseCostElement[]): BaseCostElement {
  return (
    elements.find((el) => el.extraProperties?.["CostaBIM.LayerRole"] === "host") ??
    elements[0]
  );
}

/** KPL / texto de variantes: anfitriones, no capas. */
export function assemblyHostCount(elements: BaseCostElement[]): number {
  return elements.filter((el) => el.extraProperties?.["CostaBIM.LayerRole"] === "host").length;
}

/** Área de määrä del grupo: paño publicado (muro) si existe; capas a 0; si no, Area del IFC. */
export function groupMaaraAreaM2(elements: BaseCostElement[]): number {
  return elements.reduce((sum, el) => {
    const published = publishedMaaraM2(el);
    if (published > 0) return sum + published;
    if (!contributesToMaara(el.extraProperties)) return sum;
    return sum + getElArea(el);
  }, 0);
}

/** Volumen del grupo: solo piezas que aportan määrä (no capas del sándwich). */
export function groupMaaraVolumeM3(elements: BaseCostElement[]): number {
  return elements.reduce((sum, el) => {
    if (!contributesToMaara(el.extraProperties)) return sum;
    return sum + getElVolume(el);
  }, 0);
}

/** Largo del grupo: solo piezas que aportan määrä. */
export function groupMaaraLengthM(elements: BaseCostElement[]): number {
  return elements.reduce((sum, el) => {
    if (!contributesToMaara(el.extraProperties)) return sum;
    return sum + getElLength(el);
  }, 0);
}

/** Unidades por tipo IFC (misma jerarquía que Littera/Excel). */
export function getUnitsForIFCType(ifcType: string): string[] {
  const typeUpper = ifcType.toUpperCase();
  if (typeUpper.includes("WALL")) return ["M2", "BRM2", "NM2", "M3", "RM3", "NM3", "JM", "KG", "KPL", "ERÄ"];
  if (typeUpper.includes("SLAB")) return ["M2", "BRM2", "NM2", "M3", "RM3", "NM3", "JM", "KG", "KPL", "ERÄ"];
  if (typeUpper.includes("DOOR")) return ["KPL", "M2", "JM", "AS", "ERÄ"];
  if (typeUpper.includes("WINDOW")) return ["M2", "KPL", "JM", "ERÄ"];
  if (typeUpper.includes("ROOF")) return ["M2", "BRM2", "NM2", "M3", "JM", "KPL", "ERÄ"];
  if (typeUpper.includes("COLUMN") || typeUpper.includes("BEAM")) return ["JM", "M3", "RM3", "NM3", "M2", "KG", "KPL", "ERÄ"];
  return ["M2", "M3", "JM", "KG", "KPL", "ERÄ"];
}

/** Área/volumen/longitud desde baseQuantities (igual que en tabla y Excel). */
export function getElArea(el: BaseCostElement): number {
  const bq = el.baseQuantities ?? {};
  return (bq.Area as { value?: number })?.value ?? (bq.GrossArea as { value?: number })?.value ?? (bq.NetArea as { value?: number })?.value ?? 0;
}
export function getElVolume(el: BaseCostElement): number {
  const bq = el.baseQuantities ?? {};
  return (bq.GrossVolume as { value?: number })?.value ?? (bq.NetVolume as { value?: number })?.value ?? (bq.Volume as { value?: number })?.value ?? 0;
}
export function getElLength(el: BaseCostElement): number {
  const bq = el.baseQuantities ?? {};
  return (bq.Length as { value?: number })?.value ?? 0;
}

/** Cantidades base por unidad para un conjunto de elementos (grupo o fila). */
export function calculateBaseQuantitiesByUnitForElements(
  elems: BaseCostElement[],
  ifcType: string
): { [unit: string]: number | "" } {
  const unitsForType = getUnitsForIFCType(ifcType);
  const typeUpper = ifcType.toUpperCase();
  const quantitiesByUnit: { [unit: string]: number | "" } = {};
  unitsForType.forEach((u) => { quantitiesByUnit[u] = ""; });
  let totalNetArea = 0, totalGrossArea = 0, totalArea = 0;
  let totalNetVolume = 0, totalGrossVolume = 0, totalVolume = 0;
  let totalLength = 0, totalWeight = 0, totalPerimeter = 0;
  let elementsWithNetArea = 0, elementsWithGrossArea = 0, elementsWithNetVolume = 0, elementsWithGrossVolume = 0;
  const hostCount = assemblyHostCount(elems);
  const layerOnly =
    elems.length > 0 &&
    elems.every((el) => el.extraProperties?.["CostaBIM.LayerRole"] === "layer");
  elems.forEach((el) => {
    if (el.extraProperties?.["CostaBIM.PublishedBlocked"] === 1) return;
    const c = calculateBaseQuantities(el.baseQuantities || {}, el.type || ifcType);
    const elTypeUpper = (el.type || ifcType).toUpperCase();
    const isDoorOrWindow = elTypeUpper.includes('DOOR') || elTypeUpper.includes('WINDOW');
    const skipMaaraArea =
      isConfirmedAssemblyMember(el.extraProperties) && !contributesToMaara(el.extraProperties);

    // Para puertas/ventanas: calcular área desde Overall* cuando está disponible.
    // OverallWidth × OverallHeight es el área del vano nominal — más fiable que el QTO.
    const bqRaw = el.baseQuantities || {};
    const overallW = (bqRaw['OverallWidth'] as { value?: number } | undefined)?.value ?? 0;
    const overallH = (bqRaw['OverallHeight'] as { value?: number } | undefined)?.value ?? 0;
    const overallArea = isDoorOrWindow && overallW > 0 && overallH > 0 ? overallW * overallH : 0;

    const skipMaaraGeom = !contributesToMaara(el.extraProperties);

    if (!skipMaaraArea) {
      const published = publishedMaaraM2(el);
      const netArea = published > 0
        ? published
        : (overallArea > 0 ? overallArea : (c.NetArea || c.NetSideArea || 0));
      if (netArea > 0) { totalNetArea += netArea; elementsWithNetArea++; }
      const grossArea = published > 0
        ? published
        : (overallArea > 0 ? overallArea : (c.GrossArea || (c.GrossSideArea ?? (c.Area ?? 0))));
      if (grossArea > 0) { totalGrossArea += grossArea; elementsWithGrossArea++; }
      totalArea += published > 0
        ? published
        : (overallArea > 0 ? overallArea : (c.Area || c.GrossArea || c.NetArea || 0));
    }
    if (!skipMaaraGeom) {
    const netVolume = c.NetVolume || 0;
    if (netVolume > 0) { totalNetVolume += netVolume; elementsWithNetVolume++; }
    const grossVolume = c.GrossVolume || c.Volume || 0;
    if (grossVolume > 0) { totalGrossVolume += grossVolume; elementsWithGrossVolume++; }
    totalVolume += c.Volume || c.GrossVolume || c.NetVolume || 0;
    totalLength += c.Length || 0;
    if (c.Weight) {
      totalWeight += c.Weight;
    } else if (isSteelElement(el)) {
      // Estimate weight from volume only for confirmed steel elements.
      // For all other types (concrete, timber, doors, slabs…) leave weight at 0
      // so the Littera/Talo2000 scorer can apply the correct ratio (e.g. ~70 kg/m³
      // of rebar per m³ of concrete) instead of treating everything as solid steel.
      // NetVolume first: hollow profiles (SHS, RHS, CHS) export GrossVolume (solid)
      // and NetVolume (actual steel). Using GrossVolume gives ~5x inflated weight.
      const v = c.NetVolume || c.GrossVolume || c.Volume || 0;
      if (v > 0) totalWeight += v * 7850;
    }
    }
    if (typeUpper.includes("DOOR") || typeUpper.includes("WINDOW")) {
      const resolved = resolveOpeningFrameDimsForPerimeter(el.type || ifcType, el.baseQuantities || {});
      if (resolved && resolved.openingWidth > 0 && resolved.openingHeight > 0) {
        const { openingWidth: ow, openingHeight: oh } = resolved;
        if (typeUpper.includes("DOOR")) totalPerimeter += 2 * oh + ow;
        else totalPerimeter += 2 * (ow + oh);
      } else {
        const w = c.Width,
          h = c.Height;
        if (w != null && h != null) {
          if (typeUpper.includes("DOOR")) totalPerimeter += 2 * h + w;
          else totalPerimeter += 2 * (w + h);
        } else if (c.Length) totalPerimeter += c.Length;
      }
    }
  });
  unitsForType.forEach((unit) => {
    const u = unit.toUpperCase();
    if (u === "KPL") {
      if (hostCount > 0) quantitiesByUnit[unit] = hostCount;
      else if (layerOnly) quantitiesByUnit[unit] = 0;
      else quantitiesByUnit[unit] = elems.length;
    }
    else if (u === "ERÄ") quantitiesByUnit[unit] = elems.length > 0 ? 1 : "";
    else if (u === "M2") {
      const v = elementsWithNetArea > 0 ? totalNetArea : (totalGrossArea || totalArea);
      quantitiesByUnit[unit] = v > 0 ? v : (layerOnly ? 0 : "");
    }
    else if (u === "NM2") quantitiesByUnit[unit] = totalNetArea > 0 ? totalNetArea : (layerOnly ? 0 : "");
    else if (u === "BRM2") quantitiesByUnit[unit] = totalGrossArea > 0 ? totalGrossArea : (layerOnly ? 0 : "");
    else if (u === "AS") quantitiesByUnit[unit] = (totalNetArea || totalGrossArea || totalArea) ? (totalNetArea || totalGrossArea || totalArea) : (layerOnly ? 0 : "");
    else if (u === "M3") quantitiesByUnit[unit] = elementsWithNetVolume > 0 ? totalNetVolume : (totalGrossVolume || totalVolume) || "";
    else if (u === "NM3") quantitiesByUnit[unit] = totalNetVolume > 0 ? totalNetVolume : "";
    else if (u === "RM3") quantitiesByUnit[unit] = (totalGrossVolume || totalVolume) ? (totalGrossVolume || totalVolume) : "";
    else if (u === "JM" || u === "M") quantitiesByUnit[unit] = (typeUpper.includes("DOOR") || typeUpper.includes("WINDOW")) ? (totalPerimeter > 0 ? totalPerimeter : "") : (totalLength > 0 ? totalLength : "");
    else if (u === "KG") quantitiesByUnit[unit] = totalWeight > 0 ? totalWeight : "";
  });
  return quantitiesByUnit;
}

export interface GroupedCostData {
  elementsByType: Map<string, Map<string, BaseCostElement[]>>;
  groupKeyToType: Map<string, string>;
}

/** Agrupa costData por tipo IFC y por (TALO + nombre normalizado). Misma lógica que tabla y Excel. */
export function buildGroupedData(costData: BaseCostElement[]): GroupedCostData {
  const elementsByType = new Map<string, Map<string, BaseCostElement[]>>();
  const groupKeyToType = new Map<string, string>();
  const product = resolveAssemblyProductMeta(costData);
  const hostType =
    costData.find((el) => el.extraProperties?.["CostaBIM.LayerRole"] === "host")?.type ||
    "IfcWall";

  costData.forEach((element) => {
    const assemblyKey = assemblyExcelGroupKey(element, product);
    const normalizedTaloCode = assemblyKey
      ? product!.taloCode
      : (element.taloCode || "").trim();
    const normalizedName = assemblyKey
      ? product!.productName
      : normalizeRevitName(element.name);
    const groupKey = assemblyKey ?? `${normalizedTaloCode}-${normalizedName}`;

    let targetType = groupKeyToType.get(groupKey);
    if (!targetType) {
      targetType = assemblyKey ? hostType : (element.type || "Unknown");
      groupKeyToType.set(groupKey, targetType);
    }

    if (!elementsByType.has(targetType)) {
      elementsByType.set(targetType, new Map());
    }
    const typeMap = elementsByType.get(targetType)!;
    if (!typeMap.has(groupKey)) {
      typeMap.set(groupKey, []);
    }
    typeMap.get(groupKey)!.push(element);
  });

  return { elementsByType, groupKeyToType };
}

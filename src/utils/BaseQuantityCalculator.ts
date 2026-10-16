/**
 * Base Quantity Calculator - Calculadora Centralizada de Cantidades Base
 * 
 * Esta función centraliza la lógica para calcular cantidades base (área, volumen, etc.)
 * usando una estrategia consistente en toda la aplicación:
 * 1. Intentar obtener valores directos de baseQuantities (IFC)
 * 2. Si no hay, calcular desde geometría (si está disponible)
 * 3. Si no hay geometría, usar fallback volumen/espesor
 * 
 * @version 1.0.0
 * @created 2024
 */

import * as FRAGS from "@thatopen/fragments";
import { detectWidthEqualsLength } from "./widthLengthSignal";
import { rejectPoisonedGeometricDimensions } from "./instancedBBoxGuard";

export interface BaseQuantities {
  [key: string]: {
    value: number;
    unit: string;
  };
}

export interface GeometricDimensions {
  width: number;
  length: number;
  height: number;
  area: number;
  volume: number;
}

export interface CalculatedBaseQuantities {
  NetArea?: number;
  GrossArea?: number;
  Area?: number;
  NetSideArea?: number;
  GrossSideArea?: number;
  NetVolume?: number;
  GrossVolume?: number;
  Volume?: number;
  Length?: number;
  Width?: number;
  Height?: number;
  Weight?: number;
}

/**
 * Calcula dimensiones desde la geometría del primer fragmento que contiene el elemento.
 *
 * NOTA: fragment.mesh es un mesh COMPARTIDO entre todos los elementos del mismo material.
 * Fusionar los bboxes de todos los fragmentos que contienen el elementId daría el bbox
 * del mesh completo (todos los elementos del material), no del objeto individual.
 * El primer fragmento ofrece una aproximación razonable para el fallback geométrico.
 * Este path solo se activa cuando el IFC no tiene QTO suficiente.
 */
export function calculateDimensionsFromGeometry(
  model: FRAGS.FragmentsGroup,
  elementId: number
): GeometricDimensions | null {
  try {
    for (const fragment of model.items) {
      if (!fragment.ids.has(elementId)) continue;
      const geometry = fragment.mesh?.geometry;
      if (!geometry) continue;
      const position = geometry.attributes.position.array;
      if (!position) continue;

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      for (let i = 0; i < position.length; i += 3) {
        const px = position[i], py = position[i + 1], pz = position[i + 2];
        if (isFinite(px) && isFinite(py) && isFinite(pz)) {
          minX = Math.min(minX, px); maxX = Math.max(maxX, px);
          minY = Math.min(minY, py); maxY = Math.max(maxY, py);
          minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
        }
      }

      if (!isFinite(minX)) break;

      const rawWidth  = Math.abs(maxX - minX);
      const rawLength = Math.abs(maxY - minY);
      const rawHeight = Math.abs(maxZ - minZ);

      // Detección mm→m basada en EXTENSIÓN (no en posición absoluta):
      // Si alguna dimensión supera 100 unidades → mm (ningún elemento
      // de construcción mide > 100 m; pero sí puede medir > 100 mm).
      const scaleFactor = Math.max(rawWidth, rawLength, rawHeight) > 100 ? 0.001 : 1;

      const width  = rawWidth  * scaleFactor;
      const length = rawLength * scaleFactor;
      const height = rawHeight * scaleFactor;
      // D3: do not publish building-scale shared-mesh bbox as element size
      if (rejectPoisonedGeometricDimensions({ width, length, height })) {
        return null;
      }
      const area   = length * height;
      const volume = width * length * height;

      return { width, length, height, area, volume };
    }
  } catch (error) {
    console.warn(`[BaseQuantityCalculator] Error calculating dimensions from geometry for element ${elementId}:`, error);
  }

  return null;
}

/**
 * Calcula cantidades base usando estrategia consistente:
 * 1. IFC directo (baseQuantities)
 * 2. Geometría (si model y elementId están disponibles)
 * 3. Fallback volumen/espesor
 * 
 * @param baseQuantities - Cantidades base del IFC (pueden estar incompletas)
 * @param ifcType - Tipo IFC del elemento (IfcWall, IfcSlab, etc.)
 * @param model - Modelo IFC (opcional, para cálculo desde geometría)
 * @param elementId - ID del elemento (opcional, para cálculo desde geometría)
 * @returns Cantidades base calculadas/completadas
 */
export function calculateBaseQuantities(
  baseQuantities: BaseQuantities,
  ifcType: string,
  model?: FRAGS.FragmentsGroup,
  elementId?: number
): CalculatedBaseQuantities {
  const typeUpper = ifcType.toUpperCase();
  const result: CalculatedBaseQuantities = {};
  
  // Copiar valores directos del IFC si existen
  Object.keys(baseQuantities).forEach(key => {
    const qty = baseQuantities[key];
    if (qty && typeof qty.value === 'number') {
      (result as any)[key] = qty.value;
    }
  });
  
  // Para IfcDoor / IfcWindow: si hay OverallWidth y OverallHeight (atributos directos
  // de la entidad IFC), calcular el área del vano y usarla como GrossArea y NetArea.
  // Estos atributos son más fiables que el QTO o la geometría del bounding box.
  if (typeUpper.includes('DOOR') || typeUpper.includes('WINDOW')) {
    const ow = (result as any)['OverallWidth'] as number | undefined;
    const oh = (result as any)['OverallHeight'] as number | undefined;
    if (ow && oh && ow > 0 && oh > 0) {
      result.Width = ow;
      result.Height = oh;
      const overallArea = ow * oh;
      if (!result.GrossArea) result.GrossArea = overallArea;
      if (!result.Area) result.Area = overallArea;
      // NetArea: usar Overall* solo si el QTO NetArea es claramente incorrecto
      // (ratio > 10 entre Overall y QTO indica que el QTO tiene el espesor, no el vano).
      const existingNet = result.NetArea ?? 0;
      if (!existingNet || (existingNet > 0 && overallArea / existingNet > 10)) {
        result.NetArea = overallArea;
      }
    }
  }

  // MAPEO: Para muros, NetSideArea/GrossSideArea ↔ NetArea/GrossArea
  // No promover Area genérica a SideArea si parece sección de canto (Paso 2).
  if (typeUpper.includes('WALL')) {
    const w = result.Width;
    const l = result.Length;
    const h = result.Height;
    const areaLooksLikeCanto =
      result.Area != null &&
      h != null &&
      w != null &&
      l != null &&
      Math.min(w, l) * h > 0 &&
      Math.abs(result.Area - Math.min(w, l) * h) / (Math.min(w, l) * h) < 0.08;

    if (result.NetSideArea && !result.NetArea) {
      result.NetArea = result.NetSideArea;
    }
    if (result.GrossSideArea && !result.GrossArea) {
      result.GrossArea = result.GrossSideArea;
    }
    if (result.NetArea && !result.NetSideArea && !areaLooksLikeCanto) {
      result.NetSideArea = result.NetArea;
    }
    if (result.GrossArea && !result.GrossSideArea && !areaLooksLikeCanto) {
      result.GrossSideArea = result.GrossArea;
    }
  }
  
  // Calcular desde geometría si no hay valores directos y tenemos modelo
  let geometricDimensions: GeometricDimensions | null = null;
  if (model && elementId) {
    geometricDimensions = calculateDimensionsFromGeometry(model, elementId);
  }
  
  // ESTRATEGIA CORRECTA: Preservar diferencias Net/Gross del IFC
  // - Gross: incluye TODO (muros, columnas, aberturas, etc.)
  // - Net: excluye aberturas, cortes, elementos internos
  // - Al calcular desde geometría/volumen: solo podemos obtener Gross (incluye todo)
  // - NO asignar a Net cuando calculamos (no sabemos qué restar)
  
  // Calcular áreas si faltan (solo GrossArea/Area genérica, NO NetArea)
  const needsGrossAreaCalculation = !result.GrossArea && !result.Area && !result.GrossSideArea;
  
  if (needsGrossAreaCalculation) {
    // Intentar desde geometría primero (geometría = Gross, incluye todo)
    if (geometricDimensions) {
      let calculatedGrossArea: number;
      
      if (typeUpper.includes('WALL')) {
        // Para muros: área lateral = length × height
        calculatedGrossArea = geometricDimensions.area;
        // Solo asignar si no existe del IFC (preservar valores originales)
        if (!result.GrossSideArea) {
          result.GrossSideArea = calculatedGrossArea;
        }
      } else if (typeUpper.includes('SLAB')) {
        // Para losas: área = width × length
        calculatedGrossArea = geometricDimensions.width * geometricDimensions.length;
      } else if (typeUpper.includes('WINDOW') || typeUpper.includes('DOOR')) {
        // Para ventanas/puertas: área = width × height
        calculatedGrossArea = geometricDimensions.width * geometricDimensions.height;
      } else if (typeUpper.includes('ROOF') || typeUpper.includes('COVERING')) {
        // Para techos/revestimientos: área = width × length
        calculatedGrossArea = geometricDimensions.width * geometricDimensions.length;
      } else {
        // Para otros elementos: usar área más grande disponible
        calculatedGrossArea = Math.max(
          geometricDimensions.width * geometricDimensions.length,
          geometricDimensions.width * geometricDimensions.height,
          geometricDimensions.length * geometricDimensions.height
        );
      }
      
      // Asignar solo a GrossArea/Area genérica (NO a NetArea)
      // Solo asignar si no existen del IFC (preservar valores originales)
      if (!result.Area) {
        result.Area = calculatedGrossArea;
      }
      if (!result.GrossArea) {
        result.GrossArea = calculatedGrossArea;
      }
      
      // Para muros: si calculamos GrossSideArea, también mapear a GrossArea (si no existe)
      if (typeUpper.includes('WALL') && result.GrossSideArea && !result.GrossArea) {
        result.GrossArea = result.GrossSideArea;
      }
    }
    
    // Fallback: calcular desde volumen y espesor (volumen = Gross, incluye todo)
    if (!result.Area && (typeUpper.includes('WALL') || typeUpper.includes('SLAB') || 
                         typeUpper.includes('ROOF') || typeUpper.includes('COVERING'))) {
      // Usar GrossVolume primero, luego Volume genérico
      const volume = result.GrossVolume || result.Volume || 0;
      const width = result.Width || baseQuantities.Width?.value || 0;
      const length = result.Length || baseQuantities.Length?.value || 0;
      const height = result.Height || baseQuantities.Height?.value || 0;
      // Paso 3: Width≈Length → Width no es espesor fiable; preferir Height
      const widthEqLength = detectWidthEqualsLength(
        {
          Width: width > 0 ? { value: width } : undefined,
          Length: length > 0 ? { value: length } : undefined,
        },
        typeUpper
      );
      const thickness = widthEqLength
        ? (height > 0 ? height : 0)
        : width;

      if (volume > 0 && thickness > 0) {
        const calculatedGrossArea = volume / thickness;
        // Asignar solo a GrossArea/Area genérica (NO a NetArea)
        // Solo asignar si no existen del IFC (preservar valores originales)
        if (!result.Area) {
          result.Area = calculatedGrossArea;
        }
        if (!result.GrossArea) {
          result.GrossArea = calculatedGrossArea;
        }
        if (typeUpper.includes('WALL') && !result.GrossSideArea) {
          result.GrossSideArea = calculatedGrossArea;
          // Mapear GrossSideArea calculado a GrossArea
          if (!result.GrossArea) {
            result.GrossArea = calculatedGrossArea;
          }
        }
      }
    }
    
    // MAPEO FINAL: Después de calcular, mapear valores calculados para muros
    if (typeUpper.includes('WALL')) {
      // Si calculamos GrossSideArea pero no GrossArea, mapear
      if (result.GrossSideArea && !result.GrossArea) {
        result.GrossArea = result.GrossSideArea;
      }
      // Si calculamos GrossArea pero no GrossSideArea, mapear
      if (result.GrossArea && !result.GrossSideArea) {
        result.GrossSideArea = result.GrossArea;
      }
    }
  }
  
  // Volumen: priorizar siempre QTO IFC antes de fallback geométrico.
  // Si falta Volume, reutilizar GrossVolume/NetVolume cuando existan.
  if (!result.Volume) {
    if (result.GrossVolume) result.Volume = result.GrossVolume;
    else if (result.NetVolume) result.Volume = result.NetVolume;
  }
  // Fallback geométrico SOLO cuando no hay ningún volumen IFC.
  if (geometricDimensions) {
    if (!result.GrossVolume) {
      result.GrossVolume = geometricDimensions.volume;
    }
    if (!result.Volume) {
      result.Volume = geometricDimensions.volume;
    }
  }
  
  const openingType = typeUpper.includes("DOOR") || typeUpper.includes("WINDOW");
  const hasOpeningSemantics =
    openingType &&
    (result as any).OverallWidth > 0 &&
    (result as any).OverallHeight > 0;

  // Calcular dimensiones desde geometría si faltan
  if (geometricDimensions) {
    if (!result.Width && !hasOpeningSemantics && geometricDimensions.width > 0) {
      result.Width = geometricDimensions.width;
    }
    if (!result.Length && geometricDimensions.length > 0) {
      result.Length = geometricDimensions.length;
    }
    if (!result.Height && !hasOpeningSemantics && geometricDimensions.height > 0) {
      result.Height = geometricDimensions.height;
    }
  }
  
  // Calcular peso desde volumen si falta (solo para acero, densidad 7850 kg/m³)
  if (!result.Weight) {
    const volume = result.GrossVolume || result.NetVolume || result.Volume || 0;
    if (volume > 0) {
      // Solo calcular peso si parece ser acero (esto se puede mejorar con detección de material)
      // Por ahora, solo calcular si no hay peso directo
      // result.Weight = volume * 7850; // Comentado: solo calcular si sabemos que es acero
    }
  }
  
  return result;
}

/**
 * Convierte CalculatedBaseQuantities a formato BaseQuantities (con unidades)
 */
export function toBaseQuantitiesFormat(
  calculated: CalculatedBaseQuantities
): BaseQuantities {
  const result: BaseQuantities = {};
  
  Object.keys(calculated).forEach(key => {
    const value = (calculated as any)[key];
    if (typeof value === 'number') {
      // Determinar unidad según el tipo de cantidad
      let unit = 'm';
      if (key.includes('Area') || key === 'Area') {
        unit = 'm²';
      } else if (key.includes('Volume') || key === 'Volume') {
        unit = 'm³';
      } else if (key === 'Weight') {
        unit = 'kg';
      } else if (key === 'Length' || key === 'Width' || key === 'Height') {
        unit = 'm';
      }
      
      result[key] = { value, unit };
    }
  });
  
  return result;
}

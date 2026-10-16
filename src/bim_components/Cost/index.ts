import * as WEBIFC from "web-ifc"
import * as OBC from "@thatopen/components"
import * as FRAGS from "@thatopen/fragments"
import { Component, Components, Event } from '@thatopen/components';
import { ElementData, BaseCostElement } from '../../types/cost/shared';
import { MaterialCostsTableData } from '../../types/cost/elements';
import type { IFCQuantityValue } from '../../types/cost';
import { getTalo2000Quantity, TALO_2000_MEASUREMENTS, getCorrectQuantity, getQuantityForLitteraCodeByType } from '../../constants/talo2000';
import { Talo2000Unit } from '../../types/talo2000';
import { LitteraFilteringService } from '../../services/LitteraFilteringService';
import { TaloLitteraMappingService } from '../../services/TaloLitteraMappingService';
import { UnifiedCostService } from '../../services/UnifiedCostService';
import { IFCQuantityService } from '../../services/IFCQuantityService';
import { calculateBaseQuantities, toBaseQuantitiesFormat } from '../../utils/BaseQuantityCalculator';
import { resolveOpeningFrameDimsForPerimeter } from '../../utils/QuantityResolution';
import { useCostStore } from '../../stores/CostStore';
import { detectOnteloType } from '../../utils/ontelolaattaUtils';
import {
  buildOntelolaattaLitteraPackage,
  isConfirmedOntelolaattaElement,
  lookupConfirmedOntelolaattaEntry,
  resolveOntelolaattaMeasurements,
} from '../../utils/ontelolaattaLitteraPackage';
import { isMeasurementExcluded } from '../../utils/measurementExclusions';
import {
  applyWidthLengthSignalToElement,
  getReliableProfileWidth,
} from '../../utils/widthLengthSignal';
import { applyWallFacePolicyToElement, resolveWallFaceArea } from '../../utils/wallFaceArea';
import { COSTA_LINEAR_PROFILE_LENGTH_V1 } from '../../utils/measurementFeatureFlags';
import {
  applyQtoPreservePolicies,
  shouldSkipStructuralLengthMutation,
} from '../../utils/qtoPreservePolicy';
import { readDimensionsMetres } from '../../utils/ifcExtraQuantityReaders';
import { applyMeasurementReliabilityFinalPass, isProfileLengthSuspect } from '../../utils/measurementReliability';
import { applyBridgeCorrectorStorePass } from '../../utils/measurementBridgeCorrector/storePass';
import { applyHollowSectionPolicyToElement } from '../../utils/hollowSectionPolicy';
import {
  applyInstancedBBoxGuardToElement,
  rejectPoisonedGeometricDimensions,
} from '../../utils/instancedBBoxGuard';
import { applyOnteloQuantityPolicyToElement } from '../../utils/onteloQuantityPolicy';
import { applyFamilyQuantityPolicyToElement } from '../../utils/familyQuantityPolicy';
import { applyLayerAssemblyPolicyToElement } from '../../utils/layerAssemblyPolicy';
// import { resolveQuantityShadow } from '../../utils/QuantityResolution';
// NEUTRALIZED (2026-04-27): quantityResolution shadow metadata is disabled.

export const IFC = {
  IFCQUANTITYLENGTH: 357,
  IFCELEMENTQUANTITY: 358,
  IFCQUANTITYVOLUME: 359,
  IFCQUANTITYAREA: 360,
  IFCRELASSOCIATESCLASSIFICATION: 647927063,
  IFCCLASSIFICATIONREFERENCE: 437
};

interface MaterialCostsTable {
  columns: Array<{
    header: string;
    dataField: string;
    width: string;
    sortable: boolean;
  }>;
  data: MaterialCostsTableData[];
}

export class CostCalculator extends OBC.Component {
  static uuid = "0104dd2c-3ce7-4b94-8a6e-63218d497154"
  enabled = true
  onDisposed: OBC.Event<any>
  onMaterialCostsComputed: OBC.Event<BaseCostElement[]>
  onProgress: OBC.Event<number>
  onError: OBC.Event<Error>
  private _results: BaseCostElement[] = []
  /** Cache ReferencedSource expressID → is TALO (per run) to avoid repeated getProperties for the same IfcClassification */
  private _taloSourceCache = new Map<number, boolean>()
  private fragments: OBC.FragmentsManager
  private litteraFilteringService: LitteraFilteringService
  private mappingService: TaloLitteraMappingService

  materialCostsTable: MaterialCostsTable = {
    columns: [
      { header: 'TALO Code', dataField: 'taloCode', width: '15%', sortable: true },
      { header: 'Element Type', dataField: 'type', width: '25%', sortable: true },
      { header: 'Element Name', dataField: 'name', width: '25%', sortable: true },
      { header: 'Material Cost', dataField: 'materialCost', width: '15%', sortable: true },
      { header: 'Total Cost', dataField: 'totalCost', width: '20%', sortable: true }
    ],
    data: [{
      id: '0',
      name: 'No data',
      description: 'No data available',
      type: '-',
      category: '-',
      taloCode: '-',
      materialCost: 0,
      laborCost: 0,
      subcontractCost: 0,
      totalCost: 0
    }]
  }

  constructor(components: OBC.Components) {
    super(components)
    this.components = components
    this.fragments = components.get(OBC.FragmentsManager)
    this.litteraFilteringService = new LitteraFilteringService()
    this.mappingService = TaloLitteraMappingService.getInstance()
    
    this.onDisposed = new OBC.Event()
    this.onMaterialCostsComputed = new OBC.Event()
    this.onProgress = new OBC.Event()
    this.onError = new OBC.Event()
  }

  /**
   * Revisa y reporta las unidades del modelo IFC
   * Esto ayuda a diagnosticar problemas de conversión de unidades
   */
  // Cache para almacenar las unidades del modelo (para evitar múltiples consultas)
  private modelLengthUnit: 'mm' | 'm' | 'unknown' = 'unknown';
  // Cache para almacenar el software de origen por modelo (modelId → software)
  private modelSourceSoftwareCache = new Map<string, 'Revit' | 'ArchiCAD' | 'SketchUp' | 'Tekla' | 'Unknown'>();

  private parseFiniteNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private hasKnownUnitMismatchRatio(a: number, b: number): boolean {
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) <= Number.EPSILON) {
      return false;
    }
    const ratio = Math.abs(a / b);
    // Factores fisicos de conversion lineal (longitud).
    // Evitamos factores como 10/100 para no mezclar problemas de origen de dato
    // (por ejemplo agregaciones de Revit) con conversion de unidades.
    const factors = [25.4, 304.8, 1000];
    const rel = (x: number, y: number) => Math.abs(x - y) / Math.abs(y);
    return factors.some((f) => rel(ratio, f) <= 0.02 || rel(ratio, 1 / f) <= 0.02);
  }

  /**
   * Capa liviana de reconciliación (sin costo geométrico):
   * cuando hay dos fuentes para la misma magnitud (BQ vs Dimensions.*)
   * y detectamos ratio de unidad conocido, priorizamos Dimensions.*.
   *
   * Pass 3 (resolveStructuralLength): longitud estructural para elementos lineales.
   * Se repite tras calculateBaseQuantities para modelos Revit sin Tekla Quantity.
   */
  private reconcileDimensionConflicts(
    quantities: { [key: string]: IFCQuantityValue },
    extraProperties: Record<string, string | number>,
    ifcType: string = ''
  ): void {
    const linearMetricKeys = ["Perimeter", "Length", "Width", "Height"] as const;

    // Pass 1: BQ vs Dimensions.* (exact key match, same unit assumed)
    const dimensionsMapping: Array<{ quantityKey: string; dimensionKey: string }> = [
      { quantityKey: "Perimeter", dimensionKey: "Dimensions.Perimeter" },
      { quantityKey: "Length", dimensionKey: "Dimensions.Length" },
      { quantityKey: "Width", dimensionKey: "Dimensions.Width" },
      { quantityKey: "Height", dimensionKey: "Dimensions.Height" },
    ];

    for (const pair of dimensionsMapping) {
      const baseValue = this.parseFiniteNumber(quantities[pair.quantityKey]?.value);
      const dimValue = this.parseFiniteNumber(extraProperties[pair.dimensionKey]);
      if (
        baseValue === null ||
        dimValue === null ||
        Math.abs(baseValue) <= Number.EPSILON ||
        dimValue <= 0
      ) {
        continue;
      }
      if (!this.hasKnownUnitMismatchRatio(dimValue, baseValue)) {
        continue;
      }
      const currentUnit = quantities[pair.quantityKey]?.unit;
      quantities[pair.quantityKey] = {
        value: dimValue,
        unit:
          currentUnit ??
          (pair.quantityKey === "Area" ? "m²" : pair.quantityKey === "Volume" ? "m³" : "m"),
      };
    }

    // Pass 2: BQ vs Tekla Quantity.* (linear metrics only)
    // Tekla Quantity Psets export linear values in mm; we normalize to m before comparison.
    // Guard: if normalizedTekla < 0.01 m (1 cm), assume Tekla was NOT in mm and skip.
    for (const quantityKey of linearMetricKeys) {
      const bqValue = this.parseFiniteNumber(quantities[quantityKey]?.value);
      if (bqValue === null || Math.abs(bqValue) <= Number.EPSILON) continue;

      const suffix = quantityKey.toLowerCase();
      const teklaRawKey = Object.keys(extraProperties).find((k) => {
        const l = k.toLowerCase();
        return l.startsWith("tekla quantity.") && l.endsWith(suffix);
      });
      if (!teklaRawKey) continue;

      const teklaRaw = this.parseFiniteNumber(extraProperties[teklaRawKey]);
      if (teklaRaw === null || teklaRaw <= 0) continue;

      const normalizedTekla = teklaRaw / 1000;
      if (normalizedTekla < 0.01) continue;

      if (!this.hasKnownUnitMismatchRatio(bqValue, normalizedTekla)) continue;

      const currentUnit = quantities[quantityKey]?.unit;
      quantities[quantityKey] = {
        value: normalizedTekla,
        unit: currentUnit ?? "m",
      };
    }

    this.resolveStructuralLength(quantities, extraProperties, ifcType);
  }

  /**
   * Corrige quantities.Length para elementos lineales (pilares, vigas, barandillas, tuberías…).
   * Prioridad: pituus > Tekla Quantity.Length > eje dominante (max L/W/H cuando ratio > 3).
   * Debe ejecutarse también tras calculateBaseQuantities (Revit suele rellenar H/L/W ahí).
   */
  private resolveStructuralLength(
    quantities: { [key: string]: IFCQuantityValue },
    extraProperties: Record<string, string | number>,
    ifcType: string
  ): void {
    const typeUpper = ifcType.toUpperCase();
    const isLinearType =
      typeUpper.includes('COLUMN') ||
      typeUpper.includes('PILE') ||
      typeUpper.includes('BEAM') ||
      typeUpper.includes('WALL') ||
      typeUpper.includes('MEMBER') ||
      typeUpper.includes('RAILING') ||
      typeUpper.includes('PIPE') ||
      typeUpper.includes('CABLE');

    if (!isLinearType) return;

    if (shouldSkipStructuralLengthMutation(quantities, ifcType)) {
      return;
    }

    const getTeklaM = (suffix: string): number => {
      const key = Object.keys(extraProperties).find(
        (k) => k.toLowerCase() === `tekla quantity.${suffix}`
      );
      if (!key) return 0;
      const v = this.parseFiniteNumber(extraProperties[key]);
      if (!v || v <= 0) return 0;
      return v > 100 ? v / 1000 : v;
    };

    let pituusM: number | null = null;

    const teklaPituusKey = Object.keys(extraProperties).find((k) => {
      const l = k.toLowerCase();
      return l.startsWith('tekla quantity.') && l.endsWith('pituus');
    });

    if (teklaPituusKey) {
      const raw = this.parseFiniteNumber(extraProperties[teklaPituusKey]);
      if (raw !== null && raw > 0) {
        pituusM = raw > 100 ? raw / 1000 : raw;
      }
    }

    if (pituusM === null) {
      const otherPituusKey = Object.keys(extraProperties).find((k) =>
        k.toLowerCase().endsWith('.pituus')
      );
      if (otherPituusKey) {
        const raw = this.parseFiniteNumber(extraProperties[otherPituusKey]);
        if (raw !== null && raw > 0) {
          pituusM = raw > 100 ? raw / 1000 : raw;
        }
      }
    }

    if (pituusM === null) {
      const teklaLenM = getTeklaM('length');
      const currentBqLen = this.parseFiniteNumber(quantities['Length']?.value) ?? 0;
      if (teklaLenM >= 0.3 && teklaLenM <= 300) {
        const preferTekla =
          currentBqLen === 0 ||
          teklaLenM / Math.max(currentBqLen, 0.001) > 3 ||
          (COSTA_LINEAR_PROFILE_LENGTH_V1 &&
            !typeUpper.includes('WALL') &&
            isProfileLengthSuspect(currentBqLen, teklaLenM, currentBqLen, extraProperties, quantities));
        if (preferTekla) {
          pituusM = teklaLenM;
        }
      }
      if (
        pituusM === null &&
        COSTA_LINEAR_PROFILE_LENGTH_V1 &&
        !typeUpper.includes('WALL') &&
        currentBqLen > 0
      ) {
        const dimLen = readDimensionsMetres(extraProperties, 'length');
        if (dimLen != null && dimLen >= 0.3 && dimLen <= 300) {
          if (
            isProfileLengthSuspect(currentBqLen, dimLen, currentBqLen, extraProperties, quantities) ||
            dimLen / Math.max(currentBqLen, 0.001) > 3
          ) {
            pituusM = dimLen;
          }
        }
      }
    }

    const currentBqLenForMin = this.parseFiniteNumber(quantities['Length']?.value) ?? 0;
    const profileSuspect =
      COSTA_LINEAR_PROFILE_LENGTH_V1 &&
      isProfileLengthSuspect(currentBqLenForMin, pituusM, currentBqLenForMin, extraProperties, quantities);
    const minLenM = profileSuspect ? 0.05 : 0.3;
    if (pituusM !== null && (pituusM < minLenM || pituusM > 300)) {
      pituusM = null;
    }

    const L = this.parseFiniteNumber(quantities['Length']?.value) || getTeklaM('length');
    const W = this.parseFiniteNumber(quantities['Width']?.value) || getTeklaM('width');
    const H = this.parseFiniteNumber(quantities['Height']?.value) || getTeklaM('height');

    if (
      pituusM === null &&
      COSTA_LINEAR_PROFILE_LENGTH_V1 &&
      !typeUpper.includes('WALL') &&
      isProfileLengthSuspect(L, null, L, extraProperties, quantities)
    ) {
      const shortRun = [W, H].filter((v) => v >= 0.05 && v <= 50 && v < L / 5);
      if (shortRun.length === 1) {
        pituusM = shortRun[0];
      } else if (shortRun.length > 1) {
        pituusM = Math.max(...shortRun);
      }
    }

    let axisLength: number | null = null;

    if (pituusM === null) {
      const dims = [L, W, H].filter((v) => v > 0).sort((a, b) => b - a);
      if (dims.length >= 2 && dims[0] / dims[1] > 3) {
        const dominant = dims[0];
        if (typeUpper.includes('WALL')) {
          const dominantLooksLikeMmSlot = dominant >= 10 && dominant <= 250;
          if (dominant !== H && !dominantLooksLikeMmSlot) axisLength = dominant;
        } else {
          axisLength = dominant;
        }
        const axisMin = profileSuspect ? 0.05 : 0.3;
        if (axisLength !== null && (axisLength < axisMin || axisLength > 300)) {
          axisLength = null;
        }
      }
    }

    const resolvedLength = pituusM ?? axisLength;
    if (resolvedLength === null) return;

    const currentL = this.parseFiniteNumber(quantities['Length']?.value);
    if (currentL !== null && currentL > 0) {
      const ratio = resolvedLength / currentL;
      if (ratio > 0.95 && ratio < 1.05) return;
    }

    quantities['Length'] = {
      value: resolvedLength,
      unit: quantities['Length']?.unit ?? 'm',
    };
  }

  /**
   * Convierte una cantidad IFC a metros (o m²/m³ según el tipo)
   * SOLUCIÓN DEFINITIVA Y UNIFICADA - Funciona para TODOS los elementos sin excepciones
   * 
   * Estrategia:
   * 1. Intentar usar IfcPropertiesUtils (herramienta oficial de ThatOpen) - SIEMPRE confiable
   * 2. Si no funciona, usar la detección de unidades del modelo (modelLengthUnit)
   * 3. Si detectamos mm, convertir TODO consistentemente sin heurísticas
   * 4. Si no sabemos, usar el valor raw (asumir que ya está correcto)
   */
  private async convertQuantityValue(
    model: any,
    quantity: any,
    quantityRef: any,
    quantityType: 'length' | 'area' | 'volume'
  ): Promise<number | null> {
    // Obtener valor raw según el tipo
    let rawValue: number | null = null;
    if (quantity.LengthValue?.value !== undefined) {
      rawValue = quantity.LengthValue.value;
    } else if (quantity.AreaValue?.value !== undefined) {
      rawValue = quantity.AreaValue.value;
    } else if (quantity.VolumeValue?.value !== undefined) {
      rawValue = quantity.VolumeValue.value;
    }
    
    if (rawValue === null || rawValue === undefined) {
      return null;
    }
    
    // PASO 1: Intentar usar IfcPropertiesUtils (MÉTODO PREFERIDO Y CONFIABLE)
    // Esta es la herramienta oficial de ThatOpen que maneja correctamente las unidades IFC
    let convertedValue: number | null = null;
    try {
      const result = await OBC.IfcPropertiesUtils.getQuantityValue(model, quantityRef.value);
      convertedValue = result?.value ?? null;
      
      // Si obtuvimos un valor, verificar si se aplicó conversión
      if (convertedValue !== null && convertedValue !== undefined) {
        const qName = String(quantity?.Name?.value ?? "");
        const qNameLower = qName.toLowerCase();
        const conversionApplied = Math.abs(rawValue - convertedValue) > 0.001;

        // Guardrail para perimetros ambiguos:
        // cuando la unidad del modelo es desconocida y IfcPropertiesUtils reduce x1000,
        // evitamos forzar esa conversion porque puede desescalar un valor ya en metros.
        if (
          quantityType === "length" &&
          qNameLower === "perimeter" &&
          this.modelLengthUnit === "unknown" &&
          conversionApplied
        ) {
          const ratio = Math.abs(rawValue) > Number.EPSILON ? Math.abs(convertedValue / rawValue) : 1;
          const nearThousandDownscale = Math.abs(ratio - 0.001) < 1e-6;
          if (nearThousandDownscale) {
            return rawValue;
          }
        }

        if (conversionApplied) {
          // IfcPropertiesUtils aplicó conversión correctamente - USAR ESTE VALOR
          return convertedValue;
        }
        
        // Si no aplicó conversión, verificar si hay evidencia de que debería convertir
        // SOLUCIÓN CONDICIONAL: Solo para casos problemáticos conocidos de Revit
        // donde IfcPropertiesUtils no convierte pero el modelo está en mm
        if (!conversionApplied && quantityType === 'length') {
          // Verificar si el modelo está en mm (puede estar establecido o necesitamos detectarlo)
          const modelUnit = this.modelLengthUnit;
          
          // EVIDENCIA 1: Valores típicos en mm para dimensiones (no en metros)
          // Puertas/ventanas: típicamente 500-3000mm (0.5m-3m)
          // Muros: pueden ser 5000-50000mm (5m-50m) - valores largos pero razonables
          const smallSuspiciousValue = rawValue >= 100 && rawValue <= 5000; // Puertas/ventanas
          const largeSuspiciousValue = rawValue > 5000 && rawValue <= 50000; // Muros largos
          const suspiciousRawValue = smallSuspiciousValue || largeSuspiciousValue;
          
          // EVIDENCIA 2: El valor convertido actual sería absurdo si está en metros
          // Para puertas/ventanas: > 10m es absurdo
          // Para muros largos: > 100m es absurdo (muy pocos muros exceden 50-100m)
          const absurdForSmall = smallSuspiciousValue && convertedValue > 10;
          const absurdForLarge = largeSuspiciousValue && convertedValue > 100;
          const absurdConvertedValue = absurdForSmall || absurdForLarge;
          
          // EVIDENCIA 3: Ratio 1:1 exacto sugiere que no se aplicó conversión
          const ratioIsOne = Math.abs(rawValue - convertedValue) < 0.001;
          
          // Si TODAS las evidencias se cumplen, aplicar conversión manual
          // Incluimos verificación de modelo en mm O valores sospechosos
          if ((modelUnit === 'mm' || (modelUnit === 'unknown' && suspiciousRawValue)) && 
              suspiciousRawValue && 
              absurdConvertedValue && 
              ratioIsOne) {
            // Aplicar conversión manual: mm -> m
            const converted = rawValue / 1000;
            console.log(`[CostCalculator] ⚠️ Aplicando conversión manual: ${rawValue}mm → ${converted}m (IfcPropertiesUtils no aplicó conversión)`);
            return converted;
          }
        }
        
        // Heurístico para áreas: si IfcPropertiesUtils no convirtió y el valor es
        // físicamente imposible en m² para un solo elemento constructivo, asumir mm².
        // >10 000 m² para un elemento es imposible; 10 000 mm² = 0,01 m² es normal.
        if (!conversionApplied && quantityType === 'area' && rawValue >= 10000) {
          const converted = rawValue / 1e6;
          console.warn(`[CostCalculator] ⚠️ Conversión área: ${rawValue}mm² → ${converted}m² (IfcPropertiesUtils sin conversión)`);
          return converted;
        }

        // Heurístico para volúmenes: si IfcPropertiesUtils no convirtió y el valor es
        // físicamente imposible en m³ para un solo elemento, asumir mm³.
        // >1 000 000 000 m³ es absurdo; 1e9 mm³ = 1 m³ es un elemento de hormigón típico.
        if (!conversionApplied && quantityType === 'volume' && rawValue >= 1e9) {
          const converted = rawValue / 1e9;
          console.warn(`[CostCalculator] ⚠️ Conversión volumen: ${rawValue}mm³ → ${converted}m³ (IfcPropertiesUtils sin conversión)`);
          return converted;
        }

        // Si no hay evidencia de problema, confiar en IfcPropertiesUtils
        // (puede significar que ya estaba en las unidades correctas)
        return convertedValue;
      }
    } catch (error) {
      // Si IfcPropertiesUtils falla, continuamos con detección manual
    }
    
    // PASO 2: Si IfcPropertiesUtils no funcionó, usar detección de unidades del modelo
    // Si sabemos que el modelo está en mm, convertir TODO consistentemente
    if (this.modelLengthUnit === 'mm') {
      // El modelo está definitivamente en mm - convertir según el tipo
      switch (quantityType) {
        case 'length':
          return rawValue / 1000; // mm -> m
        case 'area':
          return rawValue / 1000000; // mm² -> m²
        case 'volume':
          return rawValue / 1000000000; // mm³ -> m³
      }
    } else if (this.modelLengthUnit === 'm') {
      // El modelo está en metros - usar valor raw sin conversión
      return rawValue;
    }
    
    // PASO 3: Unidad del modelo desconocida.
    // Fallback heurístico basado en plausibilidad física: si el valor cae fuera del rango
    // posible para metros (en un elemento constructivo) pero encaja perfectamente en mm,
    // aplicar la conversión correspondiente.
    //
    // Umbrales elegidos para ser conservadores y evitar falsas conversiones:
    //   length  >= 100   → >100 m para un solo elemento es físicamente imposible; 100 mm = 10 cm es normal
    //   area    >= 10000 → >10 000 m² para un elemento es imposible; 10 000 mm² = 0,01 m² es normal
    //   volume  >= 1e9   → >1 000 000 000 m³ es absurdo; 1e9 mm³ = 1 m³ es un elemento típico de hormigón
    //
    // Solo alcanzamos este punto si IfcPropertiesUtils falló/devolvió null Y
    // el modelo no declaró su unidad de forma legible. Cualquier IFC bien declarado
    // queda resuelto en Paso 1 o Paso 2 y nunca llega aquí.
    if (quantityType === 'length' && rawValue >= 100) {
      console.warn(`[CostCalculator] Paso 3 fallback: ${rawValue} mm → ${rawValue / 1000} m (length, modelo sin unidad)`);
      return rawValue / 1000;
    }
    if (quantityType === 'area' && rawValue >= 10000) {
      console.warn(`[CostCalculator] Paso 3 fallback: ${rawValue} mm² → ${rawValue / 1e6} m² (area, modelo sin unidad)`);
      return rawValue / 1e6;
    }
    if (quantityType === 'volume' && rawValue >= 1e9) {
      console.warn(`[CostCalculator] Paso 3 fallback: ${rawValue} mm³ → ${rawValue / 1e9} m³ (volume, modelo sin unidad)`);
      return rawValue / 1e9;
    }
    return rawValue;
  }

  private async checkModelUnits(model: any): Promise<void> {
    try {
      
      // Intentar encontrar IfcProject (generalmente expressID 21)
      // IFCPROJECT type code en web-ifc es 19
      const PROJECT_TYPE = 19;
      const projectIds = [21, 20, 19, 22, 23, 24];
      let project = null;
      
      for (const projectId of projectIds) {
        try {
          const candidate = await model.getProperties(Number(projectId));
          if (candidate && (candidate.type === PROJECT_TYPE || candidate.type?.toString().includes('PROJECT'))) {
            project = candidate;
            break;
          }
        } catch (e) {
          // Continuar buscando
        }
      }
      
      // Si no encontramos por ID común, buscar en todos los elementos
      if (!project) {
        try {
          const allIds = await model.getAllPropertiesIDs();
          for (const id of allIds.slice(0, 50)) { // Revisar primeros 50 para no ser demasiado lento
            try {
              const candidate = await model.getProperties(Number(id));
              if (candidate && (candidate.type === PROJECT_TYPE || candidate.type?.toString().includes('PROJECT'))) {
                project = candidate;
                break;
              }
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          // No se pueden obtener todos los IDs
        }
      }
      
      if (project) {
        // Buscar UNITASSIGNMENT
        if (project.UnitsInContext?.value) {
          try {
            const unitAssignment = await model.getProperties(project.UnitsInContext.value);
            
                    if (unitAssignment.Units) {
              for (const unitRef of unitAssignment.Units) {
                try {
                  const unit = await model.getProperties(unitRef.value);
                  if (unit) {
                    const unitName = unit.UnitType?.value || 'Unknown';
                    
                    // IfcSIUnit: Prefix y Name están directamente en `unit`, no en un nivel interior.
                    // La estructura IFC es: IfcUnitAssignment.Units → [ IfcSIUnit { UnitType, Prefix, Name } ]
                    const prefix = unit.Prefix?.value || '';
                    const name = unit.Name?.value || '';

                    const unitNameUpper = unitName.toUpperCase();
                    if (unitNameUpper.includes('LENGTH') || unitNameUpper === 'LENGTHUNIT') {
                      const prefixUpper = prefix.toUpperCase();
                      const fullName = `${prefix}${name}`.toUpperCase();
                      if (prefixUpper === 'MILLI' || fullName === 'MILLIMETRE' || fullName === 'MILLIMETER' || fullName === 'MM') {
                        this.modelLengthUnit = 'mm';
                        console.log(`[CostCalculator] ✓ Unidad de longitud detectada: mm (${prefix}${name})`);
                      } else if ((name === 'METRE' || name === 'METER') && prefixUpper !== 'MILLI' && prefixUpper !== 'CENTI') {
                        this.modelLengthUnit = 'm';
                        console.log(`[CostCalculator] ✓ Unidad de longitud detectada: m (${name})`);
                      }
                    }
                  }
                } catch (e) {
                  // Continuar
                }
              }
            }
          } catch (e) {
            console.warn('[CostCalculator] Error al leer UNITASSIGNMENT:', e);
          }
        }
      } else {
        console.warn('[CostCalculator] No se encontró IfcProject para revisar unidades');
      }
      
      // Si después de todo no detectamos unidades, intentar inferirlas desde un ejemplo
      if (this.modelLengthUnit === 'unknown') {
        console.log('[CostCalculator] No se detectaron unidades del modelo. Intentando inferir desde cantidades de ejemplo...');
        // La inferencia se hará en la función de conversión basándose en valores realistas
      } else {
        console.log(`[CostCalculator] ✓ Unidades del modelo establecidas: ${this.modelLengthUnit}`);
      }
      
      // También revisar cantidades de ejemplo, especialmente Width y Height de puertas
      try {
        const indexer = this.components.get(OBC.IfcRelationsIndexer);
        if (indexer) {
          // Buscar el primer elemento con cantidades (preferir puertas si existen)
          let doorFound = false;
          
          // Primero intentar encontrar una puerta
          for (const fragment of model.items) {
            for (const elementId of fragment.ids) {
              try {
                const element = await model.getProperties(Number(elementId));
                if (!element) continue;
                
                const elementType = Object.keys(WEBIFC).find(key => 
                  (WEBIFC as any)[key] === element.type
                )?.toUpperCase() || '';
                
                if (elementType.includes('DOOR')) {
                  doorFound = true;
                  const propertyRelations = indexer.getEntityRelations(model, Number(elementId), "IsDefinedBy");
                  
                  if (propertyRelations && propertyRelations.length > 0) {
                    console.log(`[CostCalculator] Puerta encontrada (expressID: ${elementId})`);
                    
                    for (const relId of propertyRelations) {
                      const relation = await model.getProperties(Number(relId));
                      if (relation?.Quantities && relation.Quantities.length > 0) {
                        // Revisar todas las cantidades de la puerta
                        for (const quantityRef of relation.Quantities) {
                          try {
                            const quantity = await model.getProperties(Number(quantityRef.value));
                            if (!quantity || !quantity.Name) continue;
                            
                            const qtyName = quantity.Name.value?.toLowerCase() || '';
                            
                            // Revisar Width y Height específicamente
                            if (qtyName === 'width' || qtyName === 'height') {
                              let rawValue = null;
                              let qtyType = '';
                              if (quantity.LengthValue?.value !== undefined) {
                                rawValue = quantity.LengthValue.value;
                                qtyType = 'Length';
                              } else if (quantity.AreaValue?.value !== undefined) {
                                rawValue = quantity.AreaValue.value;
                                qtyType = 'Area';
                              }
                              
                              if (rawValue !== null) {
                                try {
                                  const result = await OBC.IfcPropertiesUtils.getQuantityValue(model, quantityRef.value);
                                  const convertedValue = result?.value ?? null;
                                  console.log(`[CostCalculator] Cantidad de puerta - ${qtyName.toUpperCase()} (${qtyType}):`);
                                  console.log(`  Valor crudo: ${rawValue}`);
                                  console.log(`  Valor convertido: ${convertedValue}`);
                                  console.log(`  Conversión aplicada: ${rawValue !== convertedValue ? 'SÍ' : 'NO'}`);
                                } catch (e) {
                                  console.warn(`[CostCalculator] Error al obtener valor convertido para ${qtyName}:`, e);
                                }
                              }
                            }
                          } catch (e) {
                            // Continuar con siguiente cantidad
                          }
                        }
                      }
                    }
                    break;
                  }
                }
              } catch (e) {
                continue;
              }
            }
            if (doorFound) break;
          }
          
          // Si no se encontró puerta, buscar cualquier elemento con cantidades
          if (!doorFound) {
            for (const fragment of model.items) {
              if (fragment.ids.size > 0) {
                const firstId = Array.from(fragment.ids)[0];
                const propertyRelations = indexer.getEntityRelations(model, Number(firstId), "IsDefinedBy");
                
                if (propertyRelations && propertyRelations.length > 0) {
                  for (const relId of propertyRelations.slice(0, 1)) {
                    const relation = await model.getProperties(Number(relId));
                    if (relation?.Quantities && relation.Quantities.length > 0) {
                      const quantityRef = relation.Quantities[0];
                      const quantity = await model.getProperties(Number(quantityRef.value));
                      
                      if (quantity) {
                        let rawValue = null;
                        let qtyType = '';
                        if (quantity.LengthValue?.value !== undefined) {
                          rawValue = quantity.LengthValue.value;
                          qtyType = 'Length';
                        } else if (quantity.AreaValue?.value !== undefined) {
                          rawValue = quantity.AreaValue.value;
                          qtyType = 'Area';
                        } else if (quantity.VolumeValue?.value !== undefined) {
                          rawValue = quantity.VolumeValue.value;
                          qtyType = 'Volume';
                        }
                        
                        if (rawValue !== null) {
                          try {
                            const result = await OBC.IfcPropertiesUtils.getQuantityValue(model, quantityRef.value);
                            const convertedValue = result?.value ?? null;
                            console.log(`[CostCalculator] Ejemplo de conversión (${qtyType}):`);
                            console.log(`  Valor crudo: ${rawValue}`);
                            console.log(`  Valor convertido: ${convertedValue}`);
                            console.log(`  Conversión aplicada: ${rawValue !== convertedValue ? 'SÍ' : 'NO'}`);
                          } catch (e) {
                            console.warn('[CostCalculator] Error al obtener valor convertido:', e);
                          }
                          break;
                        }
                      }
                    }
                  }
                  break;
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn('[CostCalculator] Error revisando ejemplo de cantidad:', e);
      }
      
      console.log('[CostCalculator] Revisión de unidades completada\n');
    } catch (error) {
      console.warn('[CostCalculator] Error revisando unidades del modelo:', error);
    }
  }

  async calculateMaterialCosts(fragmentIdMap: FRAGS.FragmentIdMap) {
    this._results = [];
    this._taloSourceCache = new Map();

    const models = this.fragments.groups;
    let processedCount = 0;

    // Process each model
    for (const [modelId, model] of models) {
      if (!model?.hasProperties) {
        console.warn('[CostCalculator] Model has no properties, skipping');
        continue;
      }

      // Process model relations first
      const indexer = this.components.get(OBC.IfcRelationsIndexer);
      if (!indexer) {
        console.warn('[CostCalculator] No IfcRelationsIndexer found');
        continue;
      }

      await indexer.process(model);
      
      // Revisar unidades del modelo (solo la primera vez, siempre para el primer modelo)
      if (modelId === Array.from(models.keys())[0]) {
        await this.checkModelUnits(model);
        
        // OPTIMIZACIÓN: Pre-cargar unidades en IFCQuantityService para evitar detecciones repetidas
        // Esto asegura que el servicio use el cache rápido desde el inicio
        try {
          const quantityService = IFCQuantityService.getInstance();
          // Pre-detectar unidades para que el cache rápido esté listo
          await quantityService.detectModelUnits(model);
        } catch (e) {
          // Si falla, no es crítico - el servicio detectará cuando lo necesite
        }
      }

      // Detectar software de origen una vez por modelo (cache)
      if (!this.modelSourceSoftwareCache.has(modelId)) {
        try {
          const quantityService = IFCQuantityService.getInstance();
          const sourceSoftware = await quantityService.detectSourceSoftware(model);
          this.modelSourceSoftwareCache.set(modelId, sourceSoftware);
        } catch (e) {
          // Si falla, asumir Unknown
          this.modelSourceSoftwareCache.set(modelId, 'Unknown');
        }
      }

      // Recopilar IDs únicos a procesar: un expressId puede estar en varios fragmentos
      // (el mesh se parte por materiales/capas) pero representa un único objeto IFC.
      // Deduplicar aquí evita llamar a processElement N veces por objeto y tener
      // filas duplicadas en _results / materialCostsTable.
      const uniqueIds = new Set<number>();
      const hasSelectionMap = fragmentIdMap && Object.keys(fragmentIdMap).length > 0;

      for (const fragment of model.items) {
        if (hasSelectionMap) {
          if (!fragmentIdMap[fragment.id]) continue;
          for (const id of fragmentIdMap[fragment.id]) uniqueIds.add(Number(id));
        } else {
          for (const id of fragment.ids) uniqueIds.add(Number(id));
        }
      }

      const totalElements = uniqueIds.size;
      console.log(`[CostCalculator] Procesando ${totalElements} elementos únicos (modelo ${modelId})`);

      for (const id of uniqueIds) {
        await this.processElement(model, id, modelId);
        processedCount++;
        this.onProgress.trigger((processedCount / totalElements) * 100);
      }
    }

    console.log('[CostCalculator] Results:', this._results);
    this.updateResultsTable();
    this.onMaterialCostsComputed.trigger(this._results);
    return this._results;
  }


  /**
   * Calcula dimensiones y área desde la geometría del fragmento (similar a LCA)
   * Usa la misma lógica que LCA para detectar unidades y calcular desde la geometría
   * 
   * @param model - Modelo IFC (FragmentsGroup)
   * @param elementId - ID del elemento IFC
   * @returns Dimensiones calculadas desde la geometría o null si no se puede calcular
   */
  private calculateDimensionsFromGeometry(
    model: FRAGS.FragmentsGroup,
    elementId: number
  ): { width: number; length: number; height: number; area: number; volume: number } | null {
    try {
      // Usar el primer fragmento que contiene el elemento.
      // NOTA: fragment.mesh es un mesh COMPARTIDO entre todos los elementos del mismo
      // material. Fusionar los bboxes de todos los fragmentos que contienen el elementId
      // daría el bbox del mesh completo (todos los elementos del material), no del objeto
      // individual. El primer fragmento ofrece la mejor aproximación disponible sin
      // acceso a la geometría filtrada por expressId (That Open v2.4).
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
        if (rejectPoisonedGeometricDimensions({ width, length, height })) {
          return null;
        }
        const area   = length * height;
        const volume = width * length * height;

        return { width, length, height, area, volume };
      }
    } catch (error) {
      console.warn(`[CostCalculator] Error calculating dimensions from geometry for element ${elementId}:`, error);
    }

    return null;
  }

  /**
   * Calcula la cantidad para códigos Littera con unidad JM (metros lineales)
   * Distingue entre perímetro (ventanas, puertas) y longitud directa (vigas, pilares, tuberías)
   * 
   * @param filteredCode - Código Littera filtrado con su descripción
   * @param quantities - Cantidades base del elemento IFC
   * @param ifcType - Tipo IFC del elemento
   * @param elementName - Nombre del elemento
   * @returns Cantidad calculada en metros lineales
   */
  private calculateJMQuantity(
    filteredCode: any,
    quantities: BaseCostElement['baseQuantities'],
    ifcType: string,
    elementName: string
  ): number {
    const description = (filteredCode.description || '').toLowerCase();
    const nameLower = elementName.toLowerCase();
    const typeLower = ifcType.toLowerCase();

    // Palabras clave que indican perímetro (ventanas, puertas, aberturas)
    const perimeterKeywords = [
      'listoitus',      // listones/molduras
      'kittaus',       // masillado
      'tilkitseminen', // sellado
      'liittymärakenteet', // conexiones de aberturas
      'liittym'        // conexiones
    ];

    // Palabras clave que indican longitud directa (elementos lineales)
    const lengthKeywords = [
      'palkki',        // viga
      'pilari',        // pilar
      'paalutus',      // pilote
      'putki',         // tubería
      'kaapeli',       // cable
      'kanaali',       // canal
      'salaoja',       // zanja
      'viemäri',       // drenaje
      'reunalaudoitus', // encofrado de borde
      'kaista',        // banda
      'juoksu',        // zócalo/listón
      'torvi',         // bajante
      'kouru'          // canalón
    ];

    // Verificar si es perímetro basándose en descripción y tipo IFC
    const isPerimeter = 
      perimeterKeywords.some(keyword => description.includes(keyword)) ||
      (typeLower.includes('window') || typeLower.includes('door')) ||
      (nameLower.includes('ikkuna') || nameLower.includes('ovi'));

    // Verificar si es longitud directa
    const isDirectLength = 
      lengthKeywords.some(keyword => description.includes(keyword)) ||
      typeLower.includes('beam') ||
      typeLower.includes('column') ||
      typeLower.includes('pipe') ||
      typeLower.includes('cable');

    // Si es perímetro, calcular desde dimensiones
    if (isPerimeter && !isDirectLength) {
      const length = quantities.Length?.value;
      const resolved = resolveOpeningFrameDimsForPerimeter(ifcType, quantities);
      if (resolved && resolved.openingWidth > 0 && resolved.openingHeight > 0) {
        // Puerta: marco = dos verticales + dintel (solo una horizontal)
        if (typeLower.includes('door')) {
          return 2 * resolved.openingHeight + resolved.openingWidth;
        }
        // Ventana: perímetro completo del marco (4 lados)
        if (typeLower.includes('window')) {
          return 2 * (resolved.openingWidth + resolved.openingHeight);
        }
        // Otros elementos con perímetro (listoitus, kittaus, etc.): 4 lados
        return 2 * (resolved.openingWidth + resolved.openingHeight);
      }
      // Si solo hay Length, puede ser el perímetro directamente
      if (length) {
        return length;
      }
    }

    // Si es longitud directa o no se puede determinar, usar Length
    if (quantities.Length?.value !== undefined) {
      return quantities.Length.value;
    }

    // Fallback: Width+Height solo si Width es perfil fiable (Paso 3)
    const width = getReliableProfileWidth(quantities ?? {}, ifcType);
    const height = quantities.Height?.value;
    if (width && height) {
      return width + height;
    }

    // Último fallback: usar cantidad primaria
    return 0; // Se asignará finalQuantity en el código que llama
  }

  private async processElement(model: any, id: number, modelId: string): Promise<void> {
    try {
      const element = await model.getProperties(id);
      if (!element) return;

      // Get the IFC type correctly
      const ifcType = Object.keys(WEBIFC).find(key => 
        (WEBIFC as any)[key] === element.type
      )?.replace(/^IFC/, 'Ifc') || `Type ${element.type}`;

      // Paso 1: exclude auxiliaries / fasteners from measurement pipeline (name denylist)
      const earlyName = element.Name?.value || "";
      if (isMeasurementExcluded(earlyName, ifcType).excluded) {
        return;
      }

      // Initialize quantities object and extra properties for export (Pset.Property -> value)
      const quantities: { [key: string]: IFCQuantityValue } = {};
      const extraProperties: Record<string, string | number> = {};

      // Get all properties using the indexer
      const indexer = this.components.get(OBC.IfcRelationsIndexer);
      if (!indexer) return;

      // Try to get spatial containment to determine building storey (floor)
      let floor: string | undefined = undefined;
      const containment = indexer.getEntityRelations(model, id, "ContainedInStructure");
      if (containment) {
        for (const containerId of containment) {
          const container = await model.getProperties(containerId);
          if (container && container.type === "IFCBUILDINGSTOREY") {
            floor = container.Name?.value || container.LongName?.value || undefined;
            break;
          }
        }
      }

      // Get property sets and quantities
      const propertyRelations = indexer.getEntityRelations(model, id, "IsDefinedBy");
      if (propertyRelations) {
        for (const relId of propertyRelations) {
          const relation = await model.getProperties(relId);
          if (!relation) continue;

          // Property sets (HasProperties): collect for Excel/export as PsetName.PropertyName
          if (relation.HasProperties && !relation.Quantities) {
            const psetName = relation.Name?.value ?? '';
            for (const propRef of relation.HasProperties) {
              try {
                const property = await model.getProperties(propRef.value);
                if (!property) continue;
                const propName = property.Name?.value;
                if (!propName) continue;
                const raw = property.NominalValue?.value;
                if (raw === undefined || raw === null) continue;
                const key = `${psetName}.${propName}`;
                extraProperties[key] = typeof raw === 'number' || typeof raw === 'string' ? raw : String(raw);
              } catch {
                continue;
              }
            }
          }

          // Handle quantity sets - use unified conversion logic
          if (relation.Quantities) {
            for (const quantityRef of relation.Quantities) {
              let quantity: any = null;
              try {
                quantity = await model.getProperties(quantityRef.value);
                if (!quantity || !quantity.Name) continue;

                // Determinar el tipo de cantidad
                let quantityType: 'length' | 'area' | 'volume' | null = null;
                if (quantity.LengthValue) {
                  quantityType = 'length';
                } else if (quantity.AreaValue) {
                  quantityType = 'area';
                } else if (quantity.VolumeValue) {
                  quantityType = 'volume';
                }
                
                if (!quantityType) {
                  continue; // Tipo desconocido, saltar
                }

                // Usar la función unificada de conversión
                const rawValue = quantityType === 'length' 
                  ? quantity.LengthValue.value 
                  : quantityType === 'area'
                  ? quantity.AreaValue.value
                  : quantity.VolumeValue.value;
                
                const convertedValue = await this.convertQuantityValue(
                  model,
                  quantity,
                  quantityRef,
                  quantityType
                );
                
                if (convertedValue === null || convertedValue === undefined) {
                  const name = quantity.Name?.value || 'Unknown';
                  console.warn(`[CostCalculator] Skipping quantity "${name}" - conversion returned null/undefined`);
                  continue;
                }

                // Determine unit based on quantity type
                const unit = quantityType === 'length' ? 'm' 
                           : quantityType === 'area' ? 'm²' 
                           : 'm³';

                const name = quantity.Name.value;

                // Obtener el tipo de elemento para logs específicos (ya tenemos element desde processElement)
                const elementType = ifcType; // ifcType ya está disponible en el scope de processElement
                const isSlab = elementType?.toUpperCase().includes('SLAB');
                
                // Guardar cantidad convertida
                quantities[name] = {
                  value: convertedValue,
                  unit: unit
                };
              } catch (error) {
                // Si hay error, registrar y continuar con siguiente cantidad
                const quantityName = (quantity && quantity.Name?.value) || 'Unknown';
                console.warn(`[CostCalculator] Error processing quantity ${quantityName}:`, error);
                continue;
              }
            }
          }
        }
      }

      // Prefer explicit Revit-style level property if available (Constraints.Level)
      const levelFromConstraints = extraProperties["Constraints.Level"];
      if (levelFromConstraints !== undefined && levelFromConstraints !== null) {
        floor = String(levelFromConstraints);
      }

      // IfcDoor / IfcWindow: leer OverallHeight y OverallWidth directamente de la entidad.
      // Son los atributos semánticamente más fiables del vano — definidos explícitamente
      // por el modelador, independientes del bounding box o del quantity set.
      if (ifcType.toUpperCase().includes('DOOR') || ifcType.toUpperCase().includes('WINDOW')) {
        const rawOH = element.OverallHeight?.value;
        const rawOW = element.OverallWidth?.value;
        if (typeof rawOH === 'number' && rawOH > 0) {
          const convH = this.modelLengthUnit === 'mm'
            ? rawOH / 1000
            : (this.modelLengthUnit === 'm' ? rawOH : (rawOH >= 100 ? rawOH / 1000 : rawOH));
          if (convH >= 0.1 && convH <= 15) {
            quantities['OverallHeight'] = { value: convH, unit: 'm' };
          }
        }
        if (typeof rawOW === 'number' && rawOW > 0) {
          const convW = this.modelLengthUnit === 'mm'
            ? rawOW / 1000
            : (this.modelLengthUnit === 'm' ? rawOW : (rawOW >= 100 ? rawOW / 1000 : rawOW));
          if (convW >= 0.05 && convW <= 10) {
            quantities['OverallWidth'] = { value: convW, unit: 'm' };
          }
        }
      }

      this.reconcileDimensionConflicts(quantities, extraProperties, ifcType);

      // Get TALO classification (element first, then type if needed)
      let taloCode = '';
      let taloName = '';

      const classificationRelations = indexer.getEntityRelations(model, id, "HasAssociations");
      const fromElement = await this.getTaloFromClassificationRelations(model, classificationRelations || []);
      taloCode = fromElement.taloCode;
      taloName = fromElement.taloName;

      // Fallback: classification may be on the type (e.g. IfcDoorStyle) rather than the occurrence (IfcDoor) — common in Archicad
      if (!taloCode) {
        const typeRelations = indexer.getEntityRelations(model, id, "IsTypedBy");
        if (typeRelations?.length) {
          const typeRel = await model.getProperties(typeRelations[0]);
          const relType = typeRel?.RelatingType;
          const typeId = typeof relType === 'number' ? relType : relType?.value ?? (relType as any)?.expressID;
          if (typeId != null) {
            const typeClassificationRelations = indexer.getEntityRelations(model, typeId, "HasAssociations");
            const fromType = await this.getTaloFromClassificationRelations(model, typeClassificationRelations || []);
            if (fromType.taloCode) {
              taloCode = fromType.taloCode;
              taloName = fromType.taloName;
            }
          }
        }
      }

      // If not found in classifications, try to get from Property Sets
      // Revit often exports TALO codes as IFCPROPERTYSINGLEVALUE with name 'TALO2000_Code'
      if (!taloCode && propertyRelations) {
        for (const relId of propertyRelations) {
          const relation = await model.getProperties(relId);
          if (!relation) continue;

          // Check if it's a Property Set (not a Quantity Set)
          // Property Sets have HasProperties, Quantity Sets have Quantities
          if (relation.HasProperties && !relation.Quantities) {
            for (const propRef of relation.HasProperties) {
              const property = await model.getProperties(propRef.value);
              if (!property) continue;

              const propName = property.Name?.value;
              
              // Look for TALO code property (common names: TALO2000_Code, TALO_Code, TALOCode, etc.)
              if (propName && (
                propName.toUpperCase().includes('TALO') || 
                propName.toUpperCase().includes('TALO2000')
              )) {
                // Get the value from NominalValue (for IFCPROPERTYSINGLEVALUE)
                const propValue = property.NominalValue?.value;
                if (propValue) {
                  // Convert to string if it's not already
                  const codeString = String(propValue);
                  taloCode = this.normalizeTaloCode(codeString);
                  taloName = propName;
                  if (taloCode) break;
                }
              }
            }
            if (taloCode) break;
          }
        }
      }

      // Fallback adicional: Buscar en Keynote de Property Sets personalizados (solo para Revit, entorno finlandés)
      // Esta búsqueda solo se ejecuta si:
      // 1. No se encontró TALO en las búsquedas anteriores
      // 2. El modelo es de origen Revit
      // 3. El Property Set es uno de los siguientes:
      //    - "Keynote" (Property Set llamado Keynote)
      //    - "Type Mark tarkastus" (o variantes)
      //    - "Identity Data" (o variantes, por compatibilidad)
      // 4. La propiedad se llama "Keynote"
      // 5. El valor normalizado es un código TALO válido
      if (!taloCode && propertyRelations) {
        const sourceSoftware = this.modelSourceSoftwareCache.get(modelId) || 'Unknown';
        if (sourceSoftware === 'Revit') {
          for (const relId of propertyRelations) {
            const relation = await model.getProperties(relId);
            if (!relation) continue;

            // Check if it's a Property Set (not a Quantity Set)
            if (relation.HasProperties && !relation.Quantities) {
              const relationName = relation.Name?.value || '';
              const relationNameUpper = relationName.toUpperCase();
              
              // Check if Property Set matches one of the expected names:
              // - "Keynote" (exact match)
              // - "Type Mark tarkastus" (or variations containing "TYPE MARK" and "TARKASTUS")
              // - "Identity Data" (or variations, for backward compatibility)
              const isKeynotePset = relationNameUpper === 'KEYNOTE';
              const isTypeMarkTarkastus = relationNameUpper.includes('TYPE MARK') && relationNameUpper.includes('TARKASTUS');
              const isIdentityData = relationNameUpper === 'IDENTITY DATA' || 
                                     (relationNameUpper.includes('IDENTITY') && relationNameUpper.includes('DATA'));

              if (isKeynotePset || isTypeMarkTarkastus || isIdentityData) {
                for (const propRef of relation.HasProperties) {
                  const property = await model.getProperties(propRef.value);
                  if (!property) continue;

                  const propName = property.Name?.value;
                  
                  // Look for "Keynote" property
                  if (propName && propName.toUpperCase() === 'KEYNOTE') {
                    const propValue = property.NominalValue?.value;
                    if (propValue) {
                      // Convert to string and validate as TALO code
                      const codeString = String(propValue).trim();
                      const normalizedCode = this.normalizeTaloCode(codeString);
                      
                      // Only use if normalization succeeded (valid TALO format)
                      if (normalizedCode) {
                        taloCode = normalizedCode;
                        taloName = 'Keynote';
                        break;
                      }
                    }
                  }
                }
                if (taloCode) break;
              }
            }
          }
        }
      }

      // Extract Littera classification from Property Sets
      // NOTE: "COSTA LITTERA" is the PROPERTY NAME, not the PropertySet name
      // Format: IFCPROPERTYSINGLEVALUE('COSTA LITTERA',$,IFCTEXT('3155010'),$)
      let litteraCode = '';
      let litteraName = '';
      let litteraCategory: string | undefined = '';

      if (propertyRelations) {
        for (const relId of propertyRelations) {
          const relation = await model.getProperties(relId);
          if (!relation) continue;

          // Check if it's a Property Set (not a Quantity Set)
          if (relation.HasProperties && !relation.Quantities) {
            // Iterate through all properties in this PropertySet
            for (const propRef of relation.HasProperties) {
              const property = await model.getProperties(propRef.value);
              if (!property) continue;

              const propName = property.Name?.value?.trim() || '';
              const propValue = property.NominalValue?.value;

              if (!propValue) continue;

              // Look for property named "COSTA LITTERA" (exact match or contains)
              const propNameUpper = propName.toUpperCase();
              const propValueStr = String(propValue).trim();
              
              if (propNameUpper === 'COSTA LITTERA' || 
                  (propNameUpper.includes('COSTA') && propNameUpper.includes('LITTERA'))) {
                litteraCode = propValueStr;
              }
              // Also look for standard Littera-related property names
              else if (propNameUpper.includes('LITTERA')) {
                if (propNameUpper.includes('CODE') || propNameUpper === 'LITTERA') {
                  litteraCode = propValueStr;
                }
                else if (propNameUpper.includes('NAME') || 
                         propNameUpper.includes('DESCRIPTION') ||
                         propNameUpper.includes('DESC')) {
                  litteraName = propValueStr;
                }
                else if (propNameUpper.includes('CATEGORY') || 
                         propNameUpper.includes('CATEG')) {
                  litteraCategory = propValueStr;
                }
              }
            }

            // If we found a code, we can stop searching other PropertySets
            if (litteraCode) {
              break;
            }
          }
        }
      }

      // Create temporary ElementData for quantity calculation
      const tempElementData: ElementData = {
        id: Number(id),
        name: element.Name?.value || 'Unknown',
        type: ifcType,
        category: element.ObjectType?.value || ifcType,
        taloCode: taloCode,
        description: '',
        quantities: quantities,
        properties: element.properties || {},
        taloName: taloName
      };

      // Get primary quantity based on TALO code
      const primaryQuantity = getTalo2000Quantity(tempElementData, taloCode);
      const finalQuantity = primaryQuantity?.value || Object.values(quantities)[0]?.value || 0;

      // Obtener múltiples códigos Littera filtrados para todos los elementos con código TALO
      // Si ya hay código Littera extraído de propiedades IFC, se usa ese
      // Si no, se filtran códigos relevantes desde el código TALO
      let litteraCodesArray: Array<{
        litteraCode: string;
        litteraName: string;
        litteraCategory?: string;
        unit: string;
        relevanceScore?: number;
        quantity?: number;
        source?: 'ifc' | 'suggestion' | 'library' | 'user' | 'ontelolaatta';
      }> = [];

      const elementNameForLittera = element.Name?.value || 'Unknown';
      const elementGlobalId = element.GlobalId?.value as string | undefined;
      const onteloTypeDetected = detectOnteloType(elementNameForLittera);
      const onteloMcpByGlobalId = useCostStore.getState().ontelolaattaMcp.byGlobalId;
      const isConfirmedOntelolaatta = isConfirmedOntelolaattaElement(
        { name: elementNameForLittera, globalId: elementGlobalId, id: Number(id) },
        onteloMcpByGlobalId
      );
      const onteloMcpEntry = isConfirmedOntelolaatta
        ? lookupConfirmedOntelolaattaEntry(
            elementGlobalId,
            Number(id),
            onteloMcpByGlobalId
          )
        : null;

      if (taloCode) {
        try {
          // Confirmación en IFCViewer = ontelolaatta prefabricada: solo paquete fijo 315xxx.
          // Nunca LitteraFilteringService (331xxx holvi colado in situ).
          if (isConfirmedOntelolaatta && onteloTypeDetected && onteloMcpEntry) {
            const geomModel =
              typeof window !== 'undefined'
                ? ((window as unknown as { fragmentModelRef?: FRAGS.FragmentsGroup }).fragmentModelRef ??
                  model)
                : model;
            const measurements = resolveOntelolaattaMeasurements(
              onteloMcpEntry,
              geomModel,
              Number(id)
            );
            litteraCodesArray = buildOntelolaattaLitteraPackage(measurements, onteloTypeDetected);

            if (litteraCodesArray.length > 0) {
              const firstCode = litteraCodesArray[0];
              litteraCode = firstCode.litteraCode;
              litteraName = firstCode.litteraName;
              litteraCategory = firstCode.litteraCategory || '';
              console.log(
                `[CostCalculator] Ontelolaatta package (${litteraCodesArray.length} codes) for element ${id}:`,
                litteraCodesArray.map((lc) => `${lc.litteraCode}=${lc.quantity?.toFixed(2)}`).join(', ')
              );
            } else {
              console.warn(
                `[CostCalculator] Confirmed ontelolaatta ${id} but package empty (check MCP measurements)`
              );
            }
          } else if (!isConfirmedOntelolaatta) {
          const tempElementForFiltering: BaseCostElement = {
            id: Number(id),
            name: elementNameForLittera,
            type: ifcType,
            category: element.ObjectType?.value || ifcType,
            quantity: finalQuantity,
            taloCode: taloCode,
            taloName: taloName,
            baseQuantities: quantities,
            costs: { material: 0, labor: 0, subcontract: 0, total: 0 }
          };

          // Si ya hay código Littera extraído de propiedades IFC, agregarlo como primero
          if (litteraCode) {
            // Calcular cantidad específica para este código si es posible
            let litteraQuantity = finalQuantity;
            
            // Intentar obtener cantidad específica desde baseQuantities según la unidad
            // Esto se puede mejorar después para ser más específico
            
            litteraCodesArray.push({
              litteraCode: litteraCode,
              litteraName: litteraName || '',
              litteraCategory: litteraCategory || undefined,
              unit: '***', // Placeholder: unidad original del IFC; el usuario puede ajustarla si lo desea
              relevanceScore: 100, // Score alto para distinguirlo como "aportado por el modelo"
              quantity: litteraQuantity,
              source: 'ifc'
            });
          }

          // Obtener códigos Littera filtrados desde el código TALO
          // Por defecto, obtener hasta 15 códigos relevantes (configurable)
          const filteredLitteraCodes = await this.litteraFilteringService.getFilteredLitteraCodes(
            tempElementForFiltering,
            15
          );

          // Agregar códigos filtrados que no estén ya en el array
          filteredLitteraCodes.forEach(filteredCode => {
            // Evitar duplicados
            if (!litteraCodesArray.some(lc => lc.litteraCode === filteredCode.litteraCode)) {
              // 1. Corregir unidad si está vacía o es '***'
              let finalUnit = filteredCode.unit;
              if (!finalUnit || finalUnit.trim() === '' || finalUnit === '***') {
                const correctUnit = this.mappingService.getLitteraUnitByCode(filteredCode.litteraCode);
                if (correctUnit) {
                  finalUnit = correctUnit;
                  console.log(`[CostCalculator] Corrected unit for Littera ${filteredCode.litteraCode}: '${filteredCode.unit}' → '${finalUnit}'`);
                } else {
                  // Si no se encuentra, mantener la unidad original o usar fallback
                  finalUnit = filteredCode.unit || '***';
                }
              }

              // 2. Calcular cantidad específica para este código según el tipo de elemento IFC y la unidad
              // Prioridad: 1) Propiedades IFC directas, 2) Cálculo desde geometría (como LCA), 3) Fallback volumen/espesor
              
              const unitUpper = finalUnit.toUpperCase();
              const needsArea = unitUpper === 'M2' || unitUpper === 'BRM2' || unitUpper === 'NM2';
              const needsVolume = unitUpper === 'M3' || unitUpper === 'RM3' || unitUpper === 'NM3';
              
              // Verificar si hay propiedades IFC directas disponibles
              let hasDirectIFCProperties = false;
              if (needsArea) {
                if (ifcType.toUpperCase().includes('WALL')) {
                  hasDirectIFCProperties = !!(quantities.NetSideArea?.value || quantities.NetArea?.value || 
                                            quantities.GrossSideArea?.value || quantities.GrossArea?.value);
                } else if (ifcType.toUpperCase().includes('WINDOW') || ifcType.toUpperCase().includes('DOOR')) {
                  hasDirectIFCProperties = !!(quantities.NetArea?.value || quantities.Area?.value);
                } else {
                  hasDirectIFCProperties = !!(quantities.NetArea?.value || quantities.GrossArea?.value || quantities.Area?.value);
                }
              } else if (needsVolume) {
                hasDirectIFCProperties = !!(quantities.NetVolume?.value || quantities.GrossVolume?.value || quantities.Volume?.value);
              }
              
              let codeQuantity: number;
              const skipFacadeArea =
                extraProperties["CostaBIM.LayerRole"] === "layer" ||
                extraProperties["CostaBIM.ContributeToMaara"] === 0;

              if (needsArea && skipFacadeArea) {
                codeQuantity = 0;
              } else if (!hasDirectIFCProperties && (needsArea || needsVolume)) {
                const geometricDimensions = this.calculateDimensionsFromGeometry(model, id);
                if (geometricDimensions && (geometricDimensions.area > 0 || geometricDimensions.volume > 0)) {
                  if (needsArea) {
                    // Para muros: usar área lateral calculada desde geometría (length × height)
                    if (ifcType.toUpperCase().includes('WALL')) {
                      codeQuantity = geometricDimensions.area; // Ya calculado como length × height
                      console.log(`[CostCalculator] ✓ Calculated wall area from geometry for element ${id}: ${codeQuantity.toFixed(3)} m² (${geometricDimensions.length.toFixed(2)}m × ${geometricDimensions.height.toFixed(2)}m)`);
                    }
                    // Para losas: usar área desde width × length
                    else if (ifcType.toUpperCase().includes('SLAB')) {
                      codeQuantity = geometricDimensions.width * geometricDimensions.length;
                      console.log(`[CostCalculator] ✓ Calculated slab area from geometry for element ${id}: ${codeQuantity.toFixed(3)} m² (${geometricDimensions.width.toFixed(2)}m × ${geometricDimensions.length.toFixed(2)}m)`);
                    }
                    // Para ventanas/puertas: usar width × height (área de abertura)
                    else if (ifcType.toUpperCase().includes('WINDOW') || ifcType.toUpperCase().includes('DOOR')) {
                      codeQuantity = geometricDimensions.width * geometricDimensions.height;
                      console.log(`[CostCalculator] ✓ Calculated window/door area from geometry for element ${id}: ${codeQuantity.toFixed(3)} m² (${geometricDimensions.width.toFixed(2)}m × ${geometricDimensions.height.toFixed(2)}m)`);
                    }
                    // Para otros elementos: usar área más grande disponible
                    else {
                      codeQuantity = Math.max(
                        geometricDimensions.width * geometricDimensions.length,
                        geometricDimensions.width * geometricDimensions.height,
                        geometricDimensions.length * geometricDimensions.height
                      );
                      console.log(`[CostCalculator] ✓ Calculated area from geometry for element ${id}: ${codeQuantity.toFixed(3)} m²`);
                    }
                  } else if (needsVolume) {
                    codeQuantity = geometricDimensions.volume;
                    console.log(`[CostCalculator] ✓ Calculated volume from geometry for element ${id}: ${codeQuantity.toFixed(3)} m³`);
                  } else {
                    codeQuantity = finalQuantity;
                  }
                } else {
                  // Si no se puede calcular desde geometría, usar función estándar (que tiene fallback volumen/espesor)
                  console.log(`[CostCalculator] ⚠️ No se pudo calcular desde geometría para elemento ${id}, usando fallback volumen/espesor`);
                  codeQuantity = getQuantityForLitteraCodeByType(
                    ifcType,
                    finalUnit,
                    quantities,
                    element.Name?.value || '',
                    finalQuantity,
                    filteredCode,
                    extraProperties
                  );
                }
              } else {
                // Si hay propiedades IFC directas, usar función estándar
                codeQuantity = getQuantityForLitteraCodeByType(
                  ifcType,
                  finalUnit,
                  quantities,
                  element.Name?.value || '',
                  finalQuantity,
                  filteredCode,
                  extraProperties
                );
              }

              // Inferir categoría si no está disponible
              let codeCategory = filteredCode.category;
              if (!codeCategory) {
                const firstDigit = taloCode.charAt(0);
                const categoryMap: Record<string, string> = {
                  '1': 'RAKENNUSOSAT',
                  '2': 'PERUSTUKSET JA ULKOPUOLISET RAKENTEET',
                  '3': 'RUNKO JA VESIKATTORAKENTEET',
                  '4': 'TÄYDENTÄVÄT RAKENTEET',
                  '5': 'PINTARAKENTEET',
                  '6': 'KALUSTEET, VARUSTEET JA LAITTEET',
                  '7': 'KONETEKNISET TYÖT'
                };
                codeCategory = categoryMap[firstDigit] || '';
              }

              litteraCodesArray.push({
                litteraCode: filteredCode.litteraCode,
                litteraName: filteredCode.description,
                litteraCategory: codeCategory || undefined,
                unit: finalUnit,
                relevanceScore: filteredCode.relevanceScore,
                quantity: codeQuantity,
                source: 'suggestion'
              });
            }
          });

          // Mantener compatibilidad con campos legacy usando el primer código
          if (litteraCodesArray.length > 0 && !litteraCode) {
            const firstCode = litteraCodesArray[0];
            litteraCode = firstCode.litteraCode;
            litteraName = firstCode.litteraName;
            litteraCategory = firstCode.litteraCategory || '';
          }

          if (litteraCodesArray.length > 0) {
            console.log(`[CostCalculator] ${litteraCodesArray.length} Littera code(s) assigned via filtering for element ${id}:`, 
              litteraCodesArray.map(lc => lc.litteraCode).join(', '));
          }
          } // end generic Littera filtering (non-confirmed ontelolaatta)
        } catch (error) {
          console.warn(`[CostCalculator] Error filtering Littera codes for element ${id}:`, error);
          // Continuar sin códigos Littera si hay error
        }
      }

      // Calculate and complete base quantities using centralized logic
      // This ensures consistency: IFC → geometry → fallback volume/thickness
      const calculatedQuantities = calculateBaseQuantities(
        quantities,
        ifcType,
        model,
        id
      );
      
      // Merge calculated quantities back into quantities object (with units)
      // IMPORTANTE: Preservar valores originales del IFC, solo agregar calculados si faltan
      const completedQuantities = toBaseQuantitiesFormat(calculatedQuantities);
      // Merge: valores originales del IFC tienen prioridad, solo agregar calculados si no existen
      const finalQuantities: { [key: string]: { value: number; unit: string } } = { ...quantities };
      Object.keys(completedQuantities).forEach(key => {
        // Solo agregar valores calculados si no existen en el IFC original
        if (!finalQuantities[key]) {
          finalQuantities[key] = completedQuantities[key];
        }
      });

      applyQtoPreservePolicies(finalQuantities, ifcType);

      // Segunda pasada: geometría Revit/Tekla ya rellenó L/W/H (p. ej. barandilla H=4,92 m, L=0,04 m).
      this.resolveStructuralLength(finalQuantities, extraProperties, ifcType);

      applyQtoPreservePolicies(finalQuantities, ifcType);

      const elementNameForQty = element.Name?.value || 'Unknown';
      if (litteraCodesArray.length > 0) {
        const isDoorOrWindow =
          ifcType.toUpperCase().includes('DOOR') || ifcType.toUpperCase().includes('WINDOW');

        for (const lc of litteraCodesArray) {
          if (lc.source === 'ontelolaatta') continue;

          const unitUpper = (lc.unit ?? '').toUpperCase();
          const isLength = unitUpper === 'JM' || unitUpper === 'M';
          // Para puertas/ventanas también recalcular M2/BRM2/NM2 con Overall*
          const isArea = isDoorOrWindow &&
            (unitUpper === 'M2' || unitUpper === 'BRM2' || unitUpper === 'NM2');

          if (!isLength && !isArea) continue;

          const recalc = getQuantityForLitteraCodeByType(
            ifcType,
            lc.unit,
            finalQuantities,
            elementNameForQty,
            finalQuantity,
            { description: lc.litteraName },
            extraProperties
          );
          if (recalc > 0) {
            lc.quantity = recalc;
          }
        }
      }

      // Coste inicial = estadístico (Statistics Finland 2024 por TALO/tipo). Las sugerencias de Littera
      // se muestran con precios desde littera-prices.json pero no se suman; solo el import Excel sustituye.
      const elementName = element.Name?.value || 'Unknown';

      // A/B: wall face after L/W/H completed (IfcWall vs StandardCase)
      let publishedQuantity = finalQuantity;
      if (ifcType.toUpperCase().includes('WALL')) {
        const wallFace = resolveWallFaceArea(finalQuantities, 'any', extraProperties);
        if (wallFace.value > 0) {
          publishedQuantity = wallFace.value;
        }
        // Recalc littera M2 codes with completed quantities
        for (const lc of litteraCodesArray) {
          const u = (lc.unit ?? '').toUpperCase();
          if (u === 'M2' || u === 'BRM2' || u === 'NM2') {
            const prefer = u === 'NM2' ? 'net' : u === 'BRM2' ? 'gross' : 'any';
            const face = resolveWallFaceArea(finalQuantities, prefer, extraProperties);
            if (face.value > 0) lc.quantity = face.value;
          }
        }
      }

      let costsFromStatFin = { material: 0, labor: 0, subcontract: 0, total: 0 };
      if (taloCode) {
        const statResult = UnifiedCostService.getInstance().calculateElementCost(
          taloCode,
          publishedQuantity,
          elementName,
          ifcType,
          finalQuantities,
          'helsinki'
        );
        if (statResult?.costs) {
          costsFromStatFin = {
            material: statResult.costs.material ?? 0,
            labor: statResult.costs.labor ?? 0,
            subcontract: statResult.costs.subcontract ?? 0,
            total: statResult.costs.total ?? 0,
          };
        }
      }

      const updatedCostElement: BaseCostElement = applyBridgeCorrectorStorePass(
        applyMeasurementReliabilityFinalPass(
          applyLayerAssemblyPolicyToElement(
            applyInstancedBBoxGuardToElement(
              applyFamilyQuantityPolicyToElement(
                applyOnteloQuantityPolicyToElement(
                  applyHollowSectionPolicyToElement(
                    applyWallFacePolicyToElement(
                      applyWidthLengthSignalToElement({
                        id: Number(id),
                        globalId: element.GlobalId?.value ?? undefined,
                        name: elementName,
                        type: ifcType,
                        category: element.ObjectType?.value || ifcType,
                        quantity: publishedQuantity,
                        taloCode: taloCode,
                        taloName: taloName,
                        costs: costsFromStatFin,
                        baseQuantities: finalQuantities,
                        litteraCodes: litteraCodesArray.length > 0 ? litteraCodesArray : undefined,
                        litteraCode: litteraCode || undefined,
                        litteraName: litteraName || undefined,
                        litteraCategory: litteraCategory || undefined,
                        extraProperties:
                          Object.keys(extraProperties).length > 0 ? extraProperties : undefined,
                        floor: floor,
                      })
                    )
                  )
                )
              )
            ),
            useCostStore.getState().layerAssembly
          )
        )
      );
      this._results.push(updatedCostElement);

    } catch (error) {
      console.error('[CostCalculator] Error processing element:', id, error);
      this.onError.trigger(error as Error);
    }
  }

  /** Resolves ReferencedSource (IfcClassification) once per expressID per run; cache avoids repeated getProperties. */
  private async isTaloReferencedSource(model: any, sourceId: number): Promise<boolean> {
    const cached = this._taloSourceCache.get(sourceId);
    if (cached !== undefined) return cached;
    const sourceData = await model.getProperties(sourceId);
    const name = sourceData?.Name?.value ?? '';
    const desc = sourceData?.Description?.value ?? '';
    const isTalo = name.includes('TALO') || desc.includes('TALO');
    this._taloSourceCache.set(sourceId, isTalo);
    return isTalo;
  }

  /**
   * Gets TALO code and name from IFC classification relations (element or type).
   * Handles: (1) indexer returns IfcClassificationReference IDs (ItemReference/Identification + ReferencedSource),
   * (2) relation object with Identification/ReferencedSource, (3) standard IFC via RelatingClassification.
   */
  private async getTaloFromClassificationRelations(
    model: any,
    classificationRelations: number[]
  ): Promise<{ taloCode: string; taloName: string }> {
    let taloCode = '';
    let taloName = '';
    if (!classificationRelations || classificationRelations.length === 0) return { taloCode, taloName };

    const seenIds = new Set<number>();
    for (const relId of classificationRelations) {
      if (seenIds.has(relId)) continue;
      seenIds.add(relId);
      const entity = await model.getProperties(relId);
      if (!entity) continue;

      // Code can be in Identification (standard), ItemReference, or Location (e.g. some Archicad/web-ifc exports)
      const identification = entity.Identification?.value ?? entity.ItemReference?.value ?? (typeof entity.ItemReference === 'string' ? entity.ItemReference : undefined) ?? entity.Location?.value ?? (typeof entity.Location === 'string' ? entity.Location : undefined);
      const name = entity.Name?.value;

      // Entity may be IfcClassificationReference directly (indexer returns reference IDs): has ReferencedSource, Name
      if (entity.ReferencedSource?.value != null) {
        const sourceId = entity.ReferencedSource.value;
        if (await this.isTaloReferencedSource(model, sourceId)) {
          if (identification) {
            taloCode = this.normalizeTaloCode(identification);
            taloName = name || '';
            return { taloCode, taloName };
          }
          if (name) taloName = name;
        }
        continue;
      }

      if (entity.type !== IFC.IFCRELASSOCIATESCLASSIFICATION) continue;

      if (identification) {
        if (entity.ReferencedSource?.value) {
          if (await this.isTaloReferencedSource(model, entity.ReferencedSource.value)) {
            taloCode = this.normalizeTaloCode(identification);
            taloName = name || '';
            return { taloCode, taloName };
          }
        } else {
          const normalizedCode = this.normalizeTaloCode(identification);
          if (normalizedCode) {
            taloCode = normalizedCode;
            taloName = name || '';
            return { taloCode, taloName };
          }
        }
      }
    }

    for (const relId of classificationRelations) {
      const relation = await model.getProperties(relId);
      if (!relation || relation.type !== IFC.IFCRELASSOCIATESCLASSIFICATION) continue;
      if (!relation.RelatingClassification?.value) continue;

      const classRef = await model.getProperties(relation.RelatingClassification.value);
      if (!classRef) continue;

      const identification = classRef.Identification?.value ?? classRef.ItemReference?.value ?? (typeof classRef.ItemReference === 'string' ? classRef.ItemReference : undefined) ?? classRef.Location?.value ?? (typeof classRef.Location === 'string' ? classRef.Location : undefined);
      const name = classRef.Name?.value;

      if (!identification) continue;

      if (classRef.ReferencedSource?.value) {
        if (await this.isTaloReferencedSource(model, classRef.ReferencedSource.value)) {
          taloCode = this.normalizeTaloCode(identification);
          taloName = name || '';
          return { taloCode, taloName };
        }
      } else {
        const normalizedCode = this.normalizeTaloCode(identification);
        if (normalizedCode) {
          taloCode = normalizedCode;
          taloName = name || '';
          return { taloCode, taloName };
        }
      }
    }

    return { taloCode, taloName };
  }

  /**
   * Normaliza un código TALO al formato estándar con puntos
   * Acepta códigos con puntos (1.2.3) o sin puntos (123)
   * Convierte "123" -> "1.2.3", "121" -> "1.2.1", etc.
   */
  private normalizeTaloCode(code: string): string {
    if (!code || typeof code !== 'string') return '';
    
    // Si ya tiene puntos, validar formato y retornar
    if (code.match(/^\d+\.\d+(\.\d+)*$/)) {
      return code;
    }
    
    // Si es solo números sin puntos, convertir al formato con puntos
    // Ejemplo: "123" -> "1.2.3", "121" -> "1.2.1", "21" -> "2.1"
    if (code.match(/^\d+$/)) {
      // Convertir cada dígito en un nivel separado por puntos
      // "123" -> ["1", "2", "3"] -> "1.2.3"
      const digits = code.split('');
      return digits.join('.');
    }
    
    // Si no coincide con ningún formato esperado, retornar vacío
    return '';
  }

  private updateResultsTable(): void {
    const tableData: MaterialCostsTableData[] = this._results.map(element => ({
      id: element.id.toString(),
      name: element.name,
      description: '', // BaseCostElement doesn't have description field
      type: element.type,
      category: element.category,
      taloCode: element.taloCode,
      materialCost: element.costs?.material || 0,
      laborCost: element.costs?.labor || 0,
      subcontractCost: element.costs?.subcontract || 0,
      totalCost: element.costs?.total || 0,
      // Include Littera classification data
      litteraCodes: element.litteraCodes,
      litteraCode: element.litteraCode,
      litteraName: element.litteraName,
      litteraCategory: element.litteraCategory
    }));

    this.materialCostsTable.data = tableData;
    
    // Debug: Log summary of Littera codes in table
    const elementsWithLittera = tableData.filter(el => el.litteraCodes && el.litteraCodes.length > 0).length;
    const totalLitteraCodes = tableData.reduce((sum, el) => sum + (el.litteraCodes?.length || 0), 0);
    console.log(`[CostCalculator] materialCostsTable updated: ${tableData.length} elements, ${elementsWithLittera} with Littera codes (${totalLitteraCodes} total codes)`);
  }
}
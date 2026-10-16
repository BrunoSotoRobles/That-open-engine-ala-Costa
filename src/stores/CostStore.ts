import { create } from 'zustand';
import { BaseCostElement, CostAnalysisResult, BaseProjectInfo } from '../types/cost';
import { getCorrectUnit, getCorrectQuantity, getQuantityForLitteraCodeByType, TALO_2000_CATALOG } from '../constants/talo2000';
import { Talo2000Unit } from '../types/talo2000';
import { filterOutExcludedMeasurements } from '../utils/measurementExclusions';
import { applyWidthLengthSignalToElement } from '../utils/widthLengthSignal';
import { applyWallFacePolicyToElement } from '../utils/wallFaceArea';
import { applyHollowSectionPolicyToElement } from '../utils/hollowSectionPolicy';
import { applySharedInstanceBBoxGuard } from '../utils/instancedBBoxGuard';
import { applyOnteloQuantityPolicyToElement } from '../utils/onteloQuantityPolicy';
import { applyFamilyQuantityPolicyToElement } from '../utils/familyQuantityPolicy';
import { applyMeasurementReliabilityFinalPass } from '../utils/measurementReliability';
import { summarizeAbPolicies } from '../utils/abPolicySummary';
import { PIECE_WIDTH_M, computePieceCount } from '../utils/ontelolaattaUtils';
import {
  applyLayerAssemblyPolicyToElement,
  inferLayerAssemblyConfirmationFromElements,
  FACADE_ASSEMBLY_KEY,
  FACADE_TALO_HINT,
  type LayerAssemblyConfirmation,
} from '../utils/layerAssemblyPolicy';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del slice ontelolaattaMcp
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una entrada por cada IfcSlab Oxx que el usuario ha orientado.
 * NOTA: Este tipo es EXCLUSIVO del slice ontelolaattaMcp y no forma parte
 * de BaseCostElement ni de costData. No afecta Littera ni analyzeCosts.
 */
export interface OntelolaattaMcpEntry {
  globalId: string;
  expressId: number;
  /** Código normalizado: "O32", "O27M", etc. */
  onteloType: string;
  /** Espesor en mm desde tabla fija (null si el código no está catalogado) */
  thicknessMm: number | null;
  /** Dirección unitaria del vano en planta */
  spanDir: { x: number; y: number };
  /** Dirección perpendicular unitaria en planta */
  perpDir: { x: number; y: number };
  /** Longitud del campo en metros (eje del vano) */
  fieldLength: number;
  /** Ancho del campo en metros (eje perpendicular) */
  fieldWidth: number;
  /** Constante de dominio: 1.2 m */
  pieceWidth: 1.2;
  /** ceil(fieldWidth / 1.2) */
  pieceCount: number;
  /** true = línea sobre el borde largo; false = borde corto (Rotate 90°) */
  lineAlongLong: boolean;
  /** 'auto' = dirección calculada desde bbox; 'user-flipped' = girada por el usuario */
  source: 'auto' | 'user-flipped';
  /** true cuando el usuario ha pulsado "Confirmar" */
  confirmed: boolean;
  /** Longitud real de la línea 3D en metros (lo que ve el usuario en LengthMeasurement) */
  measuredLineLengthM?: number;
  /** Planta del modelo, si está disponible */
  floor?: string;
  /** Identificador del modelo IFC */
  modelId?: string;
}

export type Language = 'en' | 'fi';

type CostInfo = BaseProjectInfo;

/**
 * Traceability: costData elements may carry globalId (IFC GlobalId / GUID).
 * That identifier must remain constant across CostPage and twin and all store updates
 * so we can cross-reference with Revit, Solibri, SimpleBIM and Excel (Open BIM).
 * All store updaters preserve globalId by spreading the existing element (...el).
 * When calling setCostData with a new array, keep globalId on every element that had one.
 */
interface CostState {
  language: Language;
  costData: BaseCostElement[];
  projectInfo: CostInfo | null;
  analysisResult: CostAnalysisResult | null;
  /**
   * Map de plantillas de listados detectadas automáticamente
   * a partir de extraProperties en costData:
   * - clave de primer nivel: IFC Type (ej. "IfcWindow")
   * - psets: nombre de Property Set -> lista de propiedades
   */
  listingTemplates: {
    [ifcType: string]: {
      count: number;
      psets: {
        [psetName: string]: string[];
      };
    };
  };
  setLanguage: (lang: Language) => void;
  setCostData: (data: BaseCostElement[]) => void;
  setProjectInfo: (info: CostInfo) => void;
  analyzeCosts: () => void;
  setAnalysisResult: (result: CostAnalysisResult | null) => void;
  applySuggestion: (elementId: number, taloCode: string) => void;
  undoSuggestion: (elementId: number) => void;
  applySuggestionGroup: (elementIds: number[], taloCode: string) => void;
  // Littera BOQ classification functions (supporting multiple codes per element)
  addLitteraCode: (elementId: number, litteraCode: string, litteraName: string, litteraCategory: string | null, unit: string, quantity?: number) => void;
  removeLitteraCode: (elementId: number, litteraCode: string) => void;
  updateLitteraCodeQuantity: (elementId: number, litteraCode: string, quantity: number) => void;
  // Legacy functions for backward compatibility (now add to array instead of replace)
  applyLitteraSuggestion: (elementId: number, litteraCode: string, litteraName: string, litteraCategory: string | null) => void;
  undoLitteraSuggestion: (elementId: number) => void;
  applyLitteraSuggestionGroup: (elementIds: number[], litteraCode: string, litteraName: string, litteraCategory: string | null) => void;
  /** Elimina elementos del listado por IDs (tabla, Excel, cálculos) */
  removeElementsByIds: (ids: number[]) => void;

  // ─── Slice exclusivo para herramienta MCP ontelolaatta ───────────────────
  // No afecta costData, Littera ni analyzeCosts.
  ontelolaattaMcp: {
    byGlobalId: Record<string, OntelolaattaMcpEntry>;
  };
  /** Crea o sobreescribe la entrada sin tocar costData */
  setOntelolaattaOrientation: (
    globalId: string,
    entry: Omit<OntelolaattaMcpEntry, 'confirmed'>
  ) => void;
  /** Alterna la línea entre borde largo y corto (Rotate 90°) */
  flipOntelolaattaSpan: (globalId: string) => void;
  /** Marca la entrada como confirmada */
  confirmOntelolaattaArray: (globalId: string) => void;
  /** Actualiza medidas geométricas sin tocar orientación ni confirmed */
  updateOntelolaattaMeasurements: (
    globalId: string,
    measurements: { fieldLength: number; measuredLineLengthM: number }
  ) => void;
  /** Elimina la entrada del slice */
  clearOntelolaattaEntry: (globalId: string) => void;

  /**
   * First Talo process: exploded Tekla layers. Null until the user accepts/rejects
   * via MCP. When confirmed, setCostData republishes määrä (host paño only).
   */
  layerAssembly: LayerAssemblyConfirmation | null;
  confirmLayerAssembly: (next: LayerAssemblyConfirmation) => void;
  rejectLayerAssembly: () => void;
}

/**
 * Agrega costData a CostAnalysisResult (fuente: nuestra base de datos).
 * Se usa para comparativas y métricas; la referencia Finnish se mantiene en el gráfico/benchmarks.
 */
function buildAnalysisResultFromCostData(costData: BaseCostElement[], projectArea: number): CostAnalysisResult {
  const totalCosts = { material: 0, labor: 0, subcontract: 0, total: 0 };
  const costByCategory: { [category: string]: { material: number; labor: number; subcontract: number; total: number } } = {};
  const costByTaloCode: { [taloCode: string]: { material: number; labor: number; subcontract: number; total: number } } = {};
  for (const el of costData) {
    totalCosts.material += el.costs?.material ?? 0;
    totalCosts.labor += el.costs?.labor ?? 0;
    totalCosts.subcontract += el.costs?.subcontract ?? 0;
    totalCosts.total += el.costs?.total ?? 0;
    const cat = el.type || 'Other';
    if (!costByCategory[cat]) costByCategory[cat] = { material: 0, labor: 0, subcontract: 0, total: 0 };
    costByCategory[cat].material += el.costs?.material ?? 0;
    costByCategory[cat].labor += el.costs?.labor ?? 0;
    costByCategory[cat].subcontract += el.costs?.subcontract ?? 0;
    costByCategory[cat].total += el.costs?.total ?? 0;
    const code = el.taloCode || '—';
    if (!costByTaloCode[code]) costByTaloCode[code] = { material: 0, labor: 0, subcontract: 0, total: 0 };
    costByTaloCode[code].material += el.costs?.material ?? 0;
    costByTaloCode[code].labor += el.costs?.labor ?? 0;
    costByTaloCode[code].subcontract += el.costs?.subcontract ?? 0;
    costByTaloCode[code].total += el.costs?.total ?? 0;
  }
  const percentageByCategory: { [k: string]: number } = {};
  if (totalCosts.total > 0) {
    for (const [cat, c] of Object.entries(costByCategory)) {
      percentageByCategory[cat] = (c.total / totalCosts.total) * 100;
    }
  }
  return {
    elementCosts: costData,
    totalCosts,
    costByCategory,
    costByTaloCode,
    metrics: {
      costPerArea: projectArea > 0 ? totalCosts.total / projectArea : 0,
      percentageByCategory,
      timeMetrics: {
        totalDuration: 0,
        laborHoursPerM2: 0,
        phaseDistribution: {}
      }
    }
  };
}

export const useCostStore = create<CostState>((set, get) => {
  let analysisTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleAnalysis = () => {
    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = setTimeout(() => {
      const state = get();
      if (state.costData.length > 0 && state.projectInfo) {
        const area = state.projectInfo.area ?? 0;
        const result = buildAnalysisResultFromCostData(state.costData, area);
        set({ analysisResult: result });
      }
      analysisTimer = null;
    }, 300);
  };

  return {
    language: 'en',
    costData: [],
    projectInfo: null,
    analysisResult: null,
    listingTemplates: {},

    setLanguage: (lang: Language) => set({ language: lang }),
    
    setCostData: (data: BaseCostElement[]) => {
      const { kept, excludedCount } = filterOutExcludedMeasurements(data);
      if (excludedCount > 0) {
        console.info(
          `[CostStore] Paso 1 measurement exclusions: removed ${excludedCount} element(s); kept ${kept.length}`
        );
      }
      // A/B policies: dim duplication → wall face → hollow → D3 shared bbox
      let dataToStore = kept
        .map((el) => applyWidthLengthSignalToElement(el))
        .map((el) => applyWallFacePolicyToElement(el))
        .map((el) => applyHollowSectionPolicyToElement(el))
        .map((el) => applyOnteloQuantityPolicyToElement(el))
        .map((el) => applyFamilyQuantityPolicyToElement(el));
      dataToStore = applySharedInstanceBBoxGuard(dataToStore);
      let layerConf = get().layerAssembly;
      if (!layerConf?.confirmed) {
        const inferred = inferLayerAssemblyConfirmationFromElements(dataToStore);
        if (inferred) {
          set({ layerAssembly: inferred });
          layerConf = inferred;
        }
      }
      dataToStore = dataToStore.map((el) => applyLayerAssemblyPolicyToElement(el, layerConf));
      dataToStore = dataToStore.map((el) => applyMeasurementReliabilityFinalPass(el));
      const ab = summarizeAbPolicies(dataToStore);
      if (ab.dimSignals > 0 || ab.wallFace > 0 || ab.hollowPreferNet > 0 || ab.ontelo > 0 || ab.bboxPoison > 0 || ab.layerHidden > 0) {
        console.info(
          `[CostStore] A/B policies: dimSignals=${ab.dimSignals}, wallFace=${ab.wallFace}, hollowPreferNet=${ab.hollowPreferNet}, ontelo=${ab.ontelo}, bboxPoison=${ab.bboxPoison}, published=${ab.publishedQuantity}, layerHost=${ab.layerHost}, layerHidden=${ab.layerHidden}`
        );
      }

      // Garantizar trazabilidad: en desarrollo, detectar si se pierde globalId al reemplazar
      if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
        const prev = get().costData;
        const prevById = new Map(prev.map(el => [el.id, el]));
        for (const el of dataToStore) {
          const prevEl = prevById.get(el.id);
          if (prevEl?.globalId != null && el.globalId !== prevEl.globalId) {
            console.warn('[CostStore] globalId traceability: element', el.id, 'should preserve globalId', prevEl.globalId, '(got', el.globalId, '). Use ...element when building updated data.');
          }
        }
      }
      // Construir plantillas de listados automáticamente a partir de extraProperties
      const listingTemplates: {
        [ifcType: string]: {
          count: number;
          psets: {
            [psetName: string]: Set<string>;
          };
        };
      } = {};

      for (const el of dataToStore) {
        const ifcType = el.type || 'Unknown';
        if (!listingTemplates[ifcType]) {
          listingTemplates[ifcType] = { count: 0, psets: {} };
        }
        listingTemplates[ifcType].count++;

        const extra: Record<string, any> | undefined = (el as any).extraProperties;
        if (!extra || typeof extra !== 'object') continue;

        for (const fullKey of Object.keys(extra)) {
          const dot = fullKey.indexOf('.');
          const psetName = dot > 0 ? fullKey.slice(0, dot) : '';
          const propName = dot > 0 ? fullKey.slice(dot + 1) : fullKey;
          if (!psetName || !propName) continue;

          if (!listingTemplates[ifcType].psets[psetName]) {
            listingTemplates[ifcType].psets[psetName] = new Set();
          }
          listingTemplates[ifcType].psets[psetName].add(propName);
        }
      }

      // Convertir los Sets internos a arrays serializables
      const serializableTemplates: CostState['listingTemplates'] = {};
      for (const [ifcType, info] of Object.entries(listingTemplates)) {
        const psets: { [psetName: string]: string[] } = {};
        for (const [psetName, propSet] of Object.entries(info.psets)) {
          psets[psetName] = Array.from(propSet as Set<string>).sort();
        }
        serializableTemplates[ifcType] = {
          count: info.count,
          psets,
        };
      }

      set({ costData: dataToStore, listingTemplates: serializableTemplates });
      // OPTIMIZACIÓN: Debounce del análisis para evitar cálculos repetidos
      scheduleAnalysis();
    },

    setProjectInfo: (info: CostInfo) => {
      set({ projectInfo: info });
      // OPTIMIZACIÓN: Usar debounce para análisis
      scheduleAnalysis();
    },

    analyzeCosts: () => {
      const state = get();
      if (state.costData.length > 0 && state.projectInfo) {
        const area = state.projectInfo.area ?? 0;
        const result = buildAnalysisResultFromCostData(state.costData, area);
        set({ analysisResult: result });
      }
    },

    setAnalysisResult: (result: CostAnalysisResult | null) => set({ analysisResult: result }),
    applySuggestion: (elementId: number, taloCode: string) => {
    const state = get();
    const updated = state.costData.map(el => {
      if (el.id !== elementId) return el;
      const unit = getCorrectUnit(el.type, taloCode);
      let qty = getCorrectQuantity({ baseQuantities: el.baseQuantities, type: el.type }, unit);
      
      // Si la cantidad es 0, usar la cantidad existente del elemento
      if (qty === 0 && el.quantity > 0) {
        qty = el.quantity;
      }
      
      // Si aún es 0, intentar obtener de baseQuantities directamente
      if (qty === 0 && el.baseQuantities) {
        const quantities = Object.values(el.baseQuantities);
        if (quantities.length > 0) {
          qty = quantities[0].value || 0;
        }
      }
      
      const taloName = TALO_2000_CATALOG[taloCode]?.name?.fi ?? el.taloName ?? '';
      return {
        ...el,
        taloCode,
        taloName,
        quantity: qty > 0 ? qty : el.quantity
      };
    });
      set({ costData: updated });
      // OPTIMIZACIÓN: Usar debounce para análisis
      scheduleAnalysis();
    },
    undoSuggestion: (elementId: number) => {
      const state = get();
      const updated = state.costData.map(el => (el.id === elementId ? { ...el, taloCode: '' } : el));
      set({ costData: updated });
      // OPTIMIZACIÓN: Usar debounce para análisis
      scheduleAnalysis();
    },
    applySuggestionGroup: (elementIds: number[], taloCode: string) => {
      const state = get();
      const idSet = new Set(elementIds);
      const taloName = TALO_2000_CATALOG[taloCode]?.name?.fi ?? '';
      const updated = state.costData.map(el => {
        if (!idSet.has(el.id)) return el;
        const unit = getCorrectUnit(el.type, taloCode);
        const qty = getCorrectQuantity({ baseQuantities: el.baseQuantities, type: el.type }, unit);
        return {
          ...el,
          taloCode,
          taloName,
          quantity: qty > 0 ? qty : el.quantity
          // Costes sin cambiar (fuente: nuestra base / Excel)
        };
      });
      set({ costData: updated });
      scheduleAnalysis();
    },

  // Littera BOQ classification functions (supporting multiple codes per element)
  addLitteraCode: (elementId: number, litteraCode: string, litteraName: string, litteraCategory: string | null, unit: string, quantity?: number) => {
    const state = get();
    const updated = state.costData.map(el => {
      if (el.id !== elementId) return el;
      
      // Get existing codes or create new array
      const existingCodes = el.litteraCodes || [];
      
      // Check if code already exists
      const codeExists = existingCodes.some(lc => lc.litteraCode === litteraCode);
      if (codeExists) {
        console.warn(`[CostStore] Littera code ${litteraCode} already exists for element ${elementId}`);
        return el;
      }
      
      // Calculate quantity based on unit if not provided
      // Usar la función que considera el tipo de elemento IFC para asignar la cantidad correcta
      let calculatedQuantity = quantity;
      if (calculatedQuantity === undefined) {
        // Usar la función centralizada que considera el tipo de elemento IFC
        calculatedQuantity = getQuantityForLitteraCodeByType(
          el.type, // Tipo IFC del elemento
          unit,    // Unidad requerida por el código Littera
          el.baseQuantities || {}, // Cantidades base del elemento
          el.name || '', // Nombre del elemento (para contexto en perímetro)
          el.quantity || 0, // Cantidad final de fallback
          { litteraCode, description: litteraName }, // Código Littera para contexto
          el.extraProperties
        );
        
        // Fallback to element quantity if calculation failed (not for sandwich layers)
        if (
          (calculatedQuantity === 0 || calculatedQuantity === undefined) &&
          el.extraProperties?.["CostaBIM.ContributeToMaara"] !== 0
        ) {
          calculatedQuantity = el.quantity;
        }
      }
      
      // Add new code to array
      const newCode = {
        litteraCode,
        litteraName,
        litteraCategory: litteraCategory || undefined,
        unit,
        quantity: calculatedQuantity,
        // Asignaciones hechas desde la UI/CostPage se consideran de origen usuario
        source: 'user' as const,
        // Future: Costs per Littera code (prepared for future implementation)
        costs: undefined
      };
      
      const updatedCodes = [...existingCodes, newCode];
      
      // Update legacy fields with first code for backward compatibility
      const updatedElement = {
        ...el,
        litteraCodes: updatedCodes,
        litteraCode: updatedCodes[0].litteraCode,
        litteraName: updatedCodes[0].litteraName,
        litteraCategory: updatedCodes[0].litteraCategory
      };
      
      return updatedElement;
    });
    set({ costData: updated });
    console.log(`[CostStore] Added Littera ${litteraCode} to element ${elementId} (total: ${updated.find(e => e.id === elementId)?.litteraCodes?.length || 0})`);
  },

  removeLitteraCode: (elementId: number, litteraCode: string) => {
    const state = get();
    const updated = state.costData.map(el => {
      if (el.id !== elementId) return el;
      
      const existingCodes = el.litteraCodes || [];
      const updatedCodes = existingCodes.filter(lc => lc.litteraCode !== litteraCode);
      
      if (updatedCodes.length === 0) {
        // Remove all Littera data if no codes remain
      return {
        ...el,
          litteraCodes: undefined,
        litteraCode: undefined,
        litteraName: undefined,
        litteraCategory: undefined
        };
      }
      
      // Update legacy fields with first code
      return {
        ...el,
        litteraCodes: updatedCodes,
        litteraCode: updatedCodes[0].litteraCode,
        litteraName: updatedCodes[0].litteraName,
        litteraCategory: updatedCodes[0].litteraCategory
      };
    });
    set({ costData: updated });
    console.log(`[CostStore] Removed Littera ${litteraCode} from element ${elementId}`);
  },

  updateLitteraCodeQuantity: (elementId: number, litteraCode: string, quantity: number) => {
    const state = get();
    const updated = state.costData.map(el => {
      if (el.id !== elementId) return el;
      
      const existingCodes = el.litteraCodes || [];
      const updatedCodes = existingCodes.map(lc => {
        if (lc.litteraCode === litteraCode) {
          return { ...lc, quantity };
        }
        return lc;
      });
      
      return {
        ...el,
        litteraCodes: updatedCodes
      };
    });
    set({ costData: updated });
    console.log(`[CostStore] Updated quantity for Littera ${litteraCode} on element ${elementId} to ${quantity}`);
  },

  // Legacy functions for backward compatibility (now add to array instead of replace)
  applyLitteraSuggestion: (elementId: number, litteraCode: string, litteraName: string, litteraCategory: string | null) => {
    const state = get();
    const element = state.costData.find(el => el.id === elementId);
    if (!element) return;
    
    // Determine unit from existing codes or default
    const unit = '***'; // Default unit, can be improved
    const quantity = element.quantity;
    
    // Use new function to add code
    const store = get();
    store.addLitteraCode(elementId, litteraCode, litteraName, litteraCategory, unit, quantity);
  },

  undoLitteraSuggestion: (elementId: number) => {
    const state = get();
    const element = state.costData.find(el => el.id === elementId);
    if (!element || !element.litteraCode) return;
    
    // Remove the first/primary code
    const store = get();
    store.removeLitteraCode(elementId, element.litteraCode);
  },

  applyLitteraSuggestionGroup: (elementIds: number[], litteraCode: string, litteraName: string, litteraCategory: string | null) => {
    const state = get();
    elementIds.forEach(elementId => {
      const element = state.costData.find(el => el.id === elementId);
      if (!element) return;
      
      const unit = '***'; // Default unit
      const quantity = element.quantity;
      const store = get();
      store.addLitteraCode(elementId, litteraCode, litteraName, litteraCategory, unit, quantity);
    });
    console.log(`[CostStore] Applied Littera ${litteraCode} to ${elementIds.length} elements`);
  },

  removeElementsByIds: (ids: number[]) => {
    const idSet = new Set(ids);
    set((state) => ({
      costData: state.costData.filter((el) => !idSet.has(el.id))
    }));
    scheduleAnalysis();
  },

  // ─── Slice ontelolaattaMcp ───────────────────────────────────────────────

  ontelolaattaMcp: { byGlobalId: {} },
  layerAssembly: null,

  confirmLayerAssembly: (next) => {
    set({
      layerAssembly: {
        ...next,
        confirmed: true,
        assemblyKey: next.assemblyKey || FACADE_ASSEMBLY_KEY,
        taloHint: next.taloHint || FACADE_TALO_HINT,
      },
    });
    const data = get().costData;
    if (data.length > 0) get().setCostData(data);
  },

  rejectLayerAssembly: () => {
    set({
      layerAssembly: {
        confirmed: false,
        assemblyKey: FACADE_ASSEMBLY_KEY,
        taloHint: FACADE_TALO_HINT,
        hostNames: [],
        layerNames: [],
        otherNames: [],
      },
    });
    const data = get().costData;
    if (data.length > 0) get().setCostData(data);
  },


  setOntelolaattaOrientation: (globalId, entry) => {
    set((state) => ({
      ontelolaattaMcp: {
        byGlobalId: {
          ...state.ontelolaattaMcp.byGlobalId,
          [globalId]: { ...entry, confirmed: false },
        },
      },
    }));
  },

  flipOntelolaattaSpan: (globalId) => {
    set((state) => {
      const existing = state.ontelolaattaMcp.byGlobalId[globalId];
      if (!existing) return state;
      return {
        ontelolaattaMcp: {
          byGlobalId: {
            ...state.ontelolaattaMcp.byGlobalId,
            [globalId]: {
              ...existing,
              lineAlongLong: !(existing.lineAlongLong ?? true),
              source: 'user-flipped' as const,
              confirmed: false,
            },
          },
        },
      };
    });
  },

  confirmOntelolaattaArray: (globalId) => {
    set((state) => {
      const existing = state.ontelolaattaMcp.byGlobalId[globalId];
      if (!existing) return state;
      return {
        ontelolaattaMcp: {
          byGlobalId: {
            ...state.ontelolaattaMcp.byGlobalId,
            [globalId]: { ...existing, confirmed: true },
          },
        },
      };
    });
  },

  updateOntelolaattaMeasurements: (globalId, measurements) => {
    set((state) => {
      const existing = state.ontelolaattaMcp.byGlobalId[globalId];
      if (!existing) return state;
      return {
        ontelolaattaMcp: {
          byGlobalId: {
            ...state.ontelolaattaMcp.byGlobalId,
            [globalId]: { ...existing, ...measurements },
          },
        },
      };
    });
  },

  clearOntelolaattaEntry: (globalId) => {
    set((state) => {
      const next = { ...state.ontelolaattaMcp.byGlobalId };
      delete next[globalId];
      return { ontelolaattaMcp: { byGlobalId: next } };
    });
  },
  };
});

// DEBUG: expone la CostStore en window para inspección desde la consola del navegador
if (typeof window !== 'undefined') {
  (window as any).__costStore = useCostStore;
}
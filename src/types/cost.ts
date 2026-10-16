/**
 * Modelo unificado de costes para todo el dominio Costa.
 *
 * Se basa en la práctica finlandesa y en StatFin:
 * - material   → tarvikepanokset / KL2
 * - labor      → työpanokset / KL1
 * - subcontract → palvelut / KL3 (aliurakka: subcontratas y servicios)
 */
export interface FinnishCostValues {
  material: number;
  labor: number;
  subcontract: number;
  total: number;
}

/**
 * Tipos legacy mantenidos solo para compatibilidad transitoria.
 * No deben usarse para nueva lógica; todo el código nuevo debe usar FinnishCostValues.
 */
export interface CostValues {
  material: number;
  labor: number;
  transport: number;
  overhead: number;
  total: number;
}

export interface MaterialCosts {
  material: number;
  labor: number;
  transport: number;
  overhead: number;
  total: number;
}

export interface UnifiedCostValues {
  material: number;
  labor: number;
  equipment?: number;
  transport?: number;
  overhead: number;
  total: number;
}

export interface ModernCostValues extends FinnishCostValues {}

export type TransportMode = 'none' | 'truck' | 'train' | 'ship';

/**
 * @deprecated Use RTKorttiDetails instead. This interface will be removed in future versions.
 * All functionality has been moved to RTKorttiDetails which provides a more complete and standardized structure.
 */
export interface RTComponent {
  name: {
    fi: string;
    en: string;
  };
  category: string;
  thickness: number;
  costs: CostValues;
  talo2000Codes: string[];
}

export interface MaterialCost {
  name: string;
  elementType?: string;
  category: string;
  volume: number;
  area?: number;
  unit: string;
  matched: boolean;
  costs: CostValues;
  transport?: {
    mode: TransportMode;
    distance: number;
  };
  rtComponents?: {
    name: {
      fi: string;
      en: string;
    };
    thickness: number;
  }[];
  ifcElement?: string;
}

export interface ValidationThresholds {
  maxVolume: number;
  minVolume: number;
  maxDiscrepancy: number;
}

export interface MaterialThresholds {
  maxVolume: number;
  minVolume: number;
  typicalVolume: number;
  density?: number;
}

export interface ElementTypeThresholds {
  maxVolume: number;
  minVolume: number;
  typicalVolume: number;
}

export interface CalculatedCostResult {
  name: string;
  volume: number;
  taloCode: string;
  costs: CostValues;
  ifcElement: string;
  category: string;
  elementType: string;
  area: number;
  material: string;
  transport: {
    mode: TransportMode;
    distance: number;
  };
}

// Nuevas interfaces para estandarización
export interface BaseProjectInfo {
  name: string;
  area: number;
  /** Huoneistoala (hm²) - apartment/usable area for €/hm² comparison. Falls back to area if not set. */
  huoneistoala?: number;
  cost: number;
  type: string;
  location: string;
  description: string;
  buildingType: string;
  constructionMethod: string;
}

export interface BaseQuantity {
  value: number;
  unit: string;
}

/**
 * Interfaz unificada para detalles de RT-kortti
 * Esta interfaz combina todos los campos necesarios para describir un componente RT-kortti
 */
export interface RTKorttiDetails {
  // Campos básicos
  code: string;
  materials: string[];
  workPhases: string[];
  requirements: string;
  measurementUnit?: string;
  defaultCosts?: ModernCostValues;
  
  // Información de identificación
  name?: {
    fi: string;
    en: string;
  };
  source?: {
    name: string;
    version: string;
    date: string;
    license: string;
    references: string[];
  };
  
  // Clasificación Talo2000
  talo2000?: {
    code: string;
    category: string;
  };
  
  // Propiedades y medidas
  properties?: {
    mainUnit: string;
    alternativeUnits: string[];
    typicalQuantities: {
      small: number;
      medium: number;
      large: number;
    };
  };
  
  // Detalles técnicos
  technicalDetails?: {
    fireRating?: string;
    acousticRating?: string;
    thermalTransmittance?: number;
    loadBearing?: boolean;
    thickness?: number;
    weight?: number;
  };
  
  // Composición y materiales
  composition?: {
    materials: Array<{
      code: string;
      name: {
        fi: string;
        en: string;
      };
      quantity: number;
      unit: string;
    }>;
    labor: {
      hours: number;
      specialization: string[];
    };
  };
  
  // Mantenimiento
  maintenance?: {
    inspectionInterval: number;
    maintenanceInterval: number;
    estimatedLifespan: number;
    tasks: Array<{
      type: string;
      description: {
        fi: string;
        en: string;
      };
      interval: number;
      estimatedCost: number;
    }>;
  };
  
  // Campos de compatibilidad IFC
  applicableIfcTypes?: string[];
  applicableNames?: string[];
  
  // Campos heredados (para compatibilidad con RTComponent)
  category?: string;
  thickness?: number;
  talo2000Codes?: string[];
}

export interface BaseCostElement {
  id: number;
  /** IFC GUID: valor de IfcGloballyUniqueId (element.GlobalId en web-ifc). buildingSMART IFC-GUID + schema IfcGloballyUniqueId; trazabilidad con el modelo. */
  globalId?: string;
  name: string;
  type: string;
  quantity: number;
  taloCode: string;
  taloName: string;
  baseQuantities: {
    [key: string]: {
      value: number;
      unit: string;
    };
  };
  /**
   * Costes del elemento en el modelo finlandés unificado (material, labor, subcontract).
   */
  costs: FinnishCostValues;
  subElements?: BaseCostElement[];  // Optional array of sub-elements for hierarchical cost structures
  timeEstimates?: {
    installation: number; // Hours
    preparation: number; // Hours
    curing?: number; // Hours, if applicable
  };
  // Finnish Littera cost classification fields (optional)
  // Support for multiple Littera codes per element (one-to-many relationship)
  litteraCodes?: Array<{
    litteraCode: string;  // Finnish BOQ Littera code (e.g. "350010")
    litteraName: string;  // Littera description in Finnish (e.g. "US1 netto xx m2 / brutto xx m2")
  litteraCategory?: string;  // Parent category (e.g. "ULKOSEINÄT")
    unit: string;  // Unit of measurement (e.g. "M2", "M3", "KPL")
    relevanceScore?: number;  // Relevance score from filtering (0-100)
    quantity?: number;  // Quantity for this specific Littera code
    // Desglose opcional de costes por código Littera en el modelo finlandés.
    costs?: {
      material?: number;
      labor?: number;
      subcontract?: number;
      total?: number;
    };
  }>;
  // Legacy fields for backward compatibility (will use first litteraCode if available)
  litteraCode?: string;
  litteraName?: string;
  litteraCategory?: string;
  // RT-kortti details (optional)
  rtDetails?: RTKorttiDetails;
  /**
   * IFC Property Set values and CostaBIM policies (LayerRole, PublishedQuantity, …).
   * Keys: "PsetName.PropertyName" or "CostaBIM.*".
   */
  extraProperties?: Record<string, string | number>;
}

export interface TaloClassification {
  code: string;
  name: {
    fi: string;
    en: string;
  };
  category: string;
  parentCode?: string;
}

export interface CostFactors {
  location: {
    helsinki: 1.15;
    espoo: 1.12;
    vantaa: 1.10;
    tampere: 1.05;
    turku: 1.03;
    oulu: 1.00;
    other: number;
    selected?: string;
  };
  buildingType: {
    residential: 1.00;
    office: 1.10;
    commercial: 1.15;
    industrial: 0.90;
    public: 1.05;
    selected?: string;
  };
  constructionMethod: {
    traditional: 1.00;
    prefabricated: 0.95;
    modular: 0.90;
    renovation: 1.20;
    selected?: string;
  };
  projectSize: {
    small: 1.15;    // < 1000m²
    medium: 1.00;   // 1000-5000m²
    large: 0.90;    // > 5000m²
  };
}

export interface UnitCosts {
  materials: {
    concrete: number;     // €/m³
    steel: number;       // €/kg
    wood: number;        // €/m³
    insulation: number;  // €/m²
    windows: number;     // €/m²
    doors: number;       // €/unit
  };
  labor: {
    skilled: number;     // €/hour
    unskilled: number;   // €/hour
    specialist: number;  // €/hour
  };
  equipment: {
    heavyMachinery: number;  // €/day
    tools: number;           // €/day
    scaffolding: number;     // €/m²/week
  };
}

export interface CostDatabase {
  version: string;
  lastUpdated: Date;
  region: keyof CostFactors['location'];
  factors: CostFactors;
  unitCosts: UnitCosts;
  referenceProjects: {
    [key: string]: {
      type: keyof CostFactors['buildingType'];
      area: number;
      totalCost: number;
      costBreakdown: {
        [category: string]: number;
      };
    };
  };
}

// Interfaces para cálculos y análisis
export interface CostAnalysisResult {
  elementCosts: BaseCostElement[];
  totalCosts: ModernCostValues;
  costByCategory: {
    [category: string]: ModernCostValues;
  };
  costByTaloCode: {
    [taloCode: string]: ModernCostValues;
  };
  metrics: {
    costPerArea: number;
    costPerVolume?: number;
    percentageByCategory: {
      [category: string]: number;
    };
    timeMetrics: {
      totalDuration: number; // Days
      laborHoursPerM2: number;
      phaseDistribution: { [phase: string]: number }; // Percentage of time per phase
    };
  };
  schedule?: ConstructionSchedule;
}

// Utilidades para conversión entre tipos de costo
export function convertToModernCosts(costs: CostValues): ModernCostValues {
  const total = costs.total || (costs.material + costs.labor + costs.transport + costs.overhead);
  return {
    material: costs.material,
    labor: costs.labor,
    subcontract: costs.transport + costs.overhead,
    total: total
  };
}

export function convertToLegacyCosts(costs: ModernCostValues): CostValues {
  const total = costs.total || (costs.material + costs.labor + costs.subcontract);
  return {
    material: costs.material,
    labor: costs.labor,
    transport: costs.subcontract,
    overhead: 0,
    total: total
  };
}

export interface CostValue {
    value: number;
    unit: string;
    reference: string;
}

export interface CostDataSource {
    name: string;
    version: string;
    date: string;
    license: string;
    references: string[];
}

export interface CostProperties {
    mainUnit: string;
    alternativeUnits: string[];
    typicalQuantities: {
        small: number;
        medium: number;
        large: number;
    };
}

export interface Talo2000Reference {
    code: string;
    category: string;
}

export interface RTKorttiReference {
  code: string;
  version: string;
  references: string[];  // RT card numbers
}

export interface RTTechnicalDetails {
  fireRating?: string;
  acousticRating?: string;
  thermalTransmittance?: number;
  loadBearing?: boolean;
  thickness?: number;
  weight?: number;
}

export interface RTMaterial {
  code: string;
  name: {
    fi: string;
    en: string;
  };
  quantity: number;
  unit: string;
}

export interface RTLabor {
  hours: number;
  specialization: string[];
}

export interface RTMaintenanceTask {
  type: 'inspection' | 'maintenance' | 'replacement';
  description: {
    fi: string;
    en: string;
  };
  interval: number;
  estimatedCost: number;
}

export interface RTMaintenance {
  inspectionInterval: number;
  maintenanceInterval: number;
  estimatedLifespan: number;
  tasks: RTMaintenanceTask[];
}

// Extend existing CostData interface
export interface CostData {
  name: {
    fi: string;
    en: string;
  };
  source: CostDataSource;
  costs: {
    material: CostValue;
    labor: CostValue;
    equipment: CostValue;
    overhead: CostValue;
  };
  talo2000: Talo2000Reference;
  properties: CostProperties;
  rtKortti?: RTKorttiReference;
  technicalDetails?: RTTechnicalDetails;
  composition?: {
    materials: RTMaterial[];
    labor: RTLabor;
  };
  maintenance?: RTMaintenance;
  applicableIfcTypes?: string[];
  applicableNames?: string[];
}

export interface IFCQuantityValue {
  value: number;
  unit: string;
}

export interface ElementData {
  id: number;
  type: string;
  name: string;
  objectType?: string;
  taloClassification?: {
    code: string;
    name: string;
    identification: string;
  };
  quantities: {
    [key: string]: IFCQuantityValue;
  };
  properties: {
    [key: string]: any;
  };
}

export interface MaterialCostsTableData {
  id?: number;
  type?: string;
  name?: string;
  quantity?: string;
  taloCode?: string;
  taloName?: string;
  elementName?: string;
  primaryQuantity?: string;
  additionalQuantities?: string;
  baseQuantities?: string;
  isHeader?: boolean;
}

export function toUnifiedCostValues(costs: CostValues | MaterialCosts | ModernCostValues): UnifiedCostValues {
  return {
    material: costs.material,
    labor: costs.labor,
    equipment: 'equipment' in costs ? costs.equipment : undefined,
    transport: 'transport' in costs ? costs.transport : undefined,
    overhead: costs.overhead,
    total: costs.total
  };
}

export function fromUnifiedCostValues(costs: UnifiedCostValues, type: 'modern' | 'legacy' = 'modern'): ModernCostValues | CostValues {
  if (type === 'modern') {
    return {
      material: costs.material,
      labor: costs.labor,
      equipment: costs.equipment || 0,
      overhead: costs.overhead,
      total: costs.total
    };
  } else {
    return {
      material: costs.material,
      labor: costs.labor,
      transport: costs.transport || 0,
      overhead: costs.overhead,
      total: costs.total
    };
  }
}

/**
 * Utility function to convert RTComponent to RTKorttiDetails
 * @deprecated This function will be removed in future versions along with the RTComponent interface.
 */
export function convertRTComponentToDetails(component: RTComponent): Partial<RTKorttiDetails> {
  return {
    name: component.name,
    category: component.category,
    thickness: component.thickness,
    talo2000Codes: component.talo2000Codes,
    defaultCosts: {
      material: component.costs.material,
      labor: component.costs.labor,
      equipment: component.costs.transport,
      overhead: component.costs.overhead,
      total: component.costs.total
    }
  };
}

/**
 * Type guard to check if an object is an RTComponent
 * @deprecated This function will be removed in future versions along with the RTComponent interface.
 */
export function isRTComponent(obj: any): obj is RTComponent {
  return obj &&
    typeof obj === 'object' &&
    obj.name &&
    typeof obj.category === 'string' &&
    typeof obj.thickness === 'number' &&
    Array.isArray(obj.talo2000Codes);
}

/**
 * Type guard to check if an object is an RTKorttiDetails
 */
export function isRTKorttiDetails(obj: any): obj is RTKorttiDetails {
  return obj &&
    typeof obj === 'object' &&
    typeof obj.code === 'string' &&
    Array.isArray(obj.materials) &&
    Array.isArray(obj.workPhases) &&
    typeof obj.requirements === 'string';
}

/**
 * Safely merge RTComponent data into existing RTKorttiDetails
 * @deprecated This function will be removed in future versions along with the RTComponent interface.
 */
export function mergeRTComponentData(
  details: RTKorttiDetails,
  component: RTComponent
): RTKorttiDetails {
  return {
    ...details,
    name: component.name || details.name,
    category: component.category || details.category,
    thickness: component.thickness || details.thickness,
    talo2000Codes: component.talo2000Codes || details.talo2000Codes,
    defaultCosts: details.defaultCosts || {
      material: component.costs.material,
      labor: component.costs.labor,
      equipment: component.costs.transport,
      overhead: component.costs.overhead,
      total: component.costs.total
    }
  };
}

export interface TimeEstimates {
  preparation: number; // Days
  foundation: number;
  structure: number;
  envelope: number;
  interior: number;
  mep: number; // Mechanical, Electrical, Plumbing
  finishes: number;
  total: number;
}

export interface ConstructionPhase {
  name: string;
  startDate: Date;
  endDate: Date;
  duration: number; // Days
  dependencies: string[]; // Names of phases that must complete before this one can start
  progress: number; // 0-100
  resources: {
    labor: number; // Number of workers
    equipment: number; // Number of major equipment pieces
  };
  isCritical?: boolean; // Whether this phase is on the critical path
}

export interface ConstructionSchedule {
  startDate: Date;
  endDate: Date;
  totalDuration: number;
  phases: ConstructionPhase[];
  criticalPath: string[]; // Names of phases in the critical path
}

// Finnish Littera BOQ classification system
export interface LitteraEntry {
  littera: string;  // Code (e.g. "350010")
  description: string;  // Finnish description (e.g. "US1 netto xx m2 / brutto xx m2")
  unit: string;  // Measurement unit (M2, M3, KPL, ERÄ, etc.)
  isCategory: boolean;  // Whether this is a category header or actual item
  category: string | null;  // Parent category name
  keywords: string[];  // Keywords for matching (max 5)
}

export interface LitteraSuggestion {
  litteraCode: string;
  litteraName: string;
  unit: string;
  category: string | null;
  confidence: number; // 0..1
  reasons: string[];
  matchedKeywords?: string[];
} 
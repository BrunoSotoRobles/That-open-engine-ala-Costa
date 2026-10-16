import type { RTKorttiDetails, FinnishCostValues } from './cost';

export interface ModernCostValues extends FinnishCostValues {}

export interface IFCQuantityValue {
    value: number;
    unit: string;
}

export type QuantityResolutionStatus = 'ok' | 'corrected' | 'conflict' | 'unresolved';
export type QuantityResolutionSource = 'ifc_base' | 'tekla_quantity' | 'pset_basequantities' | 'dimensions';

export interface QuantityResolutionValue {
    value: number;
    unit: string;
    source: QuantityResolutionSource;
    confidence: number;
}

export interface QuantityResolutionOriginalValue {
    value: number;
    unit: string;
    source: QuantityResolutionSource;
    rawKey: string;
}

export interface QuantityResolutionMetadata {
    resolved: Record<string, QuantityResolutionValue>;
    original: Record<string, QuantityResolutionOriginalValue[]>;
    warnings: string[];
    status: QuantityResolutionStatus;
}

export interface ElementData {
    id: number;
    name: string;
    description?: string;
    type: string;
    category: string;
    taloCode: string;
    quantity?: number;
    unit?: string;
    quantities: { [key: string]: IFCQuantityValue };
    properties: any;
    taloName?: string;
}

export interface BaseCostElement {
    id: number;
    /** IFC GUID: valor de IfcGloballyUniqueId (element.GlobalId en web-ifc). buildingSMART IFC-GUID / IfcGloballyUniqueId. */
    globalId?: string;
    name: string;
    type: string;
    category: string;
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
    // Finnish Littera cost classification fields (optional)
    // Support for multiple Littera codes per element (one-to-many relationship)
    litteraCodes?: Array<{
        litteraCode: string;  // Finnish BOQ Littera code (e.g. "350010")
        litteraName: string;  // Littera description in Finnish (e.g. "US1 netto xx m2 / brutto xx m2")
        litteraCategory?: string;  // Parent category (e.g. "ULKOSEINÄT")
        unit: string;  // Unit of measurement (e.g. "M2", "M3", "KPL")
        relevanceScore?: number;  // Relevance score from filtering (0-100)
        quantity?: number;  // Quantity for this specific Littera code
        /**
         * Optional origin of this Littera assignment:
         * - 'ifc'       → read directly from IFC Psets (e.g. Pset_Talo 2000 / COSTA LITTERA)
         * - 'suggestion'→ suggested by the system (filtering/mapping)
         * - 'library'   → applied from external cost/Littera library
         * - 'user'        → entered/added manually by the user
         * - 'ontelolaatta'→ paquete fijo de 6 códigos desde array confirmado
         * If omitted, treat as a regular suggestion in the UI.
         */
        source?: 'ifc' | 'suggestion' | 'library' | 'user' | 'ontelolaatta';
        // Optional cost breakdown per Littera code using the Finnish cost model.
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
     * Optional storey / level name of the element (IfcBuildingStorey.Name),
     * derived from the spatial structure (ContainedInStructure).
     */
    floor?: string;
    /**
     * IFC Property Set values for export (e.g. "Pset_WallCommon.Reference", "Identity Data.Comments").
     * Keys: "PsetName.PropertyName", values: string or number from NominalValue.
     */
    extraProperties?: Record<string, string | number>;
    /**
     * Shadow metadata for multi-source quantity resolution.
     * This does not replace baseQuantities in initial rollout.
     */
    quantityResolution?: QuantityResolutionMetadata;
}

export interface BaseProjectInfo {
    volume: number;
    date: string;
    currency: string;
} 
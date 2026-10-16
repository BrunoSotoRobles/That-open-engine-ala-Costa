import { ElementData, BaseCostElement, BaseProjectInfo } from './shared';

export interface MaterialCostsTableData {
    id: string;
    name: string;
    description?: string;
    type: string;
    category: string;
    taloCode: string;
    materialCost: number;
    laborCost: number;
    subcontractCost: number;
    totalCost: number;
    baseQuantities?: string;  // JSON string containing quantity information
    primaryQuantity?: string; // String in format "value unit"
    // Littera classification (multiple codes support)
    litteraCodes?: Array<{
        litteraCode: string;
        litteraName: string;
        litteraCategory?: string;
        unit: string;
        relevanceScore?: number;
        quantity?: number;
        source?: 'ifc' | 'suggestion' | 'library' | 'user' | 'ontelolaatta';
    }>;
    // Legacy Littera fields for backward compatibility
    litteraCode?: string;
    litteraName?: string;
    litteraCategory?: string;
}

export type { ElementData, BaseCostElement, BaseProjectInfo };
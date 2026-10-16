import { BaseCostElement } from './elements';
import { ModernCostValues } from './shared';

export interface CostValue {
    value: number;
    unit: string;
    reference?: string;
}

export interface UnifiedCostValues {
    material: CostValue;
    labor: CostValue;
    equipment: CostValue;
    transport: CostValue;
    overhead: CostValue;
    total: CostValue;
}

export interface CostByCategory {
    [category: string]: ModernCostValues;
}

export interface CostByTaloCode {
    [taloCode: string]: ModernCostValues;
}

export interface CostMetrics {
    costPerArea: number;
    costPerVolume?: number;
}

export interface CostAnalysisResult {
    elementCosts: ModernCostValues[];
    totalCosts: ModernCostValues;
    costByCategory: CostByCategory;
    costByTaloCode: CostByTaloCode;
    metrics: CostMetrics;
}

export function toUnifiedCostValues(costs: ModernCostValues): UnifiedCostValues {
    return {
        material: { value: costs.material, unit: '€' },
        labor: { value: costs.labor, unit: '€' },
        equipment: { value: costs.equipment, unit: '€' },
        transport: { value: 0, unit: '€' },
        overhead: { value: costs.overhead, unit: '€' },
        total: { value: costs.total, unit: '€' }
    };
}

export function fromUnifiedCostValues(costs: UnifiedCostValues): ModernCostValues {
    return {
        material: costs.material.value,
        labor: costs.labor.value,
        equipment: costs.equipment.value,
        overhead: costs.overhead.value,
        total: costs.total.value
    };
} 
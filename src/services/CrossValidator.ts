import { ADJUSTED_UNIFIED_RT_DATABASE as UNIFIED_RT_DATABASE } from '../data/unifiedRTDatabase';
import { RTKorttiDetails, MaterialCost, CalculatedCostResult } from '../types/cost';
import { BaseCostElement } from '../types/cost/shared';

export interface ValidationElement {
  id: number;
  name: string;
  type: string;
  category: string;
  taloCode: string;
  area: number;
}

export interface CrossValidationResult {
  isValid: boolean;
  matchedElements: {
    material: string;
    taloCode: string;
    rtKortti: RTKorttiDetails | null;
    validations: {
      hasValidTaloCode: boolean;
      hasMatchingRTKortti: boolean;
      hasValidQuantities: boolean;
    };
  }[];
  summary: {
    totalElements: number;
    matchedElements: number;
    unmatchedElements: number;
    validationScore: number;
  };
}

/**
 * Servicio de validación cruzada para la aplicación principal
 * Maneja la lógica compleja de validación entre elementos, RT-kortti y TALO
 */
export class CrossValidator {
  private static instance: CrossValidator;

  private constructor() {}

  public static getInstance(): CrossValidator {
    if (!CrossValidator.instance) {
      CrossValidator.instance = new CrossValidator();
    }
    return CrossValidator.instance;
  }

  /**
   * Valida los elementos contra la base de datos RT-kortti y códigos TALO
   */
  public validateElements(elements: ValidationElement[]): CrossValidationResult {
    const result: CrossValidationResult = {
      isValid: false,
      matchedElements: [],
      summary: {
        totalElements: elements.length,
        matchedElements: 0,
        unmatchedElements: 0,
        validationScore: 0
      }
    };

    // Validar cada elemento
    for (const element of elements) {
      const validationResult = this.validateElement(element);
      result.matchedElements.push(validationResult);

      if (validationResult.rtKortti) {
        result.summary.matchedElements++;
      } else {
        result.summary.unmatchedElements++;
      }
    }

    // Calcular puntuación de validación (0-100)
    result.summary.validationScore = (result.summary.matchedElements / result.summary.totalElements) * 100;
    result.isValid = result.summary.validationScore >= 70;

    return result;
  }

  /**
   * Transforma elementos validados en elementos de costo
   */
  public transformToCostElements(elements: ValidationElement[]): BaseCostElement[] {
    return elements.map((element) => {
      const rtKortti = this.findMatchingRTKortti(element.taloCode, element.type);
      
      // Usar costos del RT-kortti si está disponible
      const costs = rtKortti?.defaultCosts || {
        material: 0,
        labor: 0,
        equipment: 0,
        overhead: 0,
        total: 0
      };

      return {
        id: element.id,
        name: element.name,
        type: element.type,
        category: element.category,
        quantity: element.area,
        taloCode: element.taloCode,
        taloName: rtKortti?.name?.fi || '',
        baseQuantities: {
          'Area': {
            value: element.area,
            unit: 'm²'
          }
        },
        costs: {
          material: costs.material || 0,
          labor: costs.labor || 0,
          equipment: costs.equipment || 0,
          overhead: costs.overhead || 0,
          total: costs.total || 0
        }
      };
    });
  }

  private validateElement(element: ValidationElement): {
    material: string;
    taloCode: string;
    rtKortti: RTKorttiDetails | null;
    validations: {
      hasValidTaloCode: boolean;
      hasMatchingRTKortti: boolean;
      hasValidQuantities: boolean;
    };
  } {
    const rtKortti = this.findMatchingRTKortti(element.taloCode, element.type);

    return {
      material: element.name,
      taloCode: element.taloCode,
      rtKortti: rtKortti,
      validations: {
        hasValidTaloCode: Boolean(element.taloCode && element.taloCode.match(/^\d+/)),
        hasMatchingRTKortti: rtKortti !== null,
        hasValidQuantities: element.area > 0
      }
    };
  }

  private findMatchingRTKortti(taloCode: string, type: string): RTKorttiDetails | null {
    // Primero buscar por código TALO exacto
    const exactMatch = Object.values(UNIFIED_RT_DATABASE).find(
      rt => rt.code === taloCode
    );
    if (exactMatch) return exactMatch;

    // Si no hay coincidencia exacta, buscar por tipo de elemento IFC
    return Object.values(UNIFIED_RT_DATABASE).find(
      rt => rt.applicableIfcTypes?.includes(type)
    ) || null;
  }
} 
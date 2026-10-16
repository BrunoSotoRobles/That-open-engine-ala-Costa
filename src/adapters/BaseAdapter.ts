import { 
  AdapterConfig, 
  ExternalSystemData, 
  ValidationResult, 
  TransformationResult,
  ValidationError,
  ValidationWarning,
  ExternalMaterialData
} from './types';
import { BaseCostElement } from '../types/cost/shared';
import { getTalo2000Quantity } from '../constants/talo2000';

export abstract class BaseAdapter {
  protected config: AdapterConfig;

  constructor(config: AdapterConfig) {
    this.config = config;
  }

  /**
   * Transforma datos externos al formato BaseCostElement
   */
  public async transform(data: ExternalSystemData): Promise<TransformationResult> {
    const validation = this.validateData(data);
    if (!validation.isValid && validation.errors.length > 0) {
      return {
        elements: [],
        validation,
        metadata: {
          transformedAt: new Date(),
          source: data.metadata?.source || 'unknown',
          originalCount: data.elements.length,
          transformedCount: 0
        }
      };
    }

    const transformedElements = await Promise.all(
      data.elements.map(element => this.transformElement(element))
    );

    return {
      elements: transformedElements.filter((el): el is BaseCostElement => el !== null),
      validation,
      metadata: {
        transformedAt: new Date(),
        source: data.metadata?.source || 'unknown',
        originalCount: data.elements.length,
        transformedCount: transformedElements.length
      }
    };
  }

  /**
   * Valida los datos de entrada
   */
  protected validateData(data: ExternalSystemData): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validación básica
    if (!Array.isArray(data.elements)) {
      errors.push({
        code: 'INVALID_FORMAT',
        message: 'Data elements must be an array',
        field: 'elements'
      });
      return { isValid: false, errors, warnings };
    }

    // Validar cada elemento
    data.elements.forEach((element, index) => {
      if (!element.name) {
        errors.push({
          code: 'MISSING_NAME',
          message: `Element at index ${index} is missing name`,
          field: 'name',
          value: element
        });
      }

      if (!element.type) {
        errors.push({
          code: 'MISSING_TYPE',
          message: `Element at index ${index} is missing type`,
          field: 'type',
          value: element
        });
      }

      // Validar que al menos existe área o volumen
      if (!element.area && !element.volume) {
        warnings.push({
          code: 'MISSING_MEASUREMENTS',
          message: `Element at index ${index} is missing both area and volume`,
          field: 'measurements',
          value: element
        });
      }

      // Validar costos si existen
      if (element.costs) {
        if (typeof element.costs.total !== 'number' && !this.canCalculateTotal(element.costs)) {
          warnings.push({
            code: 'INVALID_COSTS',
            message: `Element at index ${index} has invalid cost structure`,
            field: 'costs',
            value: element.costs
          });
        }
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Transforma un elemento individual
   */
  protected async transformElement(element: ExternalMaterialData): Promise<BaseCostElement | null> {
    try {
      // Obtener o mapear el código Talo
      const taloCode = this.mapTaloCode(element);
      
      // Convertir mediciones
      const quantities = this.convertQuantities(element);
      
      // Calcular o validar costos
      const costs = await this.calculateCosts(element, quantities);

      return {
        id: element.id || Math.random().toString(36).substr(2, 9),
        name: element.name,
        type: element.type,
        category: element.type, // Puede ser personalizado en implementaciones específicas
        taloCode: taloCode,
        description: element.description || '',
        costs: costs,
        quantities: quantities,
        properties: this.extractProperties(element)
      };
    } catch (error) {
      console.error('Error transforming element:', error);
      return null;
    }
  }

  /**
   * Mapea códigos Talo desde el sistema externo
   */
  protected mapTaloCode(element: ExternalMaterialData): string {
    if (element.taloCode) {
      return element.taloCode;
    }

    // Intentar mapear basado en el tipo
    return this.config.taloCodeMappings[element.type] || '0000';
  }

  /**
   * Convierte las mediciones al formato interno
   */
  protected convertQuantities(element: ExternalMaterialData): { [key: string]: { value: number; unit: string } } {
    const quantities: { [key: string]: { value: number; unit: string } } = {};

    if (element.area) {
      const value = typeof element.area === 'string' ? parseFloat(element.area) : element.area;
      quantities['Area'] = {
        value: value,
        unit: this.convertUnit(element.unit || 'm²')
      };
    }

    if (element.volume) {
      const value = typeof element.volume === 'string' ? parseFloat(element.volume) : element.volume;
      quantities['Volume'] = {
        value: value,
        unit: this.convertUnit(element.unit || 'm³')
      };
    }

    return quantities;
  }

  /**
   * Calcula los costos basados en las mediciones y configuración
   */
  protected async calculateCosts(
    element: ExternalMaterialData,
    quantities: { [key: string]: { value: number; unit: string } }
  ): Promise<BaseCostElement['costs']> {
    // Si ya tiene costos definidos, validarlos y usarlos (modelo finlandés: material, labor, subcontract, total)
    if (element.costs?.total) {
      return {
        material: element.costs.material ?? element.costs.total * 0.4,
        labor: element.costs.labor ?? element.costs.total * 0.35,
        subcontract: element.costs.subcontract ?? element.costs.total * 0.25,
        total: element.costs.total
      };
    }

    // Calcular basado en los costos por defecto (config puede tener equipment/overhead → se suman como subcontract)
    const defaultCost = this.config.defaultCosts[element.type] || this.config.defaultCosts['default'];
    const quantity = this.getPrimaryQuantity(quantities);
    const subcontractFromConfig = ((defaultCost as { equipment?: number; overhead?: number }).equipment ?? 0)
      + ((defaultCost as { equipment?: number; overhead?: number }).overhead ?? 0);

    return {
      material: defaultCost.material * quantity,
      labor: defaultCost.labor * quantity,
      subcontract: subcontractFromConfig * quantity,
      total: (defaultCost.material + defaultCost.labor) * quantity + subcontractFromConfig * quantity
    };
  }

  /**
   * Extrae propiedades adicionales específicas del elemento
   */
  protected extractProperties(element: ExternalMaterialData): { [key: string]: any } {
    const properties: { [key: string]: any } = {};
    
    // Copiar todas las propiedades que no son parte de la estructura básica
    Object.entries(element).forEach(([key, value]) => {
      if (!['id', 'name', 'type', 'area', 'volume', 'unit', 'taloCode', 'costs'].includes(key)) {
        properties[key] = value;
      }
    });

    return properties;
  }

  /**
   * Convierte unidades al sistema interno
   */
  protected convertUnit(unit: string): string {
    const conversion = this.config.unitConversions[unit];
    return conversion ? conversion.to : unit;
  }

  /**
   * Obtiene la cantidad principal para cálculos
   */
  protected getPrimaryQuantity(quantities: { [key: string]: { value: number; unit: string } }): number {
    // Priorizar área
    if (quantities['Area']) {
      return quantities['Area'].value;
    }
    // Luego volumen
    if (quantities['Volume']) {
      return quantities['Volume'].value;
    }
    // Si no hay ninguno, retornar 1 como valor por defecto
    return 1;
  }

  /**
   * Verifica si se pueden calcular los costos totales
   */
  private canCalculateTotal(costs: ExternalMaterialData['costs']): boolean {
    if (!costs) return false;
    return typeof costs.material === 'number' &&
           typeof costs.labor === 'number' &&
           typeof costs.equipment === 'number' &&
           typeof costs.overhead === 'number';
  }
} 
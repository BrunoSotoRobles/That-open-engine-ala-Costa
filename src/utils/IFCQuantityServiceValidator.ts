/**
 * IFC Quantity Service Validator
 * 
 * Script de validación comparativa para verificar que el nuevo servicio unificado
 * produce los mismos resultados que los métodos actuales.
 * 
 * Este script NO modifica código existente, solo compara resultados.
 * 
 * Uso:
 * 1. Cargar un modelo IFC en la aplicación
 * 2. Ejecutar: validateAgainstExistingCode(model, elementIds)
 * 3. Revisar el reporte de comparación en consola
 */

import { IFCQuantityService, QuantityConversionResult } from '../services/IFCQuantityService';
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as WEBIFC from "web-ifc";

interface ValidationResult {
  quantityName: string;
  quantityType: 'length' | 'area' | 'volume';
  elementId: number;
  elementType: string;
  
  // Resultados del método nuevo (servicio)
  newMethod: {
    value: number | null;
    unit: string;
    conversionApplied: boolean;
    method: string;
    sourceUnit?: string;
    rawValue?: number;
  };
  
  // Resultados del método actual (CostCalculator style)
  currentMethod: {
    value: number | null;
    method: string;
    rawValue: number | null;
  };
  
  // Comparación
  comparison: {
    valuesMatch: boolean;
    difference: number;
    percentageDifference: number;
    status: 'identical' | 'similar' | 'different' | 'error';
  };
}

interface ValidationReport {
  totalQuantities: number;
  identical: number;
  similar: number;
  different: number;
  errors: number;
  results: ValidationResult[];
  summary: {
    newMethodStats: {
      IfcPropertiesUtils: number;
      manual: number;
      raw: number;
    };
    currentMethodStats: {
      IfcPropertiesUtils: number;
      fallback: number;
      error: number;
    };
  };
}

export class IFCQuantityServiceValidator {
  private service: IFCQuantityService;
  private components: OBC.Components | null = null;

  constructor(components?: OBC.Components) {
    this.service = IFCQuantityService.getInstance();
    if (components) {
      this.components = components;
    }
    
    // Configurar servicio con logging para validación
    this.service.configure({
      enableLogging: true,
      enableCache: true
    });
  }

  /**
   * Replica la lógica de conversión actual de CostCalculator
   * (método privado convertQuantityValue)
   */
  private async currentMethodConvertQuantity(
    model: FRAGS.FragmentsGroup,
    quantity: any,
    quantityRef: any,
    quantityType: 'length' | 'area' | 'volume',
    modelLengthUnit: 'mm' | 'm' | 'unknown'
  ): Promise<{ value: number | null; method: string; rawValue: number | null }> {
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
      return { value: null, method: 'error', rawValue: null };
    }

    // PASO 1: Intentar usar IfcPropertiesUtils
    let convertedValue: number | null = null;
    try {
      const result = await OBC.IfcPropertiesUtils.getQuantityValue(model, quantityRef.value);
      convertedValue = result?.value ?? null;

      if (convertedValue !== null && convertedValue !== undefined) {
        const conversionApplied = Math.abs(rawValue - convertedValue) > 0.001;
        if (conversionApplied) {
          return { value: convertedValue, method: 'IfcPropertiesUtils', rawValue };
        }
        return { value: convertedValue, method: 'IfcPropertiesUtils (no conversion)', rawValue };
      }
    } catch (error) {
      // Continuar con siguiente paso
    }

    // PASO 2: Usar detección de unidades del modelo
    if (modelLengthUnit === 'mm') {
      let converted: number;
      switch (quantityType) {
        case 'length':
          converted = rawValue / 1000;
          break;
        case 'area':
          converted = rawValue / 1000000;
          break;
        case 'volume':
          converted = rawValue / 1000000000;
          break;
      }
      return { value: converted, method: 'manual (mm)', rawValue };
    } else if (modelLengthUnit === 'm') {
      return { value: rawValue, method: 'raw (m detected)', rawValue };
    }

    // PASO 3: Fallback conservador
    return { value: rawValue, method: 'raw (unknown)', rawValue };
  }

  /**
   * Detecta unidades del modelo (replica lógica de CostCalculator)
   */
  private async detectModelUnitsCurrentMethod(model: FRAGS.FragmentsGroup): Promise<'mm' | 'm' | 'unknown'> {
    try {
      const PROJECT_TYPE = 19;
      const projectIds = [21, 20, 19, 22, 23, 24];
      let project: any = null;

      for (const projectId of projectIds) {
        try {
          const candidate = await model.getProperties(Number(projectId));
          if (candidate && (candidate.type === PROJECT_TYPE || candidate.type?.toString().includes('PROJECT'))) {
            project = candidate;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!project) {
        try {
          const allIds = await model.getAllPropertiesIDs();
          for (const id of allIds.slice(0, 50)) {
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

      if (project?.UnitsInContext?.value) {
        try {
          const unitAssignment = await model.getProperties(project.UnitsInContext.value);
          if (unitAssignment.Units) {
            for (const unitRef of unitAssignment.Units) {
              try {
                const unit = await model.getProperties(unitRef.value);
                if (unit) {
                  const unitName = unit.UnitType?.value || 'Unknown';
                  if (unit.Units) {
                    for (const siUnitRef of unit.Units) {
                      const siUnit = await model.getProperties(siUnitRef.value);
                      if (siUnit) {
                        const prefix = siUnit.Prefix?.value || '';
                        const name = siUnit.Name?.value || '';
                        const unitNameUpper = unitName.toUpperCase();
                        
                        if (unitNameUpper.includes('LENGTH') || unitNameUpper.includes('LONG')) {
                          const prefixUpper = (prefix || '').toUpperCase();
                          if (prefixUpper === 'MILLI') {
                            return 'mm';
                          } else if (name === 'METRE' || name === 'METER' || name === 'METR') {
                            if (prefixUpper !== 'MILLI' && prefixUpper !== 'CENTI') {
                              return 'm';
                            }
                          }
                          const fullName = `${prefix}${name}`.toUpperCase();
                          if (fullName.includes('MILLI') || fullName === 'MM' || fullName.includes('MMETRE')) {
                            return 'mm';
                          }
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                continue;
              }
            }
          }
        } catch (e) {
          // Error
        }
      }
    } catch (error) {
      // Error
    }

    return 'unknown';
  }

  /**
   * Valida una cantidad comparando métodos nuevo vs actual
   */
  private async validateQuantity(
    model: FRAGS.FragmentsGroup,
    quantity: any,
    quantityRef: any,
    quantityType: 'length' | 'area' | 'volume',
    quantityName: string,
    elementId: number,
    elementType: string,
    modelLengthUnit: 'mm' | 'm' | 'unknown'
  ): Promise<ValidationResult> {
    // Método nuevo (servicio)
    let newResult: QuantityConversionResult | null = null;
    let newMethodError: any = null;
    try {
      newResult = await this.service.convertQuantity(model, quantity, quantityRef, quantityType);
    } catch (error) {
      newMethodError = error;
    }

    // Método actual (replicado)
    let currentResult: { value: number | null; method: string; rawValue: number | null } | null = null;
    let currentMethodError: any = null;
    try {
      currentResult = await this.currentMethodConvertQuantity(
        model,
        quantity,
        quantityRef,
        quantityType,
        modelLengthUnit
      );
    } catch (error) {
      currentMethodError = error;
    }

    // Comparación
    let comparison = {
      valuesMatch: false,
      difference: 0,
      percentageDifference: 0,
      status: 'error' as const
    };

    if (newMethodError || currentMethodError) {
      comparison.status = 'error';
    } else if (newResult && currentResult && newResult.value !== null && currentResult.value !== null) {
      const diff = Math.abs(newResult.value - currentResult.value);
      const avgValue = (newResult.value + currentResult.value) / 2;
      const percentageDiff = avgValue > 0 ? (diff / avgValue) * 100 : 0;

      comparison = {
        valuesMatch: diff < 0.001, // Tolerancia de 0.001
        difference: diff,
        percentageDifference: percentageDiff,
        status: diff < 0.001 ? 'identical' : percentageDiff < 1 ? 'similar' : 'different'
      };
    } else if (newResult?.value === null && currentResult?.value === null) {
      comparison = {
        valuesMatch: true,
        difference: 0,
        percentageDifference: 0,
        status: 'identical'
      };
    }

    return {
      quantityName,
      quantityType,
      elementId,
      elementType,
      newMethod: newResult ? {
        value: newResult.value,
        unit: newResult.unit,
        conversionApplied: newResult.conversionApplied,
        method: newResult.method,
        sourceUnit: newResult.sourceUnit,
        rawValue: newResult.rawValue
      } : {
        value: null,
        unit: '',
        conversionApplied: false,
        method: 'error',
        rawValue: null
      },
      currentMethod: currentResult || {
        value: null,
        method: 'error',
        rawValue: null
      },
      comparison
    };
  }

  /**
   * Valida el servicio contra código existente para elementos específicos
   */
  public async validateAgainstExistingCode(
    model: FRAGS.FragmentsGroup,
    elementIds: number[],
    options?: {
      includeAllQuantities?: boolean;
      verbose?: boolean;
    }
  ): Promise<ValidationReport> {
    console.log('🔍 [Validator] Iniciando validación comparativa...');
    console.log(`   Modelo: ${model.name || 'Unknown'}`);
    console.log(`   Elementos a validar: ${elementIds.length}`);

    // Detectar unidades usando ambos métodos
    console.log('\n📊 [Validator] Detectando unidades del modelo...');
    const [newUnits, currentUnits] = await Promise.all([
      this.service.detectModelUnits(model),
      this.detectModelUnitsCurrentMethod(model)
    ]);

    console.log(`   Método nuevo: ${newUnits}`);
    console.log(`   Método actual: ${currentUnits}`);

    if (newUnits !== currentUnits) {
      console.warn(`   ⚠️ DIFERENCIA EN DETECCIÓN DE UNIDADES!`);
    }

    // Obtener indexer
    if (!this.components) {
      throw new Error('Components no proporcionados. Pasar components al constructor.');
    }
    const indexer = this.components.get(OBC.IfcRelationsIndexer);
    if (!indexer) {
      throw new Error('IfcRelationsIndexer no disponible');
    }

    const results: ValidationResult[] = [];
    const summary = {
      newMethodStats: {
        IfcPropertiesUtils: 0,
        manual: 0,
        raw: 0
      },
      currentMethodStats: {
        IfcPropertiesUtils: 0,
        fallback: 0,
        error: 0
      }
    };

    // Procesar cada elemento
    console.log('\n🔄 [Validator] Procesando elementos...');
    for (let i = 0; i < elementIds.length; i++) {
      const elementId = elementIds[i];
      
      try {
        const element = await model.getProperties(elementId);
        if (!element) continue;

        const elementType = Object.keys(WEBIFC).find(key =>
          (WEBIFC as any)[key] === element.type
        )?.replace(/^IFC/, 'Ifc') || `Type ${element.type}`;

        const propertyRelations = indexer.getEntityRelations(model, elementId, "IsDefinedBy");
        if (!propertyRelations) continue;

        for (const relId of propertyRelations) {
          const relation = await model.getProperties(relId);
          if (!relation?.Quantities) continue;

          for (const quantityRef of relation.Quantities) {
            try {
              const quantity = await model.getProperties(quantityRef.value);
              if (!quantity || !quantity.Name) continue;

              let quantityType: 'length' | 'area' | 'volume' | null = null;
              if (quantity.LengthValue) {
                quantityType = 'length';
              } else if (quantity.AreaValue) {
                quantityType = 'area';
              } else if (quantity.VolumeValue) {
                quantityType = 'volume';
              }

              if (!quantityType) continue;

              const quantityName = quantity.Name.value;
              
              // Validar cantidad
              const validationResult = await this.validateQuantity(
                model,
                quantity,
                quantityRef,
                quantityType,
                quantityName,
                elementId,
                elementType,
                currentUnits // Usar unidades detectadas por método actual
              );

              results.push(validationResult);

              // Actualizar estadísticas
              if (validationResult.newMethod.method === 'IfcPropertiesUtils') {
                summary.newMethodStats.IfcPropertiesUtils++;
              } else if (validationResult.newMethod.method === 'manual') {
                summary.newMethodStats.manual++;
              } else {
                summary.newMethodStats.raw++;
              }

              if (validationResult.currentMethod.method.includes('IfcPropertiesUtils')) {
                summary.currentMethodStats.IfcPropertiesUtils++;
              } else if (validationResult.currentMethod.method === 'error') {
                summary.currentMethodStats.error++;
              } else {
                summary.currentMethodStats.fallback++;
              }

              // Log detallado si hay diferencias
              if (options?.verbose || validationResult.comparison.status !== 'identical') {
                if (validationResult.comparison.status === 'different') {
                  console.warn(`   ⚠️ Diferencia en ${elementType} - ${quantityName}:`, {
                    nuevo: validationResult.newMethod.value,
                    actual: validationResult.currentMethod.value,
                    diferencia: validationResult.comparison.percentageDifference.toFixed(2) + '%',
                    métodoNuevo: validationResult.newMethod.method,
                    métodoActual: validationResult.currentMethod.method
                  });
                }
              }
            } catch (error) {
              console.warn(`   Error validando cantidad en elemento ${elementId}:`, error);
            }
          }
        }
      } catch (error) {
        console.warn(`   Error procesando elemento ${elementId}:`, error);
      }

      if ((i + 1) % 10 === 0) {
        console.log(`   Procesados ${i + 1}/${elementIds.length} elementos...`);
      }
    }

    // Calcular estadísticas
    const stats = {
      identical: results.filter(r => r.comparison.status === 'identical').length,
      similar: results.filter(r => r.comparison.status === 'similar').length,
      different: results.filter(r => r.comparison.status === 'different').length,
      errors: results.filter(r => r.comparison.status === 'error').length
    };

    const report: ValidationReport = {
      totalQuantities: results.length,
      ...stats,
      results,
      summary
    };

    // Mostrar reporte
    this.printReport(report, newUnits, currentUnits);

    return report;
  }

  /**
   * Imprime un reporte de validación formateado
   */
  private printReport(
    report: ValidationReport,
    newUnits: 'mm' | 'm' | 'unknown',
    currentUnits: 'mm' | 'm' | 'unknown'
  ): void {
    console.log('\n' + '='.repeat(80));
    console.log('📋 REPORTE DE VALIDACIÓN');
    console.log('='.repeat(80));

    console.log('\n📊 Estadísticas Generales:');
    console.log(`   Total de cantidades validadas: ${report.totalQuantities}`);
    console.log(`   ✅ Idénticas: ${report.identical} (${((report.identical / report.totalQuantities) * 100).toFixed(1)}%)`);
    console.log(`   ⚪ Similares (<1% diferencia): ${report.similar} (${((report.similar / report.totalQuantities) * 100).toFixed(1)}%)`);
    console.log(`   ⚠️  Diferentes (>1% diferencia): ${report.different} (${((report.different / report.totalQuantities) * 100).toFixed(1)}%)`);
    console.log(`   ❌ Errores: ${report.errors} (${((report.errors / report.totalQuantities) * 100).toFixed(1)}%)`);

    console.log('\n🔧 Métodos de Conversión - Método Nuevo (Servicio):');
    console.log(`   IfcPropertiesUtils: ${report.summary.newMethodStats.IfcPropertiesUtils}`);
    console.log(`   Conversión manual: ${report.summary.newMethodStats.manual}`);
    console.log(`   Valor raw: ${report.summary.newMethodStats.raw}`);

    console.log('\n🔧 Métodos de Conversión - Método Actual:');
    console.log(`   IfcPropertiesUtils: ${report.summary.currentMethodStats.IfcPropertiesUtils}`);
    console.log(`   Fallback: ${report.summary.currentMethodStats.fallback}`);
    console.log(`   Errores: ${report.summary.currentMethodStats.error}`);

    console.log('\n📐 Detección de Unidades:');
    console.log(`   Método nuevo: ${newUnits}`);
    console.log(`   Método actual: ${currentUnits}`);
    if (newUnits !== currentUnits) {
      console.warn(`   ⚠️ DIFERENCIA DETECTADA!`);
    }

    // Mostrar diferencias significativas
    const significantDifferences = report.results.filter(
      r => r.comparison.status === 'different'
    );

    if (significantDifferences.length > 0) {
      console.log('\n⚠️  Diferencias Significativas (>1%):');
      significantDifferences.slice(0, 10).forEach(r => {
        console.log(`   ${r.elementType} - ${r.quantityName}:`);
        console.log(`      Nuevo: ${r.newMethod.value} ${r.newMethod.unit} (${r.newMethod.method})`);
        console.log(`      Actual: ${r.currentMethod.value} (${r.currentMethod.method})`);
        console.log(`      Diferencia: ${r.comparison.percentageDifference.toFixed(2)}%`);
      });

      if (significantDifferences.length > 10) {
        console.log(`   ... y ${significantDifferences.length - 10} más`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Validación completada');
    console.log('='.repeat(80) + '\n');
  }

  /**
   * Valida usando elementos de ejemplo (puertas, ventanas, muros, losas)
   */
  public async validateSampleElements(
    model: FRAGS.FragmentsGroup,
    maxElements: number = 20
  ): Promise<ValidationReport> {
    if (!this.components) {
      throw new Error('Components no proporcionados');
    }

    console.log('🔍 [Validator] Buscando elementos de ejemplo...');

    // Buscar elementos de diferentes tipos
    const targetTypes = ['DOOR', 'WINDOW', 'WALL', 'SLAB', 'COLUMN', 'BEAM'];
    const elementIds: number[] = [];
    // Deduplicar por expressId: un objeto multi-fragmento aparece en varios
    // fragment.ids y sin este Set el muestreo contaría el mismo objeto N veces.
    const seenIds = new Set<number>();

    for (const fragment of model.items) {
      for (const elementId of fragment.ids) {
        if (elementIds.length >= maxElements) break;
        if (seenIds.has(elementId)) continue;
        seenIds.add(elementId);

        try {
          const element = await model.getProperties(elementId);
          if (!element) continue;

          const elementType = Object.keys(WEBIFC).find(key =>
            (WEBIFC as any)[key] === element.type
          )?.toUpperCase() || '';

          if (targetTypes.some(type => elementType.includes(type))) {
            elementIds.push(elementId);
          }
        } catch (e) {
          continue;
        }
      }

      if (elementIds.length >= maxElements) break;
    }

    console.log(`   Encontrados ${elementIds.length} elementos de ejemplo`);

    return this.validateAgainstExistingCode(model, elementIds, {
      verbose: true,
      includeAllQuantities: true
    });
  }
}

/**
 * Función helper para validación rápida desde consola del navegador
 * 
 * Uso en consola:
 * ```javascript
 * // Después de cargar un modelo
 * const validator = new IFCQuantityServiceValidator(components);
 * const report = await validator.validateSampleElements(model, 10);
 * ```
 */
export async function quickValidation(
  model: FRAGS.FragmentsGroup,
  components: OBC.Components,
  elementIds?: number[]
): Promise<ValidationReport> {
  const validator = new IFCQuantityServiceValidator(components);
  
  if (elementIds) {
    return validator.validateAgainstExistingCode(model, elementIds, { verbose: true });
  } else {
    return validator.validateSampleElements(model, 20);
  }
}
/**
 * IFC Quantity Service - Servicio Unificado para Manejo de Base Quantities
 * 
 * Este servicio centraliza toda la lógica para:
 * - Detección de unidades del modelo IFC
 * - Detección de software de origen
 * - Conversión de cantidades (longitud, área, volumen)
 * 
 * Estrategia de conversión (3 niveles):
 * 1. Intentar usar IfcPropertiesUtils (herramienta oficial de ThatOpen)
 * 2. Si no funciona, usar detección de unidades del modelo (UNITASSIGNMENT)
 * 3. Si no sabemos, usar valor raw conservador
 * 
 * @version 1.0.0
 * @created 2024
 */

import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as WEBIFC from "web-ifc";

export type ModelLengthUnit = 'mm' | 'm' | 'unknown';
export type SourceSoftware = 'Revit' | 'ArchiCAD' | 'SketchUp' | 'Tekla' | 'Unknown';
export type QuantityType = 'length' | 'area' | 'volume';

export interface BaseQuantities {
  [key: string]: {
    value: number;
    unit: string;
  };
}

export interface QuantityConversionResult {
  value: number;
  unit: string;
  conversionApplied: boolean;
  method: 'IfcPropertiesUtils' | 'manual' | 'raw';
  sourceUnit?: ModelLengthUnit;
  rawValue?: number;
}

interface ModelMetadata {
  lengthUnit: ModelLengthUnit;
  sourceSoftware: SourceSoftware;
  detectedAt: number; // timestamp
}

export class IFCQuantityService {
  private static instance: IFCQuantityService;
  
  // Cache para metadata de modelos (evita múltiples lecturas)
  private modelMetadataCache: Map<string, ModelMetadata> = new Map();
  
  // Cache rápido por modelo actual (evita llamadas repetidas durante procesamiento)
  private currentModelCache: Map<string, ModelLengthUnit> = new Map();
  
  // Opciones de configuración
  private enableLogging: boolean = false; // Desactivado por defecto para producción
  private enableCache: boolean = true;

  private constructor() {
    // Singleton
  }

  public static getInstance(): IFCQuantityService {
    if (!IFCQuantityService.instance) {
      IFCQuantityService.instance = new IFCQuantityService();
    }
    return IFCQuantityService.instance;
  }

  /**
   * Configurar opciones del servicio
   */
  public configure(options: { enableLogging?: boolean; enableCache?: boolean }): void {
    if (options.enableLogging !== undefined) {
      this.enableLogging = options.enableLogging;
    }
    if (options.enableCache !== undefined) {
      this.enableCache = options.enableCache;
    }
  }

  /**
   * Limpia el cache de metadata de modelos
   */
  public clearCache(): void {
    this.modelMetadataCache.clear();
    this.currentModelCache.clear();
    if (this.enableLogging) {
      console.log('[IFCQuantityService] Cache cleared');
    }
  }
  
  /**
   * Limpia solo el cache rápido (útil después de procesar un modelo completo)
   */
  public clearCurrentModelCache(): void {
    this.currentModelCache.clear();
  }

  /**
   * Obtiene un identificador único para el modelo (para cache)
   */
  private getModelId(model: FRAGS.FragmentsGroup): string {
    // Usar el nombre del modelo o un identificador único
    return model.name || model.uuid || `model-${model.expressID}`;
  }

  /**
   * Detecta las unidades de longitud del modelo IFC
   * Lee el UNITASSIGNMENT del IfcProject
   * 
   * OPTIMIZACIÓN: Usa cache rápido para evitar múltiples llamadas durante procesamiento
   */
  public async detectModelUnits(model: FRAGS.FragmentsGroup): Promise<ModelLengthUnit> {
    const modelId = this.getModelId(model);
    
    // Verificar cache rápido primero (más rápido que el Map completo)
    if (this.currentModelCache.has(modelId)) {
      return this.currentModelCache.get(modelId)!;
    }
    
    // Verificar cache completo
    if (this.enableCache && this.modelMetadataCache.has(modelId)) {
      const cached = this.modelMetadataCache.get(modelId)!;
      // Actualizar cache rápido también
      this.currentModelCache.set(modelId, cached.lengthUnit);
      return cached.lengthUnit;
    }

    try {
      if (this.enableLogging) {
        console.log('[IFCQuantityService] Detectando unidades del modelo IFC...');
      }

      // Intentar encontrar IfcProject (generalmente expressID 21)
      // IFCPROJECT type code en web-ifc es 19
      const PROJECT_TYPE = 19;
      const projectIds = [21, 20, 19, 22, 23, 24, 1, 2, 3, 4, 5]; // IDs comunes más algunos adicionales
      let project: any = null;

      // Método 1: Buscar en IDs comunes
      for (const projectId of projectIds) {
        try {
          const candidate = await model.getProperties(Number(projectId));
          if (candidate) {
            // Verificar tipo exacto
            if (candidate.type === PROJECT_TYPE) {
              project = candidate;
              if (this.enableLogging) {
                console.log(`[IFCQuantityService] IfcProject encontrado por ID común: ${projectId}`);
              }
              break;
            }
            // También verificar por nombre del tipo (puede ser string)
            const typeStr = candidate.type?.toString() || '';
            if (typeStr.toUpperCase().includes('PROJECT') || typeStr === '19') {
              project = candidate;
              if (this.enableLogging) {
                console.log(`[IFCQuantityService] IfcProject encontrado por tipo: ${typeStr} (ID: ${projectId})`);
              }
              break;
            }
          }
        } catch (e) {
          // Continuar buscando
        }
      }

      // Método 2: Buscar en todos los IDs disponibles (más exhaustivo)
      if (!project) {
        try {
          const allIds = await model.getAllPropertiesIDs();
          if (this.enableLogging) {
            console.log(`[IFCQuantityService] Buscando IfcProject en ${allIds.length} elementos...`);
          }
          
          // OPTIMIZACIÓN: Reducir búsqueda de 200 a 100 elementos para mejor rendimiento
          // Generalmente el Project está en los primeros IDs
          for (const id of allIds.slice(0, 100)) {
            try {
              const candidate = await model.getProperties(Number(id));
              if (candidate) {
                // Verificar tipo exacto
                if (candidate.type === PROJECT_TYPE) {
                  project = candidate;
                  if (this.enableLogging) {
                    console.log(`[IFCQuantityService] IfcProject encontrado por búsqueda exhaustiva: ${id}`);
                  }
                  break;
                }
                // Verificar por nombre del tipo
                const typeStr = candidate.type?.toString() || '';
                if (typeStr.toUpperCase().includes('PROJECT') || typeStr === '19') {
                  project = candidate;
                  if (this.enableLogging) {
                    console.log(`[IFCQuantityService] IfcProject encontrado por tipo: ${typeStr} (ID: ${id})`);
                  }
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          if (this.enableLogging) {
            console.warn('[IFCQuantityService] Error al obtener todos los IDs:', e);
          }
        }
      }

      // Método 3: Buscar por propiedades características (fallback)
      // OPTIMIZACIÓN: Reducir búsqueda para mejor rendimiento
      if (!project && model.hasProperties) {
        try {
          const allIds = await model.getAllPropertiesIDs();
          for (const id of allIds.slice(0, 50)) {
            try {
              const candidate = await model.getProperties(Number(id));
              if (candidate && candidate.UnitsInContext) {
                // Si tiene UnitsInContext, probablemente es el Project
                project = candidate;
                if (this.enableLogging) {
                  console.log(`[IFCQuantityService] IfcProject encontrado por UnitsInContext: ${id}`);
                }
                break;
              }
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          // Ignorar errores en este método de fallback
        }
      }

      let detectedUnit: ModelLengthUnit = 'unknown';

      if (project) {
        if (this.enableLogging) {
          console.log('[IFCQuantityService] IfcProject encontrado:', {
            expressID: project.expressID,
            GlobalId: project.GlobalId?.value,
            hasUnitsInContext: !!project.UnitsInContext,
            UnitsInContextType: typeof project.UnitsInContext,
            UnitsInContextValue: project.UnitsInContext
          });
        }
        
        // Buscar UNITASSIGNMENT
        // UnitsInContext puede ser:
        // 1. Un objeto con .value (ej: { value: 123 })
        // 2. Un número directo (ej: 123)
        // 3. Un objeto con expressID (ej: { expressID: 123 })
        let unitAssignmentId: number | null = null;
        
        if (project.UnitsInContext) {
          if (typeof project.UnitsInContext === 'number') {
            unitAssignmentId = project.UnitsInContext;
          } else if (project.UnitsInContext?.value !== undefined) {
            unitAssignmentId = project.UnitsInContext.value;
          } else if (project.UnitsInContext?.expressID !== undefined) {
            unitAssignmentId = project.UnitsInContext.expressID;
          } else if (typeof project.UnitsInContext === 'object') {
            // Intentar cualquier propiedad numérica
            for (const key in project.UnitsInContext) {
              const val = (project.UnitsInContext as any)[key];
              if (typeof val === 'number') {
                unitAssignmentId = val;
                break;
              }
            }
          }
        }
        
        if (unitAssignmentId !== null) {
          try {
            if (this.enableLogging) {
              console.log(`[IFCQuantityService] Leyendo UNITASSIGNMENT (ID: ${unitAssignmentId})...`);
            }
            
            const unitAssignment = await model.getProperties(unitAssignmentId);
            
            if (!unitAssignment) {
              if (this.enableLogging) {
                console.warn('[IFCQuantityService] UNITASSIGNMENT no encontrado con ID:', unitAssignmentId);
              }
            } else {
              if (this.enableLogging) {
                console.log('[IFCQuantityService] UNITASSIGNMENT encontrado:', {
                  expressID: unitAssignment.expressID,
                  hasUnits: !!unitAssignment.Units,
                  unitsCount: unitAssignment.Units?.length || 0
                });
              }

              if (unitAssignment.Units && Array.isArray(unitAssignment.Units)) {
                if (this.enableLogging) {
                  console.log(`[IFCQuantityService] Procesando ${unitAssignment.Units.length} unidades...`);
                }
                
                for (const unitRef of unitAssignment.Units) {
                  try {
                    const unitId = unitRef?.value || unitRef;
                    if (!unitId) continue;
                    
                    const unit = await model.getProperties(Number(unitId));
                    if (!unit) continue;
                    
                    const unitType = unit.UnitType?.value || unit.UnitType || 'Unknown';
                    const unitTypeStr = unitType.toString().toUpperCase();
                    
                    if (this.enableLogging) {
                      console.log(`[IFCQuantityService]   Unidad encontrada: Tipo=${unitTypeStr}, ID=${unitId}`);
                    }

                    // Buscar SI_UNIT o CONVERTEDUNIT
                    // Las unidades pueden estar directamente en Units o en una estructura más compleja
                    let unitsToCheck = [];
                    
                    // Método 1: Units directo (IfcDerivedUnit o IfcMonetaryUnit)
                    if (unit.Units && Array.isArray(unit.Units)) {
                      unitsToCheck = unit.Units;
                    }
                    // Método 2: UnitsValue (IfcDerivedUnit)
                    else if (unit.UnitsElements && Array.isArray(unit.UnitsElements)) {
                      unitsToCheck = unit.UnitsElements;
                    }
                    // Método 3: Directamente es SI_UNIT
                    else if (unit.Name || unit.Prefix) {
                      unitsToCheck = [{ value: unit.expressID || unitId }];
                    }
                    
                    if (unitsToCheck.length > 0) {
                      for (const siUnitRef of unitsToCheck) {
                        try {
                          const siUnitId = siUnitRef?.value || siUnitRef?.expressID || siUnitRef;
                          if (!siUnitId) continue;
                          
                          const siUnit = await model.getProperties(Number(siUnitId));
                          if (!siUnit) continue;
                          
                          // Puede ser SI_UNIT o directamente tener las propiedades
                          const prefix = siUnit.Prefix?.value || siUnit.Prefix || '';
                          const name = siUnit.Name?.value || siUnit.Name || '';
                          const unitType = siUnit.UnitType?.value || siUnit.UnitType || '';
                          
                          if (this.enableLogging && unitTypeStr.includes('LENGTH')) {
                            console.log(`[IFCQuantityService]     SI_UNIT (ID: ${siUnitId}): Prefix="${prefix}", Name="${name}", UnitType="${unitType}"`);
                          }

                          // Detectar unidad de longitud
                          if (unitTypeStr.includes('LENGTH') || unitTypeStr.includes('LONG')) {
                            const prefixUpper = (prefix || '').toString().toUpperCase();
                            const nameUpper = (name || '').toString().toUpperCase();

                            // Verificar si es milímetros
                            if (prefixUpper === 'MILLI' || 
                                nameUpper.includes('MILLIMETRE') || 
                                nameUpper.includes('MILLIMETER') ||
                                nameUpper === 'MM') {
                              detectedUnit = 'mm';
                              if (this.enableLogging) {
                                console.log(`[IFCQuantityService] ✓✓ Unidad de longitud detectada: ${detectedUnit} (${prefix}${name})`);
                              }
                              break;
                            }
                            // Verificar si es metros
                            else if (nameUpper === 'METRE' || 
                                     nameUpper === 'METER' || 
                                     nameUpper === 'METR') {
                              if (!prefixUpper.includes('MILLI') && !prefixUpper.includes('CENTI')) {
                                detectedUnit = 'm';
                                if (this.enableLogging) {
                                  console.log(`[IFCQuantityService] ✓✓ Unidad de longitud detectada: ${detectedUnit} (${name})`);
                                }
                                break;
                              }
                            }
                          }
                        } catch (e) {
                          if (this.enableLogging) {
                            console.warn(`[IFCQuantityService] Error leyendo SI_UNIT (ID: ${siUnitRef}):`, e);
                          }
                          continue;
                        }
                      }
                    } else {
                      if (this.enableLogging && unitTypeStr.includes('LENGTH')) {
                        console.warn(`[IFCQuantityService] Unidad de longitud sin estructura Units reconocida:`, unit);
                      }
                    }
                    
                    // Si ya detectamos la unidad, salir del loop
                    if (detectedUnit !== 'unknown') {
                      break;
                    }
                  } catch (e) {
                    if (this.enableLogging) {
                      console.warn(`[IFCQuantityService] Error procesando unidad (ID: ${unitRef}):`, e);
                    }
                    continue;
                  }
                }
              } else {
                if (this.enableLogging) {
                  console.warn('[IFCQuantityService] UNITASSIGNMENT no tiene propiedad Units o no es un array');
                }
              }
            }
          } catch (e) {
            if (this.enableLogging) {
              console.warn('[IFCQuantityService] Error al leer UNITASSIGNMENT:', e);
              console.warn('[IFCQuantityService] Detalles del error:', e instanceof Error ? e.message : String(e));
            }
          }
        } else {
          if (this.enableLogging) {
            console.warn('[IFCQuantityService] IfcProject no tiene UnitsInContext accesible');
            console.warn('[IFCQuantityService] UnitsInContext structure:', JSON.stringify(project.UnitsInContext, null, 2));
          }
        }
      } else {
        if (this.enableLogging) {
          console.warn('[IFCQuantityService] ⚠️ No se encontró IfcProject para revisar unidades');
          console.warn('[IFCQuantityService] El modelo puede no tener unidades explícitas definidas.');
          console.warn('[IFCQuantityService] Se usarán valores raw. Si los valores parecen incorrectos, verifica:');
          console.warn('[IFCQuantityService]   1. Si el modelo está en mm, los valores pueden requerir conversión manual');
          console.warn('[IFCQuantityService]   2. Revisa las cantidades usando window.validateIFCQuantitiesSample()');
        }
      }

      // Guardar en cache (tanto el completo como el rápido)
      if (this.enableCache) {
        const existing = this.modelMetadataCache.get(modelId) || {
          lengthUnit: 'unknown' as ModelLengthUnit,
          sourceSoftware: 'Unknown' as SourceSoftware,
          detectedAt: Date.now()
        };
        this.modelMetadataCache.set(modelId, {
          ...existing,
          lengthUnit: detectedUnit,
          detectedAt: Date.now()
        });
      }
      
      // Actualizar cache rápido para acceso inmediato en siguientes llamadas
      this.currentModelCache.set(modelId, detectedUnit);

      if (this.enableLogging) {
        if (detectedUnit === 'unknown') {
          console.log('[IFCQuantityService] No se detectaron unidades del modelo. Usando valores raw.');
        } else {
          console.log(`[IFCQuantityService] ✓ Unidades del modelo establecidas: ${detectedUnit}`);
        }
      }

      return detectedUnit;
    } catch (error) {
      if (this.enableLogging) {
        console.warn('[IFCQuantityService] Error detectando unidades del modelo:', error);
      }
      return 'unknown';
    }
  }

  /**
   * Detecta el software de origen del modelo IFC
   * Lee OwnerHistory.OwningApplication.ApplicationFullName
   */
  public async detectSourceSoftware(model: FRAGS.FragmentsGroup): Promise<SourceSoftware> {
    const modelId = this.getModelId(model);

    // Verificar cache
    if (this.enableCache && this.modelMetadataCache.has(modelId)) {
      const cached = this.modelMetadataCache.get(modelId)!;
      if (cached.sourceSoftware !== 'Unknown') {
        return cached.sourceSoftware;
      }
    }

    try {
      if (this.enableLogging) {
        console.log('[IFCQuantityService] Detectando software de origen...');
      }

      let detectedSoftware: SourceSoftware = 'Unknown';

      // Método 1: Intentar desde IfcProject.OwnerHistory (más confiable)
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

        if (project?.OwnerHistory?.OwningApplication?.value) {
          const application = await model.getProperties(project.OwnerHistory.OwningApplication.value);
          const applicationName = application?.ApplicationFullName?.value || '';

          if (applicationName) {
            const appNameLower = applicationName.toLowerCase();
            if (appNameLower.includes('tekla')) {
              detectedSoftware = 'Tekla';
            } else if (appNameLower.includes('revit') || appNameLower.includes('autodesk')) {
              detectedSoftware = 'Revit';
            } else if (appNameLower.includes('archicad') || appNameLower.includes('graphisoft')) {
              detectedSoftware = 'ArchiCAD';
            } else if (appNameLower.includes('sketchup')) {
              detectedSoftware = 'SketchUp';
            }
          }
        }
      } catch (error) {
        // Método 1 falló, intentar método 2
      }

      // Método 2: Buscar en todas las propiedades (fallback)
      if (detectedSoftware === 'Unknown' && model.hasProperties) {
        try {
          const propertyIds = await model.getAllPropertiesIDs();
          for (const id of propertyIds.slice(0, 100)) { // Limitar búsqueda
            try {
              const props = await model.getProperties(Number(id));
              if (props?.ApplicationFullName?.value) {
                const appName = props.ApplicationFullName.value.toLowerCase();
                if (appName.includes('tekla')) {
                  detectedSoftware = 'Tekla';
                  break;
                } else if (appName.includes('revit') || appName.includes('autodesk')) {
                  detectedSoftware = 'Revit';
                  break;
                } else if (appName.includes('archicad') || appName.includes('graphisoft')) {
                  detectedSoftware = 'ArchiCAD';
                  break;
                } else if (appName.includes('sketchup')) {
                  detectedSoftware = 'SketchUp';
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }
        } catch (error) {
          // Método 2 también falló
        }
      }

      // Guardar en cache
      if (this.enableCache) {
        const existing = this.modelMetadataCache.get(modelId) || {
          lengthUnit: 'unknown' as ModelLengthUnit,
          sourceSoftware: 'Unknown' as SourceSoftware,
          detectedAt: Date.now()
        };
        this.modelMetadataCache.set(modelId, {
          ...existing,
          sourceSoftware: detectedSoftware,
          detectedAt: Date.now()
        });
      }

      if (typeof window !== "undefined") {
        (window as unknown as { __ifcSourceSoftware?: SourceSoftware }).__ifcSourceSoftware =
          detectedSoftware;
      }

      if (this.enableLogging) {
        console.log(`[IFCQuantityService] ✓ Software de origen detectado: ${detectedSoftware}`);
      }

      return detectedSoftware;
    } catch (error) {
      if (this.enableLogging) {
        console.warn('[IFCQuantityService] Error detectando software de origen:', error);
      }
      return 'Unknown';
    }
  }

  /**
   * Convierte una cantidad IFC a metros (o m²/m³ según el tipo)
   * SOLUCIÓN UNIFICADA - Funciona para TODOS los elementos sin excepciones
   * 
   * Estrategia:
   * 1. Intentar usar IfcPropertiesUtils (herramienta oficial de ThatOpen) - SIEMPRE confiable
   * 2. Si no funciona, usar la detección de unidades del modelo (modelLengthUnit)
   * 3. Si no sabemos, usar el valor raw (asumir que ya está correcto)
   */
  public async convertQuantity(
    model: FRAGS.FragmentsGroup,
    quantity: any,
    quantityRef: any,
    quantityType: QuantityType
  ): Promise<QuantityConversionResult | null> {
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
    let convertedValue: number | null = null;
    let conversionMethod: 'IfcPropertiesUtils' | 'manual' | 'raw' = 'raw';
    let conversionApplied = false;

    try {
      const result = await OBC.IfcPropertiesUtils.getQuantityValue(model, quantityRef.value);
      convertedValue = result?.value ?? null;

      if (convertedValue !== null && convertedValue !== undefined) {
        conversionApplied = Math.abs(rawValue - convertedValue) > 0.001;
        if (conversionApplied) {
          conversionMethod = 'IfcPropertiesUtils';
          // IfcPropertiesUtils aplicó conversión correctamente
          return {
            value: convertedValue,
            unit: quantityType === 'length' ? 'm' : quantityType === 'area' ? 'm²' : 'm³',
            conversionApplied: true,
            method: conversionMethod,
            sourceUnit: 'unknown', // IfcPropertiesUtils maneja esto internamente
            rawValue
          };
        }
        
        // Si no aplicó conversión, verificar si hay evidencia de que debería convertir
        // SOLUCIÓN CONDICIONAL: Solo para casos problemáticos conocidos de Revit
        // donde IfcPropertiesUtils no convierte pero el modelo está en mm
        // OPTIMIZACIÓN: Usar cache rápido para evitar múltiples llamadas
        const modelId = this.getModelId(model);
        let modelLengthUnit = this.currentModelCache.get(modelId);
        if (!modelLengthUnit) {
          modelLengthUnit = await this.detectModelUnits(model);
        }
        
        if (!conversionApplied && modelLengthUnit === 'mm' && quantityType === 'length') {
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
          if (suspiciousRawValue && absurdConvertedValue && ratioIsOne) {
            if (this.enableLogging) {
              console.log(`[IFCQuantityService] ⚠️ Aplicando conversión manual: ${rawValue}mm → ${rawValue / 1000}m (IfcPropertiesUtils no aplicó conversión)`);
            }
            
            conversionMethod = 'manual';
            conversionApplied = true;
            return {
              value: rawValue / 1000, // mm -> m
              unit: 'm',
              conversionApplied: true,
              method: conversionMethod,
              sourceUnit: 'mm',
              rawValue
            };
          }
        }
        
        // Si no hay evidencia de problema, confiar en IfcPropertiesUtils
        conversionMethod = 'IfcPropertiesUtils';
        return {
          value: convertedValue,
          unit: quantityType === 'length' ? 'm' : quantityType === 'area' ? 'm²' : 'm³',
          conversionApplied: false,
          method: conversionMethod,
          sourceUnit: 'unknown',
          rawValue
        };
      }
    } catch (error) {
      // Si IfcPropertiesUtils falla, continuamos con detección manual
    }

    // PASO 2: Si IfcPropertiesUtils no funcionó, usar detección de unidades del modelo
    // OPTIMIZACIÓN: Usar cache rápido para evitar múltiples llamadas
    const modelId = this.getModelId(model);
    let modelLengthUnit = this.currentModelCache.get(modelId);
    if (!modelLengthUnit) {
      modelLengthUnit = await this.detectModelUnits(model);
    }

    if (modelLengthUnit === 'mm') {
      // El modelo está definitivamente en mm - convertir según el tipo
      conversionMethod = 'manual';
      conversionApplied = true;
      let converted: number;
      switch (quantityType) {
        case 'length':
          converted = rawValue / 1000; // mm -> m
          break;
        case 'area':
          converted = rawValue / 1000000; // mm² -> m²
          break;
        case 'volume':
          converted = rawValue / 1000000000; // mm³ -> m³
          break;
      }

      return {
        value: converted,
        unit: quantityType === 'length' ? 'm' : quantityType === 'area' ? 'm²' : 'm³',
        conversionApplied: true,
        method: conversionMethod,
        sourceUnit: 'mm',
        rawValue
      };
    } else if (modelLengthUnit === 'm') {
      // El modelo está en metros - usar valor raw sin conversión
      conversionMethod = 'raw';
      conversionApplied = false;
      return {
        value: rawValue,
        unit: quantityType === 'length' ? 'm' : quantityType === 'area' ? 'm²' : 'm³',
        conversionApplied: false,
        method: conversionMethod,
        sourceUnit: 'm',
        rawValue
      };
    }

    // PASO 3: Si no sabemos las unidades del modelo (unknown)
    // Usar el valor raw y asumir que ya está en las unidades correctas
    conversionMethod = 'raw';
    conversionApplied = false;
    return {
      value: rawValue,
      unit: quantityType === 'length' ? 'm' : quantityType === 'area' ? 'm²' : 'm³',
      conversionApplied: false,
      method: conversionMethod,
      sourceUnit: 'unknown',
      rawValue
    };
  }

  /**
   * Procesa todas las cantidades de un elemento IFC
   * Retorna un objeto BaseQuantities con todas las cantidades convertidas
   */
  public async processElementQuantities(
    model: FRAGS.FragmentsGroup,
    elementId: number,
    indexer?: OBC.IfcRelationsIndexer
  ): Promise<BaseQuantities> {
    const quantities: BaseQuantities = {};

    if (!model.hasProperties) {
      return quantities;
    }

    // Obtener indexer si no se proporciona
    let relationsIndexer = indexer;
    if (!relationsIndexer) {
      relationsIndexer = this.getComponents()?.get(OBC.IfcRelationsIndexer);
      if (!relationsIndexer) {
        if (this.enableLogging) {
          console.warn('[IFCQuantityService] No IfcRelationsIndexer disponible');
        }
        return quantities;
      }
    }

    // Obtener relaciones de propiedades
    const propertyRelations = relationsIndexer.getEntityRelations(model, elementId, "IsDefinedBy");
    if (!propertyRelations) {
      return quantities;
    }

    // Procesar cada relación
    for (const relId of propertyRelations) {
      try {
        const relation = await model.getProperties(relId);
        if (!relation) continue;

        // Procesar Quantity Sets
        if (relation.Quantities) {
          for (const quantityRef of relation.Quantities) {
            try {
              const quantity = await model.getProperties(quantityRef.value);
              if (!quantity || !quantity.Name) continue;

              // Determinar el tipo de cantidad
              let quantityType: QuantityType | null = null;
              if (quantity.LengthValue) {
                quantityType = 'length';
              } else if (quantity.AreaValue) {
                quantityType = 'area';
              } else if (quantity.VolumeValue) {
                quantityType = 'volume';
              }

              if (!quantityType) {
                continue;
              }

              // Convertir cantidad
              const conversionResult = await this.convertQuantity(
                model,
                quantity,
                quantityRef,
                quantityType
              );

              if (conversionResult) {
                const name = quantity.Name.value;
                quantities[name] = {
                  value: conversionResult.value,
                  unit: conversionResult.unit
                };

                // Log detallado para validación (solo para cantidades importantes)
                if (this.enableLogging) {
                  const nameLower = name.toLowerCase();
                  const shouldLog = nameLower === 'length' ||
                                   nameLower === 'width' ||
                                   nameLower === 'height' ||
                                   nameLower.includes('volume') ||
                                   nameLower.includes('area');

                  if (shouldLog) {
                    console.log(`[IFCQuantityService] ${name} (${quantityType}):`, {
                      rawValue: conversionResult.rawValue,
                      convertedValue: conversionResult.value,
                      conversionApplied: conversionResult.conversionApplied,
                      method: conversionResult.method,
                      sourceUnit: conversionResult.sourceUnit,
                      unit: conversionResult.unit
                    });
                  }
                }
              }
            } catch (error) {
              if (this.enableLogging) {
                console.warn(`[IFCQuantityService] Error processing quantity:`, error);
              }
              continue;
            }
          }
        }
      } catch (error) {
        if (this.enableLogging) {
          console.warn(`[IFCQuantityService] Error processing relation:`, error);
        }
        continue;
      }
    }

    return quantities;
  }

  /**
   * Obtiene metadata completa del modelo (unidades + software)
   */
  public async getModelMetadata(model: FRAGS.FragmentsGroup): Promise<{
    lengthUnit: ModelLengthUnit;
    sourceSoftware: SourceSoftware;
  }> {
    const [lengthUnit, sourceSoftware] = await Promise.all([
      this.detectModelUnits(model),
      this.detectSourceSoftware(model)
    ]);

    return {
      lengthUnit,
      sourceSoftware
    };
  }

  /**
   * Helper para obtener Components (necesario para algunas operaciones)
   * Esto debe ser configurado desde las herramientas que usan el servicio
   */
  private getComponents(): OBC.Components | null {
    // En el contexto de las herramientas BIM, los Components están disponibles
    // Este método puede ser sobrescrito o mejorado según necesidad
    return null;
  }

  /**
   * Configura el contexto de Components (opcional, para funcionalidades avanzadas)
   */
  public setComponents(components: OBC.Components): void {
    // Almacenar components si es necesario para funcionalidades futuras
    // Por ahora no es necesario ya que pasamos el indexer como parámetro
  }
}
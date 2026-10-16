/**
 * Expone IFCQuantityService y validador a la consola del navegador
 * 
 * Permite usar el servicio y validador directamente desde la consola del navegador
 * sin necesidad de imports.
 * 
 * Uso en consola del navegador:
 * > window.validateIFCQuantities(model, components)
 * > window.getIFCQuantityService()
 * > window.validateIFCQuantitiesSample(model, components)
 */

import { IFCQuantityService } from '../services/IFCQuantityService';
import { IFCQuantityServiceValidator, quickValidation } from './IFCQuantityServiceValidator';
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";

export function exposeIFCQuantityServiceToConsole() {
  if (typeof window === 'undefined') {
    return;
  }

  // Exponer el servicio
  (window as any).getIFCQuantityService = () => {
    console.log('📦 Obteniendo instancia de IFCQuantityService...');
    const service = IFCQuantityService.getInstance();
    console.log('✅ Servicio obtenido. Métodos disponibles:');
    console.log('  - service.detectModelUnits(model)');
    console.log('  - service.detectSourceSoftware(model)');
    console.log('  - service.getModelMetadata(model)');
    console.log('  - service.convertQuantity(model, quantity, quantityRef, quantityType)');
    console.log('  - service.processElementQuantities(model, elementId, indexer)');
    console.log('  - service.configure({ enableLogging, enableCache })');
    console.log('  - service.clearCache()');
    return service;
  };

  // Helper para obtener modelo automáticamente
  const getModel = (model?: FRAGS.FragmentsGroup): FRAGS.FragmentsGroup | null => {
    if (model) return model;
    
    // Intentar obtener desde window.getIFCModel si está disponible
    if ((window as any).getIFCModel) {
      return (window as any).getIFCModel();
    }
    
    return null;
  };

  // Helper para obtener components automáticamente
  const getComponents = (components?: OBC.Components): OBC.Components | null => {
    if (components) return components;
    
    // Intentar obtener desde window.getIFCComponents si está disponible
    if ((window as any).getIFCComponents) {
      return (window as any).getIFCComponents();
    }
    
    return null;
  };

  // Validación rápida con elementos de ejemplo
  (window as any).validateIFCQuantitiesSample = async (
    model?: FRAGS.FragmentsGroup,
    components?: OBC.Components,
    maxElements: number = 20
  ) => {
    console.log('🔍 Iniciando validación con elementos de ejemplo...');
    console.log('   (Busca automáticamente puertas, ventanas, muros, losas, etc.)');
    
    const actualModel = getModel(model);
    const actualComponents = getComponents(components);
    
    if (!actualModel) {
      console.error('❌ Error: No se pudo obtener el modelo IFC.');
      console.log('💡 Asegúrate de:');
      console.log('   1. Tener un modelo IFC cargado en el viewer');
      console.log('   2. O pasar el modelo explícitamente: window.validateIFCQuantitiesSample(model, components)');
      return null;
    }

    if (!actualComponents) {
      console.error('❌ Error: No se pudieron obtener los components.');
      console.log('💡 Pasa los components explícitamente: window.validateIFCQuantitiesSample(model, components)');
      return null;
    }

    try {
      const validator = new IFCQuantityServiceValidator(actualComponents);
      const report = await validator.validateSampleElements(actualModel, maxElements);
      console.log('✅ Validación completada. Revisa el reporte arriba.');
      return report;
    } catch (error) {
      console.error('❌ Error durante la validación:', error);
      throw error;
    }
  };

  // Validación con elementos específicos
  (window as any).validateIFCQuantities = async (
    model?: FRAGS.FragmentsGroup,
    components?: OBC.Components,
    elementIds?: number[],
    options?: { verbose?: boolean }
  ) => {
    console.log('🔍 Iniciando validación comparativa...');
    
    const actualModel = getModel(model);
    const actualComponents = getComponents(components);
    
    if (!actualModel) {
      console.error('❌ Error: No se pudo obtener el modelo IFC.');
      console.log('💡 Uso: window.validateIFCQuantities() - o pasar modelo: window.validateIFCQuantities(model, components, [elementIds])');
      return null;
    }

    if (!actualComponents) {
      console.error('❌ Error: No se pudieron obtener los components.');
      console.log('💡 Pasa los components: window.validateIFCQuantities(model, components)');
      return null;
    }

    try {
      if (elementIds) {
        const validator = new IFCQuantityServiceValidator(actualComponents);
        const report = await validator.validateAgainstExistingCode(actualModel, elementIds, options);
        console.log('✅ Validación completada. Revisa el reporte arriba.');
        return report;
      } else {
        // Si no se proporcionan IDs, usar validación de muestra
        return await (window as any).validateIFCQuantitiesSample(actualModel, actualComponents);
      }
    } catch (error) {
      console.error('❌ Error durante la validación:', error);
      throw error;
    }
  };

  // Helper para obtener metadata del modelo
  (window as any).getIFCModelMetadata = async (model?: FRAGS.FragmentsGroup) => {
    console.log('📊 Obteniendo metadata del modelo...');
    
    const actualModel = getModel(model);
    
    if (!actualModel) {
      console.error('❌ Error: No se pudo obtener el modelo IFC.');
      console.log('💡 Asegúrate de tener un modelo cargado o pásalo: window.getIFCModelMetadata(model)');
      return null;
    }

    try {
      const service = IFCQuantityService.getInstance();
      const metadata = await service.getModelMetadata(actualModel);
      
      console.log('✅ Metadata obtenida:');
      console.log('   Unidades:', metadata.lengthUnit);
      console.log('   Software:', metadata.sourceSoftware);
      
      return metadata;
    } catch (error) {
      console.error('❌ Error obteniendo metadata:', error);
      throw error;
    }
  };

  // Helper para detectar unidades
  (window as any).detectIFCUnits = async (model?: FRAGS.FragmentsGroup) => {
    const actualModel = getModel(model);
    
    if (!actualModel) {
      console.error('❌ Error: No se pudo obtener el modelo IFC.');
      return null;
    }

    const service = IFCQuantityService.getInstance();
    const units = await service.detectModelUnits(actualModel);
    console.log('📐 Unidades detectadas:', units);
    return units;
  };

  // Helper para detectar software
  (window as any).detectIFCSoftware = async (model?: FRAGS.FragmentsGroup) => {
    const actualModel = getModel(model);
    
    if (!actualModel) {
      console.error('❌ Error: No se pudo obtener el modelo IFC.');
      return null;
    }

    const service = IFCQuantityService.getInstance();
    const software = await service.detectSourceSoftware(actualModel);
    console.log('💻 Software detectado:', software);
    return software;
  };

  // Helper para limpiar cache y forzar nueva detección
  (window as any).clearIFCQuantityCache = () => {
    const service = IFCQuantityService.getInstance();
    service.clearCache();
    console.log('🗑️ Cache del IFCQuantityService limpiado');
    return true;
  };

  // Logs iniciales desactivados para producción
  // Los logs aparecerán solo cuando el usuario llame a las funciones específicas
}

/**
 * Helper para obtener modelo y components desde el contexto de IFCViewer
 * Esto puede usarse si el modelo y components están disponibles globalmente
 */
export function getModelFromViewer(): {
  model?: FRAGS.FragmentsGroup;
  components?: OBC.Components;
} | null {
  if (typeof window === 'undefined') {
    return null;
  }

  // Intentar obtener desde contextos comunes
  // Esto depende de cómo esté estructurado el código
  // Por ahora retornamos null y el usuario debe pasar los valores explícitamente
  
  return null;
}
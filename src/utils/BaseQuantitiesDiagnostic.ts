/**
 * Base Quantities Diagnostic Script
 * 
 * Script para diagnosticar el flujo de baseQuantities y entender
 * qué valores vienen del IFC vs qué valores se calcularon.
 * 
 * Uso en consola del navegador:
 *   window.diagnoseBaseQuantities() - todos los elementos
 *   window.diagnoseBaseQuantities("WALL") - filtrar por tipo
 *   window.analyzeQuantitySummaryGroup("nombre-del-grupo") - analizar un grupo específico
 */

import { calculateBaseQuantities } from './BaseQuantityCalculator';

// Usar tipo genérico para aceptar cualquier variante de BaseCostElement
type BaseCostElementAny = {
  id: number;
  name: string;
  type: string;
  category?: string;
  baseQuantities?: {
    [key: string]: { value: number; unit: string };
  };
  [key: string]: any;
};

export interface DiagnosticResult {
  elementId: number;
  elementName: string;
  elementType: string;
  ifcQuantities: {
    [key: string]: { value: number; unit: string };
  };
  calculatedQuantities: {
    NetArea?: number;
    GrossArea?: number;
    Area?: number;
    NetSideArea?: number;
    GrossSideArea?: number;
    NetVolume?: number;
    GrossVolume?: number;
    Volume?: number;
  };
  issues: string[];
  summary: {
    hasNetArea: boolean;
    hasGrossArea: boolean;
    hasNetVolume: boolean;
    hasGrossVolume: boolean;
    netGrossAreaEqual: boolean;
    netGrossVolumeEqual: boolean;
    areaCalculated: boolean;
    volumeCalculated: boolean;
  };
}

export function runBaseQuantitiesDiagnostic(costData?: BaseCostElementAny[] | any): DiagnosticResult[] {
  // Si no se proporciona costData, intentar obtenerlo del store
  if (!costData) {
    try {
      // Intentar obtener del store de Zustand (diferentes formas según cómo esté expuesto)
      let storeData = null;
      
      // Método 1: Store global expuesto
      if ((window as any).__COSTA_STORE__) {
        storeData = (window as any).__COSTA_STORE__.getState()?.costData;
      }
      
      // Método 2: useCostStore.getState() si está disponible
      if (!storeData && (window as any).useCostStore) {
        storeData = (window as any).useCostStore.getState()?.costData;
      }
      
      // Método 3: Intentar importar dinámicamente (solo en desarrollo)
      if (!storeData) {
        console.warn('⚠️ No se pudo acceder al store automáticamente.');
        console.log('💡 Usa: window.diagnoseBaseQuantities() desde CostPage, o pasa costData como parámetro.');
        return [];
      }
      
      costData = storeData;
    } catch (error) {
      console.error('Error accediendo al store:', error);
      console.log('💡 Usa: window.diagnoseBaseQuantities() desde CostPage, o pasa costData como parámetro.');
      return [];
    }
  }

  if (!costData || costData.length === 0) {
    console.warn('No hay datos de costos disponibles.');
    return [];
  }

  const results: DiagnosticResult[] = [];

  costData.forEach((element) => {
    const baseQuantities = element.baseQuantities || {};
    const issues: string[] = [];
    const calculatedQuantities: any = {};

    // Analizar qué valores vienen del IFC
    const ifcQuantities: { [key: string]: { value: number; unit: string } } = {};
    Object.keys(baseQuantities).forEach(key => {
      ifcQuantities[key] = baseQuantities[key];
    });

    // Detectar valores Net/Gross del IFC
    const hasNetArea = !!(baseQuantities.NetArea || baseQuantities.NetSideArea);
    const hasGrossArea = !!(baseQuantities.GrossArea || baseQuantities.GrossSideArea);
    const hasNetVolume = !!baseQuantities.NetVolume;
    const hasGrossVolume = !!baseQuantities.GrossVolume;

    // Obtener valores para comparación
    const netAreaValue = baseQuantities.NetArea?.value || baseQuantities.NetSideArea?.value;
    const grossAreaValue = baseQuantities.GrossArea?.value || baseQuantities.GrossSideArea?.value;
    const netVolumeValue = baseQuantities.NetVolume?.value;
    const grossVolumeValue = baseQuantities.GrossVolume?.value;

    // Detectar si valores fueron calculados (no vienen del IFC)
    const areaCalculated = !hasNetArea && !hasGrossArea && !!baseQuantities.Area;
    const volumeCalculated = !hasNetVolume && !hasGrossVolume && !!baseQuantities.Volume;

    // Comparar valores Net vs Gross
    const netGrossAreaEqual = 
      netAreaValue !== undefined && 
      grossAreaValue !== undefined && 
      Math.abs(netAreaValue - grossAreaValue) < 0.001;

    const netGrossVolumeEqual = 
      netVolumeValue !== undefined && 
      grossVolumeValue !== undefined && 
      Math.abs(netVolumeValue - grossVolumeValue) < 0.001;

    // Detectar problemas
    if (netGrossAreaEqual && hasNetArea && hasGrossArea) {
      issues.push(`⚠️ NetArea y GrossArea son iguales (${netAreaValue?.toFixed(2)} m²). Esto puede ser correcto si no hay aberturas, o puede indicar que el IFC no diferencia Net/Gross.`);
    }

    if (netGrossVolumeEqual && hasNetVolume && hasGrossVolume) {
      issues.push(`⚠️ NetVolume y GrossVolume son iguales (${netVolumeValue?.toFixed(2)} m³). Esto puede ser correcto si no hay aberturas, o puede indicar que el IFC no diferencia Net/Gross.`);
    }

    if (areaCalculated) {
      issues.push(`ℹ️ Área calculada desde geometría/volumen (${baseQuantities.Area?.value?.toFixed(2)} m²). Solo se asignó a GrossArea/Area, NO a NetArea.`);
    }

    if (volumeCalculated) {
      issues.push(`ℹ️ Volumen calculado desde geometría (${baseQuantities.Volume?.value?.toFixed(2)} m³). Solo se asignó a GrossVolume/Volume, NO a NetVolume.`);
    }

    if (hasNetArea && !hasGrossArea) {
      issues.push(`ℹ️ Solo tiene NetArea del IFC, no GrossArea. GrossArea debería calcularse si es necesario.`);
    }

    if (hasGrossArea && !hasNetArea) {
      issues.push(`ℹ️ Solo tiene GrossArea del IFC, no NetArea. NetArea no se puede calcular desde geometría.`);
    }

    // Copiar valores calculados para mostrar
    if (baseQuantities.Area) calculatedQuantities.Area = baseQuantities.Area.value;
    if (baseQuantities.NetArea) calculatedQuantities.NetArea = baseQuantities.NetArea.value;
    if (baseQuantities.GrossArea) calculatedQuantities.GrossArea = baseQuantities.GrossArea.value;
    if (baseQuantities.NetSideArea) calculatedQuantities.NetSideArea = baseQuantities.NetSideArea.value;
    if (baseQuantities.GrossSideArea) calculatedQuantities.GrossSideArea = baseQuantities.GrossSideArea.value;
    if (baseQuantities.NetVolume) calculatedQuantities.NetVolume = baseQuantities.NetVolume.value;
    if (baseQuantities.GrossVolume) calculatedQuantities.GrossVolume = baseQuantities.GrossVolume.value;
    if (baseQuantities.Volume) calculatedQuantities.Volume = baseQuantities.Volume.value;

    results.push({
      elementId: element.id,
      elementName: element.name,
      elementType: element.type,
      ifcQuantities: ifcQuantities,
      calculatedQuantities: calculatedQuantities,
      issues: issues,
      summary: {
        hasNetArea,
        hasGrossArea,
        hasNetVolume,
        hasGrossVolume,
        netGrossAreaEqual,
        netGrossVolumeEqual,
        areaCalculated,
        volumeCalculated
      }
    });
  });

  return results;
}

export function printDiagnosticReport(results: DiagnosticResult[], filterByType?: string) {
  const filtered = filterByType 
    ? results.filter(r => r.elementType.toUpperCase().includes(filterByType.toUpperCase()))
    : results;

  if (filtered.length === 0) {
    console.log(`No se encontraron elementos${filterByType ? ` de tipo ${filterByType}` : ''}.`);
    return;
  }

  console.group(`📊 Reporte de Base Quantities - ${filtered.length} elemento(s)${filterByType ? ` (${filterByType})` : ''}`);

  // Resumen general
  const withNetArea = filtered.filter(r => r.summary.hasNetArea).length;
  const withGrossArea = filtered.filter(r => r.summary.hasGrossArea).length;
  const withNetVolume = filtered.filter(r => r.summary.hasNetVolume).length;
  const withGrossVolume = filtered.filter(r => r.summary.hasGrossVolume).length;
  const withEqualAreas = filtered.filter(r => r.summary.netGrossAreaEqual && r.summary.hasNetArea && r.summary.hasGrossArea).length;
  const withEqualVolumes = filtered.filter(r => r.summary.netGrossVolumeEqual && r.summary.hasNetVolume && r.summary.hasGrossVolume).length;
  const withCalculatedAreas = filtered.filter(r => r.summary.areaCalculated).length;
  const withCalculatedVolumes = filtered.filter(r => r.summary.volumeCalculated).length;

  console.log('📈 Resumen General:');
  console.log(`  - Elementos con NetArea: ${withNetArea}/${filtered.length}`);
  console.log(`  - Elementos con GrossArea: ${withGrossArea}/${filtered.length}`);
  console.log(`  - Elementos con NetVolume: ${withNetVolume}/${filtered.length}`);
  console.log(`  - Elementos con GrossVolume: ${withGrossVolume}/${filtered.length}`);
  console.log(`  - Elementos con NetArea = GrossArea: ${withEqualAreas}/${filtered.length}`);
  console.log(`  - Elementos con NetVolume = GrossVolume: ${withEqualVolumes}/${filtered.length}`);
  console.log(`  - Elementos con área calculada: ${withCalculatedAreas}/${filtered.length}`);
  console.log(`  - Elementos con volumen calculado: ${withCalculatedVolumes}/${filtered.length}`);

  // Detalles por elemento
  console.group('🔍 Detalles por Elemento:');
  filtered.forEach((result, index) => {
    console.group(`[${index + 1}] ${result.elementType} - ${result.elementName} (ID: ${result.elementId})`);
    
    console.log('📋 Valores del IFC:');
    const ifcKeys = Object.keys(result.ifcQuantities);
    if (ifcKeys.length > 0) {
      ifcKeys.forEach(key => {
        const qty = result.ifcQuantities[key];
        console.log(`  - ${key}: ${qty.value.toFixed(3)} ${qty.unit}`);
      });
    } else {
      console.log('  (ninguno)');
    }

    console.log('📊 Resumen:');
    console.log(`  - NetArea: ${result.summary.hasNetArea ? '✓' : '✗'} ${result.calculatedQuantities.NetArea ? `(${result.calculatedQuantities.NetArea.toFixed(3)} m²)` : ''}`);
    console.log(`  - GrossArea: ${result.summary.hasGrossArea ? '✓' : '✗'} ${result.calculatedQuantities.GrossArea ? `(${result.calculatedQuantities.GrossArea.toFixed(3)} m²)` : ''}`);
    console.log(`  - NetVolume: ${result.summary.hasNetVolume ? '✓' : '✗'} ${result.calculatedQuantities.NetVolume ? `(${result.calculatedQuantities.NetVolume.toFixed(3)} m³)` : ''}`);
    console.log(`  - GrossVolume: ${result.summary.hasGrossVolume ? '✓' : '✗'} ${result.calculatedQuantities.GrossVolume ? `(${result.calculatedQuantities.GrossVolume.toFixed(3)} m³)` : ''}`);

    if (result.issues.length > 0) {
      console.log('⚠️ Observaciones:');
      result.issues.forEach(issue => console.log(`  ${issue}`));
    }

    console.groupEnd();
  });
  console.groupEnd();

  console.groupEnd();
}

// Función helper para ejecutar desde consola
export function diagnostic(costData?: BaseCostElementAny[], filterByType?: string) {
  const results = runBaseQuantitiesDiagnostic(costData);
  printDiagnosticReport(results, filterByType);
  return results;
}

/**
 * Analiza un grupo específico de elementos para el Quantity Summary
 * Simula la lógica del Quantity Summary para ver qué valores se usarían
 */
export function analyzeQuantitySummaryGroup(
  elements: BaseCostElementAny[],
  ifcType: string
) {
  const typeUpper = ifcType.toUpperCase();
  
  // Simular la lógica del Quantity Summary
  let totalNetArea = 0;
  let totalGrossArea = 0;
  let totalArea = 0;
  let totalNetVolume = 0;
  let totalGrossVolume = 0;
  let totalVolume = 0;
  let elementsWithNetArea = 0;
  let elementsWithGrossArea = 0;
  let elementsWithNetVolume = 0;
  let elementsWithGrossVolume = 0;
  
  const elementDetails: Array<{
    name: string;
    netArea: number;
    grossArea: number;
    netVolume: number;
    grossVolume: number;
    hasNetArea: boolean;
    hasGrossArea: boolean;
  }> = [];
  
  elements.forEach(el => {
    const calculated = calculateBaseQuantities(
      el.baseQuantities || {},
      el.type || ifcType
    );
    
    const netArea = calculated.NetArea || calculated.NetSideArea || 0;
    const grossArea = calculated.GrossArea || calculated.GrossSideArea || calculated.Area || 0;
    const netVolume = calculated.NetVolume || 0;
    const grossVolume = calculated.GrossVolume || calculated.Volume || 0;
    
    if (netArea > 0) {
      totalNetArea += netArea;
      elementsWithNetArea++;
    }
    if (grossArea > 0) {
      totalGrossArea += grossArea;
      elementsWithGrossArea++;
    }
    totalArea += calculated.Area || calculated.GrossArea || calculated.NetArea || 0;
    
    if (netVolume > 0) {
      totalNetVolume += netVolume;
      elementsWithNetVolume++;
    }
    if (grossVolume > 0) {
      totalGrossVolume += grossVolume;
      elementsWithGrossVolume++;
    }
    totalVolume += calculated.Volume || calculated.GrossVolume || calculated.NetVolume || 0;
    
    elementDetails.push({
      name: el.name,
      netArea,
      grossArea,
      netVolume,
      grossVolume,
      hasNetArea: netArea > 0,
      hasGrossArea: grossArea > 0
    });
  });
  
  // Calcular valores para unidades según la lógica del Quantity Summary
  const m2 = elementsWithNetArea > 0 ? totalNetArea : (totalGrossArea || totalArea);
  const nm2 = totalNetArea > 0 ? totalNetArea : '';
  const brm2 = totalGrossArea || totalArea;
  const m3 = elementsWithNetVolume > 0 ? totalNetVolume : (totalGrossVolume || totalVolume);
  const nm3 = totalNetVolume > 0 ? totalNetVolume : '';
  const rm3 = totalGrossVolume || totalVolume;
  
  return {
    summary: {
      elementCount: elements.length,
      elementsWithNetArea,
      elementsWithGrossArea,
      elementsWithNetVolume,
      elementsWithGrossVolume,
      totalNetArea,
      totalGrossArea,
      totalArea,
      totalNetVolume,
      totalGrossVolume,
      totalVolume
    },
    unitValues: {
      M2: m2,
      NM2: nm2,
      BRM2: brm2,
      M3: m3,
      NM3: nm3,
      RM3: rm3
    },
    allEqual: {
      areas: Math.abs(m2 - (typeof nm2 === 'number' ? nm2 : brm2)) < 0.001 && 
             Math.abs(brm2 - (typeof nm2 === 'number' ? nm2 : brm2)) < 0.001,
      volumes: Math.abs(m3 - (typeof nm3 === 'number' ? nm3 : rm3)) < 0.001 && 
               Math.abs(rm3 - (typeof nm3 === 'number' ? nm3 : rm3)) < 0.001
    },
    elementDetails
  };
}

// Función helper para analizar grupos desde consola
export function analyzeGroup(groupKey: string, ifcType: string = 'WALL') {
  const costData = (window as any).useCostStore?.getState()?.costData || [];
  if (!costData || costData.length === 0) {
    console.error('No hay datos de costos disponibles.');
    return null;
  }
  
  // Filtrar elementos del grupo (normalizar nombre + TALO code)
  const normalizeRevitName = (name: string) => {
    return name.replace(/:\d+$/, '').trim();
  };
  
  const filtered = costData.filter((el: any) => {
    const normalizedName = normalizeRevitName(el.name);
    const elGroupKey = `${el.taloCode}-${normalizedName}`;
    return elGroupKey === groupKey || el.name.includes(groupKey) || normalizedName.includes(groupKey);
  });
  
  if (filtered.length === 0) {
    console.warn(`No se encontraron elementos para el grupo: ${groupKey}`);
    return null;
  }
  
  const analysis = analyzeQuantitySummaryGroup(filtered, ifcType);
  
  console.group(`📊 Análisis de Quantity Summary - Grupo: ${groupKey}`);
  console.log('📈 Resumen del Grupo:');
  console.log(`  - Elementos: ${analysis.summary.elementCount}`);
  console.log(`  - Con NetArea: ${analysis.summary.elementsWithNetArea}/${analysis.summary.elementCount}`);
  console.log(`  - Con GrossArea: ${analysis.summary.elementsWithGrossArea}/${analysis.summary.elementCount}`);
  console.log(`  - totalNetArea: ${analysis.summary.totalNetArea.toFixed(3)} m²`);
  console.log(`  - totalGrossArea: ${analysis.summary.totalGrossArea.toFixed(3)} m²`);
  console.log(`  - totalNetVolume: ${analysis.summary.totalNetVolume.toFixed(3)} m³`);
  console.log(`  - totalGrossVolume: ${analysis.summary.totalGrossVolume.toFixed(3)} m³`);
  
  console.log('\n📐 Valores para Unidades (lo que se escribiría en Excel):');
  const formatValue = (val: number | string) => {
    if (typeof val === 'number') {
      return `${val.toFixed(6)} m²`;
    }
    return val === '' ? '(vacío)' : val;
  };
  console.log(`  - M2: ${formatValue(analysis.unitValues.M2)}`);
  console.log(`  - NM2: ${formatValue(analysis.unitValues.NM2)}`);
  console.log(`  - BRM2: ${formatValue(analysis.unitValues.BRM2)}`);
  console.log(`  - M3: ${formatValue(analysis.unitValues.M3)}`);
  console.log(`  - NM3: ${formatValue(analysis.unitValues.NM3)}`);
  console.log(`  - RM3: ${formatValue(analysis.unitValues.RM3)}`);
  
  // Comparación directa
  console.log('\n🔍 Comparación Directa:');
  if (typeof analysis.unitValues.M2 === 'number' && typeof analysis.unitValues.NM2 === 'number') {
    const diffM2NM2 = Math.abs(analysis.unitValues.M2 - analysis.unitValues.NM2);
    console.log(`  - |M2 - NM2| = ${diffM2NM2.toFixed(6)} ${diffM2NM2 < 0.001 ? '✓ (iguales)' : '✗ (diferentes)'}`);
  }
  if (typeof analysis.unitValues.M2 === 'number' && typeof analysis.unitValues.BRM2 === 'number') {
    const diffM2BRM2 = Math.abs(analysis.unitValues.M2 - analysis.unitValues.BRM2);
    console.log(`  - |M2 - BRM2| = ${diffM2BRM2.toFixed(6)} ${diffM2BRM2 < 0.001 ? '✓ (iguales)' : '✗ (diferentes)'}`);
  }
  if (typeof analysis.unitValues.NM2 === 'number' && typeof analysis.unitValues.BRM2 === 'number') {
    const diffNM2BRM2 = Math.abs(analysis.unitValues.NM2 - analysis.unitValues.BRM2);
    console.log(`  - |NM2 - BRM2| = ${diffNM2BRM2.toFixed(6)} ${diffNM2BRM2 < 0.001 ? '✓ (iguales)' : '✗ (diferentes)'}`);
  }
  
  console.log('\n⚠️ Análisis:');
  if (analysis.allEqual.areas) {
    console.log(`  ⚠️ M2, NM2 y BRM2 son iguales (${analysis.unitValues.M2.toFixed(3)} m²)`);
    if (analysis.summary.totalNetArea === analysis.summary.totalGrossArea) {
      console.log(`  ℹ️ Esto es correcto: todos los elementos tienen NetArea = GrossArea`);
    } else {
      console.log(`  ⚠️ PROBLEMA: totalNetArea (${analysis.summary.totalNetArea.toFixed(3)}) ≠ totalGrossArea (${analysis.summary.totalGrossArea.toFixed(3)}) pero los valores finales son iguales`);
    }
  } else {
    console.log(`  ✓ M2, NM2 y BRM2 son diferentes (correcto)`);
  }
  
  if (analysis.allEqual.volumes) {
    console.log(`  ⚠️ M3, NM3 y RM3 son iguales (${analysis.unitValues.M3.toFixed(3)} m³)`);
    if (analysis.summary.totalNetVolume === analysis.summary.totalGrossVolume) {
      console.log(`  ℹ️ Esto es correcto: todos los elementos tienen NetVolume = GrossVolume`);
    } else {
      console.log(`  ⚠️ PROBLEMA: totalNetVolume (${analysis.summary.totalNetVolume.toFixed(3)}) ≠ totalGrossVolume (${analysis.summary.totalGrossVolume.toFixed(3)}) pero los valores finales son iguales`);
    }
  } else {
    console.log(`  ✓ M3, NM3 y RM3 son diferentes (correcto)`);
  }
  
  console.log('\n📋 Detalles por Elemento:');
  console.table(analysis.elementDetails.map(d => ({
    name: d.name.substring(0, 40),
    netArea: d.netArea > 0 ? d.netArea.toFixed(3) : '—',
    grossArea: d.grossArea.toFixed(3),
    netVolume: d.netVolume > 0 ? d.netVolume.toFixed(3) : '—',
    grossVolume: d.grossVolume.toFixed(3),
    netGrossAreaEqual: d.netArea > 0 && Math.abs(d.netArea - d.grossArea) < 0.001 ? '✓' : '✗',
    netGrossVolumeEqual: d.netVolume > 0 && Math.abs(d.netVolume - d.grossVolume) < 0.001 ? '✓' : '✗'
  })));
  
  console.groupEnd();
  
  return analysis;
}

// Exponer globalmente para uso en consola
if (typeof window !== 'undefined') {
  (window as any).runBaseQuantitiesDiagnostic = diagnostic;
  (window as any).baseQuantitiesDiagnostic = diagnostic;
  (window as any).analyzeQuantitySummaryGroup = analyzeGroup;
}

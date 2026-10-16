import { 
    UnifiedCostValues,
    FinnishCostValues,
    BaseCostElement, 
    CostAnalysisResult,
    ElementData,
    CostData,
    RTKorttiDetails,
    CostValue,
    ModernCostValues
} from '../types/cost';
import { TALO_ELEMENTS, TALO_2000_CATALOG } from '../constants/talo2000';
import { ADJUSTED_FINNISH_COSTS as FINNISH_COSTS, REGIONAL_FACTORS, BUILDING_TYPE_FACTORS, TRANSPORT_FACTORS } from '../data/finnishCostDatabase';
import { ADJUSTED_UNIFIED_RT_DATABASE as UNIFIED_RT_DATABASE } from '../data/unifiedRTDatabase';

type ConversionFactor = {
    from: string;
    to: string;
    factor: number;
    description?: string;
};

// Definición temporal del tipo RT_KORTTI_DATABASE hasta que se cree el archivo
const RT_KORTTI_DATABASE: Record<string, CostData> = {};

export class UnifiedCostService {
    private static instance: UnifiedCostService;
    private conversionFactors: ConversionFactor[] = [
        // Área a volumen (para cimientos y estructuras)
        {
            from: 'm²',
            to: 'm³',
            factor: 0.3, // Profundidad típica de cimientos
            description: 'Typical foundation depth'
        },
        // Longitud a área (para ventanas)
        {
            from: 'kpl',
            to: 'm²',
            factor: 1.5, // Área típica de ventana
            description: 'Typical window area'
        },
        // Área bruta a área neta
        {
            from: 'brm²',
            to: 'm²',
            factor: 0.85,
            description: 'Gross to net area ratio'
        },
        // Longitud a unidades (para mobiliario)
        {
            from: 'jm',
            to: 'kpl',
            factor: 0.5, // 2m por unidad de mobiliario
            description: 'Linear meters to furniture units'
        }
    ];

    private constructor() {}

    public static getInstance(): UnifiedCostService {
        if (!UnifiedCostService.instance) {
            UnifiedCostService.instance = new UnifiedCostService();
        }
        return UnifiedCostService.instance;
    }

    /**
     * Convierte una cantidad de una unidad a otra
     */
    public convertUnit(
        value: number,
        fromUnit: string,
        toUnit: string
    ): number | null {
        // Si las unidades son iguales, retornar el mismo valor
        if (fromUnit === toUnit) return value;

        // Buscar factor de conversión directo
        const directConversion = this.conversionFactors.find(
            cf => cf.from === fromUnit && cf.to === toUnit
        );

        if (directConversion) {
            return value * directConversion.factor;
        }

        // Buscar conversión inversa
        const inverseConversion = this.conversionFactors.find(
            cf => cf.from === toUnit && cf.to === fromUnit
        );

        if (inverseConversion) {
            return value / inverseConversion.factor;
        }

        // No se encontró conversión
        return null;
    }

    /**
     * Verifica si es posible convertir entre dos unidades
     */
    public canConvertUnit(fromUnit: string, toUnit: string): boolean {
        return (
            fromUnit === toUnit ||
            this.conversionFactors.some(
                cf =>
                    (cf.from === fromUnit && cf.to === toUnit) ||
                    (cf.from === toUnit && cf.to === fromUnit)
            )
        );
    }

    /**
     * Obtiene el factor de conversión entre dos unidades
     */
    public getUnitConversionFactor(
        fromUnit: string,
        toUnit: string
    ): ConversionFactor | null {
        const directConversion = this.conversionFactors.find(
            cf => cf.from === fromUnit && cf.to === toUnit
        );

        if (directConversion) {
            return directConversion;
        }

        const inverseConversion = this.conversionFactors.find(
            cf => cf.from === toUnit && cf.to === fromUnit
        );

        if (inverseConversion) {
            return {
                from: fromUnit,
                to: toUnit,
                factor: 1 / inverseConversion.factor,
                description: `Inverse of: ${inverseConversion.description}`
            };
        }

        return null;
    }

    /**
     * Extrae el código RT-kortti del nombre del elemento
     * Ejemplos: "Basic Wall:US-1:1344124" -> "US-1", "VS-1" -> "VS-1", "KS1" -> "KS-1"
     */
    private extractRTKorttiCode(elementName: string): string | null {
        if (!elementName) return null;
        
        // Patrones para códigos RT-kortti comunes
        const patterns = [
            /\b(US[-]?[0-9]+)\b/i,  // Ulkoseinät
            /\b(VS[-]?[0-9]+)\b/i,  // Väliseinät
            /\b(KS[-]?[0-9]+)\b/i,  // Kantavat seinät
            /\b(IK[-]?[0-9]+)\b/i,  // Ikkunat
            /\b(OV[-]?[0-9]+)\b/i,  // Ovet
            /\b(AP[-]?[0-9]+)\b/i,  // Alapohjat
            /\b(VP[-]?[0-9]+)\b/i,  // Välipohjat
            /\b(YP[-]?[0-9]+)\b/i,  // Yläpohjat
            /\b(PE[-]?[0-9]+)\b/i,  // Perustukset
            /\b(MR[-]?[0-9]+)\b/i,  // Maanrakennus
        ];
        
        for (const pattern of patterns) {
            const match = elementName.match(pattern);
            if (match) {
                // Normalizar: US1 -> US-1, VS-1 -> VS-1
                const code = match[1].toUpperCase();
                if (code.includes('-')) {
                    return code;
                } else {
                    // Separar letras y números: US1 -> US-1
                    const matchParts = code.match(/^([A-Z]+)([0-9]+)$/);
                    if (matchParts) {
                        return `${matchParts[1]}-${matchParts[2]}`;
                    }
                }
            }
        }
        
        return null;
    }

    /**
     * Calcula el costo total para un elemento dado
     */
    /**
     * Busca un código de costo en FINNISH_COSTS, mapeando códigos Talo 2000 de 4 dígitos
     * a códigos de costos de 2 dígitos (sin puntos)
     * NOTA: Este mapeo solo se usa como último recurso. Se prioriza RT-kortti.
     */
    private findCostCode(taloCode: string): string | null {
        if (!taloCode) return null;
        
        // Intentar código exacto primero (por si ya es un código de costo de 2 dígitos)
        if (FINNISH_COSTS[taloCode]) {
            return taloCode;
        }
        
        const parts = taloCode.split('.');
        
        // Mapeo de códigos Talo 2000 (4 dígitos) a códigos de costos (2 dígitos sin puntos)
        // Los códigos en FINNISH_COSTS son: '11', '12', '21', '32', '41', '51', '61', '71'
        const codeMapping: Record<string, string> = {
            // 1.1.x.x -> 11 (Alueosat - Earth Works)
            '1.1.1': '11',
            '1.1.2': '11',
            '1.1.3': '11',
            '1.1.4': '11',
            '1.1.5': '11',
            
            // 1.2.1.x, 1.2.2.x -> 12 (Perustukset, Alapohjat - Foundations)
            '1.2.1': '12',
            '1.2.2': '12',
            
            // 1.2.3.x, 1.2.6.x -> 21 (Runko, Vesikatot - Frame Structures)
            '1.2.3': '21',
            '1.2.6': '21',
            
            // 1.2.4.x, 1.2.5.x -> NO mapear a '32' (Windows)
            // 1.2.4.1 (Ulkoseinät) y 1.2.4.2 (Ikkunat) deben usar RT-kortti
            // Solo mapear subcódigos específicos si no hay RT-kortti disponible
            // '1.2.4': null,  // Debe usar RT-kortti (US-1, etc.)
            // '1.2.5': null,  // Debe usar RT-kortti
            
            // 1.3.1.x -> NO mapear a '32' (Windows)
            // 1.3.1.1 (Väliseinät) debe usar RT-kortti (VS-1)
            // '1.3.1': null,  // Debe usar RT-kortti (VS-1, etc.)
            
            // 1.3.2.x, 1.3.3.x, 1.3.4.x, 1.3.5.x -> 41 (Tilapinnat, etc. - Surface Structures)
            '1.3.2': '41',
            '1.3.3': '41',
            '1.3.4': '41',
            '1.3.5': '41',
            
            // 2.x.x.x -> 51 (Talotekniikka - Building Services/MEP)
            '2.1': '51', // Putkiosat
            '2.2': '51', // Ilmanvaihto-osat
            '2.3': '51', // Sähköosat
            '2.4': '51', // Tieto-osat
            '2.5': '51', // Laiteosat
            '2.5.1': '51',
            '2.5.2': '51',
        };
        
        // Si es código de 4 dígitos, verificar mapeos específicos primero
        if (parts.length === 4) {
            // Mapeos específicos para subcódigos que no son muros
            const specificMappings: Record<string, string> = {
                '1.2.4.2': '32',  // Ikkunat (Ventanas) - correcto
                '1.2.4.3': '32',  // Ulko-ovet (Puertas exteriores) - temporal, idealmente usar RT-kortti
                '1.3.1.5': '32',  // Väliovet (Puertas interiores) - temporal, idealmente usar RT-kortti
            };
            
            if (specificMappings[taloCode] && FINNISH_COSTS[specificMappings[taloCode]]) {
                return specificMappings[taloCode];
            }
            
            // Si no hay mapeo específico, usar mapeo de 3 dígitos (solo si no es muro)
            const threeDigit = `${parts[0]}.${parts[1]}.${parts[2]}`;
            // NO mapear 1.2.4 ni 1.3.1 porque son muros que deben usar RT-kortti
            if (threeDigit !== '1.2.4' && threeDigit !== '1.3.1') {
                const mappedCode = codeMapping[threeDigit];
                if (mappedCode && FINNISH_COSTS[mappedCode]) {
                    return mappedCode;
                }
            }
        }
        
        // Si es código de 3 dígitos, usar mapeo directo
        if (parts.length === 3) {
            const threeDigit = `${parts[0]}.${parts[1]}.${parts[2]}`;
            const mappedCode = codeMapping[threeDigit];
            if (mappedCode && FINNISH_COSTS[mappedCode]) {
                return mappedCode;
            }
        }
        
        // Si es código de 2 dígitos con puntos, convertir a sin puntos (1.2 -> 12)
        if (parts.length === 2) {
            const twoDigitNoDots = parts[0] + parts[1];
            if (FINNISH_COSTS[twoDigitNoDots]) {
                return twoDigitNoDots;
            }
        }
        
        // Fallback: intentar extraer primeros 2 dígitos sin puntos
        if (parts.length >= 2) {
            const firstTwo = parts[0] + parts[1];
            if (FINNISH_COSTS[firstTwo]) {
                return firstTwo;
            }
        }
        
        return null;
    }

    public calculateElementCost(
        taloCode: string,
        quantity: number,
        elementName?: string,
        elementType?: string,
        baseQuantities?: { [key: string]: { value: number; unit: string } },
        region: keyof typeof REGIONAL_FACTORS = 'helsinki'
    ): BaseCostElement | null {
        if (!taloCode) {
            console.warn('[UnifiedCostService] calculateElementCost called with empty taloCode');
            return null;
        }
        
        // PRIORIDAD 1: Buscar RT-kortti por nombre del elemento
        if (elementName) {
            const rtKorttiCode = this.extractRTKorttiCode(elementName);
            if (rtKorttiCode && UNIFIED_RT_DATABASE[rtKorttiCode]) {
                const rtKortti = UNIFIED_RT_DATABASE[rtKorttiCode];
                if (rtKortti.defaultCosts) {
                    // Usar costos del RT-kortti oficial
                    const rtUnit = rtKortti.measurementUnit || 'm²';
                    const regionalFactor = REGIONAL_FACTORS[region];
                    
                    // Obtener la cantidad correcta según la unidad del RT-kortti
                    let adjustedQuantity = quantity;
                    if (baseQuantities) {
                        // Si tenemos baseQuantities, usar la cantidad correcta según la unidad del RT-kortti
                        if (rtUnit === 'm²') {
                            // Buscar área en baseQuantities
                            adjustedQuantity = baseQuantities['GrossSideArea']?.value || 
                                             baseQuantities['NetSideArea']?.value ||
                                             baseQuantities['GrossArea']?.value ||
                                             baseQuantities['NetArea']?.value ||
                                             baseQuantities['Area']?.value ||
                                             quantity;
                        } else if (rtUnit === 'm³') {
                            // Buscar volumen en baseQuantities
                            adjustedQuantity = baseQuantities['GrossVolume']?.value ||
                                             baseQuantities['NetVolume']?.value ||
                                             baseQuantities['Volume']?.value ||
                                             quantity;
                        } else if (rtUnit === 'kpl') {
                            adjustedQuantity = 1; // Por pieza
                        }
                    } else {
                        // Si no hay baseQuantities, validar que la cantidad esté en la unidad correcta
                        // Si el RT-kortti requiere m² pero la cantidad parece ser m³, convertir
                        if (rtUnit === 'm²' && quantity > 1000) {
                            // Si la cantidad es muy grande para ser m², puede ser m³
                            // Intentar convertir asumiendo un espesor típico de muro (0.2-0.3m)
                            const typicalThickness = 0.25; // 25cm espesor típico
                            adjustedQuantity = quantity / typicalThickness;
                            console.warn(`[UnifiedCostService] Cantidad ${quantity} parece ser m³, convirtiendo a m² asumiendo espesor ${typicalThickness}m: ${adjustedQuantity} m²`);
                        }
                    }
                    
                    const costs: ModernCostValues = {
                        material: rtKortti.defaultCosts.material * adjustedQuantity * regionalFactor,
                        labor: rtKortti.defaultCosts.labor * adjustedQuantity * regionalFactor,
                        subcontract: (rtKortti.defaultCosts.subcontract ?? 0) * adjustedQuantity * regionalFactor,
                        total: rtKortti.defaultCosts.total * adjustedQuantity * regionalFactor
                    };
                    
                    // Obtener nombre del catálogo TALO si está disponible
                    const catalogEntry = TALO_2000_CATALOG?.[taloCode];
                    const taloName = catalogEntry?.name.fi || rtKortti.name?.fi || '';
                    
                    return {
                        id: Date.now(),
                        quantity: adjustedQuantity,
                        name: rtKortti.name?.en || rtKortti.name?.fi || elementName,
                        type: elementType || rtKortti.applicableIfcTypes?.[0] || 'IfcWall',
                        taloCode: taloCode,
                        taloName: taloName,
                        baseQuantities: {
                            [rtUnit]: { value: adjustedQuantity, unit: rtUnit }
                        },
                        costs,
                        rtDetails: rtKortti
                    };
                }
            }
        }
        
        // PRIORIDAD 2: Buscar RT-kortti por código TALO (si el RT-kortti tiene talo2000.code)
        // Esto se puede implementar más adelante si los RT-kortti tienen códigos TALO asociados
        
        // PRIORIDAD 3: Buscar código de costo genérico (puede ser diferente al código Talo)
        const costCode = this.findCostCode(taloCode);
        
        // Debug temporal
        if (process.env.NODE_ENV === 'development') {
            console.log('[UnifiedCostService] calculateElementCost', {
                taloCode,
                costCode,
                quantity,
                foundInFINNISH_COSTS: costCode ? !!FINNISH_COSTS[costCode] : false,
                hasQuantity: quantity > 0
            });
        }
        
        // Si la cantidad es 0, los costos serán 0, pero aún así debemos retornar la estructura
        if (quantity === 0) {
            console.warn(`[UnifiedCostService] calculateElementCost called with quantity 0 for: ${taloCode}`);
        }
        if (!costCode) {
            // Si no se encuentra, intentar usar TALO_ELEMENTS como fallback
            // Buscar primero el código exacto, luego códigos padre
            const parts = taloCode.split('.');
            let taloElement = TALO_ELEMENTS[taloCode];
            
            if (!taloElement && parts.length === 4) {
                const threeDigit = parts.slice(0, 3).join('.');
                taloElement = TALO_ELEMENTS[threeDigit];
            }
            if (!taloElement && parts.length >= 3) {
                const twoDigit = parts.slice(0, 2).join('.');
                taloElement = TALO_ELEMENTS[twoDigit];
            }
            
            if (taloElement && taloElement.costs) {
                // Aplicar factor regional también a TALO_ELEMENTS
                const regionalFactor = REGIONAL_FACTORS[region];
                const costs: ModernCostValues = {
                    material: taloElement.costs.material * quantity * regionalFactor,
                    labor: taloElement.costs.labor * quantity * regionalFactor,
                    subcontract: taloElement.costs.subcontract * quantity * regionalFactor,
                    total: taloElement.costs.total * quantity * regionalFactor
                };
                
                // Obtener nombre del catálogo si está disponible
                const catalogEntry = TALO_2000_CATALOG?.[taloCode];
                const taloName = catalogEntry?.name.fi || taloElement.name.fi;
                
                // Determinar unidad de medida
                const unit = taloElement.measurementUnit || 'm²';
                
                return {
                    id: Date.now(),
                    quantity,
                    name: taloElement.name.en || taloElement.name.fi,
                    type: taloElement.category,
                    taloCode: taloCode,
                    taloName: taloName,
                    baseQuantities: {
                        [unit]: { value: quantity, unit }
                    },
                    costs
                };
            }
            
            // Si todo falla, retornar null (no se pueden calcular costos)
            console.warn(`[UnifiedCostService] No se encontró código de costo para: ${taloCode}`);
            return null;
        }
        
        const costData = FINNISH_COSTS[costCode];
        if (!costData) {
            console.warn(`[UnifiedCostService] Código de costo encontrado (${costCode}) pero no existe en FINNISH_COSTS para: ${taloCode}`);
            // Intentar TALO_ELEMENTS como fallback
            const parts = taloCode.split('.');
            let taloElement = TALO_ELEMENTS[taloCode];
            if (!taloElement && parts.length === 4) {
                const threeDigit = parts.slice(0, 3).join('.');
                taloElement = TALO_ELEMENTS[threeDigit];
            }
            if (!taloElement && parts.length >= 3) {
                const twoDigit = parts.slice(0, 2).join('.');
                taloElement = TALO_ELEMENTS[twoDigit];
            }
            
            if (taloElement && taloElement.costs) {
                // Aplicar factor regional también a TALO_ELEMENTS
                const regionalFactor = REGIONAL_FACTORS[region];
                const costs: ModernCostValues = {
                    material: taloElement.costs.material * quantity * regionalFactor,
                    labor: taloElement.costs.labor * quantity * regionalFactor,
                    subcontract: taloElement.costs.subcontract * quantity * regionalFactor,
                    total: taloElement.costs.total * quantity * regionalFactor
                };
                
                const catalogEntry = TALO_2000_CATALOG?.[taloCode];
                const taloName = catalogEntry?.name.fi || taloElement.name.fi;
                
                // Determinar unidad de medida
                const unit = taloElement.measurementUnit || 'm²';
                
                return {
                    id: Date.now(),
                    quantity,
                    name: taloElement.name.en || taloElement.name.fi,
                    type: taloElement.category,
                    taloCode: taloCode,
                    taloName: taloName,
                    baseQuantities: {
                        [unit]: { value: quantity, unit }
                    },
                    costs
                };
            }
            
            return null;
        }

        const regionalFactor = REGIONAL_FACTORS[region];
        const unifiedCosts = this.calculateTotalCosts(costData.costs, quantity, regionalFactor);
        
        const costs: ModernCostValues = {
            material: unifiedCosts.material,
            labor: unifiedCosts.labor,
            subcontract: unifiedCosts.subcontract,
            total: unifiedCosts.total
        };

        // Obtener nombre del catálogo si está disponible
        const catalogEntry = TALO_2000_CATALOG?.[taloCode];
        const taloName = catalogEntry?.name.fi || costData.talo2000.category;
        
        return {
            id: Date.now(),
            quantity,
            name: costData.name.en,
            type: costData.talo2000.category,
            taloCode: taloCode, // Usar el código original de 4 dígitos
            taloName: taloName,
            baseQuantities: {
                [costData.properties.mainUnit]: {
                    value: quantity,
                    unit: costData.properties.mainUnit
                }
            },
            costs,
            rtDetails: this.convertToRTKorttiDetails(costData)
        };
    }

    /**
     * Convierte CostData a RTKorttiDetails
     */
    private convertToRTKorttiDetails(costData: CostData): RTKorttiDetails {
        return {
            code: costData.rtKortti?.code || '',
            materials: costData.composition?.materials.map(m => m.name.en) || [],
            workPhases: costData.composition?.labor.specialization || [],
            requirements: costData.technicalDetails?.fireRating || '',
            name: costData.name,
            source: costData.source,
            talo2000: costData.talo2000,
            technicalDetails: costData.technicalDetails,
            composition: costData.composition,
            maintenance: costData.maintenance
        };
    }

    /**
     * Calcula los costos totales aplicando cantidad y factor regional
     */
    private calculateTotalCosts(
        costs: CostData['costs'],
        quantity: number,
        regionalFactor: number
    ): FinnishCostValues {
        const material = this.adjustCost(costs.material, quantity, regionalFactor);
        const labor = this.adjustCost(costs.labor, quantity, regionalFactor);
        const equipment = this.adjustCost(costs.equipment, quantity, regionalFactor);
        const overhead = this.calculateOverhead(costs.overhead, material + labor + equipment);
        const subcontract = equipment + overhead;
        const total = material + labor + subcontract;

        return {
            material,
            labor,
            subcontract,
            total
        };
    }

    /**
     * Ajusta un costo individual según cantidad y factor regional
     */
    private adjustCost(
        cost: CostValue,
        quantity: number,
        regionalFactor: number
    ): number {
        return cost.value * quantity * regionalFactor;
    }

    /**
     * Calcula el overhead basado en un porcentaje del costo base
     */
    private calculateOverhead(
        overhead: CostValue,
        baseCost: number
    ): number {
        if (overhead.unit === '%') {
            return (baseCost * overhead.value) / 100;
        }
        return overhead.value;
    }

    /**
     * Analiza los costos de una lista de elementos
     */
    public analyzeCosts(elements: ElementData[]): CostAnalysisResult {
        const result: CostAnalysisResult = {
            elementCosts: [],
            totalCosts: {
                material: 0,
                labor: 0,
                subcontract: 0,
                total: 0
            },
            costByCategory: {},
            costByTaloCode: {},
            metrics: {
                costPerArea: 0,
                percentageByCategory: {}
            }
        };

        let totalArea = 0;

        for (const element of elements) {
            const rtKortti = this.findMatchingRTKortti(element);
            if (!rtKortti) continue;

            const quantity = Object.values(element.quantities)[0]?.value || 0;
            if (quantity === 0) continue;

            const costs = this.calculateTotalCosts(rtKortti.costs, quantity, 1);
            const costElement = this.createBaseCostElement(element, rtKortti, quantity, costs);

            this.updateAnalysisResults(result, costElement, element);
            
            if (element.quantities['Area']?.value) {
                totalArea += element.quantities['Area'].value;
            }
        }

        this.calculateMetrics(result, totalArea);
        return result;
    }

    /**
     * Busca el RT-kortti correspondiente a un elemento
     */
    private findMatchingRTKortti(element: ElementData): CostData | null {
        if (element.taloClassification?.code) {
            const rtKortti = Object.values(RT_KORTTI_DATABASE).find(
                (rt: CostData) => rt.talo2000.code === element.taloClassification?.code
            );
            if (rtKortti) return rtKortti;
        }

        return Object.values(RT_KORTTI_DATABASE).find((rt: CostData) => {
            const matchesType = rt.applicableIfcTypes?.includes(element.type);
            if (!matchesType) return false;

            const elementName = element.name.toLowerCase();
            return rt.applicableNames?.some((pattern: string) => 
                elementName.includes(pattern.toLowerCase())
            );
        }) || null;
    }

    /**
     * Crea un elemento de costo base
     */
    private createBaseCostElement(
        element: ElementData,
        rtKortti: CostData,
        quantity: number,
        unifiedCosts: FinnishCostValues
    ): BaseCostElement {
        const costs: ModernCostValues = {
            material: unifiedCosts.material,
            labor: unifiedCosts.labor,
            subcontract: unifiedCosts.subcontract,
            total: unifiedCosts.total
        };

        return {
            id: element.id,
            name: element.name,
            type: element.type,
            taloCode: rtKortti.talo2000.code,
            taloName: rtKortti.talo2000.category,
            quantity: quantity,
            baseQuantities: element.quantities,
            costs,
            rtDetails: this.convertToRTKorttiDetails(rtKortti)
        };
    }

    /**
     * Actualiza los resultados del análisis con un nuevo elemento
     */
    private updateAnalysisResults(
        result: CostAnalysisResult,
        costElement: BaseCostElement,
        element: ElementData
    ): void {
        result.elementCosts.push(costElement);
        this.updateTotalCosts(result.totalCosts, costElement.costs);
        this.updateCostByCategory(result.costByCategory, element.type, costElement.costs);
        this.updateCostByTaloCode(result.costByTaloCode, costElement.taloCode, costElement.costs);
    }

    /**
     * Actualiza los costos totales
     */
    private updateTotalCosts(totalCosts: FinnishCostValues, costs: FinnishCostValues): void {
        totalCosts.material += costs.material;
        totalCosts.labor += costs.labor;
        totalCosts.subcontract += costs.subcontract;
        totalCosts.total += costs.total;
    }

    /**
     * Actualiza los costos por categoría
     */
    private updateCostByCategory(
        costByCategory: { [category: string]: FinnishCostValues },
        category: string,
        costs: FinnishCostValues
    ): void {
        if (!costByCategory[category]) {
            costByCategory[category] = {
                material: 0,
                labor: 0,
                subcontract: 0,
                total: 0
            };
        }
        this.updateTotalCosts(costByCategory[category], costs);
    }

    /**
     * Actualiza los costos por código Talo
     */
    private updateCostByTaloCode(
        costByTaloCode: { [taloCode: string]: FinnishCostValues },
        taloCode: string,
        costs: FinnishCostValues
    ): void {
        if (!costByTaloCode[taloCode]) {
            costByTaloCode[taloCode] = {
                material: 0,
                labor: 0,
                subcontract: 0,
                total: 0
            };
        }
        this.updateTotalCosts(costByTaloCode[taloCode], costs);
    }

    /**
     * Calcula las métricas finales
     */
    private calculateMetrics(result: CostAnalysisResult, totalArea: number): void {
        if (totalArea > 0) {
            result.metrics.costPerArea = result.totalCosts.total / totalArea;
        }

        Object.keys(result.costByCategory).forEach(category => {
            result.metrics.percentageByCategory[category] = 
                (result.costByCategory[category].total / result.totalCosts.total) * 100;
        });
    }

    /**
     * Obtiene los costos de referencia para un código Talo
     */
    public getReferenceCosts(taloCode: string): UnifiedCostValues | null {
        const rtKortti = Object.values(RT_KORTTI_DATABASE).find(
            (rt: CostData) => rt.talo2000.code === taloCode
        );
        if (rtKortti) {
            return this.calculateTotalCosts(rtKortti.costs, 1, 1);
        }
        return null;
    }

    /**
     * Estima la cantidad típica basada en el tamaño del proyecto
     */
    public getTypicalQuantity(
        taloCode: string,
        size: 'small' | 'medium' | 'large'
    ): number {
        const costCode = this.findCostCode(taloCode);
        if (!costCode) return 0;
        
        const costData = FINNISH_COSTS[costCode];
        if (!costData) return 0;

        return costData.properties.typicalQuantities[size];
    }

    /**
     * Valida si una cantidad está dentro de los rangos típicos
     */
    public validateQuantity(
        taloCode: string,
        quantity: number
    ): boolean {
        const costCode = this.findCostCode(taloCode);
        if (!costCode) return false;
        
        const costData = FINNISH_COSTS[costCode];
        if (!costData) return false;

        const { small, large } = costData.properties.typicalQuantities;
        return quantity >= small * 0.5 && quantity <= large * 1.5;
    }

    /**
     * Obtiene las unidades alternativas disponibles para un código Talo
     */
    public getAvailableUnits(taloCode: string): string[] {
        const costCode = this.findCostCode(taloCode);
        if (!costCode) return [];
        
        const costData = FINNISH_COSTS[costCode];
        if (!costData) return [];

        return [costData.properties.mainUnit, ...costData.properties.alternativeUnits];
    }
} 
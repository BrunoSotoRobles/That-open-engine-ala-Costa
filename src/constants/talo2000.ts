import { ElementData, IFCQuantityValue } from '../types/cost';
import { resolveOpeningFrameDimsForPerimeter } from '../utils/QuantityResolution';
import { resolveWallFaceArea, resolveWallReliableVolume } from '../utils/wallFaceArea';
import { getReliableProfileWidth } from '../utils/widthLengthSignal';
import { getReliableStructuralVolume } from '../utils/hollowSectionPolicy';
import {
  getOnteloFootprintM2,
  getOnteloSpanM,
  isOnteloElementName,
} from '../utils/onteloQuantityPolicy';
import { resolveOpeningAreaM2 } from '../utils/familyQuantityPolicy';
import {
  Talo2000Unit,
  Talo2000MeasurementType,
  Talo2000Measurement,
  Talo2000Element,
  Talo2000QuantityValue
} from '../types/talo2000';

const FACADE_LAYER_ZERO_UNITS = new Set(["M2", "BRM2", "NM2", "KPL", "AS"]);

function extrasFromLitteraCall(
  filteredCode: unknown,
  extraProperties?: Record<string, string | number>
): Record<string, string | number> | undefined {
  if (extraProperties) return extraProperties;
  const nested = (filteredCode as { extraProperties?: Record<string, string | number> } | undefined)
    ?.extraProperties;
  return nested;
}

function quantityForAssemblyRole(
  unitUpper: string,
  extra: Record<string, string | number> | undefined
): number | null {
  if (!extra) return null;
  const role = extra["CostaBIM.LayerRole"];
  const contribute = extra["CostaBIM.ContributeToMaara"];
  if (role === "layer" || contribute === 0) {
    if (FACADE_LAYER_ZERO_UNITS.has(unitUpper)) return 0;
  }
  if (role === "host" && (unitUpper === "M2" || unitUpper === "BRM2" || unitUpper === "NM2")) {
    const pub = extra["CostaBIM.PublishedQuantity"];
    if (typeof pub === "number" && Number.isFinite(pub) && pub > 0) return pub;
  }
  return null;
}

export const IFC_TYPE_MEASUREMENTS: { [key: string]: Talo2000Measurement } = {
  // Elementos estructurales
  'IfcWall': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: [Talo2000Unit.CUBIC_METERS]
  },
  'IFCWALL': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: [Talo2000Unit.CUBIC_METERS]
  },
  'IfcSlab': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: [Talo2000Unit.CUBIC_METERS]
  },
  'IFCSLAB': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: [Talo2000Unit.CUBIC_METERS]
  },
  'IfcColumn': {
    primary: Talo2000MeasurementType.VOLUME,
    unit: Talo2000Unit.CUBIC_METERS,
    alternativeUnits: [Talo2000Unit.SQUARE_METERS]
  },
  'IFCCOLUMN': {
    primary: Talo2000MeasurementType.VOLUME,
    unit: Talo2000Unit.CUBIC_METERS,
    alternativeUnits: [Talo2000Unit.SQUARE_METERS]
  },
  'IfcBeam': {
    primary: Talo2000MeasurementType.VOLUME,
    unit: Talo2000Unit.CUBIC_METERS,
    alternativeUnits: [Talo2000Unit.SQUARE_METERS]
  },
  'IFCBEAM': {
    primary: Talo2000MeasurementType.VOLUME,
    unit: Talo2000Unit.CUBIC_METERS,
    alternativeUnits: [Talo2000Unit.SQUARE_METERS]
  },

  // Aberturas
  'IfcWindow': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: [Talo2000Unit.SQUARE_METERS]
  },
  'IFCWINDOW': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: [Talo2000Unit.SQUARE_METERS]
  },
  'IfcDoor': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: [Talo2000Unit.SQUARE_METERS]
  },
  'IFCDOOR': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: [Talo2000Unit.SQUARE_METERS]
  },

  // Equipamiento
  'IfcFurniture': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  'IFCFURNITURE': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  'IfcSanitaryTerminal': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  'IFCSANITARYTERMINAL': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },

  // Elementos MEP
  'IfcFlowTerminal': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  'IFCFLOWTERMINAL': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  'IfcDistributionFlowElement': {
    primary: Talo2000MeasurementType.LENGTH,
    unit: Talo2000Unit.METERS,
    alternativeUnits: []
  },
  'IFCDISTRIBUTIONFLOWELEMENT': {
    primary: Talo2000MeasurementType.LENGTH,
    unit: Talo2000Unit.METERS,
    alternativeUnits: []
  },

  // Missing IFC types that were causing errors
  'IfcBuildingElementProxy': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: [Talo2000Unit.CUBIC_METERS]
  },
  'IFCBUILDINGELEMENTPROXY': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: [Talo2000Unit.CUBIC_METERS]
  },
  'IfcElectricAppliance': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  'IFCELECTRICAPPLIANCE': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  'IfcCovering': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  'IFCCOVERING': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  'IfcCommunicationsAppliance': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  'IFCCOMMUNICATIONSAPPLIANCE': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },

  // Additional IFC types
  'IfcPipeSegment': {
    primary: Talo2000MeasurementType.LENGTH,
    unit: Talo2000Unit.METERS,
    alternativeUnits: []
  },
  'IFCPIPESEGMENT': {
    primary: Talo2000MeasurementType.LENGTH,
    unit: Talo2000Unit.METERS,
    alternativeUnits: []
  },
  'IfcDuctSegment': {
    primary: Talo2000MeasurementType.LENGTH,
    unit: Talo2000Unit.METERS,
    alternativeUnits: []
  },
  'IFCDUCTSEGMENT': {
    primary: Talo2000MeasurementType.LENGTH,
    unit: Talo2000Unit.METERS,
    alternativeUnits: []
  },
  'IfcCableSegment': {
    primary: Talo2000MeasurementType.LENGTH,
    unit: Talo2000Unit.METERS,
    alternativeUnits: []
  },
  'IFCCABLESEGMENT': {
    primary: Talo2000MeasurementType.LENGTH,
    unit: Talo2000Unit.METERS,
    alternativeUnits: []
  },

  // Elementos de sitio y otros
  'IfcRailing': {
    primary: Talo2000MeasurementType.LENGTH,
    unit: Talo2000Unit.METERS,
    alternativeUnits: []
  },
  'IFCRAILING': {
    primary: Talo2000MeasurementType.LENGTH,
    unit: Talo2000Unit.METERS,
    alternativeUnits: []
  },
  'IfcRoof': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  'IFCROOF': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  'IfcGeographicElement': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  'IFCGEOGRAPHICELEMENT': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  'IfcSite': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  'IFCSITE': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  'IfcWasteTerminal': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  'IFCWASTETERMINAL': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  'IfcFooting': {
    primary: Talo2000MeasurementType.VOLUME,
    unit: Talo2000Unit.CUBIC_METERS,
    alternativeUnits: []
  },
  'IFCFOOTING': {
    primary: Talo2000MeasurementType.VOLUME,
    unit: Talo2000Unit.CUBIC_METERS,
    alternativeUnits: []
  }
};

// Actualizar TALO_2000_MEASUREMENTS para incluir medidas específicas por código Talo
export const TALO_2000_MEASUREMENTS: { [key: string]: Talo2000Measurement } = {
  // Elementos de sitio y preparación
  '1.1': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  // Elementos estructurales
  '1.2.1': {
    primary: Talo2000MeasurementType.VOLUME,
    unit: Talo2000Unit.CUBIC_METERS,
    alternativeUnits: [Talo2000Unit.SQUARE_METERS]
  },
  '1.2.2': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: [Talo2000Unit.CUBIC_METERS]
  },
  '1.2.3': {
    primary: Talo2000MeasurementType.VOLUME,
    unit: Talo2000Unit.CUBIC_METERS,
    alternativeUnits: []
  },
  '1.2.4': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: [Talo2000Unit.CUBIC_METERS]
  },
  '1.2.6': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  // Elementos de cerramiento
  '1.3': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  '1.3.1': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  '1.3.2': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  '1.3.3': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  '1.3.4': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  '1.3.5': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: []
  },
  // Elementos MEP
  '2.1': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  '2.2': {
    primary: Talo2000MeasurementType.LENGTH,
    unit: Talo2000Unit.METERS,
    alternativeUnits: []
  },
  '2.3': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  '2.4': {
    primary: Talo2000MeasurementType.COUNT,
    unit: Talo2000Unit.PIECES,
    alternativeUnits: []
  },
  // Default para otros códigos
  'default': {
    primary: Talo2000MeasurementType.AREA,
    unit: Talo2000Unit.SQUARE_METERS,
    alternativeUnits: [Talo2000Unit.CUBIC_METERS, Talo2000Unit.METERS]
  }
};

export const TALO_ELEMENTS: { [key: string]: Talo2000Element } = {
  // 1. Perustukset (Foundations)
  '1.2.1': {
    code: '1.2.1',
    category: 'concrete',
    name: {
      fi: 'Perustukset',
      en: 'Foundations'
    },
    description: {
      fi: 'Perustukset',
      en: 'Foundations'
    },
    costs: {
      material: 150,
      labor: 60,
      subcontract: 50,
      total: 260
    },
    measurementUnit: Talo2000Unit.CUBIC_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-1', 'RT-3']
  },

  '1.2.2': {
    code: '1.2.2',
    category: 'concrete',
    name: {
      fi: 'Alapohjat',
      en: 'Base floors'
    },
    description: {
      fi: 'Alapohjat',
      en: 'Base floors'
    },
    costs: {
      material: 180,
      labor: 70,
      subcontract: 60,
      total: 310
    },
    measurementUnit: Talo2000Unit.SQUARE_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-1', 'RT-4']
  },

  // 2. Kantavat rakenteet (Load-bearing structures)
  '1.2.3': {
    code: '1.2.3',
    category: 'concrete',
    name: {
      fi: 'Kantavat rakenteet',
      en: 'Load-bearing structures'
    },
    description: {
      fi: 'Kantavat rakenteet',
      en: 'Load-bearing structures'
    },
    costs: {
      material: 120,
      labor: 45,
      subcontract: 40,
      total: 205
    },
    measurementUnit: Talo2000Unit.CUBIC_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-1', 'RT-2', 'RT-5', 'RT-6']
  },

  // 3. Välipohjat (Intermediate floors)
  '1.2.4': {
    code: '1.2.4',
    category: 'concrete',
    name: {
      fi: 'Välipohjat',
      en: 'Intermediate floors'
    },
    description: {
      fi: 'Välipohjat',
      en: 'Intermediate floors'
    },
    costs: {
      material: 160,
      labor: 65,
      subcontract: 50,
      total: 275
    },
    measurementUnit: Talo2000Unit.SQUARE_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-1', 'RT-7']
  },

  // 4. Vesikatot (Roofs)
  '1.2.6': {
    code: '1.2.6',
    category: 'concrete',
    name: {
      fi: 'Vesikatot',
      en: 'Roofs'
    },
    description: {
      fi: 'Vesikatot',
      en: 'Roofs'
    },
    costs: {
      material: 140,
      labor: 55,
      subcontract: 50,
      total: 245
    },
    measurementUnit: Talo2000Unit.SQUARE_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-1', 'RT-8']
  },

  // 5. Elementos de cerramiento (Enclosure elements)
  '1.3': {
    code: '1.3',
    category: 'enclosure',
    name: {
      fi: 'Elementos de cerramiento',
      en: 'Enclosure elements'
    },
    description: {
      fi: 'Elementos de cerramiento',
      en: 'Enclosure elements'
    },
    costs: {
      material: 120,
      labor: 50,
      subcontract: 40,
      total: 210
    },
    measurementUnit: Talo2000Unit.SQUARE_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-15', 'RT-16']
  },
  '1.3.1': {
    code: '1.3.1',
    category: 'enclosure',
    name: {
      fi: 'Muros exteriores',
      en: 'External walls'
    },
    description: {
      fi: 'Muros exteriores',
      en: 'External walls'
    },
    costs: {
      material: 150,
      labor: 60,
      subcontract: 50,
      total: 260
    },
    measurementUnit: Talo2000Unit.SQUARE_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-15', 'RT-16']
  },
  '1.3.2': {
    code: '1.3.2',
    category: 'enclosure',
    name: {
      fi: 'Muros interiores',
      en: 'Internal walls'
    },
    description: {
      fi: 'Muros interiores',
      en: 'Internal walls'
    },
    costs: {
      material: 100,
      labor: 40,
      subcontract: 30,
      total: 170
    },
    measurementUnit: Talo2000Unit.SQUARE_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-17', 'RT-18']
  },
  '1.3.3': {
    code: '1.3.3',
    category: 'enclosure',
    name: {
      fi: 'Techos',
      en: 'Ceilings'
    },
    description: {
      fi: 'Techos',
      en: 'Ceilings'
    },
    costs: {
      material: 80,
      labor: 35,
      subcontract: 25,
      total: 140
    },
    measurementUnit: Talo2000Unit.SQUARE_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-19', 'RT-20']
  },
  '1.3.4': {
    code: '1.3.4',
    category: 'enclosure',
    name: {
      fi: 'Complementos',
      en: 'Accessories'
    },
    description: {
      fi: 'Complementos',
      en: 'Accessories'
    },
    costs: {
      material: 90,
      labor: 30,
      subcontract: 20,
      total: 140
    },
    measurementUnit: Talo2000Unit.SQUARE_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-21', 'RT-22']
  },
  '1.3.5': {
    code: '1.3.5',
    category: 'enclosure',
    name: {
      fi: 'Elementos especiales',
      en: 'Special elements'
    },
    description: {
      fi: 'Elementos especiales',
      en: 'Special elements'
    },
    costs: {
      material: 200,
      labor: 80,
      subcontract: 65,
      total: 345
    },
    measurementUnit: Talo2000Unit.SQUARE_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-23', 'RT-24']
  },

  // 5. Putkiosat (Pipe components)
  '2.1': {
    code: '2.1',
    category: 'metal',
    name: {
      fi: 'Putkiosat',
      en: 'Pipe components'
    },
    description: {
      fi: 'Putkiosat',
      en: 'Pipe components'
    },
    costs: {
      material: 3000,
      labor: 200,
      subcontract: 250,
      total: 3450
    },
    measurementUnit: Talo2000Unit.CUBIC_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-9', 'RT-10']
  },

  // 6. LVI-järjestelmät (HVAC systems)
  'T2000-801': {
    code: 'T2000-801',
    category: 'metal',
    name: {
      fi: 'Vesi- ja viemärijärjestelmät',
      en: 'Water and sewage systems'
    },
    description: {
      fi: 'Vesi- ja viemärijärjestelmät',
      en: 'Water and sewage systems'
    },
    costs: {
      material: 3000,
      labor: 200,
      subcontract: 250,
      total: 3450
    },
    measurementUnit: Talo2000Unit.CUBIC_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-9', 'RT-10']
  },
  'T2000-802': {
    code: 'T2000-802',
    category: 'metal',
    name: {
      fi: 'Lämmitysjärjestelmät',
      en: 'Heating systems'
    },
    description: {
      fi: 'Lämmitysjärjestelmät',
      en: 'Heating systems'
    },
    costs: {
      material: 2500,
      labor: 180,
      subcontract: 220,
      total: 2900
    },
    measurementUnit: Talo2000Unit.CUBIC_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-11', 'RT-12']
  },
  'T2000-803': {
    code: 'T2000-803',
    category: 'metal',
    name: {
      fi: 'Ilmanvaihtojärjestelmät',
      en: 'Ventilation systems'
    },
    description: {
      fi: 'Ilmanvaihtojärjestelmät',
      en: 'Ventilation systems'
    },
    costs: {
      material: 2800,
      labor: 190,
      subcontract: 235,
      total: 3225
    },
    measurementUnit: Talo2000Unit.CUBIC_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-13', 'RT-14']
  },
  '2.4': {
    code: '2.4',
    category: 'electrical',
    name: {
      fi: 'Sähköjärjestelmät',
      en: 'Electrical systems'
    },
    description: {
      fi: 'Sähköjärjestelmät',
      en: 'Electrical systems'
    },
    costs: {
      material: 2500,
      labor: 180,
      subcontract: 220,
      total: 2900
    },
    measurementUnit: Talo2000Unit.CUBIC_METERS,
    measurements: TALO_2000_MEASUREMENTS['default'],
    rtComponents: ['RT-25', 'RT-26']
  }
};

/**
 * Obtiene la cantidad según las reglas de medición de Talo 2000
 */
export function getTalo2000Quantity(element: ElementData, taloCode: string): Talo2000QuantityValue | null {
  const measurement = TALO_2000_MEASUREMENTS[taloCode] || TALO_2000_MEASUREMENTS['default'];
  const typeUpper = String(element.type ?? "").toUpperCase();

  // Paso 2: wall M2 = face area, never cross-section Area
  if (
    measurement.primary === Talo2000MeasurementType.AREA &&
    typeUpper.includes("WALL") &&
    element.quantities
  ) {
    const wallFace = resolveWallFaceArea(element.quantities as any, "any");
    if (wallFace.value > 0) {
      return {
        value: wallFace.value,
        unit: measurement.unit,
        measurementType: measurement.primary,
      };
    }
  }
  
  // Intentar obtener la cantidad primaria
  let quantity = getQuantityByType(element, measurement.primary);
  if (quantity) {
    return {
      value: quantity.value,
      unit: measurement.unit,
      measurementType: measurement.primary
    };
  }

  // Si hay un tipo secundario y no se encontró el primario, intentar con el secundario
  if (measurement.secondary) {
    quantity = getQuantityByType(element, measurement.secondary);
    if (quantity) {
      return {
        value: quantity.value,
        unit: measurement.unit,
        measurementType: measurement.secondary
      };
    }
  }

  return null;
}

/**
 * Obtiene una cantidad específica según el tipo de medición
 */
function getQuantityByType(element: ElementData, type: Talo2000MeasurementType): IFCQuantityValue | null {
  switch (type) {
    case Talo2000MeasurementType.VOLUME:
      return element.quantities['Volume'] || element.quantities['NetVolume'];
    case Talo2000MeasurementType.AREA:
      return element.quantities['Area'] || element.quantities['NetArea'];
    case Talo2000MeasurementType.LENGTH:
      return element.quantities['Length'];
    case Talo2000MeasurementType.COUNT:
      return { value: 1, unit: Talo2000Unit.PIECES };
    case Talo2000MeasurementType.WEIGHT:
      return element.quantities['Weight'];
    default:
      return null;
  }
}

/**
 * Convierte código Talo comprimido a formato completo de 4 dígitos
 * Ejemplos: 1232 -> 1.2.3.2, 124 -> 1.2.4.0, 1311 -> 1.3.1.1
 */
export function expandTaloCode(compressed: string): string | null {
  if (!compressed || compressed.length === 0) return null;
  
  // Si ya tiene puntos, retornar tal cual
  if (compressed.includes('.')) return compressed;
  
  // Si tiene 3 dígitos, agregar .0 al final para hacerlo de 4 dígitos
  if (compressed.length === 3) {
    return compressed[0] + '.' + compressed[1] + '.' + compressed[2] + '.0';
  }
  
  // Si tiene 4 dígitos, formatear como X.X.X.X
  if (compressed.length === 4) {
    return compressed[0] + '.' + compressed[1] + '.' + compressed[2] + '.' + compressed[3];
  }
  
  return null;
}

/**
 * Catálogo completo de códigos Talo 2000 de 4 dígitos
 * Basado en TALO 2000 Hankenimikkeisto
 */
export const TALO_2000_CATALOG: Record<string, { code: string; name: { fi: string } }> = {
  '1.1.1.1': { code: '1.1.1.1', name: { fi: 'Raivausosat' } },
  '1.1.1.2': { code: '1.1.1.2', name: { fi: 'Kaivannot' } },
  '1.1.1.3': { code: '1.1.1.3', name: { fi: 'Kanaalit' } },
  '1.1.1.4': { code: '1.1.1.4', name: { fi: 'Täyttöosat' } },
  '1.1.1.5': { code: '1.1.1.5', name: { fi: 'Penkereet' } },
  '1.1.1.6': { code: '1.1.1.6', name: { fi: 'Kuivatusosat' } },
  '1.1.1.7': { code: '1.1.1.7', name: { fi: 'Erityiset maaosat' } },
  '1.1.2.1': { code: '1.1.2.1', name: { fi: 'Paalut' } },
  '1.1.2.2': { code: '1.1.2.2', name: { fi: 'Tuennat' } },
  '1.1.2.3': { code: '1.1.2.3', name: { fi: 'Vahvistukset' } },
  '1.1.2.4': { code: '1.1.2.4', name: { fi: 'Erityiset tuennat ja vahvistukset' } },
  '1.1.3.1': { code: '1.1.3.1', name: { fi: 'Liikennealueiden päällysteet' } },
  '1.1.3.2': { code: '1.1.3.2', name: { fi: 'Paikoitusalueiden päällysteet' } },
  '1.1.3.3': { code: '1.1.3.3', name: { fi: 'Oleskelu- ja leikkialueiden päällysteet' } },
  '1.1.3.4': { code: '1.1.3.4', name: { fi: 'Kasvillisuus' } },
  '1.1.3.5': { code: '1.1.3.5', name: { fi: 'Erityisalueiden päällysteet' } },
  '1.1.4.1': { code: '1.1.4.1', name: { fi: 'Talovarusteet' } },
  '1.1.4.2': { code: '1.1.4.2', name: { fi: 'Oleskeluvarusteet' } },
  '1.1.4.3': { code: '1.1.4.3', name: { fi: 'Leikkivarusteet' } },
  '1.1.4.4': { code: '1.1.4.4', name: { fi: 'Alueopasteet' } },
  '1.1.4.5': { code: '1.1.4.5', name: { fi: 'Erityiset aluevarusteet' } },
  '1.1.5.1': { code: '1.1.5.1', name: { fi: 'Pihavarastot' } },
  '1.1.5.2': { code: '1.1.5.2', name: { fi: 'Pihakatokset' } },
  '1.1.5.3': { code: '1.1.5.3', name: { fi: 'Aidat ja tukimuurit' } },
  '1.1.5.4': { code: '1.1.5.4', name: { fi: 'Alueen portaat, luiskat ja terassit' } },
  '1.1.5.5': { code: '1.1.5.5', name: { fi: 'Alueen pysäköintirakenteet' } },
  '1.1.5.6': { code: '1.1.5.6', name: { fi: 'Erityiset alueen rakenteet' } },
  '1.2.1.1': { code: '1.2.1.1', name: { fi: 'Anturat' } },
  '1.2.1.2': { code: '1.2.1.2', name: { fi: 'Perusmuurit, peruspilarit ja peruspalkit' } },
  '1.2.1.3': { code: '1.2.1.3', name: { fi: 'Erityiset perustukset' } },
  '1.2.2.1': { code: '1.2.2.1', name: { fi: 'Alapohjalaatat' } },
  '1.2.2.2': { code: '1.2.2.2', name: { fi: 'Alapohjakanaalit' } },
  '1.2.2.3': { code: '1.2.2.3', name: { fi: 'Erityiset alapohjat' } },
  '1.2.3.1': { code: '1.2.3.1', name: { fi: 'Väestönsuojat' } },
  '1.2.3.2': { code: '1.2.3.2', name: { fi: 'Kantavat seinät' } },
  '1.2.3.3': { code: '1.2.3.3', name: { fi: 'Pilarit' } },
  '1.2.3.4': { code: '1.2.3.4', name: { fi: 'Palkit' } },
  '1.2.3.5': { code: '1.2.3.5', name: { fi: 'Välipohjat' } },
  '1.2.3.6': { code: '1.2.3.6', name: { fi: 'Yläpohjat' } },
  '1.2.3.7': { code: '1.2.3.7', name: { fi: 'Runkoportaat' } },
  '1.2.3.8': { code: '1.2.3.8', name: { fi: 'Erityiset runkorakenteet' } },
  '1.2.4.1': { code: '1.2.4.1', name: { fi: 'Ulkoseinät' } },
  '1.2.4.2': { code: '1.2.4.2', name: { fi: 'Ikkunat' } },
  '1.2.4.3': { code: '1.2.4.3', name: { fi: 'Ulko-ovet' } },
  '1.2.4.4': { code: '1.2.4.4', name: { fi: 'Julkisivuvarusteet' } },
  '1.2.4.5': { code: '1.2.4.5', name: { fi: 'Erityiset julkisivurakenteet' } },
  '1.2.5.1': { code: '1.2.5.1', name: { fi: 'Parvekkeet' } },
  '1.2.5.2': { code: '1.2.5.2', name: { fi: 'Katokset' } },
  '1.2.5.3': { code: '1.2.5.3', name: { fi: 'Erityiset ulkotasot' } },
  '1.2.6.1': { code: '1.2.6.1', name: { fi: 'Vesikattorakenteet' } },
  '1.2.6.2': { code: '1.2.6.2', name: { fi: 'Räystäsrakenteet' } },
  '1.2.6.3': { code: '1.2.6.3', name: { fi: 'Vesikatteet' } },
  '1.2.6.4': { code: '1.2.6.4', name: { fi: 'Vesikattovarusteet' } },
  '1.2.6.5': { code: '1.2.6.5', name: { fi: 'Lasikattorakenteet' } },
  '1.2.6.6': { code: '1.2.6.6', name: { fi: 'Kattoikkunat ja -luukut' } },
  '1.2.6.7': { code: '1.2.6.7', name: { fi: 'Erityiset vesikattorakenteet' } },
  '1.3.1.1': { code: '1.3.1.1', name: { fi: 'Väliseinät' } },
  '1.3.1.2': { code: '1.3.1.2', name: { fi: 'Lasiväliseinät' } },
  '1.3.1.3': { code: '1.3.1.3', name: { fi: 'Erityisväliseinät' } },
  '1.3.1.4': { code: '1.3.1.4', name: { fi: 'Kaiteet' } },
  '1.3.1.5': { code: '1.3.1.5', name: { fi: 'Väliovet' } },
  '1.3.1.6': { code: '1.3.1.6', name: { fi: 'Erityisovet' } },
  '1.3.1.7': { code: '1.3.1.7', name: { fi: 'Tilaportaat' } },
  '1.3.1.8': { code: '1.3.1.8', name: { fi: 'Erityiset tilajako-osat' } },
  '1.3.2.1': { code: '1.3.2.1', name: { fi: 'Lattioiden pintarakenteet' } },
  '1.3.2.2': { code: '1.3.2.2', name: { fi: 'Lattiapinnat' } },
  '1.3.2.3': { code: '1.3.2.3', name: { fi: 'Sisäkattorakenteet' } },
  '1.3.2.4': { code: '1.3.2.4', name: { fi: 'Sisäkattopinnat' } },
  '1.3.2.5': { code: '1.3.2.5', name: { fi: 'Seinien pintarakenteet' } },
  '1.3.2.6': { code: '1.3.2.6', name: { fi: 'Seinäpinnat' } },
  '1.3.2.7': { code: '1.3.2.7', name: { fi: 'Erityiset tilapinnat' } },
  '1.3.3.1': { code: '1.3.3.1', name: { fi: 'Vakiokiintokalusteet' } },
  '1.3.3.2': { code: '1.3.3.2', name: { fi: 'Erityiskiintokalusteet' } },
  '1.3.3.3': { code: '1.3.3.3', name: { fi: 'Varusteet' } },
  '1.3.3.4': { code: '1.3.3.4', name: { fi: 'Vakiolaitteet' } },
  '1.3.3.5': { code: '1.3.3.5', name: { fi: 'Tilaopasteet' } },
  '1.3.3.6': { code: '1.3.3.6', name: { fi: 'Erityiset tilavarusteet' } },
  '1.3.4.1': { code: '1.3.4.1', name: { fi: 'Hoitotasot ja kulkurakenteet' } },
  '1.3.4.2': { code: '1.3.4.2', name: { fi: 'Tulisijat ja savuhormit' } },
  '1.3.4.3': { code: '1.3.4.3', name: { fi: 'Muut erityiset tilaosat' } },
  '1.3.5.1': { code: '1.3.5.1', name: { fi: 'Kylpyhuone-elementit' } },
  '1.3.5.2': { code: '1.3.5.2', name: { fi: 'Kylmähuone-elementit' } },
  '1.3.5.3': { code: '1.3.5.3', name: { fi: 'Saunaelementit' } },
  '1.3.5.4': { code: '1.3.5.4', name: { fi: 'Talotekniikan tilaelementit' } },
  '1.3.5.5': { code: '1.3.5.5', name: { fi: 'Hormielementit' } },
  '1.3.5.6': { code: '1.3.5.6', name: { fi: 'Erityiset tilaelementit' } },
  '2.5.1.1': { code: '2.5.1.1', name: { fi: 'Hissit' } },
  '2.5.1.2': { code: '2.5.1.2', name: { fi: 'Kuljettimet' } },
  '2.5.1.3': { code: '2.5.1.3', name: { fi: 'Erityiset siirtolaitteet' } },
  '2.5.2.1': { code: '2.5.2.1', name: { fi: 'Keittiölaitteet' } },
  '2.5.2.2': { code: '2.5.2.2', name: { fi: 'Pesulalaitteet' } },
  '2.5.2.3': { code: '2.5.2.3', name: { fi: 'Väestösuojalaitteet' } },
  '2.5.2.4': { code: '2.5.2.4', name: { fi: 'Allaslaitteet' } },
  '2.5.2.5': { code: '2.5.2.5', name: { fi: 'Erityiset tilalaitteet' } },
  '3.1.1.1': { code: '3.1.1.1', name: { fi: 'Hankkeen valmistelu' } },
  '3.1.1.2': { code: '3.1.1.2', name: { fi: 'Suunnittelun valmistelu ja ohjaus' } },
  '3.1.1.3': { code: '3.1.1.3', name: { fi: 'Rakentamisen valmistelu' } },
  '3.1.1.4': { code: '3.1.1.4', name: { fi: 'Rakentamisen ohjaus' } },
  '3.1.1.5': { code: '3.1.1.5', name: { fi: 'Vastaan- ja käyttöönoton ohjaus' } },
  '3.1.1.6': { code: '3.1.1.6', name: { fi: 'Takuuajan rakennuttaminen' } },
  '3.1.1.7': { code: '3.1.1.7', name: { fi: 'Muu hankkeen rakennuttaminen' } },
  '3.1.2.1': { code: '3.1.2.1', name: { fi: 'Rakentamisen työmaavalvonta' } },
  '3.1.2.2': { code: '3.1.2.2', name: { fi: 'Tekniikan työmaavalvonta' } },
  '3.1.2.3': { code: '3.1.2.3', name: { fi: 'Muu paikallisvalvonta' } },
  '3.1.3.1': { code: '3.1.3.1', name: { fi: 'Hankkeen hallintotehtävät' } },
  '3.1.3.2': { code: '3.1.3.2', name: { fi: 'Lupatehtävät' } },
  '3.1.3.3': { code: '3.1.3.3', name: { fi: 'Rakentamisen vakuuttaminen' } },
  '3.1.3.4': { code: '3.1.3.4', name: { fi: 'Muu rakennuttamisen hallinto' } },
  '3.2.1.1': { code: '3.2.1.1', name: { fi: 'Toiminnallinen tilasuunnittelu' } },
  '3.2.1.2': { code: '3.2.1.2', name: { fi: 'Tilayhteyssuunnittelu' } },
  '3.2.2.1': { code: '3.2.2.1', name: { fi: 'Pääsuunnittelu' } },
  '3.2.2.2': { code: '3.2.2.2', name: { fi: 'Arkkitehtisuunnittelu' } },
  '3.2.2.3': { code: '3.2.2.3', name: { fi: 'Rakennesuunnittelu' } },
  '3.2.2.4': { code: '3.2.2.4', name: { fi: 'LVI-suunnittelu' } },
  '3.2.2.5': { code: '3.2.2.5', name: { fi: 'Sähkösuunnittelu' } },
  '3.2.2.6': { code: '3.2.2.6', name: { fi: 'Sisustussuunnittelu' } },
  '3.2.3.1': { code: '3.2.3.1', name: { fi: 'Geotekniset asiantuntijatehtävät' } },
  '3.2.3.2': { code: '3.2.3.2', name: { fi: 'Akustiset asiantuntijatehtävät' } },
  '3.2.3.3': { code: '3.2.3.3', name: { fi: 'Maisema-asiantuntijatehtävät' } },
  '3.2.3.4': { code: '3.2.3.4', name: { fi: 'Palo-asiantuntijatehtävät' } },
  '3.2.3.5': { code: '3.2.3.5', name: { fi: 'Talousasiantuntijatehtävät' } },
  '3.2.3.6': { code: '3.2.3.6', name: { fi: 'Muut suunnittelun asiantuntijatehtävät' } },
  '3.2.4.1': { code: '3.2.4.1', name: { fi: 'Kopiointitehtävät' } },
  '3.2.4.2': { code: '3.2.4.2', name: { fi: 'Tietokantatehtävät' } },
  '3.2.4.3': { code: '3.2.4.3', name: { fi: 'Huoltokirjatehtävät' } },
  '3.2.4.4': { code: '3.2.4.4', name: { fi: 'Erityiset hanketietotehtävät' } },
  '3.3.1.1': { code: '3.3.1.1', name: { fi: 'Työmaan yleisjohto' } },
  '3.3.1.2': { code: '3.3.1.2', name: { fi: 'Laskentatehtävät' } },
  '3.3.1.3': { code: '3.3.1.3', name: { fi: 'Hankintatehtävät' } },
  '3.3.1.4': { code: '3.3.1.4', name: { fi: 'Yritystehtävät' } },
  '3.3.1.5': { code: '3.3.1.5', name: { fi: 'Muut rakentamisen yleisjohto- ja hallintotehtävät' } },
  '3.3.2.1': { code: '3.3.2.1', name: { fi: 'Vastaava työnjohto' } },
  '3.3.2.2': { code: '3.3.2.2', name: { fi: 'Työnsuunnittelu ja ohjaus' } },
  '3.3.2.3': { code: '3.3.2.3', name: { fi: 'Työmaan työturvallisuus' } },
  '3.3.2.4': { code: '3.3.2.4', name: { fi: 'Rakennustyön työnjohto ja valvonta' } },
  '3.4.1.1': { code: '3.4.1.1', name: { fi: 'Työmaarakennukset' } },
  '3.4.1.2': { code: '3.4.1.2', name: { fi: 'Työmaa-alue' } },
  '3.4.1.3': { code: '3.4.1.3', name: { fi: 'Avustavat rakennustyöt' } },
  '3.4.1.4': { code: '3.4.1.4', name: { fi: 'Käyttöaineet ja energia' } },
  '3.4.1.5': { code: '3.4.1.5', name: { fi: 'Työmaan lämmitys ja kuivaus' } },
  '3.4.1.6': { code: '3.4.1.6', name: { fi: 'Työmaan puhtaanapito ja suojaus' } },
  '3.4.1.7': { code: '3.4.1.7', name: { fi: 'Työmaan vartiointi' } },
  '3.4.1.8': { code: '3.4.1.8', name: { fi: 'Muut työmaan palvelut' } },
  '3.4.2.1': { code: '3.4.2.1', name: { fi: 'Nostot ja siirrot' } },
  '3.4.2.2': { code: '3.4.2.2', name: { fi: 'Telineet' } },
  '3.4.2.3': { code: '3.4.2.3', name: { fi: 'Työmaakuljetukset' } },
  '3.4.2.4': { code: '3.4.2.4', name: { fi: 'Muu työmaan kalusto' } },
  '4.1.1.1': { code: '4.1.1.1', name: { fi: 'Tontin hankinta ja vuokraus' } },
  '4.1.1.2': { code: '4.1.1.2', name: { fi: 'Verot ja rasitteet' } },
  '4.1.1.3': { code: '4.1.1.3', name: { fi: 'Erityiset tonttitehtävät' } },
  '4.1.2.1': { code: '4.1.2.1', name: { fi: 'Liittyminen rakennuksiin' } },
  '4.1.2.2': { code: '4.1.2.2', name: { fi: 'Liittyminen verkostoihin' } },
  '4.1.2.3': { code: '4.1.2.3', name: { fi: 'Erityiset liittymät' } },
  '4.1.3.1': { code: '4.1.3.1', name: { fi: 'Kiinteistökehitys' } },
  '4.1.3.2': { code: '4.1.3.2', name: { fi: 'Kaavoitus' } },
  '4.2.1.1': { code: '4.2.1.1', name: { fi: 'Lainoitustehtävät' } },
  '4.2.1.2': { code: '4.2.1.2', name: { fi: 'Yhtiötehtävät' } },
  '4.2.1.3': { code: '4.2.1.3', name: { fi: 'Erityiset rahoitustehtävät' } },
  '4.2.2.1': { code: '4.2.2.1', name: { fi: 'Asuntomarkkinointi' } },
  '4.2.2.2': { code: '4.2.2.2', name: { fi: 'Toimitilamarkkinointi' } },
  '4.2.2.3': { code: '4.2.2.3', name: { fi: 'Muu markkinointi' } },
  '5.1.1.1': { code: '5.1.1.1', name: { fi: 'Irtaimet kalusteet' } },
  '5.1.1.2': { code: '5.1.1.2', name: { fi: 'Irtaimet varusteet' } },
  '5.1.2.1': { code: '5.1.2.1', name: { fi: 'Toiminnan kojeet' } },
  '5.1.2.2': { code: '5.1.2.2', name: { fi: 'Toiminnan laitteet' } },
  '5.2.1.1': { code: '5.2.1.1', name: { fi: 'Väliaikaiset tilat' } },
  '5.2.1.2': { code: '5.2.1.2', name: { fi: 'Väliaikaiset rakenteet ja laitteet' } },
  '5.2.1.3': { code: '5.2.1.3', name: { fi: 'Muu väliaikainen toiminta' } },
  '5.2.2.1': { code: '5.2.2.1', name: { fi: 'Muutto' } },
  '5.2.2.2': { code: '5.2.2.2', name: { fi: 'Käyttökoulutus' } },
  '5.2.2.3': { code: '5.2.2.3', name: { fi: 'Muu käyttöönotto' } },
  '6.1.1.1': { code: '6.1.1.1', name: { fi: 'Suunnitelmamuutokset' } },
  '6.1.1.2': { code: '6.1.1.2', name: { fi: 'Rakentamismuutokset' } },
  '6.1.2.1': { code: '6.1.2.1', name: { fi: 'Suunnitteluaikainen hintamuutos' } },
  '6.1.2.2': { code: '6.1.2.2', name: { fi: 'Rakennusaikainen hintamuutos' } },
  '6.1.2.3': { code: '6.1.2.3', name: { fi: 'Muu hintamuutos' } },
  '6.2.1.1': { code: '6.2.1.1', name: { fi: 'Sijaintiriskit' } },
  '6.2.1.2': { code: '6.2.1.2', name: { fi: 'Olosuhderiskit' } },
  '6.2.1.3': { code: '6.2.1.3', name: { fi: 'Muut riskit' } },
  '6.2.2.1': { code: '6.2.2.1', name: { fi: 'Toteutusmuotovaraus' } },
  '6.2.2.2': { code: '6.2.2.2', name: { fi: 'Muu erityinen varaus' } },
};

/**
 * Mapeos de patrones regex para nombres comunes a códigos Talo 2000
 */
export type Talo2000Mapping = {
  pattern: RegExp;
  code: string;
  priority?: number;
};

export const TALO_2000_MAPPINGS: Talo2000Mapping[] = [
  { pattern: /VS[0-9]|VS-[0-9]/i, code: '1.3.1.1' },
  { pattern: /US[0-9]|US-[0-9]/i, code: '1.2.4.1' },
  { pattern: /KS[0-9]|KS-[0-9]/i, code: '1.2.3.2' },
  { pattern: /Valiseina.*VS|VS.*valiseina/i, code: '1.3.1.1' },
  { pattern: /Ulkoseina.*US|US.*ulkoseina/i, code: '1.2.4.1' },
  { pattern: /Kantava.*seina.*KS|KS.*kantava/i, code: '1.2.3.2' },
  { pattern: /seina|seinat|wall/i, code: '1.2.3.2' },
  { pattern: /ulkoseina|ulkoseinat/i, code: '1.2.4.1' },
  { pattern: /valiseina|valiseinat/i, code: '1.3.1.1' },
  { pattern: /kantava.*seina|kantavat.*seinat/i, code: '1.2.3.2' },
  { pattern: /betoniseina|betoniseinat/i, code: '1.2.3.2' },
  { pattern: /tiiliseina|tiiliseinat/i, code: '1.2.3.2' },
  { pattern: /kiviseina|kiviseinat/i, code: '1.2.3.2' },
  { pattern: /puuseina|puuseinat/i, code: '1.2.3.2' },
  { pattern: /rakennusseina|rakennusseinat/i, code: '1.2.3.2' },
  { pattern: /julkisivu|julkisivut/i, code: '1.2.4.0' },
  { pattern: /CLT-seina|CLTseina/i, code: '1.2.3.2' },
  { pattern: /Sandwich-seina|Sandwichseina/i, code: '1.2.3.2' },
  { pattern: /Rankaseina|rankaseina/i, code: '1.2.3.2' },
  { pattern: /Kevytseina|kevytseina/i, code: '1.2.3.2' },
  { pattern: /Massiiviseina|massiiviseina/i, code: '1.2.3.2' },
  { pattern: /Julkisivuseina|julkisivuseina/i, code: '1.2.4.1' },
  { pattern: /Lasiseina|lasiseina/i, code: '1.3.1.2' },
  { pattern: /Palo-Seina|PaloSeina|paloseina/i, code: '1.2.3.2' },
  { pattern: /Aaniseina|aaniseina/i, code: '1.3.1.1' },
  { pattern: /Elementtiseina|elementtiseina/i, code: '1.2.3.2' },
  { pattern: /pilari|pilarit|column/i, code: '1.2.3.3' },
  { pattern: /betonipilari|betonipilarit/i, code: '1.2.3.3' },
  { pattern: /teraspilari|teraspilarit/i, code: '1.2.3.3' },
  { pattern: /puupilari|puupilarit/i, code: '1.2.3.3' },
  { pattern: /Liimapilari|liimapilari/i, code: '1.2.3.3' },
  { pattern: /palkki|palkit|beam/i, code: '1.2.3.4' },
  { pattern: /betonipalkki|betonipalkit/i, code: '1.2.3.4' },
  { pattern: /teraspalkki|teraspalkit/i, code: '1.2.3.4' },
  { pattern: /puupalkki|puupalkit/i, code: '1.2.3.4' },
  { pattern: /kantava.*palkki/i, code: '1.2.3.4' },
  { pattern: /Liimapalkki|liimapalkki/i, code: '1.2.3.4' },
  { pattern: /LVL-palkki|LVLpalkki/i, code: '1.2.3.4' },
  { pattern: /Ristikko|ristikko/i, code: '1.2.3.4' },
  { pattern: /valipohja|valipohjat|floor/i, code: '1.2.3.5' },
  { pattern: /ylapohja|ylapohjat|roof/i, code: '1.2.3.6' },
  { pattern: /alapohja|alapohjat/i, code: '1.2.2.0' },
  { pattern: /alapohjalaatta/i, code: '1.2.2.1' },
  { pattern: /betonipohja|betonipohjat/i, code: '1.2.3.5' },
  { pattern: /teraspohja|teraspohjat/i, code: '1.2.3.5' },
  { pattern: /puupohja|puupohjat/i, code: '1.2.3.5' },
  { pattern: /Ontelolaatta|ontelolaatta/i, code: '1.2.3.5' },
  { pattern: /Laattaelementti|laattaelementti/i, code: '1.2.3.5' },
  { pattern: /Maavarainen.*laatta|maavarainen.*laatta/i, code: '1.2.3.5' },
  { pattern: /Massiivilaata|massiivilaata/i, code: '1.2.3.5' },
  { pattern: /ovi|ovet|door/i, code: '1.3.1.5' },
  { pattern: /ulko-ovi|ulkoovet/i, code: '1.2.4.3' },
  { pattern: /valiovi|valiovet/i, code: '1.3.1.5' },
  { pattern: /siaovi|siaovet/i, code: '1.3.1.5' },
  { pattern: /parvekeovi|parvekeovet/i, code: '1.2.4.3' },
  { pattern: /Palo-ovi|Paloovi|palo-ovi/i, code: '1.2.4.3' },
  { pattern: /Aaniovi|aaniovi/i, code: '1.3.1.5' },
  { pattern: /ikkuna|ikkunat|window/i, code: '1.2.4.2' },
  { pattern: /ikkuna.*ikkuna/i, code: '1.2.4.2' },
  { pattern: /ikkunaruutu|ikkunaruudut/i, code: '1.2.4.2' },
  { pattern: /Kiintea.*ikkuna|kiintea.*ikkuna/i, code: '1.2.4.2' },
  { pattern: /Lasielementti|lasielementti/i, code: '1.2.4.2' },
  { pattern: /vesikatto|vesikatot|roof/i, code: '1.2.6.0' },
  { pattern: /kattorakenne|kattorakenteet/i, code: '1.2.6.1' },
  { pattern: /rastas|raystas/i, code: '1.2.6.2' },
  { pattern: /kattopalkki|kattopalkit/i, code: '1.2.6.1' },
  { pattern: /kattolevy|kattolevyt/i, code: '1.2.6.3' },
  { pattern: /peltikatto|peltikatot/i, code: '1.2.6.3' },
  { pattern: /Konesaumakatto|konesaumakatto/i, code: '1.2.6.3' },
  { pattern: /Huopakate|huopakate/i, code: '1.2.6.3' },
  { pattern: /Vesikate|vesikate/i, code: '1.2.6.3' },
  { pattern: /Kattoristikko|kattoristikko/i, code: '1.2.6.1' },
  { pattern: /portaat|stairs/i, code: '1.2.3.7' },
  { pattern: /runkoportaat/i, code: '1.2.3.7' },
  { pattern: /tilaportaat/i, code: '1.3.1.7' },
  { pattern: /portaikko|portaikot/i, code: '1.2.3.7' },
  { pattern: /betoniportaat/i, code: '1.2.3.7' },
  { pattern: /perustus|perustukset|foundation/i, code: '1.2.1.0' },
  { pattern: /antura|anturat/i, code: '1.2.1.1' },
  { pattern: /perusmuuri|perusmuurit/i, code: '1.2.1.2' },
  { pattern: /peruspalkki|peruspalkit/i, code: '1.2.1.2' },
  { pattern: /peruspilari|peruspilarit/i, code: '1.2.1.2' },
  { pattern: /betoniantura|betonianturat/i, code: '1.2.1.1' },
  { pattern: /Paalu|paalu/i, code: '1.1.2.1' },
  { pattern: /Sokkeli|sokkeli/i, code: '1.2.1.0' },
  { pattern: /Reunapalkki|reunapalkki/i, code: '1.2.1.2' },
  { pattern: /Peruslaatta|peruslaatta/i, code: '1.2.1.1' },
  { pattern: /lattia|lattiat|floor/i, code: '1.3.2.2' },
  { pattern: /lattiapinta|lattiapinnat/i, code: '1.3.2.2' },
  { pattern: /betonilattia|betonilattiat/i, code: '1.3.2.2' },
  { pattern: /laattalattia|laattalattiat/i, code: '1.3.2.2' },
  { pattern: /kaide|kaiteet|railing/i, code: '1.3.1.4' },
  { pattern: /tilakaide|tilakaiteet/i, code: '1.3.1.4' },
  { pattern: /parvekekaide|parvekekaiteet/i, code: '1.3.1.4' },
  { pattern: /portaiden.*kaide/i, code: '1.3.1.4' },
  { pattern: /parveke|parvekkeet/i, code: '1.2.5.1' },
  { pattern: /parvekerakenne|parvekerakenteet/i, code: '1.2.5.1' },
  { pattern: /siakatto|siakatot/i, code: '1.3.2.3' },
  { pattern: /kattopinta|kattopinnat/i, code: '1.3.2.4' },
  { pattern: /kipsikatto|kipsikatot/i, code: '1.3.2.3' },
  { pattern: /seinapinta|seinapinnat/i, code: '1.3.2.6' },
  { pattern: /seinalevy|seinalevyt/i, code: '1.3.2.5' },
  { pattern: /Tasoite|tasoite/i, code: '1.3.2.2' },
  { pattern: /Paneeli|Panelointi|paneeli|panelointi/i, code: '1.3.2.6' },
  { pattern: /Akustiikkalevy|akustiikkalevy/i, code: '1.3.2.4' },
];

/**
 * Valida si un código Talo 2000 es válido
 * Ahora valida contra el catálogo completo de códigos de 4 dígitos
 */
export function isValidTalo2000Code(code: string): boolean {
  // Validar contra el catálogo completo (códigos de 4 dígitos)
  if (code in TALO_2000_CATALOG) return true;
  
  // También validar contra elementos y medidas existentes (retrocompatibilidad)
  return code in TALO_ELEMENTS || code in TALO_2000_MEASUREMENTS;
}

/**
 * Convierte una cantidad entre diferentes unidades Talo 2000
 */
export function convertTalo2000Units(
  value: number,
  fromUnit: Talo2000Unit,
  toUnit: Talo2000Unit
): number | null {
  // Por ahora solo soportamos conversiones simples
  if (fromUnit === toUnit) return value;
  
  // Conversiones básicas
  const conversions: { [key: string]: number } = {
    'm2_to_m3': 0.3, // Altura típica de 0.3m
    'm3_to_m2': 3.33, // Inverso de la altura típica
  };

  const conversionKey = `${fromUnit}_to_${toUnit}`;
  const factor = conversions[conversionKey];
  
  if (factor) {
    return value * factor;
  }

  return null;
}

/**
 * Obtiene la unidad de medida correcta basada en el tipo IFC y código Talo
 */
export function getCorrectUnit(ifcType: string, taloCode: string, rtDetails?: any): Talo2000Unit {
  // 1. Prioridad: RT-kortti
  if (rtDetails?.measurementUnit) {
    return rtDetails.measurementUnit;
  }

  // 2. Prioridad: Código Talo - búsqueda recursiva
  if (taloCode) {
    let currentTaloCode = taloCode;
    while (currentTaloCode && currentTaloCode.length > 0) {
      const taloMeasurement = TALO_2000_MEASUREMENTS[currentTaloCode];
  if (taloMeasurement) {
    return taloMeasurement.unit;
      }
      // Remover el último nivel del código
      currentTaloCode = currentTaloCode.split('.').slice(0, -1).join('.');
    }
  }

  // 3. Prioridad: Tipo IFC
  const normalizedIfcType = ifcType.toLowerCase();
  const ifcKeys = Object.keys(IFC_TYPE_MEASUREMENTS);
  const matchingIfcKey = ifcKeys.find(k => k.toLowerCase() === normalizedIfcType);

  // Log para diagnóstico de tipos IFC no encontrados (solo en desarrollo)
  if (!matchingIfcKey && process.env.NODE_ENV === 'development') {
    console.log('IFC Type not found in mappings:', {
      originalType: ifcType,
      normalizedType: normalizedIfcType,
      availableTypes: ifcKeys.map(k => k.toLowerCase())
    });
  }

  if (matchingIfcKey) {
    return IFC_TYPE_MEASUREMENTS[matchingIfcKey].unit;
  }

  // 4. Default
  return Talo2000Unit.SQUARE_METERS;
}

/**
 * Convierte unidad Littera (M2, M3, KPL, etc.) a Talo2000Unit para usar con getCorrectQuantity.
 */
export function litteraUnitToTalo2000Unit(unit: string): Talo2000Unit {
  const u = (unit || '').toUpperCase();
  if (u === 'M3' || u === 'RM3' || u === 'NM3') return Talo2000Unit.CUBIC_METERS;
  if (u === 'M2' || u === 'BRM2' || u === 'NM2') return Talo2000Unit.SQUARE_METERS;
  if (u === 'KPL' || u === 'ERÄ' || u === 'AS') return Talo2000Unit.PIECES;
  if (u === 'KG') return Talo2000Unit.KILOGRAMS;
  if (u === 'JM' || u === 'M') return Talo2000Unit.METERS;
  return Talo2000Unit.SQUARE_METERS;
}

/**
 * Obtiene la cantidad correcta basada en la unidad de medida
 * NOTA: Esta función es genérica y no considera el tipo de elemento IFC.
 * Para asignación de cantidades a códigos Littera, usar getQuantityForLitteraCodeByType
 */
export function getCorrectQuantity(element: any, unit: Talo2000Unit): number {
  if (!element.baseQuantities) return 0;

  const extra = element.extraProperties as Record<string, string | number> | undefined;
  if (extra?.["CostaBIM.PublishedBlocked"] === 1) return 0;
  if (extra?.["CostaBIM.LayerRole"] === "layer" || extra?.["CostaBIM.ContributeToMaara"] === 0) {
    if (unit === Talo2000Unit.SQUARE_METERS || unit === Talo2000Unit.PIECES) return 0;
  }
  if (
    unit === Talo2000Unit.SQUARE_METERS &&
    extra?.["CostaBIM.LayerRole"] === "host"
  ) {
    const pub = extra["CostaBIM.PublishedQuantity"];
    if (typeof pub === "number" && Number.isFinite(pub) && pub > 0) return pub;
  }

  switch(unit) {
    case Talo2000Unit.CUBIC_METERS: {
      const t = String(element.type ?? element.ifcType ?? "").toUpperCase();
      if (t.includes("WALL") && element.baseQuantities) {
        const wallVol = resolveWallReliableVolume(element.baseQuantities);
        if (wallVol.value > 0) return wallVol.value;
      }
      return getReliableStructuralVolume(
        element.baseQuantities,
        element.type ?? element.ifcType,
        element.extraProperties
      );
    }
    
    case Talo2000Unit.SQUARE_METERS: {
      const t = String(element.type ?? element.ifcType ?? "").toUpperCase();
      if (t.includes("WALL") && element.baseQuantities) {
        const wallFace = resolveWallFaceArea(element.baseQuantities, "any");
        if (wallFace.value > 0) return wallFace.value;
      }
      return element.baseQuantities['GrossSideArea']?.value || 
             element.baseQuantities['NetSideArea']?.value || 
             element.baseQuantities['GrossArea']?.value || 
             element.baseQuantities['NetArea']?.value || 0;
    }
    
    case Talo2000Unit.METERS:
      return element.baseQuantities['Length']?.value || 0;
    
    case Talo2000Unit.PIECES:
      return 1;
    
    case Talo2000Unit.KILOGRAMS: {
      // Paso 1: peso directo del IFC
      const directWeight = element.baseQuantities['Weight']?.value;
      if (directWeight !== undefined && directWeight !== null && directWeight > 0) {
        return directWeight;
      }

      const bqVolume =
        element.baseQuantities['GrossVolume']?.value ||
        element.baseQuantities['NetVolume']?.value ||
        0;
      if (bqVolume <= 0) return 0;

      // Paso 2: si el tipo IFC es acero puro (IfcMember, IfcPlate, etc.) usar densidad real
      const elemType: string = element.type ?? element.ifcType ?? '';
      if (isSteelIfcType(elemType)) {
        return bqVolume * 7850;
      }

      // Paso 3: para elementos de concreto o tipo desconocido usar ratio de armadura
      // (mucho más conservador y correcto para los códigos TALO que usan KG en concreto)
      return bqVolume * getDefaultRebarRatio(elemType);
    }
    
    default:
      return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para el cálculo de peso (KG) en códigos Littera
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrae un ratio de peso explícito embebido en la descripción del código Littera.
 * Ejemplos reconocidos: "arvio 60 kg/m3", "70kg/m3", "8,5kg/m2", "1 kg/m2", "50 kg/m³"
 * Retorna { ratio, per } o null si no hay ratio explícito.
 */
function parseExplicitRebarRatio(description: string): { ratio: number; per: 'm3' | 'm2' } | null {
  const desc = description || '';
  // Acepta separador decimal coma o punto; unidades m3/m³ y m2/m²
  const m3 = desc.match(/(\d+(?:[,.]\d+)?)\s*kg\/m[3³]/i);
  if (m3) return { ratio: parseFloat(m3[1].replace(',', '.')), per: 'm3' };
  const m2 = desc.match(/(\d+(?:[,.]\d+)?)\s*kg\/m[2²]/i);
  if (m2) return { ratio: parseFloat(m2[1].replace(',', '.')), per: 'm2' };
  return null;
}

/**
 * Clasifica un código Littera de unidad KG según el tipo de material que representa.
 *
 * - 'structural-steel' : elemento de acero estructural (vigas, pilares, marcos, perfiles).
 * - 'connection-steel' : acero de empalme/conexión "+20%" (työ- ja jatkosteräkset).
 * - 'rebar'            : armadura de concreto (raudoitus, B500, B500A, verkkoraud, etc.).
 */
function classifyKgCode(description: string): 'structural-steel' | 'connection-steel' | 'rebar' {
  const desc = (description || '').toLowerCase();

  // Acero de conexión: siempre contiene "+20%" o la expresión finlandesa estándar
  if (desc.includes('+20%') || desc.includes('työ- ja jatkosteräkset')) {
    return 'connection-steel';
  }

  // Acero estructural: perfiles, marcos, soportes metálicos
  const steelKeywords = [
    'teräspalkki', 'teräspalkit', 'teräspilar', 'teräspilarit',
    'teräsrunko', 'terästuet', 'teräsrakenne',
    'saumateräkset', // costuras de elementos prefabricados (acero, no armadura)
  ];
  const steelProfilePattern = /\b(hea|heb|hem|ipe|ipeaa|ipea|rhs|shs|chs|upn|unp)\s*\d/i;
  if (steelKeywords.some(kw => desc.includes(kw)) || steelProfilePattern.test(description)) {
    return 'structural-steel';
  }

  // Todo lo demás: armadura en concreto (raudoitus, B500x, A500, verkkoraud,
  // tartunta, kalliotartunnat, etc.)
  return 'rebar';
}

/**
 * Retorna el ratio de armadura por defecto (kg/m³) según el tipo IFC del elemento
 * que contiene el concreto.  Basado en normas finlandesas de cuantificación (BY 51).
 */
function getDefaultRebarRatio(ifcType: string): number {
  const t = (ifcType || '').toUpperCase();
  if (t.includes('COLUMN'))                         return 120;
  if (t.includes('BEAM'))                           return 120;
  if (t.includes('STAIR') || t.includes('RAMP'))    return 100;
  if (t.includes('WALL'))                           return 90;
  if (t.includes('SLAB') || t.includes('FOOTING'))  return 80;
  if (t.includes('ROOF'))                           return 80;
  return 80; // default conservador
}

/**
 * Retorna true si el tipo IFC indica un elemento de acero estructural puro
 * (sin mezcla concreto/acero que requiera discriminar por nombre).
 */
function isSteelIfcType(ifcType: string): boolean {
  const t = (ifcType || '').toUpperCase();
  return (
    t === 'IFCMEMBER' ||
    t === 'IFCPLATE' ||
    t === 'IFCREINFORCINGBAR' ||
    t === 'IFCREINFORCINGMESH' ||
    t === 'IFCREINFORCINGELEMENT' ||
    t === 'IFCTENDON' ||
    t === 'IFCTENDONANCHOR'
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Obtiene la cantidad correcta para un código Littera según el tipo de elemento IFC y la unidad requerida
 * Esta función implementa la lógica correcta según el estándar IFC para cada tipo de elemento
 * 
 * @param ifcType - Tipo IFC del elemento (IfcWall, IfcSlab, IfcWindow, etc.)
 * @param unit - Unidad requerida por el código Littera (M2, BRM2, NM2, M3, RM3, NM3, JM, KG, KPL, etc.)
 * @param baseQuantities - Cantidades base del elemento IFC
 * @param elementName - Nombre del elemento (para contexto en cálculo de perímetro)
 * @param finalQuantity - Cantidad final de fallback si no se encuentra una cantidad específica
 * @param filteredCode - Código Littera filtrado (opcional, para contexto en cálculo de perímetro)
 * @param extraProperties - CostaBIM extras (LayerRole / PublishedQuantity) when assigning after grouping
 * @returns Cantidad correcta según el tipo de elemento y unidad requerida
 */
export function getQuantityForLitteraCodeByType(
  ifcType: string,
  unit: string,
  baseQuantities: { [key: string]: { value: number; unit: string } },
  elementName: string = '',
  finalQuantity: number = 0,
  filteredCode?: any,
  extraProperties?: Record<string, string | number>
): number {
  const unitUpper = unit.toUpperCase();
  const typeUpper = ifcType.toUpperCase();
  const assemblyQty = quantityForAssemblyRole(
    unitUpper,
    extrasFromLitteraCall(filteredCode, extraProperties)
  );
  if (assemblyQty !== null) return assemblyQty;

  // Helper para calcular perímetro (usado para JM)
  const calculatePerimeter = (): number => {
    const description = (filteredCode?.description || '').toLowerCase();
    const nameLower = elementName.toLowerCase();
    const typeLower = typeUpper.toLowerCase();

    const perimeterKeywords = [
      'listoitus', 'kittaus', 'tilkitseminen', 'liittymärakenteet', 'liittym'
    ];

    const lengthKeywords = [
      'palkki', 'pilari', 'paalutus', 'putki', 'kaapeli', 'kanaali',
      'salaoja', 'viemäri', 'reunalaudoitus', 'kaista', 'juoksu', 'torvi', 'kouru',
      'kaide', 'kaiteet', 'railing', 'kaite'
    ];

    const isPerimeter = 
      perimeterKeywords.some(keyword => description.includes(keyword)) ||
      (typeLower.includes('window') || typeLower.includes('door')) ||
      (nameLower.includes('ikkuna') || nameLower.includes('ovi'));

    const isDirectLength = 
      lengthKeywords.some(keyword => description.includes(keyword)) ||
      typeLower.includes('beam') ||
      typeLower.includes('column') ||
      typeLower.includes('pipe') ||
      typeLower.includes('cable') ||
      typeLower.includes('railing') ||
      typeLower.includes('member');

    if (isPerimeter && !isDirectLength) {
      const length = baseQuantities.Length?.value;
      const resolved = resolveOpeningFrameDimsForPerimeter(ifcType, baseQuantities);
      if (resolved && resolved.openingWidth > 0 && resolved.openingHeight > 0) {
        const { openingWidth: ow, openingHeight: oh } = resolved;
        // Puerta: marco = dos verticales + dintel (solo una horizontal)
        if (typeLower.includes('door')) {
          return 2 * oh + ow;
        }
        // Ventana: perímetro completo del marco (4 lados)
        if (typeLower.includes('window')) {
          return 2 * (ow + oh);
        }
        // Otros (listoitus, kittaus, etc.): 4 lados
        return 2 * (ow + oh);
      }
      if (length) {
        return length;
      }
    }

    if (baseQuantities.Length?.value !== undefined) {
      return baseQuantities.Length.value;
    }

    // Paso 3: no usar Width como perfil si Width≈Length (beam/column/slab)
    const width = getReliableProfileWidth(baseQuantities, ifcType);
    const height = baseQuantities.Height?.value;
    if (width && height) {
      return width + height;
    }

    return 0;
  };

  // ===== ÁREA (M2, BRM2, NM2) =====
  if (unitUpper === 'M2' || unitUpper === 'BRM2' || unitUpper === 'NM2') {
    // Ontelo Oxx (cualquier IfcType): footprint = Area tipada, no W×L bbox
    if (isOnteloElementName(elementName)) {
      const foot = getOnteloFootprintM2(elementName, baseQuantities, finalQuantity);
      if (foot > 0) return foot;
    }

    // MUROS (IfcWall): Área del paño — nunca Area/canto (Paso 2)
    if (typeUpper.includes('WALL')) {
      const prefer =
        unitUpper === 'NM2' ? 'net' : unitUpper === 'BRM2' ? 'gross' : 'any';
      const wallFace = resolveWallFaceArea(baseQuantities, prefer);
      if (wallFace.value > 0) {
        return wallFace.value;
      }
      return finalQuantity;
    }

    // VENTANAS Y PUERTAS: vano Overall* (matriz B)
    if (typeUpper.includes('WINDOW') || typeUpper.includes('DOOR')) {
      const opening = resolveOpeningAreaM2(baseQuantities);
      if (opening.value > 0) return opening.value;
      return finalQuantity;
    }

    // LOSAS (IfcSlab): Área de la losa
    if (typeUpper.includes('SLAB')) {
      if (unitUpper === 'NM2') {
        return baseQuantities.NetArea?.value || 
               baseQuantities.Area?.value || 
               finalQuantity;
      } else if (unitUpper === 'BRM2') {
        return baseQuantities.GrossArea?.value || 
               baseQuantities.Area?.value || 
               finalQuantity;
      } else {
        return baseQuantities.NetArea?.value || 
               baseQuantities.Area?.value || 
               baseQuantities.GrossArea?.value || 
               finalQuantity;
      }
    }

    // TECHOS (IfcRoof): Similar a losas
    if (typeUpper.includes('ROOF')) {
      if (unitUpper === 'NM2') {
        return baseQuantities.NetArea?.value || 
               baseQuantities.Area?.value || 
               finalQuantity;
      } else if (unitUpper === 'BRM2') {
        return baseQuantities.GrossArea?.value || 
               baseQuantities.Area?.value || 
               finalQuantity;
      } else {
        return baseQuantities.NetArea?.value || 
               baseQuantities.Area?.value || 
               baseQuantities.GrossArea?.value || 
               finalQuantity;
      }
    }

    // REVESTIMIENTOS (IfcCovering): Área del revestimiento
    if (typeUpper.includes('COVERING')) {
      if (unitUpper === 'NM2') {
        return baseQuantities.NetArea?.value || 
               baseQuantities.Area?.value || 
               finalQuantity;
      } else if (unitUpper === 'BRM2') {
        return baseQuantities.GrossArea?.value || 
               baseQuantities.Area?.value || 
               finalQuantity;
      } else {
        return baseQuantities.NetArea?.value || 
               baseQuantities.Area?.value || 
               baseQuantities.GrossArea?.value || 
               finalQuantity;
      }
    }

    // Para otros tipos de elementos con área, usar lógica genérica
    if (unitUpper === 'NM2') {
      return baseQuantities.NetArea?.value || 
             baseQuantities.NetSideArea?.value || 
             baseQuantities.Area?.value || 
             finalQuantity;
    } else if (unitUpper === 'BRM2') {
      return baseQuantities.GrossArea?.value || 
             baseQuantities.GrossSideArea?.value || 
             baseQuantities.Area?.value || 
             finalQuantity;
    } else {
      return baseQuantities.NetArea?.value || 
             baseQuantities.NetSideArea?.value || 
             baseQuantities.GrossArea?.value || 
             baseQuantities.GrossSideArea?.value || 
             baseQuantities.Area?.value || 
             finalQuantity;
    }
  }

  // ===== VOLUMEN (M3, RM3, NM3) =====
  if (unitUpper === 'M3' || unitUpper === 'RM3' || unitUpper === 'NM3') {
    if (typeUpper.includes('WALL')) {
      if (unitUpper === 'NM3') {
        return baseQuantities.NetVolume?.value ||
          resolveWallReliableVolume(baseQuantities).value ||
          finalQuantity;
      }
      const wallVol = resolveWallReliableVolume(baseQuantities);
      if (wallVol.value > 0) return wallVol.value;
    }

    const hollowVol = getReliableStructuralVolume(baseQuantities, ifcType);
    if (unitUpper === 'NM3') {
      return baseQuantities.NetVolume?.value ||
             hollowVol ||
             baseQuantities.Volume?.value ||
             finalQuantity;
    } else if (unitUpper === 'RM3') {
      // RM3 = gross when trustworthy; hollow profiles still prefer net policy for M3 path
      return baseQuantities.GrossVolume?.value ||
             baseQuantities.Volume?.value ||
             finalQuantity;
    } else {
      return hollowVol ||
             baseQuantities.NetVolume?.value ||
             baseQuantities.Volume?.value ||
             baseQuantities.GrossVolume?.value ||
             finalQuantity;
    }
  }

  // ===== LONGITUD (JM, M) =====
  if (unitUpper === 'JM' || unitUpper === 'M') {
    if (isOnteloElementName(elementName)) {
      const span = getOnteloSpanM(elementName, baseQuantities, 0);
      if (span > 0) return span;
    }
    const jmQuantity = calculatePerimeter();
    return jmQuantity > 0 ? jmQuantity : finalQuantity;
  }

  // ===== PESO (KG) =====
  if (unitUpper === 'KG') {
    // Paso 1: peso directo del IFC (más fiable)
    const directWeight = baseQuantities.Weight?.value;
    if (directWeight !== undefined && directWeight !== null && directWeight > 0) {
      return directWeight;
    }

    const desc = (filteredCode as any)?.description ?? '';
    const volume = baseQuantities.NetVolume?.value || baseQuantities.GrossVolume?.value || 0;
    const area =
      baseQuantities.NetSideArea?.value ||
      baseQuantities.GrossSideArea?.value ||
      baseQuantities.NetArea?.value ||
      baseQuantities.GrossArea?.value ||
      baseQuantities.Area?.value ||
      0;

    // Paso 2: ratio explícito embebido en la descripción ("60 kg/m3", "8,5 kg/m2")
    const explicit = parseExplicitRebarRatio(desc);
    if (explicit) {
      if (explicit.per === 'm3' && volume > 0) return volume * explicit.ratio;
      if (explicit.per === 'm2' && area > 0)   return area * explicit.ratio;
      // Si no hay la magnitud base correspondiente, continuamos al paso 3
    }

    const kind = classifyKgCode(desc);
    const rebarRatio = getDefaultRebarRatio(ifcType);

    // Paso 3: acero estructural — usar densidad real del acero
    if (kind === 'structural-steel' && (isSteelIfcType(ifcType) || volume > 0)) {
      if (volume > 0) return volume * 7850;
      return 0;
    }

    // Paso 4: armadura de concreto — volumen del elemento × ratio kg/m³ por tipo
    if (kind === 'rebar' || kind === 'connection-steel') {
      const multiplier = kind === 'connection-steel' ? 0.20 : 1.0;
      if (volume > 0) return volume * rebarRatio * multiplier;
      // Fallback área: armadura de malla (~8 kg/m²) o el ratio explícito si aplica
      if (area > 0) return area * 8 * multiplier;
      return 0;
    }

    // Paso 5: fallback — ratio de armadura (más conservador que 7850 para concreto)
    if (volume > 0) return volume * rebarRatio;
    return 0;
  }

  // ===== PIEZAS (KPL, ERÄ) =====
  if (unitUpper === 'KPL' || unitUpper === 'ERÄ') {
    return 1;
  }

  // Fallback: retornar cantidad final si no se reconoce la unidad
  return finalQuantity;
} 
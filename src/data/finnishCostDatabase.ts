import { CostData } from '../types/cost';
import { STATFIN_COST_INDEX_CONFIG, getUpdateFactor } from './statfinCostIndexConfig';

// Fuentes de datos de costos finlandeses
export const FINNISH_COST_SOURCES = {
    name: 'Finnish Construction Cost Database',
    version: '2024.1',
    license: 'MIT',
    lastUpdate: '2024-03',
    references: {
        labor: 'Statistics Finland - Construction Labor Costs 2024',
        material: 'RT Construction Material Price Index 2024',
        equipment: 'Finnish Construction Equipment Association Rates 2024'
    }
};

// Factores de ajuste regional
export const REGIONAL_FACTORS = {
    helsinki: 1.15,
    espoo: 1.12,
    vantaa: 1.10,
    tampere: 1.05,
    turku: 1.05,
    oulu: 1.00,
    jyvaskyla: 0.95,
    kuopio: 0.95,
    lahti: 0.95,
    pori: 0.90
};

// Factores por tipo de edificio
export const BUILDING_TYPE_FACTORS = {
    residential: 1.0,
    commercial: 1.1,
    industrial: 0.9,
    public: 1.05,
    default: 1.0
};

// Factores de transporte
export const TRANSPORT_FACTORS = {
    truck: 1.0,
    train: 0.8,
    ship: 0.7,
    none: 0.0,
    default: 1.0
};

// Base de datos de costos
export const FINNISH_COSTS: Record<string, CostData> = {
    // 1 Maa- ja pohjarakennus (Earth and Foundation Work)
    '11': {
        name: {
            fi: 'Maankaivuu',
            en: 'Excavation Work'
        },
        source: {
            name: 'RT Database',
            version: '2024',
            date: '2024-Q1',
            license: 'RT Public License',
            references: ['RT 18-11278', 'TES 2024', 'Kone 2024']
        },
        talo2000: {
            code: '11',
            category: 'Earth Works'
        },
        costs: {
            material: { 
                value: 0, 
                unit: 'EUR/m³',
                reference: 'RT Public Index 2024'
            },
            labor: { 
                value: 12.5, 
                unit: 'EUR/m³',
                reference: 'TES 2024'
            },
            equipment: { 
                value: 8.5, 
                unit: 'EUR/m³',
                reference: 'Kone 2024'
            },
            overhead: { 
                value: 15, 
                unit: '%',
                reference: 'Industry Standard'
            }
        },
        properties: {
            mainUnit: 'm³',
            alternativeUnits: ['m²'],
            typicalQuantities: {
                small: 100,
                medium: 500,
                large: 2000
            }
        }
    },
    '12': {
        name: {
            fi: 'Perustukset',
            en: 'Foundation Work'
        },
        source: {
            name: 'RT Database',
            version: '2024',
            date: '2024-Q1',
            license: 'RT Public License',
            references: ['RT 18-11284', 'TES 2024', 'Kone 2024']
        },
        talo2000: {
            code: '12',
            category: 'Foundations'
        },
        costs: {
            material: { 
                value: 145, 
                unit: 'EUR/m³',
                reference: 'RT Public Index 2024'
            },
            labor: { 
                value: 85, 
                unit: 'EUR/m³',
                reference: 'TES 2024'
            },
            equipment: { 
                value: 25, 
                unit: 'EUR/m³',
                reference: 'Kone 2024'
            },
            overhead: { 
                value: 18, 
                unit: '%',
                reference: 'Industry Standard'
            }
        },
        properties: {
            mainUnit: 'm³',
            alternativeUnits: ['m²', 'jm'],
            typicalQuantities: {
                small: 20,
                medium: 100,
                large: 400
            }
        }
    },

    // 2 Runkorakenteet (Frame Structures)
    '21': {
        name: {
            fi: 'Betonirungot',
            en: 'Concrete Frame'
        },
        source: {
            name: 'RT Database',
            version: '2024',
            date: '2024-Q1',
            license: 'RT Public License',
            references: ['RT 18-11286', 'TES 2024', 'Kone 2024']
        },
        talo2000: {
            code: '21',
            category: 'Frame Structures'
        },
        costs: {
            material: { 
                value: 280, 
                unit: 'EUR/m³',
                reference: 'RT Public Index 2024'
            },
            labor: { 
                value: 95, 
                unit: 'EUR/m³',
                reference: 'TES 2024'
            },
            equipment: { 
                value: 45, 
                unit: 'EUR/m³',
                reference: 'Kone 2024'
            },
            overhead: { 
                value: 20, 
                unit: '%',
                reference: 'Industry Standard'
            }
        },
        properties: {
            mainUnit: 'm³',
            alternativeUnits: ['m²'],
            typicalQuantities: {
                small: 50,
                medium: 250,
                large: 1000
            }
        }
    },

    // 3 Täydentävät rakenteet (Complementary Structures)
    '32': {
        name: {
            fi: 'Ikkunat',
            en: 'Windows'
        },
        source: {
            name: 'RT Database',
            version: '2024',
            date: '2024-Q1',
            license: 'RT Public License',
            references: ['RT 18-11290', 'TES 2024', 'Kone 2024']
        },
        talo2000: {
            code: '32',
            category: 'Windows and Doors'
        },
        costs: {
            material: { 
                value: 350, 
                unit: 'EUR/kpl',
                reference: 'RT Public Index 2024'
            },
            labor: { 
                value: 85, 
                unit: 'EUR/kpl',
                reference: 'TES 2024'
            },
            equipment: { 
                value: 15, 
                unit: 'EUR/kpl',
                reference: 'Kone 2024'
            },
            overhead: { 
                value: 22, 
                unit: '%',
                reference: 'Industry Standard'
            }
        },
        properties: {
            mainUnit: 'kpl',
            alternativeUnits: ['m²'],
            typicalQuantities: {
                small: 10,
                medium: 50,
                large: 200
            }
        }
    },

    // 4 Pintarakenteet (Surface Structures)
    '41': {
        name: {
            fi: 'Sisäseinien pintarakenteet',
            en: 'Interior Wall Surfaces'
        },
        source: {
            name: 'RT Database',
            version: '2024',
            date: '2024-Q1',
            license: 'RT Public License',
            references: ['RT 18-11292', 'TES 2024', 'Kone 2024']
        },
        talo2000: {
            code: '41',
            category: 'Surface Structures'
        },
        costs: {
            material: { 
                value: 18, 
                unit: 'EUR/m²',
                reference: 'RT Public Index 2024'
            },
            labor: { 
                value: 22, 
                unit: 'EUR/m²',
                reference: 'TES 2024'
            },
            equipment: { 
                value: 2, 
                unit: 'EUR/m²',
                reference: 'Kone 2024'
            },
            overhead: { 
                value: 15, 
                unit: '%',
                reference: 'Industry Standard'
            }
        },
        properties: {
            mainUnit: 'm²',
            alternativeUnits: [],
            typicalQuantities: {
                small: 100,
                medium: 500,
                large: 2000
            }
        }
    },

    // 5 Talotekniikka (Building Services)
    '51': {
        name: {
            fi: 'LVI-järjestelmät',
            en: 'HVAC Systems'
        },
        source: {
            name: 'RT Database',
            version: '2024',
            date: '2024-Q1',
            license: 'RT Public License',
            references: ['RT 18-11294', 'TES 2024', 'Kone 2024']
        },
        talo2000: {
            code: '51',
            category: 'Building Services'
        },
        costs: {
            material: { 
                value: 85, 
                unit: 'EUR/m²',
                reference: 'RT Public Index 2024'
            },
            labor: { 
                value: 65, 
                unit: 'EUR/m²',
                reference: 'TES 2024'
            },
            equipment: { 
                value: 10, 
                unit: 'EUR/m²',
                reference: 'Kone 2024'
            },
            overhead: { 
                value: 25, 
                unit: '%',
                reference: 'Industry Standard'
            }
        },
        properties: {
            mainUnit: 'm²',
            alternativeUnits: ['brm²'],
            typicalQuantities: {
                small: 100,
                medium: 1000,
                large: 5000
            }
        }
    },

    // 6 Kalusteet ja varusteet (Furniture and Equipment)
    '61': {
        name: {
            fi: 'Kalusteet',
            en: 'Fixed Furniture'
        },
        source: {
            name: 'RT Database',
            version: '2024',
            date: '2024-Q1',
            license: 'RT Public License',
            references: ['RT 18-11296', 'TES 2024', 'Kone 2024']
        },
        talo2000: {
            code: '61',
            category: 'Furniture'
        },
        costs: {
            material: { 
                value: 220, 
                unit: 'EUR/jm',
                reference: 'RT Public Index 2024'
            },
            labor: { 
                value: 45, 
                unit: 'EUR/jm',
                reference: 'TES 2024'
            },
            equipment: { 
                value: 5, 
                unit: 'EUR/jm',
                reference: 'Kone 2024'
            },
            overhead: { 
                value: 20, 
                unit: '%',
                reference: 'Industry Standard'
            }
        },
        properties: {
            mainUnit: 'jm',
            alternativeUnits: ['kpl'],
            typicalQuantities: {
                small: 10,
                medium: 50,
                large: 200
            }
        }
    },

    // 7 Rakennuksen tekniset järjestelmät (Building Technical Systems)
    '71': {
        name: {
            fi: 'Sähköjärjestelmät',
            en: 'Electrical Systems'
        },
        source: {
            name: 'RT Database',
            version: '2024',
            date: '2024-Q1',
            license: 'RT Public License',
            references: ['RT 18-11298', 'TES 2024', 'Kone 2024']
        },
        talo2000: {
            code: '71',
            category: 'Technical Systems'
        },
        costs: {
            material: { 
                value: 45, 
                unit: 'EUR/m²',
                reference: 'RT Public Index 2024'
            },
            labor: { 
                value: 38, 
                unit: 'EUR/m²',
                reference: 'TES 2024'
            },
            equipment: { 
                value: 5, 
                unit: 'EUR/m²',
                reference: 'Kone 2024'
            },
            overhead: { 
                value: 22, 
                unit: '%',
                reference: 'Industry Standard'
            }
        },
        properties: {
            mainUnit: 'm²',
            alternativeUnits: ['brm²'],
            typicalQuantities: {
                small: 100,
                medium: 1000,
                large: 5000
            }
        }
    }
};

/** FINNISH_COSTS con factores StatFin aplicados (base 2024 × índice actual). */
export const ADJUSTED_FINNISH_COSTS: Record<string, CostData> = (() => {
  const adj: Record<string, CostData> = {};
  const matF = getUpdateFactor(STATFIN_COST_INDEX_CONFIG.byInputHeading.material);
  const labF = getUpdateFactor(STATFIN_COST_INDEX_CONFIG.byInputHeading.labor);
  const srvF = getUpdateFactor(STATFIN_COST_INDEX_CONFIG.byInputHeading.services);
  for (const [k, v] of Object.entries(FINNISH_COSTS)) {
    adj[k] = {
      ...v,
      costs: {
        material: { ...v.costs.material, value: v.costs.material.value * matF },
        labor: { ...v.costs.labor, value: v.costs.labor.value * labF },
        equipment: { ...v.costs.equipment, value: v.costs.equipment.value * srvF },
        overhead: { ...v.costs.overhead, value: v.costs.overhead.value * srvF },
      },
    };
  }
  return adj;
})(); 
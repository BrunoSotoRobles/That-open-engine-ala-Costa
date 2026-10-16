import { RTKorttiDetails, CostData } from '../types/cost';
import { STATFIN_COST_INDEX_CONFIG, getUpdateFactor } from './statfinCostIndexConfig';

/**
 * @deprecated Use RTKorttiDetails directly. This interface is now redundant as all its fields
 * have been moved to RTKorttiDetails.
 */
export interface UnifiedRTKortti extends RTKorttiDetails {}

export const UNIFIED_RT_DATABASE: { [key: string]: RTKorttiDetails } = {
  // Väliseinät (VS)
  'VS-1': {
    code: '82-10902',
    name: {
      fi: 'Kipsilevyseinä',
      en: 'Gypsum wall'
    },
    materials: ['kipsilevy 13mm x2', 'teräsranka 66mm', 'mineraalivilla 50mm'],
    workPhases: ['rankojen asennus', 'eristys', 'levytys'],
    requirements: 'Ääneneristys: R\'w 42 dB',
    technicalDetails: {
      fireRating: 'EI30',
      acousticRating: '42dB',
      thermalTransmittance: 0.66,
      loadBearing: false,
      thickness: 92,
      weight: 25
    },
    maintenance: {
      inspectionInterval: 12,
      maintenanceInterval: 60,
      estimatedLifespan: 40,
      tasks: [
        {
          type: 'inspection',
          description: {
            fi: 'Silmämääräinen tarkastus',
            en: 'Visual inspection'
          },
          interval: 12,
          estimatedCost: 0
        }
      ]
    },
    applicableIfcTypes: ['IfcWall', 'IfcWallStandardCase'],
    defaultCosts: {
      material: 45,
      labor: 35,
      subcontract: 20,
      total: 100
    }
  },

  // Ikkunat (IK)
  'IK-1': {
    code: '82-11301',
    name: {
      fi: '3-lasinen ikkuna',
      en: 'Triple-glazed window'
    },
    materials: ['3-lasinen ikkuna', 'karmi', 'vesipelti', 'tiivisteet'],
    workPhases: ['karmin asennus', 'ikkunan asennus', 'tiivistys', 'listoitus'],
    requirements: 'U-arvo ≤ 1.0 W/m²K, ääneneristys 32dB',
    measurementUnit: 'kpl',
    technicalDetails: {
      fireRating: 'EI15',
      acousticRating: '32dB',
      thermalTransmittance: 1.0,
      thickness: 130,
      weight: 40
    },
    maintenance: {
      inspectionInterval: 12,
      maintenanceInterval: 24,
      estimatedLifespan: 30,
      tasks: [
        {
          type: 'inspection',
          description: {
            fi: 'Tiivisteiden ja helojen tarkastus',
            en: 'Inspection of seals and hardware'
          },
          interval: 12,
          estimatedCost: 0
        },
        {
          type: 'maintenance',
          description: {
            fi: 'Tiivisteiden vaihto',
            en: 'Seal replacement'
          },
          interval: 24,
          estimatedCost: 15
        }
      ]
    },
    defaultCosts: {
      material: 450,
      labor: 120,
      subcontract: 120,
      total: 690
    },
    applicableIfcTypes: ['IfcWindow']
  },

  // Ulkoseinät (US)
  'US-1': {
    code: '82-11006',
    name: {
      fi: 'Ulkoseinä, puurunko',
      en: 'External wall, wooden frame'
    },
    materials: ['lämmöneriste 200mm', 'tuulensuojalevy', 'ilmarako 30mm', 'julkisivuverhous'],
    workPhases: ['elementtiasennus', 'eristys', 'verhous'],
    requirements: 'U-arvo: 0.17 W/m²K',
    measurementUnit: 'm²',
    technicalDetails: {
      fireRating: 'REI30',
      acousticRating: '48dB',
      thermalTransmittance: 0.17,
      loadBearing: true,
      thickness: 280,
      weight: 85
    },
    maintenance: {
      inspectionInterval: 24,
      maintenanceInterval: 120,
      estimatedLifespan: 50,
      tasks: [
        {
          type: 'inspection',
          description: {
            fi: 'Julkisivun kuntotarkastus',
            en: 'Facade condition inspection'
          },
          interval: 24,
          estimatedCost: 0
        }
      ]
    },
    defaultCosts: {
      material: 145,
      labor: 65,
      subcontract: 60,
      total: 270
    },
    applicableIfcTypes: ['IfcWall', 'IfcWallStandardCase']
  },

  // Maanrakennus (MR)
  'MR-1': {
    code: '81-11001',
    name: {
      fi: 'Salaojitus ja kapillaarikatko',
      en: 'Drainage and capillary break'
    },
    materials: ['murske 0-32mm', 'suodatinkangas N3'],
    workPhases: ['pohjan tasaus', 'suodatinkankaan asennus', 'murskeen levitys', 'tiivistys'],
    requirements: 'InfraRYL 2010, E2 > 90MPa',
    measurementUnit: 'm²',
    technicalDetails: {
      loadBearing: true,
      thickness: 300,
      weight: 600
    },
    maintenance: {
      inspectionInterval: 60,
      maintenanceInterval: 120,
      estimatedLifespan: 50,
      tasks: [
        {
          type: 'inspection',
          description: {
            fi: 'Salaojien toiminnan tarkastus',
            en: 'Drainage system inspection'
          },
          interval: 60,
          estimatedCost: 0
        }
      ]
    },
    defaultCosts: {
      material: 25,
      labor: 15,
      subcontract: 15,
      total: 55
    },
    applicableIfcTypes: ['IfcSlab', 'IfcFooting']
  },

  // Perustukset (AP, PE)
  'AP-1': {
    code: '83-11093',
    name: {
      fi: 'Maanvarainen alapohja',
      en: 'Ground-supported base floor'
    },
    materials: ['betoni C25/30', 'raudoitus A500HW', 'eriste EPS 100mm'],
    workPhases: ['eristys', 'raudoitus', 'betonointi', 'hierto'],
    requirements: 'BY45, U-arvo ≤ 0.16 W/m²K',
    measurementUnit: 'm²',
    technicalDetails: {
      fireRating: 'REI60',
      thermalTransmittance: 0.16,
      loadBearing: true,
      thickness: 300,
      weight: 750
    },
    maintenance: {
      inspectionInterval: 60,
      maintenanceInterval: 240,
      estimatedLifespan: 100,
      tasks: [
        {
          type: 'inspection',
          description: {
            fi: 'Halkeamien ja painumien tarkastus',
            en: 'Crack and settlement inspection'
          },
          interval: 60,
          estimatedCost: 0
        }
      ]
    },
    defaultCosts: {
      material: 85,
      labor: 45,
      subcontract: 37,
      total: 167
    },
    applicableIfcTypes: ['IfcSlab']
  },

  // Kantavat seinät (KS)
  'KS-1': {
    code: '82-11093',
    name: {
      fi: 'Kantava betoniseinä',
      en: 'Load-bearing concrete wall'
    },
    materials: ['betoni C30/37', 'raudoitus B500B', 'muottilevy'],
    workPhases: ['muottityö', 'raudoitus', 'betonointi'],
    requirements: 'BY45, luokka A',
    measurementUnit: 'm²',
    technicalDetails: {
      fireRating: 'REI120',
      acousticRating: '55dB',
      loadBearing: true,
      thickness: 200,
      weight: 500
    },
    maintenance: {
      inspectionInterval: 60,
      maintenanceInterval: 240,
      estimatedLifespan: 100,
      tasks: [
        {
          type: 'inspection',
          description: {
            fi: 'Rakenteellinen tarkastus',
            en: 'Structural inspection'
          },
          interval: 60,
          estimatedCost: 0
        }
      ]
    },
    defaultCosts: {
      material: 95,
      labor: 55,
      subcontract: 45,
      total: 195
    },
    applicableIfcTypes: ['IfcWall', 'IfcWallStandardCase']
  },

  // Välipohjat (VP)
  'VP-1': {
    code: '83-11102',
    name: {
      fi: 'Ontelolaattavälipohja',
      en: 'Hollow-core slab intermediate floor'
    },
    materials: ['ontelolaatta 265mm', 'pintabetoni 60mm', 'raudoitus B500B'],
    workPhases: ['asennus', 'raudoitus', 'pintavalu', 'hierto'],
    requirements: 'BY45, ääneneristys R\'w 53 dB',
    measurementUnit: 'm²',
    technicalDetails: {
      fireRating: 'REI60',
      acousticRating: '53dB',
      loadBearing: true,
      thickness: 325,
      weight: 380
    },
    maintenance: {
      inspectionInterval: 120,
      maintenanceInterval: 360,
      estimatedLifespan: 100,
      tasks: [
        {
          type: 'inspection',
          description: {
            fi: 'Rakenteellinen tarkastus',
            en: 'Structural inspection'
          },
          interval: 120,
          estimatedCost: 0
        }
      ]
    },
    defaultCosts: {
      material: 110,
      labor: 45,
      subcontract: 52,
      total: 207
    },
    applicableIfcTypes: ['IfcSlab']
  },

  // Yläpohjat (YP)
  'YP-1': {
    code: '83-11202',
    name: {
      fi: 'Ontelolaattayläpohja',
      en: 'Hollow-core slab roof structure'
    },
    materials: ['ontelolaatta 265mm', 'höyrynsulku', 'lämmöneriste 400mm', 'tuulensuoja'],
    workPhases: ['asennus', 'eristys', 'vedeneristys'],
    requirements: 'U-arvo ≤ 0.09 W/m²K',
    measurementUnit: 'm²',
    technicalDetails: {
      fireRating: 'REI60',
      thermalTransmittance: 0.09,
      loadBearing: true,
      thickness: 665,
      weight: 400
    },
    maintenance: {
      inspectionInterval: 24,
      maintenanceInterval: 120,
      estimatedLifespan: 50,
      tasks: [
        {
          type: 'inspection',
          description: {
            fi: 'Vesikaton kuntotarkastus',
            en: 'Roof condition inspection'
          },
          interval: 24,
          estimatedCost: 0
        },
        {
          type: 'maintenance',
          description: {
            fi: 'Vedeneristyksen uusiminen',
            en: 'Waterproofing renewal'
          },
          interval: 120,
          estimatedCost: 45
        }
      ]
    },
    defaultCosts: {
      material: 135,
      labor: 55,
      subcontract: 63,
      total: 253
    },
    applicableIfcTypes: ['IfcSlab', 'IfcRoof']
  },

  // Ovet (OV)
  'OV-1': {
    code: '82-11302',
    name: {
      fi: 'Ulko-ovi',
      en: 'External door'
    },
    materials: ['ulko-ovi', 'karmi', 'kynnys', 'tiivisteet'],
    workPhases: ['karmin asennus', 'oven asennus', 'tiivistys', 'heloitus'],
    requirements: 'U-arvo ≤ 1.0 W/m²K, murtosuojaus RC3',
    measurementUnit: 'kpl',
    technicalDetails: {
      fireRating: 'EI30',
      acousticRating: '30dB',
      thermalTransmittance: 1.0,
      thickness: 90,
      weight: 60
    },
    maintenance: {
      inspectionInterval: 12,
      maintenanceInterval: 24,
      estimatedLifespan: 25,
      tasks: [
        {
          type: 'inspection',
          description: {
            fi: 'Tiivisteiden ja lukituksen tarkastus',
            en: 'Inspection of seals and locking'
          },
          interval: 12,
          estimatedCost: 0
        },
        {
          type: 'maintenance',
          description: {
            fi: 'Tiivisteiden ja helojen huolto',
            en: 'Maintenance of seals and hardware'
          },
          interval: 24,
          estimatedCost: 25
        }
      ]
    },
    defaultCosts: {
      material: 580,
      labor: 140,
      subcontract: 145,
      total: 865
    },
    applicableIfcTypes: ['IfcDoor']
  },

  // Märkätilat (VS-märkätilat)
  'VS-5.märkätilat': {
    code: '82-10903',
    name: {
      fi: 'Märkätilan väliseinä',
      en: 'Wet room partition wall'
    },
    materials: ['märkätilalevy 13mm', 'metalliranka', 'mineraalivilla 66mm', 'vedeneriste'],
    workPhases: ['rankojen asennus', 'eristys', 'levytys', 'vedeneristys'],
    requirements: 'Vedeneristys: VTT-sertifikaatti',
    measurementUnit: 'm²',
    technicalDetails: {
      fireRating: 'EI30',
      acousticRating: '44dB',
      loadBearing: false,
      thickness: 92,
      weight: 32
    },
    maintenance: {
      inspectionInterval: 12,
      maintenanceInterval: 60,
      estimatedLifespan: 25,
      tasks: [
        {
          type: 'inspection',
          description: {
            fi: 'Vedeneristyksen tarkastus',
            en: 'Waterproofing inspection'
          },
          interval: 12,
          estimatedCost: 0
        },
        {
          type: 'maintenance',
          description: {
            fi: 'Silikonisaumojen uusiminen',
            en: 'Silicone joint renewal'
          },
          interval: 60,
          estimatedCost: 15
        }
      ]
    },
    defaultCosts: {
      material: 65,
      labor: 45,
      subcontract: 26,
      total: 136
    },
    applicableIfcTypes: ['IfcWall', 'IfcWallStandardCase']
  },

  // Perustukset (PE)
  'PE-1': {
    code: '81-11093',
    name: {
      fi: 'Perusmuuri',
      en: 'Foundation wall'
    },
    materials: ['betoni C25/30', 'raudoitus A500HW', 'muottilevy'],
    workPhases: ['pohjatyöt', 'muottityö', 'raudoitus', 'betonointi', 'jälkihoito'],
    requirements: 'BY45, routasuojaus RakMK C2',
    measurementUnit: 'm³',
    technicalDetails: {
      fireRating: 'REI120',
      loadBearing: true,
      thickness: 300,
      weight: 2500
    },
    maintenance: {
      inspectionInterval: 60,
      maintenanceInterval: 240,
      estimatedLifespan: 100,
      tasks: [
        {
          type: 'inspection',
          description: {
            fi: 'Halkeamien ja vaurioiden tarkastus',
            en: 'Crack and damage inspection'
          },
          interval: 60,
          estimatedCost: 0
        }
      ]
    },
    defaultCosts: {
      material: 110,
      labor: 65,
      subcontract: 55,
      total: 230
    },
    applicableIfcTypes: ['IfcWall', 'IfcFooting']
  }
};

/** Factores StatFin por partida (material, labor, services para equipment/overhead). */
const matF = getUpdateFactor(STATFIN_COST_INDEX_CONFIG.byInputHeading.material);
const labF = getUpdateFactor(STATFIN_COST_INDEX_CONFIG.byInputHeading.labor);
const srvF = getUpdateFactor(STATFIN_COST_INDEX_CONFIG.byInputHeading.services);

/** UNIFIED_RT_DATABASE con costes ajustados por índices StatFin (base 2024 × índice actual). */
export const ADJUSTED_UNIFIED_RT_DATABASE: { [key: string]: RTKorttiDetails } = (() => {
  const adj: { [key: string]: RTKorttiDetails } = {};
  for (const [k, v] of Object.entries(UNIFIED_RT_DATABASE)) {
    const dc = v.defaultCosts;
    if (!dc) {
      adj[k] = v;
      continue;
    }
    const material = dc.material * matF;
    const labor = dc.labor * labF;
    const subcontract = (dc.subcontract ?? 0) * srvF;
    adj[k] = {
      ...v,
      defaultCosts: {
        material,
        labor,
        subcontract,
        total: material + labor + subcontract,
      },
    };
  }
  return adj;
})();

/**
 * Busca un RT-kortti por nombre y código opcional (devuelve entrada con costes ajustados).
 */
export function findRTKortti(name: string, code?: string): RTKorttiDetails | null {
  if (ADJUSTED_UNIFIED_RT_DATABASE[name]) {
    return ADJUSTED_UNIFIED_RT_DATABASE[name];
  }
  if (code) {
    const found = Object.values(ADJUSTED_UNIFIED_RT_DATABASE).find(rt => rt.code === code);
    if (found) return found;
  }
  const typePrefix = name.split('.')[0];
  const possibleMatches = Object.entries(ADJUSTED_UNIFIED_RT_DATABASE)
    .filter(([key]) => key.startsWith(typePrefix));
  return possibleMatches.length > 0 ? possibleMatches[0][1] : null;
} 
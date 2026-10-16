/**
 * Sample cost data for a typical hall project (logistics / sports / retail):
 * sandwich panels, precast sokkelit, ground slab, load-bearing elements, roof, windows.
 * Used to contrast with docs/LITTERA_FINNISH_CONTEXT_AND_SYSTEM.md without affecting
 * the default residential sample or current app behaviour.
 */

import type { BaseCostElement, BaseProjectInfo } from '../../types/cost';

export const sampleHallProjectInfo: BaseProjectInfo = {
  name: 'Sample Hall (logistics / retail)',
  area: 2500,
  huoneistoala: 2000,
  cost: 1200000,
  type: 'commercial' as const,
  location: 'Helsinki',
  description: 'Hall with sandwich panels and precast sokkelit – typology for contrast with Littera doc',
  buildingType: 'Industrial / Hall',
  constructionMethod: 'Prefabricated'
};

export const sampleHallCostElements: BaseCostElement[] = [
  {
    id: 101,
    quantity: 1,
    name: 'Sokkelielementti (kantava) AS d=200 mm',
    type: 'IfcWall',
    taloCode: '1212',
    taloName: 'Perusmuurit, peruspilarit ja peruspalkit',
    baseQuantities: {
      'Net Wall Area': { value: 320, unit: 'm²' },
      'Gross Wall Area': { value: 320, unit: 'm²' }
    },
    costs: {
      material: 0,
      labor: 0,
      subcontract: 0,
      total: 0
    },
    litteraCodes: [
      {
        litteraCode: '3152040',
        litteraName: 'sokkelielementti (kantava) AS d=xxx mm, xx kpl, xx brm2',
        unit: 'M2',
        quantity: 320
      },
      {
        litteraCode: '3155005',
        litteraName: 'sokkelielementti AS,AN asennus',
        unit: 'KPL',
        quantity: 40
      },
      {
        litteraCode: '3156015',
        litteraName: 'sokkelielementtien vaakasaumaus',
        unit: 'JM',
        quantity: 200
      }
    ],
    isExpanded: false
  },
  {
    id: 102,
    quantity: 1,
    name: 'Sandwich-ulkoseinäelementti, toimitus ja asennus',
    type: 'IfcWall',
    taloCode: '1241',
    taloName: 'Ulkoseinät',
    baseQuantities: {
      'Net Wall Area': { value: 1200, unit: 'm²' }
    },
    costs: {
      material: 0,
      labor: 0,
      subcontract: 0,
      total: 0
    },
    litteraCodes: [
      {
        litteraCode: '3152240',
        litteraName: 'sandwich ulkoseinäelementti (kantava) S, d=xxx mm, xx kpl, xx brm2',
        unit: 'M2',
        quantity: 1200
      },
      {
        litteraCode: '3156030',
        litteraName: 'sandwich-elementtien vaakasaumaus',
        unit: 'JM',
        quantity: 400
      }
    ],
    isExpanded: false
  },
  {
    id: 103,
    quantity: 1,
    name: 'Alapohjalaatta (autohalli), paikallavalu',
    type: 'IfcSlab',
    taloCode: '1221',
    taloName: 'Alapohjalaatat',
    baseQuantities: {
      'Floor Area': { value: 2500, unit: 'm²' },
      'Concrete Volume': { value: 375, unit: 'm³' }
    },
    costs: {
      material: 0,
      labor: 0,
      subcontract: 0,
      total: 0
    },
    litteraCodes: [
      {
        litteraCode: '231110',
        litteraName: 'ap-laatan alapinnan muottityö + muottien purku ja puhdistus',
        unit: 'M2',
        quantity: 2500
      },
      {
        litteraCode: '232250',
        litteraName: 'betonointi C30/37, XC2',
        unit: 'M3',
        quantity: 375
      }
    ],
    isExpanded: false
  },
  {
    id: 104,
    quantity: 1,
    name: 'Kantavat seinäelementit, betonielementti',
    type: 'IfcWall',
    taloCode: '1232',
    taloName: 'Kantavat seinät',
    baseQuantities: {
      'Net Wall Area': { value: 180, unit: 'm²' }
    },
    costs: {
      material: 0,
      labor: 0,
      subcontract: 0,
      total: 0
    },
    isExpanded: false
  },
  {
    id: 105,
    quantity: 1,
    name: 'Vesikattorakenteet, kate ja eriste',
    type: 'IfcRoof',
    taloCode: '1261',
    taloName: 'Vesikattorakenteet',
    baseQuantities: {
      'Roof Area': { value: 2500, unit: 'm²' }
    },
    costs: {
      material: 0,
      labor: 0,
      subcontract: 0,
      total: 0
    },
    isExpanded: false
  },
  {
    id: 106,
    quantity: 1,
    name: 'Ikkunat, toimitus ja asennus',
    type: 'IfcWindow',
    taloCode: '1242',
    taloName: 'Ikkunat',
    baseQuantities: {
      'Window Count': { value: 24, unit: 'pcs' },
      'Window Area': { value: 72, unit: 'm²' }
    },
    costs: {
      material: 0,
      labor: 0,
      subcontract: 0,
      total: 0
    },
    litteraCodes: [
      {
        litteraCode: '413340',
        litteraName: 'metalli-ikkunat',
        unit: 'M2',
        quantity: 72
      }
    ],
    isExpanded: false
  },
  {
    id: 107,
    quantity: 1,
    name: 'Kevyt väliseinä, runko ja levytys',
    type: 'IfcWall',
    taloCode: '1311',
    taloName: 'Väliseinät',
    baseQuantities: {
      'Wall Area': { value: 240, unit: 'm²' }
    },
    costs: {
      material: 0,
      labor: 0,
      subcontract: 0,
      total: 0
    },
    isExpanded: false
  },
  {
    id: 108,
    quantity: 1,
    name: 'Metalliulko-ovet, toimitus ja asennus',
    type: 'IfcDoor',
    taloCode: '1315',
    taloName: 'Väliovet',
    baseQuantities: {
      'Door Count': { value: 12, unit: 'pcs' }
    },
    costs: {
      material: 0,
      labor: 0,
      subcontract: 0,
      total: 0
    },
    litteraCodes: [
      {
        litteraCode: '433015',
        litteraName: 'metalliulko-ovi TUO 10+3x21-23',
        unit: 'KPL',
        quantity: 12
      }
    ],
    isExpanded: false
  },
  {
    id: 109,
    quantity: 1,
    name: 'Teräspilarit ja -palkit, kantava runko',
    type: 'IfcColumn',
    taloCode: '1233',
    taloName: 'Pilarit',
    baseQuantities: {
      'Column Count': { value: 30, unit: 'pcs' }
    },
    costs: {
      material: 0,
      labor: 0,
      subcontract: 0,
      total: 0
    },
    isExpanded: false
  }
];

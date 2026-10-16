import { BaseCostElement, BaseProjectInfo } from '../../types/cost';

export const sampleProjectInfo: BaseProjectInfo = {
  name: "Sample Residential Building",
  area: 1500,
  cost: 2500000,
  type: "residential" as const,
  location: "Helsinki",
  description: "5-story residential building with 20 apartments",
  buildingType: "Residential",
  constructionMethod: "OnSite"
};

export const sampleCostElements: BaseCostElement[] = [
  {
    id: 1,
    quantity: 1,
    name: "Puurunkoinen kipsilevyseinä 97 mm, eristetty, kantava seinä",
    type: "2000 Building Elements",
    taloCode: "1232",
    taloName: "External Wall Elements",
    baseQuantities: {
      "Net Wall Area": {
        value: 450.5,
        unit: "m²"
      }
    },
    costs: {
      material: 67575.00,
      labor: 31535.00,
      subcontract: 20272.50,
      total: 119382.50
    },
    isExpanded: false,
    subElements: [
      {
        id: 11,
        quantity: 1,
        name: "Lämmöneriste 100 mm, mineraalivilla, VS",
        type: "2000 Building Elements",
        taloCode: "1311",
        taloName: "Insulation",
        baseQuantities: {
          "Area": {
            value: 450.5,
            unit: "m²"
          }
        },
        costs: {
          material: 7.33,
          labor: 0.00,
          subcontract: 3.12,
          total: 10.45
        }
      },
      {
        id: 12,
        quantity: 1,
        name: "Puurunko 97 mm k600, kantava väliseinä",
        type: "2000 Building Elements",
        taloCode: "1232",
        taloName: "Frame",
        baseQuantities: {
          "Area": {
            value: 450.5,
            unit: "m²"
          }
        },
        costs: {
          material: 4.89,
          labor: 0.00,
          subcontract: 12.29,
          total: 17.19
        }
      }
    ]
  },
  {
    id: 2,
    quantity: 2,
    name: "Liimapuupalkki 90 x 315 mm",
    type: "2000 Building Elements",
    taloCode: "1234",
    taloName: "Beams",
    baseQuantities: {
      "Length": {
        value: 18,
        unit: "jm"
      }
    },
    costs: {
      material: 372.00,
      labor: 0.00,
      subcontract: 191.00,
      total: 563.00
    }
  },
  {
    id: 3,
    quantity: 0,
    name: "Seinälevytys, kipsilevy 13 mm, 1-kertainen levytys",
    type: "2000 Building Elements",
    taloCode: "1325",
    taloName: "Wall Panels",
    baseQuantities: {
      "Wall Area": {
        value: 180,
        unit: "m²"
      }
    },
    costs: {
      material: 4.85,
      labor: 0.00,
      subcontract: 9.30,
      total: 14.15
    }
  },
  {
    id: 4,
    quantity: 0,
    name: "Seinälevytys, kipsilevy 13 mm, 1-kertainen levytys, erikoiskova",
    type: "2000 Building Elements",
    taloCode: "1325",
    taloName: "Wall Panels",
    baseQuantities: {
      "Wall Area": {
        value: 120,
        unit: "m²"
      }
    },
    costs: {
      material: 6.39,
      labor: 0.00,
      subcontract: 9.30,
      total: 15.69
    }
  },
  {
    id: 5,
    quantity: 0,
    name: "Windows Type A",
    type: "2000 Building Elements",
    taloCode: "2430",
    taloName: "Windows",
    baseQuantities: {
      "Window Count": {
        value: 60,
        unit: "pcs"
      },
      "Window Area": {
        value: 180,
        unit: "m²"
      }
    },
    costs: {
      material: 90000.00,
      labor: 18000.00,
      subcontract: 12000.00,
      total: 120000.00
    }
  },
  {
    id: 6,
    quantity: 0,
    name: "Interior Floor Type 1",
    type: "3000 Interior Elements",
    taloCode: "3310",
    taloName: "Floor Finishes",
    baseQuantities: {
      "Floor Area": {
        value: 1200,
        unit: "m²"
      }
    },
    costs: {
      material: 72000.00,
      labor: 36000.00,
      subcontract: 24000.00,
      total: 132000.00
    }
  },
  {
    id: 7,
    quantity: 0,
    name: "HVAC System",
    type: "4000 Building Services",
    taloCode: "4100",
    taloName: "HVAC Systems",
    baseQuantities: {
      "Heated Area": {
        value: 1500,
        unit: "m²"
      }
    },
    costs: {
      material: 225000.00,
      labor: 120000.00,
      subcontract: 60000.00,
      total: 405000.00
    }
  },
  {
    id: 8,
    quantity: 0,
    name: "Foundation Type 1",
    type: "2000 Building Elements",
    taloCode: "2210",
    taloName: "Foundation Elements",
    baseQuantities: {
      "Foundation Area": {
        value: 350,
        unit: "m²"
      },
      "Concrete Volume": {
        value: 105,
        unit: "m³"
      }
    },
    costs: {
      material: 52500.00,
      labor: 31500.00,
      subcontract: 21000.00,
      total: 105000.00
    }
  }
];

export const sampleTableColumns = [
  { header: 'TALO Code', dataField: 'taloCode', width: '10%', sortable: true },
  { header: 'Element Name', dataField: 'name', width: '20%', sortable: true },
  { header: 'Material (€)', dataField: 'costs.material', width: '15%', sortable: true },
  { header: 'Labor (€)', dataField: 'costs.labor', width: '15%', sortable: true },
  { header: 'Subcontract (€)', dataField: 'costs.subcontract', width: '15%', sortable: true },
  { header: 'Total (€)', dataField: 'costs.total', width: '10%', sortable: true }
]; 
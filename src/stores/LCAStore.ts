import { create } from 'zustand';
import { MATERIAL_FACTORS, IMPACT_CATEGORIES } from '../data/emissionFactors';

export interface ProjectInfo {
  name: string;
  area: number;
  cost: number;
  description: string;
  status: string;
  progress: number;
  type: string;
  location: string;
}

interface LCAResults {
  totalVolume: number;
  impactResults: Array<{
    id: string;
    category: string;
    value: number;
    unit: string;
  }>;
  categoryTotals: Array<{
    category: string;
    volume: number;
    impacts: Array<{
      id: string;
      category: string;
      value: number;
      unit: string;
    }>;
  }>;
}

interface LCAState {
  lcaData: {
    data: any[];
    columns: any[];
  } | null;
  projectInfo: ProjectInfo | undefined;
  results: LCAResults | null;
  setLCAData: (data: { data: any[]; columns: any[] }) => void;
  setProjectInfo: (info: ProjectInfo) => void;
  calculateLCA: (materials: any[]) => void;
}

export const useLCAStore = create<LCAState>((set, get) => ({
  lcaData: null,
  projectInfo: undefined,
  results: null,
  setLCAData: (data) => set({ lcaData: data }),
  setProjectInfo: (info) => set({ projectInfo: info }),
  calculateLCA: (materials) => {
    const totals = {
      volume: 0,
      impacts: {
        gwp: 0,
        ap: 0,
        ep: 0,
        ozone: 0,
        energy: 0
      }
    };

    const categoryTotals: Record<string, any> = {};

    materials.forEach(material => {
      if (!material.isHeader) {
        const volume = parseFloat(material.value.replace(' m³', '')) || 0;
        totals.volume += volume;

        const factors = material.factors;

        if (factors) {
          totals.impacts.gwp += volume * (factors.gwp || 0);
          totals.impacts.ap += volume * (factors.ap || 0);
          totals.impacts.ep += volume * (factors.ep || 0);
          totals.impacts.ozone += volume * (factors.ozone || 0);
          totals.impacts.energy += volume * (factors.energy || 0);
        }

        if (!categoryTotals[material.ifcElement]) {
          categoryTotals[material.ifcElement] = {
            volume: 0,
            impacts: { gwp: 0, ap: 0, ep: 0, ozone: 0, energy: 0 }
          };
        }
        
        categoryTotals[material.ifcElement].volume += volume;
        if (factors) {
          categoryTotals[material.ifcElement].impacts.gwp += volume * (factors.gwp || 0);
          categoryTotals[material.ifcElement].impacts.ap += volume * (factors.ap || 0);
          categoryTotals[material.ifcElement].impacts.ep += volume * (factors.ep || 0);
          categoryTotals[material.ifcElement].impacts.ozone += volume * (factors.ozone || 0);
          categoryTotals[material.ifcElement].impacts.energy += volume * (factors.energy || 0);
        }
      }
    });

    const results: LCAResults = {
      totalVolume: totals.volume,
      impactResults: [
        { id: 'gwp', category: 'GWP', value: totals.impacts.gwp, unit: 'kg CO₂ eq' },
        { id: 'ap', category: 'AP', value: totals.impacts.ap, unit: 'kg SO₂ eq' },
        { id: 'ep', category: 'EP', value: totals.impacts.ep, unit: 'kg PO₄ eq' },
        { id: 'ozone', category: 'Ozone', value: totals.impacts.ozone, unit: 'kg CFC-11 eq' },
        { id: 'energy', category: 'Energy', value: totals.impacts.energy, unit: 'MJ' }
      ],
      categoryTotals: Object.entries(categoryTotals).map(([category, data]) => ({
        category,
        volume: data.volume,
        impacts: [
          { id: 'gwp', category: 'GWP', value: data.impacts.gwp, unit: 'kg CO₂ eq' },
          { id: 'ap', category: 'AP', value: data.impacts.ap, unit: 'kg SO₂ eq' },
          { id: 'ep', category: 'EP', value: data.impacts.ep, unit: 'kg PO₄ eq' },
          { id: 'ozone', category: 'Ozone', value: data.impacts.ozone, unit: 'kg CFC-11 eq' },
          { id: 'energy', category: 'Energy', value: data.impacts.energy, unit: 'MJ' }
        ]
      }))
    };

    set({ results });
  }
})); 
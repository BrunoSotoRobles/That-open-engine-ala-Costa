import { useCostStore } from '../stores/CostStore';
import { sampleHallProjectInfo, sampleHallCostElements } from '../data/__examples__/sampleHallCostData';
import { getPriceForLittera } from '../services/litteraPrices';
import type { BaseCostElement } from '../types/cost';

/**
 * Devuelve una copia de los elementos con costes calculados a partir de sus Littera,
 * usando los precios de src/data/littera-prices.json.
 *
 * - Suma material / labor / subcontract / total por código Littera (quantity * precio unitario).
 * - Rellena element.costs con las sumas.
 * - Opcionalmente rellena litteraCodes[].costs con el coste total por código.
 */
function withCostsFromLittera(elements: BaseCostElement[]): BaseCostElement[] {
  return elements.map((el) => {
    const litteraCodes = el.litteraCodes ?? [];

    let material = 0;
    let labor = 0;
    let subcontract = 0;
    let total = 0;

    const updatedLitteraCodes = litteraCodes.map((lc) => {
      const quantity = lc.quantity ?? 0;
      const price = getPriceForLittera(lc.litteraCode, lc.unit);

      if (!price || quantity <= 0) {
        return { ...lc };
      }

      const cMat = (price.material ?? 0) * quantity;
      const cLab = (price.labor ?? 0) * quantity;
      const cSub = (price.subcontract ?? 0) * quantity;
      const cTot = (price.total != null ? price.total : (price.material ?? 0) + (price.labor ?? 0) + (price.subcontract ?? 0)) * quantity;

      material += cMat;
      labor += cLab;
      subcontract += cSub;
      total += cTot;

      return {
        ...lc,
        costs: {
          material: cMat || undefined,
          labor: cLab || undefined,
          subcontract: cSub || undefined,
          total: cTot || undefined,
        },
      };
    });

    return {
      ...el,
      litteraCodes: updatedLitteraCodes,
      costs: {
        material,
        labor,
        subcontract,
        total,
      },
    };
  });
}

/**
 * Carga el sample principal de la app.
 * Usa la tipología hall (sandwich + sokkelit) con TALO/Littera realistas
 * y calcula los costes desde src/data/littera-prices.json para que el flujo
 * de \"Calculate Costs\" / export / librería sea igual que en un proyecto real.
 */
export function loadSampleCostData(): void {
  const setCostData = useCostStore.getState().setCostData;
  const setProjectInfo = useCostStore.getState().setProjectInfo;

  const elementsWithCosts = withCostsFromLittera(sampleHallCostElements);

  setProjectInfo(sampleHallProjectInfo);
  setCostData(elementsWithCosts);
}
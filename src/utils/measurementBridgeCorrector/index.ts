/**
 * Bridge measurement corrector v2.3 — additive, isolated, flag-gated.
 *
 * Mirrors the external layer audited in Downloads/_audit/independiente/capa_externa_v2.
 * When COSTA_MEASUREMENT_BRIDGE_CORRECTOR_V1 is false (default): zero effect.
 * When true: corrects PublishedQuantity at Send-to-Cost (store) and bridge Excel export.
 * Never mutates baseQuantities.
 */

export { COSTA_MEASUREMENT_BRIDGE_CORRECTOR_V1 } from "../measurementFeatureFlags";
export {
  classifyOpeningDimensions,
  classifyPublishedQuantity,
} from "./classify";
export type {
  BridgeClassifyResult,
  BridgeCorrectorGates,
  BridgeCorrectorOrigin,
} from "./classify";
export {
  applyBridgeCorrectorToGuidRow,
  computeBridgeCorrectorOverlay,
} from "./overlay";
export type { BridgeCorrectorOverlay } from "./overlay";
export {
  evaluatePublishedQuantityCorrection,
  readPublishedFromElement,
} from "./publishedQuantityCorrection";
export { applyBridgeCorrectorStorePass } from "./storePass";
export { bridgeFamily, buildBridgeQtoRecord } from "./record";
export type { BridgeQtoRecord } from "./record";

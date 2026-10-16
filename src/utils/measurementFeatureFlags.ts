/**
 * Reversible measurement flags — flip to false to restore prior Send behaviour.
 * Bloques 1–3, 5–7 ON. Bloque 4 re-apertura pasos 1–2 OFF; pasos 3–4 ON (activo).
 */

/** Wall: W≈L or poisoned horizontals → run×H from GrossVolume brick (+ Tekla/Dimensions width when present). */
export const COSTA_WALL_GROSS_VOLUME_BRICK_V1 = true;

/** Linear (beam/member/column/…): BQ Length mm-as-m → prefer Tekla/Dimensions length when present. */
export const COSTA_LINEAR_PROFILE_LENGTH_V1 = true;

/** Block 1 — publish only when backed; else truly empty (no unit-only block). */
export const COSTA_MEASUREMENT_RELIABILITY_V1 = true;

/** Block 3 — align PublishedUnit with family. */
export const COSTA_PUBLISHED_UNIT_POLICY_V1 = true;

/** Block 2 — prefer IFC NetSideArea when volume closes. */
export const COSTA_WALL_NET_SIDE_AREA_V1 = true;

/** Block 5 — ModelHealth sheet on bridge export. */
export const COSTA_BRIDGE_MODEL_HEALTH_SHEET_V1 = true;

/** Block 6 — export filename identity. */
export const COSTA_BRIDGE_EXPORT_IDENTITY_V1 = true;

/** Block 7 — MCP strict errors. */
export const COSTA_MCP_STRICT_V1 = true;

/** Block 7 — complement uses CostStore universe. */
export const COSTA_MCP_COMPLEMENT_USE_STORE_V1 = true;

/** Block 4 — MCP preflight: critical-family sample + audit trust (no Excel change). */
export const COSTA_MEASUREMENT_PREFLIGHT_V1 = true;

/** Preserve IFC Qto Length when GrossVolume/CrossSectionArea closes (IfcOpenShell gate). */
export const COSTA_PRESERVE_COHERENT_QTO_V1 = true;

/**
 * Bridge corrector v2.3 — re-stamp PublishedQuantity after policies (store + Excel export).
 * OFF by default: zero effect. Flip to true to align PQ with audited IfcOpenShell spec.
 * Spec: scripts/capa_externa_v2/ + src/utils/measurementBridgeCorrector/
 */
export const COSTA_MEASUREMENT_BRIDGE_CORRECTOR_V1 = false;

/** Snapshot for MCP preflight / store ping — single source of truth. */
export function getMeasurementFeatureFlagsSnapshot(): {
  wallGrossVolumeBrickV1: boolean;
  linearProfileLengthV1: boolean;
  measurementReliabilityV1: boolean;
  wallNetSideAreaV1: boolean;
  publishedUnitPolicyV1: boolean;
  bridgeModelHealthSheetV1: boolean;
  bridgeExportIdentityV1: boolean;
  mcpStrictV1: boolean;
  mcpComplementUseStoreV1: boolean;
  measurementPreflightV1: boolean;
  preserveCoherentQtoV1: boolean;
  measurementBridgeCorrectorV1: boolean;
} {
  return {
    wallGrossVolumeBrickV1: COSTA_WALL_GROSS_VOLUME_BRICK_V1,
    linearProfileLengthV1: COSTA_LINEAR_PROFILE_LENGTH_V1,
    measurementReliabilityV1: COSTA_MEASUREMENT_RELIABILITY_V1,
    wallNetSideAreaV1: COSTA_WALL_NET_SIDE_AREA_V1,
    publishedUnitPolicyV1: COSTA_PUBLISHED_UNIT_POLICY_V1,
    bridgeModelHealthSheetV1: COSTA_BRIDGE_MODEL_HEALTH_SHEET_V1,
    bridgeExportIdentityV1: COSTA_BRIDGE_EXPORT_IDENTITY_V1,
    mcpStrictV1: COSTA_MCP_STRICT_V1,
    mcpComplementUseStoreV1: COSTA_MCP_COMPLEMENT_USE_STORE_V1,
    measurementPreflightV1: COSTA_MEASUREMENT_PREFLIGHT_V1,
    preserveCoherentQtoV1: COSTA_PRESERVE_COHERENT_QTO_V1,
    measurementBridgeCorrectorV1: COSTA_MEASUREMENT_BRIDGE_CORRECTOR_V1,
  };
}

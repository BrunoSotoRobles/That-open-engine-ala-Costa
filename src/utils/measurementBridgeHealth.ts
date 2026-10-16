/**
 * Model health summary for optional bridge Excel sheet (ModelHealth).
 * Read-only diagnostics — does not change PublishedQuantity.
 */

import type ExcelJS from "exceljs";
import { summarizeAbPolicies } from "./abPolicySummary";
import { summarizeMeasurementAuditTrust } from "./measurementBridgeAudit";
import { isPublishedBlocked } from "./measurementReliability";
import { resolvePublishedFields } from "./measurementBridgeExport";
import { getMeasurementFeatureFlagsSnapshot } from "./measurementFeatureFlags";
import { classifyPublishedQuantity } from "./measurementBridgeCorrector/classify";
import {
  bridgeFamily,
  buildBridgeQtoRecord,
} from "./measurementBridgeCorrector/record";
import {
  readPublishedFromElement,
  type BridgeElementLike,
} from "./measurementBridgeCorrector/publishedQuantityCorrection";
import { computeQuantityWarnings } from "./measurementBridgeAudit";
import {
  aggregateStoreElementsByIfcType,
  normalizeStoreIfcType,
} from "./storeIfcTypeAggregation";

export type ModelHealthRow = {
  category: "ifc_type";
  ifcType: string;
  elementCount: number;
  publishedCount: number;
  blockedCount: number;
  emptyPublishedCount: number;
  correctedCount: number;
  warningCount: number;
  wallBrickCount: number;
  note: string;
};

export type ModelHealthMetricRow = {
  metric: string;
  value: string | number;
  detail?: string;
};

/** Legacy stamp written by bridge corrector store pass (classify module). */
const BRIDGE_CORRECTOR_VERDICT_CORRECTED = "CORREGIDO";

export type BridgeCorrectorHealthSummary = {
  appliedCorrected: number;
  residualDefect: number;
  abstention: number;
  criterion: number;
  ok: number;
  byCode: Record<string, number>;
};

type CorrectorCodeExport = { slug: string; label: string; detail: string };

const CORRECTOR_CODE_EXPORT: Record<string, CorrectorCodeExport> = {
  defecto_dimensional: {
    slug: "dimensional_defect",
    label: "Dimensional defect",
    detail: "CostaBIM replaced a published value taken from the wrong IFC dimension",
  },
  area_como_rectangulo: {
    slug: "area_as_rectangle",
    label: "Area as rectangle",
    detail: "CostaBIM replaced a published area derived from width × height",
  },
  orden_de_magnitud: {
    slug: "order_of_magnitude",
    label: "Order-of-magnitude mismatch",
    detail: "Published quantity was off by roughly 10× or more vs IFC-backed candidates",
  },
  sin_candidato_IFC: {
    slug: "no_ifc_candidate",
    label: "No IFC candidate",
    detail: "CostaBIM abstained — no trustworthy IFC quantity to substitute",
  },
  capa1_VA_no_cierra: {
    slug: "volume_area_mismatch",
    label: "Volume/area inconsistency",
    detail: "CostaBIM abstained — volume and area do not close on the same axes",
  },
  eje_volcado: {
    slug: "inverted_axis",
    label: "Inverted axis",
    detail: "CostaBIM abstained — length/width/height axes look swapped in Qto",
  },
  sin_dims: {
    slug: "missing_opening_dims",
    label: "Missing opening dimensions",
    detail: "Door/window width or height not available for correction",
  },
  coincide: {
    slug: "already_matches",
    label: "Already matches IFC",
    detail: "Published quantity already aligned with IFC-backed reading",
  },
  sin_PublishedQuantity: {
    slug: "missing_published_quantity",
    label: "Missing PublishedQuantity",
    detail: "No published quantity to evaluate",
  },
  publica_area_bruta: {
    slug: "gross_area_channel",
    label: "Gross area channel",
    detail: "CostaBIM flagged gross area used where net/length was expected",
  },
  otro_canal_de_longitud: {
    slug: "alternate_length_channel",
    label: "Alternate length channel",
    detail: "CostaBIM flagged an unusual IFC field used for length",
  },
  W_igual_H_indebido: {
    slug: "width_equals_height",
    label: "Width equals height",
    detail: "CostaBIM corrected opening width copied from height (or vice versa)",
  },
  modular_vs_overall: {
    slug: "modular_vs_overall",
    label: "Modular vs overall size",
    detail: "CostaBIM flagged modular dimensions vs overall opening size",
  },
};

function resolveCorrectorCodeExport(code: string): CorrectorCodeExport {
  if (CORRECTOR_CODE_EXPORT[code]) return CORRECTOR_CODE_EXPORT[code];
  if (code.startsWith("coincide_con_")) {
    const key = code.slice("coincide_con_".length);
    return {
      slug: `matches_${key}`,
      label: `Matches IFC ${key}`,
      detail: "Published quantity already matches this IFC quantity",
    };
  }
  if (code.startsWith("familia_")) {
    const slug = code
      .replace(/^familia_/, "family_")
      .replace("_unidad_", "_unit_")
      .replace("_vacia", "_empty");
    return {
      slug,
      label: slug.replace(/_/g, " "),
      detail: "Family/unit combination not handled by published-quantity repair",
    };
  }
  return {
    slug: code,
    label: code.replace(/_/g, " "),
    detail: "",
  };
}

/** Stable English slug for internal corrector code tokens (tests, keys). */
export function englishCorrectorCode(code: string): string {
  return resolveCorrectorCodeExport(code).slug;
}

function nearlyEqual(a: number, b: number, relTol = 0.005): boolean {
  if (b === 0) return Math.abs(a) < 1e-9;
  return Math.abs(a - b) / Math.abs(b) <= relTol;
}

/** Simulate v2.3 corrector verdicts on current store (read-only). */
export function summarizeBridgeCorrectorHealth(
  elements: Array<BridgeElementLike & { type?: string }>
): BridgeCorrectorHealthSummary {
  const summary: BridgeCorrectorHealthSummary = {
    appliedCorrected: 0,
    residualDefect: 0,
    abstention: 0,
    criterion: 0,
    ok: 0,
    byCode: {},
  };

  for (const el of elements) {
    const extra = (el.extraProperties ?? {}) as Record<string, unknown>;
    const stamped = extra["CostaBIM.BridgeCorrector.Verdict"];
    if (stamped === BRIDGE_CORRECTOR_VERDICT_CORRECTED) summary.appliedCorrected += 1;

    const ifcType = String(el.type ?? "");
    if (!ifcType) continue;

    const { pq, unit } = readPublishedFromElement(el);
    if (pq == null) continue;

    const rec = buildBridgeQtoRecord(
      ifcType,
      el.baseQuantities,
      el.extraProperties
    );
    const res = classifyPublishedQuantity(
      rec,
      bridgeFamily(ifcType),
      pq,
      unit
    );
    const code = res.codigo || "unknown";
    summary.byCode[code] = (summary.byCode[code] ?? 0) + 1;

    if (res.veredicto === BRIDGE_CORRECTOR_VERDICT_CORRECTED && res.nuevo != null) {
      if (!nearlyEqual(pq, res.nuevo)) summary.residualDefect += 1;
      else summary.ok += 1;
    } else if (res.veredicto === "ABSTENCION") {
      summary.abstention += 1;
    } else if (res.veredicto === "CRITERIO") {
      summary.criterion += 1;
    } else {
      summary.ok += 1;
    }
  }

  return summary;
}

export function buildModelHealthRunMetrics(elements: any[]): ModelHealthMetricRow[] {
  const n = elements.length;
  let published = 0;
  let blocked = 0;
  let empty = 0;

  for (const el of elements) {
    const extra = (el?.extraProperties ?? {}) as Record<string, string | number>;
    if (isPublishedBlocked(extra)) {
      blocked += 1;
      continue;
    }
    const pub = resolvePublishedFields(el);
    const q = pub.quantity;
    const hasPublished =
      typeof q === "number"
        ? q > 0
        : typeof q === "string" && q.trim() !== "" && Number(q) > 0;
    if (hasPublished) published += 1;
    else empty += 1;
  }

  const pct = (count: number) =>
    n > 0 ? Number(((count / n) * 100).toFixed(1)) : 0;

  return [
    { metric: "elements_total", value: n },
    { metric: "published_ok", value: published, detail: `${pct(published)}%` },
    { metric: "published_blocked", value: blocked, detail: `${pct(blocked)}%` },
    { metric: "published_empty", value: empty, detail: `${pct(empty)}%` },
  ];
}

export function buildModelHealthFlagsMetrics(): ModelHealthMetricRow[] {
  const flags = getMeasurementFeatureFlagsSnapshot();
  return Object.entries(flags).map(([metric, value]) => ({
    metric,
    value: value ? "ON" : "OFF",
  }));
}

/** CostaBIM PublishedQuantity repair outcomes (Send to Cost + export). */
export function buildModelHealthPublishedRepairMetrics(
  elements: any[]
): ModelHealthMetricRow[] {
  const corr = summarizeBridgeCorrectorHealth(elements);

  const rows: ModelHealthMetricRow[] = [
    {
      metric: "PublishedQuantity corrected",
      value: corr.appliedCorrected,
      detail: "CostaBIM detected a clear defect and re-stamped PublishedQuantity",
    },
    {
      metric: "PublishedQuantity still incorrect",
      value: corr.residualDefect,
      detail: "CostaBIM knows the target value but PublishedQuantity was not updated — re-Send to Cost",
    },
    {
      metric: "Abstained (no auto-fix)",
      value: corr.abstention,
      detail: "IFC evidence insufficient or inconsistent; CostaBIM left PublishedQuantity unchanged",
    },
    {
      metric: "Flagged for review",
      value: corr.criterion,
      detail: "Ambiguous case; CostaBIM did not overwrite PublishedQuantity",
    },
  ];

  return rows;
}

/** CostaBIM correction reason counts (why repair ran or abstained). */
export function buildModelHealthCorrectionReasonMetrics(
  elements: any[]
): ModelHealthMetricRow[] {
  const corr = summarizeBridgeCorrectorHealth(elements);
  const rows: ModelHealthMetricRow[] = [];

  for (const [code, count] of Object.entries(corr.byCode).sort(
    (a, b) => b[1] - a[1]
  )) {
    const exp = resolveCorrectorCodeExport(code);
    rows.push({
      metric: exp.label,
      value: count,
      detail: exp.detail,
    });
  }

  return rows;
}

/** Other CostaBIM measurement policies applied before publish. */
export function buildModelHealthPolicyRepairMetrics(elements: any[]): ModelHealthMetricRow[] {
  const ab = summarizeAbPolicies(elements);

  return [
    {
      metric: "Wall net/brick face recovery",
      value: ab.wallFace,
      detail: "CostaBIM wall face or gross-volume brick policy applied",
    },
    {
      metric: "Wall brick recovery (explicit)",
      value: countWallBrick(elements),
      detail: "Elements where CostaBIM recovered run × height from gross volume",
    },
    {
      metric: "Poisoned dimension signals",
      value: ab.dimSignals,
      detail: "Width/length/height slots flagged as inconsistent (W=L, L=H, …)",
    },
    {
      metric: "Hollow section net volume",
      value: ab.hollowPreferNet,
      detail: "CostaBIM preferred net volume for hollow profiles",
    },
    {
      metric: "Instanced bbox poison",
      value: ab.bboxPoison,
      detail: "BBox-derived quantities flagged as unreliable",
    },
    {
      metric: "Ontelolaatta delegated",
      value: ab.ontelo,
      detail: "Pre-stressed slab measurement handled by ontelo policy",
    },
    {
      metric: "Layer assembly hosts",
      value: ab.layerHost,
      detail: "Composite assemblies with a host element carrying published quantity",
    },
    {
      metric: "Layers excluded from bill",
      value: ab.layerHidden,
      detail: "Layer parts that do not contribute to bill-of-quantities totals",
    },
  ];
}

/** @deprecated Use buildModelHealthPublishedRepairMetrics + policy/reason helpers. */
export function buildModelHealthRepairMetrics(elements: any[]): ModelHealthMetricRow[] {
  return [
    ...buildModelHealthPublishedRepairMetrics(elements),
    ...buildModelHealthCorrectionReasonMetrics(elements),
    ...buildModelHealthPolicyRepairMetrics(elements),
  ];
}

function countWallBrick(elements: any[]): number {
  let n = 0;
  for (const el of elements) {
    if (el?.extraProperties?.["CostaBIM.WallBrickRecovery"] === 1) n += 1;
  }
  return n;
}

export function buildModelHealthAuditMetrics(elements: any[]): ModelHealthMetricRow[] {
  const trust = summarizeMeasurementAuditTrust(elements);
  return [
    { metric: "audit_sample_size", value: trust.sampleSize },
    { metric: "audit_with_warnings", value: trust.withQuantityWarnings },
    {
      metric: "audit_published_without_provenance",
      value: trust.publishedWithoutProvenance,
    },
    { metric: "audit_tekla_bq_length_mismatch", value: trust.teklaBqLengthMismatch },
    { metric: "audit_profile_length_suspect", value: trust.profileLengthSuspect },
    { metric: "audit_bbox_poison_flagged", value: trust.bboxPoisonFlagged },
    { metric: "audit_dim_signal_count", value: trust.dimSignalCount },
    { metric: "audit_note", value: trust.note },
  ];
}

/** Aggregate store elements by IFC type for health sheet. */
export function buildModelHealthRows(elements: any[]): ModelHealthRow[] {
  const byType = new Map<
    string,
    {
      total: number;
      published: number;
      blocked: number;
      empty: number;
      corrected: number;
      warnings: number;
      wallBrick: number;
    }
  >();

  for (const el of elements) {
    const t = normalizeStoreIfcType(el?.type);
    const bucket = byType.get(t) ?? {
      total: 0,
      published: 0,
      blocked: 0,
      empty: 0,
      corrected: 0,
      warnings: 0,
      wallBrick: 0,
    };
    bucket.total += 1;
    const extra = (el?.extraProperties ?? {}) as Record<string, unknown>;
    if (extra["CostaBIM.BridgeCorrector.Verdict"] === BRIDGE_CORRECTOR_VERDICT_CORRECTED) {
      bucket.corrected += 1;
    }
    if (extra["CostaBIM.WallBrickRecovery"] === 1) bucket.wallBrick += 1;
    if (computeQuantityWarnings(el)) bucket.warnings += 1;

    if (isPublishedBlocked(extra as Record<string, string | number>)) {
      bucket.blocked += 1;
    } else {
      const pub = resolvePublishedFields(el);
      const q = pub.quantity;
      const hasPublished =
        typeof q === "number"
          ? q > 0
          : typeof q === "string" && q.trim() !== "" && Number(q) > 0;
      if (hasPublished) bucket.published += 1;
      else bucket.empty += 1;
    }
    byType.set(t, bucket);
  }

  const storeByType = aggregateStoreElementsByIfcType(elements);
  const rows: ModelHealthRow[] = [];
  for (const { ifcType, count } of storeByType) {
    const stats = byType.get(ifcType) ?? {
      total: 0,
      published: 0,
      blocked: 0,
      empty: 0,
      corrected: 0,
      warnings: 0,
      wallBrick: 0,
    };
    const token = ifcType.toUpperCase().replace(/^IFC/, "");
    let note = "";
    if (stats.blocked === stats.total && stats.total > 0) {
      note = "all_blocked";
    } else if (stats.empty === stats.total && stats.total > 0) {
      note = "no_published_quantity";
    } else if (token.includes("ROOF") && stats.published === 0 && stats.blocked === 0) {
      note = "roof_unmeasured";
    } else if (stats.blocked > 0 && stats.published > 0) {
      note = "partial_blocked";
    } else if (stats.empty > 0) {
      note = "partial_published";
    } else if (stats.corrected > 0) {
      note = "costabim_corrected";
    } else if (stats.warnings > 0) {
      note = "audit_warnings";
    }

    rows.push({
      category: "ifc_type",
      ifcType,
      elementCount: count,
      publishedCount: stats.published,
      blockedCount: stats.blocked,
      emptyPublishedCount: stats.empty,
      correctedCount: stats.corrected,
      warningCount: stats.warnings,
      wallBrickCount: stats.wallBrick,
      note,
    });
  }

  const roof = rows.find((r) => r.ifcType.toUpperCase().includes("ROOF"));
  if (!roof) {
    rows.unshift({
      category: "ifc_type",
      ifcType: "IfcRoof",
      elementCount: 0,
      publishedCount: 0,
      blockedCount: 0,
      emptyPublishedCount: 0,
      correctedCount: 0,
      warningCount: 0,
      wallBrickCount: 0,
      note: "absent_from_store",
    });
  }

  return rows;
}

export const MODEL_HEALTH_SHEET_NAME = "ModelHealth";

export const MODEL_HEALTH_SUMMARY_HEADERS = ["Metric", "Value", "Detail"] as const;

export const MODEL_HEALTH_TYPE_HEADERS = [
  "IFC Type",
  "Elements",
  "Published",
  "Blocked",
  "Empty",
  "Corrected",
  "Warnings",
  "Wall brick",
  "Note",
] as const;

/** @deprecated Use MODEL_HEALTH_TYPE_HEADERS — kept for tests referencing old export. */
export const MODEL_HEALTH_HEADERS = [
  "Category",
  "IFC Type",
  "Element Count",
  "Published Count",
  "Blocked Count",
  "Empty Published",
  "Note",
] as const;

function writeMetricBlock(
  sheet: ExcelJS.Worksheet,
  title: string,
  rows: ModelHealthMetricRow[]
): void {
  sheet.addRow([title]);
  sheet.addRow([...MODEL_HEALTH_SUMMARY_HEADERS]);
  for (const row of rows) {
    sheet.addRow([row.metric, row.value, row.detail ?? ""]);
  }
  sheet.addRow([]);
}

/** Write multi-section ModelHealth sheet (run + flags + repair + audit + by-type). */
export function appendModelHealthSheet(
  workbook: ExcelJS.Workbook,
  elements: any[]
): void {
  const sheet = workbook.addWorksheet(MODEL_HEALTH_SHEET_NAME);
  sheet.addRow(["CostaBIM ModelHealth — bridge export diagnostic"]);
  sheet.addRow([]);

  writeMetricBlock(sheet, "Run summary", buildModelHealthRunMetrics(elements));
  writeMetricBlock(sheet, "Measurement flags", buildModelHealthFlagsMetrics());
  writeMetricBlock(
    sheet,
    "CostaBIM — PublishedQuantity repair",
    buildModelHealthPublishedRepairMetrics(elements)
  );
  const reasonRows = buildModelHealthCorrectionReasonMetrics(elements);
  if (reasonRows.length > 0) {
    writeMetricBlock(sheet, "CostaBIM — correction reasons", reasonRows);
  }
  writeMetricBlock(
    sheet,
    "CostaBIM — other measurement policies",
    buildModelHealthPolicyRepairMetrics(elements)
  );
  writeMetricBlock(sheet, "Audit trust", buildModelHealthAuditMetrics(elements));

  sheet.addRow(["By IFC type"]);
  sheet.addRow([...MODEL_HEALTH_TYPE_HEADERS]);
  for (const row of buildModelHealthRows(elements)) {
    sheet.addRow([
      row.ifcType,
      row.elementCount,
      row.publishedCount,
      row.blockedCount,
      row.emptyPublishedCount,
      row.correctedCount,
      row.warningCount,
      row.wallBrickCount,
      row.note,
    ]);
  }
}

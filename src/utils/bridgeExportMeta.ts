/**
 * Bridge Excel export metadata (filename identity, checksum).
 * Active when COSTA_BRIDGE_EXPORT_IDENTITY_V1 is true.
 */

import { COSTA_BRIDGE_EXPORT_IDENTITY_V1 } from "./measurementFeatureFlags";

export type BridgeExportMeta = {
  filename: string;
  rowCount: number;
  guidRowCount: number;
  checksumSha256: string;
};

const ISO_DATE_SEGMENT = /\d{4}-\d{2}-\d{2}/;

export function sanitizeBridgeFilenameStem(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/** Collapse repeated `-YYYY-MM-DD` segments (any stem, any origin). */
export function collapseDuplicateIsoDateSegments(stem: string): string {
  return stem.replace(/(?:-\d{4}-\d{2}-\d{2})+/g, (match) => {
    const dates = match.match(/\d{4}-\d{2}-\d{2}/g);
    return dates?.length ? `-${dates[0]}` : match;
  });
}

export function stemHasIsoDate(stem: string): boolean {
  return ISO_DATE_SEGMENT.test(stem);
}

/** Build download filename; adds row count (and date if missing) when identity flag is ON. */
export function buildBridgeExportFilename(
  stem: string,
  guidRowCount: number,
  explicitFilename?: string
): string {
  const today = new Date().toISOString().split("T")[0];
  if (explicitFilename?.trim()) {
    const raw = explicitFilename.trim();
    return raw.toLowerCase().endsWith(".xlsx") ? raw : `${raw}.xlsx`;
  }

  let base = sanitizeBridgeFilenameStem(stem) || "ifc-measurements";
  base = collapseDuplicateIsoDateSegments(base);
  if (!stemHasIsoDate(base)) {
    base = `${base}-${today}`;
  }

  if (!COSTA_BRIDGE_EXPORT_IDENTITY_V1) {
    return `${base}.xlsx`;
  }
  return `${base}-${guidRowCount}rows.xlsx`;
}

export async function sha256HexFromBuffer(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

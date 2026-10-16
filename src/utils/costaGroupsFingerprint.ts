/**
 * IFC fingerprint helpers for Costa groups buckets.
 */

/** Short prefix for UI / MCP (full hash remains the bucket key). */
export function shortIfcFingerprint(fingerprint: string | null | undefined): string | null {
  const fp = String(fingerprint ?? "").trim();
  if (!fp) return null;
  return fp.length <= 16 ? fp : fp.slice(0, 16);
}

/** Human label for bucket UI/MCP — never null once fingerprint exists. */
export function resolveBucketIfcFileNameForFingerprint(
  fingerprint: string,
  existing?: string | null,
  fileNameHint?: string | null
): string {
  const hint = String(fileNameHint ?? "").trim();
  const existingTrim = String(existing ?? "").trim();
  if (hint && hint !== "mcp-loaded-model.ifc") return hint;
  if (existingTrim && existingTrim !== "mcp-loaded-model.ifc") return existingTrim;
  if (hint) return hint;
  const short = shortIfcFingerprint(fingerprint) ?? fingerprint.slice(0, 12);
  return `ifc-${short}.ifc`;
}

export async function sha256HexFromString(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

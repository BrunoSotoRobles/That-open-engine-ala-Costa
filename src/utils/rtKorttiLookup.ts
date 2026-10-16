/**
 * Shared RT-kortti lookup utilities for BOQ exporters and cost services.
 * Extracts RT-kortti codes from element names and validates against the database.
 */

import { RTKorttiDetails } from '../types/cost';
import { ADJUSTED_UNIFIED_RT_DATABASE } from '../data/unifiedRTDatabase';

const RT_PATTERNS = [
  /\b(US[-]?[0-9]+)\b/i,  // Ulkoseinät
  /\b(VS[-]?[0-9]+)\b/i,  // Väliseinät
  /\b(KS[-]?[0-9]+)\b/i,  // Kantavat seinät
  /\b(IK[-]?[0-9]+)\b/i,  // Ikkunat
  /\b(OV[-]?[0-9]+)\b/i,  // Ovet
  /\b(AP[-]?[0-9]+)\b/i,  // Alapohjat
  /\b(VP[-]?[0-9]+)\b/i,  // Välipohjat
  /\b(YP[-]?[0-9]+)\b/i,  // Yläpohjat
  /\b(PE[-]?[0-9]+)\b/i,  // Perustukset
  /\b(MR[-]?[0-9]+)\b/i,  // Maanrakennus
];

/**
 * Extracts RT-kortti shorthand code from element name.
 * Examples: "Basic Wall:US-1:1344124" -> "US-1", "VS-1" -> "VS-1", "KS1" -> "KS-1"
 */
export function extractRTKorttiCode(elementName: string): string | null {
  if (!elementName) return null;
  for (const pattern of RT_PATTERNS) {
    const match = elementName.match(pattern);
    if (match) {
      const code = match[1].toUpperCase();
      if (code.includes('-')) return code;
      const matchParts = code.match(/^([A-Z]+)([0-9]+)$/);
      if (matchParts) return `${matchParts[1]}-${matchParts[2]}`;
    }
  }
  return null;
}

/**
 * Finds RT-kortti by shorthand key (VS-1) or full code (82-10902).
 */
export function findRTKorttiByCode(code: string): RTKorttiDetails | null {
  if (code in ADJUSTED_UNIFIED_RT_DATABASE) {
    return ADJUSTED_UNIFIED_RT_DATABASE[code];
  }
  const byFullCode = Object.values(ADJUSTED_UNIFIED_RT_DATABASE).find(rt => rt.code === code);
  return byFullCode ?? null;
}

/**
 * Checks if a code is valid (short key or full code).
 */
export function isValidRTKorttiCode(code: string): boolean {
  return findRTKorttiByCode(code) !== null;
}

/**
 * Finds RT-kortti for an element using name, TALO code, and IFC type.
 * Priority: 1) code in name, 2) applicableIfcTypes + TALO match
 */
export function findRTKorttiForElement(
  elementName: string,
  taloCode: string,
  ifcType: string
): RTKorttiDetails | null {
  // 1. Try extract from element name (most reliable when BIM author uses RT codes)
  const nameCode = extractRTKorttiCode(elementName);
  if (nameCode) {
    const found = findRTKorttiByCode(nameCode);
    if (found) return found;
  }

  // 2. Try by applicableIfcTypes match (when IFC type matches RT-kortti)
  const normalizedType = (ifcType || '').toLowerCase();
  for (const [key, rt] of Object.entries(ADJUSTED_UNIFIED_RT_DATABASE)) {
    const applicable = rt.applicableIfcTypes;
    if (applicable?.some(t => normalizedType.includes(t.toLowerCase()))) {
      return rt;
    }
  }

  // 3. Fallback: name contains key (e.g. "VS-1" in "VÄLISEINÄ VS-1")
  for (const [key] of Object.entries(ADJUSTED_UNIFIED_RT_DATABASE)) {
    if (elementName.toLowerCase().includes(key.toLowerCase())) {
      return ADJUSTED_UNIFIED_RT_DATABASE[key];
    }
  }
  return null;
}

import { BaseCostElement } from '../types/cost';
import { 
  TALO_ELEMENTS, 
  TALO_2000_MEASUREMENTS, 
  TALO_2000_CATALOG, 
  TALO_2000_MAPPINGS,
  isValidTalo2000Code
} from '../constants/talo2000';
import { FINNISH_COSTS } from '../data/finnishCostDatabase';
import { Talo2000Unit, Talo2000MeasurementType } from '../types/talo2000';

export type TaloSuggestion = {
  taloCode: string;
  unit: Talo2000Unit;
  confidence: number; // 0..1
  reasons: string[];
  rtName?: string;
};

// Evita duplicados de taloCode y permite acumular razones
function pushUniqueSuggestion(
  list: TaloSuggestion[],
  suggestion: TaloSuggestion
) {
  const existing = list.find(s => s.taloCode === suggestion.taloCode);
  if (existing) {
    // Si ya existe, conservar la mayor confianza y unir razones
    existing.confidence = Math.max(existing.confidence, suggestion.confidence);
    existing.reasons = Array.from(new Set([...existing.reasons, ...suggestion.reasons]));
    return;
  }
  list.push(suggestion);
}

function hasQuantityForUnit(el: BaseCostElement, unit: Talo2000Unit): boolean {
  const q = el.baseQuantities || {};
  switch (unit) {
    case Talo2000Unit.CUBIC_METERS:
      return !!(q['NetVolume'] || q['GrossVolume'] || (q as any)['Volume']);
    case Talo2000Unit.SQUARE_METERS:
      return !!(q['NetSideArea'] || q['GrossSideArea'] || q['NetArea'] || q['GrossArea'] || (q as any)['Area']);
    case Talo2000Unit.METERS:
      return !!q['Length'];
    case Talo2000Unit.PIECES:
      return true;
    default:
      return false;
  }
}

// Infer a canonical unit from available baseQuantities
export function inferUnitFromQuantities(el: BaseCostElement): Talo2000Unit | null {
  const q = el.baseQuantities || {};
  if (q['NetVolume'] || q['GrossVolume'] || (q as any)['Volume']) return Talo2000Unit.CUBIC_METERS;
  if (q['NetSideArea'] || q['GrossSideArea'] || q['NetArea'] || q['GrossArea'] || (q as any)['Area']) return Talo2000Unit.SQUARE_METERS;
  if (q['Length']) return Talo2000Unit.METERS;
  return Talo2000Unit.PIECES; // default to pieces if nothing else
}

function normalizeName(name: string | undefined): string {
  const n = (name || '').toLowerCase();
  return n.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export type UnclassifiedGroup = {
  key: string;
  unit: Talo2000Unit;
  items: BaseCostElement[];
};

// Group elements without taloCode by type + normalized name + inferred unit signature
export function groupUnclassified(elements: BaseCostElement[]): UnclassifiedGroup[] {
  const map = new Map<string, UnclassifiedGroup>();
  for (const el of elements) {
    if (el.taloCode) continue;
    const unit = inferUnitFromQuantities(el) || Talo2000Unit.PIECES;
    const key = `${el.type}|${normalizeName(el.name)}|${unit}`;
    const g = map.get(key) || { key, unit, items: [] };
    g.items.push(el);
    map.set(key, g);
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function parentPrefix(code: string): string {
  const parts = String(code).split('.');
  if (parts.length <= 1) return code;
  return parts.slice(0, parts.length - 1).join('.');
}

export function isValidTaloCodeForUnit(code: string, unit: Talo2000Unit): boolean {
  const m = TALO_2000_MEASUREMENTS[code] || TALO_2000_MEASUREMENTS['default'];
  if (!m) return false;
  return m.unit === unit;
}

function nameSimilarityScore(name: string, candidate: { name?: { fi?: string; en?: string }, category?: string }): number {
  const n = (name || '').toLowerCase();
  let score = 0;
  const parts = [candidate.name?.fi, candidate.name?.en, candidate.category]
    .filter(Boolean)
    .map(s => String(s).toLowerCase());
  for (const p of parts) {
    if (!p) continue;
    if (n.includes(p)) score += 0.4; // strong
    else {
      const tokens = p.split(/\s|,|\.|-/).filter(Boolean);
      const hits = tokens.filter(t => n.includes(t)).length;
      if (hits > 0) score += Math.min(0.3, hits * 0.1);
    }
  }
  return Math.min(0.6, score);
}

export function suggestTaloAssignments(element: BaseCostElement, maxResults = 5): TaloSuggestion[] {
  const suggestions: TaloSuggestion[] = [];
  const elType = element.type;
  const elName = element.name || '';
  const normalizedName = normalizeName(elName);
  const searchText = `${elName} ${elType}`.toLowerCase();
  const unitFromQuantities = inferUnitFromQuantities(element) || Talo2000Unit.PIECES;

  // Capa 1: Búsqueda por mapeos regex (alta confianza: 0.9-1.0)
  const mappingMatches = new Set<string>();
  for (const mapping of TALO_2000_MAPPINGS) {
    if (mapping.pattern.test(searchText) || mapping.pattern.test(normalizedName)) {
      // Verificar que el código existe en el catálogo y es de 4 dígitos
      if (isValidTalo2000Code(mapping.code) && mapping.code.split('.').length === 4) {
        mappingMatches.add(mapping.code);
        const measurement = TALO_2000_MEASUREMENTS[mapping.code] || TALO_2000_MEASUREMENTS['default'];
        const catalogEntry = TALO_2000_CATALOG[mapping.code];
        const rtName = catalogEntry?.name.fi;
        
        // Alta confianza si la unidad coincide
        let confidence = hasQuantityForUnit(element, measurement.unit) ? 0.95 : 0.85;
        
        pushUniqueSuggestion(suggestions, {
          taloCode: mapping.code,
          unit: measurement.unit,
          confidence,
          reasons: ['regex pattern match'],
          rtName
        });
      }
    }
  }

  // Capa 2: Heurísticas por IFC type + palabras clave en inglés (confianza media-alta: 0.7-0.9)
  // Tabla de mapeos por tipo IFC a códigos TALO más probables
  const ifcType = (elType || '').toLowerCase();
  const ifcTypeMappings: Record<string, string[]> = {
    'ifcstair': ['1.2.3.7'],            // Runkoportaat (escaleras de estructura)
    'ifcstairflight': ['1.2.3.7'],
    'ifcrailing': ['1.3.1.4'],          // Kaiteet
    'ifcslab': ['1.2.3.5'],             // Välipohjat (losas)
    'ifcwall': ['1.2.4.1', '1.3.1.1'],  // Ulkoseinät / Väliseinät
    'ifcwallstandardcase': ['1.2.4.1', '1.3.1.1'],
    'ifccolumn': ['1.2.3.3'],           // Pilarit
    'ifcbeam': ['1.2.3.4'],             // Palkit
    'ifcdoor': ['1.2.4.3', '1.3.1.5'],  // Ulko-ovet / Väliovet
    'ifcwindow': ['1.2.4.2'],           // Ikkunat
    'ifcfooting': ['1.2.1.1'],          // Anturat
    'ifcpile': ['1.2.1.2'],             // Perusmuurit/pilarit (aprox. pilotes)
    'ifcroof': ['1.2.6.1'],             // Vesikattorakenteet
    'ifcbuildingelementproxy': ['1.2.3.8'] // fallback estructural
  };

  // Palabras clave en inglés -> código TALO
  const englishKeywordMappings: { pattern: RegExp; code: string }[] = [
    { pattern: /\bstair|step|escalera|ladder\b/i, code: '1.2.3.7' },
    { pattern: /\brailing|handrail|baranda|pasamanos\b/i, code: '1.3.1.4' },
    { pattern: /\bwall\b/i, code: '1.2.4.1' },
    { pattern: /\bpartition|interior wall\b/i, code: '1.3.1.1' },
    { pattern: /\bslab|floor\b/i, code: '1.2.3.5' },
    { pattern: /\bcolumn\b/i, code: '1.2.3.3' },
    { pattern: /\bbeam\b/i, code: '1.2.3.4' },
    { pattern: /\bdoor\b/i, code: '1.2.4.3' },
    { pattern: /\bwindow\b/i, code: '1.2.4.2' },
    { pattern: /\broof\b/i, code: '1.2.6.1' },
    { pattern: /\bfooting|foundation\b/i, code: '1.2.1.1' },
    { pattern: /\bpile\b/i, code: '1.2.1.2' }
  ];

  const typeCodes = ifcTypeMappings[ifcType] || [];
  for (const code of typeCodes) {
    if (!isValidTalo2000Code(code)) continue;
    const measurement = TALO_2000_MEASUREMENTS[code] || TALO_2000_MEASUREMENTS['default'];
    // Solo sugerir si tenemos cantidades para la unidad requerida
    if (!hasQuantityForUnit(element, measurement.unit)) continue;
    const catalogEntry = TALO_2000_CATALOG[code];
    pushUniqueSuggestion(suggestions, {
      taloCode: code,
      unit: measurement.unit,
      confidence: 0.8, // priorizar sobre catálogo genérico
      reasons: ['ifc type hint'],
      rtName: catalogEntry?.name.fi
    });
    mappingMatches.add(code); // tratarlo como “ya sugerido” para evitar duplicados
  }

  for (const kw of englishKeywordMappings) {
    if (kw.pattern.test(elName) || kw.pattern.test(elType)) {
      if (!isValidTalo2000Code(kw.code)) continue;
      const measurement = TALO_2000_MEASUREMENTS[kw.code] || TALO_2000_MEASUREMENTS['default'];
      if (!hasQuantityForUnit(element, measurement.unit)) continue;
      const catalogEntry = TALO_2000_CATALOG[kw.code];
      pushUniqueSuggestion(suggestions, {
        taloCode: kw.code,
        unit: measurement.unit,
        confidence: 0.75,
        reasons: ['english keyword match'],
        rtName: catalogEntry?.name.fi
      });
      mappingMatches.add(kw.code);
    }
  }

  // Capa 3: Búsqueda por nombre en el catálogo (confianza media: 0.6-0.8)
  const nameMatches = new Set<string>();
  for (const [code, entry] of Object.entries(TALO_2000_CATALOG)) {
    // Solo códigos de 4 dígitos
    if (code.split('.').length !== 4) continue;
    // Evitar duplicados de la capa 1
    if (mappingMatches.has(code)) continue;
    
    const catalogName = entry.name.fi.toLowerCase();
    const nameTokens = normalizedName.split(/\s+/).filter(Boolean);
    
    // Buscar coincidencias de palabras clave
    let matchScore = 0;
    for (const token of nameTokens) {
      if (token.length > 2 && catalogName.includes(token)) {
        matchScore += 0.3;
      }
    }
    
    if (matchScore > 0.3) {
      nameMatches.add(code);
      const measurement = TALO_2000_MEASUREMENTS[code] || TALO_2000_MEASUREMENTS['default'];
      let confidence = 0.6 + Math.min(0.2, matchScore);
      
      // Aumentar confianza si la unidad coincide
      if (hasQuantityForUnit(element, measurement.unit)) {
        confidence += 0.15;
      }
      
      pushUniqueSuggestion(suggestions, {
        taloCode: code,
        unit: measurement.unit,
        confidence: Math.min(0.9, confidence),
        reasons: ['catalog name similarity'],
        rtName: entry.name.fi
      });
    }
  }

  // Capa 4: Algoritmo original como fallback (confianza baja: 0.3-0.5)
  // Solo para códigos de 4 dígitos del catálogo
  const catalogCodes = Object.keys(TALO_2000_CATALOG).filter(code => code.split('.').length === 4);
  
  for (const code of catalogCodes) {
    // Evitar duplicados de capas anteriores
    if (mappingMatches.has(code) || nameMatches.has(code)) continue;
    
    const measurement = TALO_2000_MEASUREMENTS[code] || TALO_2000_MEASUREMENTS['default'];
    const reasons: string[] = [];
    let confidence = 0;

    // 1) Unit feasibility (primary)
    if (hasQuantityForUnit(element, measurement.unit)) {
      confidence += 0.3;
      reasons.push(`unit ${measurement.unit} available`);
    } else {
      continue; // Skip si no hay unidad disponible
    }

    // 2) IFC-type plausibility by measurement type
    const measurementType = measurement.primary;
    if (
      (measurementType === Talo2000MeasurementType.VOLUME && hasQuantityForUnit(element, Talo2000Unit.CUBIC_METERS)) ||
      (measurementType === Talo2000MeasurementType.AREA && hasQuantityForUnit(element, Talo2000Unit.SQUARE_METERS)) ||
      (measurementType === Talo2000MeasurementType.LENGTH && hasQuantityForUnit(element, Talo2000Unit.METERS)) ||
      (measurementType === Talo2000MeasurementType.COUNT)
    ) {
      confidence += 0.1;
      reasons.push(`measurement type ${measurementType} matches`);
    }

    // 3) Name similarity con el catálogo
    const catalogEntry = TALO_2000_CATALOG[code];
    if (catalogEntry) {
      const score = nameSimilarityScore(elName, { name: { fi: catalogEntry.name.fi } });
      if (score > 0) {
        confidence += Math.min(0.1, score);
        reasons.push('catalog name similarity');
      }
    }

    // 4) Simple type keyword hint
    const typeHint = elType.toLowerCase();
    const codePrefix = code.split('.').slice(0, 3).join('.');
    if (typeHint.includes('wall') && codePrefix === '1.2.3') { confidence += 0.05; reasons.push('IFC type ~ wall'); }
    if (typeHint.includes('slab') && codePrefix === '1.2.3') { confidence += 0.05; reasons.push('IFC type ~ slab'); }
    if (typeHint.includes('column') && codePrefix === '1.2.3') { confidence += 0.05; reasons.push('IFC type ~ column'); }
    if (typeHint.includes('beam') && codePrefix === '1.2.3') { confidence += 0.05; reasons.push('IFC type ~ beam'); }

    if (confidence > 0.3) {
      suggestions.push({
        taloCode: code,
        unit: measurement.unit,
        confidence: Math.min(0.6, confidence),
        reasons,
        rtName: catalogEntry?.name.fi
      });
    }
  }

  // Ordenar por confianza y retornar solo códigos de 4 dígitos válidos con confianza >= 50%
  return suggestions
    .filter(s => {
      // Solo códigos de 4 dígitos que existan en el catálogo
      const parts = s.taloCode.split('.');
      const isValid = parts.length === 4 && isValidTalo2000Code(s.taloCode);
      // Filtrar solo sugerencias con confianza >= 50% (0.5)
      return isValid && s.confidence >= 0.5;
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults);
}

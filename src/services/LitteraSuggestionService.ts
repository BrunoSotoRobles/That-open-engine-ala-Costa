import { BaseCostElement, LitteraEntry, LitteraSuggestion } from '../types/cost';
import { Talo2000Unit } from '../types/talo2000';
import { LitteraSuggestionCasesService } from './LitteraSuggestionCasesService';

/**
 * Service for suggesting Finnish Littera BOQ codes based on IFC elements.
 *
 * Two-layer strategy:
 * - Capa 1 (strong): Curated cases from littera-suggestion-cases.csv (IfcType + TaloCode
 *   + optional ConstructionMethod). Used first when available.
 * - Capa 2 (heuristic): Element name hints (US1, VS4), TALO→Littera mapping, keywords, IFC type.
 */

/**
 * Normalize a string for comparison by removing special characters
 * and converting to lowercase
 */
function normalizeText(text: string | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract potential Littera codes from element name
 * Looks for patterns like "US1", "VS4", "KS2", etc.
 */
function extractLitteraHints(name: string): string[] {
  const hints: string[] = [];
  const normalized = name.toUpperCase();
  
  // Common Finnish Littera patterns: US1-8, VS1-9, KS1-9, etc.
  const patterns = [
    /\b(US\d+)\b/g,  // Ulkoseinät (exterior walls)
    /\b(VS\d+)\b/g,  // Väliseinät (interior walls)
    /\b(KS\d+)\b/g,  // Kantavat seinät (load-bearing walls)
    /\b(AP\d+)\b/g,  // Alapohja (ground floor)
    /\b(YP\d+)\b/g,  // Yläpohja (roof)
  ];
  
  patterns.forEach(pattern => {
    const matches = normalized.match(pattern);
    if (matches) {
      hints.push(...matches);
    }
  });
  
  return hints;
}

/**
 * Calculate keyword match score between element and Littera entry
 */
function calculateKeywordScore(element: BaseCostElement, entry: LitteraEntry): number {
  const elementText = normalizeText(`${element.name} ${element.type}`);
  const elementWords = new Set(elementText.split(' ').filter(w => w.length > 2));
  
  let matchCount = 0;
  let totalWeight = 0;
  
  entry.keywords.forEach((keyword, index) => {
    const weight = 1 / (index + 1); // First keywords are more important
    totalWeight += weight;
    
    if (elementWords.has(keyword)) {
      matchCount += weight;
    }
  });
  
  return totalWeight > 0 ? matchCount / totalWeight : 0;
}

/**
 * Map TALO code to Littera code
 * Many Littera codes correspond to specific TALO classifications
 */
function mapTaloToLittera(taloCode: string, litteraDict: LitteraEntry[]): LitteraEntry | null {
  if (!taloCode) return null;
  
  // Direct mapping based on TALO code patterns
  const taloPrefix = taloCode.split('.')[0];
  
  // TALO 1.3 = Walls → Look for wall-related Littera codes
  if (taloCode.startsWith('1.3')) {
    const wallEntries = litteraDict.filter(e => 
      e.category === 'ULKOSEINÄT' || 
      e.category === 'VÄLISEINÄT' ||
      e.description.toLowerCase().includes('seinä')
    );
    return wallEntries[0] || null;
  }
  
  // TALO 1.2 = Structure → Look for structure-related codes
  if (taloCode.startsWith('1.2')) {
    const structureEntries = litteraDict.filter(e =>
      e.category === 'BETONIRUNKO' ||
      e.description.toLowerCase().includes('runko')
    );
    return structureEntries[0] || null;
  }
  
  return null;
}

/**
 * Suggest Littera codes for a given element.
 * Capa 1 (strong): curated cases CSV. Capa 2 (heuristic): TALO/name/keywords.
 */
export function suggestLitteraAssignments(
  element: BaseCostElement,
  litteraDict: LitteraEntry[],
  maxResults = 5
): LitteraSuggestion[] {
  const suggestions: LitteraSuggestion[] = [];

  // Skip if already has Littera code
  if (element.litteraCode) {
    return suggestions;
  }

  // --- Capa 1 (fuerte): casos normales finlandeses desde littera-suggestion-cases.csv ---
  const casesService = LitteraSuggestionCasesService.getInstance();
  const strongMatch = casesService.getSuggestionsForElement(element);
  if (strongMatch && strongMatch.litteraCodes.length > 0) {
    const descs = strongMatch.litteraDescriptions;
    for (let i = 0; i < strongMatch.litteraCodes.length && suggestions.length < maxResults; i++) {
      const code = strongMatch.litteraCodes[i];
      const entry = litteraDict.find((e) => e.littera === code);
      const name = entry?.description ?? (descs[i] || code);
      const unit = entry?.unit ?? '';
      const category = entry?.category ?? null;
      suggestions.push({
        litteraCode: code,
        litteraName: name,
        unit,
        category,
        confidence: 0.95,
        reasons: ['Capa fuerte: caso normal finlandés (littera-suggestion-cases)'],
      });
    }
    if (suggestions.length > 0) {
      return suggestions.slice(0, maxResults);
    }
  }

  // --- Capa 2 (heurística): lógica actual ---
  const nameHints = extractLitteraHints(element.name);

  if (element.taloCode) {
    const taloMatch = mapTaloToLittera(element.taloCode, litteraDict);
    if (taloMatch && !taloMatch.isCategory) {
      suggestions.push({
        litteraCode: taloMatch.littera,
        litteraName: taloMatch.description,
        unit: taloMatch.unit,
        category: taloMatch.category,
        confidence: 0.8,
        reasons: ['Mapped from TALO code ' + element.taloCode],
      });
    }
  }
  
  // Try exact match with name hints
  nameHints.forEach(hint => {
    const matches = litteraDict.filter(entry => 
      !entry.isCategory && 
      entry.description.toUpperCase().includes(hint)
    );
    
    matches.forEach(match => {
      suggestions.push({
        litteraCode: match.littera,
        litteraName: match.description,
        unit: match.unit,
        category: match.category,
        confidence: 0.9,
        reasons: [`Element name contains "${hint}"`],
        matchedKeywords: [hint]
      });
    });
  });
  
  // Search by keywords and element type
  litteraDict.forEach(entry => {
    // Skip categories
    if (entry.isCategory) return;
    
    // Skip if already suggested
    if (suggestions.some(s => s.litteraCode === entry.littera)) return;
    
    const keywordScore = calculateKeywordScore(element, entry);
    
    if (keywordScore > 0.3) {
      const reasons: string[] = [];
      let confidence = keywordScore * 0.6; // Base confidence from keywords
      
      reasons.push(`Keyword match score: ${(keywordScore * 100).toFixed(0)}%`);
      
      // Boost confidence based on IFC type matching
      const elementType = element.type.toLowerCase();
      const description = entry.description.toLowerCase();
      
      if (elementType.includes('wall') && description.includes('seinä')) {
        confidence += 0.2;
        reasons.push('IFC Wall matches Seinä category');
      }
      if (elementType.includes('slab') && (description.includes('laatta') || description.includes('pohja'))) {
        confidence += 0.2;
        reasons.push('IFC Slab matches Laatta/Pohja category');
      }
      if (elementType.includes('column') && description.includes('pilari')) {
        confidence += 0.2;
        reasons.push('IFC Column matches Pilari category');
      }
      if (elementType.includes('beam') && description.includes('palkki')) {
        confidence += 0.2;
        reasons.push('IFC Beam matches Palkki category');
      }
      
      suggestions.push({
        litteraCode: entry.littera,
        litteraName: entry.description,
        unit: entry.unit,
        category: entry.category,
        confidence: Math.min(1, confidence),
        reasons,
        matchedKeywords: entry.keywords.filter(k => 
          normalizeText(`${element.name} ${element.type}`).includes(k)
        )
      });
    }
  });
  
  // Sort by confidence and return top results
  return suggestions
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults);
}

/**
 * Group unclassified elements (without Littera code) by similarity
 */
export function groupUnclassifiedByLittera(elements: BaseCostElement[]): {
  key: string;
  items: BaseCostElement[];
  suggestedLittera?: string;
}[] {
  const groups = new Map<string, BaseCostElement[]>();
  
  elements
    .filter(el => !el.litteraCode)
    .forEach(el => {
      const key = `${el.type}|${normalizeText(el.name)}`;
      const existing = groups.get(key) || [];
      existing.push(el);
      groups.set(key, existing);
    });
  
  return Array.from(groups.entries()).map(([key, items]) => ({
    key,
    items
  }));
}

/**
 * Validate if a Littera code is valid for a given unit
 */
export function isValidLitteraCodeForUnit(
  litteraCode: string,
  expectedUnit: string,
  litteraDict: LitteraEntry[]
): boolean {
  const entry = litteraDict.find(e => e.littera === litteraCode);
  if (!entry) return false;
  
  // Empty unit means it's flexible
  if (!entry.unit || entry.unit === '') return true;
  
  // Normalize units for comparison
  const normalizedExpected = expectedUnit.toUpperCase();
  const normalizedEntry = entry.unit.toUpperCase();
  
  return normalizedExpected === normalizedEntry;
}


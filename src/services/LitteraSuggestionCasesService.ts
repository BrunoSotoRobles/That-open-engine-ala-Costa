/**
 * Service for the "strong layer" of Littera suggestions: curated normal Finnish cases
 * from littera-suggestion-cases.csv (IfcType + TaloCode + ConstructionMethod → LitteraCodes).
 *
 * Used as Capa 1 (estructurada/fuerte) before falling back to heuristic suggestions.
 */

import type { BaseCostElement } from '../types/cost';
import { ConstructionMethodDetector } from '../utils/ConstructionMethodDetector';
import { StructuredLogger } from '../utils/StructuredLogger';
import litteraSuggestionCasesCsv from '../data/littera-suggestion-cases.csv?raw';

export interface SuggestionCaseRow {
  ifcType: string;
  taloCode: string;
  taloName: string;
  constructionMethod: string;
  context: string;
  elementDescription: string;
  litteraCodes: string[];
  litteraDescriptions: string[];
  notes: string;
}

/**
 * Parse a CSV line respecting quoted fields (e.g. "a,b" stays one cell)
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i += 1;
      let cell = '';
      while (i < line.length && line[i] !== '"') {
        cell += line[i];
        i += 1;
      }
      if (line[i] === '"') i += 1;
      result.push(cell);
    } else {
      let cell = '';
      while (i < line.length && line[i] !== ',') {
        cell += line[i];
        i += 1;
      }
      result.push(cell.trim());
      if (line[i] === ',') i += 1;
    }
  }
  return result;
}

export class LitteraSuggestionCasesService {
  private static instance: LitteraSuggestionCasesService;
  private cases: SuggestionCaseRow[] = [];
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): LitteraSuggestionCasesService {
    if (!LitteraSuggestionCasesService.instance) {
      LitteraSuggestionCasesService.instance = new LitteraSuggestionCasesService();
    }
    return LitteraSuggestionCasesService.instance;
  }

  /**
   * Load cases from CSV. Safe to call multiple times (idempotent).
   */
  async loadCases(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const text = litteraSuggestionCasesCsv?.trim() ? litteraSuggestionCasesCsv : null;
        if (!text) {
          StructuredLogger.warn(
            'LitteraSuggestionCasesService',
            'loadCases',
            'Bundled littera-suggestion-cases.csv is empty'
          );
          this.isLoaded = true;
          return;
        }
        StructuredLogger.debug(
          'LitteraSuggestionCasesService',
          'loadCases',
          'CSV loaded from bundle'
        );
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) {
          this.isLoaded = true;
          return;
        }
        const header = parseCsvLine(lines[0]);
        const ifcIdx = header.findIndex((h) => /ifctype/i.test(h));
        const taloIdx = header.findIndex((h) => /talocode/i.test(h));
        const nameIdx = header.findIndex((h) => /taloname/i.test(h));
        const methodIdx = header.findIndex((h) => /constructionmethod/i.test(h));
        const contextIdx = header.findIndex((h) => /^context$/i.test(h));
        const descIdx = header.findIndex((h) => /elementdescription/i.test(h));
        const codesIdx = header.findIndex((h) => /litteracodes/i.test(h));
        const descsIdx = header.findIndex((h) => /litteradescriptions/i.test(h));
        const notesIdx = header.findIndex((h) => /notes/i.test(h));

        for (let i = 1; i < lines.length; i++) {
          const row = parseCsvLine(lines[i]);
          if (row.length < Math.max(ifcIdx, taloIdx, codesIdx) + 1) continue;
          const ifcType = (row[ifcIdx] ?? '').trim();
          const taloCode = (row[taloIdx] ?? '').trim().replace(/\D/g, '');
          if (!ifcType || !taloCode) continue;
          const litteraCodesStr = row[codesIdx] ?? '';
          const litteraCodes = litteraCodesStr.split(';').map((c) => c.trim()).filter(Boolean);
          if (litteraCodes.length === 0) continue;
          this.cases.push({
            ifcType,
            taloCode,
            taloName: (row[nameIdx] ?? '').trim(),
            constructionMethod: (row[methodIdx] ?? '').trim().toLowerCase(),
            context: (row[contextIdx] ?? '').trim(),
            elementDescription: (row[descIdx] ?? '').trim(),
            litteraCodes,
            litteraDescriptions: (row[descsIdx] ?? '')
              .split(';')
              .map((d) => d.trim())
              .filter(Boolean),
            notes: (row[notesIdx] ?? '').trim(),
          });
        }
        this.isLoaded = true;
        StructuredLogger.info(
          'LitteraSuggestionCasesService',
          'loadCases',
          'Loaded suggestion cases',
          { count: this.cases.length }
        );
      } catch (e) {
        StructuredLogger.warn(
          'LitteraSuggestionCasesService',
          'loadCases',
          'Error loading cases',
          { error: String(e) }
        );
        this.isLoaded = true;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Normalize TALO code for matching (e.g. "1.2.1.2" → "1212").
   */
  private normalizeTaloCode(talo: string | undefined): string {
    if (!talo) return '';
    return talo.replace(/\D/g, '');
  }

  /**
   * Check if a row's construction method matches the element (by name detection).
   */
  private constructionMethodMatches(
    rowMethod: string,
    elementName: string
  ): boolean {
    if (!rowMethod) return true;
    const detected = ConstructionMethodDetector.detect(elementName);
    const fi = detected ? ConstructionMethodDetector.toFinnish(detected) : '';
    if (rowMethod === fi) return true;
    if (rowMethod === 'sandwich' && (fi === 'elementti' || /sandwich/i.test(elementName)))
      return true;
    return false;
  }

  /**
   * Get curated Littera suggestions for an element (strong layer).
   * Returns null if cases not loaded, no TaloCode, or no matching row.
   */
  getSuggestionsForElement(element: BaseCostElement): {
    litteraCodes: string[];
    litteraDescriptions: string[];
  } | null {
    if (!this.isLoaded || this.cases.length === 0) return null;
    if (!element.taloCode) return null;

    const taloNorm = this.normalizeTaloCode(element.taloCode);
    if (taloNorm.length < 3) return null;

    const typeNorm = (element.type || '').trim().toLowerCase();
    const candidates = this.cases.filter((r) => {
      const typeMatch = r.ifcType.toLowerCase() === typeNorm;
      const taloMatch = r.taloCode === taloNorm || taloNorm.startsWith(r.taloCode);
      return typeMatch && taloMatch;
    });

    if (candidates.length === 0) return null;
    if (candidates.length === 1) {
      return {
        litteraCodes: candidates[0].litteraCodes,
        litteraDescriptions: candidates[0].litteraDescriptions,
      };
    }
    const name = element.name || '';
    const preferred = candidates.find((r) =>
      this.constructionMethodMatches(r.constructionMethod, name)
    );
    const row = preferred ?? candidates[0];
    return {
      litteraCodes: row.litteraCodes,
      litteraDescriptions: row.litteraDescriptions,
    };
  }

  isLoadedSync(): boolean {
    return this.isLoaded;
  }
}

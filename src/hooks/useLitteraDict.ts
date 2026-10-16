import { useState, useEffect } from 'react';
import { LitteraEntry } from '../types/cost';
import { LitteraSuggestionCasesService } from '../services/LitteraSuggestionCasesService';

/**
 * Hook to load and cache the Finnish Littera BOQ dictionary
 * 
 * The dictionary is loaded from /src/data/littera.json and contains
 * 2000+ entries of Finnish construction cost classification codes.
 * 
 * @returns Object containing the dictionary data, loading state, and any errors
 */
export function useLitteraDict() {
  const [litteraDict, setLitteraDict] = useState<LitteraEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadDict = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Import the JSON file directly (Vite/Webpack will handle this)
        const response = await import('../data/littera.json');
        
        // The imported module has a default export
        const data = response.default as LitteraEntry[];

        if (!Array.isArray(data)) {
          throw new Error('Littera dictionary is not an array');
        }

        if (isMounted) {
          setLitteraDict(data);
          console.log(`[Littera] Loaded ${data.length} entries from dictionary`);
          // Load strong-layer suggestion cases (littera-suggestion-cases.csv) in background
          LitteraSuggestionCasesService.getInstance().loadCases().catch(() => {});
        }
      } catch (err) {
        console.error('[Littera] Error loading dictionary:', err);
        if (isMounted) {
          setError(err instanceof Error ? err : new Error('Failed to load Littera dictionary'));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadDict();

    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Find a Littera entry by code
   */
  const findByCode = (code: string): LitteraEntry | undefined => {
    return litteraDict.find(entry => entry.littera === code);
  };

  /**
   * Find Littera entries by category
   */
  const findByCategory = (category: string): LitteraEntry[] => {
    return litteraDict.filter(entry => entry.category === category);
  };

  /**
   * Get all category names
   */
  const getCategories = (): string[] => {
    const categories = new Set<string>();
    litteraDict.forEach(entry => {
      if (entry.category) {
        categories.add(entry.category);
      }
    });
    return Array.from(categories).sort();
  };

  /**
   * Search entries by keyword
   */
  const search = (query: string): LitteraEntry[] => {
    const normalized = query.toLowerCase();
    return litteraDict.filter(entry => {
      return (
        entry.littera.toLowerCase().includes(normalized) ||
        entry.description.toLowerCase().includes(normalized) ||
        entry.keywords.some(k => k.includes(normalized))
      );
    });
  };

  return {
    litteraDict,
    isLoading,
    error,
    findByCode,
    findByCategory,
    getCategories,
    search,
    hasData: litteraDict.length > 0
  };
}


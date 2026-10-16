/**
 * Centralized service for detecting construction methods from element names
 * 
 * This service unifies the detection logic that was previously duplicated
 * between LitteraFilteringService and LitteraTemplateService.
 * 
 * Returns standardized English method names internally, with conversion
 * to Finnish names when needed for template matching.
 */

export type ConstructionMethod = 
  | 'precast'      // elementti
  | 'cast-in-place' // paikallavalettu
  | 'timber'       // puurunko
  | 'masonry'      // muuraus
  | 'light'        // kevyt
  | 'supply'       // toimitus
  | 'steel'        // teräs
  | 'other';       // erilainen

export type ConstructionMethodFI = 
  | 'elementti'
  | 'paikallavalettu'
  | 'puurunko'
  | 'muuraus'
  | 'kevyt'
  | 'toimitus'
  | 'teräs'
  | 'erilainen';

/**
 * Mapping between English (internal) and Finnish (template) method names
 */
const METHOD_MAPPING: Record<ConstructionMethod, ConstructionMethodFI> = {
  'precast': 'elementti',
  'cast-in-place': 'paikallavalettu',
  'timber': 'puurunko',
  'masonry': 'muuraus',
  'light': 'kevyt',
  'supply': 'toimitus',
  'steel': 'teräs',
  'other': 'erilainen'
};

/**
 * Reverse mapping for converting Finnish to English
 */
const REVERSE_MAPPING: Record<ConstructionMethodFI, ConstructionMethod> = {
  'elementti': 'precast',
  'paikallavalettu': 'cast-in-place',
  'puurunko': 'timber',
  'muuraus': 'masonry',
  'kevyt': 'light',
  'toimitus': 'supply',
  'teräs': 'steel',
  'erilainen': 'other'
};

export class ConstructionMethodDetector {
  /**
   * Detects construction method from element name
   * Returns standardized English method name (internal use)
   * 
   * Detection order (most specific first):
   * 1. Precast/Elementti
   * 2. Supply/Toimitus (for doors, windows)
   * 3. Cast-in-place/Paikallavalettu
   * 4. Timber/Puurunko
   * 5. Masonry/Muuraus
   * 6. Light/Kevyt
   * 7. Defaults
   * 
   * @param elementName - Name of the IFC element
   * @returns Detected construction method or null if cannot be determined
   */
  static detect(elementName: string): ConstructionMethod | null {
    if (!elementName || typeof elementName !== 'string') {
      return null;
    }

    const nameLower = elementName.toLowerCase();
    
    // 1. Precast / Elementti (check first to avoid false positives)
    if (nameLower.includes('sandwich') || 
        nameLower.includes('elementti') ||
        nameLower.includes('precast') ||
        nameLower.includes('esivalmistet')) {
      return 'precast';
    }
    
    // 2. Supply/Delivery / Toimitus (for doors, windows, etc.)
    if (nameLower.includes('toimitus') ||
        nameLower.includes('supply') ||
        nameLower.includes('delivery')) {
      return 'supply';
    }
    
    // 3. Cast-in-place / Paikallavalettu
    if (nameLower.includes('paikallavalettu') ||
        nameLower.includes('paikallavalu') ||
        nameLower.includes('cast-in-place') ||
        nameLower.includes('in-situ') ||
        nameLower.includes('pv ')) {
      return 'cast-in-place';
    }
    
    // 4. Steel / Teräs (check for steel profiles: HEA, HEB, IPE, RHS, etc.)
    if (nameLower.includes('teräs') ||
        nameLower.includes('steel') ||
        nameLower.includes('hea') ||
        nameLower.includes('heb') ||
        nameLower.includes('hem') ||
        nameLower.includes('ipe') ||
        nameLower.includes('rhs') ||
        nameLower.includes('shs') ||
        nameLower.includes('chs') ||
        nameLower.includes('upe') ||
        nameLower.includes('upn')) {
      return 'steel';
    }
    
    // 5. Timber / Puurunko
    if (nameLower.includes('puurunko') ||
        nameLower.includes('timber') ||
        nameLower.includes('wood') ||
        nameLower.includes('puu')) {
      return 'timber';
    }
    
    // 6. Masonry / Muuraus
    if (nameLower.includes('harkko') ||
        nameLower.includes('tiili') ||
        nameLower.includes('muuraus') ||
        nameLower.includes('masonry') ||
        nameLower.includes('kahi') ||
        nameLower.includes('block')) {
      return 'masonry';
    }
    
    // 7. Light partition / Kevyt
    if (nameLower.includes('kevyt') ||
        nameLower.includes('light') ||
        nameLower.includes('levy') ||
        nameLower.includes('gn') ||
        nameLower.includes('kipsi')) {
      return 'light';
    }
    
    // 8. Default to cast-in-place for concrete elements (if not already identified)
    if (nameLower.includes('betoni') || nameLower.includes('concrete')) {
      return 'cast-in-place';
    }
    
    // 9. Generic partition (default to light)
    if (nameLower.includes('väliseinä') || nameLower.includes('partition')) {
      return 'light';
    }
    
    return null;
  }

  /**
   * Converts English method name to Finnish (for template matching)
   * 
   * @param method - English construction method
   * @returns Finnish construction method name
   */
  static toFinnish(method: ConstructionMethod | null): ConstructionMethodFI {
    if (!method) {
      return 'erilainen';
    }
    return METHOD_MAPPING[method] || 'erilainen';
  }

  /**
   * Converts Finnish method name to English (for internal use)
   * 
   * @param methodFI - Finnish construction method
   * @returns English construction method name
   */
  static fromFinnish(methodFI: ConstructionMethodFI | string): ConstructionMethod {
    if (!methodFI || typeof methodFI !== 'string') {
      return 'other';
    }
    return REVERSE_MAPPING[methodFI as ConstructionMethodFI] || 'other';
  }

  /**
   * Checks if a method name is valid (either English or Finnish)
   * 
   * @param method - Method name to validate
   * @returns True if valid
   */
  static isValid(method: string): boolean {
    return method in METHOD_MAPPING || method in REVERSE_MAPPING;
  }

  /**
   * Normalizes a method name to English (handles both English and Finnish inputs)
   * 
   * @param method - Method name (could be English or Finnish)
   * @returns Normalized English method name
   */
  static normalize(method: string | null | undefined): ConstructionMethod {
    if (!method) {
      return 'other';
    }
    
    // If already in English format
    if (method in METHOD_MAPPING) {
      return method as ConstructionMethod;
    }
    
    // Try to convert from Finnish
    return this.fromFinnish(method);
  }
}


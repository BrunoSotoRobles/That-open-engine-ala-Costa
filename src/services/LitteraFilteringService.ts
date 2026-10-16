import { BaseCostElement } from '../types/cost/shared';
import { TaloLitteraMappingService, LitteraMapping } from './TaloLitteraMappingService';
import { LitteraTemplateService, type LitteraTemplate, type ActivityRule } from './LitteraTemplateService';
import { ConstructionMethodDetector } from '../utils/ConstructionMethodDetector';
import { StructuredLogger } from '../utils/StructuredLogger';
import { ErrorHandler } from '../utils/ErrorHandler';
import { isConfirmedOntelolaattaElement } from '../utils/ontelolaattaLitteraPackage';
import { useCostStore } from '../stores/CostStore';

/**
 * Interface for a filtered Littera code with relevance scoring
 */
export interface FilteredLitteraCode extends LitteraMapping {
  relevanceScore: number;
  relevanceReasons: string[];
  priority: number; // 1 = highest, 5 = lowest
  activity?: string; // Activity type (formwork, reinforcement, etc.)
}

/**
 * Service for filtering Littera codes according to Finnish cost engineering strategy
 * 
 * Based on analysis of talo_littera_mapping.csv:
 * 
 * Littera Code Structure:
 * - 350010-350024: Summary/grouping codes (unit: ***) - US1-US8 categories
 * - 355xxx: Timber frame codes (puurunko, eriste, levytys)
 * - 315xxx: Precast concrete element codes
 * - 287xxx: Cast-in-place concrete codes  
 * - 454xxx/485xxx: Masonry and light partition codes
 * 
 * Filtering Strategy:
 * 1. EXCLUDE grouping codes (unit = ***)
 * 2. DETECT construction method (timber/precast/cast-in-place/masonry/light)
 * 3. FILTER by code range matching construction method
 * 4. PRIORITIZE by construction type (US1, VS4, etc.)
 * 5. SORT by component priority: structure > insulation > cladding > finishing
 */
export class LitteraFilteringService {
  private mappingService: TaloLitteraMappingService;
  private templateService: LitteraTemplateService;
  private useTemplates: boolean = true; // Feature flag to enable/disable template system

  constructor() {
    this.mappingService = TaloLitteraMappingService.getInstance();
    this.templateService = LitteraTemplateService.getInstance();
  }

  /**
   * Extracts construction type pattern from element name
   * Examples: "US1", "US2", "VS4", "USK", "VSP", "KS2"
   */
  private extractConstructionType(elementName: string): string | null {
    const normalized = elementName.toUpperCase();
    
    const patterns = [
      /\b(US[K]?[0-9]*)\b/i,   // Ulkoseinät
      /\b(VS[P]?[0-9]*)\b/i,   // Väliseinät
      /\b(KS[0-9]*)\b/i,       // Kantavat seinät
      /\b(AP[0-9]*)\b/i,       // Alapohja
      /\b(YP[0-9]*)\b/i,       // Yläpohja
      /\b(VP[0-9]*)\b/i,       // Välipohja
    ];
    
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return null;
  }

  /**
   * Detects construction method from element name
   * Uses centralized ConstructionMethodDetector for consistency
   * Returns: 'timber' | 'precast' | 'cast-in-place' | 'masonry' | 'light' | null
   */
  private detectConstructionMethod(elementName: string): string | null {
    return ConstructionMethodDetector.detect(elementName);
  }

  /**
   * Determines if a unit is compatible with available element quantities
   */
  private isUnitCompatible(
    litteraUnit: string,
    baseQuantities: BaseCostElement['baseQuantities']
  ): boolean {
    const unitUpper = litteraUnit.toUpperCase();
    
    const unitMappings: Record<string, string[]> = {
      'M2': ['Area', 'GrossArea', 'NetArea', 'GrossSideArea', 'NetSideArea'],
      'BRM2': ['GrossArea', 'Area'],
      'NM2': ['NetArea', 'Area'],
      'M3': ['Volume', 'GrossVolume', 'NetVolume'],
      'RM3': ['GrossVolume', 'Volume'],
      'NM3': ['NetVolume', 'Volume'],
      'JM': ['Length', 'Width', 'Height'],
      'M': ['Length', 'Width', 'Height'],
      'KPL': [], // Always compatible
      'ERÄ': [], // Always compatible
      'KG': [], // Always compatible
      'CM': ['Length'],
    };

    const compatibleKeys = unitMappings[unitUpper];
    
    if (compatibleKeys === undefined) {
      return true;
    }
    
    if (compatibleKeys.length === 0) {
      return true;
    }

    return Object.keys(baseQuantities).some(key => 
      compatibleKeys.some(compatible => 
        key.toLowerCase().includes(compatible.toLowerCase())
      )
    );
  }

  /**
   * Determines if a Littera code is a grouping/summary code
   */
  private isGroupingCode(littera: LitteraMapping): boolean {
    const unit = littera.unit.toUpperCase();
    const desc = littera.description.toLowerCase();
    
    if (unit === '***') {
      return true;
    }
    
    if (desc.includes('netto') && desc.includes('brutto') && desc.includes('xx')) {
      return true;
    }
    
    return false;
  }

  /**
   * Calculates relevance score for a Littera code
   */
  private calculateRelevanceScore(
    littera: LitteraMapping,
    element: BaseCostElement,
    constructionType: string | null,
    constructionMethod: string | null
  ): FilteredLitteraCode {
    let score = 0;
    const reasons: string[] = [];
    let priority = 5;

    const descLower = littera.description.toLowerCase();
    const descUpper = littera.description.toUpperCase();
    const elementNameUpper = element.name.toUpperCase();
    const code = littera.litteraCode;
    const unit = littera.unit.toUpperCase();

    // EXCLUSION: Skip grouping codes
    if (this.isGroupingCode(littera)) {
      return {
        ...littera,
        relevanceScore: -1000,
        relevanceReasons: ['Grouping/summary code (excluded)'],
        priority: 10
      };
    }

    // CRITICAL: Filter by construction method
    if (constructionMethod) {
      const codeStr = code.toString();
      
      if (constructionMethod === 'timber') {
        if (codeStr.startsWith('355') || descLower.includes('puurunko')) {
          score += 90;
          priority = 1;
          reasons.push('Timber construction method match');
        } else if (codeStr.startsWith('315') || codeStr.startsWith('287')) {
          score -= 100;
          reasons.push('Wrong method: concrete code for timber element');
        }
      }
      
      else if (constructionMethod === 'precast') {
        if (codeStr.startsWith('3152')) {
          // Primary elements (supply)
          score += 150;
          priority = 1;
          reasons.push('Precast concrete element - primary component');
        } else if (codeStr.startsWith('3155')) {
          // Installation
          score += 80;
          priority = 2;
          reasons.push('Precast concrete element - installation');
        } else if (codeStr.startsWith('3156')) {
          // Finishing/joints
          score += 50;
          priority = 3;
          reasons.push('Precast concrete element - finishing work');
        } else if (codeStr.startsWith('315')) {
          // Other 315xxx codes
          score += 70;
          priority = 2;
          reasons.push('Precast concrete element match');
        } else if (codeStr.startsWith('355')) {
          score -= 100;
          reasons.push('Wrong method: timber code for concrete element');
        }
      }
      
      else if (constructionMethod === 'cast-in-place') {
        if (codeStr.startsWith('231') || codeStr.startsWith('232') || codeStr.startsWith('233')) {
          // Detailed component codes (231xxx formwork, 232xxx reinforcement/concrete, 233xxx accessories)
          score += 140;
          priority = 1;
          reasons.push('Cast-in-place concrete - detailed component');
        } else if (codeStr.startsWith('287') || descLower.includes('pv ') || descLower.includes('paikallavalettu')) {
          // 287xxx codes (walls, etc)
          score += 120;
          priority = 1;
          reasons.push('Cast-in-place concrete match');
        } else if (codeStr.startsWith('260')) {
          // Aggregated codes (260xxx bundle multiple operations - less detail)
          score += 60;
          priority = 3;
          reasons.push('Cast-in-place concrete - aggregated code (lower detail)');
        } else if (codeStr.startsWith('23') || codeStr.startsWith('26')) {
          // Other 2xx codes
          score += 70;
          priority = 2;
          reasons.push('Cast-in-place concrete - general code');
        } else if (codeStr.startsWith('355') || codeStr.startsWith('315')) {
          score -= 100;
          reasons.push('Wrong method: timber/precast code for cast-in-place');
        }
      }
      
      else if (constructionMethod === 'masonry' || constructionMethod === 'light') {
        if (codeStr.startsWith('454') || codeStr.startsWith('485')) {
          score += 90;
          priority = 1;
          reasons.push('Masonry/light partition match');
        } else if (codeStr.startsWith('355') || codeStr.startsWith('315') || codeStr.startsWith('287')) {
          score -= 80;
          reasons.push('Wrong method: structural code for light partition');
        }
      }
    }

    // PRIORITY 1: Exact construction type match
    if (constructionType) {
      const ctLower = constructionType.toLowerCase();
      if (descLower.includes(ctLower) || descUpper.includes(constructionType)) {
        score += 100;
        priority = Math.min(priority, 1);
        reasons.push(`Exact match for construction type ${constructionType}`);
      } else {
        const baseType = constructionType.substring(0, 2);
        if (descLower.includes(baseType.toLowerCase()) || descUpper.includes(baseType)) {
          score += 70;
          priority = Math.min(priority, 2);
          reasons.push(`Generic match for type ${baseType}`);
        }
      }
    }

    // PRIORITY 2: Component-specific codes
    const codeStr = code.toString();
    if (codeStr.startsWith('355') || codeStr.startsWith('315') || 
        codeStr.startsWith('287') || codeStr.startsWith('454')) {
      score += 60;
      priority = Math.min(priority, 2);
      reasons.push('Component-specific code range');
    }

    // PRIORITY 3: Unit compatibility
    if (this.isUnitCompatible(unit, element.baseQuantities)) {
      score += 50;
      priority = Math.min(priority, 3);
      reasons.push(`Unit ${unit} compatible with IFC quantities`);
      
      if (element.type.toLowerCase().includes('wall') && unit === 'M2') {
        score += 20;
        reasons.push('M2 unit ideal for walls');
      } else if (element.type.toLowerCase().includes('slab') && (unit === 'M2' || unit === 'M3')) {
        score += 20;
        reasons.push('M2/M3 unit ideal for slabs');
      }

      // JM es la unidad natural para elementos lineales estructurales (vigas, pilares, barandillas, etc.)
      // Delta beams, teräspalkit, teräspilarit → siempre se miden en JM en construcción finlandesa.
      if ((unit === 'JM' || unit === 'M') && this.isLinearIfcType(element.type)) {
        score += 60;
        priority = Math.min(priority, 2);
        reasons.push('JM is natural measurement unit for linear structural element');
      }
    } else {
      // Softer penalty: Some units are always valid (KG for reinforcement, M3 for concrete)
      if (unit === 'KG' || unit === 'M3' || unit === 'KPL' || unit === 'ERÄ') {
        // No penalty for universal units
        reasons.push(`Unit ${unit} is universally applicable`);
      } else {
        score -= 30;
        reasons.push(`Unit ${unit} not compatible with available quantities`);
      }
    }

    // Component type priorities
    const structureKeywords = ['runko', 'raudoitus', 'muotti', 'betonointi', 'elementti'];
    if (structureKeywords.some(keyword => descLower.includes(keyword))) {
      score += 40;
      priority = Math.min(priority, 3);
      reasons.push('Primary structure component');
    }

    if (descLower.includes('eriste') || descLower.includes('lämmön')) {
      score += 35;
      priority = Math.min(priority, 4);
      reasons.push('Insulation component');
    }

    const claddingKeywords = ['verhous', 'levytys', 'koolaus', 'laudoitus'];
    if (claddingKeywords.some(keyword => descLower.includes(keyword))) {
      score += 30;
      priority = Math.min(priority, 4);
      reasons.push('Cladding/sheathing component');
    }

    if (descLower.includes('höyrynsulku') || descLower.includes('muovi') || descLower.includes('kermi')) {
      score += 25;
      priority = Math.min(priority, 4);
      reasons.push('Vapor barrier/membrane');
    }

    // Installation work (higher priority than finishing)
    if (descLower.includes('asennus')) {
      score += 35;
      priority = Math.min(priority, 3);
      reasons.push('Installation work');
    }

    // Finishing work (lower priority)
    if (descLower.includes('jälkityö') || descLower.includes('saumaus')) {
      score += 15;
      priority = Math.min(priority, 5);
      reasons.push('Finishing/joint work');
    }

    // Penalties
    if (descLower.includes('muu ') || descLower.includes('sekalaiset')) {
      score -= 40;
      reasons.push('Generic "other" code (penalty)');
    }

    if (!littera.description || littera.description.trim().length === 0) {
      score -= 50;
      reasons.push('Empty description (penalty)');
    }

    // Bonuses
    const elementWords = elementNameUpper.split(/[\s_\-:]+/).filter((w: string) => w.length > 3);
    const descWords = descUpper.split(/[\s_\-,]+/).filter((w: string) => w.length > 3);
    const matchingWords = elementWords.filter((w: string) => descWords.includes(w));
    if (matchingWords.length > 0) {
      const bonus = Math.min(matchingWords.length * 10, 30);
      score += bonus;
      reasons.push(`Keyword match: ${matchingWords.join(', ')}`);
    }

    if (littera.category) {
      const catLower = littera.category.toLowerCase();
      if (elementNameUpper.includes('WALL') || elementNameUpper.includes('SEINÄ')) {
        if (catLower.includes('seinä')) {
          score += 15;
          reasons.push('Category matches wall type');
        }
      }
    }

    return {
      ...littera,
      relevanceScore: Math.max(0, score),
      relevanceReasons: reasons,
      priority
    };
  }

  /**
   * Filters Littera codes for an element according to Finnish strategy
   * Uses template-based filtering for realistic component analysis
   */
  async getFilteredLitteraCodes(
    element: BaseCostElement,
    maxResults: number = 10
  ): Promise<FilteredLitteraCode[]> {
    const mcpByGlobalId = useCostStore.getState().ontelolaattaMcp?.byGlobalId ?? {};
    if (isConfirmedOntelolaattaElement(element, mcpByGlobalId)) {
      StructuredLogger.info(
        'LitteraFilteringService',
        'getFilteredLitteraCodes',
        'Skipping generic Littera for confirmed ontelolaatta (prefab package only)',
        { elementId: element.id, elementName: element.name }
      );
      return [];
    }

    return StructuredLogger.measure(
      'LitteraFilteringService',
      'getFilteredLitteraCodes',
      async () => {
    try {
      await this.mappingService.loadMappingData();
          
          // Try template-based filtering first
          if (this.useTemplates) {
            await this.templateService.loadTemplates();
            if (this.templateService.isTemplatesLoaded()) {
              const templateResults = await this.getFilteredLitteraCodesWithTemplates(element, maxResults);
              if (templateResults.length > 0) {
                StructuredLogger.info('LitteraFilteringService', 'getFilteredLitteraCodes', 
                  'Using template-based filtering', {
                    elementId: element.id,
                    elementName: element.name,
                    resultsCount: templateResults.length
                  });
                return templateResults;
              }
            }
          }
          
          // Fallback to legacy filtering
          StructuredLogger.info('LitteraFilteringService', 'getFilteredLitteraCodes', 
            'Using legacy filtering', {
              elementId: element.id,
              elementName: element.name
            });
          return await this.getFilteredLitteraCodesLegacy(element, maxResults);
    } catch (error) {
          const detailedError = ErrorHandler.handleAndLog(error, {
            service: 'LitteraFilteringService',
            operation: 'getFilteredLitteraCodes',
            elementId: element.id,
            elementName: element.name
          });
          
          // Return empty array on recoverable errors, throw on critical errors
          if (detailedError.recoverable) {
            StructuredLogger.warn('LitteraFilteringService', 'getFilteredLitteraCodes', 
              'Recoverable error, returning empty results', {
                errorType: detailedError.type
              });
            return [];
          }
          throw error;
        }
      }
    );
  }

  /**
   * NEW: Template-based filtering (realistic component analysis)
   */
  private async getFilteredLitteraCodesWithTemplates(
    element: BaseCostElement,
    maxResults: number
  ): Promise<FilteredLitteraCode[]> {
    // Get Nimikkeistö code
    let nimikkeistoCode = element.taloCode.replace(/\./g, '');
    if (nimikkeistoCode.length > 4) {
      nimikkeistoCode = nimikkeistoCode.substring(0, 4);
    }

    if (!nimikkeistoCode || nimikkeistoCode.length < 3) {
      return [];
    }

    // Find best matching template first
    const template = this.templateService.findTemplate(element);
    if (!template) {
      StructuredLogger.debug('LitteraFilteringService', 'getFilteredLitteraCodesWithTemplates', 
        'No template found, returning empty results', {
          elementId: element.id,
          elementName: element.name,
          nimikkeistoCode
        });
      return [];
    }

    StructuredLogger.info('LitteraFilteringService', 'getFilteredLitteraCodesWithTemplates', 
      'Applying template', {
        elementId: element.id,
        elementName: element.name,
        template: template.nimikkeistoName,
        method: template.constructionMethod,
        totalActivities: template.activities.length
      });

    // Get all littera mappings for this Nimikkeistö
    const allMappings = this.mappingService.getLitteraMappingsForNimikkeisto(
      nimikkeistoCode,
      element.taloName
    ).litteraMappings;

    if (allMappings.length === 0) {
      return [];
    }

    // Filter codes by template rules
    const filteredCodes: FilteredLitteraCode[] = [];

    // Process each activity in priority order
    const sortedActivities = [...template.activities].sort((a, b) => a.priority - b.priority);

    for (const activityRule of sortedActivities) {
      const activityCodes = this.filterByActivityRule(
        allMappings,
        activityRule,
        element,
        template
      );

      filteredCodes.push(...activityCodes);
    }

    // Apply exclusion rules
    const excludedCodes = this.applyExclusionRules(filteredCodes, template, element);

    // Sort by priority and relevance
    excludedCodes.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return b.relevanceScore - a.relevanceScore;
    });

    // Limit results
    const limited = excludedCodes.slice(0, Math.min(maxResults, 15));

    StructuredLogger.info('LitteraFilteringService', 'getFilteredLitteraCodesWithTemplates', 
      'Template filtering completed', {
        elementId: element.id,
        totalCodes: limited.length,
        byActivity: this.groupByActivity(limited)
      });

    return limited;
  }

  /**
   * Filter Littera codes by activity rule
   */
  private filterByActivityRule(
    allCodes: LitteraMapping[],
    activityRule: ActivityRule,
    element: BaseCostElement,
    template: LitteraTemplate
  ): FilteredLitteraCode[] {
    const results: FilteredLitteraCode[] = [];

    // Filter by code range
    const candidateCodes = allCodes.filter(code => {
      const codeStr = code.litteraCode.substring(0, 3);
      return activityRule.codeRanges.some(range => codeStr === range);
    });

    // Filter by unit
    const unitFiltered = candidateCodes.filter(code => {
      if (activityRule.units.length === 0) return true;
      return activityRule.units.some(unit => 
        code.unit.toUpperCase().includes(unit.toUpperCase())
      );
    });

    // Filter by keywords with improved validation
    const keywordFiltered = unitFiltered.filter(code => {
      const descLower = code.description.toLowerCase();
      
      // Check exclude keywords
      if (activityRule.excludeKeywords.length > 0) {
        const hasExclude = activityRule.excludeKeywords.some(keyword =>
          descLower.includes(keyword.toLowerCase())
        );
        if (hasExclude) return false;
      }

      // Check include keywords - require at least one match
      if (activityRule.keywords.length === 0) return true;
      
      // At least one keyword must match
      const hasKeyword = activityRule.keywords.some(keyword =>
        descLower.includes(keyword.toLowerCase())
      );
      
      if (!hasKeyword) return false;
      
      // Additional validation: if activity is specific (asennus, toimitus, etc.),
      // prefer codes that mention the activity explicitly
      // But don't exclude codes that don't mention it (they might still be valid)
      return true;
    });

    // Score and select best matches
    const scored = keywordFiltered.map(code => {
      const score = this.scoreCodeForActivity(code, activityRule, element);
      const reasons: string[] = [`Activity: ${activityRule.activity}`];
      
      if (activityRule.required) {
        reasons.push('Required activity');
      }
      
      return {
        ...code,
        relevanceScore: score,
        relevanceReasons: reasons,
        priority: activityRule.priority,
        activity: activityRule.activity
      } as FilteredLitteraCode;
    });

    // Sort by score and limit
    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    // Deduplicate variants - keep only best match
    const deduplicated = this.deduplicateVariants(scored);
    
    // Take top N based on maxCodes
    const limited = deduplicated.slice(0, activityRule.maxCodes);

    return limited;
  }

  /**
   * Score a code for an activity
   */
  private scoreCodeForActivity(
    code: LitteraMapping,
    activityRule: ActivityRule,
    element: BaseCostElement
  ): number {
    let score = 100; // Base score
    const descLower = code.description.toLowerCase();
    const nameLower = element.name.toLowerCase();
    const activityLower = activityRule.activity.toLowerCase();

    // Boost score if code explicitly mentions the activity
    // This prioritizes codes that are specific to the activity
    if (descLower.includes(activityLower)) {
      score += 100; // Strong boost for explicit activity mention
    } else {
      // Penalize codes that don't mention the activity for specific activities
      // But only for clearly defined activities, not generic ones
      const specificActivities = ['asennus', 'toimitus', 'juotosvalut', 'tartunnat', 'liitokset'];
      if (specificActivities.includes(activityLower)) {
        score -= 30; // Small penalty for not mentioning specific activity
      }
    }

    // Boost score for matching all keywords (not just some)
    if (activityRule.keywords.length > 0) {
      const matchingKeywords = activityRule.keywords.filter(keyword =>
        descLower.includes(keyword.toLowerCase())
      ).length;
      const keywordMatchRatio = matchingKeywords / activityRule.keywords.length;
      if (keywordMatchRatio === 1.0) {
        score += 50; // Perfect keyword match
      } else if (keywordMatchRatio >= 0.5) {
        score += 20; // Good keyword match
      }
    }

    // Match thickness/dimensions if present
    const thicknessMatch = this.extractThickness(element.name);
    if (thicknessMatch) {
      const codeThickness = this.extractThickness(code.description);
      if (codeThickness) {
        const diff = Math.abs(thicknessMatch - codeThickness);
        if (diff === 0) {
          score += 50; // Perfect match
        } else if (diff <= 20) {
          score += 30; // Close match
        } else if (diff <= 50) {
          score += 10; // Approximate match
        }
      }
    }

    // Match construction type (AP1, VS4, etc.)
    const constructionType = this.extractConstructionType(element.name);
    if (constructionType) {
      if (descLower.includes(constructionType.toLowerCase())) {
        score += 40;
      }
    }

    // Prefer specific over generic codes
    if (descLower.includes('xx') || descLower.includes('yy')) {
      score -= 20; // Generic placeholder
    }

    // Match element type keywords
    const elementKeywords = nameLower.split(/[:\s,]+/);
    elementKeywords.forEach(keyword => {
      if (keyword.length > 3 && descLower.includes(keyword)) {
        score += 10;
      }
    });

    return score;
  }

  /**
   * Extract thickness from text (e.g., "80mm" -> 80)
   */
  private extractThickness(text: string): number | null {
    const match = text.match(/(\d+)\s*mm/i);
    return match ? parseInt(match[1]) : null;
  }

  /**
   * Deduplicate variant codes (e.g., multiple "AP1 betonointi" codes)
   */
  private deduplicateVariants(codes: FilteredLitteraCode[]): FilteredLitteraCode[] {
    const variants = new Map<string, FilteredLitteraCode>();

    codes.forEach(code => {
      // Normalize description to detect variants
      const normalized = code.description
        .toLowerCase()
        .replace(/\d+/g, 'X')
        .replace(/xx/gi, 'X')
        .replace(/yy/gi, 'Y')
        .trim();

      const existing = variants.get(normalized);
      if (!existing || code.relevanceScore > existing.relevanceScore) {
        variants.set(normalized, code);
      }
    });

    return Array.from(variants.values());
  }

  /**
   * Apply exclusion rules from template
   */
  private applyExclusionRules(
    codes: FilteredLitteraCode[],
    template: LitteraTemplate,
    element: BaseCostElement
  ): FilteredLitteraCode[] {
    const nameLower = element.name.toLowerCase();

    return codes.filter(code => {
      // Check each exclusion rule
      for (const exclusion of template.excludeContexts) {
        const codeRange = code.litteraCode.substring(0, 3);
        
        // If code is in excluded range
        if (exclusion.codeRanges.includes(codeRange)) {
          // Check if element has the context keywords
          const hasContext = exclusion.keywords.some(keyword =>
            nameLower.includes(keyword.toLowerCase())
          );
          
          // Exclude if context is NOT present
          if (!hasContext) {
            StructuredLogger.debug('LitteraFilteringService', 'applyExclusionRules', 
              'Excluding code due to missing context', {
                code: code.litteraCode,
                reason: exclusion.reason,
                element: element.name
              });
            return false;
          }
        }
      }
      
      return true;
    });
  }

  /**
   * Group codes by activity for logging
   */
  private groupByActivity(codes: FilteredLitteraCode[]): Record<string, number> {
    const groups: Record<string, number> = {};
    codes.forEach(code => {
      const activity = code.activity || 'other';
      groups[activity] = (groups[activity] || 0) + 1;
    });
    return groups;
  }

  /**
   * LEGACY: Original filtering method (kept as fallback)
   */
  private async getFilteredLitteraCodesLegacy(
    element: BaseCostElement,
    maxResults: number = 10
  ): Promise<FilteredLitteraCode[]> {

    let nimikkeistoCode = element.taloCode.replace(/\./g, '');
    
    if (nimikkeistoCode.length > 4) {
      nimikkeistoCode = nimikkeistoCode.substring(0, 4);
    }

    if (!nimikkeistoCode || nimikkeistoCode.length < 3) {
      return [];
    }

    const mapping = this.mappingService.getLitteraMappingsForNimikkeisto(
      nimikkeistoCode,
      element.taloName
    );

    if (mapping.litteraMappings.length === 0) {
      return [];
    }

    const constructionType = this.extractConstructionType(element.name);
    const constructionMethod = this.detectConstructionMethod(element.name);

    StructuredLogger.debug('LitteraFilteringService', 'getFilteredLitteraCodesLegacy', 
      'Processing element with legacy filtering', {
      id: element.id,
      name: element.name,
      taloCode: element.taloCode,
      nimikkeistoCode,
      constructionType,
      constructionMethod,
      totalLitteraCodes: mapping.litteraMappings.length
    });

    const filteredCodes = mapping.litteraMappings
      .map(littera => this.calculateRelevanceScore(littera, element, constructionType, constructionMethod))
      .filter(code => code.relevanceScore >= 0)
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return b.relevanceScore - a.relevanceScore;
      })
      .slice(0, maxResults);

    StructuredLogger.info('LitteraFilteringService', 'getFilteredLitteraCodesLegacy', 
      'Legacy filtering completed', {
      elementId: element.id,
      filteredCount: filteredCodes.length,
      topCodes: filteredCodes.slice(0, 5).map(c => ({
        code: c.litteraCode,
        score: c.relevanceScore,
        priority: c.priority,
        unit: c.unit
      }))
    });

    return filteredCodes;
  }

  /**
   * Returns true for IFC types that are inherently linear (measured in running meters).
   * Used to boost JM unit scores so steel beams, columns, railings, etc. always get JM suggestions.
   */
  private isLinearIfcType(ifcType: string): boolean {
    const t = (ifcType || '').toUpperCase();
    return (
      t.includes('BEAM') ||
      t.includes('COLUMN') ||
      t.includes('PILE') ||
      t.includes('RAILING') ||
      t.includes('MEMBER') ||
      t.includes('PIPE') ||
      t.includes('CABLE')
    );
  }

  /**
   * Enable or disable template-based filtering
   */
  setUseTemplates(use: boolean): void {
    this.useTemplates = use;
    StructuredLogger.info('LitteraFilteringService', 'setUseTemplates', 
      `Template-based filtering ${use ? 'enabled' : 'disabled'}`);
  }

  /**
   * Gets the most relevant Littera code
   */
  async getMostRelevantLitteraCode(
    element: BaseCostElement
  ): Promise<LitteraMapping | null> {
    const filtered = await this.getFilteredLitteraCodes(element, 1);
    return filtered.length > 0 ? filtered[0] : null;
  }
}

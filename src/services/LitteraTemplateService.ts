/**
 * Service for loading and managing Littera filter templates
 * Templates define realistic filtering rules based on construction component analysis
 */

import type { BaseCostElement } from '../types/cost';
import type { LitteraMapping } from './TaloLitteraMappingService';
import { ConstructionMethodDetector } from '../utils/ConstructionMethodDetector';
import { StructuredLogger } from '../utils/StructuredLogger';
import { ErrorHandler, ErrorType } from '../utils/ErrorHandler';
import { CSVValidator } from '../utils/CSVValidator';

/**
 * Activity rule from template
 */
export interface ActivityRule {
  activity: string;
  codeRanges: string[]; // e.g., ['231', '232', '260']
  priority: number; // 1=critical, 2=usual, 3=optional
  maxCodes: number; // Maximum codes to return for this activity
  units: string[]; // Allowed units (M2, KG, etc.)
  keywords: string[]; // Keywords to search in description
  excludeKeywords: string[]; // Keywords to exclude
  required: boolean;
}

/**
 * Context exclusion rule
 */
export interface ExclusionRule {
  context: string;
  codeRanges: string[];
  keywords: string[];
  reason: string;
}

/**
 * Template for filtering Littera codes
 */
export interface LitteraTemplate {
  nimikkeistoCode: string;
  nimikkeistoName: string;
  ifcType: string;
  constructionMethod: string;
  contextRequired?: string[]; // Keywords that must be present
  activities: ActivityRule[];
  excludeContexts: ExclusionRule[];
  notes: string;
}

/**
 * Service to load and query Littera filter templates
 */
export class LitteraTemplateService {
  private static instance: LitteraTemplateService;
  private templates: LitteraTemplate[] = [];
  private isLoaded = false;

  private constructor() {}

  static getInstance(): LitteraTemplateService {
    if (!LitteraTemplateService.instance) {
      LitteraTemplateService.instance = new LitteraTemplateService();
    }
    return LitteraTemplateService.instance;
  }

  /**
   * Load templates from CSV file with validation and error handling
   */
  async loadTemplates(): Promise<void> {
    if (this.isLoaded) {
      StructuredLogger.debug('LitteraTemplateService', 'loadTemplates', 'Templates already loaded');
      return;
    }

    return StructuredLogger.measure(
      'LitteraTemplateService',
      'loadTemplates',
      async () => {
        try {
          StructuredLogger.info('LitteraTemplateService', 'loadTemplates', 'Loading templates from CSV');
          
          // Try to load from different paths
          const possiblePaths = [
            '/src/data/littera-filter-templates.csv',
            './src/data/littera-filter-templates.csv',
            '../data/littera-filter-templates.csv',
            'src/data/littera-filter-templates.csv'
          ];

          let csvText: string | null = null;
          let loadedPath: string | null = null;
          
          for (const path of possiblePaths) {
            try {
              const response = await fetch(path);
              if (response.ok) {
                csvText = await response.text();
                loadedPath = path;
                StructuredLogger.debug('LitteraTemplateService', 'loadTemplates', 
                  'CSV file loaded successfully', { path });
                break;
              }
            } catch (err) {
              // Continue to next path
              continue;
            }
          }

          if (!csvText) {
            const error = ErrorHandler.handle(
              new Error('Could not load templates CSV from any known path'),
              { paths: possiblePaths }
            );
            ErrorHandler.log(error);
            
            StructuredLogger.warn('LitteraTemplateService', 'loadTemplates', 
              'Using default templates', { reason: 'CSV file not found' });
            this.createDefaultTemplates();
            this.isLoaded = true;
            return;
          }

          // Validate CSV before parsing
          StructuredLogger.info('LitteraTemplateService', 'loadTemplates', 'Validating CSV');
          const validation = CSVValidator.validate(csvText);
          
          if (!validation.isValid) {
            StructuredLogger.error('LitteraTemplateService', 'loadTemplates', 
              'CSV validation failed', {
                errors: validation.errors.length,
                warnings: validation.warnings.length,
                stats: validation.stats
              });
            
            // Log first 10 errors
            validation.errors.slice(0, 10).forEach(err => {
              StructuredLogger.error('LitteraTemplateService', 'loadTemplates', 
                `Line ${err.line}: ${err.message}`, {
                  field: err.field,
                  value: err.value
                });
            });
            
            // If there are critical errors, throw
            if (validation.errors.length > 0) {
              const validationError = ErrorHandler.create(
                ErrorType.CSV_VALIDATION_ERROR,
                `CSV validation failed with ${validation.errors.length} errors. See logs for details.`,
                {
                  context: {
                    errors: validation.errors.length,
                    warnings: validation.warnings.length,
                    stats: validation.stats
                  },
                  recoverable: true
                }
              );
              ErrorHandler.log(validationError);
              
              // Still try to parse, but log warnings
              StructuredLogger.warn('LitteraTemplateService', 'loadTemplates', 
                'Parsing CSV despite validation errors');
            }
          }
          
          if (validation.warnings.length > 0) {
            StructuredLogger.warn('LitteraTemplateService', 'loadTemplates', 
              `CSV validation found ${validation.warnings.length} warnings`);
            validation.warnings.slice(0, 5).forEach(warn => {
              StructuredLogger.warn('LitteraTemplateService', 'loadTemplates', 
                `Line ${warn.line}: ${warn.message}`, {
                  field: warn.field,
                  value: warn.value
                });
            });
          }

          // Parse CSV
          this.parseCSV(csvText);
          this.isLoaded = true;
          
          StructuredLogger.info('LitteraTemplateService', 'loadTemplates', 
            'Templates loaded successfully', {
              path: loadedPath,
              totalTemplates: this.templates.length,
              totalActivities: this.templates.reduce((sum, t) => sum + t.activities.length, 0),
              validationErrors: validation.errors.length,
              validationWarnings: validation.warnings.length
            });
        } catch (error) {
          const detailedError = ErrorHandler.handleAndLog(error, {
            service: 'LitteraTemplateService',
            operation: 'loadTemplates'
          });
          
          // Recovery: use default templates
          if (detailedError.recoverable) {
            StructuredLogger.warn('LitteraTemplateService', 'loadTemplates', 
              'Recovering with default templates', {
                errorType: detailedError.type
              });
            this.createDefaultTemplates();
          } else {
            // Re-throw critical errors
            throw error;
          }
          this.isLoaded = true;
        }
      }
    );
  }

  /**
   * Parse CSV text into templates
   * Supports bilingual headers (Finnish / English)
   */
  private parseCSV(csvText: string): void {
    const lines = csvText.split('\n');
    const templateMap = new Map<string, LitteraTemplate>();

    // Skip header (now with bilingual names)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const row = this.parseCSVRow(line);
      if (row.length < 14) continue;

      const [
        nimikkeistoCode,          // Nimikkeistö-koodi
        nimikkeistoName,          // Nimikkeistö-nimi
        ifcType,                  // IFC Type
        constructionMethod,       // Rakennusmenetelmä / Construction Method
        contextRequired,          // Vaadittu konteksti / Context Required
        activity,                 // Työvaihe / Activity
        codeRange,                // Littera-koodialue / Code Range
        unit,                     // Yksikkö / Unit
        keywords,                 // Avainsanat / Keywords
        excludeKeywords,          // Poissulkevat avainsanat / Exclude Keywords
        priority,                 // Prioriteetti / Priority
        maxCodes,                 // Maksimi koodit / Max Codes
        required,                 // Required
        notes                     // Huomautukset / Notes
      ] = row;

      // Create unique key for template
      const templateKey = `${nimikkeistoCode}_${constructionMethod}_${contextRequired}`;

      // Get or create template
      let template = templateMap.get(templateKey);
      if (!template) {
        template = {
          nimikkeistoCode,
          nimikkeistoName: nimikkeistoName.replace(/^"|"$/g, ''),
          ifcType,
          constructionMethod,
          contextRequired: contextRequired ? contextRequired.split(',').map(k => k.trim()) : undefined,
          activities: [],
          excludeContexts: [],
          notes: notes.replace(/^"|"$/g, '')
        };
        templateMap.set(templateKey, template);
      }

      // Add activity rule
      const activityRule: ActivityRule = {
        activity,
        codeRanges: codeRange.split(',').map(r => r.trim()),
        priority: parseInt(priority) || 3,
        maxCodes: parseInt(maxCodes) || 1,
        units: unit.split(',').map(u => u.trim()),
        keywords: keywords.replace(/^"|"$/g, '').split(',').map(k => k.trim()).filter(k => k),
        excludeKeywords: excludeKeywords.replace(/^"|"$/g, '').split(',').map(k => k.trim()).filter(k => k),
        required: required.toUpperCase() === 'YES'
      };

      template.activities.push(activityRule);
    }

    this.templates = Array.from(templateMap.values());
  }

  /**
   * Parse CSV row handling quoted fields
   */
  private parseCSVRow(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current);
    return result;
  }

  /**
   * Find best matching template for an element
   * Uses hierarchical search: exact Nimikkeistö → parent levels → IFC Type + method
   */
  findTemplate(element: BaseCostElement): LitteraTemplate | null {
    const nimikkeistoCode = element.taloCode.replace(/\./g, '').substring(0, 4);
    const elementNameLower = element.name.toLowerCase();
    const ifcType = element.type;
    const method = this.detectConstructionMethod(element.name);

    // Strategy 1: Find templates matching exact Nimikkeistö code
    let candidateTemplates = this.templates.filter(t => 
      t.nimikkeistoCode === nimikkeistoCode
    );

    // Strategy 2: If no exact match, try parent Nimikkeistö levels (e.g., 123 → 1234, 1233)
    if (candidateTemplates.length === 0 && nimikkeistoCode.length >= 3) {
      // Try 4-digit codes that start with the 3-digit code
      const parentCode = nimikkeistoCode.substring(0, 3);
      candidateTemplates = this.templates.filter(t => 
        t.nimikkeistoCode.startsWith(parentCode) && t.nimikkeistoCode.length === 4
      );
    }

    // Strategy 3: If still no match, search by IFC Type + construction method
    if (candidateTemplates.length === 0) {
      candidateTemplates = this.templates.filter(t => 
        t.ifcType === ifcType && t.constructionMethod === method
      );
    }

    // Strategy 4: Last resort - search by IFC Type only
    if (candidateTemplates.length === 0) {
      candidateTemplates = this.templates.filter(t => 
        t.ifcType === ifcType
      );
    }

    if (candidateTemplates.length === 0) {
      return null;
    }

    // Score each template based on context match
    const scoredTemplates = candidateTemplates.map(template => {
      let score = 0;

      // Match IFC type
      if (template.ifcType === ifcType) {
        score += 100;
      }

      // Match construction method
      const method = this.detectConstructionMethod(element.name);
      if (method === template.constructionMethod) {
        score += 50;
      }

      // Match required context
      if (template.contextRequired) {
        // Use .some() instead of .every() - at least one keyword must match
        // This allows templates like "hea,heb,hem,ipe" to match elements with just "heb"
        const hasRequired = template.contextRequired.some(keyword =>
          elementNameLower.includes(keyword.toLowerCase())
        );
        if (hasRequired) {
          score += 150;
        } else {
          score -= 100; // Penalize if required context is missing
        }
      }

      // Prefer templates without context requirements if element has no special keywords
      if (!template.contextRequired) {
        const hasSpecialContext = this.hasSpecialContext(element.name);
        if (!hasSpecialContext) {
          score += 25;
        }
      }

      return { template, score };
    });

    // Sort by score and return best match
    scoredTemplates.sort((a, b) => b.score - a.score);
    
    const best = scoredTemplates[0];
    if (best.score > 0) {
      StructuredLogger.debug('LitteraTemplateService', 'findTemplate', 
        'Template selected', {
          element: element.name,
          elementId: element.id,
          template: best.template.nimikkeistoName,
          method: best.template.constructionMethod,
          score: best.score
        });
      return best.template;
    }

    StructuredLogger.debug('LitteraTemplateService', 'findTemplate', 
      'No suitable template found', {
        element: element.name,
        elementId: element.id,
        nimikkeistoCode
      });
    return null;
  }

  /**
   * Detect construction method from element name
   * Uses centralized ConstructionMethodDetector and converts to Finnish for template matching
   * Supports Finnish and English terms
   */
  private detectConstructionMethod(elementName: string): string {
    const method = ConstructionMethodDetector.detect(elementName);
    return ConstructionMethodDetector.toFinnish(method);
  }

  /**
   * Check if element has special context keywords
   * Supports Finnish and English terms
   */
  private hasSpecialContext(elementName: string): boolean {
    const nameLower = elementName.toLowerCase();
    const specialKeywords = [
      // Garage / Autohalli
      'autohall', 'garage', 'parking', 'pysäköinti',
      // Precast / Elementti
      'elementti', 'precast', 'sandwich', 'esivalmistet',
      // Ramps/Stairs / Luiska/Portaat
      'luiska', 'ramp', 'portai', 'stair', 'trap',
      // Timber / Puurunko
      'puurunko', 'timber', 'puu',
      // Masonry / Muuraus
      'harkko', 'tiili', 'masonry', 'kahi', 'muuraus',
      // Light / Kevyt
      'kevyt', 'light', 'kipsi', 'levy'
    ];
    
    return specialKeywords.some(keyword => nameLower.includes(keyword));
  }

  /**
   * Create default templates if CSV loading fails
   */
  private createDefaultTemplates(): void {
    // Create minimal default template for basic slabs
    this.templates = [
      {
        nimikkeistoCode: '1221',
        nimikkeistoName: 'Alapohjalaatat (Default)',
        ifcType: 'IfcSlab',
        constructionMethod: 'cast-in-place',
        activities: [
          {
            activity: 'formwork',
            codeRanges: ['231'],
            priority: 1,
            maxCodes: 2,
            units: ['M2', 'JM'],
            keywords: ['muott'],
            excludeKeywords: [],
            required: true
          },
          {
            activity: 'reinforcement',
            codeRanges: ['232', '260'],
            priority: 1,
            maxCodes: 2,
            units: ['KG'],
            keywords: ['raudoit'],
            excludeKeywords: [],
            required: true
          },
          {
            activity: 'concreting',
            codeRanges: ['232', '260'],
            priority: 1,
            maxCodes: 1,
            units: ['M2', 'M3'],
            keywords: ['beton'],
            excludeKeywords: ['luiska', 'portai', 'autohall'],
            required: true
          },
          {
            activity: 'finishing',
            codeRanges: ['232', '260'],
            priority: 2,
            maxCodes: 1,
            units: ['M2'],
            keywords: ['hierto', 'pinta'],
            excludeKeywords: [],
            required: false
          }
        ],
        excludeContexts: [
          {
            context: 'garage',
            codeRanges: ['287'],
            keywords: ['autohall', 'garage'],
            reason: 'Only for garage slabs'
          },
          {
            context: 'precast',
            codeRanges: ['315'],
            keywords: ['elementti'],
            reason: 'Only for precast elements'
          }
        ],
        notes: 'Default template for ground slabs'
      }
    ];
    
    StructuredLogger.info('LitteraTemplateService', 'createDefaultTemplates', 
      'Using default templates', {
        templateCount: this.templates.length
      });
  }

  /**
   * Get all loaded templates
   */
  getTemplates(): LitteraTemplate[] {
    return this.templates;
  }

  /**
   * Check if templates are loaded
   */
  isTemplatesLoaded(): boolean {
    return this.isLoaded;
  }
}


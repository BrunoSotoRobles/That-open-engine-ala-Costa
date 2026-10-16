import { LitteraFilteringService, FilteredLitteraCode } from '../services/LitteraFilteringService';
import { BaseCostElement } from '../types/cost/shared';

// Validation cases removed - tool disabled
const validationCases = { validationCases: [] };

/**
 * Validation result for a single test case
 */
interface ValidationResult {
  caseId: string;
  description: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
  actualTopCodes: Array<{
    code: string;
    description: string;
    unit: string;
    score: number;
    priority: number;
  }>;
  expectedFound: string[];
  expectedMissing: string[];
  excludedFound: string[];
  score: number; // 0-100
}

/**
 * Summary of all validation results
 */
interface ValidationSummary {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  overallScore: number;
  criticalIssues: string[];
  results: ValidationResult[];
}

/**
 * Validates the LitteraFilteringService against known test cases
 */
export class LitteraValidationTool {
  private filteringService: LitteraFilteringService;

  constructor() {
    this.filteringService = new LitteraFilteringService();
  }

  /**
   * Runs all validation cases and returns summary
   */
  async validateAll(): Promise<ValidationSummary> {
    const results: ValidationResult[] = [];
    const criticalIssues: string[] = [];

    console.log('[LitteraValidation] Starting validation with', validationCases.validationCases.length, 'test cases');

    for (const testCase of validationCases.validationCases) {
      const result = await this.validateCase(testCase);
      results.push(result);

      if (!result.passed && result.errors.length > 0) {
        criticalIssues.push(`${testCase.id}: ${result.errors.join(', ')}`);
      }
    }

    const passedCases = results.filter(r => r.passed).length;
    const overallScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

    const summary: ValidationSummary = {
      totalCases: results.length,
      passedCases,
      failedCases: results.length - passedCases,
      overallScore: Math.round(overallScore),
      criticalIssues,
      results
    };

    this.logSummary(summary);
    return summary;
  }

  /**
   * Validates a single test case
   */
  private async validateCase(testCase: any): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let caseScore = 0;

    // Create BaseCostElement from test case
    const element: BaseCostElement = {
      id: Date.now(),
      name: testCase.elementName,
      type: testCase.elementType,
      category: testCase.elementType,
      quantity: testCase.baseQuantities?.Area?.value || 1,
      taloCode: testCase.taloCode,
      taloName: 'TALO2000',
      baseQuantities: testCase.baseQuantities || {},
      costs: {
        material: 0,
        labor: 0,
        equipment: 0,
        overhead: 0,
        total: 0
      }
    };

    // Get filtered codes from service
    const filteredCodes = await this.filteringService.getFilteredLitteraCodes(element, 10);

    // Extract actual top codes for comparison
    const actualTopCodes = filteredCodes.slice(0, 5).map(code => ({
      code: code.litteraCode,
      description: code.description,
      unit: code.unit,
      score: code.relevanceScore,
      priority: code.priority
    }));

    // Check 1: Expected codes should be in top results
    const expectedCodes = testCase.expectedTop5Codes.map((c: any) => c.litteraCode);
    const actualCodes = filteredCodes.map(c => c.litteraCode);
    
    const expectedFound: string[] = [];
    const expectedMissing: string[] = [];
    
    for (const expectedCode of expectedCodes) {
      if (actualCodes.includes(expectedCode)) {
        expectedFound.push(expectedCode);
        caseScore += 15; // 15 points per expected code found
      } else {
        expectedMissing.push(expectedCode);
        errors.push(`Expected code ${expectedCode} not found in suggestions`);
      }
    }

    // Check 2: Excluded codes must NOT appear (CRITICAL)
    const excludedCodes = testCase.mustExcludeCodes.map((c: any) => c.litteraCode);
    const excludedFound: string[] = [];
    
    for (const excludedCode of excludedCodes) {
      if (actualCodes.includes(excludedCode)) {
        excludedFound.push(excludedCode);
        errors.push(`CRITICAL: Excluded code ${excludedCode} found in suggestions`);
        caseScore -= 20; // Heavy penalty for including excluded codes
      } else {
        caseScore += 10; // Bonus for correctly excluding
      }
    }

    // Check 3: All grouping codes (unit=***) must be excluded
    const groupingCodesFound = filteredCodes.filter(c => c.unit === '***');
    if (groupingCodesFound.length > 0) {
      errors.push(`CRITICAL: Found ${groupingCodesFound.length} grouping codes (unit=***) in suggestions`);
      groupingCodesFound.forEach(code => {
        errors.push(`  - ${code.litteraCode}: ${code.description}`);
      });
      caseScore -= 30; // Very heavy penalty
    } else {
      caseScore += 20; // Bonus for correctly excluding all grouping codes
    }

    // Check 4: Top result should have expected priority level
    if (filteredCodes.length > 0) {
      const topCode = filteredCodes[0];
      if (topCode.priority <= testCase.expectedPriority) {
        caseScore += 10;
      } else {
        warnings.push(`Top code priority ${topCode.priority} is lower than expected ${testCase.expectedPriority}`);
      }

      // Check minimum relevance score
      if (topCode.relevanceScore >= testCase.minRelevanceScore) {
        caseScore += 10;
      } else {
        warnings.push(`Top code score ${topCode.relevanceScore} below minimum ${testCase.minRelevanceScore}`);
      }
    }

    // Normalize score to 0-100
    const maxPossibleScore = (expectedCodes.length * 15) + (excludedCodes.length * 10) + 20 + 10 + 10;
    const normalizedScore = Math.max(0, Math.min(100, (caseScore / maxPossibleScore) * 100));

    const passed = errors.length === 0 && normalizedScore >= 70;

    return {
      caseId: testCase.id,
      description: testCase.description,
      passed,
      errors,
      warnings,
      actualTopCodes,
      expectedFound,
      expectedMissing,
      excludedFound,
      score: Math.round(normalizedScore)
    };
  }

  /**
   * Logs validation summary to console
   */
  private logSummary(summary: ValidationSummary): void {
    console.log('\n========================================');
    console.log('  LITTERA VALIDATION SUMMARY');
    console.log('========================================');
    console.log(`Total Cases: ${summary.totalCases}`);
    console.log(`Passed: ${summary.passedCases} (${Math.round((summary.passedCases / summary.totalCases) * 100)}%)`);
    console.log(`Failed: ${summary.failedCases}`);
    console.log(`Overall Score: ${summary.overallScore}/100`);
    console.log('========================================\n');

    if (summary.criticalIssues.length > 0) {
      console.log('⚠️  CRITICAL ISSUES:');
      summary.criticalIssues.forEach(issue => console.log(`   - ${issue}`));
      console.log('');
    }

    summary.results.forEach(result => {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.caseId}: ${result.description} (Score: ${result.score}/100)`);
      
      if (result.errors.length > 0) {
        console.log('   Errors:');
        result.errors.forEach(err => console.log(`     - ${err}`));
      }
      
      if (result.warnings.length > 0) {
        console.log('   Warnings:');
        result.warnings.forEach(warn => console.log(`     - ${warn}`));
      }

      if (result.expectedMissing.length > 0) {
        console.log(`   Missing expected codes: ${result.expectedMissing.join(', ')}`);
      }

      if (result.excludedFound.length > 0) {
        console.log(`   ⚠️  Found excluded codes: ${result.excludedFound.join(', ')}`);
      }

      console.log(`   Top 5 actual codes: ${result.actualTopCodes.map(c => c.code).join(', ')}`);
      console.log('');
    });
  }

  /**
   * Exports validation results to JSON file
   */
  exportResults(summary: ValidationSummary): string {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `littera-validation-results-${timestamp}.json`;
    
    const exportData = {
      ...summary,
      metadata: {
        timestamp: new Date().toISOString(),
        validationFile: 'littera_validation_cases.json',
        serviceVersion: '1.0'
      }
    };

    return JSON.stringify(exportData, null, 2);
  }
}

/**
 * Quick validation function for use in console or tests
 */
export async function runLitteraValidation(): Promise<ValidationSummary> {
  const validator = new LitteraValidationTool();
  const summary = await validator.validateAll();
  
  // Export results
  const resultsJSON = validator.exportResults(summary);
  console.log('\n📄 Validation results ready for export');
  console.log('Copy this JSON to save results:\n');
  console.log(resultsJSON);
  
  return summary;
}


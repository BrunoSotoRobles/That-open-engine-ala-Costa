/**
 * CSV validation utility for Littera filter templates
 * 
 * Validates:
 * - File structure (headers, column count)
 * - Data types and formats
 * - Code ranges and units
 * - Business rules
 */

export interface CSVValidationError {
  line: number;
  field?: string;
  message: string;
  severity: 'error' | 'warning';
  value?: string;
}

export interface CSVValidationResult {
  isValid: boolean;
  errors: CSVValidationError[];
  warnings: CSVValidationError[];
  stats: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    skippedRows: number;
  };
}

// Valid Littera code ranges (first 3 digits)
const VALID_LITTERA_CODE_RANGES = [
  '231', '232', '233', '260', '271', '287', 
  '315', '331', '332', '334', '355', '356',
  '371', '372', '373', '375', '376', '413',
  '416', '433', '436', '437', '454', '456'
];

// Valid units
const VALID_UNITS = [
  'M2', 'M3', 'JM', 'KPL', 'KG', 'AS', 'ERÄ', 
  'CM', 'BRM2', 'NM2', 'RM3', 'NM3', '***'
];

// Valid priority values
const VALID_PRIORITIES = [1, 2, 3, 4, 5];

// Valid IFC types
const VALID_IFC_TYPES = [
  'IfcSlab', 'IfcWall', 'IfcDoor', 'IfcWindow', 
  'IfcRoof', 'IfcColumn', 'IfcBeam', 'IfcFooting',
  'IfcBuildingElementProxy'
];

// Valid construction methods (Finnish)
const VALID_CONSTRUCTION_METHODS = [
  'paikallavalettu', 'elementti', 'puurunko', 
  'muuraus', 'kevyt', 'toimitus', 'erilainen'
];

export class CSVValidator {
  /**
   * Validate CSV content for Littera filter templates
   */
  static validate(csvText: string): CSVValidationResult {
    const errors: CSVValidationError[] = [];
    const warnings: CSVValidationError[] = [];
    const lines = csvText.split('\n');
    let validRows = 0;
    let invalidRows = 0;
    let skippedRows = 0;

    // Validate file is not empty
    if (lines.length === 0) {
      errors.push({
        line: 0,
        message: 'CSV file is empty',
        severity: 'error'
      });
      return {
        isValid: false,
        errors,
        warnings,
        stats: { totalRows: 0, validRows: 0, invalidRows: 0, skippedRows: 0 }
      };
    }

    // Validate header
    const header = lines[0];
    const expectedColumns = 14;
    const headerColumns = this.countCSVColumns(header);

    if (headerColumns < expectedColumns) {
      errors.push({
        line: 1,
        message: `Header has ${headerColumns} columns, expected ${expectedColumns}`,
        severity: 'error'
      });
    }

    // Validate each data row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines
      if (!line) {
        skippedRows++;
        continue;
      }

      const row = this.parseCSVRow(line);
      const lineNumber = i + 1; // +1 because line 1 is header

      // Validate column count
      if (row.length < expectedColumns) {
        errors.push({
          line: lineNumber,
          message: `Row has ${row.length} columns, expected ${expectedColumns}. Row will be skipped.`,
          severity: 'error',
          value: line.substring(0, 50) + (line.length > 50 ? '...' : '')
        });
        invalidRows++;
        continue;
      }

      // Extract fields
      const [
        nimikkeistoCode,
        nimikkeistoName,
        ifcType,
        constructionMethod,
        contextRequired,
        activity,
        codeRange,
        unit,
        keywords,
        excludeKeywords,
        priority,
        maxCodes,
        required,
        notes
      ] = row;

      let rowValid = true;

      // Validate Nimikkeistö code (must be 3-4 digits)
      if (!/^\d{3,4}$/.test(nimikkeistoCode)) {
        errors.push({
          line: lineNumber,
          field: 'Nimikkeistö-koodi',
          message: `Invalid Nimikkeistö code: "${nimikkeistoCode}". Must be 3-4 digits.`,
          severity: 'error',
          value: nimikkeistoCode
        });
        rowValid = false;
      }

      // Validate Nimikkeistö name (should not be empty)
      if (!nimikkeistoName || nimikkeistoName.trim().length === 0) {
        warnings.push({
          line: lineNumber,
          field: 'Nimikkeistö-nimi',
          message: 'Nimikkeistö name is empty',
          severity: 'warning'
        });
      }

      // Validate IFC Type
      if (!VALID_IFC_TYPES.includes(ifcType)) {
        warnings.push({
          line: lineNumber,
          field: 'IFC Type',
          message: `Unknown IFC type: "${ifcType}". Valid types: ${VALID_IFC_TYPES.join(', ')}`,
          severity: 'warning',
          value: ifcType
        });
      }

      // Validate construction method
      if (constructionMethod && !VALID_CONSTRUCTION_METHODS.includes(constructionMethod)) {
        warnings.push({
          line: lineNumber,
          field: 'Rakennusmenetelmä',
          message: `Unknown construction method: "${constructionMethod}". Valid methods: ${VALID_CONSTRUCTION_METHODS.join(', ')}`,
          severity: 'warning',
          value: constructionMethod
        });
      }

      // Validate activity (should not be empty)
      if (!activity || activity.trim().length === 0) {
        errors.push({
          line: lineNumber,
          field: 'Työvaihe',
          message: 'Activity cannot be empty',
          severity: 'error'
        });
        rowValid = false;
      }

      // Validate Littera code ranges
      const codeRanges = codeRange.split(',').map(r => r.trim()).filter(r => r);
      if (codeRanges.length === 0) {
        errors.push({
          line: lineNumber,
          field: 'Littera-koodialue',
          message: 'Code range cannot be empty',
          severity: 'error'
        });
        rowValid = false;
      } else {
        for (const range of codeRanges) {
          if (!VALID_LITTERA_CODE_RANGES.includes(range)) {
            errors.push({
              line: lineNumber,
              field: 'Littera-koodialue',
              message: `Invalid Littera code range: "${range}". Valid ranges: ${VALID_LITTERA_CODE_RANGES.join(', ')}`,
              severity: 'error',
              value: range
            });
            rowValid = false;
          }
        }
      }

      // Validate units
      const units = unit.split(',').map(u => u.trim()).filter(u => u);
      if (units.length === 0) {
        warnings.push({
          line: lineNumber,
          field: 'Yksikkö',
          message: 'Unit is empty',
          severity: 'warning'
        });
      } else {
        for (const u of units) {
          if (!VALID_UNITS.includes(u.toUpperCase())) {
            warnings.push({
              line: lineNumber,
              field: 'Yksikkö',
              message: `Unknown unit: "${u}". Valid units: ${VALID_UNITS.join(', ')}`,
              severity: 'warning',
              value: u
            });
          }
        }
      }

      // Validate priority
      const priorityNum = parseInt(priority);
      if (isNaN(priorityNum) || !VALID_PRIORITIES.includes(priorityNum)) {
        errors.push({
          line: lineNumber,
          field: 'Prioriteetti',
          message: `Invalid priority: "${priority}". Must be 1-5.`,
          severity: 'error',
          value: priority
        });
        rowValid = false;
      }

      // Validate maxCodes
      const maxCodesNum = parseInt(maxCodes);
      if (isNaN(maxCodesNum) || maxCodesNum < 1) {
        errors.push({
          line: lineNumber,
          field: 'Maksimi koodit',
          message: `Invalid max codes: "${maxCodes}". Must be a positive integer.`,
          severity: 'error',
          value: maxCodes
        });
        rowValid = false;
      } else if (maxCodesNum > 10) {
        warnings.push({
          line: lineNumber,
          field: 'Maksimi koodit',
          message: `Max codes "${maxCodes}" seems unusually high. Typical range: 1-5.`,
          severity: 'warning',
          value: maxCodes
        });
      }

      // Validate required field
      const requiredUpper = required.toUpperCase();
      if (requiredUpper !== 'YES' && requiredUpper !== 'NO') {
        errors.push({
          line: lineNumber,
          field: 'Required',
          message: `Invalid required value: "${required}". Must be YES or NO.`,
          severity: 'error',
          value: required
        });
        rowValid = false;
      }

      // Count valid/invalid rows
      if (rowValid) {
        validRows++;
      } else {
        invalidRows++;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      stats: {
        totalRows: lines.length - 1, // -1 for header
        validRows,
        invalidRows,
        skippedRows
      }
    };
  }

  /**
   * Parse CSV row handling quoted fields
   * (Same logic as in LitteraTemplateService)
   */
  private static parseCSVRow(line: string): string[] {
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
   * Count columns in CSV line (handling quoted fields)
   */
  private static countCSVColumns(line: string): number {
    return this.parseCSVRow(line).length;
  }
}


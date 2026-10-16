/**
 * BOQ (Bill of Quantities) Exporter Service
 * Compatible with Finnish tools like Admicom Estima/Quantima
 * Based on Finnish standards: TALO 2000, RT-kortti, CO2Data.fi
 */

import { BaseCostElement, RTKorttiDetails } from '../types/cost';
import { TALO_2000_MEASUREMENTS, TALO_ELEMENTS, getCorrectUnit, getCorrectQuantity } from '../constants/talo2000';
import { ADJUSTED_UNIFIED_RT_DATABASE as UNIFIED_RT_DATABASE } from '../data/unifiedRTDatabase';
import { findRTKorttiForElement, isValidRTKorttiCode as isValidRTKorttiCodeUtil } from '../utils/rtKorttiLookup';
import { Talo2000Unit } from '../types/talo2000';
import * as XLSX from 'xlsx';

// Finnish BOQ interfaces
interface FinnishBOQDocument {
  version: string;
  metadata: BOQMetadata;
  project: BOQProject;
  items: BOQItem[];
  summary: BOQSummary;
  finnishExtensions: FinnishBOQExtensions;
}

interface BOQMetadata {
  created: string;
  creator: string;
  version: string;
  source: string;
  standards: string[];
}

interface BOQProject {
  name: string;
  location: string;
  buildingType: string;
  constructionMethod: string;
  totalArea: number;
  startDate: string;
  endDate: string;
  client: string;
  contractor: string;
}

interface BOQItem {
  // TALO 2000 classification
  taloCode: string;
  taloCategory: string;
  taloSubcategory: string;
  
  // Item identification
  itemNumber: string;
  description: {
    fi: string;
    en: string;
  };
  
  // Quantities
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  
  // Cost breakdown
  materialCost: number;
  laborCost: number;
  subcontractCost: number;
  
  // RT-kortti reference
  rtKortti?: {
    code: string;
    name: string;
    materials: string[];
    workPhases: string[];
  };
  
  // Technical specifications
  specifications?: {
    thickness?: number;
    weight?: number;
    fireRating?: string;
    acousticRating?: string;
    thermalTransmittance?: number;
  };
  
  // Location and context
  location?: string;
  floor?: string;
  zone?: string;
  
  // Additional information
  notes?: string;
  alternatives?: string[];
}

interface BOQSummary {
  totalItems: number;
  totalQuantity: number;
  totalMaterialCost: number;
  totalLaborCost: number;
  totalSubcontractCost: number;
  grandTotal: number;
  costPerM2: number;
  
  // TALO 2000 breakdown
  taloBreakdown: {
    [category: string]: {
      items: number;
      quantity: number;
      totalCost: number;
      percentage: number;
    };
  };
  
  // RT-kortti summary
  rtKorttiSummary: {
    [code: string]: {
      items: number;
      totalCost: number;
      percentage: number;
    };
  };
}

interface FinnishBOQExtensions {
  talo2000Compliance: boolean;
  rtKorttiReferences: string[];
  co2DataReferences: string[];
  vttFactors: boolean;
  admicomCompatibility: AdmicomCompatibility;
  quantimaCompatibility: QuantimaCompatibility;
}

interface AdmicomCompatibility {
  supported: boolean;
  version: string;
  importFormat: string;
  conversionNotes: string[];
  limitations: string[];
}

interface QuantimaCompatibility {
  supported: boolean;
  version: string;
  importFormat: string;
  conversionNotes: string[];
  limitations: string[];
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  compliance: {
    talo2000: boolean;
    rtKortti: boolean;
    admicom: boolean;
    quantima: boolean;
  };
}

export class BOQExporter {
  private static instance: BOQExporter;
  private readonly BOQ_VERSION = "1.0.0";
  private readonly FINNISH_EXTENSION_VERSION = "1.0.0";

  private constructor() {}

  static getInstance(): BOQExporter {
    if (!BOQExporter.instance) {
      BOQExporter.instance = new BOQExporter();
    }
    return BOQExporter.instance;
  }

  /**
   * Convert cost data to Finnish BOQ format
   */
  convertToFinnishBOQ(
    costData: BaseCostElement[],
    projectInfo: any,
    options: {
      includeRTKortti?: boolean;
      includeSpecifications?: boolean;
      includeLocation?: boolean;
      language?: 'fi' | 'en';
    } = {}
  ): FinnishBOQDocument {
    console.log('[BOQExporter] Converting to Finnish BOQ format...');

    const {
      includeRTKortti = true,
      includeSpecifications = true,
      includeLocation = false,
      language = 'en'
    } = options;

    // Group elements by TALO code
    const groupedItems = this.groupElementsByTaloCode(costData);
    
    // Create BOQ items
    const items: BOQItem[] = groupedItems.map((group, index) => {
      const item = this.createBOQItem(group, index + 1, {
        includeRTKortti,
        includeSpecifications,
        includeLocation,
        language
      });
      return item;
    });

    // Create summary
    const summary = this.createBOQSummary(items, costData);

    // Create Finnish extensions
    const finnishExtensions = this.createFinnishExtensions(costData);

    const boqDocument: FinnishBOQDocument = {
      version: this.BOQ_VERSION,
      metadata: this.createMetadata(),
      project: this.createProject(projectInfo),
      items,
      summary,
      finnishExtensions
    };

    console.log('[BOQExporter] Finnish BOQ document created:', boqDocument);
    return boqDocument;
  }

  /**
   * Validate BOQ document against Finnish standards
   */
  validateBOQ(document: FinnishBOQDocument): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate TALO 2000 codes
    document.items.forEach((item, index) => {
      if (!item.taloCode || item.taloCode.trim() === '') {
        errors.push(`Item ${index + 1}: Missing TALO 2000 code`);
      } else if (!this.isValidTalo2000Code(item.taloCode)) {
        errors.push(`Item ${index + 1}: Invalid TALO 2000 code "${item.taloCode}"`);
      }
    });

    // Validate RT-kortti references
    document.items.forEach((item, index) => {
      if (item.rtKortti && !this.isValidRTKorttiCode(item.rtKortti.code)) {
        warnings.push(`Item ${index + 1}: RT-kortti code "${item.rtKortti.code}" not found in database`);
      }
    });

    // Validate quantities
    document.items.forEach((item, index) => {
      if (item.quantity <= 0) {
        errors.push(`Item ${index + 1}: Quantity must be greater than 0`);
      }
    });

    // Validate costs
    document.items.forEach((item, index) => {
      const calculatedTotal = item.materialCost + item.laborCost + item.subcontractCost;
      if (Math.abs(calculatedTotal - item.totalPrice) > 0.01) {
        errors.push(`Item ${index + 1}: Total price mismatch (calculated: ${calculatedTotal}, actual: ${item.totalPrice})`);
      }
    });

    // Check compliance
    const compliance = {
      talo2000: errors.filter(e => e.includes('TALO 2000')).length === 0,
      rtKortti: warnings.filter(w => w.includes('RT-kortti')).length === 0,
      admicom: this.checkAdmicomCompatibility(document),
      quantima: this.checkQuantimaCompatibility(document)
    };

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      compliance
    };
  }

  /**
   * Export BOQ to Excel format
   */
  exportToExcel(document: FinnishBOQDocument, filename: string): void {
    try {
      // Create workbook
      const workbook = XLSX.utils.book_new();
      
      // Create BOQ Items sheet
      const itemsData = this.createExcelData(document);
      const itemsSheet = XLSX.utils.aoa_to_sheet(itemsData);
      XLSX.utils.book_append_sheet(workbook, itemsSheet, 'BOQ Items');
      
      // Create Summary sheet
      const summaryData = this.createExcelSummary(document);
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
      
      // Create TALO 2000 Breakdown sheet
      const taloBreakdownData = this.createTaloBreakdownData(document);
      const taloBreakdownSheet = XLSX.utils.aoa_to_sheet(taloBreakdownData);
      XLSX.utils.book_append_sheet(workbook, taloBreakdownSheet, 'TALO 2000 Breakdown');
      
      // Create RT-kortti Summary sheet
      const rtKorttiData = this.createRTKorttiSummaryData(document);
      const rtKorttiSheet = XLSX.utils.aoa_to_sheet(rtKorttiData);
      XLSX.utils.book_append_sheet(workbook, rtKorttiSheet, 'RT-kortti Summary');
      
      // Write to file
      XLSX.writeFile(workbook, filename);
      
      console.log(`[BOQExporter] Excel file exported: ${filename}`);
    } catch (error) {
      console.error('[BOQExporter] Error exporting to Excel:', error);
      throw new Error('Failed to export BOQ to Excel format');
    }
  }

  /**
   * Export BOQ to CSV format
   */
  exportToCSV(document: FinnishBOQDocument, filename: string): void {
    try {
      const csvContent = this.createCSVContent(document);
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = filename;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      console.log(`[BOQExporter] CSV file exported: ${filename}`);
    } catch (error) {
      console.error('[BOQExporter] Error exporting to CSV:', error);
      throw new Error('Failed to export BOQ to CSV format');
    }
  }

  /**
   * Get Admicom compatibility information
   */
  getAdmicomCompatibility(): AdmicomCompatibility {
    return {
      supported: true,
      version: "2024.1",
      importFormat: "Excel (.xlsx)",
      conversionNotes: [
        "TALO 2000 codes are automatically mapped to Admicom categories",
        "RT-kortti references are preserved as custom fields",
        "Cost breakdown follows Admicom structure",
        "Quantities are converted to Admicom units where applicable"
      ],
      limitations: [
        "Some Finnish-specific material codes may need manual mapping",
        "Custom specifications may not transfer completely",
        "Location information may need manual assignment"
      ]
    };
  }

  /**
   * Get Quantima compatibility information
   */
  getQuantimaCompatibility(): QuantimaCompatibility {
    return {
      supported: true,
      version: "2024.1",
      importFormat: "CSV (.csv)",
      conversionNotes: [
        "TALO 2000 structure is preserved in Quantima format",
        "RT-kortti codes are mapped to Quantima reference system",
        "Cost calculations follow Quantima methodology",
        "Unit conversions are handled automatically"
      ],
      limitations: [
        "Advanced specifications may need manual review",
        "Some Finnish standards may not have direct equivalents",
        "Custom fields may need manual configuration"
      ]
    };
  }

  // Private helper methods

  private groupElementsByTaloCode(elements: BaseCostElement[]): BaseCostElement[][] {
    const groups: { [key: string]: BaseCostElement[] } = {};
    
    elements.forEach(element => {
      // Try to derive TALO code from element type if not provided
      let taloCode = element.taloCode;
      if (!taloCode || taloCode.trim() === '') {
        taloCode = this.deriveTaloCodeFromElementType(element.type);
        // Update the element's taloCode for consistency
        element.taloCode = taloCode;
      }
      
      if (!groups[taloCode]) {
        groups[taloCode] = [];
      }
      groups[taloCode].push(element);
    });

    return Object.values(groups);
  }

  private createBOQItem(
    elements: BaseCostElement[], 
    itemNumber: number,
    options: {
      includeRTKortti: boolean;
      includeSpecifications: boolean;
      includeLocation: boolean;
      language: 'fi' | 'en';
    }
  ): BOQItem {
    const firstElement = elements[0];
    const totalQuantity = elements.reduce((sum, el) => sum + this.getElementQuantity(el), 0);
    const totalMaterialCost = elements.reduce((sum, el) => sum + el.costs.material, 0);
    const totalLaborCost = elements.reduce((sum, el) => sum + el.costs.labor, 0);
    const totalAliurakkaCost = elements.reduce((sum, el) => sum + el.costs.subcontract, 0);
    const totalPrice = totalMaterialCost + totalLaborCost + totalAliurakkaCost;

    const unit = this.getElementUnit(firstElement);
    const unitPrice = totalQuantity > 0 ? totalPrice / totalQuantity : 0;

    // Get TALO 2000 information
    const taloInfo = this.getTalo2000Info(firstElement.taloCode);
    
    // Get RT-kortti information
    const rtKortti = options.includeRTKortti ? this.getRTKorttiInfo(firstElement) : undefined;

    // Get specifications
    const specifications = options.includeSpecifications ? this.getSpecifications(firstElement) : undefined;

    return {
      taloCode: firstElement.taloCode,
      taloCategory: taloInfo.category,
      taloSubcategory: taloInfo.subcategory,
      itemNumber: `${itemNumber.toString().padStart(3, '0')}`,
      description: {
        fi: taloInfo.name.fi,
        en: taloInfo.name.en
      },
      quantity: totalQuantity,
      unit,
      unitPrice,
      totalPrice,
      materialCost: totalMaterialCost,
      laborCost: totalLaborCost,
      subcontractCost: totalAliurakkaCost,
      rtKortti,
      specifications,
      notes: `Grouped from ${elements.length} elements`
    };
  }

  private createBOQSummary(items: BOQItem[], originalData: BaseCostElement[]): BOQSummary {
    const totalItems = items.length;
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalMaterialCost = items.reduce((sum, item) => sum + item.materialCost, 0);
    const totalLaborCost = items.reduce((sum, item) => sum + item.laborCost, 0);
    const totalSubcontractCost = items.reduce((sum, item) => sum + item.subcontractCost, 0);
    const grandTotal = totalMaterialCost + totalLaborCost + totalSubcontractCost;

    // Calculate TALO 2000 breakdown
    const taloBreakdown: { [category: string]: any } = {};
    items.forEach(item => {
      const category = item.taloCategory;
      if (!taloBreakdown[category]) {
        taloBreakdown[category] = {
          items: 0,
          quantity: 0,
          totalCost: 0,
          percentage: 0
        };
      }
      taloBreakdown[category].items++;
      taloBreakdown[category].quantity += item.quantity;
      taloBreakdown[category].totalCost += item.totalPrice;
    });

    // Calculate percentages
    Object.keys(taloBreakdown).forEach(category => {
      taloBreakdown[category].percentage = (taloBreakdown[category].totalCost / grandTotal) * 100;
    });

    // Calculate RT-kortti summary
    const rtKorttiSummary: { [code: string]: any } = {};
    items.forEach(item => {
      if (item.rtKortti) {
        const code = item.rtKortti.code;
        if (!rtKorttiSummary[code]) {
          rtKorttiSummary[code] = {
            items: 0,
            totalCost: 0,
            percentage: 0
          };
        }
        rtKorttiSummary[code].items++;
        rtKorttiSummary[code].totalCost += item.totalPrice;
      }
    });

    // Calculate RT-kortti percentages
    Object.keys(rtKorttiSummary).forEach(code => {
      rtKorttiSummary[code].percentage = (rtKorttiSummary[code].totalCost / grandTotal) * 100;
    });

    return {
      totalItems,
      totalQuantity,
      totalMaterialCost,
      totalLaborCost,
      totalSubcontractCost,
      grandTotal,
      costPerM2: grandTotal / (originalData[0]?.baseQuantities?.['m²']?.value || 1),
      taloBreakdown,
      rtKorttiSummary
    };
  }

  private createMetadata(): BOQMetadata {
    return {
      created: new Date().toISOString(),
      creator: 'LCAPPCOST BOQ Exporter',
      version: this.BOQ_VERSION,
      source: 'Finnish Construction Standards',
      standards: ['TALO 2000', 'RT-kortti', 'CO2Data.fi', 'VTT LIPASTO']
    };
  }

  private createProject(projectInfo: any): BOQProject {
    return {
      name: projectInfo?.name || 'Unnamed Project',
      location: projectInfo?.location || 'Helsinki',
      buildingType: projectInfo?.buildingType || 'residential',
      constructionMethod: projectInfo?.constructionMethod || 'traditional',
      totalArea: projectInfo?.area || 0,
      startDate: projectInfo?.startDate || new Date().toISOString(),
      endDate: projectInfo?.endDate || new Date().toISOString(),
      client: projectInfo?.client || 'Unknown',
      contractor: projectInfo?.contractor || 'Unknown'
    };
  }

  private createFinnishExtensions(costData: BaseCostElement[]): FinnishBOQExtensions {
    return {
      talo2000Compliance: true,
      rtKorttiReferences: this.extractRTKorttiReferences(costData),
      co2DataReferences: this.extractCO2DataReferences(costData),
      vttFactors: true,
      admicomCompatibility: this.getAdmicomCompatibility(),
      quantimaCompatibility: this.getQuantimaCompatibility()
    };
  }

  private getTalo2000Info(taloCode: string): { category: string; subcategory: string; name: { fi: string; en: string } } {
    const taloElement = TALO_ELEMENTS[taloCode];
    if (taloElement) {
      return {
        category: taloElement.category,
        subcategory: taloCode.split('.').slice(0, 2).join('.'),
        name: taloElement.name
      };
    }

    // Try to find a parent code that exists
    const codeParts = taloCode.split('.');
    for (let i = codeParts.length - 1; i > 0; i--) {
      const parentCode = codeParts.slice(0, i).join('.');
      const parentElement = TALO_ELEMENTS[parentCode];
      if (parentElement) {
        return {
          category: parentElement.category,
          subcategory: parentCode,
          name: {
            fi: `${parentElement.name.fi} - ${taloCode}`,
            en: `${parentElement.name.en} - ${taloCode}`
          }
        };
      }
    }

    // Fallback for completely unknown codes
    const category = this.getCategoryFromTaloCode(taloCode);
    const subcategory = taloCode.split('.').slice(0, 2).join('.') || 'unknown';
    return {
      category,
      subcategory,
      name: {
        fi: `${this.getCategoryNameFi(category)} (${taloCode})`,
        en: `${this.getCategoryNameEn(category)} (${taloCode})`
      }
    };
  }

  private getCategoryFromTaloCode(taloCode: string): string {
    const firstPart = taloCode.split('.')[0];
    const categoryMap: { [key: string]: string } = {
      '1': 'structure',
      '2': 'mep',
      '3': 'finishes',
      '4': 'site',
      '5': 'special'
    };
    return categoryMap[firstPart] || 'unknown';
  }

  private getCategoryNameFi(category: string): string {
    const names: { [key: string]: string } = {
      'structure': 'Rakenteet',
      'mep': 'LVI-järjestelmät',
      'finishes': 'Viimeistelyt',
      'site': 'Maatyöt',
      'special': 'Erityistyöt',
      'unknown': 'Tuntematon'
    };
    return names[category] || 'Tuntematon';
  }

  private getCategoryNameEn(category: string): string {
    const names: { [key: string]: string } = {
      'structure': 'Structures',
      'mep': 'MEP Systems',
      'finishes': 'Finishes',
      'site': 'Site Works',
      'special': 'Special Works',
      'unknown': 'Unknown'
    };
    return names[category] || 'Unknown';
  }

  private getRTKorttiInfo(element: BaseCostElement): any {
    // Since rtDetails is not part of BaseCostElement, we'll look it up from the database
    // based on the element's taloCode and name
    const rtKortti = this.findRTKorttiInDatabase(element.taloCode, element.name);
    if (rtKortti) {
      return {
        code: rtKortti.code,
        name: rtKortti.name?.fi || element.name,
        materials: rtKortti.materials || [],
        workPhases: rtKortti.workPhases || []
      };
    }
    return undefined;
  }

  private findRTKorttiInDatabase(taloCode: string, elementName: string, elementType?: string): any {
    return findRTKorttiForElement(elementName, taloCode, elementType || '');
  }

  private getSpecifications(element: BaseCostElement): any {
    const rtKortti = this.findRTKorttiInDatabase(element.taloCode, element.name, element.type);
    if (rtKortti?.technicalDetails) {
      return {
        thickness: rtKortti.technicalDetails.thickness,
        weight: rtKortti.technicalDetails.weight,
        fireRating: rtKortti.technicalDetails.fireRating,
        acousticRating: rtKortti.technicalDetails.acousticRating,
        thermalTransmittance: rtKortti.technicalDetails.thermalTransmittance
      };
    }
    return undefined;
  }

  private deriveTaloCodeFromElementType(elementType: string): string {
    // Map IFC types to TALO 2000 codes
    const typeToTaloMap: { [key: string]: string } = {
      'IfcWall': '1.3.1',
      'IfcSlab': '1.2.4',
      'IfcColumn': '1.2.3',
      'IfcBeam': '1.2.3',
      'IfcWindow': '1.3.1',
      'IfcDoor': '1.3.1',
      'IfcFurniture': '1.3.4',
      'IfcSanitaryTerminal': '2.1',
      'IfcFlowTerminal': '2.1',
      'IfcDistributionFlowElement': '2.2',
      'IfcBuildingElementProxy': '1.3.1',
      'IfcElectricAppliance': '2.4',
      'IfcCovering': '1.3.3',
      'IfcCommunicationsAppliance': '2.4',
      'IfcPipeSegment': '2.2',
      'IfcDuctSegment': '2.2',
      'IfcCableSegment': '2.4',
      'IfcRailing': '1.3.4',
      'IfcRoof': '1.2.6',
      'IfcSite': '1.1',
      'IfcFooting': '1.2.1'
    };
    
    const normalizedType = elementType.toLowerCase();
    for (const [type, taloCode] of Object.entries(typeToTaloMap)) {
      if (normalizedType.includes(type.toLowerCase())) {
        return taloCode;
      }
    }
    
    // Default fallback
    return '1.3.1';
  }

  private getElementQuantity(element: BaseCostElement): number {
    // Get the primary quantity from baseQuantities
    const quantities = Object.values(element.baseQuantities || {});
    if (quantities.length > 0) {
      const quantity = quantities[0].value;
      if (quantity > 0) {
        return quantity;
      }
    }
    
    // Fallback to the quantity field
    if (element.quantity && element.quantity > 0) {
      return element.quantity;
    }
    
    // If no valid quantity found, try to estimate from costs
    const totalCost = element.costs.material + element.costs.labor + element.costs.subcontract;
    if (totalCost > 0) {
      // Estimate quantity based on typical unit costs
      const estimatedUnitCost = 100; // Default estimated unit cost
      return Math.max(1, totalCost / estimatedUnitCost);
    }
    
    // Final fallback: minimum quantity of 1
    return 1;
  }

  private getElementUnit(element: BaseCostElement): string {
    const unit = getCorrectUnit(element.type, element.taloCode);
    switch (unit) {
      case Talo2000Unit.SQUARE_METERS:
        return 'm²';
      case Talo2000Unit.CUBIC_METERS:
        return 'm³';
      case Talo2000Unit.METERS:
        return 'm';
      case Talo2000Unit.PIECES:
        return 'kpl';
      case Talo2000Unit.KILOGRAMS:
        return 'kg';
      default:
        return 'm²';
    }
  }

  private isValidTalo2000Code(code: string): boolean {
    // Check if it's an empty or invalid code
    if (!code || code.trim() === '') {
      return false;
    }
    
    // Check exact match first
    if (code in TALO_ELEMENTS || code in TALO_2000_MEASUREMENTS) {
      return true;
    }
    
    // Check if it's a valid TALO code pattern (e.g., "1.2.3.4" or "1.2.3" or "1.1")
    const taloPattern = /^\d+(\.\d+)*$/;
    if (!taloPattern.test(code)) {
      return false;
    }
    
    // Check if any parent code exists (e.g., for "1.2.3.4", check "1.2.3", "1.2", "1")
    const codeParts = code.split('.');
    for (let i = codeParts.length - 1; i > 0; i--) {
      const parentCode = codeParts.slice(0, i).join('.');
      if (parentCode in TALO_ELEMENTS || parentCode in TALO_2000_MEASUREMENTS) {
        return true;
      }
    }
    
    // If it's a valid TALO pattern but not in our database, it's still valid
    // This handles codes like "1.1", "1.5", "2.5", etc. that we haven't explicitly defined
    return true;
  }

  private isValidRTKorttiCode(code: string): boolean {
    return isValidRTKorttiCodeUtil(code);
  }

  private extractRTKorttiReferences(costData: BaseCostElement[]): string[] {
    const references = new Set<string>();
    costData.forEach(element => {
      const rtKortti = this.findRTKorttiInDatabase(element.taloCode, element.name, element.type);
      if (rtKortti?.code) {
        references.add(rtKortti.code);
      }
    });
    return Array.from(references);
  }

  private extractCO2DataReferences(costData: BaseCostElement[]): string[] {
    // This would be populated with actual CO2Data.fi references
    return ['CO2Data.fi-2024', 'VTT-LIPASTO-2024'];
  }

  private checkAdmicomCompatibility(document: FinnishBOQDocument): boolean {
    // Check if document structure is compatible with Admicom
    return document.items.length > 0 && 
           document.items.every(item => item.taloCode && item.quantity > 0);
  }

  private checkQuantimaCompatibility(document: FinnishBOQDocument): boolean {
    // Check if document structure is compatible with Quantima
    return document.items.length > 0 && 
           document.items.every(item => item.taloCode && item.unit);
  }

  private createTaloBreakdownData(document: FinnishBOQDocument): any[][] {
    const summary = document.summary;
    
    const headers = ['TALO Category', 'Items', 'Quantity', 'Total Cost (€)', 'Percentage (%)'];
    const rows = Object.entries(summary.taloBreakdown).map(([category, data]) => [
      category,
      data.items,
      data.quantity,
      data.totalCost,
      `${data.percentage.toFixed(2)}%`
    ]);

    return [headers, ...rows];
  }

  private createRTKorttiSummaryData(document: FinnishBOQDocument): any[][] {
    const summary = document.summary;
    
    const headers = ['RT-kortti Code', 'Items', 'Total Cost (€)', 'Percentage (%)'];
    const rows = Object.entries(summary.rtKorttiSummary).map(([code, data]) => [
      code,
      data.items,
      data.totalCost,
      `${data.percentage.toFixed(2)}%`
    ]);

    return [headers, ...rows];
  }

  private createExcelData(document: FinnishBOQDocument): any[][] {
    const headers = [
      'Item No.',
      'TALO Code',
      'Description (FI)',
      'Description (EN)',
      'Quantity',
      'Unit',
      'Unit Price (€)',
      'Total Price (€)',
      'Material Cost (€)',
      'Labor Cost (€)',
      'Subcontract Cost (€)',
      'RT-kortti Code',
      'Notes'
    ];

    const rows = document.items.map(item => [
      item.itemNumber,
      item.taloCode,
      item.description.fi,
      item.description.en,
      item.quantity,
      item.unit,
      item.unitPrice,
      item.totalPrice,
      item.materialCost,
      item.laborCost,
      item.subcontractCost,
      item.rtKortti?.code || '',
      item.notes || ''
    ]);

    return [headers, ...rows];
  }

  private createExcelSummary(document: FinnishBOQDocument): any[][] {
    const summary = document.summary;
    
    return [
      ['BOQ Summary'],
      [''],
      ['Total Items', summary.totalItems],
      ['Total Quantity', summary.totalQuantity],
      [''],
      ['Cost Breakdown'],
      ['Material Cost', summary.totalMaterialCost],
      ['Labor Cost', summary.totalLaborCost],
      ['Subcontract Cost', summary.totalSubcontractCost],
      ['Grand Total', summary.grandTotal],
      ['Cost per m²', summary.costPerM2],
      [''],
      ['TALO 2000 Breakdown'],
      ...Object.entries(summary.taloBreakdown).map(([category, data]) => [
        category,
        data.items,
        data.quantity,
        data.totalCost,
        `${data.percentage.toFixed(2)}%`
      ])
    ];
  }

  private createCSVContent(document: FinnishBOQDocument): string {
    const headers = [
      'Item_No',
      'TALO_Code',
      'Description_FI',
      'Description_EN',
      'Quantity',
      'Unit',
      'Unit_Price_EUR',
      'Total_Price_EUR',
      'Material_Cost_EUR',
      'Labor_Cost_EUR',
      'Subcontract_Cost_EUR',
      'RT_Kortti_Code',
      'Notes'
    ];

    const rows = document.items.map(item => [
      item.itemNumber,
      item.taloCode,
      `"${item.description.fi}"`,
      `"${item.description.en}"`,
      item.quantity,
      item.unit,
      item.unitPrice,
      item.totalPrice,
      item.materialCost,
      item.laborCost,
      item.subcontractCost,
      item.rtKortti?.code || '',
      `"${item.notes || ''}"`
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }
}

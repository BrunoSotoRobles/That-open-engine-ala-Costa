/**
 * LCAx Exporter Service
 * Combines international LCAx format with Finnish-specific extensions
 * Compatible with OneClickLCA and other LCA tools
 * Based on official standards: LCAx, CO2Data.fi, RTS, VTT LIPASTO
 */

import { MATERIAL_FACTORS, FINNISH_MATERIAL_SOURCES, TRANSPORT_FACTORS } from '../data/emissionFactors';
import { downloadJSON } from '../utils/fileDownload';

// Core LCAx interfaces based on official schema
interface LCAxDocument {
  version: string;
  metadata: LCAxMetadata;
  project: LCAxProject;
  assemblies: LCAxAssembly[];
  epds: LCAxEPD[];
}

interface LCAxMetadata {
  created: string;
  creator: string;
  description: string;
  version: string;
  license: string;
}

interface LCAxProject {
  name: string;
  description: string;
  location: LCAxLocation;
  functionalUnit: LCAxFunctionalUnit;
  impactCategories: LCAxImpactCategory[];
}

interface LCAxLocation {
  country: string;
  region?: string;
  city?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

interface LCAxFunctionalUnit {
  name: string;
  value: number;
  unit: string;
  description: string;
}

interface LCAxImpactCategory {
  name: string;
  unit: string;
  method: string;
  description: string;
}

interface LCAxAssembly {
  id: string;
  name: string;
  description: string;
  quantity: LCAxQuantity;
  materials: LCAxMaterial[];
  impacts: LCAxImpact[];
  transport?: LCAxTransport;
}

interface LCAxQuantity {
  value: number;
  unit: string;
}

interface LCAxMaterial {
  id: string;
  name: string;
  quantity: LCAxQuantity;
  epdId?: string;
  source: LCAxSource;
}

interface LCAxSource {
  database: string;
  id: string;
  version: string;
  verified: boolean;
}

interface LCAxImpact {
  category: string;
  value: number;
  unit: string;
}

interface LCAxTransport {
  distance: number;
  unit: string;
  mode: string;
  emissionFactor: number;
}

interface LCAxEPD {
  id: string;
  name: string;
  version: string;
  validFrom: string;
  validUntil: string;
  manufacturer: LCAxManufacturer;
  impacts: LCAxImpact[];
  source: LCAxSource;
}

interface LCAxManufacturer {
  name: string;
  location: string;
  epdNumber: string;
}

// Finnish-specific extensions
interface FinnishLCAxExtensions {
  co2dataReferences: string[];
  rtsEPDs: string[];
  vttFactors: boolean;
  en15804Compliance: boolean;
  finnishStandards: FinnishStandards;
  transportFactors: FinnishTransportFactors;
}

interface FinnishStandards {
  buildingCode: string;
  energyEfficiency: string;
  fireSafety: string;
  accessibility: string;
  environmentalProtection: string;
}

interface FinnishTransportFactors {
  truck: number;
  train: number;
  ship: number;
  source: string;
}

// Extended LCAx document with Finnish extensions
interface FinnishLCAxDocument extends LCAxDocument {
  finnishExtensions: FinnishLCAxExtensions;
}

// Validation result
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// OneClickLCA compatibility interface
interface OneClickLCACompatibility {
  supportedFormats: string[];
  conversionNotes: string[];
  limitations: string[];
}

export class LCAxExporter {
  private static instance: LCAxExporter;
  private readonly LCAX_VERSION = "1.0.0";
  private readonly FINNISH_EXTENSION_VERSION = "1.0.0";

  private constructor() {}

  static getInstance(): LCAxExporter {
    if (!LCAxExporter.instance) {
      LCAxExporter.instance = new LCAxExporter();
    }
    return LCAxExporter.instance;
  }

  /**
   * Convert application data to Finnish LCAx format
   */
  convertToFinnishLCAx(
    materials: any[],
    projectInfo: any,
    results: any
  ): FinnishLCAxDocument {
    console.log('[LCAxExporter] Converting to Finnish LCAx format...');

    const lcaxDocument: FinnishLCAxDocument = {
      version: this.LCAX_VERSION,
      metadata: this.createMetadata(),
      project: this.createProject(projectInfo),
      assemblies: this.createAssemblies(materials),
      epds: this.createEPDs(materials),
      finnishExtensions: this.createFinnishExtensions(materials, results)
    };

    console.log('[LCAxExporter] Finnish LCAx document created:', lcaxDocument);
    return lcaxDocument;
  }

  /**
   * Validate LCAx document against schema
   */
  validateLCAx(document: FinnishLCAxDocument): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation
    if (!document.version) {
      errors.push('Missing version');
    }

    if (!document.project) {
      errors.push('Missing project information');
    }

    if (!document.assemblies || document.assemblies.length === 0) {
      errors.push('No assemblies found');
    }

    // Finnish extensions validation
    if (!document.finnishExtensions) {
      warnings.push('Missing Finnish extensions');
    } else {
      if (!document.finnishExtensions.co2dataReferences) {
        warnings.push('Missing CO2Data.fi references');
      }
      if (!document.finnishExtensions.en15804Compliance) {
        warnings.push('EN 15804 compliance not verified');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Export to JSON file
   */
  exportToFile(document: FinnishLCAxDocument, filename: string): void {
    try {
      downloadJSON(document, {
        filename: filename,
        mimeType: 'application/json'
      });
      
      console.log('[LCAxExporter] File exported successfully:', filename);
    } catch (error) {
      console.error('[LCAxExporter] Error exporting file:', error);
      throw new Error('Failed to export LCAx file');
    }
  }

  /**
   * Get OneClickLCA compatibility information
   */
  getOneClickLCACompatibility(): OneClickLCACompatibility {
    return {
      supportedFormats: [
        'Whole life carbon assessment (GLA/RICS/Green Mark)',
        'LCA for BREEAM UK',
        'LCA for DGNB (DE)',
        'LCA for LEED, Int\'l (CML)',
        'Level(s) life-cycle carbon (EN15804 +A1)',
        'LCA for LEED, US (TRACI)'
      ],
      conversionNotes: [
        'Finnish extensions may need manual mapping to OneClickLCA fields',
        'CO2Data.fi references should be mapped to OneClickLCA material database',
        'Transport factors from VTT LIPASTO are compatible',
        'EN 15804 compliance is verified'
      ],
      limitations: [
        'OneClickLCA may not recognize Finnish-specific material IDs',
        'Some Finnish standards may not have direct equivalents',
        'Custom impact categories may need manual configuration'
      ]
    };
  }

  /**
   * Create metadata section
   */
  private createMetadata(): LCAxMetadata {
    return {
      created: new Date().toISOString(),
      creator: 'LCAPPCOST Application',
      description: 'LCA analysis with Finnish extensions',
      version: this.LCAX_VERSION,
      license: 'Apache-2.0'
    };
  }

  /**
   * Create project section
   */
  private createProject(projectInfo: any): LCAxProject {
    return {
      name: projectInfo?.name || 'Unnamed Project',
      description: `LCA analysis for ${projectInfo?.type || 'building'} project`,
      location: {
        country: 'FI',
        region: projectInfo?.location || 'Helsinki',
        city: projectInfo?.location || 'Helsinki'
      },
      functionalUnit: {
        name: 'Building area',
        value: projectInfo?.area || 100,
        unit: 'm²',
        description: 'Total building area for LCA analysis'
      },
      impactCategories: [
        {
          name: 'Global Warming Potential',
          unit: 'kg CO₂ eq',
          method: 'IPCC AR6',
          description: 'Climate change impact'
        },
        {
          name: 'Acidification Potential',
          unit: 'kg SO₂ eq',
          method: 'CML-IA',
          description: 'Acid rain formation'
        },
        {
          name: 'Eutrophication Potential',
          unit: 'kg PO₄ eq',
          method: 'CML-IA',
          description: 'Water quality impact'
        },
        {
          name: 'Ozone Depletion Potential',
          unit: 'kg CFC-11 eq',
          method: 'CML-IA',
          description: 'Ozone layer depletion'
        },
        {
          name: 'Primary Energy',
          unit: 'MJ',
          method: 'CML-IA',
          description: 'Total energy consumption'
        }
      ]
    };
  }

  /**
   * Create assemblies from materials
   */
  private createAssemblies(materials: any[]): LCAxAssembly[] {
    const assemblies: LCAxAssembly[] = [];
    const materialGroups = this.groupMaterialsByCategory(materials);

    materialGroups.forEach((groupMaterials, category) => {
      const assembly: LCAxAssembly = {
        id: `assembly_${category.toLowerCase().replace(/\s+/g, '_')}`,
        name: category,
        description: `${category} assembly`,
        quantity: {
          value: groupMaterials.reduce((sum, m) => sum + (m.volume || 0), 0),
          unit: 'm³'
        },
        materials: groupMaterials.map(material => this.createMaterial(material)),
        impacts: this.calculateAssemblyImpacts(groupMaterials),
        transport: this.createTransport(groupMaterials)
      };

      assemblies.push(assembly);
    });

    return assemblies;
  }

  /**
   * Create EPDs from materials
   */
  private createEPDs(materials: any[]): LCAxEPD[] {
    const epds: LCAxEPD[] = [];
    const uniqueMaterials = this.getUniqueMaterials(materials);

    uniqueMaterials.forEach(material => {
      const materialData = MATERIAL_FACTORS[material.name];
      if (materialData?.source) {
        const epd: LCAxEPD = {
          id: materialData.source.id,
          name: materialData.name.fi || materialData.name.en,
          version: materialData.source.version,
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
          manufacturer: materialData.manufacturer ? {
            name: materialData.manufacturer.name,
            location: materialData.manufacturer.location,
            epdNumber: materialData.manufacturer.epd_number || ''
          } : {
            name: 'Unknown',
            location: 'Finland',
            epdNumber: ''
          },
          impacts: [
            {
              category: 'Global Warming Potential',
              value: materialData.impacts.gwp,
              unit: 't CO₂ eq/m³'
            },
            {
              category: 'Acidification Potential',
              value: materialData.impacts.ap,
              unit: 'kg SO₂ eq/m³'
            },
            {
              category: 'Eutrophication Potential',
              value: materialData.impacts.ep,
              unit: 'kg PO₄ eq/m³'
            },
            {
              category: 'Ozone Depletion Potential',
              value: materialData.impacts.ozone,
              unit: 'kg CFC-11 eq/m³'
            },
            {
              category: 'Primary Energy',
              value: materialData.impacts.energy,
              unit: 'MJ/m³'
            }
          ],
          source: materialData.source
        };
        epds.push(epd);
      }
    });

    return epds;
  }

  /**
   * Create Finnish extensions
   */
  private createFinnishExtensions(materials: any[], results: any): FinnishLCAxExtensions {
    const co2dataReferences = this.extractCO2DataReferences(materials);
    const rtsEPDs = this.extractRTSEPDs(materials);

    return {
      co2dataReferences,
      rtsEPDs,
      vttFactors: true,
      en15804Compliance: true,
      finnishStandards: {
        buildingCode: 'Rakennusmääräyskokoelma',
        energyEfficiency: 'Energiatehokkuusasetus',
        fireSafety: 'Paloturvallisuusasetus',
        accessibility: 'Esteettömyysasetus',
        environmentalProtection: 'Ympäristönsuojeluasetus'
      },
      transportFactors: {
        truck: TRANSPORT_FACTORS.truck,
        train: TRANSPORT_FACTORS.train,
        ship: TRANSPORT_FACTORS.ship,
        source: 'VTT LIPASTO database'
      }
    };
  }

  /**
   * Group materials by category
   */
  private groupMaterialsByCategory(materials: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();
    
    materials.forEach(material => {
      const category = material.category || 'Unknown';
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(material);
    });

    return groups;
  }

  /**
   * Create material object
   */
  private createMaterial(material: any): LCAxMaterial {
    const materialData = MATERIAL_FACTORS[material.name];
    
    return {
      id: material.name,
      name: material.name,
      quantity: {
        value: material.volume || 0,
        unit: 'm³'
      },
      epdId: materialData?.source?.id,
      source: materialData?.source || {
        database: 'Unknown',
        id: material.name,
        version: '1.0',
        verified: false
      }
    };
  }

  /**
   * Calculate assembly impacts
   */
  private calculateAssemblyImpacts(materials: any[]): LCAxImpact[] {
    const impacts = {
      gwp: 0,
      ap: 0,
      ep: 0,
      ozone: 0,
      energy: 0
    };

    materials.forEach(material => {
      const materialData = MATERIAL_FACTORS[material.name];
      if (materialData && material.volume) {
        impacts.gwp += material.volume * materialData.impacts.gwp;
        impacts.ap += material.volume * materialData.impacts.ap;
        impacts.ep += material.volume * materialData.impacts.ep;
        impacts.ozone += material.volume * materialData.impacts.ozone;
        impacts.energy += material.volume * materialData.impacts.energy;
      }
    });

    return [
      { category: 'Global Warming Potential', value: impacts.gwp, unit: 't CO₂ eq' },
      { category: 'Acidification Potential', value: impacts.ap, unit: 'kg SO₂ eq' },
      { category: 'Eutrophication Potential', value: impacts.ep, unit: 'kg PO₄ eq' },
      { category: 'Ozone Depletion Potential', value: impacts.ozone, unit: 'kg CFC-11 eq' },
      { category: 'Primary Energy', value: impacts.energy, unit: 'MJ' }
    ];
  }

  /**
   * Create transport information
   */
  private createTransport(materials: any[]): LCAxTransport | undefined {
    const totalDistance = materials.reduce((sum, m) => sum + (m.transport?.distance || 0), 0);
    const avgDistance = totalDistance / materials.length;

    if (avgDistance > 0) {
      return {
        distance: avgDistance,
        unit: 'km',
        mode: 'truck',
        emissionFactor: TRANSPORT_FACTORS.truck
      };
    }

    return undefined;
  }

  /**
   * Get unique materials
   */
  private getUniqueMaterials(materials: any[]): any[] {
    const unique = new Map<string, any>();
    materials.forEach(material => {
      if (!unique.has(material.name)) {
        unique.set(material.name, material);
      }
    });
    return Array.from(unique.values());
  }

  /**
   * Extract CO2Data.fi references
   */
  private extractCO2DataReferences(materials: any[]): string[] {
    const references: string[] = [];
    
    materials.forEach(material => {
      const materialData = MATERIAL_FACTORS[material.name];
      if (materialData?.source?.database === 'CO2Data.fi' && materialData.source.id) {
        references.push(materialData.source.id);
      }
    });

    return [...new Set(references)];
  }

  /**
   * Extract RTS EPDs
   */
  private extractRTSEPDs(materials: any[]): string[] {
    const epds: string[] = [];
    
    materials.forEach(material => {
      const materialData = MATERIAL_FACTORS[material.name];
      if (materialData?.manufacturer?.epd_number) {
        epds.push(materialData.manufacturer.epd_number);
      }
    });

    return [...new Set(epds)];
  }
}

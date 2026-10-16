/**
 * LCAx Export Example
 * Demonstrates how to use the LCAx exporter with real project data
 */

import { LCAxExporter } from '../services/LCAxExporter';

export class LCAxExportExample {
  private exporter: LCAxExporter;

  constructor() {
    this.exporter = LCAxExporter.getInstance();
  }

  /**
   * Example: Export residential building LCA analysis
   */
  async exportResidentialBuildingExample() {
    console.log('🏠 Exporting Residential Building LCA Analysis...');

    // Sample project data
    const projectInfo = {
      name: 'Helsinki Residential Complex',
      type: 'residential',
      area: 2500, // m²
      location: 'Helsinki, Finland',
      buildingType: 'apartment',
      constructionYear: 2024
    };

    // Sample materials with Finnish data
    const materials = [
      {
        name: 'Betoni',
        volume: 1250, // m³
        category: 'Concrete',
        impacts: {
          gwp: 354.2,      // kg CO₂ eq
          ap: 950.0,       // kg SO₂ eq
          ep: 137.5,       // kg PO₄ eq
          ozone: 0.002375, // kg CFC-11 eq
          energy: 2062500  // MJ
        },
        transport: {
          distance: 45,    // km
          mode: 'truck'
        }
      },
      {
        name: 'Teräs',
        volume: 85,        // m³
        category: 'Steel',
        impacts: {
          gwp: 204.0,      // kg CO₂ eq
          ap: 357.0,       // kg SO₂ eq
          ep: 32.3,        // kg PO₄ eq
          ozone: 0.00323,  // kg CFC-11 eq
          energy: 2422500  // MJ
        },
        transport: {
          distance: 180,   // km
          mode: 'truck'
        }
      },
      {
        name: 'Puu',
        volume: 320,       // m³
        category: 'Wood',
        impacts: {
          gwp: -64.0,      // kg CO₂ eq (negative due to carbon sequestration)
          ap: 32.0,        // kg SO₂ eq
          ep: 6.4,         // kg PO₄ eq
          ozone: 0.000064, // kg CFC-11 eq
          energy: 128000   // MJ
        },
        transport: {
          distance: 120,   // km
          mode: 'truck'
        }
      }
    ];

    // Sample LCA results
    const results = {
      impacts: {
        gwp: { total: 494.2, perM2: 0.198 },
        ap: { total: 1339.0, perM2: 0.536 },
        ep: { total: 176.2, perM2: 0.070 },
        ozone: { total: 0.005659, perM2: 0.000002 },
        energy: { total: 4613000, perM2: 1845.2 }
      },
      source: 'CO2Data.fi',
      validationMetrics: {
        buildingType: 'residential',
        area: 2500,
        compliance: {
          en15804: true,
          finnishStandards: true,
          energyEfficiency: 'A'
        }
      },
      moduleContributions: {
        A1A3: 85.2,  // Production
        A4: 8.1,     // Transport to site
        A5: 6.7      // Construction
      }
    };

    try {
      // Convert to Finnish LCAx format
      const lcaxDocument = this.exporter.convertToFinnishLCAx(
        materials,
        projectInfo,
        results
      );

      // Validate the document
      const validation = this.exporter.validateLCAx(lcaxDocument);
      
      if (!validation.isValid) {
        console.error('❌ LCAx validation failed:', validation.errors);
        return;
      }

      console.log('✅ LCAx document created successfully');
      console.log('📊 Validation warnings:', validation.warnings);

      // Export to file
      const filename = `LCAx_Helsinki_Residential_${new Date().toISOString().split('T')[0]}.json`;
      this.exporter.exportToFile(lcaxDocument, filename);

      // Show OneClickLCA compatibility info
      const compatibility = this.exporter.getOneClickLCACompatibility();
      console.log('🔗 OneClickLCA Compatibility:');
      console.log('   Supported formats:', compatibility.supportedFormats.length);
      console.log('   Conversion notes:', compatibility.conversionNotes.length);
      console.log('   Limitations:', compatibility.limitations.length);

      console.log('✅ Export completed successfully!');
      console.log(`📁 File saved as: ${filename}`);

      return {
        success: true,
        filename,
        validation,
        compatibility
      };

    } catch (error) {
      console.error('❌ Export failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Example: Export office building LCA analysis
   */
  async exportOfficeBuildingExample() {
    console.log('🏢 Exporting Office Building LCA Analysis...');

    const projectInfo = {
      name: 'Espoo Business Center',
      type: 'commercial',
      area: 5000, // m²
      location: 'Espoo, Finland',
      buildingType: 'office',
      constructionYear: 2024
    };

    const materials = [
      {
        name: 'Betoni',
        volume: 2800,
        category: 'Concrete',
        impacts: {
          gwp: 792.4,
          ap: 2128.0,
          ep: 308.0,
          ozone: 0.00532,
          energy: 4620000
        },
        transport: { distance: 35, mode: 'truck' }
      },
      {
        name: 'Teräs',
        volume: 420,
        category: 'Steel',
        impacts: {
          gwp: 1008.0,
          ap: 1764.0,
          ep: 159.6,
          ozone: 0.01596,
          energy: 11970000
        },
        transport: { distance: 200, mode: 'train' }
      }
    ];

    const results = {
      impacts: {
        gwp: { total: 1800.4, perM2: 0.360 },
        ap: { total: 3892.0, perM2: 0.778 },
        ep: { total: 467.6, perM2: 0.094 },
        ozone: { total: 0.02128, perM2: 0.000004 },
        energy: { total: 16590000, perM2: 3318.0 }
      },
      source: 'CO2Data.fi',
      validationMetrics: {
        buildingType: 'commercial',
        area: 5000,
        compliance: {
          en15804: true,
          finnishStandards: true,
          energyEfficiency: 'A+'
        }
      }
    };

    try {
      const lcaxDocument = this.exporter.convertToFinnishLCAx(
        materials,
        projectInfo,
        results
      );

      const validation = this.exporter.validateLCAx(lcaxDocument);
      
      if (!validation.isValid) {
        console.error('❌ LCAx validation failed:', validation.errors);
        return;
      }

      const filename = `LCAx_Espoo_Office_${new Date().toISOString().split('T')[0]}.json`;
      this.exporter.exportToFile(lcaxDocument, filename);

      console.log('✅ Office building export completed!');
      console.log(`📁 File saved as: ${filename}`);

      return { success: true, filename, validation };

    } catch (error) {
      console.error('❌ Export failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Run all examples
   */
  async runAllExamples() {
    console.log('🚀 Running LCAx Export Examples...\n');

    const results = {
      residential: await this.exportResidentialBuildingExample(),
      office: await this.exportOfficeBuildingExample()
    };

    console.log('\n📋 Summary:');
    console.log(`   Residential: ${results.residential.success ? '✅' : '❌'}`);
    console.log(`   Office: ${results.office.success ? '✅' : '❌'}`);

    return results;
  }
}

// Example usage
if (typeof window !== 'undefined') {
  // Browser environment
  (window as any).LCAxExportExample = LCAxExportExample;
} else {
  // Node.js environment
  const example = new LCAxExportExample();
  example.runAllExamples().catch(console.error);
}

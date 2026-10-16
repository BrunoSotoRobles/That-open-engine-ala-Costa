import { MaterialData, FINNISH_MATERIAL_SOURCES, MATERIAL_FACTORS } from '../data/emissionFactors';
import { environmentalDataService } from './EnvironmentalDataService';

interface DatabaseResponse {
    success: boolean;
    data?: MaterialData[];
    error?: string;
}

export class MaterialDatabaseService {
    private static instance: MaterialDatabaseService;
    private cache: Map<string, MaterialData> = new Map();

    private constructor() {
        // Initialize cache with local data
        Object.entries(MATERIAL_FACTORS).forEach(([key, material]) => {
            this.cache.set(key, material);
        });
    }

    public static getInstance(): MaterialDatabaseService {
        if (!MaterialDatabaseService.instance) {
            MaterialDatabaseService.instance = new MaterialDatabaseService();
        }
        return MaterialDatabaseService.instance;
    }

    public async updateDatabase(): Promise<DatabaseResponse> {
        try {
            // Load environmental data
            await environmentalDataService.loadData();
            const envData = environmentalDataService.getData();
            
            if (!envData) {
                console.warn('No environmental data available, using local data');
                return {
                    success: true,
                    data: Array.from(this.cache.values())
                };
            }

            // Clear existing cache
            this.cache.clear();

            // Add environmental data materials
            if (envData.DataItems) {
                envData.DataItems.forEach(resource => {
                    const materialData = this.convertEnvDataToMaterialData(resource);
                    this.cache.set(resource.ResourceId, materialData);
                });
            }

            // Add local materials as fallback
            Object.entries(MATERIAL_FACTORS).forEach(([key, material]) => {
                if (!this.cache.has(key)) {
                    this.cache.set(key, material);
                }
            });

            console.log('Database updated successfully with environmental data');
            return {
                success: true,
                data: Array.from(this.cache.values())
            };
        } catch (error) {
            console.error('Error updating database:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private normalizeMaterialName(name: string): string {
        return name
            .toLowerCase()
            .replace(/[0-9]+$/, '')  // Remove numbers at the end
            .replace(/,/g, '')       // Remove commas
            .trim();                 // Remove extra spaces
    }

    private findBestMatch(normalizedName: string, material: MaterialData): boolean {
        const normalizedFi = this.normalizeMaterialName(material.name.fi);
        const normalizedEn = this.normalizeMaterialName(material.name.en);

        // Exact match
        if (normalizedName === normalizedFi || normalizedName === normalizedEn) {
            return true;
        }

        // Check if the normalized name is contained in or contains the material name
        if (normalizedFi.includes(normalizedName) || normalizedName.includes(normalizedFi) ||
            normalizedEn.includes(normalizedName) || normalizedName.includes(normalizedEn)) {
            return true;
        }

        // Handle common material variations
        const commonVariations: { [key: string]: string[] } = {
            'betoni': ['betoniverhous'],
            'eriste': ['eriste kova', 'eriste jäykkä', 'eriste villa'],
            'puu': ['puuverhous', 'puuclt', 'puuranka'],
            'metalli': ['metallipinnoite', 'metalliverhous'],
            'alumiini': ['alumiinilevy', 'alumiiniverhous'],
            'teräs': ['teräslevy', 'teräsverhous']
        };

        // Check if the normalized name matches any common variations
        for (const [base, variations] of Object.entries(commonVariations)) {
            if (normalizedName.includes(base) || variations.some(v => normalizedName.includes(v))) {
                if (normalizedFi.includes(base) || normalizedEn.includes(base)) {
                    return true;
                }
            }
        }

        return false;
    }

    private convertEnvDataToMaterialData(resource: any): MaterialData {
        const impacts: any = {};
        const properties: any = {};

        // Extract impact values from DataItems
        if (resource.DataItems) {
            resource.DataItems.forEach((item: any) => {
                const value = item.Value;
                const unit = item.Unit;
                
                // Convert units if necessary
                switch (item.ResourceId.toLowerCase()) {
                    case 'gwp':
                        // Convert from kgCO2e/kg to t CO₂ eq/m³
                        impacts.gwp = value * 0.001 * 2400; // Assuming density of 2400 kg/m³
                        break;
                    case 'ap':
                        // Convert from kgSO2e/kg to kg SO₂ eq/m³
                        impacts.ap = value * 2400;
                        break;
                    case 'ep':
                        // Convert from kgPO4e/kg to kg PO₄ eq/m³
                        impacts.ep = value * 2400;
                        break;
                    case 'ozone':
                        // Convert from kgCFC11e/kg to kg CFC-11 eq/m³
                        impacts.ozone = value * 2400;
                        break;
                    case 'energy':
                        // Convert from MJ/kg to MJ/m³
                        impacts.energy = value * 2400;
                        break;
                }
            });
        }

        // Set default properties based on material type
        const materialType = resource.ResourceId.toLowerCase();
        switch (materialType) {
            case 'concrete':
                properties.density = 2400;
                properties.service_life = 50;
                properties.recyclability = 0.8;
                break;
            case 'wood':
                properties.density = 500;
                properties.service_life = 30;
                properties.recyclability = 0.9;
                break;
            case 'insulation':
                properties.density = 100;
                properties.service_life = 40;
                properties.recyclability = 0.7;
                break;
            case 'metal_cladding':
                properties.density = 7850;
                properties.service_life = 40;
                properties.recyclability = 0.95;
                break;
            case 'aluminum':
                properties.density = 2700;
                properties.service_life = 40;
                properties.recyclability = 0.95;
                break;
            case 'gypsum_board':
                properties.density = 800;
                properties.service_life = 30;
                properties.recyclability = 0.6;
                break;
            case 'building_board':
                properties.density = 700;
                properties.service_life = 30;
                properties.recyclability = 0.7;
                break;
            case 'plywood':
                properties.density = 550;
                properties.service_life = 30;
                properties.recyclability = 0.8;
                break;
            case 'fire_protection':
                properties.density = 1200;
                properties.service_life = 40;
                properties.recyclability = 0.7;
                break;
            default:
                properties.density = 2400;
                properties.service_life = 50;
                properties.recyclability = 0.8;
        }

        return {
            name: {
                fi: resource.Name,
                en: resource.Name // Using same name for both languages as placeholder
            },
            source: {
                database: "co2data.fi",
                id: resource.ResourceId,
                version: "1.0",
                verified: true
            },
            impacts: {
                gwp: impacts.gwp || 0,
                ap: impacts.ap || 0,
                ep: impacts.ep || 0,
                ozone: impacts.ozone || 0,
                energy: impacts.energy || 0
            },
            properties: properties,
            transport: {
                default_distance: 50, // Default value, should be updated with real data
                emission_factor: 0.1 // Default value, should be updated with real data
            },
            manufacturer: {
                name: "Unknown", // Default value, should be updated with real data
                location: "Finland", // Default value, should be updated with real data
                epd_number: "Unknown" // Default value, should be updated with real data
            }
        };
    }

    public getMaterial(name: string): MaterialData | undefined {
        if (!name) return undefined;
        
        const normalizedSearchName = this.normalizeMaterialName(name);
        
        // First try to find in environmental data
        const envData = environmentalDataService.getData();
        if (envData?.DataItems) {
            const envMaterial = envData.DataItems.find(resource => 
                this.normalizeMaterialName(resource.Name) === normalizedSearchName
            );
            if (envMaterial) {
                return this.convertEnvDataToMaterialData(envMaterial);
            }
        }

        // Then try exact matches in local cache
        for (const [_, material] of this.cache) {
            if (this.normalizeMaterialName(material.name.fi) === normalizedSearchName ||
                this.normalizeMaterialName(material.name.en) === normalizedSearchName) {
                return material;
            }
        }

        // Finally try fuzzy matching in local cache
        for (const [_, material] of this.cache) {
            if (this.findBestMatch(normalizedSearchName, material)) {
                return material;
            }
        }

        return undefined;
    }

    public getAllMaterials(): MaterialData[] {
        const materials: MaterialData[] = [];

        // Add environmental data materials if available
        const envData = environmentalDataService.getData();
        if (envData?.DataItems) {
            envData.DataItems.forEach(resource => {
                materials.push(this.convertEnvDataToMaterialData(resource));
            });
        }

        // Add local materials
        materials.push(...Array.from(this.cache.values()));

        return materials;
    }

    public clearCache(): void {
        this.cache.clear();
    }
}

export const materialDatabaseService = MaterialDatabaseService.getInstance(); 
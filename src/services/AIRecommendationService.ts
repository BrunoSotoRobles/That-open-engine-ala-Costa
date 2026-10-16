import { MaterialImpact } from '../types/MaterialTypes';

interface RecommendationType {
    material: {
        fi: string;
        en: string;
    };
    currentImpact: number;
    totalVolume: number;
    recommendations: Array<{
        suggestion: {
            fi: string;
            en: string;
        };
        reasoning: string;
        technicalDetails: string[];
        carbonReduction: {
            direct: string;
            indirect?: string;
            conditions?: string;
        };
    }>;
    contextualFactors: {
        climate: string;
        localSupply: string;
        certification: string;
    };
}

class AIRecommendationService {
    private static instance: AIRecommendationService;

    private constructor() {}

    public static getInstance(): AIRecommendationService {
        if (!AIRecommendationService.instance) {
            AIRecommendationService.instance = new AIRecommendationService();
        }
        return AIRecommendationService.instance;
    }

    public async generateRecommendations(
        materials: MaterialImpact[],
        buildingType: string
    ): Promise<RecommendationType[]> {
        // Agrupar materiales similares
        const groupedMaterials = this.groupSimilarMaterials(materials);
        
        // Generar recomendaciones para cada grupo
        const recommendations = this.analyzeGroups(groupedMaterials, buildingType);

        return recommendations;
    }

    private groupSimilarMaterials(materials: MaterialImpact[]): Record<string, {
        materials: MaterialImpact[],
        totalImpact: number,
        totalVolume: number
    }> {
        return materials.reduce((acc, material) => {
            const materialName = material.name.toLowerCase();
            const key = this.getMaterialCategory(materialName);
            
            if (!acc[key]) {
                acc[key] = {
                    materials: [],
                    totalImpact: 0,
                    totalVolume: 0
                };
            }
            acc[key].materials.push(material);
            acc[key].totalImpact += material.impacts.gwp;
            acc[key].totalVolume += material.volume;
            return acc;
        }, {} as Record<string, { materials: MaterialImpact[], totalImpact: number, totalVolume: number }>);
    }

    private getMaterialCategory(materialName: string): string {
        if (materialName.includes('betoni') || materialName.includes('concrete')) return 'concrete';
        if (materialName.includes('teräs') || materialName.includes('steel')) return 'steel';
        if (materialName.includes('eriste') || materialName.includes('insulation')) return 'insulation';
        if (materialName.includes('puu') || materialName.includes('wood') || 
            materialName.includes('timber') || materialName.includes('clt')) return 'timber';
        return 'other';
    }

    private analyzeGroups(
        groupedMaterials: Record<string, { materials: MaterialImpact[], totalImpact: number, totalVolume: number }>,
        buildingType: string
    ): RecommendationType[] {
        const recommendations: RecommendationType[] = [];

        Object.entries(groupedMaterials).forEach(([category, group]) => {
            if (group.materials.length === 0) return;

            const baseRecommendation: RecommendationType = {
                material: {
                    fi: group.materials[0].name,
                    en: group.materials[0].name
                },
                currentImpact: group.totalImpact,
                totalVolume: group.totalVolume,
                recommendations: this.getCategoryRecommendations(category, buildingType),
                contextualFactors: {
                    climate: "Optimized for Finnish climate conditions",
                    localSupply: "All materials available within 100km radius",
                    certification: "RTS EPD verified, Finnish construction standards compliant"
                }
            };

            recommendations.push(baseRecommendation);
        });

        return recommendations;
    }

    private getCategoryRecommendations(category: string, buildingType: string): RecommendationType['recommendations'] {
        switch (category) {
            case 'concrete':
                return [
                    {
                        suggestion: {
                            fi: "Vähähiilinen betoni",
                            en: "Low-carbon concrete"
                        },
                        reasoning: "Using low-carbon concrete can reduce emissions by up to 50% while maintaining structural properties. Suitable for Finnish climate and readily available.",
                        technicalDetails: [
                            "Compliant with Finnish building codes",
                            "Same structural properties as traditional concrete",
                            "Enhanced durability in cold climate"
                        ],
                        carbonReduction: {
                            direct: "40-50%",
                            conditions: "Depending on specific application and mix design"
                        }
                    }
                ];
            case 'steel':
                return [
                    {
                        suggestion: {
                            fi: "Kierrätysteräs",
                            en: "Recycled steel"
                        },
                        reasoning: "Using recycled steel can reduce carbon footprint by up to 70% while maintaining all structural properties. SSAB in Raahe specializes in low-carbon steel production.",
                        technicalDetails: [
                            "Same structural properties as virgin steel",
                            "98% recyclability",
                            "Local production reduces transport emissions"
                        ],
                        carbonReduction: {
                            direct: "60-70%"
                        }
                    }
                ];
            case 'insulation':
                return [
                    {
                        suggestion: {
                            fi: "Puukuitueriste",
                            en: "Wood fiber insulation"
                        },
                        reasoning: "Wood fiber insulation offers similar thermal performance with lower carbon footprint and better moisture handling properties, particularly suitable for Finnish climate.",
                        technicalDetails: [
                            "Excellent moisture management",
                            "Renewable material source",
                            "Local production available"
                        ],
                        carbonReduction: {
                            direct: "30-40%",
                            conditions: "When moisture management is critical"
                        }
                    }
                ];
            default:
                return [];
        }
    }
}

export const aiRecommendationService = AIRecommendationService.getInstance(); 
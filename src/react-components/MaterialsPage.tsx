import * as React from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, Scale, Tick } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { useLCAStore, ProjectInfo } from '../stores/LCAStore';
import { useAuthStore } from '../stores/AuthStore';
import { MATERIAL_FACTORS, IMPACT_CATEGORIES, LIFE_CYCLE_MODULES, DATA_QUALITY_LEVELS, INDUSTRY_TARGETS, CARBON_COMPARISONS, SCORS_RATINGS, FINNISH_MATERIAL_SOURCES } from '../data/emissionFactors';
import { Bar } from 'react-chartjs-2';
import { materialDatabaseService } from '../services/MaterialDatabaseService';
import type { ChartOptions } from 'chart.js';
import { CarbonReductionAdvisor } from './CarbonReductionAdvisor';
import { LCAxExportComponent } from './LCAxExportComponent';
import { DatabaseStatusComponent } from './DatabaseStatusComponent';

// Registrar componentes de Chart.js
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);
ChartJS.register(ChartDataLabels);

// Definiciones de tipo
type TransportMode = 'none' | 'truck' | 'train' | 'ship';

// Interfaces
interface Props {}

interface ProjectData {
    name: string;
    area: number;
    budget: number;
    type: string;
    year: number;
    location: string;
}

interface ValidationMetrics {
    meanPerM2: number;
    maxPerM2: number;
    minPerM2: number;
}

interface MaterialImpact {
    name: string;
    volume: number;
    matched: boolean;
    category: string;
    impacts: {
        gwp: number;
        ap: number;
        ep: number;
        ozone: number;
        energy: number;
    };
    transport: {
        distance: number;
        mode: TransportMode;
    };
}

interface SheetData {
    name: string;
    values: (number | string)[];
}

interface ImpactValue {
    total: number;
    perYear: number;
    perM2: number;
    unit?: string;
    description?: string;
}

// Añadir después de las interfaces existentes
interface PdfProgress {
    isGenerating: boolean;
    currentStep: string;
    progress: number;
}

// Constantes
const TRANSPORT_FACTORS = {
    truck: 0.132,  // kg CO₂ eq/tkm (VTT LIPASTO database)
    train: 0.028,  // kg CO₂ eq/tkm (Finnish electric railway)
    ship: 0.015,   // kg CO₂ eq/tkm (Baltic Sea shipping)
    none: 0
};

const FINNISH_FACTORS = {
    climate: {
        helsinki: 1.2,
        tampere: 1.15,
        oulu: 1.25,
        default: 1.1
    },
    buildingType: {
        residential: 1.0,
        commercial: 1.1,
        industrial: 1.2,
        infrastructure: 1.15
    }
};

// Add after SCORS_RATINGS and before FINNISH_BUILDING_STANDARDS
const IMPACT_INDICATORS = {
    gwp: { name: 'Global Warming Potential', unit: 'kg CO₂ eq', description: 'Climate change impact' },
    ap: { name: 'Acidification Potential', unit: 'kg SO₂ eq', description: 'Acid rain formation' },
    ep: { name: 'Eutrophication Potential', unit: 'kg PO₄ eq', description: 'Water quality impact' },
    ozone: { name: 'Ozone Depletion', unit: 'kg CFC-11 eq', description: 'Ozone layer depletion' },
    energy: { name: 'Primary Energy', unit: 'MJ', description: 'Total energy consumption' }
};

// Añadir constantes para los factores de la normativa finlandesa
const FINNISH_BUILDING_STANDARDS = {
    residentialBaseline: {
        gwp: 14.0,     // kgCO2e/m2/year
        ap: 0.03,      // kgSO2e/m2/year
        ep: 0.009,     // kgPO4e/m2/year
        ozone: 2.7e-7, // kgCFC11e/m2/year
        energy: 504    // MJ/m2/year
    },
    buildingLifespan: 50, // años según EN 15804
    stageFactors: {
        A1A3: 1.0,  // Producción de materiales
        A4: 0.1,    // Transporte a obra
        A5: 0.2,    // Construcción e instalación
        B1B7: 0.5,  // Uso y mantenimiento
        C1C4: 0.2   // Fin de vida
    }
};

// Añadir después de las constantes existentes
const pdfHeaderStyle = {
    padding: '10px',
    border: '1px solid #000',
    backgroundColor: '#f0f0f0',
    color: '#000000',
    fontWeight: 'bold' as const,
    fontSize: '12px',
    textAlign: 'center' as const
};

const pdfCellStyle = {
    padding: '8px',
    border: '1px solid #000',
    color: '#000000',
    fontSize: '11px',
    textAlign: 'center' as const
};

// Función auxiliar para limpiar nombres de materiales
const cleanMaterialName = (name: string): string => {
    const cleaned = name
        .trim()
        .replace(/[\s-]*\d+$/, '')
        .replace(/[^\w\s]/g, '')
        .trim();
    
    // Check if material exists in Finnish database
    return Object.keys(MATERIAL_FACTORS).find(key => 
        MATERIAL_FACTORS[key].name.fi.toLowerCase() === cleaned.toLowerCase() ||
        MATERIAL_FACTORS[key].name.en.toLowerCase() === cleaned.toLowerCase()
    ) || cleaned;
};

interface ImpactThresholds {
    maxValue: number;
    typicalValue: number;
    unit: string;
}

const IMPACT_THRESHOLDS: Record<string, ImpactThresholds> = {
    gwp: {
        maxValue: 1000,      // t CO₂ eq por material
        typicalValue: 200,
        unit: 't CO₂ eq'
    },
    ap: {
        maxValue: 5000,      // kg SO₂ eq por material
        typicalValue: 1000,
        unit: 'kg SO₂ eq'
    },
    ep: {
        maxValue: 500,       // kg PO₄ eq por material
        typicalValue: 100,
        unit: 'kg PO₄ eq'
    },
    ozone: {
        maxValue: 0.1,       // kg CFC-11 eq por material
        typicalValue: 0.01,
        unit: 'kg CFC-11 eq'
    },
    energy: {
        maxValue: 10000000,  // MJ por material
        typicalValue: 1000000,
        unit: 'MJ'
    }
};

// Factores de ajuste por tipo de edificio
const BUILDING_TYPE_FACTORS = {
    residential: {
        gwp: 1.0,
        ap: 1.0,
        ep: 1.0,
        ozone: 1.0,
        energy: 1.0
    },
    commercial: {
        gwp: 1.2,
        ap: 1.1,
        ep: 1.1,
        ozone: 1.2,
        energy: 1.3
    },
    industrial: {
        gwp: 1.4,
        ap: 1.3,
        ep: 1.2,
        ozone: 1.4,
        energy: 1.5
    },
    infrastructure: {
        gwp: 1.6,
        ap: 1.4,
        ep: 1.3,
        ozone: 1.5,
        energy: 1.7
    }
};

const validateImpact = (
    value: number,
    impactType: keyof typeof IMPACT_THRESHOLDS,
    materialCategory: string
): number => {
    const threshold = IMPACT_THRESHOLDS[impactType];
    
    if (isNaN(value) || !isFinite(value)) {
        console.warn(`Invalid impact value for ${impactType}: ${value}`);
        return 0;
    }

    if (value > threshold.maxValue) {
        console.warn(
            `Impact value for ${impactType} exceeds maximum threshold: ${value} ${threshold.unit}. ` +
            `Adjusted to ${threshold.maxValue} ${threshold.unit}`
        );
        return threshold.maxValue;
    }

    return value;
};

const calculateImpacts = (volume: number, materialName: string): MaterialImpact['impacts'] => {
    const material = MATERIAL_FACTORS[materialName];
    if (!material) return { gwp: 0, ap: 0, ep: 0, ozone: 0, energy: 0 };
    
    const category = getMaterialCategory(materialName);
    
    // Calcular impactos base
    const baseImpacts = {
        gwp: volume * material.impacts.gwp,
        ap: volume * material.impacts.ap,
        ep: volume * material.impacts.ep,
        ozone: volume * material.impacts.ozone,
        energy: volume * material.impacts.energy
    };

    // Validar cada impacto
    return {
        gwp: validateImpact(baseImpacts.gwp, 'gwp', category),
        ap: validateImpact(baseImpacts.ap, 'ap', category),
        ep: validateImpact(baseImpacts.ep, 'ep', category),
        ozone: validateImpact(baseImpacts.ozone, 'ozone', category),
        energy: validateImpact(baseImpacts.energy, 'energy', category)
    };
};

const getMaterialCategory = (materialName: string): string => {
    const lowerName = materialName.toLowerCase();
    
    if (lowerName.includes('concrete') || lowerName.includes('betoni')) return 'concrete';
    if (lowerName.includes('steel') || lowerName.includes('teräs')) return 'metal';
    if (lowerName.includes('wood') || lowerName.includes('timber') || 
        lowerName.includes('puu') || lowerName.includes('clt')) return 'timber';
    if (lowerName.includes('glass') || lowerName.includes('lasi')) return 'glass';
    if (lowerName.includes('insulation') || lowerName.includes('eriste')) return 'insulation';
    
    return 'other';
};

// Añadir una función de utilidad para formatear números
const formatNumber = (value: number, decimals: number = 6): string => {
    // Primero redondear al número de decimales deseado
    const rounded = Number(value.toFixed(decimals));
    // Luego convertir a string con el número específico de decimales
    return rounded.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: false // Esto evita los separadores de miles
    });
};

// Componente ProjectDataForm
function ProjectDataForm({ onSubmit, initialData }: { 
    onSubmit: (data: ProjectData) => void,
    initialData?: ProjectInfo
}) {
    const [formData, setFormData] = React.useState<ProjectData>({
        name: initialData?.name || '',
        area: initialData?.area || 0,
        budget: initialData?.cost || 0,
        type: 'residential',
        year: new Date().getFullYear(),
        location: 'Helsinki'
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
    };

    return (
        <div className="modal-overlay">
            <form onSubmit={handleSubmit}>
                <h2>Project Information</h2>
                <div className="input-list">
                    <div className="form-field-container">
                        <label>Project Name</label>
                        <input
                            type="text"
                            value={formData.name}
                            readOnly
                        />
                    </div>
                    <div className="form-field-container">
                        <label>Area (m²)</label>
                        <input
                            type="number"
                            value={formData.area}
                            onChange={(e) => setFormData({...formData, area: Number(e.target.value)})}
                            required
                            min="0"
                            step="0.01"
                        />
                    </div>
                    <div className="form-field-container">
                        <label>Building Type</label>
                        <select
                            value={formData.type}
                            onChange={(e) => setFormData({...formData, type: e.target.value})}
                        >
                            <option value="residential">Residential</option>
                            <option value="commercial">Commercial</option>
                            <option value="industrial">Industrial</option>
                            <option value="infrastructure">Infrastructure</option>
                        </select>
                    </div>
                    <div className="form-field-container">
                        <label>Location</label>
                        <select
                            value={formData.location}
                            onChange={(e) => setFormData({...formData, location: e.target.value})}
                        >
                            <option value="Helsinki">Helsinki</option>
                            <option value="Tampere">Tampere</option>
                            <option value="Oulu">Oulu</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                    <button type="submit">Start Calculation</button>
                </div>
            </form>
        </div>
    );
}

function MaterialsTable({ materials, onMaterialUpdate }: { 
    materials: MaterialImpact[], 
    onMaterialUpdate: (updatedMaterials: MaterialImpact[]) => void 
}) {
    const [localMaterials, setLocalMaterials] = React.useState(materials);

    React.useEffect(() => {
        setLocalMaterials(materials);
    }, [materials]);

    // Agrupar materiales por categoría IFC y filtrar los de volumen muy bajo
    const materialsByCategory = React.useMemo(() => {
        const VOLUME_THRESHOLD = 0.01; // Umbral mínimo de volumen (ajustable según necesidad)
        
        return localMaterials
            .filter(material => material.volume >= VOLUME_THRESHOLD) // Filtrar materiales con volumen significativo
            .reduce((acc, material) => {
                const category = material.category || 'Unknown';
                if (!acc[category]) {
                    acc[category] = [];
                }
                acc[category].push(material);
                return acc;
            }, {} as Record<string, MaterialImpact[]>);
    }, [localMaterials]); // Cambiar de materials a localMaterials para que la UI se actualice en tiempo real

    const handleImpactChange = (materialId: string, impactType: keyof MaterialImpact['impacts'], value: number) => {

        
        const updatedMaterials = localMaterials.map(material => {
            if (material.name === materialId) {
                return {
                    ...material,
                    impacts: {
                        ...material.impacts,
                        [impactType]: value
                    }
                };
            }
            return material;
        });
        
        setLocalMaterials(updatedMaterials);

    };

    const handleTransportChange = (materialId: string, field: 'distance' | 'mode', value: string | number) => {

        
        const updatedMaterials = localMaterials.map(material => {
            if (material.name === materialId) {
                const currentTransport = material.transport || { distance: 0, mode: 'none' };
                return {
                    ...material,
                    transport: {
                        ...currentTransport,
                        [field]: value
                    }
                };
            }
            return material;
        });
        
        setLocalMaterials(updatedMaterials);
        console.log('[LCA] Transport updated:', updatedMaterials.find(m => m.name === materialId)?.transport);
    };

    // Función para obtener el valor de referencia de MATERIAL_FACTORS
    const getReferenceValue = (materialName: string, impactType: keyof MaterialImpact['impacts']): number => {
        const cleanName = cleanMaterialName(materialName);
        const matchedMaterial = Object.keys(MATERIAL_FACTORS).find(key => 
            cleanMaterialName(key) === cleanName
        );
        
        if (matchedMaterial && MATERIAL_FACTORS[matchedMaterial].impacts) {
            return MATERIAL_FACTORS[matchedMaterial].impacts[impactType];
        }
        return 0;
    };

    // Función para obtener el EPD del material
    const getEPDLink = (materialName: string): string | undefined => {
        const material = materialDatabaseService.getMaterial(materialName);
        if (!material?.source?.id) {
            return undefined;
        }
        return `https://co2data.fi/rakentaminen/#${material.source.id}`;
    };

    const getSourceInfo = (materialName: string): { url: string, tooltip: string } | undefined => {
        const material = materialDatabaseService.getMaterial(materialName);
        
        if (!material?.source) {
            return undefined;
        }
        
        return {
            url: `https://co2data.fi/rakentaminen/#${material.source.id}`,
            tooltip: `Source: ${material.source.database}
ID: ${material.source.id}
Version: ${material.source.version}
Data Status: ${material.source.verified ? 'Verified' : 'Pending verification'}`
        };
    };

    return (
        <>
            <div className="materials-table dashboard-card">
                <div className="card-header">
                    <h3>Material Quantities and Impacts</h3>
                </div>
                <div className="table-container">
                    <table className="lca-table">
                        <thead>
                            <tr className="main-header">
                                <th>Material</th>
                                <th>Volume (m³)</th>
                                <th>GWP (t CO₂ eq)</th>
                                <th>AP (kg SO₂ eq)</th>
                                <th>EP (kg PO₄ eq)</th>
                                <th>ODP (kg CFC-11 eq)</th>
                                <th>Energy (MJ)</th>
                                <th>Distance (km)</th>
                                <th>Transport Mode</th>
                            </tr>
                        </thead>
                        {Object.entries(materialsByCategory).map(([category, categoryMaterials]) => (
                            <tbody key={category}>
                                <tr className="category-header">
                                    <td colSpan={9}>{category}</td>
                                </tr>
                                {categoryMaterials.map((mat, index) => (
                                    <tr key={index} className={mat.matched ? '' : 'no-match'}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                {mat.name}
                                                {getSourceInfo(mat.name) ? (
                                                    <a 
                                                        href={getSourceInfo(mat.name)?.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        title={getSourceInfo(mat.name)?.tooltip}
                                                    >
                                                        <span className="material-icons" style={{ fontSize: '16px', color: 'var(--primary)' }}>
                                                            info
                                                        </span>
                                                    </a>
                                                ) : (
                                                    <span 
                                                        className="material-icons" 
                                                        style={{ fontSize: '16px', color: 'var(--background-200)' }}
                                                        title="No source information available"
                                                    >
                                                        block
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td>{mat.volume.toFixed(2)}</td>
                                        <td>
                                            <input
                                                type="number"
                                                value={formatNumber(mat.impacts.gwp, 2)}
                                                onChange={(e) => handleImpactChange(
                                                    mat.name,
                                                    'gwp',
                                                    parseFloat(e.target.value)
                                                )}
                                                step="0.01"
                                                title={`Reference value: ${getReferenceValue(mat.name, 'gwp')}\nGlobal Warming Potential\nEdit this value to update the climate change impact`}
                                                data-has-tooltip
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="number"
                                                value={formatNumber(mat.impacts.ap, 3)}
                                                onChange={(e) => handleImpactChange(
                                                    mat.name,
                                                    'ap',
                                                    parseFloat(e.target.value)
                                                )}
                                                step="0.001"
                                                title={`Reference value: ${getReferenceValue(mat.name, 'ap')}\nAcidification Potential\nEdit this value to update the acid rain formation impact`}
                                                data-has-tooltip
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="number"
                                                value={formatNumber(mat.impacts.ep, 3)}
                                                onChange={(e) => handleImpactChange(
                                                    mat.name,
                                                    'ep',
                                                    parseFloat(e.target.value)
                                                )}
                                                step="0.001"
                                                title={`Reference value: ${getReferenceValue(mat.name, 'ep')}\nEutrophication Potential\nEdit this value to update the water quality impact`}
                                                data-has-tooltip
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="number"
                                                value={formatNumber(mat.impacts.ozone, 6)}
                                                onChange={(e) => handleImpactChange(
                                                    mat.name,
                                                    'ozone',
                                                    parseFloat(e.target.value)
                                                )}
                                                step="0.000001"
                                                title={`Reference value: ${getReferenceValue(mat.name, 'ozone')}\nOzone Depletion Potential\nEdit this value to update the ozone layer depletion impact`}
                                                data-has-tooltip
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="number"
                                                value={formatNumber(mat.impacts.energy, 1)}
                                                onChange={(e) => handleImpactChange(
                                                    mat.name,
                                                    'energy',
                                                    parseFloat(e.target.value)
                                                )}
                                                step="0.1"
                                                title={`Reference value: ${getReferenceValue(mat.name, 'energy')}\nPrimary Energy\nEdit this value to update the total energy consumption`}
                                                data-has-tooltip
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="number"
                                                value={formatNumber(mat.transport?.distance || 0, 0)}
                                                onChange={(e) => handleTransportChange(
                                                    mat.name,
                                                    'distance',
                                                    parseFloat(e.target.value)
                                                )}
                                                min="0"
                                                title={"Transport Distance\nEdit this value to update the transportation distance"}
                                                data-has-tooltip
                                            />
                                        </td>
                                        <td>
                                            <select
                                                value={mat.transport?.mode || 'none'}
                                                onChange={(e) => handleTransportChange(
                                                    mat.name,
                                                    'mode',
                                                    e.target.value
                                                )}
                                                title={"Transport Mode\nSelect the mode of transportation"}
                                                data-has-tooltip
                                            >
                                                <option value="none">None</option>
                                                <option value="truck">Truck</option>
                                                <option value="train">Train</option>
                                                <option value="ship">Ship</option>
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        ))}
                    </table>
                </div>
            </div>
            
            <div className="dashboard-card">
                <div className="card-content">
                    <button 
                        className="action-button" 
                        onClick={() => {
                            
                            onMaterialUpdate(localMaterials);
                        }}
                    >
                        <span className="material-icons">refresh</span>
                        Recalculate Impacts
                    </button>

                </div>
            </div>
        </>
    );
}

const EN15804Assessment = ({ impacts, moduleContributions }: { impacts: any, moduleContributions: any }) => {
    if (!impacts || !moduleContributions) return null;

    const formatValue = (value: number) => value.toFixed(2);

    return (
        <div className="dashboard-card">
            <div className="card-header">
                <h3>EN 15804 Life Cycle Assessment</h3>
            </div>
            <div className="en15804-assessment">
                <table className="lca-table">
                    <thead>
                        <tr>
                            <th rowSpan={2}>Environmental Impacts</th>
                            <th colSpan={3}>Production</th>
                            <th colSpan={2}>Construction</th>
                            <th>Use</th>
                            <th colSpan={2}>End of Life</th>
                            <th rowSpan={2}>Total</th>
                        </tr>
                        <tr>
                            <th>A1-A3</th>
                            <th>A4</th>
                            <th>A5</th>
                            <th>B1-B5</th>
                            <th>B6-B7</th>
                            <th>C1</th>
                            <th>C2</th>
                            <th>C3-C4</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td className="impact-name">
                                Global Warming Potential
                                <span className="impact-unit">(t CO₂ eq)</span>
                            </td>
                            <td>{formatValue(moduleContributions.A1A3.gwp)}</td>
                            <td>{formatValue(moduleContributions.A4.gwp)}</td>
                            <td>{formatValue(moduleContributions.A5.gwp)}</td>
                            <td>{formatValue(moduleContributions.B1B7.gwp)}</td>
                            <td>{formatValue(moduleContributions.B1B7.gwp)}</td>
                            <td>{formatValue(moduleContributions.C1C4.gwp)}</td>
                            <td>{formatValue(moduleContributions.C1C4.gwp)}</td>
                            <td>{formatValue(moduleContributions.C1C4.gwp)}</td>
                            <td className="total-value">{formatValue(impacts.gwp.total)}</td>
                        </tr>
                        <tr>
                            <td className="impact-name">
                                Acidification Potential
                                <span className="impact-unit">(kg SO₂ eq)</span>
                            </td>
                            <td>{formatValue(moduleContributions.A1A3.ap)}</td>
                            <td>{formatValue(moduleContributions.A4.ap)}</td>
                            <td>{formatValue(moduleContributions.A5.ap)}</td>
                            <td>{formatValue(moduleContributions.B1B7.ap)}</td>
                            <td>{formatValue(moduleContributions.B1B7.ap)}</td>
                            <td>{formatValue(moduleContributions.C1C4.ap)}</td>
                            <td>{formatValue(moduleContributions.C1C4.ap)}</td>
                            <td>{formatValue(moduleContributions.C1C4.ap)}</td>
                            <td className="total-value">{formatValue(impacts.ap.total)}</td>
                        </tr>
                        <tr>
                            <td className="impact-name">
                                Eutrophication Potential
                                <span className="impact-unit">(kg PO₄ eq)</span>
                            </td>
                            <td>{formatValue(moduleContributions.A1A3.ep)}</td>
                            <td>{formatValue(moduleContributions.A4.ep)}</td>
                            <td>{formatValue(moduleContributions.A5.ep)}</td>
                            <td>{formatValue(moduleContributions.B1B7.ep)}</td>
                            <td>{formatValue(moduleContributions.B1B7.ep)}</td>
                            <td>{formatValue(moduleContributions.C1C4.ep)}</td>
                            <td>{formatValue(moduleContributions.C1C4.ep)}</td>
                            <td>{formatValue(moduleContributions.C1C4.ep)}</td>
                            <td className="total-value">{formatValue(impacts.ep.total)}</td>
                        </tr>
                        <tr>
                            <td className="impact-name">
                                Ozone Depletion Potential
                                <span className="impact-unit">(kg CFC-11 eq)</span>
                            </td>
                            <td>{formatValue(moduleContributions.A1A3.ozone)}</td>
                            <td>{formatValue(moduleContributions.A4.ozone)}</td>
                            <td>{formatValue(moduleContributions.A5.ozone)}</td>
                            <td>{formatValue(moduleContributions.B1B7.ozone)}</td>
                            <td>{formatValue(moduleContributions.B1B7.ozone)}</td>
                            <td>{formatValue(moduleContributions.C1C4.ozone)}</td>
                            <td>{formatValue(moduleContributions.C1C4.ozone)}</td>
                            <td>{formatValue(moduleContributions.C1C4.ozone)}</td>
                            <td className="total-value">{formatValue(impacts.ozone.total)}</td>
                        </tr>
                        <tr>
                            <td className="impact-name">
                                Primary Energy
                                <span className="impact-unit">(MJ)</span>
                            </td>
                            <td>{formatValue(moduleContributions.A1A3.energy)}</td>
                            <td>{formatValue(moduleContributions.A4.energy)}</td>
                            <td>{formatValue(moduleContributions.A5.energy)}</td>
                            <td>{formatValue(moduleContributions.B1B7.energy)}</td>
                            <td>{formatValue(moduleContributions.B1B7.energy)}</td>
                            <td>{formatValue(moduleContributions.C1C4.energy)}</td>
                            <td>{formatValue(moduleContributions.C1C4.energy)}</td>
                            <td>{formatValue(moduleContributions.C1C4.energy)}</td>
                            <td className="total-value">{formatValue(impacts.energy.total)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const CarbonComparisons = ({ gwp }: { gwp: number }) => {
    return (
        <div className="dashboard-card">
            <div className="card-header">
                <h3>Carbon Impact Comparisons</h3>
            </div>
            <div className="comparisons-grid">
                <div className="comparison-item">
                    <span className="material-icons-round comparison-icon">flight</span>
                    <div className="comparison-value">
                        {Math.round(gwp / CARBON_COMPARISONS.FLIGHT_LONDON_NY)}
                    </div>
                    <div className="comparison-label">
                        London-NY return flights
                    </div>
                </div>
                <div className="comparison-item">
                    <span className="material-icons-round comparison-icon">restaurant</span>
                    <div className="comparison-value">
                        {Math.round(gwp / CARBON_COMPARISONS.MEAT_CONSUMPTION)}
                    </div>
                    <div className="comparison-label">
                        years of meat consumption (2 people)
                    </div>
                </div>
                <div className="comparison-item">
                    <span className="material-icons-round comparison-icon">directions_car</span>
                    <div className="comparison-value">
                        {Math.round(gwp / CARBON_COMPARISONS.FAMILY_CAR)}
                    </div>
                    <div className="comparison-label">
                        years of family car use
                    </div>
                </div>
            </div>
        </div>
    );
};

// Extraer el componente de carga
const LoadingState = () => (
    <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading material database...</p>
    </div>
);

// Extraer el componente de error
const ErrorState = ({ error, onRetry }: { error: string, onRetry: () => void }) => (
    <div className="error-container">
        <span className="material-icons-round error-icon">error</span>
        <p>Error loading material database: {error}</p>
        <button className="action-button" onClick={onRetry}>Retry</button>
    </div>
);

// Extraer el componente de estado vacío
const EmptyState = () => (
    <div className="empty-state">
        <span className="material-icons-round empty-state-icon">
            assessment
        </span>
        <h3 className="empty-state-title">
            LCA Evaluation Ready
        </h3>
        <p className="empty-state-description">
            No LCA data available yet. To start your Life Cycle Assessment:
        </p>
        <div className="empty-state-instructions">
            <ol className="empty-state-list">
                <li>Load an IFC file in the BIM Viewer</li>
                <li>Click the "Start LCA Evaluation" button in the viewer</li>
                <li>Review and analyze your environmental impact data</li>
                <li>Export detailed LCA reports and BOQ documents</li>
            </ol>
        </div>
        <p className="empty-state-tip">
            💡 Tip: Use the BIM Viewer to load your IFC models and start the LCA analysis
        </p>
    </div>
);

const DataQualityChart: React.FC<{ dataQuality: any }> = ({ dataQuality }) => {
    const chartData = {
        labels: Object.keys(dataQuality).filter(key => key !== 'source'),
        datasets: [{
            label: 'Data Quality',
            data: Object.entries(dataQuality)
                .filter(([key]) => key !== 'source')
                .map(([_, value]) => value === 'High' ? 3 : value === 'Medium' ? 2 : 1),
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
        }]
    };

    const options: ChartOptions<'bar'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top' as const,
            },
            title: {
                display: true,
                text: 'Data Quality Assessment'
            }
        },
        scales: {
            y: {
                type: 'linear',
                beginAtZero: true,
                max: 3,
                ticks: {
                    stepSize: 1,
                    callback: function(tickValue: number | string) {
                        const value = Number(tickValue);
                        switch(value) {
                            case 3: return 'High';
                            case 2: return 'Medium';
                            case 1: return 'Low';
                            default: return '';
                        }
                    }
                }
            }
        }
    };

    return (
        <div style={{ height: '400px', width: '100%' }}>
            <Bar data={chartData} options={options} />
        </div>
    );
};

// Tipos para los gráficos
interface ChartProps {
    impacts?: any;
    materials?: MaterialImpact[];
    moduleContributions?: any;
}

const ImpactChart = React.memo(({ impacts }: { impacts: any }) => {
    if (!impacts) return null;

    const chartData = {
        labels: Object.entries(IMPACT_CATEGORIES).map(([_, category]) => category.name),
        datasets: [{
            label: 'Environmental Impacts',
            data: Object.entries(impacts).map(([key, value]: [string, any]) => {
                if (key !== 'energy') {
                    return value.perM2;
                }
                return null;
            }),
            backgroundColor: Object.entries(IMPACT_CATEGORIES)
                .filter(([key]) => key !== 'energy')
                .map(([_, cat]) => cat.color),
            yAxisID: 'y'
        },
        {
            label: 'Primary Energy',
            data: Object.entries(impacts).map(([key, value]: [string, any]) => {
                if (key === 'energy') {
                    return value.perM2;
                }
                return null;
            }),
            backgroundColor: IMPACT_CATEGORIES.energy.color,
            yAxisID: 'y1'
        }]
    };

    const options: ChartOptions<'bar'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                enabled: true,
                callbacks: {
                    title: function(context: any) {
                        return context[0].label;
                    },
                    label: function(context: any): string {
                        const value = context.raw;
                        if (value === null) return '';
                        const label = context.dataset?.label || '';
                        const isEnergy = context.label === 'Primary Energy';
                        if (isEnergy) {
                            return `${value.toFixed(2)} MJ/m²`;
                        }
                        const impactCategory = Object.entries(IMPACT_CATEGORIES).find(([_, cat]) => cat.name === context.label);
                        return impactCategory ? `${value.toFixed(2)} ${impactCategory[1].unit}/m²` : '';
                    }
                }
            },
            datalabels: {
                display: false
            }
        },
        scales: {
            y: {
                type: 'linear',
                position: 'left',
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Environmental Impacts per m²'
                }
            },
            y1: {
                type: 'linear',
                position: 'right',
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Primary Energy (MJ/m²)'
                },
                grid: {
                    drawOnChartArea: false
                }
            }
        }
    };

    return (
        <Bar data={chartData} options={options} />
    );
});

const MaterialsChart = React.memo(({ materials }: { materials: MaterialImpact[] }) => {
    if (!materials) return null;

    // Agrupar materiales por categoría
    const categoryImpacts = materials.reduce((acc: any, material) => {
        if (!acc[material.category]) {
            acc[material.category] = {
                gwp: 0, ap: 0, ep: 0, ozone: 0, energy: 0
            };
        }
        Object.keys(material.impacts).forEach(key => {
            acc[material.category][key] += material.impacts[key];
        });
        return acc;
    }, {});

    const chartData = {
        labels: Object.keys(categoryImpacts),
        datasets: Object.entries(IMPACT_CATEGORIES).map(([key, category]) => ({
            label: category.name,
            data: Object.values(categoryImpacts).map((impacts: any) => {
                // Ajustar escala para energía
                if (key === 'energy') {
                    return impacts[key] / 100;
                }
                return impacts[key];
            }),
            backgroundColor: category.color,
            yAxisID: key === 'energy' ? 'y1' : 'y'
        }))
    };

    const options: ChartOptions<'bar'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            tooltip: {
                enabled: true,
                callbacks: {
                    title: function(context: any) {
                        return context.label;
                    },
                    label: function(context: any): string {
                        const dataset = context.dataset;
                        const value = context.raw;
                        const label = dataset?.label || '';
                        const isEnergy = label === 'Primary Energy';
                        if (isEnergy) {
                            return `${(Number(value) * 100).toFixed(2)} MJ`;
                        }
                        const impactCategory = Object.entries(IMPACT_CATEGORIES).find(([_, cat]) => cat.name === label);
                        return impactCategory ? `${value.toFixed(2)} ${impactCategory[1].unit}` : '';
                    }
                }
            },
            datalabels: {
                display: false
            }
        },
        scales: {
            y: {
                type: 'linear',
                position: 'left',
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Environmental Impacts'
                }
            },
            y1: {
                type: 'linear',
                position: 'right',
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Energy (MJ × 100)'
                },
                grid: {
                    drawOnChartArea: false
                }
            }
        }
    };

    return <Bar data={chartData} options={options} />;
});

const LifeCycleModulesChart = React.memo(({ moduleContributions }: { moduleContributions: any }) => {
    if (!moduleContributions) return null;

    const chartData = {
        labels: Object.keys(moduleContributions),
        datasets: Object.entries(IMPACT_CATEGORIES).map(([key, category]) => ({
            label: category.name,
            data: Object.values(moduleContributions).map((module: any) => {
                // Ajustar escala para energía
                if (key === 'energy') {
                    return module[key] / 100;
                }
                return module[key];
            }),
            backgroundColor: category.color,
            yAxisID: key === 'energy' ? 'y1' : 'y'
        }))
    };

    const options: ChartOptions<'bar'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            tooltip: {
                enabled: true,
                callbacks: {
                    title: function(context: any) {
                        return context.label;
                    },
                    label: function(context: any): string {
                        const dataset = context.dataset;
                        const value = context.raw;
                        const label = dataset?.label || '';
                        const isEnergy = label === 'Primary Energy';
                        if (isEnergy) {
                            return `${(Number(value) * 100).toFixed(2)} MJ`;
                        }
                        const impactCategory = Object.entries(IMPACT_CATEGORIES).find(([_, cat]) => cat.name === label);
                        return impactCategory ? `${value.toFixed(2)} ${impactCategory[1].unit}` : '';
                    }
                }
            },
            datalabels: {
                display: false
            }
        },
        scales: {
            y: {
                type: 'linear',
                position: 'left',
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Environmental Impacts'
                }
            },
            y1: {
                type: 'linear',
                position: 'right',
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Energy (MJ × 100)'
                },
                grid: {
                    drawOnChartArea: false
                }
            }
        }
    };

    return <Bar data={chartData} options={options} />;
});

// Estilos CSS en línea
const styles = {
    mainPageContent: {
        display: 'grid',
        gridTemplateColumns: '300px 1fr',
        gap: '20px',
        padding: '20px',
        height: 'calc(100vh - 60px)',
        overflow: 'auto'
    },
    projectSidebar: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '20px'
    },
    contentArea: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '20px',
        overflow: 'auto'
    },
    chartsSection: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
        gap: '20px',
        padding: '20px'
    },
    dashboardCard: {
        background: '#fff',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        overflow: 'hidden'
    },
    cardHeader: {
        padding: '16px 20px',
        borderBottom: '1px solid #eee'
    },
    chartWrapper: {
        padding: '20px',
        height: '400px'
    }
};

// Constantes de validación
const IMPACT_VALIDATION: Record<string, Record<string, ValidationMetrics>> = {
    residential: {
        gwp: {
            meanPerM2: 0.04,    // t CO₂ eq/m² (basado en ArchiCAD: 0.04)
            maxPerM2: 0.08,     // Permitir hasta el doble del valor medio
            minPerM2: 0.02      // Permitir hasta la mitad del valor medio
        },
        ap: {
            meanPerM2: 0.16,    // kg SO₂ eq/m² (basado en ArchiCAD: 0.16)
            maxPerM2: 0.32,     // Permitir hasta el doble del valor medio
            minPerM2: 0.08      // Permitir hasta la mitad del valor medio
        },
        ep: {
            meanPerM2: 0.02,    // kg PO₄ eq/m² (basado en ArchiCAD: 0.02)
            maxPerM2: 0.04,     // Permitir hasta el doble del valor medio
            minPerM2: 0.01      // Permitir hasta la mitad del valor medio
        },
        ozone: {
            meanPerM2: 0.000001, // kg CFC-11 eq/m²
            maxPerM2: 0.000002,  // Mantener estos valores ya que son muy bajos
            minPerM2: 0.0000001
        },
        energy: {
            meanPerM2: 412,     // MJ/m² (basado en ArchiCAD: 412.04)
            maxPerM2: 824,      // Permitir hasta el doble del valor medio
            minPerM2: 206       // Permitir hasta la mitad del valor medio
        }
    },
    commercial: {
        gwp: {
            meanPerM2: 0.05,    // 25% más que residencial
            maxPerM2: 0.10,
            minPerM2: 0.025
        },
        ap: {
            meanPerM2: 0.20,
            maxPerM2: 0.40,
            minPerM2: 0.10
        },
        ep: {
            meanPerM2: 0.025,
            maxPerM2: 0.05,
            minPerM2: 0.0125
        },
        ozone: {
            meanPerM2: 0.0000012,
            maxPerM2: 0.0000024,
            minPerM2: 0.0000006
        },
        energy: {
            meanPerM2: 515,
            maxPerM2: 1030,
            minPerM2: 257.5
        }
    }
};

// Funciones de utilidad
const detectSourceSoftware = (lcaData: any): 'revit' | 'archicad' | 'unknown' => {
    if (!lcaData?.source) {
        console.warn('[LCA] No source information available in lcaData');
        return 'unknown';
    }
    
    const source = lcaData.source.toLowerCase();
    if (source.includes('revit')) return 'revit';
    if (source.includes('archicad') || source.includes('archi')) return 'archicad';
    
    console.warn('[LCA] Unable to detect source software:', lcaData.source);
    return 'unknown';
};

const validateImpactValue = (
    value: number,
    area: number,
    impactType: string,
    buildingType: string,
    source: string
): number => {
    if (!area || area <= 0) {
        console.warn('[LCA] Invalid area for impact validation:', area);
        return value;
    }

    const valuePerM2 = value / area;
    const metrics = IMPACT_VALIDATION[buildingType]?.[impactType];
    
    if (!metrics) {
        console.warn(`[LCA] No validation metrics for ${buildingType} - ${impactType}`);
        return value;
    }

    // Factor de corrección específico para Revit
    let adjustedValue = value;
    if (source === 'revit') {
        const revitFactor = 0.4; // Reducir los valores de Revit al 40%
        adjustedValue = value * revitFactor;
        console.log('[LCA] Applied Revit correction factor:', {
            impactType,
            factor: revitFactor,
            originalValue: value,
            adjustedValue
        });
    }

    const adjustedValuePerM2 = adjustedValue / area;

    console.log('[LCA] Impact validation:', {
        impactType,
        source,
        buildingType,
        originalValue: value,
        adjustedValue,
        perM2: adjustedValuePerM2,
        metrics,
        isWithinLimits: adjustedValuePerM2 <= metrics.maxPerM2 && adjustedValuePerM2 >= metrics.minPerM2
    });

    if (adjustedValuePerM2 > metrics.maxPerM2) {
        const finalValue = area * metrics.maxPerM2;
        console.warn('[LCA] Impact value exceeds maximum:', {
            impactType,
            buildingType,
            valuePerM2: adjustedValuePerM2,
            maxAllowed: metrics.maxPerM2,
            unit: IMPACT_INDICATORS[impactType].unit,
            adjustment: `Adjusted to ${metrics.maxPerM2} ${IMPACT_INDICATORS[impactType].unit}/m²`
        });
        return finalValue;
    }

    if (adjustedValuePerM2 < metrics.minPerM2) {
        console.warn('[LCA] Impact value below minimum:', {
            impactType,
            buildingType,
            valuePerM2: adjustedValuePerM2,
            minAllowed: metrics.minPerM2,
            unit: IMPACT_INDICATORS[impactType].unit
        });
    }

    return adjustedValue;
};

// Función para obtener opciones de Chart.js optimizadas para PDF
const getPDFChartOptions = (originalOptions: ChartOptions<'bar'>): ChartOptions<'bar'> => ({
    ...originalOptions,
    plugins: {
        ...originalOptions.plugins,
        legend: {
            ...originalOptions.plugins?.legend,
            labels: {
                ...originalOptions.plugins?.legend?.labels,
                color: '#000000' // Texto negro para PDF
            }
        }
    },
    scales: {
        ...originalOptions.scales,
        x: {
            ...originalOptions.scales?.x,
            grid: {
                ...originalOptions.scales?.x?.grid,
                color: '#cccccc' // Líneas de cuadrícula grises claras
            },
            ticks: {
                ...originalOptions.scales?.x?.ticks,
                color: '#000000' // Etiquetas del eje X en negro
            }
        },
        y: {
            ...originalOptions.scales?.y,
            grid: {
                ...originalOptions.scales?.y?.grid,
                color: '#cccccc' // Líneas de cuadrícula grises claras
            },
            ticks: {
                ...originalOptions.scales?.y?.ticks,
                color: '#000000' // Etiquetas del eje Y en negro
            }
        },
        y1: {
            ...originalOptions.scales?.y1,
            grid: {
                ...originalOptions.scales?.y1?.grid,
                color: '#cccccc' // Líneas de cuadrícula grises claras
            },
            ticks: {
                ...originalOptions.scales?.y1?.ticks,
                color: '#000000' // Etiquetas del eje Y1 en negro
            }
        }
    }
});

// Función para aplicar estilos PDF a los contenedores de gráficos
const applyPDFStylesToCharts = () => {
    const chartWrappers = document.querySelectorAll('.chart-wrapper');
    chartWrappers.forEach(wrapper => {
        const htmlWrapper = wrapper as HTMLElement;
        htmlWrapper.style.backgroundColor = '#ffffff';
        htmlWrapper.style.color = '#000000';
        htmlWrapper.style.border = '1px solid #000000';
    });
};

// Función para restaurar estilos originales de los gráficos
const restoreOriginalChartStyles = () => {
    const chartWrappers = document.querySelectorAll('.chart-wrapper');
    chartWrappers.forEach(wrapper => {
        const htmlWrapper = wrapper as HTMLElement;
        htmlWrapper.removeAttribute('style');
    });
};

// Componente principal MaterialsPage
export function MaterialsPage(props: Props) {
    // 1. Hooks
    const lcaData = useLCAStore(state => state.lcaData);
    const projectInfo = useLCAStore(state => state.projectInfo);
    const { isAuthenticated } = useAuthStore();
    const [sheetData, setSheetData] = React.useState<SheetData[]>([]);
    const [projectData, setProjectData] = React.useState<ProjectData | null>(null);
    const [results, setResults] = React.useState<any>(null);
    const [chartInstance, setChartInstance] = React.useState<ChartJS | null>(null);
    const chartRef = React.useRef<HTMLCanvasElement>(null);
    const [materials, setMaterials] = React.useState<MaterialImpact[]>([]);
    const [impacts, setImpacts] = React.useState<any>(null);
    const [pdfProgress, setPdfProgress] = React.useState<PdfProgress>({
        isGenerating: false,
        currentStep: '',
        progress: 0
    });
    const [isLoading, setIsLoading] = React.useState(false);
    const [databaseError, setDatabaseError] = React.useState<string | null>(null);
    const [showAIAdvisor, setShowAIAdvisor] = React.useState(false);

    // 2. Funciones de utilidad
    const recalculateImpacts = React.useCallback(async (data: ProjectData, modifiedMaterials?: MaterialImpact[]) => {
        if (!lcaData) return;
        
        // Usar los materiales modificados si están disponibles, sino usar los materiales actuales
        const materialsToUse = modifiedMaterials || materials;
        
        console.log('[LCA] recalculateImpacts called with:', {
            hasModifiedMaterials: !!modifiedMaterials,
            materialsCount: materialsToUse.length,
            sampleMaterial: materialsToUse[0]
        });
        
        const climateAdjustment = FINNISH_FACTORS.climate[data.location.toLowerCase()] || FINNISH_FACTORS.climate.default;
        const typeAdjustment = FINNISH_FACTORS.buildingType[data.type];
        
        // Recalcular impactos con los factores de ajuste
        const updatedMaterials = materialsToUse.map(material => {
            // Primero revertimos cualquier ajuste previo
            const baseImpacts = {
                gwp: material.impacts.gwp / (climateAdjustment * typeAdjustment),
                ap: material.impacts.ap / (climateAdjustment * typeAdjustment),
                ep: material.impacts.ep / (climateAdjustment * typeAdjustment),
                ozone: material.impacts.ozone / (climateAdjustment * typeAdjustment),
                energy: material.impacts.energy // La energía no se ajusta por clima
            };
            
            // Luego aplicamos los factores de ajuste una sola vez, excepto para energía
            return {
                ...material,
                impacts: {
                    gwp: baseImpacts.gwp * climateAdjustment * typeAdjustment,
                    ap: baseImpacts.ap * climateAdjustment * typeAdjustment,
                    ep: baseImpacts.ep * climateAdjustment * typeAdjustment,
                    ozone: baseImpacts.ozone * climateAdjustment * typeAdjustment,
                    energy: baseImpacts.energy // La energía mantiene su valor base
                }
            };
        });

        setMaterials(updatedMaterials);
        const newResults = calculateResults(updatedMaterials, data.area);
        setResults(newResults);

        console.log('[LCA] Impacts recalculated:', {
            materialsCount: updatedMaterials.length,
            newResults,
            climateAdjustment,
            typeAdjustment,
            usedModifiedMaterials: !!modifiedMaterials
        });
    }, [lcaData, materials]);

    const exportToPDF = React.useCallback(async () => {
        if (!isAuthenticated) {
            alert('Authentication required to export PDF reports. Please sign in to access this feature.');
            return;
        }
        
        if (!projectData || !results) return;

        // Añadir clase para modo PDF
        document.body.classList.add('pdf-mode');
        
        // Aplicar estilos PDF a todos los elementos relevantes
        const dashboardCards = document.querySelectorAll('.dashboard-card');
        dashboardCards.forEach(card => {
            const htmlCard = card as HTMLElement;
            htmlCard.style.backgroundColor = '#ffffff';
            htmlCard.style.color = '#000000';
            htmlCard.style.border = '1px solid #000000';
        });

        setPdfProgress({
            isGenerating: true,
            currentStep: 'Starting PDF generation',
            progress: 0
        });

        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        // Add helper functions
        const addFooter = (pageNumber: number) => {
            const totalPages = doc.getNumberOfPages();
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            const footerText = `LCA Report - ${projectData.name} - Page ${pageNumber} of ${totalPages}`;
            const textWidth = doc.getStringUnitWidth(footerText) * 8 / doc.internal.scaleFactor;
            const textX = (doc.internal.pageSize.getWidth() - textWidth) / 2;
            doc.text(footerText, textX, doc.internal.pageSize.getHeight() - 10);
        };

        const addSection = (title: string, y: number) => {
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(54, 162, 235);
            doc.text(title, 20, y);
            doc.setTextColor(0, 0, 0);
            doc.setFont('helvetica', 'normal');
            return y + 12;
        };

        const addText = (text: string, y: number, indent: number = 0) => {
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            const maxWidth = 170;
            const lines = doc.splitTextToSize(text, maxWidth - indent);
            doc.text(lines, 20 + indent, y);
            return y + (lines.length * 6);
        };

        const captureElement = async (element: HTMLElement) => {
            return await html2canvas(element, {
                scale: 2,
                backgroundColor: '#ffffff',
                logging: false,
                useCORS: true
            });
        };

        const addImage = (canvas: HTMLCanvasElement, y: number, padding: number = 10) => {
            const imgData = canvas.toDataURL('image/png');
            const imgWidth = doc.internal.pageSize.getWidth() - 40;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            if (y + imgHeight > doc.internal.pageSize.getHeight() - 20) {
                doc.addPage();
                y = 20;
            }

            doc.addImage(imgData, 'PNG', 20, y, imgWidth, imgHeight);
            return y + imgHeight + padding;
        };

        try {
            // First page
            setPdfProgress({
                isGenerating: true,
                currentStep: 'Generating project information',
                progress: 20
            });

            let currentY = 20;
            currentY = addSection('LCA Report', currentY);
            currentY = addSection('Project Information', currentY + 15);
            currentY = addText(`Project Name: ${projectData.name}`, currentY, 5);
            currentY = addText(`Location: ${projectData.location}`, currentY, 5);
            currentY = addText(`Building Type: ${projectData.type}`, currentY, 5);
            currentY = addText(`Area: ${projectData.area} m²`, currentY, 5);
            currentY = addText(`Date: ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`, currentY, 5);
            currentY += 15;

            // Restore compliance note
            currentY = addText(
                'This Life Cycle Assessment complies with:' +
                '\n• ISO 14044:2006 - Environmental management - Life cycle assessment' +
                '\n• EN 15804:2012+A2:2019 - Sustainability of construction works' +
                '\n• ISO 21930:2017 - Sustainability in buildings and civil engineering works',
                currentY, 5
            );
            currentY += 30;

            const impactSummary = document.querySelector('.impact-values-grid') as HTMLElement;
            if (impactSummary) {
                currentY = addSection('Impact Summary', currentY - 20);
                const canvas = await captureElement(impactSummary);
                currentY = addImage(canvas, currentY + 5);
            }

            // Move EN15804 table to the first page
            const en15804Table = document.querySelector('.en15804-assessment') as HTMLElement;
            if (en15804Table) {
                // Save original styles
                const originalStyles = {
                    backgroundColor: en15804Table.style.backgroundColor,
                    color: en15804Table.style.color
                };

                // Apply temporary styles for PDF
                en15804Table.style.backgroundColor = '#ffffff';
                en15804Table.style.color = '#000000';

                // Apply styles to cells and headers
                const headers = en15804Table.querySelectorAll('th');
                const cells = en15804Table.querySelectorAll('td');

                headers.forEach(header => {
                    Object.assign(header.style, pdfHeaderStyle);
                });

                cells.forEach(cell => {
                    Object.assign(cell.style, pdfCellStyle);
                });

                const canvas = await captureElement(en15804Table);

                // Restore original styles
                en15804Table.style.backgroundColor = originalStyles.backgroundColor;
                en15804Table.style.color = originalStyles.color;

                headers.forEach(header => {
                    header.removeAttribute('style');
                });

                cells.forEach(cell => {
                    cell.removeAttribute('style');
                });

                currentY = addImage(canvas, currentY);
            }

            // Second page - IFC Elements Impact Summary
            doc.addPage();
            currentY = 20;
            currentY = addSection('IFC Elements Impact Summary', currentY);
            
            const ifcSummary = document.querySelector('.impact-summaries-grid') as HTMLElement;
            if (ifcSummary) {
                const canvas = await captureElement(ifcSummary);
                currentY = addImage(canvas, currentY + 5);
            }

            // Third page - Analysis Charts
            doc.addPage();
            currentY = 20;
            
            // Aplicar estilos PDF a los gráficos antes de la captura
            applyPDFStylesToCharts();
            
            const chartWrappers = document.querySelectorAll('.chart-wrapper') as NodeListOf<HTMLElement>;
            for (let i = 0; i < chartWrappers.length; i++) {
                if (i === 0) {
                    currentY = addSection('Impact Analysis Charts', currentY);
                }
                const canvas = await captureElement(chartWrappers[i]);
                currentY = addImage(canvas, currentY, 30);
            }
            
            // Restaurar estilos originales después de la captura
            restoreOriginalChartStyles();

            // Fourth page - SCORS and Comparisons
            doc.addPage();
            currentY = 20;
            const scorsRating = document.querySelector('.scors-rating') as HTMLElement;
            if (scorsRating) {
                currentY = addSection('SCORS Rating Analysis', currentY);
                const canvas = await captureElement(scorsRating);
                currentY = addImage(canvas, currentY);
            }

            // Ensure enough space for comparisons
            currentY += 20; // Space between sections

            const carbonComparisons = document.querySelector('.comparisons-grid') as HTMLElement;
            if (carbonComparisons) {
                currentY = addSection('Carbon Comparisons', currentY - 10);
                const canvas = await captureElement(carbonComparisons);
                currentY = addImage(canvas, currentY + 5);
            }

            // AI Recommendations - Add to current page if there's space
            
            // Try to get AI recommendations if available
            const aiRecommendations = document.querySelector('.carbon-recommendations') as HTMLElement;
            console.log('[PDF] Looking for AI recommendations element:', aiRecommendations);
            
            if (aiRecommendations) {
                console.log('[PDF] AI recommendations element found, capturing...');
                
                // Apply PDF styles to the AI recommendations section
                aiRecommendations.classList.add('pdf-mode');
                
                // Aplicar estilos adicionales para PDF
                const originalAIStyles = {
                    backgroundColor: aiRecommendations.style.backgroundColor,
                    color: aiRecommendations.style.color
                };
                
                aiRecommendations.style.backgroundColor = '#ffffff';
                aiRecommendations.style.color = '#000000';
                
                // Capture the entire recommendations section (including the header)
                const canvas = await captureElement(aiRecommendations);
                currentY = addImage(canvas, currentY);
                
                // Restore original styles
                aiRecommendations.style.backgroundColor = originalAIStyles.backgroundColor;
                aiRecommendations.style.color = originalAIStyles.color;
                
                // Remove PDF mode class after capture
                aiRecommendations.classList.remove('pdf-mode');
                console.log('[PDF] AI recommendations captured successfully');
            } else {
                console.log('[PDF] No AI recommendations element found, generating recommendations...');
                
                // Add header manually when generating recommendations
                currentY = addSection('AI-Powered Carbon Reduction Recommendations', currentY);
                
                // Generate AI recommendations directly for PDF
                try {
                    const aiRecommendationService = await import('../services/AIRecommendationService');
                    const recommendations = await aiRecommendationService.aiRecommendationService.generateRecommendations(materials, projectData.type);
                    
                    if (recommendations && recommendations.length > 0) {
                        // Add summary
                        currentY = addText(
                            'AI-Powered Carbon Reduction Analysis Generated for PDF Export',
                            currentY, 5
                        );
                        currentY += 10;
                        
                        // Add recommendations
                        recommendations.forEach((rec: any, index: number) => {
                            currentY = addText(
                                `${index + 1}. ${rec.material.en} (${rec.material.fi})`,
                                currentY, 10
                            );
                            currentY = addText(
                                `   Current Volume: ${rec.totalVolume.toFixed(2)} m³`,
                                currentY, 15
                            );
                            currentY = addText(
                                `   Current Carbon Impact: ${rec.currentImpact.toFixed(2)} tCO₂e`,
                                currentY, 15
                            );
                            
                            rec.recommendations.forEach((suggestion: any, sIndex: number) => {
                                currentY = addText(
                                    `   Recommendation ${sIndex + 1}: ${suggestion.suggestion.en}`,
                                    currentY, 20
                                );
                                currentY = addText(
                                    `   Carbon Reduction: ${suggestion.carbonReduction.direct}`,
                                    currentY, 25
                                );
                                currentY += 5;
                            });
                            
                            currentY += 5;
                        });
                        
                        currentY = addText(
                            'Note: These recommendations are based on Finnish construction standards and CO2data.fi database.',
                            currentY, 5
                        );
                    } else {
                        // Fallback to note
                        currentY = addText(
                            'AI recommendations are available when the AI Advisor is active. ' +
                            'To view recommendations, click "Get AI Recommendations" in the main interface.',
                            currentY, 5
                        );
                        currentY = addText(
                            'The AI Advisor provides intelligent suggestions to reduce your building\'s carbon footprint ' +
                            'based on Finnish construction standards and CO2data.fi database.',
                            currentY, 5
                        );
                    }
                } catch (error) {
                    console.error('[PDF] Error generating AI recommendations:', error);
                    // Fallback to note
                    currentY = addText(
                        'AI recommendations are available when the AI Advisor is active. ' +
                        'To view recommendations, click "Get AI Recommendations" in the main interface.',
                        currentY, 5
                    );
                    currentY = addText(
                        'The AI Advisor provides intelligent suggestions to reduce your building\'s carbon footprint ' +
                        'based on Finnish construction standards and CO2data.fi database.',
                        currentY, 5
                    );
                }
            }

            // Footer
            setPdfProgress({
                isGenerating: true,
                currentStep: 'Finalizing document',
                progress: 80
            });

            const totalPages = doc.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                addFooter(i);
            }

            // Save PDF
            setPdfProgress({
                isGenerating: true,
                currentStep: 'Saving document',
                progress: 90
            });

            const fileName = `LCA_Report_${projectData.name}_${new Date().toISOString().split('T')[0]}.pdf`;
            doc.save(fileName);

        } catch (error) {
            console.error('Error generating PDF:', error);
        } finally {
            setPdfProgress({
                isGenerating: false,
                currentStep: '',
                progress: 0
            });
            // Restaurar estilos originales de las tarjetas del dashboard
            const dashboardCards = document.querySelectorAll('.dashboard-card');
            dashboardCards.forEach(card => {
                const htmlCard = card as HTMLElement;
                htmlCard.removeAttribute('style');
            });
            
            // Remover clase de modo PDF al finalizar
            document.body.classList.remove('pdf-mode');
        }
    }, [projectData, results]);

    const handleMaterialUpdate = React.useCallback((updatedMaterials: MaterialImpact[]) => {
        console.log('[LCA] handleMaterialUpdate called with:', {
            materialsCount: updatedMaterials.length,
            sampleMaterial: updatedMaterials[0],
            hasChanges: JSON.stringify(updatedMaterials) !== JSON.stringify(materials)
        });
        
        if (!projectData) return;
        
        // Actualizar el estado de materiales con los valores modificados
        setMaterials(updatedMaterials);
        
        // Recalcular impactos usando los materiales modificados
        recalculateImpacts(projectData, updatedMaterials);
        
        console.log('[LCA] Materials updated and impacts recalculated with modified values');
    }, [projectData, recalculateImpacts, materials]);

    // 3. Componentes internos
    const MaterialsChart = React.memo(({ materials }: { materials: MaterialImpact[] }) => {
        if (!materials) return null;

        // Agrupar materiales por categoría
        const categoryImpacts = materials.reduce((acc: any, material) => {
            if (!acc[material.category]) {
                acc[material.category] = {
                    gwp: 0, ap: 0, ep: 0, ozone: 0, energy: 0
                };
            }
            Object.keys(material.impacts).forEach(key => {
                acc[material.category][key] += material.impacts[key];
            });
            return acc;
        }, {});

        const chartData = {
            labels: Object.keys(categoryImpacts),
            datasets: Object.entries(IMPACT_CATEGORIES).map(([key, category]) => ({
                label: category.name,
                data: Object.values(categoryImpacts).map((impacts: any) => {
                    // Ajustar escala para energía
                    if (key === 'energy') {
                        return impacts[key] / 100;
                    }
                    return impacts[key];
                }),
                backgroundColor: category.color,
                yAxisID: key === 'energy' ? 'y1' : 'y'
            }))
        };

        const options: ChartOptions<'bar'> = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    enabled: true,
                    callbacks: {
                        title: function(context: any) {
                            return context.label;
                        },
                        label: function(context: any): string {
                            const dataset = context.dataset;
                            const value = context.raw;
                            const label = dataset?.label || '';
                            const isEnergy = label === 'Primary Energy';
                            if (isEnergy) {
                                return `${(Number(value) * 100).toFixed(2)} MJ`;
                            }
                            const impactCategory = Object.entries(IMPACT_CATEGORIES).find(([_, cat]) => cat.name === label);
                            return impactCategory ? `${value.toFixed(2)} ${impactCategory[1].unit}` : '';
                        }
                    }
                },
                datalabels: {
                    display: false
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Environmental Impacts'
                    }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Energy (MJ × 100)'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        };

        return <Bar data={chartData} options={options} />;
    });

    const LifeCycleModulesChart = React.memo(({ moduleContributions }: { moduleContributions: any }) => {
        if (!moduleContributions) return null;

        const chartData = {
            labels: Object.keys(moduleContributions),
            datasets: Object.entries(IMPACT_CATEGORIES).map(([key, category]) => ({
                label: category.name,
                data: Object.values(moduleContributions).map((module: any) => {
                    // Ajustar escala para energía
                    if (key === 'energy') {
                        return module[key] / 100;
                    }
                    return module[key];
                }),
                backgroundColor: category.color,
                yAxisID: key === 'energy' ? 'y1' : 'y'
            }))
        };

        const options: ChartOptions<'bar'> = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    enabled: true,
                    callbacks: {
                        title: function(context: any) {
                            return context.label;
                        },
                        label: function(context: any): string {
                            const dataset = context.dataset;
                            const value = context.raw;
                            const label = dataset?.label || '';
                            const isEnergy = label === 'Primary Energy';
                            if (isEnergy) {
                                return `${(Number(value) * 100).toFixed(2)} MJ`;
                            }
                            const impactCategory = Object.entries(IMPACT_CATEGORIES).find(([_, cat]) => cat.name === label);
                            return impactCategory ? `${value.toFixed(2)} ${impactCategory[1].unit}` : '';
                        }
                    }
                },
                datalabels: {
                    display: false
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Environmental Impacts'
                    }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Energy (MJ × 100)'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        };

        return <Bar data={chartData} options={options} />;
    });

    // 4. Efectos
    React.useEffect(() => {
        const loadMaterialDatabase = async () => {
            setIsLoading(true);
            setDatabaseError(null);
            try {
                const result = await materialDatabaseService.updateDatabase();
                if (!result.success) {
                    setDatabaseError(result.error || 'Failed to load material database');
                }
                // console.log('Material database loaded:', result);
            } catch (error) {
                setDatabaseError(error instanceof Error ? error.message : 'Unknown error');
                console.error('Error loading material database:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadMaterialDatabase();
    }, []);

    React.useEffect(() => {
        // console.log('LCA Data changed:', lcaData);
        // console.log('Project Info changed:', projectInfo);
        
        if (lcaData && projectInfo) {
            console.log('Processing initial data...');
            
            // Procesar los datos del LCA
            const newMaterials: MaterialImpact[] = lcaData.data
                .filter((item: any) => !item.isHeader)
                .map((item: any) => {
                    const volume = parseFloat(item.value.split(' ')[0]) || 0;
                    const materialName = item.property.trim();
                    const material = materialDatabaseService.getMaterial(materialName);

                    const materialImpact: MaterialImpact = {
                        name: materialName,
                        volume,
                        matched: !!material,
                        category: item.category || 'Unknown',
                        impacts: material ? {
                            gwp: volume * material.impacts.gwp,
                            ap: volume * material.impacts.ap,
                            ep: volume * material.impacts.ep,
                            ozone: volume * material.impacts.ozone,
                            energy: volume * material.impacts.energy
                        } : {
                            gwp: 0,
                            ap: 0,
                            ep: 0,
                            ozone: 0,
                            energy: 0
                        },
                        transport: material ? {
                            distance: material.transport.default_distance,
                            mode: 'truck'
                        } : {
                            distance: 0,
                            mode: 'none'
                        }
                    };

                    return materialImpact;
                });

            console.log('Processed materials:', newMaterials);

            const initialProjectData: ProjectData = {
                name: projectInfo.name || 'Unnamed Project',
                area: projectInfo.area || 0,
                budget: projectInfo.cost || 0,
                type: projectInfo.type || 'residential',
                year: new Date().getFullYear(),
                location: projectInfo.location || 'Helsinki'
            };

            console.log('Initial project data:', initialProjectData);

            setMaterials(newMaterials);
            setProjectData(initialProjectData);
            
            // Calcular impactos iniciales
            const initialResults = calculateResults(newMaterials, initialProjectData.area);
            console.log('Initial results:', initialResults);
            setResults(initialResults);
        }
    }, [lcaData, projectInfo]);

    // Función auxiliar para calcular resultados iniciales
    const calculateResults = (materials: MaterialImpact[], area: number) => {
        const buildingType = projectData?.type || 'residential';
        const source = detectSourceSoftware(lcaData);

        console.log('[LCA] Calculating results:', {
            buildingType,
            source,
            materialsCount: materials.length,
            area
        });

        // Inicializar impactos
        const impacts = {
            gwp: { total: 0, perYear: 0, perM2: 0 },
            ap: { total: 0, perYear: 0, perM2: 0 },
            ep: { total: 0, perYear: 0, perM2: 0 },
            ozone: { total: 0, perYear: 0, perM2: 0 },
            energy: { total: 0, perYear: 0, perM2: 0 }
        };

        // Calcular totales iniciales
        materials.forEach(material => {
            Object.keys(impacts).forEach(key => {
                impacts[key].total += material.impacts[key];
            });
        });

        // Validar y ajustar totales
        Object.keys(impacts).forEach(key => {
            const originalValue = impacts[key].total;
            impacts[key].total = validateImpactValue(
                originalValue,
                area,
                key,
                buildingType,
                source
            );

            if (originalValue !== impacts[key].total) {
                console.log(`[LCA] Impact ${key} adjusted:`, {
                    original: originalValue,
                    adjusted: impacts[key].total,
                    difference: ((impacts[key].total - originalValue) / originalValue * 100).toFixed(2) + '%'
                });
            }

            // Calcular métricas por m² y por año después de la validación
            if (area > 0) {
                impacts[key].perM2 = impacts[key].total / area;
                impacts[key].perYear = impacts[key].total / FINNISH_BUILDING_STANDARDS.buildingLifespan;
            }
        });

        // Calcular contribuciones por módulo
        const moduleContributions = calculateModuleContributions(impacts);

        const result = {
            impacts,
            source,
            validationMetrics: IMPACT_VALIDATION[buildingType],
            moduleContributions,
            metadata: {
                buildingType,
                area,
                materialsCount: materials.length,
                validationApplied: true
            }
        };

        console.log('[LCA] Final results:', result);

        return result;
    };

    const calculateModuleContributions = (impacts: any) => {
        const moduleContributions: any = {};
        
        // Initialize contributions for each module
        Object.keys(LIFE_CYCLE_MODULES).forEach(module => {
            moduleContributions[module] = {
                gwp: 0,
                ap: 0,
                ep: 0,
                ozone: 0,
                energy: 0
            };
        });

        // Calculate contributions for each impact category
        Object.entries(impacts).forEach(([category, value]: [string, any]) => {
            if (category === 'energy') {
                // Para energía, usamos los factores específicos de energía
                Object.entries(LIFE_CYCLE_MODULES).forEach(([module, moduleData]: [string, any]) => {
                    moduleContributions[module][category] = value.total * moduleData.energyFactor;
                });
            } else {
                // Para otros impactos, usamos los factores generales
                Object.entries(LIFE_CYCLE_MODULES).forEach(([module, moduleData]: [string, any]) => {
                    moduleContributions[module][category] = value.total * moduleData.factor;
                });
            }
        });

        return moduleContributions;
    };

    // Función para recalcular cuando cambian los datos del proyecto
    const recalculateProjectChanges = React.useCallback((newProjectData: ProjectData) => {
        if (!materials || materials.length === 0) {
            console.log('[LCA] No materials available for project data recalculation');
            return;
        }
        
        console.log('[LCA] Project data changed:', {
            oldProjectData: projectData,
            newProjectData,
            materialsCount: materials.length
        });
        
        // Recalcular con los nuevos datos del proyecto
        const newResults = calculateResults(materials, newProjectData.area);
        setResults(newResults);
        
        console.log('[LCA] Results recalculated for project changes:', {
            newResults,
            area: newProjectData.area
        });
        
        // Aplicar factores de ajuste si es necesario
        recalculateImpacts(newProjectData);
        
        console.log('[LCA] Project data updated and impacts recalculated');
    }, [materials, projectData, recalculateImpacts]);

    // Renderizado del contenido principal
    const mainContent = projectData && results && (
        <div id="resultsContainer" className="main-page-content">
            <div className="project-sidebar">
                <div className="dashboard-card">
                    <div className="card-header">
                        <h3>Project Information</h3>
                    </div>
                    <div className="project-info">
                        <p>
                            <strong>Name:</strong>
                            <span style={{ color: 'var(--text-primary)' }}>{projectData.name}</span>
                        </p>
                        <p>
                            <strong>Area:</strong>
                            <input
                                type="number"
                                className="form-input"
                                value={projectData.area}
                                onChange={(e) => {
                                    if (projectData) {
                                        const newProjectData = {
                                            ...projectData,
                                            area: Number(e.target.value)
                                        };
                                        setProjectData(newProjectData);
                                        // Recalcular cuando cambia el área
                                        recalculateProjectChanges(newProjectData);
                                    }
                                }}
                                min="0"
                                step="0.01"
                            />
                            <span className="form-unit">m²</span>
                        </p>
                        <p>
                            <strong>Type:</strong>
                            <select
                                className="form-select"
                                value={projectData.type}
                                onChange={(e) => {
                                    if (projectData) {
                                        const newProjectData = {
                                            ...projectData,
                                            type: e.target.value
                                        };
                                        setProjectData(newProjectData);
                                        
                                        console.log('[LCA] Building type changed:', {
                                            oldType: projectData.type,
                                            newType: e.target.value,
                                            newProjectData
                                        });
                                        
                                        // Recalcular cuando cambia el tipo
                                        recalculateProjectChanges(newProjectData);
                                    }
                                }}
                            >
                                <option value="residential">Residential</option>
                                <option value="commercial">Commercial</option>
                                <option value="industrial">Industrial</option>
                                <option value="infrastructure">Infrastructure</option>
                            </select>
                        </p>
                        <p>
                            <strong>Location:</strong>
                            <select
                                className="form-select"
                                value={projectData.location}
                                onChange={(e) => {
                                    if (projectData) {
                                        const newProjectData = {
                                            ...projectData,
                                            location: e.target.value
                                        };
                                        setProjectData(newProjectData);
                                        // Recalcular cuando cambia la ubicación
                                        recalculateProjectChanges(newProjectData);
                                    }
                                }}
                            >
                                <option value="Helsinki">Helsinki</option>
                                <option value="Tampere">Tampere</option>
                                <option value="Oulu">Oulu</option>
                                <option value="Other">Other</option>
                            </select>
                        </p>
                    </div>
                </div>
            </div>

            <div className="content-area">
                <DatabaseStatusComponent />
                <MaterialsTable materials={materials} onMaterialUpdate={handleMaterialUpdate} />
                
                <div className="impact-analysis-section">
                    <div className="dashboard-card">
                        <div className="card-header">
                            <h3>Impact Summary</h3>
                        </div>
                        <div className="data-cards-grid">
                            {Object.entries(IMPACT_CATEGORIES).map(([key, category]) => (
                                <div key={key} className="data-card impact-summary-card">
                                    <div className="data-card-header">
                                        <h4 className="data-card-title">{category.name}</h4>
                                    </div>
                                    <div className="data-card-content">
                                        <div className="metrics-container">
                                            <div className="metric-item">
                                                <div className="metric-label">Total Impact</div>
                                                <div className="metric-value">
                                                    {results?.impacts?.[key]?.total?.toFixed(2) ?? '0.00'}
                                                    <span className="metric-unit">{category.unit}</span>
                                                </div>
                                            </div>
                                            <div className="metric-item">
                                                <div className="metric-label">Per Square Meter</div>
                                                <div className="metric-value">
                                                    {results?.impacts?.[key]?.perM2?.toFixed(2) ?? '0.00'}
                                                    <span className="metric-unit">{category.unit}/m²</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="impact-summaries-grid">
                    <div className="dashboard-card">
                        <div className="card-header">
                            <h3>IFC Elements Impact Summary</h3>
                        </div>
                        <div className="data-cards-grid">
                            {Array.from(new Set(materials.map(m => m.category))).map(category => (
                                <div key={category} className="data-card ifc-elements-card">
                                    <div className="data-card-header">
                                        <h4 className="data-card-title">{category}</h4>
                                    </div>
                                    <div className="data-card-content">
                                        <div className="metrics-container">
                                            {Object.entries(IMPACT_CATEGORIES).map(([key, impact], index) => {
                                                const value = materials
                                                    .filter(m => m.category === category)
                                                    .reduce((sum, m) => sum + m.impacts[key], 0);
                                                return (
                                                    <div key={key} className="metric-item">
                                                        <div className="metric-label">{impact.name}</div>
                                                        <div className="metric-value">
                                                            {value.toFixed(2)}
                                                            <span className="metric-unit">{impact.unit}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <EN15804Assessment 
                    impacts={results?.impacts || {}} 
                    moduleContributions={results?.moduleContributions || {}}
                />

                <div className="charts-section">
                    <div className="dashboard-card">
                        <div className="card-header">
                            <h3>Impact Analysis</h3>
                        </div>
                        <div className="charts-grid">
                            <div className="chart-wrapper">
                                <ImpactChart impacts={results?.impacts || {}} />
                            </div>
                            <div className="chart-wrapper">
                                <MaterialsChart materials={materials} />
                            </div>
                            <div className="chart-wrapper">
                                <LifeCycleModulesChart moduleContributions={results?.moduleContributions || {}} />
                            </div>
                            <div className="chart-wrapper">
                                <DataQualityChart dataQuality={DATA_QUALITY_LEVELS} />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="dashboard-card">
                    <div className="card-header">
                        <h3>SCORS Rating</h3>
                    </div>
                    <div className="scors-rating">
                        <div className="rating-bars">
                            {[
                                { grade: 'A+', value: '100', color: '#1a9850' },
                                { grade: 'A', value: '200', color: '#66bd63' },
                                { grade: 'B', value: '350', color: '#a6d96a' },
                                { grade: 'C', value: '500', color: '#fee08b' },
                                { grade: 'D', value: '700', color: '#fdae61' },
                                { grade: 'E', value: '1000', color: '#f46d43' },
                                { grade: 'F', value: 'Infinity', color: '#d73027' }
                            ].map((level, index) => {
                                // Convertir de t CO₂ eq/m² a kg CO₂ eq/m²
                                const gwpPerM2 = ((results?.impacts?.gwp?.perM2 || 0) * 1000);
                                const isCurrentLevel = gwpPerM2 <= (level.value === 'Infinity' ? Infinity : parseFloat(level.value)) &&
                                                    (index === 0 || gwpPerM2 > parseFloat(['100', '200', '350', '500', '700', '1000'][index - 1]));
                                
                                return (
                                    <div key={level.grade} className="rating-bar-row">
                                        <div 
                                            className="rating-bar"
                                            style={{
                                                backgroundColor: level.color,
                                                width: `${25 + (index * 5)}%`,
                                                color: '#000000'
                                            }}
                                        >
                                            {level.grade} {level.value} kgCO₂e/m²
                                        </div>
                                        {isCurrentLevel && (
                                            <div className="level-indicator">
                                                <div className="indicator-content" style={{ color: '#000000' }}>
                                                    {level.grade}
                                                    <div className="indicator-value">
                                                        {gwpPerM2.toFixed(2)} kgCO₂e/m²
                                                    </div>
                                                </div>
                                                <div className="indicator-label" style={{ color: '#000000' }}>
                                                    Category indicator
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <CarbonComparisons gwp={results?.impacts?.gwp?.total || 0} />
                
                {/* AI-Powered Carbon Reduction Advisor */}
                <div className="dashboard-card">
                    <div className="card-header">
                        <h3>AI-Powered Recommendations</h3>
                        <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: 'var(--text-secondary)' }}>
                            Get intelligent suggestions to reduce your building's carbon footprint
                        </p>
                    </div>
                    <div className="card-content">
                        {!showAIAdvisor ? (
                            <button 
                                className="export-button" 
                                onClick={() => setShowAIAdvisor(true)}
                                style={{ 
                                    backgroundColor: 'var(--primary)',
                                    color: '#ffffff',
                                    border: 'none',
                                    padding: '12px 24px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    transition: 'background-color 0.2s ease'
                                }}
                            >
                                <span className="material-icons" style={{ fontSize: '20px' }}>
                                    smart_toy
                                </span>
                                Get AI Recommendations
                            </button>
                        ) : (
                            <CarbonReductionAdvisor 
                                materials={materials}
                                buildingType={projectData?.type || 'residential'}
                                onClose={() => setShowAIAdvisor(false)}
                            />
                        )}
                    </div>
                </div>

                {/* LCAx Export Component */}
                <LCAxExportComponent
                    materials={materials}
                    projectInfo={projectInfo}
                    results={results}
                    onExport={(filename) => {
                        console.log(`LCAx exported: ${filename}`);
                    }}
                />
                
                <div className="dashboard-card">
                    <div className="card-header">
                        <h3>Export Report</h3>
                    </div>
                    <div className="card-content">
                        <button 
                            className="export-button" 
                            onClick={exportToPDF}
                            disabled={pdfProgress.isGenerating || !isAuthenticated}
                            title={!isAuthenticated ? 'Authentication required to export PDF reports' : ''}
                        >
                            <span className="material-icons">
                                {pdfProgress.isGenerating ? 'hourglass_empty' : 'picture_as_pdf'}
                            </span>
                            {pdfProgress.isGenerating ? 'Generating PDF...' : 'Export Report (PDF)'}
                        </button>
                        {!isAuthenticated && (
                            <p style={{ 
                                margin: '8px 0 0 0', 
                                fontSize: '12px', 
                                color: 'var(--text-secondary)',
                                fontStyle: 'italic'
                            }}>
                                Sign in to access PDF export functionality
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    // Renderizado condicional
    let content;
    if (isLoading) {
        content = <LoadingState />;
    } else if (databaseError) {
        content = <ErrorState error={databaseError} onRetry={() => window.location.reload()} />;
    } else if (!lcaData) {
        content = <EmptyState />;
    } else if (!projectData || !results) {
        content = null;
    } else {
        content = mainContent;
    }

    // Retorno principal
    return (
        <div className="page">
            <header>
                <h2><span className="material-icons-round">folder</span> LCA Evaluation</h2>
            </header>
            {content}
            {pdfProgress.isGenerating && (
                <div className="progress-overlay">
                    <div className="progress-container">
                        <div className="progress-bar">
                            <div 
                                className="progress-fill"
                                style={{ width: `${pdfProgress.progress}%` }}
                            ></div>
                        </div>
                        <div className="progress-step">{pdfProgress.currentStep}</div>
                        <div className="progress-percentage">{pdfProgress.progress}%</div>
                    </div>
                </div>
            )}
        </div>
    );
}

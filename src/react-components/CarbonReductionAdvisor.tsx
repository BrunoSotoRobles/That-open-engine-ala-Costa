import * as React from 'react';
import { MaterialImpact } from '../types/MaterialTypes';
import { aiRecommendationService } from '../services/AIRecommendationService';

interface Props {
    materials: MaterialImpact[];
    buildingType: string;
    onClose: () => void;
}

export const CarbonReductionAdvisor: React.FC<Props> = ({ materials, buildingType, onClose }) => {
    const [recommendations, setRecommendations] = React.useState<any[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        const loadRecommendations = async () => {
            try {
                setIsLoading(true);
                setError(null);
                const result = await aiRecommendationService.generateRecommendations(materials, buildingType);
                setRecommendations(result);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Error generating recommendations');
                console.error('Error in CarbonReductionAdvisor:', err);
            } finally {
                setIsLoading(false);
            }
        };

        loadRecommendations();
    }, [materials, buildingType]);

    if (isLoading) {
        return (
            <div className="dashboard-card" style={{ padding: '20px', textAlign: 'center' }}>
                <div className="loading-spinner"></div>
                <p>Analyzing materials and generating recommendations...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="dashboard-card" style={{ padding: '20px', textAlign: 'center', color: '#ff4444' }}>
                <p>Error: {error}</p>
                <button onClick={onClose}>Close</button>
            </div>
        );
    }

    const totalPotentialReduction = recommendations.reduce((sum, rec) => {
        // Get the maximum reduction percentage from all recommendations for this material
        const maxReductionPercent = Math.max(...rec.recommendations.map((r: { carbonReduction: { direct: string } }) => {
            const match = r.carbonReduction.direct.match(/(\d+(?:\.\d+)?)/);
            return match ? parseFloat(match[0]) : 0;
        }));
        
        // Calculate the potential reduction for this material
        const materialReduction = (rec.currentImpact * maxReductionPercent) / 100;
        return sum + (isFinite(materialReduction) ? materialReduction : 0);
    }, 0);

    // Calculate total current emissions
    const totalCurrentEmissions = materials.reduce((sum, m) => sum + (isFinite(m.impacts.gwp) ? m.impacts.gwp : 0), 0);

    // Calculate percentage reduction, handling division by zero
    const percentageReduction = totalCurrentEmissions > 0 
        ? (totalPotentialReduction / totalCurrentEmissions) * 100 
        : 0;

    return (
        <div className="dashboard-card carbon-recommendations" style={{ backgroundColor: '#1a1a1a', color: '#ffffff', marginBottom: '20px' }}>
            <div className="card-header" style={{ 
                borderBottom: '1px solid rgba(255,255,255,0.1)',
                padding: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
            }}>
                <span className="material-icons" style={{ fontSize: '24px', color: '#2196F3' }}>
                    smart_toy
                </span>
                <div>
                    <h3 style={{ margin: '0 0 4px 0', color: '#ffffff' }}>
                        AI-Powered Carbon Reduction Recommendations
                    </h3>
                    <p style={{ margin: '0', fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>
                        Based on Finnish construction standards and CO2data.fi
                    </p>
                </div>
                <button 
                    onClick={onClose}
                    style={{
                        marginLeft: 'auto',
                        background: 'none',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '4px',
                        padding: '8px',
                        color: '#ffffff',
                        cursor: 'pointer'
                    }}
                >
                    <span className="material-icons">close</span>
                </button>
            </div>

            <div style={{ padding: '24px' }}>
                <div className="impact-reduction-summary" style={{ 
                    marginBottom: '24px', 
                    padding: '20px', 
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    color: '#000000'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                        <span className="material-icons" style={{ color: '#4CAF50', fontSize: '24px' }}>
                            trending_down
                        </span>
                        <h4 style={{ margin: '0', color: '#4CAF50', fontSize: '18px' }}>
                            Potential Impact Reduction
                        </h4>
                    </div>
                    <p style={{ margin: '0', fontSize: '16px', lineHeight: '1.5' }}>
                        Implementing these recommendations could reduce carbon emissions by approximately{' '}
                        <strong style={{ color: '#4CAF50' }}>{totalPotentialReduction.toFixed(1)} tCO₂e</strong>{' '}
                        <span style={{ color: '#4CAF50' }}>({percentageReduction.toFixed(1)}%)</span>
                    </p>
                </div>

                <div style={{ display: 'grid', gap: '20px' }}>
                    {recommendations.map((recommendation, index) => (
                        <div key={index} className="recommendation-item" style={{ 
                            padding: '20px', 
                            backgroundColor: '#ffffff',
                            borderRadius: '12px',
                            color: '#000000'
                        }}>
                            <div style={{ marginBottom: '16px' }}>
                                <h4 style={{ margin: '0 0 8px 0', color: '#2196F3', fontSize: '18px' }}>
                                    {recommendation.material.en} ({recommendation.material.fi})
                                </h4>
                                <p style={{ margin: '0 0 4px 0', color: 'rgba(0,0,0,0.7)' }}>
                                    Current Volume: {recommendation.totalVolume.toFixed(2)} m³
                                </p>
                                <p style={{ margin: '0', color: 'rgba(0,0,0,0.7)' }}>
                                    Current Carbon Impact: {recommendation.currentImpact.toFixed(2)} tCO₂e
                                </p>
                            </div>

                            {recommendation.recommendations.map((rec: any, recIndex: number) => (
                                <div key={recIndex} style={{ 
                                    marginBottom: '16px',
                                    padding: '16px',
                                    backgroundColor: 'rgba(0,0,0,0.02)',
                                    borderRadius: '8px'
                                }}>
                                    <h5 style={{ margin: '0 0 12px 0', color: '#4CAF50' }}>
                                        {rec.suggestion.en} ({rec.suggestion.fi})
                                    </h5>
                                    <p style={{ margin: '0 0 12px 0' }}>{rec.reasoning}</p>
                                    
                                    <div className="technical-details" style={{ margin: '12px 0' }}>
                                        <h6 style={{ margin: '0 0 8px 0', color: 'rgba(0,0,0,0.7)' }}>
                                            Technical Details:
                                        </h6>
                                        <ul style={{ 
                                            margin: '0',
                                            paddingLeft: '20px',
                                            color: 'rgba(0,0,0,0.9)'
                                        }}>
                                            {rec.technicalDetails.map((detail: string, i: number) => (
                                                <li key={i}>{detail}</li>
                                            ))}
                                        </ul>
                                    </div>

                                    <div className="reduction-potential" style={{ 
                                        marginTop: '12px',
                                        padding: '12px',
                                        backgroundColor: 'rgba(76,175,80,0.1)',
                                        borderRadius: '4px'
                                    }}>
                                        <strong style={{ color: '#4CAF50' }}>Carbon Reduction Potential:</strong>
                                        <ul style={{ 
                                            margin: '8px 0 0 0',
                                            paddingLeft: '20px'
                                        }}>
                                            <li>Direct: {rec.carbonReduction.direct}</li>
                                            {rec.carbonReduction.indirect && (
                                                <li>Indirect: {rec.carbonReduction.indirect}</li>
                                            )}
                                            {rec.carbonReduction.conditions && (
                                                <li style={{ 
                                                    marginTop: '8px',
                                                    color: 'rgba(0,0,0,0.7)',
                                                    fontStyle: 'italic'
                                                }}>
                                                    Note: {rec.carbonReduction.conditions}
                                                </li>
                                            )}
                                        </ul>
                                    </div>
                                </div>
                            ))}

                            <div className="contextual-factors" style={{ 
                                marginTop: '16px',
                                padding: '12px',
                                backgroundColor: 'rgba(0,0,0,0.02)',
                                borderRadius: '8px',
                                fontSize: '14px'
                            }}>
                                <h6 style={{ margin: '0 0 8px 0', color: '#2196F3' }}>Context & Compliance:</h6>
                                <ul style={{ 
                                    margin: '0',
                                    paddingLeft: '20px',
                                    color: 'rgba(0,0,0,0.8)'
                                }}>
                                    {Object.entries(recommendation.contextualFactors).map(([key, value]) => (
                                        <li key={key}>{value as string}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}; 
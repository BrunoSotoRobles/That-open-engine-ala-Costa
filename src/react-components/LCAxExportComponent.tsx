import * as React from 'react';
import { LCAxExporter } from '../services/LCAxExporter';
import { useAuthStore } from '../stores/AuthStore';

interface LCAxExportComponentProps {
  materials: any[];
  projectInfo: any;
  results: any;
  onExport?: (filename: string) => void;
}

interface ExportState {
  isExporting: boolean;
  validationResult: any;
  compatibilityInfo: any;
  showCompatibility: boolean;
  showValidation: boolean;
}

export const LCAxExportComponent: React.FC<LCAxExportComponentProps> = ({
  materials,
  projectInfo,
  results,
  onExport
}) => {
  const { isAuthenticated } = useAuthStore();
  const [state, setState] = React.useState<ExportState>({
    isExporting: false,
    validationResult: null,
    compatibilityInfo: null,
    showCompatibility: false,
    showValidation: false
  });

  const lcaxExporter = LCAxExporter.getInstance();

  const handleExport = async () => {
    if (!isAuthenticated) {
      alert('Authentication required to export LCAx data. Please sign in to access this feature.');
      return;
    }
    
    if (!materials || materials.length === 0) {
      alert('No materials available for export');
      return;
    }

    setState(prev => ({ ...prev, isExporting: true }));

    try {
      // Convert to Finnish LCAx format
      const lcaxDocument = lcaxExporter.convertToFinnishLCAx(
        materials,
        projectInfo,
        results
      );

      // Validate document
      const validationResult = lcaxExporter.validateLCAx(lcaxDocument);
      setState(prev => ({ ...prev, validationResult }));

      if (!validationResult.isValid) {
        console.warn('LCAx validation errors:', validationResult.errors);
        alert(`Validation errors found: ${validationResult.errors.join(', ')}`);
        setState(prev => ({ ...prev, isExporting: false }));
        return;
      }

      // Generate filename
      const timestamp = new Date().toISOString().split('T')[0];
      const projectName = projectInfo?.name || 'project';
      const filename = `LCAx_${projectName}_${timestamp}.json`;

      // Export file
      lcaxExporter.exportToFile(lcaxDocument, filename);
      
      onExport?.(filename);
      
      console.log('LCAx export completed successfully');
    } catch (error) {
      console.error('Error exporting LCAx:', error);
      alert('Error exporting LCAx file. Please try again.');
    } finally {
      setState(prev => ({ ...prev, isExporting: false }));
    }
  };

  const handleShowCompatibility = () => {
    const compatibilityInfo = lcaxExporter.getOneClickLCACompatibility();
    setState(prev => ({ 
      ...prev, 
      compatibilityInfo,
      showCompatibility: !prev.showCompatibility 
    }));
  };

  const handleShowValidation = () => {
    if (!state.validationResult) {
      const lcaxDocument = lcaxExporter.convertToFinnishLCAx(
        materials,
        projectInfo,
        results
      );
      const validationResult = lcaxExporter.validateLCAx(lcaxDocument);
      setState(prev => ({ ...prev, validationResult }));
    }
    
    setState(prev => ({ 
      ...prev, 
      showValidation: !prev.showValidation 
    }));
  };

  return (
    <div className="dashboard-card">
      <div className="card-header">
        <h3>LCAx Export</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="material-icons" style={{ fontSize: '16px', color: 'var(--primary)' }}>
            info
          </span>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            International LCA Exchange Format
          </span>
        </div>
      </div>
      
      <div className="card-content" style={{ padding: '20px' }}>
        <div style={{ marginBottom: '20px' }}>
          <p style={{ marginBottom: '12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
            Export your LCA analysis in the standardized LCAx format with Finnish extensions. 
            This format is compatible with OneClickLCA and other LCA tools.
          </p>
          
          <div style={{ 
            backgroundColor: 'rgba(54, 162, 235, 0.1)', 
            padding: '12px', 
            borderRadius: '6px',
            border: '1px solid rgba(54, 162, 235, 0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span className="material-icons" style={{ fontSize: '16px', color: 'var(--primary)' }}>
                verified
              </span>
              <strong style={{ fontSize: '14px' }}>Finnish Standards Compliance</strong>
            </div>
            <ul style={{ 
              margin: '0', 
              paddingLeft: '20px', 
              fontSize: '13px',
              color: 'var(--text-secondary)'
            }}>
              <li>CO2Data.fi material database integration</li>
              <li>RTS EPD declarations</li>
              <li>VTT LIPASTO transport factors</li>
              <li>EN 15804 compliance verification</li>
            </ul>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={handleExport}
            disabled={state.isExporting || !materials || materials.length === 0 || !isAuthenticated}
            className="tooltip-enhanced"
            data-tooltip={!isAuthenticated ? "Authentication required to export LCAx data. Please sign in to access this feature." : "Export LCAx (Life Cycle Assessment XML) file compatible with OneClickLCA and other LCA software"}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 20px',
              backgroundColor: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: state.isExporting || !isAuthenticated ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              opacity: state.isExporting || !isAuthenticated ? 0.7 : 1
            }}
          >
            <span className="material-icons" style={{ fontSize: '18px' }}>
              {state.isExporting ? 'hourglass_empty' : !isAuthenticated ? 'lock' : 'download'}
            </span>
            {state.isExporting ? 'Exporting...' : !isAuthenticated ? 'Login Required' : 'Export LCAx'}
          </button>

          <button
            onClick={handleShowCompatibility}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              backgroundColor: 'transparent',
              color: 'var(--primary)',
              border: '1px solid var(--primary)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            <span className="material-icons" style={{ fontSize: '16px' }}>
              integration_instructions
            </span>
            OneClickLCA Info
          </button>

          <button
            onClick={handleShowValidation}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            <span className="material-icons" style={{ fontSize: '16px' }}>
              fact_check
            </span>
            Validate
          </button>
        </div>

        {/* OneClickLCA Compatibility Information */}
        {state.showCompatibility && state.compatibilityInfo && (
          <div style={{ 
            marginTop: '20px',
            padding: '16px',
            backgroundColor: 'rgba(255, 193, 7, 0.1)',
            borderRadius: '6px',
            border: '1px solid rgba(255, 193, 7, 0.3)'
          }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', color: 'var(--text-primary)' }}>
              OneClickLCA Compatibility
            </h4>
            
            <div style={{ marginBottom: '16px' }}>
              <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                Supported Formats:
              </strong>
              <ul style={{ 
                margin: '8px 0 0 0', 
                paddingLeft: '20px',
                fontSize: '13px',
                color: 'var(--text-secondary)'
              }}>
                {state.compatibilityInfo.supportedFormats.map((format: string, index: number) => (
                  <li key={index}>{format}</li>
                ))}
              </ul>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                Conversion Notes:
              </strong>
              <ul style={{ 
                margin: '8px 0 0 0', 
                paddingLeft: '20px',
                fontSize: '13px',
                color: 'var(--text-secondary)'
              }}>
                {state.compatibilityInfo.conversionNotes.map((note: string, index: number) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>

            <div>
              <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                Limitations:
              </strong>
              <ul style={{ 
                margin: '8px 0 0 0', 
                paddingLeft: '20px',
                fontSize: '13px',
                color: 'var(--text-secondary)'
              }}>
                {state.compatibilityInfo.limitations.map((limitation: string, index: number) => (
                  <li key={index}>{limitation}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Validation Results */}
        {state.showValidation && state.validationResult && (
          <div style={{ 
            marginTop: '20px',
            padding: '16px',
            backgroundColor: state.validationResult.isValid 
              ? 'rgba(76, 175, 80, 0.1)' 
              : 'rgba(244, 67, 54, 0.1)',
            borderRadius: '6px',
            border: `1px solid ${state.validationResult.isValid 
              ? 'rgba(76, 175, 80, 0.3)' 
              : 'rgba(244, 67, 54, 0.3)'}`
          }}>
            <h4 style={{ 
              margin: '0 0 12px 0', 
              fontSize: '16px',
              color: state.validationResult.isValid ? 'var(--success)' : 'var(--error)'
            }}>
              <span className="material-icons" style={{ 
                fontSize: '18px', 
                marginRight: '8px',
                verticalAlign: 'middle'
              }}>
                {state.validationResult.isValid ? 'check_circle' : 'error'}
              </span>
              Validation Results
            </h4>

            {state.validationResult.errors.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <strong style={{ fontSize: '14px', color: 'var(--error)' }}>
                  Errors ({state.validationResult.errors.length}):
                </strong>
                <ul style={{ 
                  margin: '8px 0 0 0', 
                  paddingLeft: '20px',
                  fontSize: '13px',
                  color: 'var(--error)'
                }}>
                  {state.validationResult.errors.map((error: string, index: number) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            {state.validationResult.warnings.length > 0 && (
              <div>
                <strong style={{ fontSize: '14px', color: 'var(--warning)' }}>
                  Warnings ({state.validationResult.warnings.length}):
                </strong>
                <ul style={{ 
                  margin: '8px 0 0 0', 
                  paddingLeft: '20px',
                  fontSize: '13px',
                  color: 'var(--warning)'
                }}>
                  {state.validationResult.warnings.map((warning: string, index: number) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {state.validationResult.isValid && state.validationResult.errors.length === 0 && (
              <p style={{ 
                margin: '0', 
                fontSize: '14px', 
                color: 'var(--success)',
                fontWeight: '500'
              }}>
                ✓ LCAx document is valid and ready for export
              </p>
            )}
          </div>
        )}

        {/* Export Status */}
        {state.isExporting && (
          <div style={{ 
            marginTop: '16px',
            padding: '12px',
            backgroundColor: 'rgba(54, 162, 235, 0.1)',
            borderRadius: '6px',
            border: '1px solid rgba(54, 162, 235, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div className="spinner" style={{ width: '16px', height: '16px' }}></div>
            <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              Generating LCAx document with Finnish extensions...
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

import * as React from 'react';
import { BOQExporter } from '../services/BOQExporter';
import { BaseCostElement } from '../types/cost';
import { useAuthStore } from '../stores/AuthStore';

interface BOQExportComponentProps {
  costData: BaseCostElement[];
  projectInfo: any;
  onExport?: (filename: string, format: string) => void;
}

interface ExportState {
  isExporting: boolean;
  validationResult: any;
  compatibilityInfo: any;
  showCompatibility: boolean;
  showValidation: boolean;
  exportOptions: {
    includeRTKortti: boolean;
    includeSpecifications: boolean;
    includeLocation: boolean;
    language: 'fi' | 'en';
    format: 'excel' | 'csv';
  };
}

export const BOQExportComponent: React.FC<BOQExportComponentProps> = ({
  costData,
  projectInfo,
  onExport
}) => {
  const { isAuthenticated } = useAuthStore();
  const [state, setState] = React.useState<ExportState>({
    isExporting: false,
    validationResult: null,
    compatibilityInfo: null,
    showCompatibility: false,
    showValidation: false,
    exportOptions: {
      includeRTKortti: true,
      includeSpecifications: true,
      includeLocation: false,
      language: 'en',
      format: 'excel'
    }
  });

  const boqExporter = BOQExporter.getInstance();

  const handleExport = async () => {
    if (!isAuthenticated) {
      alert('Authentication required to export BOQ data. Please sign in to access this feature.');
      return;
    }
    
    if (!costData || costData.length === 0) {
      alert('No cost data available for BOQ export');
      return;
    }

    setState(prev => ({ ...prev, isExporting: true }));

    try {
      // Convert to Finnish BOQ format
      const boqDocument = boqExporter.convertToFinnishBOQ(
        costData,
        projectInfo,
        state.exportOptions
      );

      // Validate document
      const validationResult = boqExporter.validateBOQ(boqDocument);
      setState(prev => ({ ...prev, validationResult }));

      if (!validationResult.isValid) {
        console.warn('BOQ validation errors:', validationResult.errors);
        alert(`Validation errors found: ${validationResult.errors.join(', ')}`);
        setState(prev => ({ ...prev, isExporting: false }));
        return;
      }

      // Generate filename
      const timestamp = new Date().toISOString().split('T')[0];
      const projectName = projectInfo?.name || 'project';
      const format = state.exportOptions.format;
      const extension = format === 'excel' ? 'xlsx' : 'csv';
      const filename = `BOQ_${projectName}_${timestamp}.${extension}`;

      // Export file
      if (format === 'excel') {
        boqExporter.exportToExcel(boqDocument, filename);
      } else {
        boqExporter.exportToCSV(boqDocument, filename);
      }
      
      onExport?.(filename, format);
      
      console.log('BOQ export completed successfully');
    } catch (error) {
      console.error('Error exporting BOQ:', error);
      alert('Error exporting BOQ file. Please try again.');
    } finally {
      setState(prev => ({ ...prev, isExporting: false }));
    }
  };

  const handleShowCompatibility = () => {
    const admicomInfo = boqExporter.getAdmicomCompatibility();
    const quantimaInfo = boqExporter.getQuantimaCompatibility();
    
    setState(prev => ({
      ...prev,
      compatibilityInfo: { admicom: admicomInfo, quantima: quantimaInfo },
      showCompatibility: true
    }));
  };

  const handleShowValidation = () => {
    if (costData && costData.length > 0) {
      const boqDocument = boqExporter.convertToFinnishBOQ(
        costData,
        projectInfo,
        state.exportOptions
      );
      const validationResult = boqExporter.validateBOQ(boqDocument);
      setState(prev => ({
        ...prev,
        validationResult,
        showValidation: true
      }));
    }
  };

  const updateExportOption = (key: keyof ExportState['exportOptions'], value: any) => {
    setState(prev => ({
      ...prev,
      exportOptions: {
        ...prev.exportOptions,
        [key]: value
      }
    }));
  };

  return (
    <div className="dashboard-card">
      <div className="card-header">
        <h3>Finnish BOQ Export</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="button-secondary"
            onClick={handleShowCompatibility}
            style={{ fontSize: '0.9em', padding: '4px 8px' }}
          >
            <span className="material-icons-round" style={{ fontSize: '16px' }}>info</span>
            Compatibility
          </button>
          <button
            className="button-secondary"
            onClick={handleShowValidation}
            style={{ fontSize: '0.9em', padding: '4px 8px' }}
          >
            <span className="material-icons-round" style={{ fontSize: '16px' }}>check_circle</span>
            Validate
          </button>
        </div>
      </div>

      <div style={{ padding: '1.5rem' }}>
        {/* Export Options */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ marginBottom: '1rem' }}>Export Options</h4>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1rem',
            marginBottom: '1rem'
          }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9em' }}>
                Export Format:
              </label>
              <select
                value={state.exportOptions.format}
                onChange={(e) => updateExportOption('format', e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  color: 'var(--text-1)',
                  fontSize: '0.9em'
                }}
              >
                <option value="excel">Excel (.xlsx) - Admicom Compatible</option>
                <option value="csv">CSV (.csv) - Quantima Compatible</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9em' }}>
                Language:
              </label>
              <select
                value={state.exportOptions.language}
                onChange={(e) => updateExportOption('language', e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  color: 'var(--text-1)',
                  fontSize: '0.9em'
                }}
              >
                <option value="en">English</option>
                <option value="fi">Finnish</option>
              </select>
            </div>
          </div>

          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem'
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9em' }}>
              <input
                type="checkbox"
                checked={state.exportOptions.includeRTKortti}
                onChange={(e) => updateExportOption('includeRTKortti', e.target.checked)}
                style={{ margin: 0 }}
              />
              Include RT-kortti References
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9em' }}>
              <input
                type="checkbox"
                checked={state.exportOptions.includeSpecifications}
                onChange={(e) => updateExportOption('includeSpecifications', e.target.checked)}
                style={{ margin: 0 }}
              />
              Include Technical Specifications
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9em' }}>
              <input
                type="checkbox"
                checked={state.exportOptions.includeLocation}
                onChange={(e) => updateExportOption('includeLocation', e.target.checked)}
                style={{ margin: 0 }}
              />
              Include Location Information
            </label>
          </div>
        </div>

        {/* Export Button */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button
            className="button-primary tooltip-enhanced"
            onClick={handleExport}
            disabled={state.isExporting || !costData || costData.length === 0 || !isAuthenticated}
            data-tooltip={!isAuthenticated ? "Authentication required to export BOQ data. Please sign in to access this feature." : `Export Finnish BOQ in ${state.exportOptions.format.toUpperCase()} format with TALO 2000 compliance`}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              opacity: !isAuthenticated ? 0.6 : 1,
              cursor: !isAuthenticated ? 'not-allowed' : 'pointer'
            }}
          >
            <span className="material-icons-round">
              {state.isExporting ? 'hourglass_empty' : !isAuthenticated ? 'lock' : 'download'}
            </span>
            {state.isExporting ? 'Exporting...' : !isAuthenticated ? 'Login Required' : `Export BOQ (${state.exportOptions.format.toUpperCase()})`}
          </button>

          {costData && costData.length > 0 && (
            <span style={{ fontSize: '0.9em', color: 'var(--text-2)' }}>
              {costData.length} cost elements ready for export
            </span>
          )}
        </div>

        {/* Finnish Standards Info */}
        <div style={{ 
          marginTop: '1.5rem',
          padding: '1rem',
          backgroundColor: 'var(--surface-2)',
          borderRadius: '8px',
          fontSize: '0.9em'
        }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-1)' }}>
            Finnish Standards Compliance
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div>
              <strong>TALO 2000:</strong> ✓ Classification system
            </div>
            <div>
              <strong>RT-kortti:</strong> ✓ Reference codes
            </div>
            <div>
              <strong>CO2Data.fi:</strong> ✓ Material database
            </div>
            <div>
              <strong>VTT LIPASTO:</strong> ✓ Transport factors
            </div>
          </div>
        </div>
      </div>

      {/* Compatibility Modal */}
      {state.showCompatibility && state.compatibilityInfo && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--surface-1)',
            borderRadius: '8px',
            padding: '2rem',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3>Tool Compatibility</h3>
              <button
                onClick={() => setState(prev => ({ ...prev, showCompatibility: false }))}
                style={{ background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer' }}
              >
                <span className="material-icons-round">close</span>
              </button>
            </div>

            <div style={{ display: 'grid', gap: '1.5rem' }}>
              {/* Admicom Compatibility */}
              <div>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                  <span className="material-icons-round" style={{ color: 'var(--primary)' }}>check_circle</span>
                  Admicom Estima/Quantima
                </h4>
                <div style={{ fontSize: '0.9em', color: 'var(--text-2)' }}>
                  <div><strong>Version:</strong> {state.compatibilityInfo.admicom.version}</div>
                  <div><strong>Format:</strong> {state.compatibilityInfo.admicom.importFormat}</div>
                </div>
                
                <div style={{ marginTop: '0.5rem' }}>
                  <strong>Conversion Notes:</strong>
                  <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                    {state.compatibilityInfo.admicom.conversionNotes.map((note: string, index: number) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </div>

                <div style={{ marginTop: '0.5rem' }}>
                  <strong>Limitations:</strong>
                  <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                    {state.compatibilityInfo.admicom.limitations.map((limitation: string, index: number) => (
                      <li key={index}>{limitation}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Quantima Compatibility */}
              <div>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                  <span className="material-icons-round" style={{ color: 'var(--primary)' }}>check_circle</span>
                  Quantima
                </h4>
                <div style={{ fontSize: '0.9em', color: 'var(--text-2)' }}>
                  <div><strong>Version:</strong> {state.compatibilityInfo.quantima.version}</div>
                  <div><strong>Format:</strong> {state.compatibilityInfo.quantima.importFormat}</div>
                </div>
                
                <div style={{ marginTop: '0.5rem' }}>
                  <strong>Conversion Notes:</strong>
                  <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                    {state.compatibilityInfo.quantima.conversionNotes.map((note: string, index: number) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </div>

                <div style={{ marginTop: '0.5rem' }}>
                  <strong>Limitations:</strong>
                  <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                    {state.compatibilityInfo.quantima.limitations.map((limitation: string, index: number) => (
                      <li key={index}>{limitation}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Validation Modal */}
      {state.showValidation && state.validationResult && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--surface-1)',
            borderRadius: '8px',
            padding: '2rem',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3>BOQ Validation Results</h3>
              <button
                onClick={() => setState(prev => ({ ...prev, showValidation: false }))}
                style={{ background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer' }}
              >
                <span className="material-icons-round">close</span>
              </button>
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
              {/* Validation Status */}
              <div style={{
                padding: '1rem',
                backgroundColor: state.validationResult.isValid ? 'var(--success-bg)' : 'var(--error-bg)',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span className="material-icons-round" style={{ 
                  color: state.validationResult.isValid ? 'var(--success)' : 'var(--error)' 
                }}>
                  {state.validationResult.isValid ? 'check_circle' : 'error'}
                </span>
                <strong>
                  {state.validationResult.isValid ? 'Validation Passed' : 'Validation Failed'}
                </strong>
              </div>

              {/* Compliance Status */}
              <div>
                <h4 style={{ marginBottom: '0.5rem' }}>Standards Compliance</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons-round" style={{ 
                      color: state.validationResult.compliance.talo2000 ? 'var(--success)' : 'var(--error)' 
                    }}>
                      {state.validationResult.compliance.talo2000 ? 'check_circle' : 'error'}
                    </span>
                    TALO 2000
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons-round" style={{ 
                      color: state.validationResult.compliance.rtKortti ? 'var(--success)' : 'var(--error)' 
                    }}>
                      {state.validationResult.compliance.rtKortti ? 'check_circle' : 'error'}
                    </span>
                    RT-kortti
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons-round" style={{ 
                      color: state.validationResult.compliance.admicom ? 'var(--success)' : 'var(--error)' 
                    }}>
                      {state.validationResult.compliance.admicom ? 'check_circle' : 'error'}
                    </span>
                    Admicom
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons-round" style={{ 
                      color: state.validationResult.compliance.quantima ? 'var(--success)' : 'var(--error)' 
                    }}>
                      {state.validationResult.compliance.quantima ? 'check_circle' : 'error'}
                    </span>
                    Quantima
                  </div>
                </div>
              </div>

              {/* Errors */}
              {state.validationResult.errors.length > 0 && (
                <div>
                  <h4 style={{ marginBottom: '0.5rem', color: 'var(--error)' }}>Errors</h4>
                  <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.9em' }}>
                    {state.validationResult.errors.map((error: string, index: number) => (
                      <li key={index} style={{ color: 'var(--error)' }}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings */}
              {state.validationResult.warnings.length > 0 && (
                <div>
                  <h4 style={{ marginBottom: '0.5rem', color: 'var(--warning)' }}>Warnings</h4>
                  <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.9em' }}>
                    {state.validationResult.warnings.map((warning: string, index: number) => (
                      <li key={index} style={{ color: 'var(--warning)' }}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Enhanced BOQ Export Component
 * Professional Finnish BOQ export interface with advanced features
 */

import * as React from 'react';
import { BaseCostElement } from '../types/cost';

interface EnhancedBOQExportComponentProps {
  costData: BaseCostElement[];
  projectInfo: any;
  onExport: (filename: string, format: string) => void;
}

interface ExportState {
  isExporting: boolean;
  exportFormat: 'excel' | 'csv' | 'json';
  language: 'fi' | 'en' | 'sv';
  currency: 'EUR' | 'USD' | 'SEK';
  includeRTKortti: boolean;
  includeSpecifications: boolean;
  includeLocation: boolean;
  includeEnvironmental: boolean;
  validationLevel: 'basic' | 'standard' | 'comprehensive';
  precision: number;
  showCompatibility: boolean;
  showValidation: boolean;
  compatibilityInfo: any;
  validationResults: any;
}

export const EnhancedBOQExportComponent: React.FC<EnhancedBOQExportComponentProps> = ({
  costData,
  projectInfo,
  onExport
}) => {
  const [state, setState] = React.useState<ExportState>({
    isExporting: false,
    exportFormat: 'excel',
    language: 'en',
    currency: 'EUR',
    includeRTKortti: true,
    includeSpecifications: true,
    includeLocation: true,
    includeEnvironmental: true,
    validationLevel: 'comprehensive',
    precision: 2,
    showCompatibility: false,
    showValidation: false,
    compatibilityInfo: null,
    validationResults: null
  });

  const handleExport = async () => {
    setState(prev => ({ ...prev, isExporting: true }));

    try {
      // Import the enhanced exporter dynamically to avoid circular dependencies
      const { EnhancedBOQExporter } = await import('../services/EnhancedBOQExporter');
      const exporter = EnhancedBOQExporter.getInstance();

      // Create enhanced BOQ document
      const boqDocument = exporter.convertToEnhancedFinnishBOQ(costData, projectInfo, {
        includeRTKortti: state.includeRTKortti,
        includeSpecifications: state.includeSpecifications,
        includeLocation: state.includeLocation,
        includeEnvironmental: state.includeEnvironmental,
        language: state.language,
        currency: state.currency,
        precision: state.precision,
        validationLevel: state.validationLevel
      });

      // Validate the document
      const validation = exporter.validateEnhancedBOQ(boqDocument, state.validationLevel);
      setState(prev => ({ ...prev, validationResults: validation }));

      // Generate filename with correct extension
      const timestamp = new Date().toISOString().split('T')[0];
      const getFileExtension = (format: string) => {
        switch (format) {
          case 'excel': return 'xlsx';
          case 'csv': return 'csv';
          case 'json': return 'json';
          default: return format;
        }
      };
      const fileExtension = getFileExtension(state.exportFormat);
      const filename = `enhanced-boq-${projectInfo?.name || 'project'}-${timestamp}.${fileExtension}`;

      // Export based on format
      switch (state.exportFormat) {
        case 'excel':
          exporter.exportToEnhancedExcel(boqDocument, filename);
          break;
        case 'csv':
          exporter.exportToEnhancedCSV(boqDocument, filename);
          break;
        case 'json':
          exporter.exportToEnhancedJSON(boqDocument, filename);
          break;
      }

      onExport(filename, state.exportFormat);
    } catch (error) {
      console.error('Enhanced BOQ export error:', error);
      alert('Error exporting enhanced BOQ. Please try again.');
    } finally {
      setState(prev => ({ ...prev, isExporting: false }));
    }
  };

  const handleShowCompatibility = async () => {
    try {
      const { EnhancedBOQExporter } = await import('../services/EnhancedBOQExporter');
      const exporter = EnhancedBOQExporter.getInstance();
      const compatibilityInfo = exporter.getEnhancedCompatibilityInfo();
      setState(prev => ({ ...prev, compatibilityInfo, showCompatibility: true }));
    } catch (error) {
      console.error('Error loading compatibility info:', error);
    }
  };

  const handleShowValidation = async () => {
    try {
      const { EnhancedBOQExporter } = await import('../services/EnhancedBOQExporter');
      const exporter = EnhancedBOQExporter.getInstance();
      
      const boqDocument = exporter.convertToEnhancedFinnishBOQ(costData, projectInfo, {
        includeRTKortti: state.includeRTKortti,
        includeSpecifications: state.includeSpecifications,
        includeLocation: state.includeLocation,
        includeEnvironmental: state.includeEnvironmental,
        language: state.language,
        currency: state.currency,
        precision: state.precision,
        validationLevel: state.validationLevel
      });

      const validation = exporter.validateEnhancedBOQ(boqDocument, state.validationLevel);
      setState(prev => ({ ...prev, validationResults: validation, showValidation: true }));
    } catch (error) {
      console.error('Error running validation:', error);
    }
  };

  return (
    <div className="dashboard-card">
      <div className="card-header">
        <h3>Enhanced BOQ Export</h3>
        <p style={{ fontSize: '0.9em', color: 'var(--text-2)', margin: '0.5rem 0 0 0' }}>
          Professional Finnish BOQ exporter with advanced features and comprehensive validation
        </p>
      </div>

      <div style={{ padding: '1.5rem' }}>
        {/* Export Format Selection */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 0.5rem 0' }}>Export Format</h4>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {[
              { value: 'excel', label: 'Excel (.xlsx)', icon: 'table_chart' },
              { value: 'csv', label: 'CSV (.csv)', icon: 'description' },
              { value: 'json', label: 'JSON (.json)', icon: 'code' }
            ].map(format => (
              <button
                key={format.value}
                onClick={() => setState(prev => ({ ...prev, exportFormat: format.value as any }))}
                style={{
                  padding: '0.75rem 1rem',
                  border: state.exportFormat === format.value ? '2px solid var(--primary)' : '1px solid var(--border)',
                  borderRadius: '8px',
                  background: state.exportFormat === format.value ? 'var(--primary-transparent)' : 'var(--surface-2)',
                  color: 'var(--text-1)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.9em'
                }}
              >
                <span className="material-icons-round" style={{ fontSize: '1.2em' }}>
                  {format.icon}
                </span>
                {format.label}
              </button>
            ))}
          </div>
        </div>

        {/* Language and Currency Options */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 0.5rem 0' }}>Language & Currency</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9em' }}>Language</label>
              <select
                value={state.language}
                onChange={(e) => setState(prev => ({ ...prev, language: e.target.value as any }))}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  background: 'var(--surface-2)',
                  color: 'var(--text-1)'
                }}
              >
                <option value="fi">Suomi (Finnish)</option>
                <option value="en">English</option>
                <option value="sv">Svenska (Swedish)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9em' }}>Currency</label>
              <select
                value={state.currency}
                onChange={(e) => setState(prev => ({ ...prev, currency: e.target.value as any }))}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  background: 'var(--surface-2)',
                  color: 'var(--text-1)'
                }}
              >
                <option value="EUR">EUR (Euro)</option>
                <option value="USD">USD (US Dollar)</option>
                <option value="SEK">SEK (Swedish Krona)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Content Options */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 0.5rem 0' }}>Content Options</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {[
              { key: 'includeRTKortti', label: 'RT-kortti References', description: 'Include Finnish RT-kortti specifications' },
              { key: 'includeSpecifications', label: 'Technical Specifications', description: 'Include detailed technical specs' },
              { key: 'includeLocation', label: 'Location Information', description: 'Include floor/zone/room data' },
              { key: 'includeEnvironmental', label: 'Environmental Data', description: 'Include CO2 and sustainability data' }
            ].map(option => (
              <label key={option.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={state[option.key as keyof ExportState] as boolean}
                  onChange={(e) => setState(prev => ({ ...prev, [option.key]: e.target.checked }))}
                  style={{ margin: 0 }}
                />
                <div>
                  <div style={{ fontWeight: '500', fontSize: '0.9em' }}>{option.label}</div>
                  <div style={{ fontSize: '0.8em', color: 'var(--text-2)' }}>{option.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Validation Level */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 0.5rem 0' }}>Validation Level</h4>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {[
              { value: 'basic', label: 'Basic', description: 'Essential validation only' },
              { value: 'standard', label: 'Standard', description: 'Standard business rules' },
              { value: 'comprehensive', label: 'Comprehensive', description: 'Full validation suite' }
            ].map(level => (
              <button
                key={level.value}
                onClick={() => setState(prev => ({ ...prev, validationLevel: level.value as any }))}
                style={{
                  padding: '0.75rem 1rem',
                  border: state.validationLevel === level.value ? '2px solid var(--primary)' : '1px solid var(--border)',
                  borderRadius: '8px',
                  background: state.validationLevel === level.value ? 'var(--primary-transparent)' : 'var(--surface-2)',
                  color: 'var(--text-1)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minWidth: '150px'
                }}
              >
                <div style={{ fontWeight: '500' }}>{level.label}</div>
                <div style={{ fontSize: '0.8em', color: 'var(--text-2)' }}>{level.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <button
            className="tooltip-enhanced"
            onClick={handleExport}
            disabled={state.isExporting}
            data-tooltip={`Export enhanced BOQ in ${state.exportFormat.toUpperCase()} format with Finnish standards compliance`}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: state.isExporting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.9em',
              opacity: state.isExporting ? 0.6 : 1
            }}
          >
            <span className="material-icons-round">
              {state.isExporting ? 'hourglass_empty' : 'download'}
            </span>
            {state.isExporting ? 'Exporting...' : `Export ${state.exportFormat.toUpperCase()}`}
          </button>

          <button
            onClick={handleShowCompatibility}
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--surface-2)',
              color: 'var(--text-1)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.9em'
            }}
          >
            <span className="material-icons-round">info</span>
            Compatibility
          </button>

          <button
            onClick={handleShowValidation}
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--surface-2)',
              color: 'var(--text-1)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.9em'
            }}
          >
            <span className="material-icons-round">verified</span>
            Validation
          </button>
        </div>

        {/* Status Information */}
        <div style={{ 
          padding: '1rem', 
          background: 'var(--surface-2)', 
          borderRadius: '8px',
          fontSize: '0.9em',
          color: 'var(--text-2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span className="material-icons-round" style={{ fontSize: '1.2em' }}>check_circle</span>
            <strong>Enhanced BOQ Features</strong>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
            <li>Professional Finnish standards compliance (TALO 2000, RT-kortti, CO2Data.fi)</li>
            <li>Advanced validation with multiple levels</li>
            <li>Environmental impact assessment</li>
            <li>Tool compatibility (Admicom, Quantima, Excel, BIM, ERP)</li>
            <li>Multi-language support (FI/EN/SV)</li>
            <li>Comprehensive cost breakdown and analysis</li>
          </ul>
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
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'var(--surface-1)',
            borderRadius: '12px',
            padding: '2rem',
            maxWidth: '800px',
            maxHeight: '80vh',
            overflow: 'auto',
            border: '1px solid var(--border)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0 }}>Tool Compatibility</h3>
              <button
                onClick={() => setState(prev => ({ ...prev, showCompatibility: false }))}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  fontSize: '1.5rem'
                }}
              >
                ×
              </button>
            </div>
            
            <div style={{ display: 'grid', gap: '1.5rem' }}>
              {Object.entries(state.compatibilityInfo).map(([tool, info]: [string, any]) => (
                <div key={tool} style={{ 
                  padding: '1rem', 
                  border: '1px solid var(--border)', 
                  borderRadius: '8px',
                  background: 'var(--surface-2)'
                }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', textTransform: 'capitalize' }}>{tool}</h4>
                  <div style={{ fontSize: '0.9em', color: 'var(--text-2)' }}>
                    <div><strong>Supported:</strong> {info.supported ? 'Yes' : 'No'}</div>
                    <div><strong>Version:</strong> {info.version}</div>
                    <div><strong>Format:</strong> {info.importFormat}</div>
                  </div>
                  {info.conversionNotes && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <strong>Notes:</strong>
                      <ul style={{ margin: '0.25rem 0 0 1.5rem', fontSize: '0.85em' }}>
                        {info.conversionNotes.map((note: string, index: number) => (
                          <li key={index}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Validation Modal */}
      {state.showValidation && state.validationResults && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'var(--surface-1)',
            borderRadius: '12px',
            padding: '2rem',
            maxWidth: '800px',
            maxHeight: '80vh',
            overflow: 'auto',
            border: '1px solid var(--border)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0 }}>Validation Results</h3>
              <button
                onClick={() => setState(prev => ({ ...prev, showValidation: false }))}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  fontSize: '1.5rem'
                }}
              >
                ×
              </button>
            </div>
            
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div style={{ 
                padding: '1rem', 
                background: state.validationResults.schema.isValid ? 'var(--success-transparent)' : 'var(--error-transparent)',
                borderRadius: '8px',
                border: `1px solid ${state.validationResults.schema.isValid ? 'var(--success)' : 'var(--error)'}`
              }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: state.validationResults.schema.isValid ? 'var(--success)' : 'var(--error)' }}>
                  Schema Validation: {state.validationResults.schema.isValid ? 'PASSED' : 'FAILED'}
                </h4>
                <div style={{ fontSize: '0.9em' }}>
                  <div>Compliance: {state.validationResults.schema.compliance}%</div>
                  {state.validationResults.schema.errors.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <strong>Errors:</strong>
                      <ul style={{ margin: '0.25rem 0 0 1.5rem' }}>
                        {state.validationResults.schema.errors.map((error: any, index: number) => (
                          <li key={index}>{error.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ 
                padding: '1rem', 
                background: 'var(--surface-2)',
                borderRadius: '8px',
                border: '1px solid var(--border)'
              }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>Quality Assessment</h4>
                <div style={{ fontSize: '0.9em' }}>
                  <div>Completeness: {state.validationResults.quality.completeness}%</div>
                  <div>Accuracy: {state.validationResults.quality.accuracy}%</div>
                  <div>Consistency: {state.validationResults.quality.consistency}%</div>
                  <div>Risk Level: <span style={{ 
                    color: state.validationResults.quality.riskLevel === 'high' ? 'var(--error)' : 
                           state.validationResults.quality.riskLevel === 'medium' ? 'var(--warning)' : 'var(--success)'
                  }}>{state.validationResults.quality.riskLevel.toUpperCase()}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

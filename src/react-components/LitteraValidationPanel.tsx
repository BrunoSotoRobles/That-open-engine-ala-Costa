import React, { useState } from 'react';
import { runLitteraValidation } from '../utils/LitteraValidationTool';

interface ValidationSummary {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  overallScore: number;
  criticalIssues: string[];
  results: any[];
}

export const LitteraValidationPanel: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<ValidationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunValidation = async () => {
    setIsRunning(true);
    setError(null);
    
    try {
      const summary = await runLitteraValidation();
      setResults(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('[LitteraValidation] Error:', err);
    } finally {
      setIsRunning(false);
    }
  };

  const handleDownloadResults = () => {
    if (!results) return;

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `littera-validation-${timestamp}.json`;
    
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const getScoreColor = (score: number): string => {
    if (score >= 80) return '#4CAF50';
    if (score >= 60) return '#FF9800';
    return '#f44336';
  };

  return (
    <div style={{
      padding: '1.5rem',
      backgroundColor: 'var(--surface-1)',
      borderRadius: '8px',
      border: '1px solid var(--border)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="material-icons-round">verified</span>
          Littera Filtering Validation
        </h3>
        <button
          onClick={handleRunValidation}
          disabled={isRunning}
          style={{
            padding: '8px 16px',
            backgroundColor: isRunning ? '#ccc' : 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span className="material-icons-round" style={{ fontSize: '18px' }}>
            {isRunning ? 'hourglass_empty' : 'play_arrow'}
          </span>
          {isRunning ? 'Running...' : 'Run Validation'}
        </button>
      </div>

      <p style={{ color: 'var(--text-2)', fontSize: '0.9em', margin: '0 0 1rem 0' }}>
        Validates the Littera filtering service against 5 known Finnish construction cases to ensure accuracy.
      </p>

      {error && (
        <div style={{
          padding: '1rem',
          backgroundColor: '#ffebee',
          border: '1px solid #f44336',
          borderRadius: '6px',
          color: '#c62828',
          marginTop: '1rem'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {results && (
        <div style={{ marginTop: '1.5rem' }}>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{
              padding: '1rem',
              backgroundColor: 'var(--surface-2)',
              borderRadius: '6px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ fontSize: '0.85em', color: 'var(--text-2)', marginBottom: '4px' }}>Overall Score</div>
              <div style={{
                fontSize: '2em',
                fontWeight: 'bold',
                color: getScoreColor(results.overallScore)
              }}>
                {results.overallScore}/100
              </div>
            </div>

            <div style={{
              padding: '1rem',
              backgroundColor: 'var(--surface-2)',
              borderRadius: '6px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ fontSize: '0.85em', color: 'var(--text-2)', marginBottom: '4px' }}>Test Cases</div>
              <div style={{ fontSize: '1.5em', fontWeight: 'bold', color: 'var(--text-1)' }}>
                {results.passedCases}/{results.totalCases}
                <span style={{ fontSize: '0.6em', marginLeft: '8px', color: 'var(--text-2)' }}>
                  ({Math.round((results.passedCases / results.totalCases) * 100)}%)
                </span>
              </div>
            </div>

            <div style={{
              padding: '1rem',
              backgroundColor: 'var(--surface-2)',
              borderRadius: '6px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ fontSize: '0.85em', color: 'var(--text-2)', marginBottom: '4px' }}>Status</div>
              <div style={{
                fontSize: '1.2em',
                fontWeight: 'bold',
                color: results.failedCases === 0 ? '#4CAF50' : '#f44336',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <span className="material-icons-round">
                  {results.failedCases === 0 ? 'check_circle' : 'error'}
                </span>
                {results.failedCases === 0 ? 'All Passed' : `${results.failedCases} Failed`}
              </div>
            </div>
          </div>

          {/* Critical Issues */}
          {results.criticalIssues.length > 0 && (
            <div style={{
              padding: '1rem',
              backgroundColor: '#fff3e0',
              border: '1px solid #ff9800',
              borderRadius: '6px',
              marginBottom: '1.5rem'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-icons-round" style={{ color: '#ff9800' }}>warning</span>
                Critical Issues
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                {results.criticalIssues.map((issue, idx) => (
                  <li key={idx} style={{ color: '#e65100', fontSize: '0.9em' }}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Individual Results */}
          <div style={{ marginBottom: '1rem' }}>
            <h4 style={{ marginBottom: '0.5rem' }}>Test Case Results</h4>
            {results.results.map((result: any, idx: number) => (
              <details key={idx} style={{
                marginBottom: '0.5rem',
                backgroundColor: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                padding: '0.75rem'
              }}>
                <summary style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: '500'
                }}>
                  <span style={{ fontSize: '1.2em' }}>{result.passed ? '✅' : '❌'}</span>
                  <span>{result.caseId}: {result.description}</span>
                  <span style={{
                    marginLeft: 'auto',
                    padding: '2px 8px',
                    backgroundColor: getScoreColor(result.score),
                    color: 'white',
                    borderRadius: '12px',
                    fontSize: '0.85em'
                  }}>
                    {result.score}/100
                  </span>
                </summary>
                
                <div style={{ marginTop: '1rem', paddingLeft: '1.5rem' }}>
                  {result.errors.length > 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <strong style={{ color: '#f44336' }}>Errors:</strong>
                      <ul style={{ margin: '0.25rem 0 0 1rem', paddingLeft: '0.5rem' }}>
                        {result.errors.map((err: string, i: number) => (
                          <li key={i} style={{ fontSize: '0.9em', color: '#f44336' }}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {result.warnings.length > 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <strong style={{ color: '#ff9800' }}>Warnings:</strong>
                      <ul style={{ margin: '0.25rem 0 0 1rem', paddingLeft: '0.5rem' }}>
                        {result.warnings.map((warn: string, i: number) => (
                          <li key={i} style={{ fontSize: '0.9em', color: '#ff9800' }}>{warn}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div style={{ fontSize: '0.9em', color: 'var(--text-2)' }}>
                    <strong>Top 5 suggested codes:</strong>
                    <div style={{ marginTop: '0.5rem' }}>
                      {result.actualTopCodes.map((code: any, i: number) => (
                        <div key={i} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '4px 0',
                          borderBottom: i < result.actualTopCodes.length - 1 ? '1px solid var(--border)' : 'none'
                        }}>
                          <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{code.code}</span>
                          <span style={{ fontSize: '0.85em', color: 'var(--text-2)' }}>
                            ({code.unit}, score: {code.score}, p{code.priority})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </div>

          {/* Download Button */}
          <button
            onClick={handleDownloadResults}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              fontWeight: '500'
            }}
          >
            <span className="material-icons-round">download</span>
            Download Validation Results (JSON)
          </button>
        </div>
      )}
    </div>
  );
};


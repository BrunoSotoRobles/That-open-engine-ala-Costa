import React, { useState } from 'react';

export function Footer() {
  const currentYear = new Date().getFullYear();
  const [showTooltip, setShowTooltip] = useState(false);
  
  return (
    <footer style={{
      backgroundColor: '#1a1a1a',
      color: '#ffffff',
      padding: '0.35rem 0',
      borderTop: '1px solid #333',
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 1000,
      height: '30px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end'
    }}>
      <div style={{
        padding: '0 2rem',
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: '1rem'
      }}>
        <span style={{
          color: '#cccccc',
          fontSize: '11px'
        }}>
          © {currentYear} Costa Laskenta. All rights reserved.
        </span>
        <span style={{
          color: '#888888',
          fontSize: '10px'
        }}>
          v1.1.0
        </span>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <span style={{
            padding: '2px 6px',
            backgroundColor: '#2a2a2a',
            borderRadius: '3px',
            fontSize: '10px',
            color: '#ff9800',
            border: '1px solid #404040'
          }}>
            <span className="material-icons-round" style={{ fontSize: '10px', marginRight: '2px' }}>engineering</span>
            In Development
          </span>
        </div>
      </div>
    </footer>
  );
}

import React, { useState, useEffect } from 'react';
import { DatabaseVersionChecker } from '../services/DatabaseVersionChecker';
import { materialDatabaseService } from '../services/MaterialDatabaseService';
import { MATERIAL_FACTORS } from '../data/emissionFactors';

interface DatabaseStatusProps {
  className?: string;
}

interface DatabaseStats {
  totalMaterials: number;
  verifiedMaterials: number;
  unverifiedMaterials: number;
  lastUpdate: string;
  version: string;
}

export const DatabaseStatusComponent: React.FC<DatabaseStatusProps> = ({ className = '' }) => {
  const [status, setStatus] = useState<'loading' | 'current' | 'outdated' | 'error'>('loading');
  const [message, setMessage] = useState<string>('');
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheckDate, setLastCheckDate] = useState<Date | null>(null);

  const databaseChecker = DatabaseVersionChecker.getInstance();

  // Calcular estadísticas de la base de datos
  const calculateDatabaseStats = (): DatabaseStats => {
    const materials = Object.values(MATERIAL_FACTORS);
    const verifiedMaterials = materials.filter(m => m.source.verified).length;
    const unverifiedMaterials = materials.length - verifiedMaterials;
    
    return {
      totalMaterials: materials.length,
      verifiedMaterials,
      unverifiedMaterials,
      lastUpdate: '2024-03-15', // Fecha de última actualización de la base de datos
      version: '2024.1'
    };
  };

  // Verificar estado de la base de datos
  const checkDatabaseStatus = async () => {
    setIsChecking(true);
    try {
      const result = await databaseChecker.checkVersion();
      setStatus(result.status as 'current' | 'outdated' | 'error');
      setMessage(result.message);
      setLastCheckDate(databaseChecker.getLastCheckDate() || new Date());
    } catch (error) {
      console.error('[DatabaseStatus] Error checking database:', error);
      setStatus('error');
      setMessage('Error checking database status');
    } finally {
      setIsChecking(false);
    }
  };

  // Cargar estadísticas iniciales
  useEffect(() => {
    const databaseStats = calculateDatabaseStats();
    setStats(databaseStats);
    
    // Verificar estado inicial
    checkDatabaseStatus();
  }, []);

  // Obtener icono según el estado
  const getStatusIcon = () => {
    switch (status) {
      case 'current':
        return 'check_circle';
      case 'outdated':
        return 'warning';
      case 'error':
        return 'error';
      default:
        return 'hourglass_empty';
    }
  };

  // Obtener clase CSS según el estado
  const getStatusClass = () => {
    switch (status) {
      case 'current':
        return 'success';
      case 'outdated':
        return 'warning';
      case 'error':
        return 'error';
      default:
        return '';
    }
  };

  // Obtener color del icono
  const getStatusColor = () => {
    switch (status) {
      case 'current':
        return 'var(--success)';
      case 'outdated':
        return 'var(--warning)';
      case 'error':
        return 'var(--error)';
      default:
        return 'var(--text-secondary)';
    }
  };

  if (!stats) {
    return (
      <div className={`database-status loading ${className}`}>
        <span className="material-icons status-icon">hourglass_empty</span>
        <div className="status-text">Loading database information...</div>
      </div>
    );
  }

  return (
    <div className={`database-status ${getStatusClass()} ${className}`}>
      <span 
        className="material-icons status-icon"
        style={{ color: getStatusColor() }}
      >
        {getStatusIcon()}
      </span>
      
      <div className="status-text">
        <div className="status-main">
          <strong>CO2Data.fi Database Status</strong>
          <span className="status-message">{message}</span>
        </div>
        
        <div className="status-details">
          <div className="status-stats">
            <span className="stat-item">
              <strong>{stats.verifiedMaterials}</strong> verified materials
            </span>
            <span className="stat-separator">•</span>
            <span className="stat-item">
              <strong>{stats.unverifiedMaterials}</strong> pending verification
            </span>
            <span className="stat-separator">•</span>
            <span className="stat-item">
              Version <strong>{stats.version}</strong>
            </span>
          </div>
          
          {lastCheckDate && (
            <div className="status-timestamp">
              Last checked: {lastCheckDate.toLocaleString()}
            </div>
          )}
        </div>
      </div>
      
      <div className="status-action">
        <button
          className="status-button"
          onClick={checkDatabaseStatus}
          disabled={isChecking}
          title="Check for database updates"
        >
          <span className="material-icons">
            {isChecking ? 'hourglass_empty' : 'refresh'}
          </span>
          {isChecking ? 'Checking...' : 'Check Updates'}
        </button>
      </div>
    </div>
  );
};

export default DatabaseStatusComponent;

import { BaseCostElement } from '../types/cost/shared';
import { IFCQuantityValue } from '../types/cost';

// Tipos para datos externos genéricos
export interface ExternalMaterialData {
  id?: string | number;
  name: string;
  type: string;
  area?: number | string;
  volume?: number | string;
  unit?: string;
  taloCode?: string;
  costs?: {
    material?: number;
    labor?: number;
    equipment?: number;
    overhead?: number;
    total?: number;
  };
  [key: string]: any; // Para propiedades adicionales específicas del sistema
}

// Interfaz para sistemas externos
export interface ExternalSystemData {
  elements: ExternalMaterialData[];
  metadata?: {
    source: string;
    version: string;
    date: string;
    [key: string]: any;
  };
}

// Tipos de validación
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  field: string;
  value?: any;
}

export interface ValidationWarning {
  code: string;
  message: string;
  field: string;
  value?: any;
}

// Configuración del adaptador
export interface AdapterConfig {
  defaultCosts: {
    [key: string]: {
      material: number;
      labor: number;
      equipment: number;
      overhead: number;
    };
  };
  taloCodeMappings: {
    [key: string]: string;
  };
  unitConversions: {
    [key: string]: {
      to: string;
      factor: number;
    };
  };
}

// Resultado de la transformación
export interface TransformationResult {
  elements: BaseCostElement[];
  validation: ValidationResult;
  metadata: {
    transformedAt: Date;
    source: string;
    originalCount: number;
    transformedCount: number;
  };
} 
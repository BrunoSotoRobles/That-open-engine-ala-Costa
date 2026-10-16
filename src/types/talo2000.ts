import { CostValue, FinnishCostValues } from './cost';

/**
 * Unidades de medida estándar según Talo 2000
 */
export enum Talo2000Unit {
  METERS = 'm',
  SQUARE_METERS = 'm2',
  CUBIC_METERS = 'm3',
  PIECES = 'kpl',
  KILOGRAMS = 'kg',
}

/**
 * Tipos de medición principales según Talo 2000
 */
export enum Talo2000MeasurementType {
  LENGTH = 'length',
  AREA = 'area',
  VOLUME = 'volume',
  COUNT = 'count',
  WEIGHT = 'weight',
}

/**
 * Requisitos de medición para un código Talo 2000
 */
export interface Talo2000Measurement {
  primary: Talo2000MeasurementType;
  secondary?: Talo2000MeasurementType;
  unit: Talo2000Unit;
  alternativeUnits?: Talo2000Unit[];
}

/**
 * Referencia básica a un código Talo 2000
 */
export interface Talo2000Reference {
  code: string;
  category: string;
  name: {
    fi: string;
    en: string;
  };
  identification?: string;
}

/**
 * Elemento completo de Talo 2000 con todos sus detalles
 */
export interface Talo2000Element extends Talo2000Reference {
  description: {
    fi: string;
    en: string;
  };
  costs: FinnishCostValues;
  measurementUnit: Talo2000Unit;
  measurements: Talo2000Measurement;
  rtComponents?: string[];
  properties?: {
    [key: string]: any;
  };
  parentCode?: string;
  subElements?: string[];
}

/**
 * Valor de cantidad según Talo 2000
 */
export interface Talo2000QuantityValue {
  value: number;
  unit: Talo2000Unit;
  measurementType: Talo2000MeasurementType;
}

/**
 * Factores de ajuste para cálculos de costos según Talo 2000
 */
export interface Talo2000Factors {
  location: {
    [key: string]: number;
  };
  buildingType: {
    [key: string]: number;
  };
  constructionMethod: {
    [key: string]: number;
  };
  projectSize: {
    small: number;    // < 1000m²
    medium: number;   // 1000-5000m²
    large: number;    // > 5000m²
  };
}

/**
 * Tipo de utilidad para convertir entre diferentes unidades Talo 2000
 */
export type Talo2000UnitConverter = (value: number, fromUnit: Talo2000Unit, toUnit: Talo2000Unit) => number;

/**
 * Tipo de utilidad para validar códigos Talo 2000
 */
export type Talo2000Validator = (code: string) => boolean;

/**
 * Tipo de utilidad para obtener mediciones según Talo 2000
 */
export type Talo2000MeasurementGetter = (element: any, code: string) => Talo2000QuantityValue | null; 
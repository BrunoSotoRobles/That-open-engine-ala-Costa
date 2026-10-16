import type { TimeEstimates } from '../types/cost';

// Base construction time estimates in days for different building types (per 1000m²)
export const BASE_TIME_ESTIMATES: { [key: string]: TimeEstimates } = {
  residential: {
    preparation: 20,
    foundation: 30,
    structure: 60,
    envelope: 45,
    interior: 75,
    mep: 90,
    finishes: 45,
    total: 365 // Typical 1-year timeline for residential
  },
  commercial: {
    preparation: 25,
    foundation: 35,
    structure: 75,
    envelope: 60,
    interior: 90,
    mep: 120,
    finishes: 60,
    total: 465 // ~15.5 months for commercial
  },
  industrial: {
    preparation: 30,
    foundation: 45,
    structure: 90,
    envelope: 75,
    interior: 60,
    mep: 150,
    finishes: 45,
    total: 495 // ~16.5 months for industrial
  }
};

// Adjustment factors for different conditions
export const TIME_ADJUSTMENT_FACTORS = {
  size: {
    small: 0.8, // <1000m² - faster due to smaller scale
    medium: 1.0, // 1000-5000m² - baseline
    large: 1.3 // >5000m² - more complex coordination
  },
  location: {
    urban: 1.2, // Urban areas - more restrictions and coordination
    suburban: 1.0, // Suburban areas - baseline
    rural: 0.9 // Rural areas - fewer restrictions
  },
  constructionMethod: {
    traditional: 1.0, // Baseline
    prefabricated: 0.7, // Faster due to off-site manufacturing
    modular: 0.6, // Fastest due to standardized modules
    renovation: 1.4 // Slower due to existing conditions
  },
  complexity: {
    simple: 0.8,
    standard: 1.0,
    complex: 1.3
  },
  season: {
    summer: 1.0, // Optimal conditions
    spring: 1.1,
    fall: 1.1,
    winter: 1.3 // Slower due to weather
  }
};

// Phase dependencies for scheduling
export const PHASE_DEPENDENCIES = {
  preparation: [],
  foundation: ['preparation'],
  structure: ['foundation'],
  envelope: ['structure'],
  interior: ['envelope'],
  mep: ['structure'], // Can start partially parallel with interior
  finishes: ['interior', 'mep']
};

// Resource requirements per phase (per 1000m²)
export const BASE_RESOURCE_REQUIREMENTS = {
  preparation: {
    labor: 8,
    equipment: 3
  },
  foundation: {
    labor: 12,
    equipment: 4
  },
  structure: {
    labor: 20,
    equipment: 5
  },
  envelope: {
    labor: 16,
    equipment: 3
  },
  interior: {
    labor: 25,
    equipment: 2
  },
  mep: {
    labor: 20,
    equipment: 2
  },
  finishes: {
    labor: 15,
    equipment: 1
  }
};

// Installation time estimates for different element types (hours per unit)
interface InstallationTime {
  preparation: number;
  installation: number;
  curing?: number;
}

export const ELEMENT_INSTALLATION_TIMES: { [key: string]: InstallationTime } = {
  IfcWall: {
    preparation: 2,
    installation: 4,
    curing: 24
  },
  IfcSlab: {
    preparation: 3,
    installation: 6,
    curing: 72
  },
  IfcColumn: {
    preparation: 1,
    installation: 2,
    curing: 24
  },
  IfcBeam: {
    preparation: 1,
    installation: 3,
    curing: 24
  },
  IfcWindow: {
    preparation: 0.5,
    installation: 1.5
  },
  IfcDoor: {
    preparation: 0.5,
    installation: 1
  },
  IfcStair: {
    preparation: 4,
    installation: 8,
    curing: 48
  },
  default: {
    preparation: 1,
    installation: 2
  }
}; 
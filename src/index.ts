// Geometry types
export interface Point {
    x: number;
    y: number;
    z: number;
}

export interface Vector {
    x: number;
    y: number;
    z: number;
}

export interface Surface {
    id: string;
    type: string;
    area: number;
    height?: number;
    width?: number;
    normal: Vector;
}

export interface Volume {
    id: string;
    type: string;
    volume: number;
    boundingSurfaces: string[];
}

export interface PreCalculatedGeometry {
    surfaces: Surface[];
    volumes: Volume[];
    totalArea: number;
    totalVolume: number;
}

// Property types
export interface MaterialLayer {
    material: string;
    thickness: number;
}

export interface WallMaterial {
    id: string;
    layers: MaterialLayer[];
}

export interface MaterialProperties {
    walls: WallMaterial[];
}

export interface IFCProperties {
    buildingType: string;
    storeys: number;
    constructionType: string;
    yearOfConstruction: number;
}

export interface TALOClassification {
    mainGroup: string;
    subGroup: string;
    detail: string;
    code: string;
}

export interface ValidationMetadata {
    lastUpdated: string;
    dataQuality: string;
    validationStatus: string;
    source: string;
} 
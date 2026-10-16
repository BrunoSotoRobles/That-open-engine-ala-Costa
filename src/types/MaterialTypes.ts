export type TransportMode = 'road' | 'rail' | 'sea' | 'air' | 'none' | 'truck' | 'train' | 'ship';

export interface MaterialImpacts {
    gwp: number;    // t CO₂ eq/m³
    ap: number;     // kg SO₂ eq/m³
    ep: number;     // kg PO₄ eq/m³
    ozone: number;  // kg CFC-11 eq/m³
    energy: number; // MJ/m³
}

export interface MaterialImpact {
    name: string;
    volume: number;
    matched: boolean;
    category: string;
    impacts: MaterialImpacts;
    transport: {
        distance: number;
        mode: TransportMode;
    };
} 
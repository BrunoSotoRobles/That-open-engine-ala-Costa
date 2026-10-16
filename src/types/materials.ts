export interface MaterialData {
    name: {
        fi: string;
        en: string;
    };
    source: {
        database: string;
        id: string;
        version: string;
        verified: boolean;
    };
    impacts: {
        gwp: number;    // t CO₂ eq/m³
        ap: number;     // kg SO₂ eq/m³
        ep: number;     // kg PO₄ eq/m³
        ozone: number;  // kg CFC-11 eq/m³
        energy: number; // MJ/m³
    };
    properties: {
        density: number;
        service_life: number;
        recyclability: number;
    };
    transport: {
        default_distance: number;
        emission_factor: number;
    };
    manufacturer: {
        name: string;
        location: string;
        epd_number: string;
    };
} 
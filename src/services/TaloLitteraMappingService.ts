import taloLitteraMappingJson from '../data/talo_littera_mapping.json';

/**
 * Interface para una entrada de código Littera con su unidad y descripción
 */
export interface LitteraMapping {
  litteraCode: string;
  description: string;
  unit: string;
  maaraLuetteloCode: string;
  category?: string; // Categoría opcional desde el CSV
}

/**
 * Interface para el resultado del mapping de un código Nimikkeistö
 */
export interface NimikkeistoLitteraMapping {
  nimikkeistoCode: string;
  nimikkeistoName: string;
  litteraMappings: LitteraMapping[];
}

/**
 * Interface para una fila del CSV de mapeo
 */
interface MappingRow {
  nimikkeistoCode: string;
  nimikkeistoName: string;
  nimikkeistoParent: string;
  maaraLuetteloBase: string;
  maaraLuetteloCode: string;
  litteraCode: string;
  litteraDescription: string;
  litteraUnit: string;
  category: string;
  notes: string;
  active: string;
}

/**
 * Servicio para mapear códigos TALO2000 Nimikkeistö a códigos Littera
 * 
 * Lee desde un archivo JSON estructurado que contiene toda la información
 * del mapeo entre Nimikkeistö, Määräluettelo y Littera.
 * 
 * El archivo JSON se genera desde talo_littera_mapping.csv para mantener
 * ambos archivos sincronizados.
 * 
 * La lógica de transformación:
 * - Código Nimikkeistö (ej: "1311") → Base Määräluettelo ("1.3.1.1")
 * - Base Määräluettelo → Todos los códigos Määräluettelo que empiezan con la base
 * - Cada código Määräluettelo → Múltiples códigos Littera con unidades
 */
export class TaloLitteraMappingService {
  private static instance: TaloLitteraMappingService;
  private mappingData: MappingRow[] = [];
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * Obtiene la instancia singleton del servicio
   */
  static getInstance(): TaloLitteraMappingService {
    if (!TaloLitteraMappingService.instance) {
      TaloLitteraMappingService.instance = new TaloLitteraMappingService();
    }
    return TaloLitteraMappingService.instance;
  }

  /**
   * Carga los datos de talo_littera_mapping.json (incluido en el bundle Vite; dev y producción).
   * Debe llamarse antes de usar el servicio.
   */
  async loadMappingData(): Promise<void> {
    if (this.isLoaded) {
      return;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadMappingDataFromBundle();
    return this.loadPromise;
  }

  private async loadMappingDataFromBundle(): Promise<void> {
    try {
      const jsonData = taloLitteraMappingJson as {
        mappingData?: unknown[];
        metadata?: Record<string, unknown>;
      };

      // Validar estructura JSON
      if (!jsonData.mappingData || !Array.isArray(jsonData.mappingData)) {
        throw new Error('Invalid JSON structure: mappingData array not found');
      }
      
      // Mapear datos JSON a MappingRow
      this.mappingData = jsonData.mappingData.map((row: any): MappingRow => ({
        nimikkeistoCode: (row.nimikkeistoCode || '').trim(),
        nimikkeistoName: (row.nimikkeistoName || '').trim(),
        nimikkeistoParent: (row.nimikkeistoParent || '').trim(),
        maaraLuetteloBase: (row.maaraLuetteloBase || '').trim(),
        maaraLuetteloCode: (row.maaraLuetteloCode || '').trim(),
        litteraCode: (row.litteraCode || '').trim(),
        litteraDescription: (row.litteraDescription || '').trim(),
        litteraUnit: (row.litteraUnit || '').trim(),
        category: (row.category || '').trim(),
        notes: (row.notes || '').trim(),
        active: (row.active || 'TRUE').trim().toUpperCase()
      })).filter((row: MappingRow) => {
        // Solo incluir filas activas con datos válidos
        return row.active === 'TRUE' && row.litteraCode && row.maaraLuetteloCode;
      });
      
      this.isLoaded = true;
      console.log('[TaloLitteraMappingService] JSON mapping data loaded successfully', {
        totalRows: this.mappingData.length,
        withNimikkeisto: this.mappingData.filter(r => r.nimikkeistoCode).length,
        metadata: jsonData.metadata || {}
      });
    } catch (error) {
      console.error('[TaloLitteraMappingService] Error loading JSON:', error);
      throw new Error(`Failed to load talo_littera_mapping.json data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Convierte un código Nimikkeistö a formato base Määräluettelo
   * Regla: cada dígito del código se separa por puntos
   * Ejemplo: "1311" → "1.3.1.1"
   */
  private nimikkeistoToMaaraLuetteloBase(nimikkeistoCode: string): string {
    return nimikkeistoCode.split('').join('.');
  }

  /**
   * Busca todos los códigos Määräluettelo relacionados con un código Nimikkeistö
   */
  private findMaaraLuetteloCodes(baseMaaraLuettelo: string, nimikkeistoCode?: string): string[] {
    const codes = new Set<string>();
    
    // Buscar en los datos del JSON
    for (const row of this.mappingData) {
      // Si se proporciona código Nimikkeistö, filtrar por él
      if (nimikkeistoCode && row.nimikkeistoCode !== nimikkeistoCode) {
        continue;
      }
      
      const taloMaara = row.maaraLuetteloCode;
      
      // Buscar por base Määräluettelo o por código Nimikkeistö directo
      if (taloMaara.startsWith(baseMaaraLuettelo + '.')) {
        codes.add(taloMaara);
      } else if (row.maaraLuetteloBase === baseMaaraLuettelo) {
        codes.add(taloMaara);
      }
    }
    
    return Array.from(codes);
  }

  /**
   * Obtiene todos los códigos Littera asociados a un código Määräluettelo
   */
  private getLitteraCodesForMaaraLuettelo(maaraLuetteloCode: string): LitteraMapping[] {
    const mappings: LitteraMapping[] = [];
    
    for (const row of this.mappingData) {
      if (row.maaraLuetteloCode === maaraLuetteloCode && row.litteraCode) {
        mappings.push({
          litteraCode: row.litteraCode,
          description: row.litteraDescription,
          unit: row.litteraUnit,
          maaraLuetteloCode: row.maaraLuetteloCode,
          category: row.category || undefined
        });
      }
    }
    
    return mappings;
  }

  /**
   * Obtiene todos los códigos Littera asociados a un código Nimikkeistö
   * 
   * @param nimikkeistoCode - Código TALO2000 Nimikkeistö (ej: "1311", "1242")
   * @param nimikkeistoName - Nombre opcional del código Nimikkeistö
   * @returns Mapeo completo con todos los códigos Littera asociados
   */
  getLitteraMappingsForNimikkeisto(
    nimikkeistoCode: string,
    nimikkeistoName?: string
  ): NimikkeistoLitteraMapping {
    if (!this.isLoaded) {
      throw new Error('Mapping data not loaded. Call loadMappingData() first.');
    }

    // Buscar directamente en el CSV por código Nimikkeistö
    const allLitteraMappings: LitteraMapping[] = [];
    let foundName = nimikkeistoName || '';
    
    for (const row of this.mappingData) {
      if (row.nimikkeistoCode === nimikkeistoCode && row.litteraCode) {
        if (!foundName && row.nimikkeistoName) {
          foundName = row.nimikkeistoName;
        }
        
        allLitteraMappings.push({
          litteraCode: row.litteraCode,
          description: row.litteraDescription,
          unit: row.litteraUnit,
          maaraLuetteloCode: row.maaraLuetteloCode,
          category: row.category || undefined
        });
      }
    }
    
    // Si no se encontraron resultados directos, intentar por base Määräluettelo
    if (allLitteraMappings.length === 0) {
      const baseMaaraLuettelo = this.nimikkeistoToMaaraLuetteloBase(nimikkeistoCode);
      const maaraLuetteloCodes = this.findMaaraLuetteloCodes(baseMaaraLuettelo, nimikkeistoCode);
      
      maaraLuetteloCodes.forEach(maaraCode => {
        const litteraMappings = this.getLitteraCodesForMaaraLuettelo(maaraCode);
        allLitteraMappings.push(...litteraMappings);
      });
    }

    return {
      nimikkeistoCode,
      nimikkeistoName: foundName,
      litteraMappings: allLitteraMappings
    };
  }

  /**
   * Obtiene códigos Littera agrupados por unidad para un código Nimikkeistö
   */
  getLitteraMappingsGroupedByUnit(
    nimikkeistoCode: string,
    nimikkeistoName?: string
  ): Map<string, LitteraMapping[]> {
    const mapping = this.getLitteraMappingsForNimikkeisto(nimikkeistoCode, nimikkeistoName);
    const grouped = new Map<string, LitteraMapping[]>();
    
    mapping.litteraMappings.forEach(littera => {
      const unit = littera.unit || 'N/A';
      if (!grouped.has(unit)) {
        grouped.set(unit, []);
      }
      grouped.get(unit)!.push(littera);
    });
    
    return grouped;
  }

  /**
   * Obtiene la unidad correcta para un código Littera específico
   * Útil para corregir unidades vacías o '***' desde el mapping
   * 
   * @param litteraCode - Código Littera (ej: "413380", "416320")
   * @returns Unidad correcta o null si no se encuentra
   */
  getLitteraUnitByCode(litteraCode: string): string | null {
    if (!this.isLoaded) {
      console.warn('[TaloLitteraMappingService] Mapping data not loaded. Call loadMappingData() first.');
      return null;
    }

    if (!litteraCode) {
      return null;
    }

    // Buscar en los datos del mapping
    for (const row of this.mappingData) {
      if (row.litteraCode === litteraCode && row.litteraUnit) {
        const unit = row.litteraUnit.trim();
        // Retornar null si la unidad es '***' o vacía (no es útil)
        if (unit && unit !== '***') {
          return unit;
        }
      }
    }

    return null;
  }
}


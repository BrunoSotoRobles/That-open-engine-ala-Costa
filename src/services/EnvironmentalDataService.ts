interface CO2DataResponse {
  ResourceId: string;
  Name: string;
  DataItems: Array<{
    ResourceId: string;
    Name: string;
    DataItems: Array<{
      ResourceId: string;
      Name: string;
      Value: number;
      Unit: string;
    }>;
  }>;
}

export class EnvironmentalDataService {
  private static instance: EnvironmentalDataService;
  private data: CO2DataResponse | null = null;

  private constructor() {}

  public static getInstance(): EnvironmentalDataService {
    if (!EnvironmentalDataService.instance) {
      EnvironmentalDataService.instance = new EnvironmentalDataService();
    }
    return EnvironmentalDataService.instance;
  }

  public async loadData(): Promise<void> {
    try {
      const response = await fetch('/LCAAPP/data/co2data_construction.json');
      if (!response.ok) {
        throw new Error('Failed to load environmental data');
      }
      this.data = await response.json();
      console.log('Environmental data loaded successfully');
    } catch (error) {
      console.error('Error loading environmental data:', error);
    }
  }

  public getData(): CO2DataResponse | null {
    return this.data;
  }
}

export const environmentalDataService = EnvironmentalDataService.getInstance(); 
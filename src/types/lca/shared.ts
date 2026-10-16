export interface MaterialQtoResult {
  [elementType: string]: {
    [materialName: string]: {
      NetVolume: number;
    };
  };
} 
import * as WEBIFC from "web-ifc"
import * as OBC from "@thatopen/components"
import * as FRAGS from "@thatopen/fragments"
import { MATERIAL_FACTORS, IMPACT_CATEGORIES } from '../../data/emissionFactors';

// Validation interfaces and types
interface VolumeValidationResult {
  isValid: boolean;
  geometricVolume: number;
  propertyVolume: number | null;
  discrepancy: number | null;
  method: 'geometric' | 'property' | 'both';
  warnings: string[];
}

interface ValidationThresholds {
  maxVolume: number;  // Maximum reasonable volume for any element (m³)
  minVolume: number;  // Minimum reasonable volume for any element (m³)
  maxDiscrepancy: number;  // Maximum allowed discrepancy between methods (%)
}

interface MaterialThresholds {
  maxVolume: number;
  minVolume: number;
  typicalVolume: number;
  density?: number;  // kg/m³ para validación adicional
}

const DEFAULT_VALIDATION_THRESHOLDS: ValidationThresholds = {
  maxVolume: 200,  // Reducido de 1000 a 200
  minVolume: 0.0001,
  maxDiscrepancy: 0.2
};

const MATERIAL_THRESHOLDS: { [key: string]: MaterialThresholds } = {
  // Materiales estructurales
  'concrete': {
    maxVolume: 150,
    minVolume: 0.01,
    typicalVolume: 50,
    density: 2400
  },
  'timber': {
    maxVolume: 100,
    minVolume: 0.001,
    typicalVolume: 20,
    density: 500
  },
  // Aislamientos
  'insulation': {
    maxVolume: 100,
    minVolume: 0.001,
    typicalVolume: 30,
    density: 40
  },
  // Acabados
  'gypsum': {
    maxVolume: 180,
    minVolume: 0.001,
    typicalVolume: 40,
    density: 800
  },
  'glass': {
    maxVolume: 20,
    minVolume: 0.001,
    typicalVolume: 5,
    density: 2500
  },
  // Metales
  'metal': {
    maxVolume: 30,
    minVolume: 0.0001,
    typicalVolume: 2,
    density: 7850
  },
  // Valores por defecto más restrictivos
  'default': {
    maxVolume: 50,
    minVolume: 0.0001,
    typicalVolume: 10
  }
};

function isElementQuantity(ps: any): ps is { Quantities?: any[]; type: number } {
  return !!ps && ps.type === (WEBIFC as any).IFCELEMENTQUANTITY;
}

function isQuantityVolume(q: any): q is { type: number; VolumeValue?: { value?: number } } {
  return !!q && q.type === (WEBIFC as any).IFCQUANTITYVOLUME;
}

type MaterialQtoResult = {[materialName: string]: {[qtoName: string]: number}}

interface TableRow {
  property: string;
  value: string | number;
  isHeader?: boolean;
  category?: string;
}

// Añadir nueva interfaz para la estructura de datos
type ElementMaterialQtoResult = {
  [elementType: string]: {
    [materialName: string]: {
      NetVolume: number
    }
  }
}

interface ElementTypeThresholds {
  maxVolume: number;
  minVolume: number;
  typicalVolume: number;
}

const ELEMENT_TYPE_THRESHOLDS: { [key: string]: ElementTypeThresholds } = {
  'IfcSlab': {
    maxVolume: 2000,
    minVolume: 0.1,
    typicalVolume: 500
  },
  'IfcCovering': {
    maxVolume: 1000,
    minVolume: 0.05,
    typicalVolume: 300
  },
  'IfcRoof': {
    maxVolume: 1000,
    minVolume: 0.1,
    typicalVolume: 200
  },
  'IfcWall': {
    maxVolume: 2000,
    minVolume: 0.1,
    typicalVolume: 800
  }
};

export class LCACalculator extends OBC.Component implements OBC.Disposable {
  static uuid = "13229f66-c0b9-477b-84e9-5b2a63354a21"
  enabled = true
  onDisposed = new OBC.Event<any>()
  private _materialQtoResult: MaterialQtoResult = {}
  private _elementMaterialQtoResult: ElementMaterialQtoResult = {}
  materialQuantitiesTable = {
    columns: [
      { header: 'Element/Material', dataField: 'property', width: '60%', sortable: true },
      { header: 'Volume', dataField: 'value', width: '40%', sortable: true }
    ],
    data: [{
      property: 'No data available',
      value: '-'
    }] as TableRow[]
  };
  onMaterialQuantitiesComputed = new OBC.Event<MaterialQtoResult>()
  onProgress?: (percent: number) => void;
  materialFactors = MATERIAL_FACTORS;
  impactCategories = IMPACT_CATEGORIES;

  constructor(components: OBC.Components) {
    super(components)
    this.components.add(LCACalculator.uuid, this)
    
    // Create table with initial data
    this.materialQuantitiesTable = {
      columns: [
        { header: '', dataField: 'property', width: '50%', sortable: true },
        { header: 'Value', dataField: 'value', width: '50%', sortable: true }
      ],
      data: [{
        property: 'No data available',
        value: '-'
      }]
    }
  }

  resetMaterialQuantities() {
    this._materialQtoResult = {}
  }

  private updateMaterialTable() {
    const tableData: TableRow[] = [];
    
    let totalVolume = 0;
    for (const elementType in this._elementMaterialQtoResult) {
        const materials = this._elementMaterialQtoResult[elementType];
        for (const material in materials) {
            const volume = materials[material].NetVolume;
            totalVolume += volume;
        }
    }
    
    tableData.push({
        property: 'Total Material Volumes',
        value: `${totalVolume.toFixed(2)} m³`,
        isHeader: true
    });

    for (const elementType in this._elementMaterialQtoResult) {
        const materials = this._elementMaterialQtoResult[elementType];
        let elementTotalVolume = 0;
        
        for (const material in materials) {
            const volume = materials[material].NetVolume;
            elementTotalVolume += volume;
        }
        
        if (elementTotalVolume > 0) {
            tableData.push({
                property: elementType,
                value: `${elementTotalVolume.toFixed(2)} m³`,
                isHeader: true
            });

            for (const material in materials) {
                const volume = materials[material].NetVolume;
                if (volume > 0) {
                    tableData.push({
                        property: `  ${material}`,
                        value: `${volume.toFixed(2)} m³`
                    });
                }
            }
        }
    }

    this.materialQuantitiesTable.data = tableData;
  }

  private validateVolume(
    geometricVolume: number,
    propertyVolume: number | null,
    elementType: string
  ): VolumeValidationResult {
    const result: VolumeValidationResult = {
      isValid: true,
      geometricVolume,
      propertyVolume,
      discrepancy: null,
      method: propertyVolume !== null ? 'both' : 'geometric',
      warnings: []
    };

    if (isNaN(geometricVolume) || !isFinite(geometricVolume)) {
      result.isValid = false;
      result.warnings.push(`Invalid geometric volume: ${geometricVolume}`);
      result.geometricVolume = 0;
      return result;
    }

    if (geometricVolume > DEFAULT_VALIDATION_THRESHOLDS.maxVolume) {
      result.isValid = false;
      result.warnings.push(`Geometric volume (${geometricVolume.toFixed(2)} m³) exceeds maximum threshold (${DEFAULT_VALIDATION_THRESHOLDS.maxVolume} m³)`);
      result.geometricVolume = DEFAULT_VALIDATION_THRESHOLDS.maxVolume;
    }

    if (geometricVolume < DEFAULT_VALIDATION_THRESHOLDS.minVolume) {
      result.isValid = false;
      result.warnings.push(`Geometric volume (${geometricVolume.toFixed(2)} m³) is below minimum threshold (${DEFAULT_VALIDATION_THRESHOLDS.minVolume} m³)`);
      result.geometricVolume = DEFAULT_VALIDATION_THRESHOLDS.minVolume;
    }

    if (propertyVolume !== null) {
      if (isNaN(propertyVolume) || !isFinite(propertyVolume)) {
        result.isValid = false;
        result.warnings.push(`Invalid property volume: ${propertyVolume}`);
        result.propertyVolume = null;
        return result;
      }

      let validatedPropertyVolume = propertyVolume;

      if (propertyVolume > DEFAULT_VALIDATION_THRESHOLDS.maxVolume) {
        result.isValid = false;
        result.warnings.push(`Property volume (${propertyVolume.toFixed(2)} m³) exceeds maximum threshold (${DEFAULT_VALIDATION_THRESHOLDS.maxVolume} m³)`);
        validatedPropertyVolume = DEFAULT_VALIDATION_THRESHOLDS.maxVolume;
      }

      if (propertyVolume < DEFAULT_VALIDATION_THRESHOLDS.minVolume) {
        result.isValid = false;
        result.warnings.push(`Property volume (${propertyVolume.toFixed(2)} m³) is below minimum threshold (${DEFAULT_VALIDATION_THRESHOLDS.minVolume} m³)`);
        validatedPropertyVolume = DEFAULT_VALIDATION_THRESHOLDS.minVolume;
      }

      result.propertyVolume = validatedPropertyVolume;

      const maxVolume = Math.max(result.geometricVolume, validatedPropertyVolume);
      if (maxVolume > 0) {
        result.discrepancy = Math.abs(result.geometricVolume - validatedPropertyVolume) / maxVolume;
        
        if (result.discrepancy > DEFAULT_VALIDATION_THRESHOLDS.maxDiscrepancy) {
          result.isValid = false;
          result.warnings.push(
            `High volume discrepancy (${(result.discrepancy * 100).toFixed(1)}%) between geometric (${result.geometricVolume.toFixed(2)} m³) and property (${validatedPropertyVolume.toFixed(2)} m³) methods`
          );
        }
      }
    }

    return result;
  }

  private async detectSourceSoftware(model: any): Promise<'ArchiCAD' | 'Revit' | 'Unknown'> {
    try {
      const project = await model.getProperties(model.expressID);
      const application = project?.OwnerHistory?.OwningApplication;
      
      if (application) {
        const appInfo = await model.getProperties(application.value);
        const applicationName = appInfo?.ApplicationFullName?.value || '';
        
        if (applicationName.toLowerCase().includes('archicad')) {
          return 'ArchiCAD';
        } else if (applicationName.toLowerCase().includes('revit')) {
          return 'Revit';
        }
      }
    } catch (error) {
      console.warn('[LCA] Error detecting source software:', error);
    }
    return 'Unknown';
  }

  private getMaterialCategory(materialName: string): string {
    const lowerName = materialName.toLowerCase();
    
    // Mapeo mejorado de nombres de materiales a categorías
    if (lowerName.includes('concrete') || lowerName.includes('betoni') || 
        lowerName.includes('runko') || lowerName.includes('element')) return 'concrete';
        
    if (lowerName.includes('timber') || lowerName.includes('wood') || lowerName.includes('puu') || 
        lowerName.includes('clt') || lowerName.includes('lumber') || lowerName.includes('sahatavara') ||
        lowerName.includes('höylä') || lowerName.includes('vaneri')) return 'timber';
        
    if (lowerName.includes('insulation') || lowerName.includes('eriste') || 
        lowerName.includes('mineral') || lowerName.includes('villa') ||
        lowerName.includes('lämmön')) return 'insulation';
        
    if (lowerName.includes('gypsum') || lowerName.includes('kipsi') ||
        lowerName.includes('kartonki')) return 'gypsum';
        
    if (lowerName.includes('glass') || lowerName.includes('lasi') ||
        lowerName.includes('window') || lowerName.includes('ikkuna')) return 'glass';
        
    if (lowerName.includes('metal') || lowerName.includes('steel') || 
        lowerName.includes('aluminium') || lowerName.includes('metalli') ||
        lowerName.includes('chrome') || lowerName.includes('teräs')) return 'metal';
    
    return 'default';
  }

  private validateMaterialVolume(
    volume: number,
    materialName: string,
    sourceSoftware: 'ArchiCAD' | 'Revit' | 'Unknown'
  ): number {
    const category = this.getMaterialCategory(materialName);
    const thresholds = MATERIAL_THRESHOLDS[category] || MATERIAL_THRESHOLDS['default'];

    if (isNaN(volume) || !isFinite(volume)) {
      console.warn(`[LCA] Invalid volume for ${materialName}: ${volume}`);
      return 0;
    }

    if (sourceSoftware === 'Revit' && volume === 200) {
      console.warn(`[LCA] Invalid default volume (200 m³) detected in Revit:`, {
        material: materialName,
        category,
        volume
      });
      return 0;
    }

    if (volume > thresholds.maxVolume) {
      console.warn(`[LCA] Volume exceeds maximum for ${materialName}:`, {
        volume,
        maxAllowed: thresholds.maxVolume,
        category
      });
      return 0;
    }

    if (volume < thresholds.minVolume && volume > 0) {
      if (sourceSoftware === 'ArchiCAD' && category === 'metal') {
        return volume;
      }
      console.warn(`[LCA] Volume below minimum for ${materialName}:`, {
        volume,
        minAllowed: thresholds.minVolume,
        category
      });
      return thresholds.minVolume;
    }

    return volume;
  }

  private validateVolumeForElementType(
    volume: number,
    elementType: string,
    sourceSoftware: 'ArchiCAD' | 'Revit' | 'Unknown'
  ): number {
    const thresholds = ELEMENT_TYPE_THRESHOLDS[elementType] || {
      maxVolume: DEFAULT_VALIDATION_THRESHOLDS.maxVolume,
      minVolume: DEFAULT_VALIDATION_THRESHOLDS.minVolume,
      typicalVolume: 100
    };

    if (sourceSoftware === 'Revit' && volume >= 1000) {
      console.warn(`[LCA] Suspicious volume of 1000 m³ detected in Revit for ${elementType}`);
      return thresholds.typicalVolume;
    }

    if (sourceSoftware === 'ArchiCAD') {
      if (elementType === 'IfcSlab' && volume > thresholds.typicalVolume * 2) {
        console.warn(`[LCA] High volume detected for ArchiCAD IfcSlab: ${volume} m³`);
      }
    } else if (sourceSoftware === 'Revit') {
      if (elementType === 'IfcCovering' && volume > thresholds.typicalVolume * 2) {
        console.warn(`[LCA] High volume detected for Revit IfcCovering: ${volume} m³`);
      }
    }

    if (volume > thresholds.maxVolume) {
      console.warn(`[LCA] Volume exceeds maximum for ${elementType}: ${volume} m³ > ${thresholds.maxVolume} m³`);
      return thresholds.maxVolume;
    }
    if (volume < thresholds.minVolume) {
      console.warn(`[LCA] Volume below minimum for ${elementType}: ${volume} m³ < ${thresholds.minVolume} m³`);
      return thresholds.minVolume;
    }

    return volume;
  }

  async calculateMaterialQuantities(fragmentIdMap: FRAGS.FragmentIdMap) {
    return new Promise<ElementMaterialQtoResult>(async (resolve, reject) => {
      try {
        this._elementMaterialQtoResult = {};
        const fragmentManager = this.components.get(OBC.FragmentsManager);
        const models = fragmentManager.groups;

        const modelSoftware = new Map<any, 'ArchiCAD' | 'Revit' | 'Unknown'>();
        for (const [_, model] of models) {
          if (model?.hasProperties) {
            const software = await this.detectSourceSoftware(model);
            modelSoftware.set(model, software);
          }
        }

        const materialNames: string[] = [];
        
        if (this.onProgress) {
          this.onProgress(5);
        }
        
        let totalElements = 0;
        let processedElements = 0;
        
        for (const [_, model] of models) {
          if (!model?.hasProperties) continue;
          for (const fragment of model.items) {
            totalElements += fragment.ids.size;
          }
        }

        if (totalElements === 0) {
          reject(new Error("No elements found to process"));
          return;
        }

        if (this.onProgress) {
          this.onProgress(10);
        }

        const progressPerElement = 60 / totalElements;
        
        for (const [_, model] of models) {
          if (!model?.hasProperties) continue;

          for (const fragment of model.items) {
            const expressIDs = fragment.ids
            const indexer = this.components.get(OBC.IfcRelationsIndexer)
            
            for (const id of expressIDs) {
              const element = await model.getProperties(id)
              if (!element) continue;
              
              const webIfcKeys = Object.keys(WEBIFC) as Array<keyof typeof WEBIFC>;
              const foundKey = webIfcKeys.find(k => (WEBIFC as any)[k] === element.type);
              const elementType = foundKey ?? 'Unknown';
              const formattedElementType = elementType.replace(/^IFC/, 'Ifc').replace(/\s+/g, '');
              
              if (!(formattedElementType in this._elementMaterialQtoResult)) {
                this._elementMaterialQtoResult[formattedElementType] = {}
              }

              const associations = indexer.getEntityRelations(model, id, "HasAssociations")
              if (!associations) continue;

              const materialNames: string[] = [];

              for (const assocId of associations) {
                const association = await model.getProperties(assocId)
                if (!association) continue;
                
                if (association?.MaterialConstituents) {
                  for (const constituent of association.MaterialConstituents) {
                    const material = await model.getProperties(constituent.value)
                    if (material) {
                      const { name } = await OBC.IfcPropertiesUtils.getEntityName(model, material.expressID)
                      if (name) {
                        materialNames.push(name);
                      }
                    }
                  }
                }
              }

              materialNames.forEach(name => {
                if (!this._elementMaterialQtoResult[formattedElementType]) {
                  this._elementMaterialQtoResult[formattedElementType] = {};
                }
                if (!this._elementMaterialQtoResult[formattedElementType][name]) {
                  this._elementMaterialQtoResult[formattedElementType][name] = {
                    NetVolume: 0
                  };
                }
              });

              let elementVolume = 0;
              let propertyVolume: number | null = null;
              
              const propertySets = indexer.getEntityRelations(model, id, "IsDefinedBy");
              if (propertySets) {
                for (const propertySetId of propertySets) {
                  const propertySet = await model.getProperties(propertySetId);
                  if (isElementQuantity(propertySet)) {
                    const quantities = propertySet.Quantities;
                    if (quantities) {
                      for (const quantity of quantities) {
                        const qto = await model.getProperties(quantity.value);
                        if (isQuantityVolume(qto) && qto.VolumeValue?.value !== undefined) {
                          // Use IfcPropertiesUtils for automatic unit conversion based on model units
                          try {
                            const { value } = await OBC.IfcPropertiesUtils.getQuantityValue(model, quantity.value);
                            if (value !== null && value !== undefined) {
                              propertyVolume = value; // Already converted to correct units by IfcPropertiesUtils
                            } else {
                              propertyVolume = qto.VolumeValue.value; // Use raw value if conversion not available
                            }
                          } catch (e) {
                            propertyVolume = qto.VolumeValue.value; // Use raw value if conversion fails (assumes model units are correct)
                          }
                          break;
                        }
                      }
                    }
                  }
                }
              }
              
              const fragments = model.items;
              for (const fragment of fragments) {
                  if (fragment.ids.has(id)) {
                      const geometry = fragment.mesh?.geometry;
                      if (geometry) {
                          const position = geometry.attributes.position.array;
                          const index = geometry.index?.array;
                          
                          if (position && index) {
                              let maxCoord = 0;
                              for (let i = 0; i < position.length; i++) {
                                  maxCoord = Math.max(maxCoord, Math.abs(position[i]));
                              }
                              
                              let scaleFactor = 1;
                              if (maxCoord > 1000) {
                                  scaleFactor = 0.001 * 0.001 * 0.001;
                              } else if (maxCoord > 10) {
                                  scaleFactor = 0.01 * 0.01 * 0.01;
                              }
                              
                              for (let i = 0; i < index.length; i += 3) {
                                  const i1 = index[i] * 3;
                                  const i2 = index[i + 1] * 3;
                                  const i3 = index[i + 2] * 3;
                                  
                                  const v1 = [position[i1], position[i1 + 1], position[i1 + 2]];
                                  const v2 = [position[i2], position[i2 + 1], position[i2 + 2]];
                                  const v3 = [position[i3], position[i3 + 1], position[i3 + 2]];
                                  
                                  const volume = Math.abs(
                                      v1[0] * (v2[1] * v3[2] - v2[2] * v3[1]) +
                                      v1[1] * (v2[2] * v3[0] - v2[0] * v3[2]) +
                                      v1[2] * (v2[0] * v3[1] - v2[1] * v3[0])
                                  ) / 6;
                                  
                                  elementVolume += volume * scaleFactor;
                              }
                          }
                          
                          if (propertyVolume !== null && propertyVolume > 0) {
                              const ratio = elementVolume / propertyVolume;
                              
                              if (ratio > 100 || ratio < 0.01) {
                                  if (Math.abs(Math.log10(ratio)) > 2.9 && Math.abs(Math.log10(ratio)) < 3.1) {
                                      elementVolume = elementVolume / 1000;
                                  }
                              }
                          }
                          
                          break;
                      }
                  }
              }

              const validationResult = this.validateVolume(elementVolume, propertyVolume, elementType);
              
              if (!validationResult.isValid) {
                console.warn(`[LCA] Volume validation warnings for ${formattedElementType}:`, validationResult.warnings);
              }
              
              let finalVolume = elementVolume;
              if (validationResult.method === 'both' && propertyVolume !== null) {
                if (validationResult.discrepancy !== null && validationResult.discrepancy <= DEFAULT_VALIDATION_THRESHOLDS.maxDiscrepancy) {
                  finalVolume = (elementVolume + propertyVolume) / 2;
                } else {
                  finalVolume = propertyVolume;
                }
              }

              if (materialNames.length > 0 && finalVolume > 0) {
                  if (finalVolume > DEFAULT_VALIDATION_THRESHOLDS.maxVolume) {
                      console.warn(`[LCA] Final volume (${finalVolume.toFixed(2)} m³) exceeds maximum threshold. Adjusting to ${DEFAULT_VALIDATION_THRESHOLDS.maxVolume} m³`);
                      finalVolume = DEFAULT_VALIDATION_THRESHOLDS.maxVolume;
                  }

                  const volumePerMaterial = finalVolume / materialNames.length;

                  if (!this._elementMaterialQtoResult[formattedElementType]) {
                      this._elementMaterialQtoResult[formattedElementType] = {};
                  }

                  materialNames.forEach(name => {
                      let validatedVolume = volumePerMaterial;
                      if (validatedVolume > DEFAULT_VALIDATION_THRESHOLDS.maxVolume) {
                          console.warn(`[LCA] Volume per material (${validatedVolume.toFixed(2)} m³) exceeds maximum threshold for ${name}. Adjusting to ${DEFAULT_VALIDATION_THRESHOLDS.maxVolume} m³`);
                          validatedVolume = DEFAULT_VALIDATION_THRESHOLDS.maxVolume;
                      }

                      if (!this._elementMaterialQtoResult[formattedElementType][name]) {
                          this._elementMaterialQtoResult[formattedElementType][name] = {
                              NetVolume: validatedVolume
                          };
                      } else {
                          const currentVolume = this._elementMaterialQtoResult[formattedElementType][name].NetVolume;
                          const newVolume = currentVolume + validatedVolume;
                          
                          if (newVolume > DEFAULT_VALIDATION_THRESHOLDS.maxVolume) {
                              console.warn(`[LCA] Total volume for ${name} (${newVolume.toFixed(2)} m³) exceeds maximum threshold. Adjusting to ${DEFAULT_VALIDATION_THRESHOLDS.maxVolume} m³`);
                              this._elementMaterialQtoResult[formattedElementType][name].NetVolume = DEFAULT_VALIDATION_THRESHOLDS.maxVolume;
                          } else {
                              this._elementMaterialQtoResult[formattedElementType][name].NetVolume = newVolume;
                          }
                      }
                  });
              }

              processedElements++;
              if (this.onProgress) {
                const currentProgress = 10 + Math.round(processedElements * progressPerElement);
                this.onProgress(Math.min(70, currentProgress));
              }

              if (processedElements % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
              }

              for (const assocId of associations) {
                const association = await model.getProperties(assocId);
                if (!association) continue;

                let elementArea = 0;
                const layerThicknesses = new Map<string, number>();

                const propertySets = indexer.getEntityRelations(model, id, "IsDefinedBy");
                if (propertySets) {
                  for (const propertySetId of propertySets) {
                    const propertySet = await model.getProperties(propertySetId);
                    if (!propertySet) continue;

                    if (propertySet.type === (WEBIFC as any).IFCELEMENTQUANTITY) {
                      const quantities = propertySet.Quantities;
                      if (!quantities) continue;

                      for (const quantity of quantities) {
                        const qto = await model.getProperties(quantity.value);
                        if (!qto) continue;

                        const qtoName = qto.Name?.value;

                        if (qto.type === (WEBIFC as any).IFCQUANTITYLENGTH && qto.LengthValue?.value !== undefined) {
                          // Use IfcPropertiesUtils for automatic unit conversion based on model units
                          let lengthValue;
                          try {
                            const { value } = await OBC.IfcPropertiesUtils.getQuantityValue(model, quantity.value);
                            if (value !== null && value !== undefined) {
                              lengthValue = value; // Already converted to correct units by IfcPropertiesUtils
                            } else {
                              lengthValue = qto.LengthValue.value; // Use raw value if conversion not available
                            }
                          } catch (e) {
                            lengthValue = qto.LengthValue.value; // Use raw value if conversion fails (assumes model units are correct)
                          }
                          if (qtoName) {
                            const lowerName = qtoName.toLowerCase();
                            if (lowerName.includes('thickness') || 
                                lowerName.includes('width') || 
                                lowerName.includes('layer') ||
                                lowerName.includes('paksuus')) {
                              layerThicknesses.set(qtoName, lengthValue);
                            }
                          }
                        }
                      }
                    }

                    if (propertySet.HasProperties) {
                      for (const prop of propertySet.HasProperties) {
                        const property = await model.getProperties(prop.value);
                        if (!property) continue;

                        const propName = property.Name?.value;
                        const propValue = property.NominalValue?.value;

                        if (propName && propValue !== undefined) {
                          const lowerName = propName.toLowerCase();
                          if (lowerName.includes('thickness') || 
                              lowerName.includes('width') || 
                              lowerName.includes('layer') ||
                              lowerName.includes('paksuus')) {
                            layerThicknesses.set(propName, propValue);
                          }
                        }
                      }
                    }
                  }
                }

                if (association?.MaterialConstituents) {
                  const constituents: Array<{materialName: string, volume: number, thickness?: number}> = [];
                  let totalThickness = 0;

                  for (const constituent of association.MaterialConstituents) {
                    const material = await model.getProperties(constituent.Material?.value);
                    if (!material?.expressID) continue;

                    const { name } = await OBC.IfcPropertiesUtils.getEntityName(model, material.expressID);
                    if (!name) continue;

                    let materialThickness: number | undefined;
                    for (const [propName, value] of layerThicknesses.entries()) {
                      const lowerPropName = propName.toLowerCase();
                      const lowerMaterialName = name.toLowerCase();

                      if (lowerPropName === lowerMaterialName || 
                          lowerPropName.includes(lowerMaterialName) || 
                          lowerMaterialName.includes(lowerPropName)) {
                        materialThickness = value;
                        totalThickness += value;
                        break;
                      }
                    }

                    constituents.push({
                      materialName: name,
                      volume: 0,
                      thickness: materialThickness
                    });
                  }

                  if (totalThickness > 0) {
                    for (const constituent of constituents) {
                      if (constituent.thickness) {
                        constituent.volume = finalVolume * (constituent.thickness / totalThickness);
                      } else {
                        constituent.volume = finalVolume / constituents.length;
                      }
                    }
                  } else {
                    const equalVolume = finalVolume / constituents.length;
                    for (const constituent of constituents) {
                      constituent.volume = equalVolume;
                    }
                  }

                  for (const { materialName, volume } of constituents) {
                    if (!this._elementMaterialQtoResult[formattedElementType][materialName]) {
                      this._elementMaterialQtoResult[formattedElementType][materialName] = {
                        NetVolume: 0
                      };
                    }
                    const validatedVolume = this.validateMaterialVolume(
                      volume,
                      materialName,
                      modelSoftware.get(model) || 'Unknown'
                    );
                    this._elementMaterialQtoResult[formattedElementType][materialName].NetVolume = validatedVolume;
                  }
                }
              }

              finalVolume = this.validateVolumeForElementType(
                finalVolume,
                elementType,
                modelSoftware.get(model) || 'Unknown'
              );
            }
          }
        }

        if (this.onProgress) {
          this.onProgress(75);
        }

        if (this.onProgress) {
          this.onProgress(90);
        }
        
        await this.updateMaterialTable();
        
        if (this.onProgress) {
          this.onProgress(100);
        }

        this.printMaterialSummary();

        resolve(this._elementMaterialQtoResult);
      } catch (error) {
        console.error('[LCA] Error in calculation:', error);
        reject(error);
      }
    });
  }

  private printMaterialSummary() {
    console.log('\n=== LCA ANALYSIS SUMMARY ===');
    console.log('---------------------------');
    
    let totalVolume = 0;
    const elementVolumes = new Map<string, number>();
    const materialVolumes = new Map<string, number>();

    for (const elementType in this._elementMaterialQtoResult) {
      let elementTotalVolume = 0;
      const materials = this._elementMaterialQtoResult[elementType];
      
      for (const material in materials) {
        const volume = materials[material].NetVolume;
        elementTotalVolume += volume;
        totalVolume += volume;
        
        materialVolumes.set(
          material, 
          (materialVolumes.get(material) || 0) + volume
        );
      }
      
      elementVolumes.set(elementType, elementTotalVolume);
    }

    console.log('Total Volume:', totalVolume.toFixed(2), 'm³');
    console.log('\nVolumes by Element Type:');
    console.log('---------------------------');
    elementVolumes.forEach((volume, elementType) => {
      const percentage = ((volume / totalVolume) * 100).toFixed(1);
      console.log(`${elementType}: ${volume.toFixed(2)} m³ (${percentage}%)`);
    });

    console.log('\nVolumes by Material:');
    console.log('---------------------------');
    materialVolumes.forEach((volume, material) => {
      const percentage = ((volume / totalVolume) * 100).toFixed(1);
      console.log(`${material}: ${volume.toFixed(2)} m³ (${percentage}%)`);
    });

    console.log('\nAnalysis Notes:');
    console.log('---------------------------');
    if (totalVolume === 0) {
      console.log('WARNING: No volumes calculated!');
    }
    if (totalVolume > 100000) {
      console.log('WARNING: Unusually large total volume - possible unit conversion issue');
    }
    if (materialVolumes.size === 0) {
      console.log('WARNING: No materials found!');
    }
    
    console.log('===========================\n');
  }

  async dispose() {
    this.enabled = false
    this.resetMaterialQuantities()
  }

  private async calculateArea(model: any, areaId: number): Promise<number> {
    try {
      const area = await model.getProperties(areaId);
      if (area?.XDim?.value && area?.YDim?.value) {
        // Rectangle
        return area.XDim.value * area.YDim.value;
      } else if (area?.Radius?.value) {
        // Circle
        return Math.PI * area.Radius.value * area.Radius.value;
      }
    } catch (error) {
      console.warn('[LCA] Error calculating area:', error);
    }
    return 0;
  }

  async getMaterialQuantities() {
    // Asegurarnos de que tenemos datos en la tabla
    if (!this.materialQuantitiesTable.data || this.materialQuantitiesTable.data.length === 0) {
        throw new Error('No material quantities data available');
    }

    // Procesar los datos existentes de la tabla
    const processedData: TableRow[] = [];
    let currentCategory = '';

    this.materialQuantitiesTable.data.forEach(row => {
        if (row.isHeader) {
            // Es un encabezado de elemento IFC
            if (row.property !== 'Total Material Volumes') {
                currentCategory = row.property;
                processedData.push({
                    property: row.property,
                    value: row.value,
                    isHeader: true,
                    category: row.property
                });
            }
        } else {
            // Es una fila de material
            const materialName = row.property.trim();
            const volumeStr = String(row.value).replace(' m³', '');
            const volume = parseFloat(volumeStr);

            if (!isNaN(volume)) {
                processedData.push({
                    property: materialName,
                    value: `${(volume).toFixed(3)} m³`,
                    category: currentCategory,
                    isHeader: false
                });
            }
        }
    });

    return {
        data: processedData,
        columns: this.materialQuantitiesTable.columns
    };
  }
}